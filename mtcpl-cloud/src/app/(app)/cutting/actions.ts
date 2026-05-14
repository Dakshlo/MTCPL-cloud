"use server";

// IMPORTANT: this file is a server-actions module ("use server"
// directive). Next.js only permits async function exports here —
// non-async exports like `export const maxDuration` will fail the
// build with "The export was not found in module" because Next
// strips them out. Per-action timeout is configured on the PAGE
// that calls finishBlockAction (cutting/[id]/page.tsx) via its
// own `export const maxDuration = 60`.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { notify } from "@/lib/notifications";

async function refreshPaths() {
  revalidatePath("/cutting");
  revalidatePath("/blocks");
  revalidatePath("/slabs");
  revalidatePath("/dashboard");
}

async function syncSessionStatus(sessionId: string) {
  const supabase = createAdminSupabaseClient();
  const { data: blocks } = await supabase
    .from("cut_session_blocks")
    .select("status")
    .eq("cut_session_id", sessionId);

  const statuses = (blocks ?? []).map((b) => b.status);
  const allClosed =
    statuses.length > 0 &&
    statuses.every((s) => s === "done" || s === "rejected");

  await supabase
    .from("cut_sessions")
    .update({ status: allClosed ? "closed" : "in_progress" })
    .eq("id", sessionId);
}

// ──────────────────────────────────────────────────────────────────
// Transfer earmark helpers (Migration 033)
// ──────────────────────────────────────────────────────────────────
// When a team_head submits "Cutting Done" with a slab claimed from
// another block's plan, we EARMARK the donor immediately rather than
// waiting for approval. This closes a race window where the donor
// could quietly advance to 'done' between submission and approval,
// causing approveCutAction to blow up with the
// "donor block(s) [X] are no longer pending" error.
//
// Earmark = (cut_session_slabs.pending_transfer_to_csb_id IS NOT NULL).
// Side-effect = donor.needs_reprint flips TRUE so the donor's operator
// sees the existing red banner across all cutting views. On approval
// the RPC deletes donor rows and the earmark naturally clears; on
// rejection / cutter-edit we explicitly clear via clearTransferEarmarks.
// The donor's needs_reprint stays sticky once set (matches the existing
// "your plan changed; reprint" semantics — operator can choose to
// reprint or not based on the reason text).

type DonorMutability =
  | "pending_worker"
  | "pending_cut"
  | "cutting"
  | "done_prompt"
  | "awaiting_approval"
  | "awaiting_cutter_edit";

const MUTABLE_DONOR_STATUSES: DonorMutability[] = [
  "pending_worker",
  "pending_cut",
  "cutting",
  "done_prompt",
  "awaiting_approval",
  "awaiting_cutter_edit",
];

/**
 * Stamp donor cut_session_slabs rows with `pending_transfer_to_csb_id =
 * myCsbId` for each slab in `slabIds`, and flip the donor
 * cut_session_block to needs_reprint=TRUE with a reason that mentions
 * the awaiting-audit block.
 *
 * Refuses (returns ok:false) if ANY of the precondition checks fail:
 *  - slab not located on any cutting plan,
 *  - donor block has already advanced past mutability,
 *  - donor row is already earmarked by a different awaiting-audit block,
 *  - slab points back at the caller's own csb (self-transfer).
 *
 * Atomic-ish: validation happens up-front, then a single bulk UPDATE
 * stamps every donor slab. Race-guarded by `pending_transfer_to_csb_id
 * IS NULL` in the UPDATE WHERE clause; the approveCutAction pre-flight
 * remains as a safety net for anything that slips through.
 */
async function applyTransferEarmarks(
  supabase: ReturnType<typeof createAdminSupabaseClient>,
  myCsbId: string,
  myBlockId: string,
  slabIds: string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (slabIds.length === 0) return { ok: true };

  // 1. Fetch donor rows + donor csb status in one round-trip.
  const { data: donorRows, error: donorErr } = await supabase
    .from("cut_session_slabs")
    .select(
      "slab_requirement_id, cut_session_block_id, pending_transfer_to_csb_id, cut_session_blocks(id, block_id, status)",
    )
    .in("slab_requirement_id", slabIds);
  if (donorErr) return { ok: false, error: donorErr.message };

  type DonorRow = {
    slab_requirement_id: string;
    cut_session_block_id: string;
    pending_transfer_to_csb_id: string | null;
    cut_session_blocks:
      | { id: string; block_id: string; status: string }
      | { id: string; block_id: string; status: string }[]
      | null;
  };
  const rows = (donorRows ?? []) as unknown as DonorRow[];
  const rowFor = (slabId: string) =>
    rows.find((r) => r.slab_requirement_id === slabId);
  const donorOf = (r: DonorRow) =>
    Array.isArray(r.cut_session_blocks)
      ? r.cut_session_blocks[0] ?? null
      : r.cut_session_blocks;

  const missing: string[] = [];
  const selfClaim: string[] = [];
  const stuck: { donor: string; status: string }[] = [];
  const alreadyClaimed: { donor: string }[] = [];

  for (const slabId of slabIds) {
    const row = rowFor(slabId);
    if (!row) {
      missing.push(slabId);
      continue;
    }
    if (row.cut_session_block_id === myCsbId) {
      selfClaim.push(slabId);
      continue;
    }
    const donor = donorOf(row);
    const status = donor?.status ?? "missing";
    if (!donor || !MUTABLE_DONOR_STATUSES.includes(status as DonorMutability)) {
      stuck.push({ donor: donor?.block_id ?? "?", status });
      continue;
    }
    if (
      row.pending_transfer_to_csb_id &&
      row.pending_transfer_to_csb_id !== myCsbId
    ) {
      alreadyClaimed.push({ donor: donor.block_id });
      continue;
    }
  }

  if (missing.length > 0) {
    return {
      ok: false,
      error: `Cannot stage transfer — slab(s) [${missing.join(", ")}] could not be located on any cutting plan. Refresh and retry.`,
    };
  }
  if (selfClaim.length > 0) {
    return {
      ok: false,
      error: "Cannot transfer a slab to the same block — that's a no-op.",
    };
  }
  if (stuck.length > 0) {
    const labels = [
      ...new Set(stuck.map((s) => `${s.donor} (${s.status})`)),
    ].join(", ");
    return {
      ok: false,
      error: `Cannot stage transfer — donor block(s) [${labels}] have advanced past the transferable state. Reload your inventory list before submitting.`,
    };
  }
  if (alreadyClaimed.length > 0) {
    const labels = [...new Set(alreadyClaimed.map((s) => s.donor))].join(", ");
    return {
      ok: false,
      error: `Cannot stage transfer — slab(s) on [${labels}] are already earmarked by another awaiting-audit block. Wait for that audit to resolve.`,
    };
  }

  // 2. Stamp donor cut_session_slabs rows.
  const { error: stampErr } = await supabase
    .from("cut_session_slabs")
    .update({ pending_transfer_to_csb_id: myCsbId })
    .in("slab_requirement_id", slabIds)
    .neq("cut_session_block_id", myCsbId)
    .is("pending_transfer_to_csb_id", null);
  if (stampErr) return { ok: false, error: stampErr.message };

  // 3. Flip donor needs_reprint with a "claimed pending audit" reason.
  const donorCsbIds = [
    ...new Set(rows.map((r) => r.cut_session_block_id)),
  ].filter((id) => id !== myCsbId);
  if (donorCsbIds.length > 0) {
    const reason = `${slabIds.length} slab(s) claimed by ${myBlockId} pending audit on ${new Date().toLocaleDateString("en-IN")}`;
    const now = new Date().toISOString();
    const { error: bannerErr } = await supabase
      .from("cut_session_blocks")
      .update({
        needs_reprint: true,
        reprint_reason: reason,
        updated_at: now,
      })
      .in("id", donorCsbIds);
    if (bannerErr) return { ok: false, error: bannerErr.message };
  }

  return { ok: true };
}

