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

export async function approveBlockAction(formData: FormData) {
  const { profile } = await requireAuth(["owner", "team_head", "cutting_operator"]);
  const supabase = createAdminSupabaseClient();
  const sessionBlockId = String(formData.get("session_block_id") || "");
  const sessionId = String(formData.get("session_id") || "");

  const { error } = await supabase
    .from("cut_session_blocks")
    .update({ status: "cutting", updated_at: new Date().toISOString() })
    .eq("id", sessionBlockId);
  if (error) throw new Error(error.message);

  await supabase
    .from("cut_sessions")
    .update({ status: "in_progress" })
    .eq("id", sessionId);

  await logAudit(profile.id, "cutting_started", "cut_session_block", sessionBlockId, {
    session_id: sessionId,
  });

  await notify("cut_started", `Block cutting started`, {
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
  ) as Array<{ id: string; l: number; w: number; h: number }>;
  const extraSlabIds = JSON.parse(String(formData.get("extra_slab_ids") || "[]")) as string[];

  const restockedIds: string[] = [];

  // Remainder block inserts are idempotent — if a previous run of this
  // action crashed AFTER creating the blocks but BEFORE updating the
  // session-block to "done", the blocks will already exist. On retry we
  // detect them and skip instead of blowing up with a duplicate-key
  // error that would permanently stuck the cut in "cutting" status.
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
          // Already created on an earlier attempt — reuse.
          restockedIds.push(piece.id);
          continue;
        }
        const { error } = await supabase.from("blocks").insert({
          id: piece.id,
          stone,
          yard,
          category: "Reused",
          length_ft: piece.l,
          width_ft: piece.w,
          height_ft: piece.h,
          status: "available",
          created_by: profile.id,
          updated_by: profile.id,
        });
        if (error) {
          // Benign duplicate (race) — treat as already-exists and keep going.
          if (!/duplicate key/i.test(error.message)) {
            throw new Error(`Failed to create block ${piece.id}: ${error.message}`);
          }
        }
        restockedIds.push(piece.id);
      }
    }
  }

  const restockedBlockId = restockedIds.length > 0 ? restockedIds.join(",") : null;

  // Mark parent block consumed. Failure here is unusual but if it
  // happens we want to surface it — not silently leave the block
  // available after it's been cut up.
  const parentErr = await supabase
    .from("blocks")
    .update({ status: "consumed", updated_by: profile.id, updated_at: new Date().toISOString() })
    .eq("id", blockId);
  if (parentErr.error) {
    throw new Error(`Failed to mark parent block ${blockId} consumed: ${parentErr.error.message}`);
  }

  if (cutSlabIds.length) {
    const r = await supabase
      .from("slab_requirements")
      .update({ status: "cut_done", updated_by: profile.id, updated_at: new Date().toISOString() })
      .in("id", cutSlabIds);
    if (r.error) throw new Error(`Failed to mark slabs cut_done: ${r.error.message}`);
  }

  if (notCutSlabIds.length) {
    const r = await supabase
      .from("slab_requirements")
      .update({ status: "open", source_block_id: null, updated_by: profile.id, updated_at: new Date().toISOString() })
      .in("id", notCutSlabIds);
    if (r.error) throw new Error(`Failed to reset uncut slabs: ${r.error.message}`);
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
    if (extraErr) throw new Error(extraErr.message);
    if ((updated?.length ?? 0) !== extraSlabIds.length) {
      throw new Error("One or more unplanned slabs were already taken by another operation. Refresh and try again.");
    }
  }

  // Critical step — this is what moves the card from "In Progress" to
  // "Done today". If this fails everything above is wasted, so we check
  // the error and surface it loudly.
  const doneResult = await supabase
    .from("cut_session_blocks")
    .update({ status: "done", restocked_block_id: restockedBlockId, updated_by: profile.id, updated_at: new Date().toISOString() })
    .eq("id", sessionBlockId)
    .select("id");
  if (doneResult.error) {
    throw new Error(`Failed to mark cut as done: ${doneResult.error.message}`);
  }
  if (!doneResult.data || doneResult.data.length === 0) {
    throw new Error(`Cut session block ${sessionBlockId} was not updated — it may have been deleted or is no longer in cutting state.`);
  }

  await logAudit(
    profile.id,
    extraSlabIds.length > 0 ? "cutting_done_with_deviation" : "cutting_done",
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
    }
  );

  await notify("cut_done", `Block ${blockId} cutting completed`, {
    message: `${cutSlabIds.length} slab(s) cut${restockedIds.length > 0 ? ` · ${restockedIds.length} restocked` : ""}${extraSlabIds.length > 0 ? " · with deviation" : ""}`,
    entityType: "cut_session_block",
    entityId: sessionBlockId,
    actorId: profile.id,
  });

  await syncSessionStatus(sessionId);
  await refreshPaths();
  redirect("/cutting?tab=done");
}

export async function undoApproveAction(formData: FormData) {
  const { profile } = await requireAuth(["owner", "team_head", "cutting_operator"]);
  const supabase = createAdminSupabaseClient();
  const sessionBlockId = String(formData.get("session_block_id") || "");
  const sessionId = String(formData.get("session_id") || "");

  // Only undo if still in cutting state (not done/done_prompt)
  const { data, error } = await supabase
    .from("cut_session_blocks")
    .update({ status: "pending_worker", updated_at: new Date().toISOString() })
    .eq("id", sessionBlockId)
    .eq("status", "cutting") // guard: only revert if actually still in cutting
    .select("id");

  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("Block is no longer in cutting state — cannot undo.");

  await logAudit(profile.id, "cutting_undo_approve", "cut_session_block", sessionBlockId, {
    session_id: sessionId,
  });

  await syncSessionStatus(sessionId);
  await refreshPaths();
}

export async function undoDoneAction(formData: FormData) {
  const { profile } = await requireAuth(["owner"]);
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

  await supabase
    .from("cut_session_blocks")
    .update({ status: "cutting", restocked_block_id: null })
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
  });

  await refreshPaths();
  redirect(`/cutting/${sessionBlockId}`);
}
