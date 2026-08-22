/**
 * Quick search — the deliberately thin lookup behind the ⌘-palette.
 *
 * Find ID already answers "everything about this ID": journey, derived slabs,
 * machine labels, dimensions, dates. That is the right answer when you have
 * stopped to investigate, and it is why it takes a moment to load.
 *
 * This is the other question — the one asked mid-stride on the floor: WHERE is
 * it and WHAT STAGE is it at. Three small queries, capped rows, so the palette
 * can answer while you are still typing.
 *
 * It matches on more than the code, because on the floor people know a piece by
 * what it IS: the label (JALI), the category pair (MAIN TEMPLE / DOD BHUMIYA),
 * or the description. Any of those finds it.
 *
 * Production department only, and only the roles that get the palette
 * (QUICK_SEARCH_ROLES) — the UI gate and this one are the same list.
 */

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { effectiveDepartment } from "@/lib/departments";
import { canUseQuickSearch } from "@/lib/nav-registry";

export const dynamic = "force-dynamic";

/** The palette's own role list — narrowed Aug 2026 to the four people who
 *  actually move between screens. Kept in step with the UI deliberately: a
 *  route that answers for roles the palette is hidden from is a door nobody
 *  can see but anyone can knock on. */

/** Who may actually run directDispatchSlabsAction — its own requireAuth list.
 *  The palette is visible to MORE roles than this (team_head, crosscheck,
 *  dispatch), so the button has to be gated on the narrower set or those users
 *  would be offered an action that throws on click. */
const DISPATCH_ROLES = ["developer", "owner", "carving_head", "senior_incharge", "tender_manager"];

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
  /** Detail shown when a row is opened — no second request for it. */
  detail: {
    label: string | null;
    category1: string | null;
    category2: string | null;
    description: string | null;
    stone: string | null;
    dims: string | null;
    parked: boolean;
  } | null;
  /** Server's verdict on whether this slab may be sent straight to dispatch.
   *  Decided HERE, not in the UI: the action itself re-checks the same
   *  condition, so the button can never offer something the write refuses. */
  canReady: boolean;
  /** Why not, when canReady is false and the slab is otherwise a candidate. */
  readyBlockedBecause: string | null;
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
  // Both must hold: allowed to use the palette at all, AND in production —
  // the slab lookup is meaningless anywhere else.
  const allowed = canUseQuickSearch(profile.role) && dept === "production";
  if (!allowed) return NextResponse.json({ hits: [], error: "not_allowed" }, { status: 403 });

  const mayDispatch = DISPATCH_ROLES.includes(profile.role);

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
  // A code, a label, either category, or the description — whichever the
  // person happens to know. PostgREST or() takes a comma-separated list.
  const like = `%${safe}%`;
  const { data: slabs } = await admin
    .from("slab_requirements")
    .select(
      "id, temple, status, stock_location, label, is_parked, description, additional_description, component_section, component_element, stone, length_ft, width_ft, thickness_ft, cancel_requested_at",
    )
    .or(
      [
        `id.ilike.${like}`,
        `label.ilike.${like}`,
        `description.ilike.${like}`,
        `additional_description.ilike.${like}`,
        `component_section.ilike.${like}`,
        `component_element.ilike.${like}`,
      ].join(","),
    )
    .order("id")
    .limit(MAX_ROWS);

  type SlabRow = {
    id: string; temple: string | null; status: string;
    stock_location: string | null; label: string | null; is_parked: boolean | null;
    description: string | null; additional_description: string | null;
    component_section: string | null; component_element: string | null;
    stone: string | null;
    length_ft: number | string | null; width_ft: number | string | null; thickness_ft: number | string | null;
    cancel_requested_at: string | null;
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

  const dim = (v: unknown) => (Number(v) || 0);
  for (const s of slabRows) {
    const stage = SLAB_STAGE[s.status] ?? s.status.replace(/_/g, " ");
    const where =
      vendorBySlab.get(s.id) ||
      (s.is_parked ? `Main Storage${s.stock_location ? ` · ${s.stock_location}` : ""}` : s.stock_location) ||
      null;

    // Ready-to-dispatch is offered only where directDispatchSlabsAction would
    // actually succeed: it flips ONLY status='cut_done' with no pending cancel.
    // Anything in carving is therefore excluded by the status itself — the
    // guard is the same one the write uses, not a second opinion.
    const cancelPending = !!s.cancel_requested_at;
    const eligible = s.status === "cut_done" && !cancelPending;
    const canReady = eligible && mayDispatch;
    let blocked: string | null = null;
    if (!canReady) {
      if (eligible && !mayDispatch) blocked = "your role can't move slabs to dispatch";
      else if (s.status.startsWith("carving")) blocked = "assigned to carving";
      else if (s.status === "completed") blocked = "already ready";
      else if (s.status === "dispatched") blocked = "already dispatched";
      else if (cancelPending) blocked = "cancel requested";
      else if (s.status === "open" || s.status === "planned" || s.status === "cutting") blocked = "not cut yet";
    }

    const l = dim(s.length_ft), w = dim(s.width_ft), t = dim(s.thickness_ft);
    hits.push({
      kind: "slab",
      code: s.id,
      temple: s.temple,
      stage,
      where,
      note: s.label,
      href: `/slabs?q=${encodeURIComponent(s.id)}`,
      detail: {
        label: s.label,
        category1: s.component_section,
        category2: s.component_element,
        description: [s.description, s.additional_description].filter(Boolean).join(" · ") || null,
        stone: s.stone,
        dims: l > 0 && w > 0 && t > 0 ? `${l}×${w}×${t}″` : null,
        parked: !!s.is_parked,
      },
      canReady,
      readyBlockedBecause: blocked,
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
        detail: null,
        canReady: false,
        readyBlockedBecause: null,
      });
    }
  }

  return NextResponse.json({ hits, q });
}