/**
 * Release earmarks previously stamped by applyTransferEarmarks.
 * Used when the cutter / approver removes a slab from an awaiting-audit
 * block's transferred_slab_ids list during editPendingApprovalAction.
 *
 * Donor.needs_reprint is intentionally NOT cleared — the operator may
 * already have re-printed once and the sticky flag is the existing
 * convention. If the layout was actually mutated by an earlier approved
 * claim, that flag is correct anyway; if it wasn't, the worst case is
 * one unnecessary reprint. Safe direction.
 */
async function clearTransferEarmarks(
  supabase: ReturnType<typeof createAdminSupabaseClient>,
  claimerCsbId: string,
  slabIds: string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (slabIds.length === 0) return { ok: true };

  const { error } = await supabase
    .from("cut_session_slabs")
    .update({ pending_transfer_to_csb_id: null })
    .in("slab_requirement_id", slabIds)
    .eq("pending_transfer_to_csb_id", claimerCsbId);
  if (error) return { ok: false, error: error.message };

  return { ok: true };
}

/**
 * Symmetric to applyTransferEarmarks: refuse the caller if any of THIS
 * block's planned slabs is currently earmarked by another awaiting-audit
 * block. Prevents the donor from finishing their own cut while a claim
 * is still in flight.
 */
async function refuseIfMySlabsAreClaimed(
  supabase: ReturnType<typeof createAdminSupabaseClient>,
  myCsbId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: claimed, error } = await supabase
    .from("cut_session_slabs")
    .select("slab_requirement_id, pending_transfer_to_csb_id")
    .eq("cut_session_block_id", myCsbId)
    .not("pending_transfer_to_csb_id", "is", null);
  if (error) return { ok: false, error: error.message };
  if (!claimed || claimed.length === 0) return { ok: true };

  const claimerCsbIds = [
    ...new Set(
      claimed
        .map((r) => r.pending_transfer_to_csb_id as string | null)
        .filter((v): v is string => Boolean(v)),
    ),
  ];
  const { data: claimerBlocks } = await supabase
    .from("cut_session_blocks")
    .select("id, block_id")
    .in("id", claimerCsbIds);
  const labels = (claimerBlocks ?? [])
    .map((b) => (b as { block_id: string }).block_id)
    .join(", ");

  return {
    ok: false,
    error: `Cannot finish — ${claimed.length} slab(s) on this block are currently claimed by ${labels || "another block"} awaiting audit. Wait for that audit to resolve, or ask the approver to remove the claim from their staged payload.`,
  };
}

/**
 * Pending Approval → Waiting to Cut.
 *
 * Originally this flipped pending_worker → cutting in a single step.
 * Split now: approval just queues the block on the cutting list (status
 * = pending_cut). The actual transition to 'cutting' happens via
 * startCuttingAction when the operator physically begins cutting on
 * the saw. Lets us distinguish "approved but waiting for the saw" from
 * "saw actively running" in the UI.
 */
export async function approveBlockAction(formData: FormData) {
  const { profile } = await requireAuth(["owner", "team_head", "cutting_operator"]);
  const supabase = createAdminSupabaseClient();
  const sessionBlockId = String(formData.get("session_block_id") || "");
  const sessionId = String(formData.get("session_id") || "");

  const { error } = await supabase
    .from("cut_session_blocks")
    .update({ status: "pending_cut", updated_at: new Date().toISOString() })
    .eq("id", sessionBlockId);
  if (error) throw new Error(error.message);

  await supabase
    .from("cut_sessions")
    .update({ status: "in_progress" })
    .eq("id", sessionId);

  await logAudit(profile.id, "block_sent_to_cutting", "cut_session_block", sessionBlockId, {
    session_id: sessionId,
  });

  await notify("block_sent_to_cutting", `Block sent to cutting list`, {
    entityType: "cut_session_block",
    entityId: sessionBlockId,
    actorId: profile.id,
  });

  await refreshPaths();
}

/**
 * Waiting to Cut → In Progress.
 *
 * Operator presses "Start Cutting" when they're physically beginning
 * the cut. We assign a per-cutter sequence number (cutting_seq) that's
 * scoped to the block's FACILITY (MTCPL or RIICO have independent
 * counters), so the block gets a short verbal id like "M5" or "R3".
 * Number is reused after the block leaves cutting via lowest-unused-
 * positive-integer-within-the-same-facility.
 *
 * cutting_seq is intentionally NOT durable — it's a working-set hint,
 * not an identity. Block.id (e.g. MT-B-005) remains the canonical id.
 */
