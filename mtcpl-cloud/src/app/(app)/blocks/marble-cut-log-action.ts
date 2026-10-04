"use server";

// ──────────────────────────────────────────────────────────────────
// The Marble Cutting Log, fetched when somebody opens it
// ──────────────────────────────────────────────────────────────────
// It used to be computed on every /blocks render and shipped into the
// HTML: 640 consumed marble blocks with 4,238 slabs nested under them,
// the bulk of that page's 2 MB — for a modal that starts CLOSED and is
// only reachable on the marble tab.
//
// Daksh, Oct 2026: the people who switch between Blocks / Required
// Sizes / Plan Generator / Cutting all day complained these pages take
// too long. This is the single heaviest thing on the slowest of them,
// and nobody was looking at it.
//
// Same shape the page used to build, so the component is unchanged
// apart from asking for its data.
// ──────────────────────────────────────────────────────────────────

import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { fetchAllPaged, chunkIds } from "@/lib/paginate";

export type MarbleCutLogEntry = {
  id: string;
  stone: string;
  yard: number;
  length_ft: number | null;
  width_ft: number | null;
  height_ft: number | null;
  tonnes: number | null;
  truck_no: string | null;
  vendor_name: string | null;
  cut_at: string | null;
  cut_by_name: string | null;
  slabs: Array<{
    id: string;
    label: string | null;
    temple: string;
    length_ft: number;
    width_ft: number;
    thickness_ft: number;
    status: string;
  }>;
};

export async function fetchMarbleCutLogAction(): Promise<
  { ok: true; entries: MarbleCutLogEntry[] } | { ok: false; error: string }
> {
  try {
    const { profile } = await requireAuth();
    // Same audience the page gated the card behind.
    if (!["developer", "owner", "team_head", "senior_incharge"].includes(profile.role)) {
      return { ok: false, error: "Not allowed." };
    }

    const admin = createAdminSupabaseClient();

    // Marble stone names first, so the block query can filter in SQL
    // instead of pulling every consumed block and discarding 856 of them.
    const { data: stoneRows } = await admin
      .from("stone_types")
      .select("name, stone_category")
      .eq("stone_category", "marble");
    const marbleNames = (stoneRows ?? []).map((s) => (s as { name: string }).name);
    if (marbleNames.length === 0) return { ok: true, entries: [] };

    const blocks = await fetchAllPaged((from, to) =>
      admin
        .from("blocks")
        .select("id, stone, yard, length_ft, width_ft, height_ft, tonnes, truck_no, vendor_name, updated_at, updated_by")
        .eq("status", "consumed")
        .in("stone", marbleNames)
        .order("updated_at", { ascending: false })
        .order("id")
        .range(from, to),
    );
    if (blocks.length === 0) return { ok: true, entries: [] };

    type B = {
      id: string; stone: string | null; yard: number;
      length_ft: number | null; width_ft: number | null; height_ft: number | null;
      tonnes: number | string | null; truck_no: string | null; vendor_name: string | null;
      updated_at: string | null; updated_by: string | null;
    };
    const rows = blocks as B[];

    // Slabs for just these blocks. Chunked — a 640-id .in() list is a
    // long URL, and PostgREST caps each response at 1000 rows.
    const slabsByBlock = new Map<string, MarbleCutLogEntry["slabs"]>();
    for (const chunk of chunkIds(rows.map((b) => b.id), 400)) {
      const slabs = await fetchAllPaged((from, to) =>
        admin
          .from("slab_requirements")
          .select("id, label, temple, length_ft, width_ft, thickness_ft, status, source_block_id")
          .in("source_block_id", chunk)
          .order("id")
          .range(from, to),
      );
      for (const s of slabs as Array<{
        id: string; label: string | null; temple: string;
        length_ft: number; width_ft: number; thickness_ft: number;
        status: string; source_block_id: string | null;
      }>) {
        if (!s.source_block_id) continue;
        const arr = slabsByBlock.get(s.source_block_id) ?? [];
        arr.push({
          id: s.id, label: s.label, temple: s.temple,
          length_ft: Number(s.length_ft), width_ft: Number(s.width_ft),
          thickness_ft: Number(s.thickness_ft), status: s.status,
        });
        slabsByBlock.set(s.source_block_id, arr);
      }
    }

    // Who cut it — resolved once for the ids actually present.
    const actorIds = [...new Set(rows.map((b) => b.updated_by).filter(Boolean))] as string[];
    const nameById = new Map<string, string>();
    if (actorIds.length) {
      const { data: ps } = await admin.from("profiles").select("id, full_name").in("id", actorIds);
      for (const p of (ps ?? []) as Array<{ id: string; full_name: string | null }>) {
        nameById.set(p.id, p.full_name ?? "—");
      }
    }

    const entries: MarbleCutLogEntry[] = rows.map((b) => ({
      id: b.id,
      stone: b.stone ?? "Unknown",
      yard: b.yard,
      length_ft: b.length_ft,
      width_ft: b.width_ft,
      height_ft: b.height_ft,
      tonnes: b.tonnes != null ? Number(b.tonnes) : null,
      truck_no: b.truck_no,
      vendor_name: b.vendor_name,
      cut_at: b.updated_at,
      cut_by_name: b.updated_by ? nameById.get(b.updated_by) ?? null : null,
      slabs: slabsByBlock.get(b.id) ?? [],
    }));

    return { ok: true, entries };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
