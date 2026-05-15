// Vercel function timeout for THIS page's server actions
// (finishBlockAction in particular). Default is 10s; the
// cutting-done flow can do 20+ Supabase round-trips when the
// operator picks many extras + transfers, which was hitting the
// default timeout mid-commit and leaving partial state. Pro plan
// supports up to 300s; 60s is plenty of headroom.
export const maxDuration = 60;

import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getProfilesMap } from "@/lib/profiles";
import { CuttingDetailPreview } from "../cutting-detail-preview";
import { FinishBlockForm } from "../finish-block-form";
import { RejectButton } from "../reject-button";
import { PrimarySlabPreview } from "../primary-slab-preview";
import { computeCutEfficiency, computeActualCutEfficiency, toCFT } from "@/lib/cut-efficiency";
import { POST_CUT_STATUSES } from "@/lib/slab-statuses";
import { EfficiencyBar } from "@/components/efficiency-bar";
import { yardLabel } from "@/lib/yards";
import {
  approveBlockAction,
  rejectBlockAction,
  startCuttingAction,
  finishBlockAction,
  acknowledgeReprintAction,
  approveCutFormAction,
  editPendingApprovalAction,
} from "../actions";
import { canApproveCuts, canTransferPlannedSlabs } from "@/lib/cutting-permissions";
import { NeedsReprintBanner } from "@/components/needs-reprint-banner";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ edit?: string }>;

type PlacedSlab = {
  id: string;
  label?: string;
  temple?: string;
  sw: number;
  sh: number;
  sd?: number;
  px?: number;
  py?: number;
  pw?: number;
  ph?: number;
  rot?: boolean;
  zTop?: number;
  zBot?: number;
};

const SLAB_COLORS = ["#D85A30","#378ADD","#1D9E75","#7F77DD","#BA7517","#639922","#D4537E","#E24B4A","#5F5E5A","#0F6E56"];
function slabColor(id: string) {
  const num = parseInt(String(id || "").replace(/\D/g, ""), 10);
  if (!num || Number.isNaN(num)) return SLAB_COLORS[0];
  return SLAB_COLORS[(num - 1) % SLAB_COLORS.length];
}