export async function startCuttingAction(formData: FormData) {
  const { profile } = await requireAuth(["owner", "team_head", "cutting_operator"]);
  const supabase = createAdminSupabaseClient();
  const sessionBlockId = String(formData.get("session_block_id") || "");
  const sessionId = String(formData.get("session_id") || "");

  // Validate the block is currently waiting (defensive — UI only
  // shows the button on pending_cut rows, but the action might be
  // re-played from a stale tab or via curl). Pull the layout so we
  // can determine facility from layout.blk.yard.
  const { data: existing } = await supabase
    .from("cut_session_blocks")
    .select("status, layout")
    .eq("id", sessionBlockId)
    .maybeSingle();
  if (!existing) throw new Error("Cut session block not found");
  if (existing.status !== "pending_cut") {
    throw new Error(`Block is in '${existing.status}' state, not pending_cut`);
  }

  const { facilityOfYard } = await import("@/lib/yards");
  const blockYard = (existing.layout as { blk?: { yard?: number } } | null)?.blk?.yard;
  const myFacility = facilityOfYard(blockYard);

  // Find the lowest-unused positive integer among currently-cutting
  // blocks IN THE SAME FACILITY. MTCPL and RIICO have independent
  // counters — both can have an "M1"/"R1" simultaneously.
  const { data: inUse } = await supabase
    .from("cut_session_blocks")
    .select("cutting_seq, layout")
    .eq("status", "cutting")
    .not("cutting_seq", "is", null);
  const used = new Set<number>();
  for (const r of inUse ?? []) {
    const yard = (r.layout as { blk?: { yard?: number } } | null)?.blk?.yard;
    if (facilityOfYard(yard) === myFacility && typeof r.cutting_seq === "number") {
      used.add(r.cutting_seq);
    }
  }
  let nextSeq = 1;
  while (used.has(nextSeq)) nextSeq++;

  const { error } = await supabase
    .from("cut_session_blocks")
    .update({
      status: "cutting",
      cutting_seq: nextSeq,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionBlockId)
    .eq("status", "pending_cut"); // race guard
  if (error) throw new Error(error.message);

  const seqLabel = `${myFacility === "riico" ? "R" : "M"}${nextSeq}`;

  await logAudit(profile.id, "cutting_started", "cut_session_block", sessionBlockId, {
    session_id: sessionId,
    cutting_seq: nextSeq,
    facility: myFacility,
    seq_label: seqLabel,
  });

  await notify("cut_started", `Cutting started — ${seqLabel}`, {
    entityType: "cut_session_block",
    entityId: sessionBlockId,
    actorId: profile.id,
  });

  await refreshPaths();
}

export async function rejectBlockAction(formData: FormData) {
  const { profile } = await requireAuth(["owner", "team_head", "cutting_operator"]);
  const supabase = createAdminSupabaseClient();
  const sessionBlockId = String(formData.get("session_block_id") || "");
  const sessionId = String(formData.get("session_id") || "");
  const blockId = String(formData.get("block_id") || "");
  const slabIds = JSON.parse(String(formData.get("slab_ids") || "[]")) as string[];

  await supabase
    .from("blocks")
    .update({ status: "available", updated_by: profile.id, updated_at: new Date().toISOString() })
    .eq("id", blockId);

  if (slabIds.length) {
    await supabase
      .from("slab_requirements")
      .update({ status: "open", source_block_id: null, updated_by: profile.id, updated_at: new Date().toISOString() })
      .in("id", slabIds);
  }

  await supabase
    .from("cut_session_blocks")
    .update({ status: "rejected" })
    .eq("id", sessionBlockId);

  await logAudit(profile.id, "block_rejected", "cut_session_block", sessionBlockId, {
    session_id: sessionId,
    block_id: blockId,
    slabs_released: slabIds,
  });

  await notify("block_rejected", `Block ${blockId} rejected — returned to inventory`, {
    message: `${slabIds.length} slab(s) released`,
    entityType: "cut_session_block",
    entityId: sessionBlockId,
    actorId: profile.id,
  });

  await syncSessionStatus(sessionId);
  await refreshPaths();
}

// Return-success contract: the action no longer redirects on the
// happy path. Instead it returns `{ ok: true }` (or `{ ok: true,
// alreadyDone: true }` for the idempotent re-click case) and the
// client (finish-block-form.tsx handleSubmit) does router.push +
// router.refresh.
//
// Why: when finishBlockAction transferred slabs from another block,
// the post-action redirect was throwing during the Server Component
// render of /cutting?tab=done — Next.js bundled the render error
// back into the action response, which the form caught and showed
// as "An error occurred in the Server Components render…" even
// though the DB write had succeeded. Switching to client-side
// navigation sidesteps the redirect+RSC race; any genuine page
// error now lands on /cutting as a normal page error rather than
// as a misleading "Cutting Done failed" form error.
export type FinishBlockResult =
  | { ok: true; alreadyDone?: boolean; awaitingApproval?: boolean }
  | { ok: false; error: string };

export async function finishBlockAction(formData: FormData): Promise<FinishBlockResult> {
  const { profile } = await requireAuth(["owner", "team_head", "cutting_operator"]);
  const supabase = createAdminSupabaseClient();

  const sessionBlockId = String(formData.get("session_block_id") || "");
  const sessionId = String(formData.get("session_id") || "");
  const blockId = String(formData.get("block_id") || "");
  const stone = String(formData.get("stone") || "PinkStone");
  const yard = Number(formData.get("yard") || 1);
  const cutSlabIds = JSON.parse(String(formData.get("cut_slab_ids") || "[]")) as string[];
  const allSlabIds = JSON.parse(String(formData.get("all_slab_ids") || "[]")) as string[];
  const notCutSlabIds = allSlabIds.filter((id) => !cutSlabIds.includes(id));
  const restock = String(formData.get("restock") || "") === "yes";
  const remainders = JSON.parse(
    String(formData.get("remainders_json") || "[]")
  ) as Array<{
    id: string;
    l: number;
    w: number;
    h: number;
    quality?: "" | "A" | "B";
    /** Per-piece yard override. Defaults to the parent block's
     *  yard if the client didn't pass one. */
    yard?: number;
  }>;
  const extraSlabIds = JSON.parse(String(formData.get("extra_slab_ids") || "[]")) as string[];
  // Transferred slabs — claimed from another block's plan (status='planned').
  // These cause donor block layout edits + needs_reprint flag.
  const transferredSlabIds = JSON.parse(String(formData.get("transferred_slab_ids") || "[]")) as string[];
  // Stock location — where the cut slabs are physically going. Operator
  // enters this when finishing the cut. Applies to every slab the
  // action touches (planned cuts, extras, transfers). Manual slabs
  // added later by office staff inherit nothing here — the office
  // team sets stock_location separately via the slab edit flow.
  const stockLocation = String(formData.get("stock_location") || "").trim() || null;

  // Log the incoming request so we can trace failures from Vercel logs.
  console.log("[finishBlockAction] START", {
    sessionBlockId, sessionId, blockId, stone, yard,
    cutSlabIds, notCutSlabIds, extraSlabIds,
    restock, remainderCount: remainders.length,
    stockLocation,
    actor: profile.id,
  });

  try {
    // Permission gate for transfers — even at submission time. The
    // approver re-validates donor state before commit, but we still
    // refuse the submission outright if this cutter has no transfer
    // privilege.
    if (transferredSlabIds.length > 0) {
      const { canTransferPlannedSlabs } = await import("@/lib/cutting-permissions");
      if (!canTransferPlannedSlabs(profile)) {
        throw new Error(
          "You do not have permission to transfer slabs from another block's plan. Contact a developer or authorised owner.",
        );
      }
    }

    // Migration 033 — refuse if any of THIS block's planned slabs is
    // currently earmarked by another awaiting-audit block. Symmetric
    // to the donor lock we apply below: if someone is claiming a slab
    // from me, I can't close out the block underneath them.
    const incomingCheck = await refuseIfMySlabsAreClaimed(supabase, sessionBlockId);
    if (!incomingCheck.ok) {
      throw new Error(incomingCheck.error);
    }

    // Migration 033 — earmark the donor side BEFORE we stage the
    // payload. This stamps cut_session_slabs.pending_transfer_to_csb_id
    // + flips donor.needs_reprint=TRUE so the donor's operator sees the
    // existing red banner across all cutting views. Refuses the whole
    // submission if any precondition fails (donor advanced past
    // mutability, slab already earmarked elsewhere, self-transfer).
    if (transferredSlabIds.length > 0) {
      const earmark = await applyTransferEarmarks(
        supabase,
        sessionBlockId,
        blockId,
        transferredSlabIds,
      );
      if (!earmark.ok) {
        throw new Error(earmark.error);
      }
    }

    // ── Stage the cutter's payload (migration 027) ────────────────
    // Cutting Done no longer commits immediately. The cutter's
    // entire form snapshot is stored on cut_session_blocks
    // .pending_approval_payload and the block flips to
    // 'awaiting_approval'. An approver (developer / owner / Rajesh
    // Kumar) reviews + either approves (fires finish_block_cut RPC)
    // or sends back for the cutter to edit. NO downstream slab /
    // donor mutations happen until approval.
    //
    // The block must currently be in 'cutting' or 'done_prompt'
    // (the cutter just hit Done from In Progress) OR
    // 'awaiting_cutter_edit' (resubmitting after edit). Race-guard
    // on the WHERE clause so two cutters can't double-submit.
    const payload = {
      cut_slab_ids: cutSlabIds,
      not_cut_slab_ids: notCutSlabIds,
      extra_slab_ids: extraSlabIds,
      transferred_slab_ids: transferredSlabIds,
      remainders,
      restock,
      stock_location: stockLocation,
      stone,
      yard,
    };
    const now = new Date().toISOString();
    const { data: updated, error: updErr } = await supabase
      .from("cut_session_blocks")
      .update({
        status: "awaiting_approval",
        pending_approval_payload: payload,
        submitted_for_approval_at: now,
        submitted_for_approval_by: profile.id,
        // Clear send-back trail if this is a cutter resubmission.
        // Also re-lock the cutter-edit flag — migration 032 model.
        sent_back_at: null,
        sent_back_by: null,
        sent_back_note: null,
        cutter_edit_unlocked: false,
        updated_at: now,
      })
      .eq("id", sessionBlockId)
      .in("status", ["cutting", "done_prompt", "awaiting_cutter_edit"])
      .select("id");

    if (updErr) throw new Error(updErr.message);
    if (!updated || updated.length === 0) {
      throw new Error(
        "Block is no longer in a submittable state — it may have already been submitted or moved on. Refresh and retry.",
      );
    }

    // Audit + notify approvers. Fire-and-forget — these failing
    // doesn't mean the submission failed.
    void Promise.all([
      logAudit(
        profile.id,
        "cutting_done_pending_approval",
        "cut_session_block",
        sessionBlockId,
        {
          session_id: sessionId,
          block_id: blockId,
          cut_slabs: cutSlabIds,
          not_cut_slabs: notCutSlabIds,
          extra_slabs: extraSlabIds,
          transferred_slabs: transferredSlabIds,
          remainder_count: remainders.length,
        },
      ),
      notify(
        "cut_pending_approval",
        `Block ${blockId} submitted for approval`,
        {
          message: `${cutSlabIds.length} slab(s) cut${extraSlabIds.length > 0 ? ` · ${extraSlabIds.length} unplanned` : ""}${transferredSlabIds.length > 0 ? ` · ${transferredSlabIds.length} transferred` : ""}. Review and approve.`,
          entityType: "cut_session_block",
          entityId: sessionBlockId,
          actorId: profile.id,
          targetRoles: ["developer", "owner"],
        },
      ),
    ]).catch((e) =>
      console.warn("[finishBlockAction] pending-approval cleanup failed (non-fatal)", e),
    );

    await refreshPaths();
    console.log("[finishBlockAction] SUBMITTED FOR APPROVAL", { sessionBlockId, blockId });
    return { ok: true, awaitingApproval: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[finishBlockAction] FAILED", {
      sessionBlockId, sessionId, blockId,
      cutSlabIds, notCutSlabIds, extraSlabIds,
      restock, remainderCount: remainders.length,
      error: msg,
      stack: err instanceof Error ? err.stack : null,
    });
    return { ok: false, error: msg };
  }
}

