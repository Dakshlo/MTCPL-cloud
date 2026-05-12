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
  | { ok: true; alreadyDone?: boolean }
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
    // Permission gate for transfers — the PG function trusts callers
    // (it's SECURITY DEFINER), so the auth check has to live here.
    if (transferredSlabIds.length > 0) {
      const { canTransferPlannedSlabs } = await import("@/lib/cutting-permissions");
      if (!canTransferPlannedSlabs(profile)) {
        throw new Error(
          "You do not have permission to transfer slabs from another block's plan. Contact a developer or authorised owner.",
        );
      }
    }

    // ── ATOMIC RPC ───────────────────────────────────────────────
    // Everything below — remainder inserts, parent block update,
    // slab status flips, donor layout edits, transfer link
    // teardown, cut_session_block done flip — runs as ONE Postgres
    // function call inside ONE transaction. Single round-trip,
    // single timeout window, single rollback boundary. Replaces
    // ~18 sequential round-trips that were causing recurring
    // partial-commit timeouts on the cutting floor.
    //
    // Migration 018_finish_block_cut_rpc.sql installs the function.
    // Run the migration in Supabase SQL Editor before this code
    // hits production.
    const tStart = Date.now();
    const { data: rpcData, error: rpcErr } = await supabase.rpc("finish_block_cut", {
      p_session_block_id: sessionBlockId,
      p_session_id: sessionId,
      p_block_id: blockId,
      p_stone: stone,
      p_yard: yard,
      p_actor: profile.id,
      p_cut_slab_ids: cutSlabIds,
      p_not_cut_slab_ids: notCutSlabIds,
      p_extra_slab_ids: extraSlabIds,
      p_transferred_slab_ids: transferredSlabIds,
      // Pass remainders as-is — the PG function reads l/w/h/quality/yard/id off each.
      p_remainders: remainders,
      p_restock: restock,
      // Optional — applied to every slab the RPC touches.
      // Migration 020 adds slab_requirements.stock_location +
      // teaches the RPC to consume this parameter.
      p_stock_location: stockLocation,
    });
    console.log(`[finishBlockAction] RPC finish_block_cut returned in ${Date.now() - tStart}ms`);

    if (rpcErr) {
      console.error("[finishBlockAction] RPC error", rpcErr);
      // Surface the PG function's RAISE EXCEPTION message verbatim
      // so the operator sees what actually failed.
      throw new Error(rpcErr.message ?? "Cutting Done RPC failed without a message.");
    }

    const result = (rpcData ?? {}) as {
      success?: boolean;
      already_done?: boolean;
      restocked_block_id?: string | null;
      restocked_count?: number;
      extras_committed?: number;
      transfers_committed?: number;
      transfer_donor_blocks?: string[];
      transfer_donor_session_block_ids?: string[];
      already_done_slab_ids?: string[];
    };

    if (result.already_done) {
      console.log("[finishBlockAction] block was already done — skipping cleanup");
      await refreshPaths();
      return { ok: true, alreadyDone: true };
    }

    // Reconstruct the values the cleanup phase needs.
    const restockedBlockId = result.restocked_block_id ?? null;
    const restockedIds: string[] = restockedBlockId ? restockedBlockId.split(",").filter(Boolean) : [];
    const transferDonorBlocks = result.transfer_donor_blocks ?? [];
    const transferDonorCsbIds = result.transfer_donor_session_block_ids ?? [];

    // Fire-and-forget donor notifications outside the critical path.
    // The PG function already flipped donor needs_reprint=true so the
    // banner shows even if these notify calls fail.
    if (transferDonorCsbIds.length > 0) {
      void Promise.all(
        transferDonorCsbIds.map((donorId, i) => {
          const donorBlockId = transferDonorBlocks[i] ?? donorId;
          return notify(
            "slab_transferred_from",
            `Slab(s) moved away from ${donorBlockId}`,
            {
              message: `Claimed by ${blockId}. Reprint plan before cutting.`,
              entityType: "cut_session_block",
              entityId: donorId,
              actorId: profile.id,
              targetRoles: ["cutting_operator", "team_head", "developer"],
            },
          ).catch((e) =>
            console.warn(`[finishBlockAction] donor ${donorBlockId} notify failed (non-fatal)`, e),
          );
        }),
      );

      // Audit the transfer-in event (fire-and-forget).
      logAudit(profile.id, "slab_transferred_in", "cut_session_block", sessionBlockId, {
        transferred_slabs: transferredSlabIds,
        donor_blocks: transferDonorBlocks,
        donor_session_block_ids: transferDonorCsbIds,
      }).catch((e) => console.warn("[finishBlockAction] audit slab_transferred_in failed (non-fatal)", e));
    }

    // ── Critical path complete — the block is now officially done. ──
    // Everything below is bookkeeping (audit log, notification feed,
    // session-status sync, path revalidation). Run them in parallel
    // and treat individual failures as warnings, not errors — none of
    // them affect the integrity of the cut record itself, but we still
    // want to await before redirect so the next page render sees fresh
    // data.
    const hasDeviation = extraSlabIds.length > 0 || transferredSlabIds.length > 0;
    const cleanupResults = await Promise.allSettled([
      logAudit(
        profile.id,
        hasDeviation ? "cutting_done_with_deviation" : "cutting_done",
        "cut_session_block",
        sessionBlockId,
        {
          session_id: sessionId,
          block_id: blockId,
          cut_slabs: cutSlabIds,
          not_cut_slabs: notCutSlabIds,
          restocked_blocks: restockedIds,
          restock,
          ...(extraSlabIds.length > 0 ? { extra_slabs: extraSlabIds } : {}),
          ...(transferredSlabIds.length > 0 ? { transferred_slabs: transferredSlabIds } : {}),
        },
      ),
      notify("cut_done", `Block ${blockId} cutting completed`, {
        message: `${cutSlabIds.length} slab(s) cut${restockedIds.length > 0 ? ` · ${restockedIds.length} restocked` : ""}${extraSlabIds.length > 0 ? ` · ${extraSlabIds.length} unplanned` : ""}${transferredSlabIds.length > 0 ? ` · ${transferredSlabIds.length} transferred from other plans` : ""}`,
        entityType: "cut_session_block",
        entityId: sessionBlockId,
        actorId: profile.id,
      }),
      syncSessionStatus(sessionId),
    ]);
    for (const r of cleanupResults) {
      if (r.status === "rejected") {
        console.warn("[finishBlockAction] post-done cleanup task failed (non-fatal)", r.reason);
      }
    }
    await refreshPaths();
    console.log("[finishBlockAction] SUCCESS", { sessionBlockId, blockId });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[finishBlockAction] FAILED", {
      sessionBlockId, sessionId, blockId,
      cutSlabIds, notCutSlabIds, extraSlabIds,
      restock, remainderCount: remainders.length,
      error: msg,
      stack: err instanceof Error ? err.stack : null,
    });
    // No NEXT_REDIRECT re-throw branch — the happy path now returns
    // `{ ok: true }` and the client does router.push, so any thrown
    // error here is a genuine failure to surface.
    return { ok: false, error: msg };
  }
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
