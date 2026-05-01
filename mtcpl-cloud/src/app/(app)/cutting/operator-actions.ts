"use server";

/**
 * Cutter operator workflow — server actions.
 *
 * Operators are floor staff (no logins). The team_head (or developer)
 * picks an operator when sending a block from Pending Approval to
 * Waiting to Cut, so the team can see who actually ran the saw.
 *
 * Initial release is gated to developer-only via canManageOperators().
 * Once the team validates the flow, widening to team_head is a one-line
 * change in cutting-permissions.ts.
 *
 * Three actions live here:
 *   • addOperatorAction          — append a new name to the picklist
 *   • approveBlockWithOperatorAction
 *                                 — combo: assign + transition to
 *                                   pending_cut. Replaces the plain
 *                                   approveBlockAction when an operator
 *                                   is provided.
 *   • assignOperatorOnlyAction   — set operator_id without changing
 *                                   the block's status (stays on
 *                                   Pending Approval). Used when the
 *                                   team_head wants to tag the block
 *                                   with an owner before approving.
 */

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { canManageOperators } from "@/lib/cutting-permissions";

async function refreshPaths() {
  revalidatePath("/cutting");
  revalidatePath("/blocks");
  revalidatePath("/dashboard");
}

/**
 * Add a new operator to the picklist. Trims + dedupes by name (case
 * insensitive). Returns the row, including its UUID so the caller can
 * immediately select the just-added operator.
 *
 * If a name is given that matches an INACTIVE operator, we re-activate
 * it instead of inserting a duplicate.
 */
export async function addOperatorAction(
  rawName: string,
): Promise<{ id?: string; name?: string; error?: string }> {
  const { profile } = await requireAuth();
  if (!canManageOperators(profile)) {
    return { error: "Not authorised to add operators." };
  }
  const name = (rawName ?? "").trim();
  if (!name) return { error: "Operator name is required." };
  if (name.length > 80) return { error: "Operator name is too long (max 80 chars)." };

  const supabase = createAdminSupabaseClient();

  // Look for an existing match (active or inactive) by trimmed-name.
  const { data: existing } = await supabase
    .from("operators")
    .select("id, name, is_active")
    .ilike("name", name)
    .limit(1)
    .maybeSingle();

  if (existing) {
    if (!existing.is_active) {
      // Re-activate
      const { error } = await supabase
        .from("operators")
        .update({ is_active: true })
        .eq("id", existing.id);
      if (error) return { error: `Failed to re-activate operator: ${error.message}` };
      await logAudit(profile.id, "operator_reactivated", "operator", existing.id, { name });
      await refreshPaths();
      return { id: existing.id, name: existing.name };
    }
    // Already active — just return the existing row so the UI can
    // select it and continue.
    return { id: existing.id, name: existing.name };
  }

  const { data, error } = await supabase
    .from("operators")
    .insert({ name, created_by: profile.id })
    .select("id, name")
    .single();
  if (error) return { error: `Failed to add operator: ${error.message}` };

  await logAudit(profile.id, "operator_added", "operator", data.id, { name });
  await refreshPaths();
  return { id: data.id, name: data.name };
}

/**
 * Pending Approval → Waiting to Cut WITH an operator assignment.
 *
 * Same status transition as the existing approveBlockAction but also
 * sets operator_id on the cut_session_block in the same update so the
 * card never shows "approved without operator" mid-render. operatorId
 * is required; passing null is a no-op (call the plain approve action
 * if you don't want an operator).
 */