// ──────────────────────────────────────────────────────────────────
// Cut-approval actions (migration 027)
// ──────────────────────────────────────────────────────────────────

// Shape of the payload stored on cut_session_blocks
// .pending_approval_payload. Matches what finishBlockAction stages.
type PendingApprovalPayload = {
  cut_slab_ids: string[];
  not_cut_slab_ids: string[];
  extra_slab_ids: string[];
  transferred_slab_ids: string[];
  remainders: Array<{
    id: string;
    l: number;
    w: number;
    h: number;
    quality?: "" | "A" | "B";
    yard?: number;
  }>;
  restock: boolean;
  stock_location: string | null;
  stone: string;
  yard: number;
};

/**
 * Approve a pending cut — the only path to status='done' now.
 *
 * Fires the existing finish_block_cut RPC (migration 018) with the
 * staged payload. Atomic — single round-trip, single rollback
 * boundary. Approver attribution recorded on the block.
 *
 * Pre-flight donor check: if any transferred slab points to a
 * donor block that's no longer in pending/cutting/awaiting_*,
 * surface a clear error rather than letting the RPC raise an
 * opaque one. The approver can then send the block back for edit
 * to remove the bad transfer, or contact a dev.
 *
 * Auth: canApproveCuts(profile) — developer / owner / team_head
 * with can_approve_cuts=TRUE.
 */
