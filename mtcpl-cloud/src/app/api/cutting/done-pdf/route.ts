// ──────────────────────────────────────────────────────────────────
// Cutting Done summary PDF — download route
// ──────────────────────────────────────────────────────────────────
//
// GET /api/cutting/done-pdf
//   • Default — today's done blocks (IST window).
//   • ?blocks=id1,id2 — specific cut_session_blocks ids
//     (overrides the today filter; used by the Select-by-Tick modal).
//
// Permission: anyone with cutting-page access (dev / owner / team_head
// / senior_incharge / carving_head / cutting_operator / crosscheck).
//
// Output: application/pdf with content-disposition:attachment so the
// browser triggers a download instead of opening inline.

import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getProfilesMap } from "@/lib/profiles";
import {
  generateCuttingDonePdf,
  type DoneBlockSection,
} from "@/lib/cutting-done-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Same role list /cutting page accepts.
const ALLOWED_ROLES = [
  "developer",
  "owner",
  "team_head",
  "senior_incharge",
  "carving_head",
  "crosscheck",
  "cutting_operator",
] as const;

// IST "today" window — matches the helper on the print page.
function istTodayBounds() {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const nowMs = Date.now();
  const todayIstMidnightMs =
    Math.floor((nowMs + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS;
  return {
    todayStartIso: new Date(todayIstMidnightMs).toISOString(),
    tomorrowStartIso: new Date(todayIstMidnightMs + DAY_MS).toISOString(),
  };
}

function fmtIstDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtBlockDims(layout: unknown, tonnes: number | null): string {
  const blk = (layout as { blk?: { l?: number; w?: number; h?: number } } | null)?.blk;
  if (tonnes && tonnes > 0) return `${tonnes.toFixed(3)} T`;
  if (blk && blk.l && blk.w && blk.h) {
    return `${blk.l}×${blk.w}×${blk.h}″`;
  }
  return "—";
}

export async function GET(req: NextRequest) {
  try {
    const { profile } = await requireAuth([...ALLOWED_ROLES]);
    const admin = createAdminSupabaseClient();

    const url = new URL(req.url);
    const blocksParam = url.searchParams.get("blocks") || "";
    const selectedIds = blocksParam
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const hasSelection = selectedIds.length > 0;

    // Pull cut_session_blocks with the same join shape the /cutting page
    // uses, so the data model is familiar. Marble blocks also need
    // tonnes from the parent block — fetch separately + merge.
    //
    // Daksh May 2026 round 3 (fix v2) — dropped operators(name) +
    // cut_sessions(session_code, planned_by) from the PostgREST select.
    // Production was returning 500 because the embedded-resource join
    // syntax requires PostgREST to detect the FK relationship by name;
    // when the relationship name is ambiguous (or RLS hides it) the
    // query fails with PGRST200. Replaced with explicit follow-up
    // queries against the operators + cut_sessions tables, keyed by
    // the IDs already on the row. Same data, no joinguard footgun.
    let query = admin
      .from("cut_session_blocks")
      .select(
        "id, block_id, status, updated_at, cut_session_id, layout, operator_id, approved_by, approved_at, cut_session_slabs(slab_requirement_id)",
      );

    if (hasSelection) {
      query = query.in("id", selectedIds);
    } else {
      const { todayStartIso, tomorrowStartIso } = istTodayBounds();
      query = query
        .eq("status", "done")
        .gte("updated_at", todayStartIso)
        .lt("updated_at", tomorrowStartIso);
    }

    const { data: rows, error } = await query.order("updated_at", {
      ascending: false,
    });
    if (error) {
      console.error("[done-pdf] cut_session_blocks fetch failed:", error);
      return new Response(`Failed to load: ${error.message}`, { status: 500 });
    }

    type CsbRow = {
      id: string;
      block_id: string;
      status: string;
      updated_at: string | null;
      cut_session_id: string;
      layout: {
        blk?: { id: string; stone: string; yard: number; l?: number; w?: number; h?: number };
        placed?: Array<{ id: string; label?: string; temple?: string; sw?: number; sh?: number; sd?: number }>;
      } | null;
      operator_id: string | null;
      approved_by: string | null;
      approved_at: string | null;
      cut_session_slabs: Array<{ slab_requirement_id: string }>;
    };
    const csbRows = (rows ?? []) as unknown as CsbRow[];

    // Follow-up lookups — fetched explicitly instead of via PostgREST
    // embedded resources. Smaller surface for "join failed" errors.
    const blockIds = [...new Set(csbRows.map((r) => r.block_id))];
    const operatorIds = [
      ...new Set(csbRows.map((r) => r.operator_id).filter((x): x is string => !!x)),
    ];
    const sessionIds = [
      ...new Set(csbRows.map((r) => r.cut_session_id).filter(Boolean)),
    ];

    // Daksh May 2026 round 4 — slabs fetched by source_block_id, NOT
    // by cut_session_slabs ids. The original cut_session_slabs list
    // only carries the PLANNED slabs from layout.placed, so the PDF
    // missed every manually-added "+ADDED" slab + every transferred
    // slab. MT-B-331 had 18 cut (6 planned + 12 added); the PDF
    // showed only the 6. Querying slab_requirements WHERE
    // source_block_id IN (...) AND status IN POST_CUT_STATUSES
    // captures every slab that physically came out of the block,
    // regardless of how it got linked.
    const [slabsRes, blocksRes, opsRes, sessionsRes] = await Promise.all([
      blockIds.length > 0
        ? admin
            .from("slab_requirements")
            .select(
              "id, temple, length_ft, width_ft, thickness_ft, label, description, source_block_id, status",
            )
            .in("source_block_id", blockIds)
            .in("status", [
              "cut_done",
              "carving_assigned",
              "carving_in_progress",
              "completed",
              "dispatched",
              "rejected",
            ])
        : Promise.resolve({ data: [], error: null }),
      blockIds.length > 0
        ? admin.from("blocks").select("id, tonnes, yard").in("id", blockIds)
        : Promise.resolve({ data: [], error: null }),
      operatorIds.length > 0
        ? admin.from("operators").select("id, name").in("id", operatorIds)
        : Promise.resolve({ data: [], error: null }),
      sessionIds.length > 0
        ? admin
            .from("cut_sessions")
            .select("id, session_code, planned_by")
            .in("id", sessionIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    // Group slabs by source_block_id so each section can pull its
    // own list. Same row keyed under both lookups so the per-id
    // map (used to enrich layout.placed display) still works as a
    // fallback for legacy paths.
    type SlabRow = {
      id: string;
      temple: string;
      length_ft: number;
      width_ft: number;
      thickness_ft: number;
      label: string | null;
      description: string | null;
    };
    const slabsByBlock = new Map<string, SlabRow[]>();
    const slabById = new Map<string, SlabRow>();
    for (const raw of (slabsRes.data ?? []) as Array<{
      id: string;
      temple: string | null;
      length_ft: number | string | null;
      width_ft: number | string | null;
      thickness_ft: number | string | null;
      label: string | null;
      description: string | null;
      source_block_id: string | null;
    }>) {
      const row: SlabRow = {
        id: raw.id,
        temple: raw.temple ?? "—",
        length_ft: Number(raw.length_ft) || 0,
        width_ft: Number(raw.width_ft) || 0,
        thickness_ft: Number(raw.thickness_ft) || 0,
        label: raw.label,
        description: raw.description,
      };
      slabById.set(raw.id, row);
      if (raw.source_block_id) {
        const list = slabsByBlock.get(raw.source_block_id) ?? [];
        list.push(row);
        slabsByBlock.set(raw.source_block_id, list);
      }
    }
    // Sort slabs inside each block by id (alphabetic = chronological
    // since the codes are auto-incremented) for a stable PDF order.
    for (const list of slabsByBlock.values()) {
      list.sort((a, b) => a.id.localeCompare(b.id));
    }

    const blockMeta = new Map<string, { tonnes: number | null; yard: number }>();
    for (const b of (blocksRes.data ?? []) as Array<{ id: string; tonnes: number | string | null; yard: number }>) {
      blockMeta.set(b.id, {
        tonnes: b.tonnes != null ? Number(b.tonnes) : null,
        yard: b.yard,
      });
    }

    const opMap = new Map<string, string>();
    for (const o of (opsRes.data ?? []) as Array<{ id: string; name: string | null }>) {
      if (o.name) opMap.set(o.id, o.name);
    }

    const sessionMap = new Map<
      string,
      { session_code: string; planned_by: string | null }
    >();
    for (const s of (sessionsRes.data ?? []) as Array<{
      id: string;
      session_code: string | null;
      planned_by: string | null;
    }>) {
      sessionMap.set(s.id, {
        session_code: s.session_code ?? "—",
        planned_by: s.planned_by,
      });
    }

    const profilesMap = await getProfilesMap();

    const sections: DoneBlockSection[] = csbRows.map((r) => {
      const layout = r.layout;
      const blk = layout?.blk;
      const meta = blockMeta.get(r.block_id);
      const session = sessionMap.get(r.cut_session_id);

      // Mig 077 follow-on (Daksh) — use source_block_id-keyed lookup
      // so manually-added "+ADDED" slabs + transferred slabs all
      // surface, not just the original layout.placed list.
      const actualSlabs = slabsByBlock.get(r.block_id) ?? [];

      return {
        cutSessionBlockId: r.id,
        blockCode: r.block_id,
        stone: blk?.stone ?? "—",
        yard: `Yard ${meta?.yard ?? blk?.yard ?? "—"}`,
        blockDims: fmtBlockDims(layout, meta?.tonnes ?? null),
        cutDate: fmtIstDateTime(r.updated_at),
        operator: (r.operator_id && opMap.get(r.operator_id)) || "—",
        planGenerator:
          session?.planned_by && profilesMap[session.planned_by]
            ? profilesMap[session.planned_by]!
            : "—",
        sessionCode: session?.session_code ?? "—",
        approvedBy:
          r.approved_by && profilesMap[r.approved_by]
            ? profilesMap[r.approved_by]!
            : "—",
        slabs: actualSlabs.map((s) => ({
          id: s.id,
          temple: s.temple,
          dims: `${s.length_ft}×${s.width_ft}×${s.thickness_ft}″`,
          label: s.label,
          description: s.description,
        })),
      };
    });

    const title = hasSelection
      ? `${sections.length} Selected Block${sections.length === 1 ? "" : "s"}`
      : "Done Today";
    const subtitle = hasSelection
      ? "Picked from the Cutting Done bucket"
      : new Date().toLocaleString("en-IN", {
          timeZone: "Asia/Kolkata",
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
        });
    const generatedAt = new Date().toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    const pdfBytes = await generateCuttingDonePdf({
      title,
      subtitle,
      generatedAt,
      generatedBy: profile.full_name ?? "—",
      blocks: sections,
    });

    // Filename — IST date + selection hint.
    const dateStamp = new Date()
      .toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })
      .replace(/-/g, "");
    const filename = hasSelection
      ? `cutting-done-selected-${dateStamp}.pdf`
      : `cutting-done-today-${dateStamp}.pdf`;

    // pdf-lib returns a Uint8Array — wrap as a Blob so the Node runtime
    // serialises it correctly into the Response body. Returning the
    // raw Uint8Array directly was a serialisation footgun in production.
    const blob = new Blob([new Uint8Array(pdfBytes)], { type: "application/pdf" });
    return new Response(blob, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    // Daksh: production was returning a bare HTTP 500 with no body
    // when the PostgREST embedded-resource join broke. Log + return
    // the error text so the next failure mode (if any) is obvious in
    // the browser tab + Vercel function logs.
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error("[done-pdf] threw:", msg, stack);
    return new Response(`PDF generation failed: ${msg}`, {
      status: 500,
      headers: { "Content-Type": "text/plain" },
    });
  }
}