export default async function CuttingDetailPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { profile } = await requireAuth(["owner", "team_head", "cutting_operator"]);
  const { id } = await params;
  const sp = await searchParams;
  const wantsApprovalEdit = sp.edit === "approval";
  const supabase = createAdminSupabaseClient();

  const { data: block, error } = await supabase
    .from("cut_session_blocks")
    .select(
      "id, status, block_id, largest_remainder, restocked_block_id, layout, updated_at, cut_session_id, cutting_seq, needs_reprint, reprint_reason, pending_approval_payload, submitted_for_approval_at, submitted_for_approval_by, sent_back_at, sent_back_by, sent_back_note, approval_edited_at, approval_edited_by, cut_sessions(id, session_code, kerf_mm, created_at, planned_by), cut_session_slabs(id, slab_requirement_id, is_filler)"
    )
    .eq("id", id)
    .single();

  if (error || !block) notFound();

  const layout = block.layout as {
    blk?: { id: string; stone: string; yard: number; l: number; w: number; h: number };
    placed?: PlacedSlab[];
    biggest?: { l: number; w: number; h: number } | null;
  } | null;

  const blk = layout?.blk;
  const placed = layout?.placed ?? [];
  const blockStone = blk?.stone ?? null;
  // Type for slab rows used by both open and transferable lists
  type SlabRow = {
    id: string;
    label: string | null;
    temple: string | null;
    stone: string | null;
    quality: string | null;
    length_ft: number;
    width_ft: number;
    thickness_ft: number;
  };
  // Type for transferable slabs (carries donor block context)
  type TransferableSlab = SlabRow & {
    donor_session_block_id: string;
    donor_block_id: string;
    donor_status: string;
  };

  const [profilesMap, { data: stoneTypes }, { data: openSlabs }, transferableSlabs, { data: parentBlock }] = await Promise.all([
    getProfilesMap(),
    createAdminSupabaseClient().from("stone_types").select("id, name, color_top, color_front, color_side").order("name"),
    // Paginated fetch so the "Add unplanned slab" picker sees the
    // full open-slab pool. The previous single .select() was capped
    // at PostgREST's default 1000 rows — once a stone had >1000
    // open requirements, older slabs (e.g. MH-0015, MH-0035 family)
    // silently dropped off and operators reported "I can see it on
    // /slabs but not in the picker". Walks 1000-row pages up to
    // 50000 rows (way past any realistic backlog).
    blockStone
      ? (async () => {
          const PAGE = 1000;
          const all: SlabRow[] = [];
          for (let offset = 0; offset < 50000; offset += PAGE) {
            const { data, error: pageErr } = await supabase
              .from("slab_requirements")
              .select("id, label, temple, stone, quality, length_ft, width_ft, thickness_ft")
              .eq("status", "open")
              .eq("stone", blockStone)
              .order("created_at", { ascending: false })
              .range(offset, offset + PAGE - 1);
            if (pageErr) throw new Error(pageErr.message);
            if (!data || data.length === 0) break;
            all.push(...(data as SlabRow[]));
            if (data.length < PAGE) break;
          }
          return { data: all };
        })()
      : Promise.resolve({ data: [] as SlabRow[] }),
    // Candidate planned slabs from OTHER cutting blocks. Only fetched
    // for users with transfer permission (canTransferPlannedSlabs);
    // others get an empty list and never see the section. Donor must
    // be in pending_worker / pending_cut / cutting (not done/rejected).
    blockStone && canTransferPlannedSlabs(profile)
      ? (async () => {
          const { data: links } = await supabase
            .from("cut_session_slabs")
            .select(`
              slab_requirement_id,
              cut_session_block_id,
              block:cut_session_blocks!inner(id, status, block_id),
              slab:slab_requirements!inner(id, label, temple, stone, quality, length_ft, width_ft, thickness_ft, status)
            `)
            .eq("slab.status", "planned")
            .eq("slab.stone", blockStone)
            .in("block.status", ["pending_worker", "pending_cut", "cutting"])
            .neq("cut_session_block_id", id);
          // The PostgREST shape for joins can be either a single object
          // or an array — normalise.
          type LinkRow = {
            slab_requirement_id: string;
            cut_session_block_id: string;
            block: { id: string; status: string; block_id: string } | { id: string; status: string; block_id: string }[] | null;
            slab: SlabRow | SlabRow[] | null;
          };
          const out: TransferableSlab[] = [];
          for (const r of (links ?? []) as unknown as LinkRow[]) {
            const blk = Array.isArray(r.block) ? r.block[0] : r.block;
            const slab = Array.isArray(r.slab) ? r.slab[0] : r.slab;
            if (!blk || !slab) continue;
            out.push({
              ...slab,
              donor_session_block_id: r.cut_session_block_id,
              donor_block_id: blk.block_id,
              donor_status: blk.status,
            });
          }
          return out;
        })()
      : Promise.resolve([] as TransferableSlab[]),
    // Parent block's quality — used as the default Grade for any
    // remainder pieces the operator restocks during Cutting Done.
    // Most cuts inherit the parent grade; the operator only
    // overrides per-piece if the cut surface reveals the interior
    // is a different grade than the outside.
    supabase.from("blocks").select("quality").eq("id", block.block_id).maybeSingle(),
  ]);

  const session = block.cut_sessions as unknown as {
    id: string;
    session_code: string;
    kerf_mm: number;
    created_at: string;
    planned_by: string | null;
  } | null;
  const slabReqIds = (
    block.cut_session_slabs as Array<{ id: string; slab_requirement_id: string; is_filler?: boolean }>
  ).map((s) => s.slab_requirement_id);
  // Slabs flagged as "filler" / "extra" — added via Fit-to-Fill,
  // not part of the original demand. Surfaced to the preview
  // components so they render with a purple tint + EXTRA badge.
  const extraSlabIds = new Set(
    (block.cut_session_slabs as Array<{ slab_requirement_id: string; is_filler?: boolean }>)
      .filter((s) => s.is_filler)
      .map((s) => s.slab_requirement_id),
  );

  // Default Grade for new remainder rows in the Cutting-Done form.
  // Empty string = "Both" (no grade preference). Operator can
  // override per-piece if the interior reveals a different grade.
  const rawParentQuality = (parentBlock as { quality?: string | null } | null)?.quality;
  const parentQuality: "" | "A" | "B" =
    rawParentQuality === "A" || rawParentQuality === "B" ? rawParentQuality : "";

  const isPending = block.status === "pending_worker";
  const isWaiting = block.status === "pending_cut";
  const isCutting = block.status === "cutting" || block.status === "done_prompt";
  const isDone = block.status === "done";
  const isRejected = block.status === "rejected";
  // Migration 027 + 032 — approval-flow state.
  // Status is now always `awaiting_approval` while in audit. The
  // legacy `awaiting_cutter_edit` value is kept for backward compat
  // (any pre-migration row falls into this branch and is treated
  // identically to an "unlocked" awaiting_approval).
  const isAwaitingApproval = block.status === "awaiting_approval";
  const isLegacyCutterEdit = block.status === "awaiting_cutter_edit";
  const isInApprovalFlow = isAwaitingApproval || isLegacyCutterEdit;
  const cutterEditUnlocked =
    (block as { cutter_edit_unlocked?: boolean | null }).cutter_edit_unlocked === true ||
    isLegacyCutterEdit;
  const allowTransfer = canTransferPlannedSlabs(profile);
  const isApprover = canApproveCuts(profile);
  // Cutter ownership — submitted_for_approval_by is set when the
  // block enters the approval flow.
  const isOriginalSubmitter =
    (block as { submitted_for_approval_by?: string | null })
      .submitted_for_approval_by === profile.id;
  // Cutter can edit only when the auditor has unlocked the row.
  // Approver can edit any time.
  const canEditApprovalNow =
    isInApprovalFlow &&
    (isApprover ||
      (cutterEditUnlocked &&
        (isOriginalSubmitter ||
          profile.role === "team_head" ||
          profile.role === "cutting_operator")));
  // Resolve the staged payload safely — JSONB returned as `unknown`.
  type StagedPayload = {
    cut_slab_ids?: string[];
    not_cut_slab_ids?: string[];
    extra_slab_ids?: string[];
    transferred_slab_ids?: string[];
    remainders?: Array<{
      id?: string;
      l: number;
      w: number;
      h: number;
      quality?: "" | "A" | "B";
      yard?: number;
    }>;
    restock?: boolean;
    stock_location?: string | null;
    stone?: string;
    yard?: number;
  };
  const stagedPayload = (block as { pending_approval_payload?: StagedPayload | null })
    .pending_approval_payload ?? null;

  // Resolve the donor block_id for each transferred slab in the staged
  // payload. Daksh's ask: "in view and edit, show from which block the
  // transferred slab came." Edit mode already shows it via
  // extra-size-picker (each transferable carries donor_block_id). View
  // mode (this audit summary) needed its own lookup because the staged
  // payload only stores slab_requirement_ids.
  //
  // We may find multiple cut_session_slabs rows per slab id (e.g. a
  // stale row left on a finished donor block alongside a live row on
  // the actual donor). Priority order:
  //   1. The row earmarked specifically for THIS cut_session_block
  //      (pending_transfer_to_csb_id matches our id) — that's the
  //      explicit reservation from Migration 033.
  //   2. The row whose donor is in a non-terminal status — the live
  //      planned slab.
  //   3. Any row (last-resort fallback).
  type TransferDonor = { block_id: string; status: string };
  const transferDonorMap = new Map<string, TransferDonor>();
  const stagedTransferIds = stagedPayload?.transferred_slab_ids ?? [];
  if (stagedTransferIds.length > 0) {
    const { data: donorLinks } = await supabase
      .from("cut_session_slabs")
      .select(
        "slab_requirement_id, cut_session_block_id, pending_transfer_to_csb_id, cut_session_blocks!inner(id, block_id, status)",
      )
      .in("slab_requirement_id", stagedTransferIds)
      .neq("cut_session_block_id", id);
    type RawDonorRow = {
      slab_requirement_id: string;
      cut_session_block_id: string;
      pending_transfer_to_csb_id: string | null;
      cut_session_blocks:
        | { id: string; block_id: string; status: string }
        | { id: string; block_id: string; status: string }[]
        | null;
    };
    const rawRows = (donorLinks ?? []) as unknown as RawDonorRow[];
    for (const slabId of stagedTransferIds) {
      const candidates: Array<{
        block_id: string;
        status: string;
        earmarked: boolean;
      }> = [];
      for (const r of rawRows) {
        if (r.slab_requirement_id !== slabId) continue;
        const blk = Array.isArray(r.cut_session_blocks)
          ? r.cut_session_blocks[0] ?? null
          : r.cut_session_blocks;
        if (!blk) continue;
        candidates.push({
          block_id: blk.block_id,
          status: blk.status,
          earmarked: r.pending_transfer_to_csb_id === id,
        });
      }
      if (candidates.length === 0) continue;
      const TERMINAL = ["done", "rejected"];
      const pick =
        candidates.find((c) => c.earmarked) ??
        candidates.find((c) => !TERMINAL.includes(c.status)) ??
        candidates[0];
      transferDonorMap.set(slabId, {
        block_id: pick.block_id,
        status: pick.status,
      });
    }
  }

  // When the cut is already done, fetch the REAL post-cut data so the
  // utilisation bar reflects what actually happened instead of the
  // planner's projection. For pending/in-progress we stick with the
  // layout-based estimate — that's still the best guess until the cut
  // is finished.
  let actualSlabs: Array<{ sw: number; sh: number; sd: number }> | null = null;
  let actualRemainders: Array<{ id: string; l: number; w: number; h: number; status: string }> | null = null;
  if (isDone) {
    // Mirror the cutting list-page fix (Daksh, MT-B-246): slabs cut from
    // this block keep contributing to actual utilisation even after they
    // move on to carving / dispatch / get rejected. status='cut_done'
    // alone would shrink the utilisation bar artificially as downstream
    // work progressed. POST_CUT_STATUSES is the shared canonical set.
    const [{ data: cutDoneSlabs }, restockedList] = await Promise.all([
      supabase
        .from("slab_requirements")
        .select("id, length_ft, width_ft, thickness_ft")
        .eq("source_block_id", block.block_id)
        .in("status", POST_CUT_STATUSES),
      (async () => {
        const raw = block.restocked_block_id
          ? String(block.restocked_block_id).split(",").map((s: string) => s.trim()).filter(Boolean)
          : [];
        if (raw.length === 0) return [] as Array<{ id: string; l: number; w: number; h: number; status: string }>;
        const { data: rem } = await supabase
          .from("blocks")
          .select("id, length_ft, width_ft, height_ft, status")
          .in("id", raw);
        return (rem ?? []).map((b: { id: string; length_ft: number; width_ft: number; height_ft: number; status: string }) => ({
          id: b.id,
          l: Number(b.length_ft),
          w: Number(b.width_ft),
          h: Number(b.height_ft),
          status: b.status,
        }));
      })(),
    ]);
    actualSlabs = (cutDoneSlabs ?? []).map((s: { length_ft: number; width_ft: number; thickness_ft: number }) => ({
      sw: Number(s.length_ft),
      sh: Number(s.width_ft),
      sd: Number(s.thickness_ft),
    }));
    actualRemainders = restockedList;
  }

  return (
    <section className="page-card">
      {/* Breadcrumb. Approval-flow blocks send the back link to the
          approvals queue so the reviewer can keep moving through the
          list. Everything else returns to the appropriate cutting tab. */}
      <div style={{ marginBottom: 18 }}>
        <Link
          href={
            isInApprovalFlow
              ? "/cutting/approvals"
              : `/cutting?tab=${isCutting ? "in_progress" : isWaiting ? "waiting" : isDone ? "done" : isRejected ? "done" : "pending"}`
          }
          style={{ color: "var(--muted)", textDecoration: "none", fontSize: 13, fontWeight: 500 }}
        >
          ← Back to {isInApprovalFlow ? "Cutting Audit" : "Cutting"}
        </Link>
      </div>

      {/* Needs-reprint banner — appears when a slab was claimed away
       *  from this block's plan by another cutting block. Tells the
       *  operator to reprint before continuing. RealtimeRefresh keeps
       *  this banner in sync if a claim happens while the page is open. */}
      {block.needs_reprint && (
        <NeedsReprintBanner
          blockId={block.id}
          reason={block.reprint_reason ?? null}
          printHref={`/cutting/${block.id}/print`}
        />
      )}

      {/* Header */}
      <div className="record-head" style={{ marginBottom: 20 }}>
        <div>
          <h1
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              margin: 0,
            }}
          >
            {isCutting && <span className="live-dot" />}
            {isCutting
              ? "Slab Selection"
              : `Block ${block.block_id}`}
          </h1>
          <p className="muted" style={{ marginTop: 4 }}>
            {session?.session_code ?? "—"}
            {blk
              ? ` · ${blk.stone} · ${yardLabel(blk.yard)} · ${blk.l} × ${blk.w} × ${blk.h} in`
              : ""}
            {session?.kerf_mm ? ` · Kerf ${session.kerf_mm} mm` : ""}
          </p>
          {session?.planned_by && profilesMap[session.planned_by] && (
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--muted)" }}>
              Plan by{" "}
              <span style={{ color: "var(--gold-dark)", fontWeight: 600 }}>
                {profilesMap[session.planned_by]}
              </span>
            </p>
          )}
        </div>
        <div>
          {isPending && (
            <span className="role-pill badge-reserved">Pending Approval</span>
          )}
          {isCutting && (
            <span
              className="role-pill"
              style={{
                background: "#dcfce7",
                color: "#15803d",
                border: "1px solid #86efac",
              }}
            >
              ● Live Cutting
            </span>
          )}
          {isInApprovalFlow && (
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <span
                className="role-pill"
                style={{
                  background: "var(--gold)",
                  color: "#fff",
                  fontWeight: 700,
                }}
              >
                👀 Awaiting Audit
              </span>
              {cutterEditUnlocked && (
                <span
                  className="role-pill"
                  style={{
                    background: "#16a34a",
                    color: "#fff",
                    fontWeight: 700,
                  }}
                >
                  🔓 Cutter can edit
                </span>
              )}
            </div>
          )}
          {isDone && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span className="role-pill badge-available">✓ Done</span>
              <Link
                href={`/cutting/${block.id}/labels`}
                target="_blank"
                rel="noreferrer"
                className="primary-button"
                style={{
                  fontSize: 13,
                  padding: "8px 16px",
                  fontWeight: 700,
                  textDecoration: "none",
                  whiteSpace: "nowrap",
                }}
                title="Print a sheet with every slab's ID + dimensions + stock location — the cutter writes the IDs onto the physical slabs"
              >
                🖨 Print slab labels
              </Link>
            </div>
          )}
          {isRejected && (
            <span className="role-pill badge-discarded">Rejected</span>
          )}
        </div>
      </div>

      {/* 3D preview + slab chip list (cross-highlighted on hover) */}
      {blk && placed.length > 0 && (
        <CuttingDetailPreview
          blk={blk}
          placed={placed as any}
          stoneTypes={stoneTypes ?? undefined}
          extraSlabIds={extraSlabIds}
        />
      )}

      {/* Block efficiency breakdown — REAL post-cut numbers when status=done,
          planner's projection otherwise. */}
      {(() => {
        const useActual = isDone && actualSlabs && actualSlabs.length > 0;
        const eff = useActual
          ? computeActualCutEfficiency(blk, actualSlabs ?? [], actualRemainders ?? [])
          : computeCutEfficiency(blk, placed, layout?.biggest ?? null);
        if (!eff) return null;
        return (
          <div style={{
            margin: "0 0 18px",
            padding: "14px 16px",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 8,
          }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
              <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Block Utilisation
                <span style={{
                  marginLeft: 8,
                  fontSize: 10,
                  fontWeight: 600,
                  color: useActual ? "#15803d" : "var(--muted)",
                  background: useActual ? "rgba(22,101,52,0.12)" : "transparent",
                  padding: useActual ? "1px 7px" : 0,
                  borderRadius: 4,
                  letterSpacing: 0,
                  textTransform: "none",
                }}>
                  {useActual ? "✓ Actual" : "Projected"}
                </span>
              </p>
              <p className="muted" style={{ margin: 0, fontSize: 11, fontFamily: "ui-monospace, monospace" }}>
                Total {toCFT(eff.blockVol).toFixed(2)} CFT
                {useActual
                  ? ` · ${actualRemainders?.length ?? 0} remainder piece${(actualRemainders?.length ?? 0) === 1 ? "" : "s"} recovered`
                  : layout?.biggest ? " · restockable piece counted as recovered, not waste" : ""}
              </p>
            </div>
            <EfficiencyBar eff={eff} />
          </div>
        );
      })()}

      {/* Info cards row */}
      <div
        style={{
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 20,
        }}
      >
        {session?.kerf_mm && (
          <div
            style={{
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "8px 14px",
            }}
          >
            <p
              style={{
                margin: 0,
                fontSize: 10,
                color: "var(--muted)",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              Kerf
            </p>
            <p style={{ margin: "3px 0 0", fontSize: 15, fontWeight: 700 }}>
              {session.kerf_mm} mm
            </p>
          </div>
        )}
        {layout?.biggest && (
          <div
            style={{
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "8px 14px",
            }}
          >
            <p
              style={{
                margin: 0,
                fontSize: 10,
                color: "var(--muted)",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              Planned Largest Remainder
            </p>
            <p style={{ margin: "3px 0 0", fontSize: 15, fontWeight: 700 }}>
              {layout.biggest.l} × {layout.biggest.w} × {layout.biggest.h} in
            </p>
          </div>
        )}
        <div
          style={{
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "8px 14px",
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: 10,
              color: "var(--muted)",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            Slabs Planned
          </p>
          <p style={{ margin: "3px 0 0", fontSize: 15, fontWeight: 700 }}>
            {placed.length}
          </p>
        </div>
      </div>

      {/* Slab chips now rendered inside CuttingDetailPreview above */}

      {/* ── Primary Slab Views ── */}
      {blk && placed.length > 0 && (() => {
        const slabsWithPos = placed.filter(s => s.px != null && s.pw != null);
        if (slabsWithPos.length === 0) return null;
        const map = new Map<string, { zBot: number; zTop: number; slabs: PlacedSlab[] }>();
        for (const s of slabsWithPos) {
          const zTop = s.zTop ?? blk.h;
          const zBot = s.zBot ?? 0;
          const key = `${zBot.toFixed(2)}_${zTop.toFixed(2)}`;
          if (!map.has(key)) map.set(key, { zBot, zTop, slabs: [] });
          map.get(key)!.slabs.push(s);
        }
        const layers = [...map.values()].sort((a, b) => b.zTop - a.zTop);
        // Small top-down SVG dimensions
        const PL = 16; const PT = 12; const PR = 8; const PB = 8;
        const sc = Math.min(200 / Math.max(blk.l, 1), 140 / Math.max(blk.w, 1), 5);
        const svgW = PL + blk.l * sc + PR;
        const svgH = PT + blk.w * sc + PB;
        return (
          <div style={{ marginBottom: 20 }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>
              Primary Slab Views — {layers.length} {layers.length === 1 ? "slab" : "slabs"}{layers.length > 1 ? " (cut top → bottom)" : ""}
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {layers.map((layer, li) => {
                const thicknessNum = layer.zTop - layer.zBot;
                const thickness = thicknessNum.toFixed(1);
                // Build slabs scoped to this primary slab (z rebased to 0–thickness)
                const slabsForIso = layer.slabs.map(s => ({
                  id: s.id,
                  label: s.label,
                  temple: s.temple,
                  sw: s.sw,
                  sh: s.sh,
                  sd: s.sd,
                  px: s.px ?? 0,
                  py: s.py ?? 0,
                  pw: s.pw ?? 0,
                  ph: s.ph ?? 0,
                  rot: s.rot,
                  zBot: 0,
                  zTop: thicknessNum,
                }));
                return (
                  <div key={li} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px", background: "var(--bg)" }}>
                    {/* Header */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
                      <div>
                        <span style={{ fontWeight: 700, fontSize: 13 }}>Primary Slab {li + 1}</span>
                        <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: 10, fontFamily: "ui-monospace, monospace" }}>
                          {blk.l}″ × {blk.w}″ × {thickness}″ thick
                        </span>
                        {layers.length > 1 && (
                          <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: 8 }}>
                            · depth {layer.zBot.toFixed(1)}″–{layer.zTop.toFixed(1)}″
                          </span>
                        )}
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {layer.slabs.map(s => (
                          <span key={s.id} style={{
                            fontSize: 10, padding: "2px 7px", borderRadius: 3,
                            background: slabColor(s.id) + "28", border: `1px solid ${slabColor(s.id)}55`,
                            fontFamily: "ui-monospace, monospace", fontWeight: 700
                          }}>{s.id}</span>
                        ))}
                      </div>
                    </div>
                    {/* 3D Iso (big) + 2D top-down (small) side by side */}
                    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 220px", gap: 14, alignItems: "center" }}>
                      {/* 3D Isometric — rotatable */}
                      <div>
                        <PrimarySlabPreview
                          block={{ l: blk.l, w: blk.w, h: thicknessNum, stone: blk.stone }}
                          placed={slabsForIso}
                          stoneTypes={stoneTypes ?? undefined}
                        />
                        <div style={{ fontSize: 9, color: "var(--muted)", textAlign: "center", marginTop: 4, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700 }}>
                          3D Isometric · drag to rotate
                        </div>
                      </div>
                      {/* 2D Top-down (small reference) */}
                      <div>
                        <svg viewBox={`0 0 ${svgW.toFixed(1)} ${svgH.toFixed(1)}`} style={{ width: "100%", display: "block" }} xmlns="http://www.w3.org/2000/svg">
                          <rect x={PL} y={PT} width={blk.l * sc} height={blk.w * sc}
                            fill="var(--surface-alt,#f5f5f0)" stroke="#aaa" strokeWidth="0.7" strokeDasharray="3 2" />
                          <text x={PL + (blk.l * sc) / 2} y={PT - 3} textAnchor="middle" fill="#888" fontSize={5} fontFamily="ui-monospace,monospace">{blk.l}&quot;</text>
                          <text x={PL - 3} y={PT + (blk.w * sc) / 2} textAnchor="middle" dominantBaseline="middle" fill="#888" fontSize={5} fontFamily="ui-monospace,monospace"
                            transform={`rotate(-90,${PL - 3},${PT + (blk.w * sc) / 2})`}>{blk.w}&quot;</text>
                          {slabsWithPos.map(s => {
                            const inLayer = layer.slabs.some(ls => ls.id === s.id);
                            const col = slabColor(s.id);
                            const x = PL + (s.px ?? 0) * sc;
                            const y = PT + (s.py ?? 0) * sc;
                            const w = (s.pw ?? 0) * sc;
                            const h = (s.ph ?? 0) * sc;
                            return (
                              <rect key={s.id} x={x} y={y} width={w} height={h}
                                fill={col} fillOpacity={inLayer ? 0.5 : 0.08}
                                stroke={col} strokeWidth={inLayer ? "0.8" : "0.3"} strokeOpacity={inLayer ? 1 : 0.3} />
                            );
                          })}
                        </svg>
                        <div style={{ fontSize: 9, color: "var(--muted)", textAlign: "center", marginTop: 4, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700 }}>
                          Top-down
                        </div>
                      </div>
                    </div>
                    {/* Slab list */}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 10, paddingTop: 8, borderTop: "1px solid var(--border)" }}>
                      {layer.slabs.map(s => (
                        <span key={s.id} style={{ fontSize: 11, fontFamily: "ui-monospace, monospace" }}>
                          <span style={{ fontWeight: 700 }}>{s.id}</span>
                          <span style={{ color: "var(--muted)", marginLeft: 4 }}>({s.sw}×{s.sh}″{s.temple ? ` · ${s.temple}` : ""})</span>
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── PENDING: Approve / Reject ── */}
      {isPending && (
        <div
          style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            paddingTop: 8,
          }}
        >
          <form action={approveBlockAction}>
            <input
              type="hidden"
              name="session_block_id"
              value={block.id}
            />
            <input
              type="hidden"
              name="session_id"
              value={block.cut_session_id}
            />
            <button className="primary-button" type="submit">
              Send to Cutting List →
            </button>
          </form>
          <form action={rejectBlockAction}>
            <input
              type="hidden"
              name="session_block_id"
              value={block.id}
            />
            <input
              type="hidden"
              name="session_id"
              value={block.cut_session_id}
            />
            <input type="hidden" name="block_id" value={block.block_id} />
            <input
              type="hidden"
              name="slab_ids"
              value={JSON.stringify(slabReqIds)}
            />
            <RejectButton />
          </form>
        </div>
      )}

      {/* ── WAITING TO CUT: Start Cutting / Cancel ── */}
      {isWaiting && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", paddingTop: 8 }}>
          <form action={startCuttingAction}>
            <input type="hidden" name="session_block_id" value={block.id} />
            <input type="hidden" name="session_id" value={block.cut_session_id} />
            <button className="primary-button" type="submit">
              ▶ Start Cutting
            </button>
          </form>
        </div>
      )}

      {/* ── IN PROGRESS: Slab selection form ── */}
      {isCutting && (
        <>
          <div
            style={{
              margin: "0 0 18px",
              padding: "12px 16px",
              background: "#f0fdf4",
              border: "1px solid #86efac",
              borderRadius: 8,
            }}
          >
            <p
              style={{
                margin: 0,
                fontSize: 13,
                color: "#15803d",
                fontWeight: 600,
              }}
            >
              🔪 Cutting done — select which slabs were actually cut, then record any leftover block pieces below.
              If no remainder pieces are entered (or left at 0), the block will be discarded.
            </p>
          </div>
          <FinishBlockForm
            sessionBlockId={block.id}
            sessionId={block.cut_session_id}
            blockId={block.block_id}
            stone={blk?.stone ?? "PinkStone"}
            yard={blk?.yard ?? 1}
            allSlabs={placed.map((s) => ({
              id: s.id,
              label: s.label,
              temple: s.temple,
              sw: s.sw,
              sh: s.sh,
            }))}
            openSlabs={(openSlabs ?? []).filter(s => !placed.some(p => p.id === s.id))}
            transferableSlabs={transferableSlabs}
            allowTransfer={allowTransfer}
            parentQuality={parentQuality}
            finishAction={finishBlockAction}
          />
        </>
      )}

      {/* ── AWAITING APPROVAL / AWAITING CUTTER EDIT (migration 027) ──
          The cutter's submission is staged in pending_approval_payload.
          Until approval (or send-back-and-resubmit cycle), no slab or
          donor mutations have happened — the cutter's mistakes here
          are fully reversible.
          The surface adapts to:
            - URL flag `?edit=approval` → show FinishBlockForm pre-filled
              for editing the staged payload.
            - Otherwise → show banner + inline buttons (Approve / Edit /
              Send back) gated by role. */}
      {isInApprovalFlow && (() => {
        const stagedSubmittedAt = (block as { submitted_for_approval_at?: string | null })
          .submitted_for_approval_at ?? null;
        const stagedSubmittedBy = (block as { submitted_for_approval_by?: string | null })
          .submitted_for_approval_by ?? null;
        const stagedSentBackAt = (block as { sent_back_at?: string | null })
          .sent_back_at ?? null;
        const stagedSentBackBy = (block as { sent_back_by?: string | null })
          .sent_back_by ?? null;
        const stagedSentBackNote = (block as { sent_back_note?: string | null })
          .sent_back_note ?? null;

        // When the user navigates here with ?edit=approval AND they're
        // authorised to edit, render the FinishBlockForm pre-filled
        // from the staged payload. The form posts to
        // editPendingApprovalAction which updates the JSONB (+ flips
        // status if the cutter resubmits).
        if (wantsApprovalEdit && canEditApprovalNow && stagedPayload) {
          return (
            <>
              <div
                style={{
                  margin: "0 0 18px",
                  padding: "12px 16px",
                  background: "rgba(232,197,114,0.18)",
                  border: "1.5px solid var(--gold)",
                  borderRadius: 8,
                }}
              >
                <p style={{ margin: 0, fontSize: 13, color: "var(--gold-dark)", fontWeight: 700 }}>
                  ✏ Editing pending approval
                </p>
                <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
                  {isApprover
                    ? "Fix any details and press Save. The block stays in the audit queue — press Approve there once you're happy."
                    : cutterEditUnlocked
                      ? "Auditor unlocked this for you to edit. Apply the requested changes and save — your save re-locks the row so the auditor re-reviews."
                      : "Editing staged Cutting-Done payload."}
                </p>
              </div>
              <FinishBlockForm
                sessionBlockId={block.id}
                sessionId={block.cut_session_id}
                blockId={block.block_id}
                stone={blk?.stone ?? "PinkStone"}
                yard={blk?.yard ?? 1}
                allSlabs={placed.map((s) => ({
                  id: s.id,
                  label: s.label,
                  temple: s.temple,
                  sw: s.sw,
                  sh: s.sh,
                }))}
                openSlabs={(openSlabs ?? []).filter((s) => !placed.some((p) => p.id === s.id))}
                transferableSlabs={transferableSlabs}
                allowTransfer={allowTransfer}
                parentQuality={parentQuality}
                finishAction={editPendingApprovalAction}
                initialPayload={{
                  cut_slab_ids: stagedPayload.cut_slab_ids ?? [],
                  extra_slab_ids: stagedPayload.extra_slab_ids ?? [],
                  transferred_slab_ids: stagedPayload.transferred_slab_ids ?? [],
                  remainders: (stagedPayload.remainders ?? []).map((r) => ({
                    l: Number(r.l),
                    w: Number(r.w),
                    h: Number(r.h),
                    quality: r.quality,
                    yard: r.yard,
                  })),
                  stock_location: stagedPayload.stock_location ?? null,
                  restock: stagedPayload.restock ?? false,
                }}
                editMode
                redirectTo="/cutting/approvals"
                submitLabelOverride="Save changes"
              />
            </>
          );
        }

        // Non-edit mode → banner + submission summary + buttons.
        const allSlabsById = new Map(
          placed.map((s) => [s.id, s] as const),
        );
        const cutIds = stagedPayload?.cut_slab_ids ?? [];
        const notCutIds = stagedPayload?.not_cut_slab_ids ?? [];
        const extraIds = stagedPayload?.extra_slab_ids ?? [];
        const transferIds = stagedPayload?.transferred_slab_ids ?? [];
        const remainders = stagedPayload?.remainders ?? [];
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Status banner */}
            <div
              style={{
                padding: "14px 16px",
                background: cutterEditUnlocked
                  ? "rgba(34, 197, 94, 0.10)"
                  : "rgba(232,197,114,0.14)",
                border: `1.5px solid ${cutterEditUnlocked ? "rgba(22, 163, 74, 0.45)" : "var(--gold)"}`,
                borderLeft: `5px solid ${cutterEditUnlocked ? "#16a34a" : "var(--gold-dark)"}`,
                borderRadius: 8,
              }}
            >
              <p
                style={{
                  margin: 0,
                  fontWeight: 700,
                  color: cutterEditUnlocked ? "#15803d" : "var(--gold-dark)",
                  fontSize: 14,
                }}
              >
                {cutterEditUnlocked
                  ? "🔓 Awaiting audit · cutter can edit"
                  : "👀 Awaiting audit"}
              </p>
              <p style={{ margin: "5px 0 0", fontSize: 12, color: "var(--muted)" }}>
                {cutterEditUnlocked
                  ? "Auditor has unlocked editing for the cutter. Status stays awaiting audit — once cutter saves, the unlock auto-clears and the auditor re-reviews."
                  : "Cutter has submitted the Cutting Done form. No slab or donor mutations have happened yet — they fire on approve."}
              </p>
              {stagedSubmittedAt && (
                <p style={{ margin: "8px 0 0", fontSize: 11, color: "var(--muted)" }}>
                  Submitted{" "}
                  {new Date(stagedSubmittedAt).toLocaleString("en-IN", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  {stagedSubmittedBy && profilesMap[stagedSubmittedBy] && (
                    <>
                      {" "}by{" "}
                      <span style={{ color: "var(--gold-dark)", fontWeight: 600 }}>
                        {profilesMap[stagedSubmittedBy]}
                      </span>
                    </>
                  )}
                </p>
              )}
              {cutterEditUnlocked && stagedSentBackNote && (
                <div
                  style={{
                    marginTop: 10,
                    padding: "10px 12px",
                    background: "rgba(255,255,255,0.5)",
                    border: "1px solid rgba(22, 163, 74, 0.35)",
                    borderRadius: 6,
                  }}
                >
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: "#15803d",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      marginBottom: 4,
                    }}
                  >
                    🔓 Auditor note · cutter can edit
                    {stagedSentBackBy && profilesMap[stagedSentBackBy]
                      ? ` · from ${profilesMap[stagedSentBackBy]}`
                      : ""}
                    {stagedSentBackAt && (
                      <span style={{ color: "var(--muted)", marginLeft: 6 }}>
                        ·{" "}
                        {new Date(stagedSentBackAt).toLocaleString("en-IN", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    )}
                  </div>
                  <p style={{ margin: 0, fontSize: 13, color: "var(--text)", lineHeight: 1.5 }}>
                    {stagedSentBackNote}
                  </p>
                </div>
              )}
            </div>

            {/* SUBMISSION SUMMARY — what the cutter staged.
                Shown to everyone with view access to the block so the
                auditor can see, at a glance, exactly which slabs were
                marked cut vs not, what extras were added, etc.
                Fixes the "View doesn't show selected slabs" issue. */}
            {stagedPayload && (
              <div
                style={{
                  padding: "14px 16px",
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "var(--muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    marginBottom: 12,
                  }}
                >
                  📝 Pending submission · what's been staged
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 12 }}>
                  <SummaryStat label="Cut" count={cutIds.length} color="#15803d" />
                  <SummaryStat label="Not cut" count={notCutIds.length} color="#b91c1c" />
                  <SummaryStat label="From inventory" count={extraIds.length} color="#b45309" />
                  <SummaryStat label="Transferred" count={transferIds.length} color="#7c3aed" />
                  <SummaryStat label="Remainder pieces" count={remainders.length} color="#0f766e" />
                </div>

                {/* Cut slabs */}
                {cutIds.length > 0 && (
                  <SlabIdList
                    label="✂️ Marked cut"
                    color="#15803d"
                    ids={cutIds}
                    allSlabsById={allSlabsById}
                  />
                )}
                {/* Not cut */}
                {notCutIds.length > 0 && (
                  <SlabIdList
                    label="◌ Not cut (returns to Open)"
                    color="#b91c1c"
                    ids={notCutIds}
                    allSlabsById={allSlabsById}
                  />
                )}
                {/* Extras */}
                {extraIds.length > 0 && (
                  <SlabIdList
                    label="📦 From open inventory"
                    color="#b45309"
                    ids={extraIds}
                  />
                )}
                {/* Transfers */}
                {transferIds.length > 0 && (
                  <SlabIdList
                    label="↔ Transferred from another block"
                    color="#7c3aed"
                    ids={transferIds}
                    donorMap={transferDonorMap}
                  />
                )}
                {/* Remainders */}
                {remainders.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: "#0f766e",
                        marginBottom: 6,
                      }}
                    >
                      ♻ Restocked remainder pieces ({remainders.length})
                    </div>
                    <div className="chip-row" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {remainders.map((r, i) => (
                        <span
                          key={i}
                          className="plan-chip"
                          style={{
                            background: "rgba(15, 118, 110, 0.10)",
                            border: "1px solid rgba(15, 118, 110, 0.30)",
                            fontFamily: "ui-monospace, monospace",
                            fontSize: 11,
                          }}
                        >
                          {r.l}×{r.w}×{r.h}″
                          {r.quality ? ` · ${r.quality}` : ""}
                          {r.yard ? ` · Yard ${r.yard}` : ""}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Stock location */}
                <div
                  style={{
                    marginTop: 14,
                    padding: "10px 12px",
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    flexWrap: "wrap",
                  }}
                >
                  <span style={{ fontSize: 14 }}>📍</span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "var(--muted)",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    Stock location
                  </span>
                  <strong style={{ fontSize: 13, color: "var(--text)" }}>
                    {stagedPayload.stock_location ?? "—"}
                  </strong>
                  {stagedPayload.restock && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: "#0f766e",
                        background: "rgba(15,118,110,0.14)",
                        padding: "2px 8px",
                        borderRadius: 999,
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                      }}
                    >
                      ♻ Restock
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Per-role actions. Send-back (now "unlock") happens on
                the audit-queue page where the note textarea lives.
                On this detail page we keep it simple — Approve + Edit
                + jump to the queue for the unlock conversation. */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              {isApprover && (
                <>
                  <form action={approveCutFormAction}>
                    <input type="hidden" name="session_block_id" value={block.id} />
                    <button className="primary-button" type="submit">
                      ✓ Approve
                    </button>
                  </form>
                  <Link
                    href={`/cutting/${block.id}?edit=approval`}
                    style={{
                      textDecoration: "none",
                      fontSize: 13,
                      padding: "8px 16px",
                      background: "var(--bg)",
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      color: "var(--text)",
                      fontWeight: 600,
                    }}
                  >
                    ✏ Edit
                  </Link>
                  <Link
                    href="/cutting/approvals"
                    style={{
                      textDecoration: "none",
                      fontSize: 13,
                      padding: "8px 16px",
                      background: "var(--bg)",
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      color: cutterEditUnlocked ? "#b45309" : "#15803d",
                      fontWeight: 600,
                    }}
                    title={
                      cutterEditUnlocked
                        ? "Open audit queue to lock the cutter edit back"
                        : "Open audit queue to allow the cutter to edit this block"
                    }
                  >
                    {cutterEditUnlocked
                      ? "🔒 Lock cutter edit (in queue)"
                      : "🔓 Allow cutter edit (in queue)"}
                  </Link>
                </>
              )}
              {!isApprover && cutterEditUnlocked && canEditApprovalNow && (
                <Link
                  href={`/cutting/${block.id}?edit=approval`}
                  className="primary-button"
                  style={{ textDecoration: "none", padding: "8px 16px", fontWeight: 700 }}
                >
                  ✏ Edit submission
                </Link>
              )}
              {!isApprover && !cutterEditUnlocked && (
                <span
                  className="muted"
                  style={{
                    fontSize: 12,
                    padding: "8px 14px",
                    border: "1px dashed var(--border)",
                    borderRadius: 6,
                  }}
                >
                  Waiting for auditor review. You'll see an Edit button if
                  they unlock editing for you.
                </span>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── DONE: Summary + optional undo ── */}
      {isDone && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div
            style={{
              padding: 16,
              background: "#f0fdf4",
              border: "1px solid #86efac",
              borderRadius: 8,
            }}
          >
            <p style={{ margin: 0, fontWeight: 700, color: "#15803d" }}>
              ✓ Cut completed
            </p>
            {block.restocked_block_id ? (
              <p className="muted" style={{ margin: "4px 0 0" }}>
                Restocked blocks:{" "}
                {block.restocked_block_id
                  .split(",")
                  .map((s: string) => s.trim())
                  .join(", ")}
              </p>
            ) : (
              <p className="muted" style={{ margin: "4px 0 0" }}>
                Block discarded — no remainder pieces entered.
              </p>
            )}
            {block.updated_at && (
              <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
                Completed:{" "}
                {new Date(block.updated_at).toLocaleDateString("en-IN", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </p>
            )}
          </div>
          {/* The "↩ Undo cut" button used to live here. Removed after
              the cut-approval workflow (migration 027) shipped — every
              cut now passes through an auditor who can Send back for
              edit, Allow cutter to edit, or Reject before the cut
              commits. Once approved, the cut is final.

              History: the Undo path bypassed the RPC's careful
              donor-block mutations and only reverted slabs from
              layout.placed[], leaving orphaned cut_done slabs whenever
              extras or transfers were involved. Multiple stuck-block
              incidents (MT-B-109, MT-B-113, MT-B-248) traced back here.
              Pre-commit guard rails make this rear-end escape hatch
              unnecessary. */}
        </div>
      )}

      {/* ── REJECTED ── */}
      {isRejected && (
        <div
          style={{
            padding: 16,
            background: "#fef2f2",
            border: "1px solid #fca5a5",
            borderRadius: 8,
          }}
        >
          <p style={{ margin: 0, fontWeight: 700, color: "#dc2626" }}>
            Block rejected
          </p>
          <p className="muted" style={{ margin: "4px 0 0" }}>
            This block was returned to inventory and its slabs are back to open
            status.
          </p>
        </div>
      )}
    </section>
  );
}

/** Compact stat tile for the Submission Summary block on the cutting
 *  detail page. Surfaces the per-bucket counts (Cut / Not cut / Extras
 *  / Transferred / Remainders) so the auditor reads them at a glance. */
function SummaryStat({
  label,
  count,
  color,
}: {
  label: string;
  count: number;
  color: string;
}) {
  return (
    <div
      style={{
        padding: "10px 12px",
        background: `${color}11`,
        border: `1px solid ${color}33`,
        borderRadius: 6,
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 800,
          color,
          letterSpacing: "-0.02em",
          marginTop: 2,
          fontFamily: "ui-monospace, monospace",
        }}
      >
        {count}
      </div>
    </div>
  );
}

/** Render a labelled chip-row of slab IDs. When `allSlabsById` is
 *  provided we also surface the slab's planned size + temple inline,
 *  which is useful for the Cut / Not-cut buckets (those slabs were
 *  part of the original plan). For Extras / Transfers we just show
 *  IDs because the slabs aren't in the parent block's placed array. */
function SlabIdList({
  label,
  color,
  ids,
  allSlabsById,
  donorMap,
}: {
  label: string;
  color: string;
  ids: string[];
  allSlabsById?: Map<string, { id: string; label?: string; temple?: string; sw?: number; sh?: number }>;
  /** For the "Transferred from another block" list: slab id →
   *  { block_id, status } of the donor. Renders as "from MT-B-269"
   *  (with a warning hue when the donor is already done/rejected,
   *  signalling a stale link row that needs cleanup). */
  donorMap?: Map<string, { block_id: string; status: string }>;
}) {
  if (ids.length === 0) return null;
  return (
    <div style={{ marginTop: 10 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color,
          marginBottom: 6,
        }}
      >
        {label} ({ids.length})
      </div>
      <div className="chip-row" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {ids.map((id) => {
          const s = allSlabsById?.get(id);
          const donor = donorMap?.get(id);
          const donorIsStale =
            !!donor && (donor.status === "done" || donor.status === "rejected");
          return (
            <span
              key={id}
              className="plan-chip"
              style={{
                background: `${color}11`,
                border: `1px solid ${color}33`,
                fontFamily: "ui-monospace, monospace",
                fontSize: 11,
              }}
            >
              <strong>{id}</strong>
              {s && (s.sw != null || s.sh != null) && (
                <>
                  {" · "}
                  <span style={{ color: "var(--muted)" }}>
                    {s.sw ?? "—"}×{s.sh ?? "—"}″
                  </span>
                </>
              )}
              {s?.temple ? (
                <>
                  {" · "}
                  <span style={{ color: "var(--muted)" }}>{s.temple}</span>
                </>
              ) : null}
              {donor && (
                <>
                  {" · "}
                  <span
                    style={{
                      color: donorIsStale ? "#b91c1c" : color,
                      fontWeight: 600,
                    }}
                    title={
                      donorIsStale
                        ? `Donor ${donor.block_id} is already ${donor.status} — stale link, contact a developer to clean up.`
                        : `Claimed from ${donor.block_id} (currently ${donor.status})`
                    }
                  >
                    {donorIsStale ? "⚠ " : "← "}from {donor.block_id}
                    {donorIsStale ? ` (${donor.status})` : ""}
                  </span>
                </>
              )}
              {!donor && donorMap && (
                <>
                  {" · "}
                  <span
                    style={{ color: "var(--muted)", fontStyle: "italic" }}
                    title="No donor cut_session_slabs row found — the slab may have been re-planned or the link cleaned up."
                  >
                    ← donor unknown
                  </span>
                </>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}
