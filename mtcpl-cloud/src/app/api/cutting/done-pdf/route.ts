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
  let query = admin
    .from("cut_session_blocks")
    .select(
      "id, block_id, status, updated_at, cut_session_id, layout, operator_id, approved_by, approved_at, operators(name), cut_sessions(session_code, planned_by), cut_session_slabs(slab_requirement_id)",
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
    operators: { name: string } | { name: string }[] | null;
    cut_sessions:
      | { session_code: string; planned_by: string | null }
      | { session_code: string; planned_by: string | null }[]
      | null;
    cut_session_slabs: Array<{ slab_requirement_id: string }>;
  };
  const csbRows = (rows ?? []) as unknown as CsbRow[];

  // Fetch slab dimensions + temple via slab_requirements.id IN
  // (...).  cut_session_slabs has only IDs.
  const allSlabIds = [
    ...new Set(
      csbRows.flatMap((r) => r.cut_session_slabs.map((s) => s.slab_requirement_id)),
    ),
  ];
  let slabMap = new Map<
    string,
    { id: string; temple: string; length_ft: number; width_ft: number; thickness_ft: number; label: string | null }
  >();
  if (allSlabIds.length > 0) {
    const { data: slabs } = await admin
      .from("slab_requirements")
      .select("id, temple, length_ft, width_ft, thickness_ft, label")
      .in("id", allSlabIds);
    for (const s of (slabs ?? []) as Array<{
      id: string;
      temple: string | null;
      length_ft: number | string | null;
      width_ft: number | string | null;
      thickness_ft: number | string | null;
      label: string | null;
    }>) {
      slabMap.set(s.id, {
        id: s.id,
        temple: s.temple ?? "—",
        length_ft: Number(s.length_ft) || 0,
        width_ft: Number(s.width_ft) || 0,
        thickness_ft: Number(s.thickness_ft) || 0,
        label: s.label,
      });
    }
  }

  // For marble blocks we need tonnes from the parent blocks row.
  const blockIds = [...new Set(csbRows.map((r) => r.block_id))];
  let blockMeta = new Map<string, { tonnes: number | null; yard: number }>();
  if (blockIds.length > 0) {
    const { data: blocks } = await admin
      .from("blocks")
      .select("id, tonnes, yard")
      .in("id", blockIds);
    for (const b of (blocks ?? []) as Array<{ id: string; tonnes: number | string | null; yard: number }>) {
      blockMeta.set(b.id, {
        tonnes: b.tonnes != null ? Number(b.tonnes) : null,
        yard: b.yard,
      });
    }
  }

  const profilesMap = await getProfilesMap();

  const sections: DoneBlockSection[] = csbRows.map((r) => {
    const layout = r.layout;
    const blk = layout?.blk;
    const operatorRel = Array.isArray(r.operators) ? r.operators[0] : r.operators;
    const sessionRel = Array.isArray(r.cut_sessions) ? r.cut_sessions[0] : r.cut_sessions;
    const meta = blockMeta.get(r.block_id);

    return {
      cutSessionBlockId: r.id,
      blockCode: r.block_id,
      stone: blk?.stone ?? "—",
      yard: `Yard ${meta?.yard ?? blk?.yard ?? "—"}`,
      blockDims: fmtBlockDims(layout, meta?.tonnes ?? null),
      cutDate: fmtIstDateTime(r.updated_at),
      operator: operatorRel?.name ?? "—",
      planGenerator:
        sessionRel?.planned_by && profilesMap[sessionRel.planned_by]
          ? profilesMap[sessionRel.planned_by]!
          : "—",
      sessionCode: sessionRel?.session_code ?? "—",
      approvedBy:
        r.approved_by && profilesMap[r.approved_by]
          ? profilesMap[r.approved_by]!
          : "—",
      slabs: (layout?.placed ?? []).map((s) => {
        // Prefer slab_requirements lookup (canonical) — falls back to
        // layout placed if the requirement row was deleted.
        const sr = slabMap.get(s.id);
        const dims = sr
          ? `${sr.length_ft}×${sr.width_ft}×${sr.thickness_ft}″`
          : `${s.sw ?? "—"}×${s.sh ?? "—"}×${s.sd ?? "—"}″`;
        return {
          id: s.id,
          temple: sr?.temple ?? s.temple ?? "—",
          dims,
        };
      }),
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

  // pdf-lib returns a Uint8Array — wrap in a Blob-friendly ArrayBuffer.
  const body = new Uint8Array(pdfBytes).slice().buffer;
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