export async function approveCutAction(
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { profile } = await requireAuth(["developer", "owner", "team_head"]);
  const { canApproveCuts } = await import("@/lib/cutting-permissions");
  if (!canApproveCuts(profile)) {
    return { ok: false, error: "You do not have permission to approve cuts." };
  }
  const supabase = createAdminSupabaseClient();

  const sessionBlockId = String(formData.get("session_block_id") || "");
  if (!sessionBlockId) return { ok: false, error: "Missing session_block_id" };

  // Load the block + payload + session.
  const { data: blockRow, error: blockErr } = await supabase
    .from("cut_session_blocks")
    .select("id, status, block_id, cut_session_id, pending_approval_payload")
    .eq("id", sessionBlockId)
    .maybeSingle();
  if (blockErr) return { ok: false, error: blockErr.message };
  if (!blockRow) return { ok: false, error: "Block not found." };
  const block = blockRow as {
    id: string;
    status: string;
    block_id: string;
    cut_session_id: string;
    pending_approval_payload: PendingApprovalPayload | null;
  };
  if (block.status !== "awaiting_approval") {
    return { ok: false, error: `Block is not awaiting approval (status: ${block.status}).` };
  }
  const payload = block.pending_approval_payload;
  if (!payload) {
    return { ok: false, error: "No staged payload — refresh and retry." };
  }

  try {
    // Pre-flight donor check for any transfers in the payload.
    if (payload.transferred_slab_ids.length > 0) {
      const { data: donorRows } = await supabase
        .from("cut_session_slabs")
        .select("slab_requirement_id, cut_session_block_id, cut_session_blocks(block_id, status)")
        .in("slab_requirement_id", payload.transferred_slab_ids);
      // PostgREST returns the nested cut_session_blocks join as
      // either a single object or an array depending on the relationship;
      // we normalise via `unknown` to dodge the generated `any[]` cast.
      type DonorRow = {
        slab_requirement_id: string;
        cut_session_block_id: string;
        cut_session_blocks:
          | { block_id: string; status: string }
          | { block_id: string; status: string }[]
          | null;
      };
      const ACCEPTABLE_DONOR_STATUSES = [
        "pending_worker",
        "pending_cut",
        "cutting",
        "done_prompt",
        // While in awaiting_approval / awaiting_cutter_edit the donor
        // is still mutable, so those are fine.
        "awaiting_approval",
        "awaiting_cutter_edit",
      ];
      const rawDonorRows = (donorRows ?? []) as unknown as DonorRow[];
      const stuck = rawDonorRows.filter((r) => {
        const joined = Array.isArray(r.cut_session_blocks)
          ? r.cut_session_blocks[0] ?? null
          : r.cut_session_blocks;
        const s = joined?.status;
        if (!s) return true;
        return !ACCEPTABLE_DONOR_STATUSES.includes(s);
      });
      if (stuck.length > 0) {
        const blockIds = [
          ...new Set(
            stuck.map((r) => {
              const joined = Array.isArray(r.cut_session_blocks)
                ? r.cut_session_blocks[0] ?? null
                : r.cut_session_blocks;
              return joined?.block_id ?? "?";
            }),
          ),
        ].join(", ");
        return {
          ok: false,
          error: `Donor block(s) [${blockIds}] are no longer pending — the transfer cannot be committed. Send the block back for edit to remove this transfer, or contact a developer.`,
        };
      }
    }

    // Fire the same RPC the old finishBlockAction used.
    const tStart = Date.now();
    const { data: rpcData, error: rpcErr } = await supabase.rpc("finish_block_cut", {
      p_session_block_id: sessionBlockId,
      p_session_id: block.cut_session_id,
      p_block_id: block.block_id,
      p_stone: payload.stone,
      p_yard: payload.yard,
      p_actor: profile.id,
      p_cut_slab_ids: payload.cut_slab_ids,
      p_not_cut_slab_ids: payload.not_cut_slab_ids,
      p_extra_slab_ids: payload.extra_slab_ids,
      p_transferred_slab_ids: payload.transferred_slab_ids,
      p_remainders: payload.remainders,
      p_restock: payload.restock,
      p_stock_location: payload.stock_location,
    });
    console.log(`[approveCutAction] RPC finish_block_cut returned in ${Date.now() - tStart}ms`);
    if (rpcErr) throw new Error(rpcErr.message ?? "Approve RPC failed without a message.");

    const result = (rpcData ?? {}) as {
      success?: boolean;
      already_done?: boolean;
      restocked_block_id?: string | null;
      transfer_donor_blocks?: string[];
      transfer_donor_session_block_ids?: string[];
    };

    // Mark approval attribution + clear staged payload. We do this
    // even on already_done so the approver fields are populated.
    await supabase
      .from("cut_session_blocks")
      .update({
        approved_at: new Date().toISOString(),
        approved_by: profile.id,
        pending_approval_payload: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionBlockId);

    // Donor notifications + audit (fire-and-forget — copy of the
    // old logic, just on this side of the timeline).
    const restockedBlockId = result.restocked_block_id ?? null;
    const restockedIds: string[] = restockedBlockId
      ? restockedBlockId.split(",").filter(Boolean)
      : [];
    const transferDonorBlocks = result.transfer_donor_blocks ?? [];
    const transferDonorCsbIds = result.transfer_donor_session_block_ids ?? [];
    if (transferDonorCsbIds.length > 0) {
      void Promise.all(
        transferDonorCsbIds.map((donorId, i) => {
          const donorBlockId = transferDonorBlocks[i] ?? donorId;
          return notify(
            "slab_transferred_from",
            `Slab(s) moved away from ${donorBlockId}`,
            {
              message: `Claimed by ${block.block_id}. Reprint plan before cutting.`,
              entityType: "cut_session_block",
              entityId: donorId,
              actorId: profile.id,
              targetRoles: ["cutting_operator", "team_head", "developer"],
            },
          ).catch((e) =>
            console.warn(`[approveCutAction] donor ${donorBlockId} notify failed`, e),
          );
        }),
      );
      logAudit(profile.id, "slab_transferred_in", "cut_session_block", sessionBlockId, {
        transferred_slabs: payload.transferred_slab_ids,
        donor_blocks: transferDonorBlocks,
        donor_session_block_ids: transferDonorCsbIds,
      }).catch((e) => console.warn("[approveCutAction] audit failed", e));
    }

    const hasDeviation =
      payload.extra_slab_ids.length > 0 || payload.transferred_slab_ids.length > 0;
    await Promise.allSettled([
      logAudit(
        profile.id,
        hasDeviation ? "cut_approved_with_deviation" : "cut_approved",
        "cut_session_block",
        sessionBlockId,
        {
          session_id: block.cut_session_id,
          block_id: block.block_id,
          cut_slabs: payload.cut_slab_ids,
          not_cut_slabs: payload.not_cut_slab_ids,
          restocked_blocks: restockedIds,
          restock: payload.restock,
          ...(payload.extra_slab_ids.length > 0
            ? { extra_slabs: payload.extra_slab_ids }
            : {}),
          ...(payload.transferred_slab_ids.length > 0
            ? { transferred_slabs: payload.transferred_slab_ids }
            : {}),
        },
      ),
      notify(
        "cut_done",
        `Block ${block.block_id} cutting approved`,
        {
          message: `${payload.cut_slab_ids.length} slab(s) cut${restockedIds.length > 0 ? ` · ${restockedIds.length} restocked` : ""}${payload.extra_slab_ids.length > 0 ? ` · ${payload.extra_slab_ids.length} unplanned` : ""}${payload.transferred_slab_ids.length > 0 ? ` · ${payload.transferred_slab_ids.length} transferred` : ""}`,
          entityType: "cut_session_block",
          entityId: sessionBlockId,
          actorId: profile.id,
        },
      ),
      syncSessionStatus(block.cut_session_id),
    ]);

    await refreshPaths();
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[approveCutAction] FAILED", { sessionBlockId, error: msg });
    return { ok: false, error: msg };
  }
}

/**
 * Form-wrapper around approveCutAction. The HTML form action prop
 * wants `void | Promise<void>`, but approveCutAction returns a
 * result object (used by the approvals-client and the detail page's
 * client-side button paths). This wrapper bridges the two — runs
 * the approve, then redirects on success or appends an error query
 * param on failure so the toast banner can surface it.
 */
export async function approveCutFormAction(formData: FormData) {
  const result = await approveCutAction(formData);
  const sessionBlockId = String(formData.get("session_block_id") || "");
  if (!result.ok) {
    redirect(
      `/cutting/${encodeURIComponent(sessionBlockId)}?error=${encodeURIComponent(result.error)}`,
    );
  }
  redirect("/cutting/approvals");
}

/**
 * Unlock the cutter-edit permission for an awaiting_approval block.
 * Approver-only.
 *
 * Migration 032 changed the model: instead of flipping status to
 * 'awaiting_cutter_edit' (and moving the block out of the audit
 * queue), we keep the block at 'awaiting_approval' throughout and
 * set the `cutter_edit_unlocked` flag. The cutter (team_head
 * submitter) ALWAYS sees their submissions in the queue; the flag
 * is the only thing that gates whether the Edit button shows up.
 *
 * The auditor can re-lock at any time via lockCutterEditAction (or
 * just approve as-is). The cutter's save through
 * editPendingApprovalAction automatically re-locks.
 *
 * `requestCutterEditAction` is kept as the export name for
 * backward-compat with any inline references; semantically it now
 * means "give the cutter the unlock token".
 */
export async function requestCutterEditAction(
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { profile } = await requireAuth(["developer", "owner", "team_head"]);
  const { canApproveCuts } = await import("@/lib/cutting-permissions");
  if (!canApproveCuts(profile)) {
    return { ok: false, error: "You do not have permission to unlock cutter edits." };
  }
  const supabase = createAdminSupabaseClient();

  const sessionBlockId = String(formData.get("session_block_id") || "");
  const note = (String(formData.get("note") || "")).trim() || null;
  if (!sessionBlockId) return { ok: false, error: "Missing session_block_id" };

  const { data: blockRow } = await supabase
    .from("cut_session_blocks")
    .select("id, status, block_id, submitted_for_approval_by, cutter_edit_unlocked")
    .eq("id", sessionBlockId)
    .maybeSingle();
  if (!blockRow) return { ok: false, error: "Block not found." };
  const block = blockRow as {
    id: string;
    status: string;
    block_id: string;
    submitted_for_approval_by: string | null;
    cutter_edit_unlocked: boolean;
  };
  if (block.status !== "awaiting_approval") {
    return {
      ok: false,
      error: `Block is not awaiting approval (status: ${block.status}).`,
    };
  }

  const now = new Date().toISOString();
  // Set the unlock flag + record who unlocked + the note. Status
  // STAYS awaiting_approval — that's the whole point of migration 032.
  const { error: updErr } = await supabase
    .from("cut_session_blocks")
    .update({
      cutter_edit_unlocked: true,
      sent_back_at: now,
      sent_back_by: profile.id,
      sent_back_note: note,
      updated_at: now,
    })
    .eq("id", sessionBlockId)
    .eq("status", "awaiting_approval");
  if (updErr) return { ok: false, error: updErr.message };

  void Promise.all([
    logAudit(profile.id, "cut_cutter_edit_unlocked", "cut_session_block", sessionBlockId, {
      block_id: block.block_id,
      note,
    }),
    notify(
      "cut_cutter_edit_unlocked",
      `Block ${block.block_id} unlocked for cutter edit`,
      {
        message: note ?? "Auditor requested changes — edit and resubmit.",
        entityType: "cut_session_block",
        entityId: sessionBlockId,
        actorId: profile.id,
        // Notify cutting operators broadly. The notification bell
        // filters by recipient role; the cutter's submitter id is
        // captured in the audit log + payload for direct lookup.
        targetRoles: ["cutting_operator", "team_head", "developer"],
      },
    ),
  ]).catch((e) =>
    console.warn("[requestCutterEditAction] cleanup failed (non-fatal)", e),
  );

  await refreshPaths();
  return { ok: true };
}

/**
 * Revoke the cutter-edit unlock. Approver-only.
 * Useful when the auditor accidentally unlocks, or decides to edit
 * in place and approve instead of waiting for the cutter.
 */
export async function lockCutterEditAction(
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { profile } = await requireAuth(["developer", "owner", "team_head"]);
  const { canApproveCuts } = await import("@/lib/cutting-permissions");
  if (!canApproveCuts(profile)) {
    return { ok: false, error: "You do not have permission to lock cutter edits." };
  }
  const supabase = createAdminSupabaseClient();
  const sessionBlockId = String(formData.get("session_block_id") || "");
  if (!sessionBlockId) return { ok: false, error: "Missing session_block_id" };

  const now = new Date().toISOString();
  const { data: updated, error } = await supabase
    .from("cut_session_blocks")
    .update({
      cutter_edit_unlocked: false,
      // Keep sent_back_note for audit reference — only the flag goes off.
      updated_at: now,
    })
    .eq("id", sessionBlockId)
    .eq("status", "awaiting_approval")
    .select("id, block_id")
    .single();

  if (error) return { ok: false, error: error.message };
  if (!updated) return { ok: false, error: "Block not in awaiting_approval — refresh and retry." };

  void logAudit(profile.id, "cut_cutter_edit_locked", "cut_session_block", sessionBlockId, {
    block_id: updated.block_id,
  });

  await refreshPaths();
  return { ok: true };
}

/**
 * Edit a pending-approval block's staged payload.
 *
 * Two valid paths:
 *   1. Approver editing while status = awaiting_approval. They can
 *      edit-then-approve in one sitting. Status stays the same.
 *   2. Cutter editing while status = awaiting_cutter_edit (i.e. the
 *      approver sent it back). Save flips status BACK to
 *      awaiting_approval so the approver re-reviews. Sent_back_note
 *      is cleared.
 *
 * Everything else is rejected.
 *
 * Accepts the same form payload as finishBlockAction.
 */
export async function editPendingApprovalAction(
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { profile } = await requireAuth([
    "developer",
    "owner",
    "team_head",
    "cutting_operator",
  ]);
  const supabase = createAdminSupabaseClient();

  const sessionBlockId = String(formData.get("session_block_id") || "");
  if (!sessionBlockId) return { ok: false, error: "Missing session_block_id" };

  // Re-parse the same fields finishBlockAction parses.
  const cutSlabIds = JSON.parse(String(formData.get("cut_slab_ids") || "[]")) as string[];
  const allSlabIds = JSON.parse(String(formData.get("all_slab_ids") || "[]")) as string[];
  const notCutSlabIds = allSlabIds.filter((id) => !cutSlabIds.includes(id));
  const restock = String(formData.get("restock") || "") === "yes";
  const remainders = JSON.parse(
    String(formData.get("remainders_json") || "[]"),
  ) as Array<{ id: string; l: number; w: number; h: number; quality?: "" | "A" | "B"; yard?: number }>;
  const extraSlabIds = JSON.parse(String(formData.get("extra_slab_ids") || "[]")) as string[];
  const transferredSlabIds = JSON.parse(
    String(formData.get("transferred_slab_ids") || "[]"),
  ) as string[];
  const stockLocation = String(formData.get("stock_location") || "").trim() || null;
  const stone = String(formData.get("stone") || "PinkStone");
  const yard = Number(formData.get("yard") || 1);

  // Permission gate for transfers (same as finishBlockAction).
  if (transferredSlabIds.length > 0) {
    const { canTransferPlannedSlabs } = await import("@/lib/cutting-permissions");
    if (!canTransferPlannedSlabs(profile)) {
      return {
        ok: false,
        error:
          "You do not have permission to transfer slabs from another block's plan.",
      };
    }
  }

  // Authorise this specific edit attempt.
  const { data: blockRow } = await supabase
    .from("cut_session_blocks")
    .select(
      "id, status, block_id, submitted_for_approval_by, cut_session_id, cutter_edit_unlocked, pending_approval_payload",
    )
    .eq("id", sessionBlockId)
    .maybeSingle();
  if (!blockRow) return { ok: false, error: "Block not found." };
  const block = blockRow as {
    id: string;
    status: string;
    block_id: string;
    submitted_for_approval_by: string | null;
    cut_session_id: string;
    cutter_edit_unlocked: boolean;
    pending_approval_payload: PendingApprovalPayload | null;
  };

  const { canApproveCuts } = await import("@/lib/cutting-permissions");
  const isApprover = canApproveCuts(profile);
  const isOriginalSubmitter = block.submitted_for_approval_by === profile.id;

  // Migration 032 model: status stays at awaiting_approval throughout.
  // The cutter (team_head submitter) can ONLY edit when the auditor
  // has flipped cutter_edit_unlocked = TRUE. Approvers can always edit.
  // The `awaiting_cutter_edit` branch below is kept defensively for
  // any legacy rows that weren't migrated.
  let isCutterResubmission = false;
  if (block.status === "awaiting_approval") {
    if (isApprover) {
      // Approver path — always allowed. No state change.
    } else {
      // Cutter / team_head path — needs the unlock token.
      if (!block.cutter_edit_unlocked) {
        return {
          ok: false,
          error:
            "Editing is locked. Ask the auditor (dev / owner / Rajesh) to allow cutter edit first.",
        };
      }
      // Must own the block, OR be a team_head / cutting_operator fallback
      // (shift handoff).
      const isCutterRole =
        isOriginalSubmitter ||
        profile.role === "team_head" ||
        profile.role === "cutting_operator";
      if (!isCutterRole) {
        return {
          ok: false,
          error: "Only the original cutter or an approver can edit this block.",
        };
      }
      isCutterResubmission = true;
    }
  } else if (block.status === "awaiting_cutter_edit") {
    // Legacy branch: pre-migration-032 rows. Accept the edit and
    // also flip status back to awaiting_approval as part of the save.
    if (
      !isApprover &&
      !isOriginalSubmitter &&
      profile.role !== "team_head" &&
      profile.role !== "cutting_operator"
    ) {
      return {
        ok: false,
        error: "Only the original cutter or an approver can edit this block.",
      };
    }
    isCutterResubmission = !isApprover;
  } else {
    return {
      ok: false,
      error: `Block is not in an editable approval state (status: ${block.status}).`,
    };
  }

  const payload: PendingApprovalPayload = {
    cut_slab_ids: cutSlabIds,
    not_cut_slab_ids: notCutSlabIds,
    extra_slab_ids: extraSlabIds,
    transferred_slab_ids: transferredSlabIds,
    remainders,
    restock,
    stock_location: stockLocation,
    stone,
    yard,
  };
  const now = new Date().toISOString();

  // Migration 033 — diff transfers between OLD and NEW payloads and
  // sync earmarks accordingly. Removed transfers release their donor
  // earmark; added transfers stamp the donor (with full precondition
  // checks via applyTransferEarmarks). Same atomic-ish model as
  // finishBlockAction — validation up-front, bulk UPDATE after.
  const oldTransfers = new Set(
    block.pending_approval_payload?.transferred_slab_ids ?? [],
  );
  const newTransfers = new Set(transferredSlabIds);
  const removedTransfers = [...oldTransfers].filter((id) => !newTransfers.has(id));
  const addedTransfers = [...newTransfers].filter((id) => !oldTransfers.has(id));

  if (removedTransfers.length > 0) {
    const cleared = await clearTransferEarmarks(
      supabase,
      sessionBlockId,
      removedTransfers,
    );
    if (!cleared.ok) return cleared;
  }
  if (addedTransfers.length > 0) {
    const stamped = await applyTransferEarmarks(
      supabase,
      sessionBlockId,
      block.block_id,
      addedTransfers,
    );
    if (!stamped.ok) return stamped;
  }

  const updatePayload: Record<string, unknown> = {
    pending_approval_payload: payload,
    approval_edited_at: now,
    approval_edited_by: profile.id,
    // Always end up at awaiting_approval (migration 032 model — no
    // status flips). Legacy awaiting_cutter_edit rows also normalise
    // here so the system can converge on the new model gradually.
    status: "awaiting_approval",
    updated_at: now,
  };
  // When the cutter resubmits, clear the send-back trail AND re-lock
  // the unlock flag. The auditor will need to explicitly unlock again
  // if they want another edit pass.
  if (isCutterResubmission) {
    updatePayload.sent_back_note = null;
    updatePayload.cutter_edit_unlocked = false;
  }

  const { error: updErr } = await supabase
    .from("cut_session_blocks")
    .update(updatePayload)
    .eq("id", sessionBlockId)
    .eq("status", block.status);
  if (updErr) return { ok: false, error: updErr.message };

  void Promise.all([
    logAudit(profile.id, "cut_approval_edited", "cut_session_block", sessionBlockId, {
      block_id: block.block_id,
      edited_by_role: profile.role,
      from_status: block.status,
      to_status: "awaiting_approval",
      is_cutter_resubmission: isCutterResubmission,
    }),
    // If cutter resubmitted, ping approvers so they re-review.
    isCutterResubmission
      ? notify(
          "cut_resubmitted",
          `Block ${block.block_id} resubmitted for approval`,
          {
            message: "Cutter has applied edits. Re-review pending approval queue.",
            entityType: "cut_session_block",
            entityId: sessionBlockId,
            actorId: profile.id,
            targetRoles: ["developer", "owner"],
          },
        )
      : Promise.resolve(),
  ]).catch((e) =>
    console.warn("[editPendingApprovalAction] cleanup failed (non-fatal)", e),
  );

  await refreshPaths();
  return { ok: true };
}

/**
 * Reverts pending_cut OR cutting back to pending_worker.
 * Also clears cutting_seq if the block was actively cutting.
 *
 * The "Cancel Cutting" button on the cutting page wires here for
 * both stages (Waiting to Cut OR In Progress) — UI only shows it
 * when the block is in one of those states.
 */
export async function undoApproveAction(formData: FormData) {
  const { profile } = await requireAuth(["owner", "team_head", "cutting_operator"]);
  const supabase = createAdminSupabaseClient();
  const sessionBlockId = String(formData.get("session_block_id") || "");
  const sessionId = String(formData.get("session_id") || "");

  // Only undo if currently pending_cut or cutting (NOT done/done_prompt/rejected)
  const { data, error } = await supabase
    .from("cut_session_blocks")
    .update({
      status: "pending_worker",
      cutting_seq: null, // free the cutter number for reuse
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionBlockId)
    .in("status", ["pending_cut", "cutting"]) // guard: only revert from these
    .select("id");

  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("Block is no longer in pending_cut or cutting state — cannot undo.");

  await logAudit(profile.id, "cutting_undo_approve", "cut_session_block", sessionBlockId, {
    session_id: sessionId,
  });

  await syncSessionStatus(sessionId);
  await refreshPaths();
}

/**
 * Donor block operator clears the "needs reprint" banner. Used after
 * they've physically reprinted the modified plan (or just dismissed
 * the warning because they understand the change).
 */
export async function acknowledgeReprintAction(formData: FormData) {
  const { profile } = await requireAuth(["owner", "team_head", "cutting_operator", "developer"]);
  const supabase = createAdminSupabaseClient();
  const sessionBlockId = String(formData.get("id") || "");
  if (!sessionBlockId) throw new Error("Block id required");

  const { error } = await supabase
    .from("cut_session_blocks")
    .update({
      needs_reprint: false,
      reprint_reason: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionBlockId);
  if (error) throw new Error(error.message);

  await logAudit(profile.id, "reprint_acknowledged", "cut_session_block", sessionBlockId);
  await refreshPaths();
}

// undoDoneAction was removed alongside the Undo button (see the
// adjacent comment block in cutting/[id]/page.tsx). The approval
// workflow added in migration 027 — Send back for edit, Allow cutter
// to edit, Reject — covers every legitimate need for changing a
// cutting submission BEFORE it commits. The Undo path was unsafe
// post-commit because it left orphan cut_done slabs every time
// extras or transfers were involved (MT-B-109, MT-B-113, MT-B-248
// were all bitten by this). Keep approvals tight; no undo.
