/**
 * Quick search — the deliberately thin lookup behind the ⌘-palette.
 *
 * Find ID already answers "everything about this ID": journey, derived slabs,
 * machine labels, dimensions, dates. That is the right answer when you have
 * stopped to investigate, and it is why it takes a moment to load.
 *
 * This is the other question — the one asked mid-stride on the floor: WHERE is
 * it and WHAT STAGE is it at. Nothing else. Three small queries, capped rows,
 * four columns each, so the palette can answer while you are still typing.
 *
 * Production department only, same roles as the production Find ID.
 */

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { effectiveDepartment } from "@/lib/departments";

export const dynamic = "force-dynamic";

/** Same set the topbar production Find ID uses — plus vendors, who walk the
 *  floor and have no department of their own. */
const PRODUCTION_ROLES = [
  "developer", "owner", "team_head", "senior_incharge", "crosscheck", "dispatch", "carving_head",
];

const MAX_ROWS = 8;

export type QuickHit = {
  kind: "slab" | "block";
  code: string;
  temple: string | null;
  /** Human stage — "Carving · in progress", "Cut done", "Dispatched". */
  stage: string;
  /** Where it physically is, as best the system knows. */
  where: string | null;
  /** A short identifying line: the slab's label, or the block's stone. */
  note: string | null;
  href: string;
};

/** slab_requirements.status → what a person on the floor would call it. */
const SLAB_STAGE: Record<string, string> = {
  open: "Not cut yet",
  planned: "Planned for cutting",
  cutting: "On the cutter",
  cut_done: "Cut done",
  carving_assigned: "Carving · queued",
  carving_in_progress: "Carving · in progress",
  carving_on_hold: "Carving · on hold",
  carving_completed: "Carving done",
  completed: "Ready",
  dispatched: "Dispatched",
  cancelled: "Cancelled",
  rejected: "Rejected",
  carving_rejected: "Carving rejected",
};

export async function GET(req: Request) {
  const { profile } = await requireAuth();
  const dept = effectiveDepartment(profile.role, profile.active_department ?? null);
  const allowed =
    profile.role === "vendor" || (dept === "production" && PRODUCTION_ROLES.includes(profile.role));
  if (!allowed) return NextResponse.json({ hits: [], error: "not_allowed" }, { status: 403 });

  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  // Two characters is the floor — one letter matches half the yard and the
  // query stops being cheap.
  if (q.length < 2) return NextResponse.json({ hits: [], q });

  const admin = createAdminSupabaseClient();
  // PostgREST needs commas and parens escaped inside an or() filter.
  const safe = q.replace(/[,()*\\]/g, "");
  if (!safe) return NextResponse.json({ hits: [], q });

  const hits: QuickHit[] = [];

  // ── slabs ──────────────────────────────────────────────────────────────
  const { data: slabs } = await admin
    .from("slab_requirements")
    .select("id, temple, status, stock_location, label, is_parked")
    .ilike("id", `%${safe}%`)
    .order("id")
    .limit(MAX_ROWS);

  type SlabRow = {
    id: string; temple: string | null; status: string;
    stock_location: string | null; label: string | null; is_parked: boolean | null;
  };
  const slabRows = (slabs ?? []) as SlabRow[];

  // One extra query, only for the handful matched: a slab in carving sits with
  // a vendor, not in a yard, and "where" should say so.
  const carvingIds = slabRows
    .filter((s) => s.status.startsWith("carving"))
    .map((s) => s.id);
  const vendorBySlab = new Map<string, string>();
  if (carvingIds.length > 0) {
    const { data: items } = await admin
      .from("carving_items")
      .select("slab_requirement_id, vendor_name, location, loaded_at, unloaded_at")
      .in("slab_requirement_id", carvingIds)
      .order("assigned_at", { ascending: false });
    for (const it of (items ?? []) as Array<{
      slab_requirement_id: string; vendor_name: string | null; location: string | null;
      loaded_at: string | null; unloaded_at: string | null;
    }>) {
      if (vendorBySlab.has(it.slab_requirement_id)) continue; // newest wins
      const onMachine = it.loaded_at && !it.unloaded_at;
      const bits = [it.vendor_name, it.location].filter(Boolean).join(" · ");
      vendorBySlab.set(it.slab_requirement_id, onMachine ? `${bits || "vendor"} · on the machine` : bits);
    }
  }

  for (const s of slabRows) {
    const stage = SLAB_STAGE[s.status] ?? s.status.replace(/_/g, " ");
    const where =
      vendorBySlab.get(s.id) ||
      (s.is_parked ? `Main Storage${s.stock_location ? ` · ${s.stock_location}` : ""}` : s.stock_location) ||
      null;
    hits.push({
      kind: "slab",
      code: s.id,
      temple: s.temple,
      stage,
      where,
      note: s.label,
      href: `/slabs?q=${encodeURIComponent(s.id)}`,
    });
  }

  // ── blocks ─────────────────────────────────────────────────────────────
  if (hits.length < MAX_ROWS) {
    // A block's `id` IS its code (MT-B-1499-1); blocks carry no temple.
    const { data: blocks } = await admin
      .from("blocks")
      .select("id, stone, status, yard")
      .ilike("id", `%${safe}%`)
      .order("id")
      .limit(MAX_ROWS - hits.length);
    for (const b of (blocks ?? []) as Array<{
      id: string; stone: string | null; status: string | null; yard: number | string | null;
    }>) {
      hits.push({
        kind: "block",
        code: b.id,
        temple: null,
        stage: (b.status ?? "").replace(/_/g, " ") || "—",
        where: b.yard != null ? `Yard ${b.yard}` : null,
        note: b.stone,
        href: `/blocks?q=${encodeURIComponent(b.id)}`,
      });
    }
  }

  return NextResponse.json({ hits, q });
}
