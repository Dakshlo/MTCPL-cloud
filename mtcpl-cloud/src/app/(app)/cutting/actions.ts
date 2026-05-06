"use server";

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

export async function finishBlockAction(formData: FormData) {
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
  ) as Array<{ id: string; l: number; w: number; h: number; quality?: "" | "A" | "B" }>;
  const extraSlabIds = JSON.parse(String(formData.get("extra_slab_ids") || "[]")) as string[];
  // Transferred slabs — claimed from another block's plan (status='planned').
  // These cause donor block layout edits + needs_reprint flag.
  const transferredSlabIds = JSON.parse(String(formData.get("transferred_slab_ids") || "[]")) as string[];

  // Log the incoming request so we can trace failures from Vercel logs.
  console.log("[finishBlockAction] START", {
    sessionBlockId, sessionId, blockId, stone, yard,
    cutSlabIds, notCutSlabIds, extraSlabIds,
    restock, remainderCount: remainders.length,
    actor: profile.id,
  });

  try {
    // If a previous attempt already marked this block "done" but then
    // something later failed (and left the UI unable to navigate), this
    // retry should short-circuit to the redirect. Otherwise we keep
    // going.
    const { data: currentState, error: stateErr } = await supabase
      .from("cut_session_blocks")
      .select("status, restocked_block_id")
      .eq("id", sessionBlockId)
      .maybeSingle();
    if (stateErr) {
      console.error("[finishBlockAction] state check error", stateErr);
      throw new Error(`Could not read cut state: ${stateErr.message}`);
    }
    if (!currentState) {
      throw new Error(`Cut session block ${sessionBlockId} not found.`);
    }
    if (currentState.status === "done") {
      console.log("[finishBlockAction] already done — skipping to redirect");
      await refreshPaths();
      redirect("/cutting?tab=done");
    }

    const restockedIds: string[] = [];

    // Remainder block inserts are idempotent. If a previous run crashed
    // after creating them, we detect and reuse rather than error on
    // duplicate PK.
    if (restock && remainders.length > 0) {
      const ids = remainders.filter(p => p.l > 0 && p.w > 0 && p.h > 0).map(p => p.id);
      const { data: existingRows } = await supabase
        .from("blocks")
        .select("id")
        .in("id", ids);
      const existing = new Set((existingRows ?? []).map(r => r.id));

      for (const piece of remainders) {
        if (piece.l > 0 && piece.w > 0 && piece.h > 0) {
          if (existing.has(piece.id)) {
            restockedIds.push(piece.id);
            continue;
          }
          // Quality on the remainder — operator picks per-piece.
          // Empty string from the form means "Both" (no preference)
          // which we persist as NULL so the inventory dropdowns
          // show it as unset, not as a specific grade.
          const remainderQuality =
            piece.quality === "A" || piece.quality === "B" ? piece.quality : null;
          const { error } = await supabase.from("blocks").insert({
            id: piece.id,
            stone,
            yard,
            category: "Reused",
            length_ft: piece.l,
            width_ft: piece.w,
            height_ft: piece.h,
            quality: remainderQuality,
            status: "available",
            created_by: profile.id,
            updated_by: profile.id,
          });
          if (error) {
            if (/duplicate key/i.test(error.message)) {
              console.warn("[finishBlockAction] duplicate block on insert (benign)", piece.id);
            } else {
              console.error("[finishBlockAction] insert remainder failed", { piece, error });
              throw new Error(`Failed to create block ${piece.id}: ${error.message}`);
            }
          }
          restockedIds.push(piece.id);
        }
      }
    }

    const restockedBlockId = restockedIds.length > 0 ? restockedIds.join(",") : null;

    // Mark parent block consumed.
    const parentUpdate = await supabase
      .from("blocks")
      .update({ status: "consumed", updated_by: profile.id, updated_at: new Date().toISOString() })
      .eq("id", blockId);
    if (parentUpdate.error) {
      console.error("[finishBlockAction] parent update error", parentUpdate.error);
      throw new Error(`Failed to mark parent block ${blockId} consumed: ${parentUpdate.error.message}`);
    }

    if (cutSlabIds.length) {
      const r = await supabase
        .from("slab_requirements")
        .update({ status: "cut_done", updated_by: profile.id, updated_at: new Date().toISOString() })
        .in("id", cutSlabIds);
      if (r.error) {
        console.error("[finishBlockAction] cut slabs update error", r.error);
        throw new Error(`Failed to mark slabs cut_done: ${r.error.message}`);
      }
    }

    if (notCutSlabIds.length) {
      const r = await supabase
        .from("slab_requirements")
        .update({ status: "open", source_block_id: null, updated_by: profile.id, updated_at: new Date().toISOString() })
        .in("id", notCutSlabIds);
      if (r.error) {
        console.error("[finishBlockAction] reset uncut slabs error", r.error);
        throw new Error(`Failed to reset uncut slabs: ${r.error.message}`);
      }
    }

    if (extraSlabIds.length > 0) {
      const { data: updated, error: extraErr } = await supabase
        .from("slab_requirements")
        .update({
          status: "cut_done",
          source_block_id: blockId,
          updated_by: profile.id,
          updated_at: new Date().toISOString(),
        })
        .in("id", extraSlabIds)
        .eq("status", "open")
        .select("id");
      if (extraErr) {
        console.error("[finishBlockAction] extra slabs error", extraErr);
        throw new Error(extraErr.message);
      }
      if ((updated?.length ?? 0) !== extraSlabIds.length) {
        throw new Error("One or more unplanned slabs were already taken by another operation. Refresh and try again.");
      }
    }

    // ── Transferred slabs — claimed from another block's plan ───────
    // The operator cut a slab that was planned for a DIFFERENT block.
    // Permission-gated: only developer + specific named owners (Naresh,
    // Rajesh Kumar) per cutting-permissions.ts. Atomic side effects:
    //   1. Validate each slab is planned + on a donor block in
    //      pending_worker or cutting state.
    //   2. Strip the slab from each donor's layout.placed[] array.
    //   3. Delete the donor's cut_session_slabs link row.
    //   4. Mark donor.needs_reprint=TRUE with a reason string.
    //   5. Update slab_requirements: status='cut_done', source_block_id
    //      = THIS block (with .eq("status","planned") race guard).
    //   6. Notify donor's operators via realtime + notification bell.
    if (transferredSlabIds.length > 0) {
      const { canTransferPlannedSlabs } = await import("@/lib/cutting-permissions");
      if (!canTransferPlannedSlabs(profile)) {
        throw new Error(
          "You do not have permission to transfer slabs from another block's plan. Contact a developer or authorised owner.",
        );
      }

      // 1. Look up donor link rows for each transferred slab
      const { data: donorLinks, error: donorErr } = await supabase
        .from("cut_session_slabs")
        .select(`
          id, cut_session_block_id, slab_requirement_id,
          block:cut_session_blocks(id, status, layout, block_id)
        `)
        .in("slab_requirement_id", transferredSlabIds);
      if (donorErr) throw new Error(`Donor lookup failed: ${donorErr.message}`);
      if (!donorLinks || donorLinks.length !== transferredSlabIds.length) {
        throw new Error(
          "One or more transferred slabs are no longer planned anywhere — refresh and retry.",
        );
      }

      // 2. Validate every donor is in pending_worker | pending_cut | cutting
      type DonorBlockLite = {
        id: string;
        status: string;
        layout: { blk?: unknown; placed?: Array<{ id: string }> } | null;
        block_id: string;
      };
      type DonorLinkRow = {
        id: string;
        cut_session_block_id: string;
        slab_requirement_id: string;
        block: DonorBlockLite | DonorBlockLite[] | null;
      };
      const linkRows = donorLinks as unknown as DonorLinkRow[];
      function asBlock(b: DonorBlockLite | DonorBlockLite[] | null): DonorBlockLite | null {
        if (!b) return null;
        return Array.isArray(b) ? b[0] ?? null : b;
      }
      for (const link of linkRows) {
        const donor = asBlock(link.block);
        if (!donor) {
          throw new Error(`Slab ${link.slab_requirement_id} has no donor block — cannot transfer.`);
        }
        if (donor.status !== "pending_worker" && donor.status !== "pending_cut" && donor.status !== "cutting") {
          throw new Error(
            `Slab ${link.slab_requirement_id} cannot be transferred — donor block is in '${donor.status}' state.`,
          );
        }
        if (link.cut_session_block_id === sessionBlockId) {
          throw new Error(
            `Slab ${link.slab_requirement_id} is already on this block — cannot transfer to itself.`,
          );
        }
      }

      // 3. Group by donor block — one layout-edit per donor
      const byDonor = new Map<string, { donor: DonorBlockLite; slabIds: string[] }>();
      for (const link of linkRows) {
        const donor = asBlock(link.block);
        if (!donor) continue;
        const entry = byDonor.get(link.cut_session_block_id) ?? { donor, slabIds: [] };
        entry.slabIds.push(link.slab_requirement_id);
        byDonor.set(link.cut_session_block_id, entry);
      }

      // 4. For each donor: edit layout, delete link rows, mark needs_reprint, notify
      const dateStr = new Date().toISOString().slice(0, 10);
      for (const [donorId, { donor, slabIds }] of byDonor) {
        const placed = (donor.layout?.placed ?? []).filter((p) => !slabIds.includes(p.id));
        const newLayout = { ...(donor.layout ?? {}), placed };

        const { error: updErr } = await supabase
          .from("cut_session_blocks")
          .update({
            layout: newLayout,
            needs_reprint: true,
            reprint_reason: `${slabIds.length} slab(s) transferred to ${blockId} on ${dateStr}: ${slabIds.join(", ")}`,
            updated_at: new Date().toISOString(),
          })
          .eq("id", donorId);
        if (updErr) throw new Error(`Donor layout update failed: ${updErr.message}`);

        await supabase
          .from("cut_session_slabs")
          .delete()
          .eq("cut_session_block_id", donorId)
          .in("slab_requirement_id", slabIds);

        await notify(
          "slab_transferred_from",
          `${slabIds.length} slab(s) moved away from ${donor.block_id}`,
          {
            message: `Claimed by ${blockId}: ${slabIds.join(", ")}. Reprint plan before cutting.`,
            entityType: "cut_session_block",
            entityId: donorId,
            actorId: profile.id,
            targetRoles: ["cutting_operator", "team_head", "developer"],
          },
        );
      }

      // 5. Update slab_requirements: planned → cut_done. Race guard
      //    via .eq("status","planned") so a stale request can't double-claim.
      const { data: transferUpdated, error: transferUpdErr } = await supabase
        .from("slab_requirements")
        .update({
          status: "cut_done",
          source_block_id: blockId,
          updated_by: profile.id,
          updated_at: new Date().toISOString(),
        })
        .in("id", transferredSlabIds)
        .eq("status", "planned")
        .select("id");
      if (transferUpdErr) throw new Error(`Transfer update failed: ${transferUpdErr.message}`);
      if ((transferUpdated?.length ?? 0) !== transferredSlabIds.length) {
        throw new Error(
          "Some transferred slabs were already cut or rejected by another operator. Refresh and retry.",
        );
      }

      await logAudit(profile.id, "slab_transferred_in", "cut_session_block", sessionBlockId, {
        transferred_slabs: transferredSlabIds,
        donors: [...byDonor.keys()],
      });
    }

    // Critical: mark the cut as done. Try WITH updated_by first — if the
    // column doesn't exist on cut_session_blocks (possible given the
    // schema.sql is out of date with prod), fall back to a minimal
    // update that just sets the status + restocked_block_id.
    let doneErr = await supabase
      .from("cut_session_blocks")
      .update({
        status: "done",
        restocked_block_id: restockedBlockId,
        // Free up the cutter sequence number so it can be reused by
        // the next block that enters cutting state.
        cutting_seq: null,
        // Reprint flag is irrelevant once the block is done.
        needs_reprint: false,
        reprint_reason: null,
        updated_by: profile.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionBlockId);

    if (doneErr.error && /updated_by|cutting_seq|needs_reprint|column/i.test(doneErr.error.message)) {
      console.warn("[finishBlockAction] some columns not accepted on cut_session_blocks, retrying with minimal set", doneErr.error.message);
      doneErr = await supabase
        .from("cut_session_blocks")
        .update({
          status: "done",
          restocked_block_id: restockedBlockId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", sessionBlockId);
    }

    if (doneErr.error) {
      console.error("[finishBlockAction] done update error", doneErr.error);
      throw new Error(`Failed to mark cut as done: ${doneErr.error.message}`);
    }

    const hasDeviation = extraSlabIds.length > 0 || transferredSlabIds.length > 0;
    await logAudit(
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
    );

    await notify("cut_done", `Block ${blockId} cutting completed`, {
      message: `${cutSlabIds.length} slab(s) cut${restockedIds.length > 0 ? ` · ${restockedIds.length} restocked` : ""}${extraSlabIds.length > 0 ? ` · ${extraSlabIds.length} unplanned` : ""}${transferredSlabIds.length > 0 ? ` · ${transferredSlabIds.length} transferred from other plans` : ""}`,
      entityType: "cut_session_block",
      entityId: sessionBlockId,
      actorId: profile.id,
    });

    await syncSessionStatus(sessionId);
    await refreshPaths();
    console.log("[finishBlockAction] SUCCESS", { sessionBlockId, blockId });
  } catch (err) {
    // Don't swallow Next's redirect signal — let it propagate so the
    // browser actually navigates.
    if (err && typeof err === "object" && "digest" in err && typeof (err as { digest?: unknown }).digest === "string" && (err as { digest: string }).digest.startsWith("NEXT_REDIRECT")) {
      throw err;
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[finishBlockAction] FAILED", {
      sessionBlockId, sessionId, blockId,
      cutSlabIds, notCutSlabIds, extraSlabIds,
      restock, remainderCount: remainders.length,
      error: msg,
      stack: err instanceof Error ? err.stack : null,
    });
    throw err;
  }

  // redirect() throws NEXT_REDIRECT internally — must live outside the
  // try/catch above so our catch doesn't swallow it.
  redirect("/cutting?tab=done");
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