export async function approveBlockWithOperatorAction(
  sessionBlockId: string,
  sessionId: string,
  operatorId: string,
): Promise<{ success?: boolean; error?: string }> {
  const { profile } = await requireAuth();
  if (!canManageOperators(profile)) {
    return { error: "Not authorised to assign operators." };
  }
  if (!sessionBlockId || !sessionId || !operatorId) {
    return { error: "Missing block, session, or operator id." };
  }

  const supabase = createAdminSupabaseClient();

  // Verify the operator exists + is active before we attach it to a block.
  const { data: op } = await supabase
    .from("operators")
    .select("id, name, is_active")
    .eq("id", operatorId)
    .maybeSingle();
  if (!op) return { error: "Selected operator no longer exists." };
  if (!op.is_active) return { error: `Operator '${op.name}' is no longer active.` };

  // Atomic: only flip from pending_worker (race guard).
  const { data: updated, error } = await supabase
    .from("cut_session_blocks")
    .update({
      status: "pending_cut",
      operator_id: operatorId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionBlockId)
    .eq("status", "pending_worker")
    .select("id");
  if (error) return { error: error.message };
  if (!updated || updated.length === 0) {
    return { error: "Block is no longer pending approval — refresh and try again." };
  }

  await supabase
    .from("cut_sessions")
    .update({ status: "in_progress" })
    .eq("id", sessionId);

  await logAudit(
    profile.id,
    "block_sent_to_cutting",
    "cut_session_block",
    sessionBlockId,
    { session_id: sessionId, operator_id: operatorId, operator_name: op.name },
  );

  await notify(
    "block_sent_to_cutting",
    `Block sent to cutting — operator ${op.name}`,
    { entityType: "cut_session_block", entityId: sessionBlockId, actorId: profile.id },
  );

  await refreshPaths();
  return { success: true };
}

/**
 * Pending Approval → Waiting to Cut WITHOUT an operator (developer
 * escape hatch — same effect as the original approveBlockAction but
 * callable from the operator modal's "Approve without operator"
 * button so the click flow stays inside the modal).
 */
export async function approveBlockSkipOperatorAction(
  sessionBlockId: string,
  sessionId: string,
): Promise<{ success?: boolean; error?: string }> {
  const { profile } = await requireAuth();
  if (!canManageOperators(profile)) {
    return { error: "Not authorised." };
  }
  if (!sessionBlockId || !sessionId) return { error: "Missing block or session id." };

  const supabase = createAdminSupabaseClient();
  const { data: updated, error } = await supabase
    .from("cut_session_blocks")
    .update({
      status: "pending_cut",
      operator_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionBlockId)
    .eq("status", "pending_worker")
    .select("id");
  if (error) return { error: error.message };
  if (!updated || updated.length === 0) {
    return { error: "Block is no longer pending approval — refresh and try again." };
  }

  await supabase
    .from("cut_sessions")
    .update({ status: "in_progress" })
    .eq("id", sessionId);

  await logAudit(profile.id, "block_sent_to_cutting", "cut_session_block", sessionBlockId, {
    session_id: sessionId,
    operator_id: null,
  });
  await refreshPaths();
  return { success: true };
}

/**
 * Assign an operator WITHOUT moving the block out of Pending Approval.
 *
 * Used when the team_head wants to tag a block with an owner before
 * the formal approval — sometimes operators get assigned days before
 * the saw is ready. Block stays at status='pending_worker'; only the
 * operator_id field changes.
 *
 * Pass operatorId=null to clear the assignment.
 */
export async function assignOperatorOnlyAction(
  sessionBlockId: string,
  operatorId: string | null,
): Promise<{ success?: boolean; error?: string; operatorName?: string | null }> {
  const { profile } = await requireAuth();
  if (!canManageOperators(profile)) {
    return { error: "Not authorised to assign operators." };
  }
  if (!sessionBlockId) return { error: "Missing block id." };

  const supabase = createAdminSupabaseClient();

  let operatorName: string | null = null;
  if (operatorId) {
    const { data: op } = await supabase
      .from("operators")
      .select("id, name, is_active")
      .eq("id", operatorId)
      .maybeSingle();
    if (!op) return { error: "Selected operator no longer exists." };
    if (!op.is_active) return { error: `Operator '${op.name}' is no longer active.` };
    operatorName = op.name;
  }

  const { error } = await supabase
    .from("cut_session_blocks")
    .update({
      operator_id: operatorId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionBlockId);
  if (error) return { error: error.message };

  await logAudit(
    profile.id,
    operatorId ? "operator_assigned" : "operator_unassigned",
    "cut_session_block",
    sessionBlockId,
    { operator_id: operatorId, operator_name: operatorName },
  );

  await refreshPaths();
  return { success: true, operatorName };
}
