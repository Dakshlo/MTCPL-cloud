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
        sent_back_at: null,
        sent_back_by: null,
        sent_back_note: null,
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
 * Send a pending-approval block back to the cutter for edits.
 * Approver-only. Flips status to 'awaiting_cutter_edit' and
 * stores an optional note ("check slab X — looks like it wasn't
 * cut"). The cutter sees the Edit button on their next visit and
 * the note prominently. Resubmission flips back to
 * 'awaiting_approval'.
 */
export async function requestCutterEditAction(
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { profile } = await requireAuth(["developer", "owner", "team_head"]);
  const { canApproveCuts } = await import("@/lib/cutting-permissions");
  if (!canApproveCuts(profile)) {
    return { ok: false, error: "You do not have permission to send cuts back." };
  }
  const supabase = createAdminSupabaseClient();

  const sessionBlockId = String(formData.get("session_block_id") || "");
  const note = (String(formData.get("note") || "")).trim() || null;
  if (!sessionBlockId) return { ok: false, error: "Missing session_block_id" };

  const { data: blockRow } = await supabase
    .from("cut_session_blocks")
    .select("id, status, block_id, submitted_for_approval_by")
    .eq("id", sessionBlockId)
    .maybeSingle();
  if (!blockRow) return { ok: false, error: "Block not found." };
  const block = blockRow as {
    id: string;
    status: string;
    block_id: string;
    submitted_for_approval_by: string | null;
  };
  if (block.status !== "awaiting_approval") {
    return {
      ok: false,
      error: `Block is not awaiting approval (status: ${block.status}).`,
    };
  }

  const now = new Date().toISOString();
  const { error: updErr } = await supabase
    .from("cut_session_blocks")
    .update({
      status: "awaiting_cutter_edit",
      sent_back_at: now,
      sent_back_by: profile.id,
      sent_back_note: note,
      updated_at: now,
    })
    .eq("id", sessionBlockId)
    .eq("status", "awaiting_approval");
  if (updErr) return { ok: false, error: updErr.message };

  void Promise.all([
    logAudit(profile.id, "cut_sent_back_for_edit", "cut_session_block", sessionBlockId, {
      block_id: block.block_id,
      note,
    }),
    notify(
      "cut_sent_back",
      `Block ${block.block_id} sent back for edit`,
      {
        message: note ?? "Approver requested changes.",
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
    .select("id, status, block_id, submitted_for_approval_by, cut_session_id")
    .eq("id", sessionBlockId)
    .maybeSingle();
  if (!blockRow) return { ok: false, error: "Block not found." };
  const block = blockRow as {
    id: string;
    status: string;
    block_id: string;
    submitted_for_approval_by: string | null;
    cut_session_id: string;
  };

  const { canApproveCuts } = await import("@/lib/cutting-permissions");
  const isApprover = canApproveCuts(profile);
  const isOriginalSubmitter = block.submitted_for_approval_by === profile.id;

  let nextStatus: "awaiting_approval" | "awaiting_cutter_edit";
  if (block.status === "awaiting_approval") {
    // Only approvers can edit while in approval queue (cutters are
    // locked out per Daksh's request — they can only edit when sent
    // back).
    if (!isApprover) {
      return {
        ok: false,
        error:
          "You can only edit when the approver sends the block back for edit. Wait for review.",
      };
    }
    nextStatus = "awaiting_approval";
  } else if (block.status === "awaiting_cutter_edit") {
    // Cutter must own the block (or be an approver, who can also
    // step in if the cutter is unavailable).
    if (!isApprover && !isOriginalSubmitter) {
      // Fallback: allow cutting_operator role broadly. Floor reality
      // is the same cutter doesn't always re-log in.
      if (profile.role !== "cutting_operator") {
        return {
          ok: false,
          error: "Only the original cutter or an approver can edit this block.",
        };
      }
    }
    nextStatus = "awaiting_approval"; // cutter resubmits → back to queue
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

  const updatePayload: Record<string, unknown> = {
    pending_approval_payload: payload,
    approval_edited_at: now,
    approval_edited_by: profile.id,
    status: nextStatus,
    updated_at: now,
  };
  // When the cutter resubmits, clear the send-back trail.
  if (block.status === "awaiting_cutter_edit") {
    updatePayload.sent_back_note = null;
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
      to_status: nextStatus,
    }),
    // If cutter resubmitted, ping approvers.
    block.status === "awaiting_cutter_edit"
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

export async function undoDoneAction(formData: FormData) {
  // Allow any role through requireAuth; permission is then refined
  // below to: developer | owner | trusted-named-owner. This matches
  // the UI gate so a button click can never produce a 403.
  const { profile } = await requireAuth();
  const { canTransferPlannedSlabs } = await import("@/lib/cutting-permissions");
  if (
    profile.role !== "developer" &&
    profile.role !== "owner" &&
    !canTransferPlannedSlabs(profile)
  ) {
    redirect("/cutting?toast=Only+owners+can+undo+a+cut");
  }
  const supabase = createAdminSupabaseClient();
  const sessionBlockId = String(formData.get("session_block_id") || "");
  const blockId = String(formData.get("block_id") || "");
  const slabIds = JSON.parse(String(formData.get("slab_ids") || "[]")) as string[];
  const restockedBlockId = String(formData.get("restocked_block_id") || "");
  const sessionId = String(formData.get("session_id") || "");

  await supabase
    .from("blocks")
    .update({ status: "reserved", updated_by: profile.id, updated_at: new Date().toISOString() })
    .eq("id", blockId);

  if (restockedBlockId) {
    const ids = restockedBlockId.split(",").map((s) => s.trim()).filter(Boolean);
    if (ids.length > 0) await supabase.from("blocks").delete().in("id", ids);
  }

  if (slabIds.length) {
    await supabase
      .from("slab_requirements")
      .update({ status: "planned", updated_by: profile.id, updated_at: new Date().toISOString() })
      .in("id", slabIds);
  }

  // Re-assign a cutter sequence number when reverting back to cutting.
  // Same facility-scoped lowest-unused logic used by startCuttingAction.
  const { facilityOfYard: facilityOfYardUndo } = await import("@/lib/yards");
  const { data: undoBlockRow } = await supabase
    .from("cut_session_blocks")
    .select("layout")
    .eq("id", sessionBlockId)
    .maybeSingle();
  const undoYard = (undoBlockRow?.layout as { blk?: { yard?: number } } | null)?.blk?.yard;
  const undoFacility = facilityOfYardUndo(undoYard);
  const { data: inUseAtUndo } = await supabase
    .from("cut_session_blocks")
    .select("cutting_seq, layout")
    .eq("status", "cutting")
    .not("cutting_seq", "is", null);
  const usedAtUndo = new Set<number>();
  for (const r of inUseAtUndo ?? []) {
    const y = (r.layout as { blk?: { yard?: number } } | null)?.blk?.yard;
    if (facilityOfYardUndo(y) === undoFacility && typeof r.cutting_seq === "number") {
      usedAtUndo.add(r.cutting_seq);
    }
  }
  let undoSeq = 1;
  while (usedAtUndo.has(undoSeq)) undoSeq++;

  await supabase
    .from("cut_session_blocks")
    .update({ status: "cutting", cutting_seq: undoSeq, restocked_block_id: null })
    .eq("id", sessionBlockId);

  await supabase
    .from("cut_sessions")
    .update({ status: "in_progress" })
    .eq("id", sessionId);

  await logAudit(profile.id, "cutting_undo_done", "cut_session_block", sessionBlockId, {
    session_id: sessionId,
    block_id: blockId,
    slabs_reverted: slabIds,
    restocked_block_id: restockedBlockId || null,
    cutting_seq: undoSeq,
  });

  await refreshPaths();
  redirect(`/cutting/${sessionBlockId}`);
}
