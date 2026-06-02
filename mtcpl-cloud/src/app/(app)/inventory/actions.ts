"use server";

// ──────────────────────────────────────────────────────────────────
// Migration 041 — Inventory module server actions (Scaffolding v1)
// ──────────────────────────────────────────────────────────────────
// Every write to the inventory tables goes through here. Each
// action gates on a permission helper from inventory-permissions.ts,
// hits the admin client (RLS is read-only for authenticated), logs
// to audit_logs, fires a notify(), and revalidates the relevant
// routes. Result tuples `{ ok: true } | { ok: false; error }` match
// the rest of the codebase.
//
// Movement state machine:
//
//   pending_approval ─[approve]──► approved (counted)
//        │
//        ├─[storekeeper edits + resubmits]─► (new batch, old goes to rejected/cancelled)
//        ├─[reject + note]─► rejected
//        └─[cancel]─► cancelled
//
// Approved movements are immutable. To correct an approved movement,
// record a reversing movement (e.g. return after a bad issue).
//
// Per Daksh: storekeeper proposes, crosscheck (Mafat) OR owner
// approves. The storekeeper never approves their own work.
// ──────────────────────────────────────────────────────────────────

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import {
  canApproveInventoryMovements,
  canManageInventory,
  canManageScaffoldingComponents,
  canManageSites,
} from "@/lib/inventory-permissions";

type ActionResult = { ok: true } | { ok: false; error: string };

async function refreshInventoryPaths() {
  revalidatePath("/inventory");
  revalidatePath("/inventory/scaffolding");
  revalidatePath("/inventory/scaffolding/history");
  revalidatePath("/inventory/scaffolding/sites");
  revalidatePath("/inventory/scaffolding/components");
  revalidatePath("/inventory/approvals");
  revalidatePath("/inventory/scaffolding/issue");
  revalidatePath("/inventory/scaffolding/return");
  revalidatePath("/inventory/scaffolding/receive");
  revalidatePath("/inventory/scaffolding/writeoff");
  revalidatePath("/(app)/layout", "layout");
}

const PG_UNIQUE_VIOLATION = "23505";

type MovementType = "issue" | "return" | "receive" | "writeoff";

// ──────────────────────────────────────────────────────────────────
// Stock arithmetic
// ──────────────────────────────────────────────────────────────────
// On-hand qty for a (component, site) pair is the net of approved
// movements that land at that site minus those that leave it.
// Pending movements that would leave a site are subtracted from the
// "available" qty so the storekeeper can't propose the same items
// twice while the first proposal is still in the queue.
// ──────────────────────────────────────────────────────────────────

type StockBucket = {
  approved_in: number;
  approved_out: number;
  pending_out: number;
};

async function getStockForComponentAtSite(
  componentId: string,
  siteId: string,
): Promise<StockBucket> {
  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from("inventory_movements")
    .select("qty, status, from_site_id, to_site_id")
    .eq("component_id", componentId)
    .in("status", ["approved", "pending_approval"])
    .or(`from_site_id.eq.${siteId},to_site_id.eq.${siteId}`);
  if (error) throw new Error(`stock query failed: ${error.message}`);

  let approved_in = 0;
  let approved_out = 0;
  let pending_out = 0;
  for (const row of data ?? []) {
    const qty = Number(row.qty ?? 0);
    const toMe = row.to_site_id === siteId;
    const fromMe = row.from_site_id === siteId;
    if (row.status === "approved") {
      if (toMe) approved_in += qty;
      if (fromMe) approved_out += qty;
    } else if (row.status === "pending_approval") {
      if (fromMe) pending_out += qty;
    }
  }
  return { approved_in, approved_out, pending_out };
}

function onHand(b: StockBucket): number {
  return b.approved_in - b.approved_out;
}

function available(b: StockBucket): number {
  return onHand(b) - b.pending_out;
}

async function getPlantSiteId(): Promise<string> {
  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from("sites")
    .select("id")
    .eq("is_plant", true)
    .single();
  if (error || !data) {
    throw new Error("Plant site row missing — re-run migration 041");
  }
  return data.id as string;
}

// ──────────────────────────────────────────────────────────────────
// Propose a movement batch
// ──────────────────────────────────────────────────────────────────

/**
 * Storekeeper-side proposal. Accepts one or more (component, qty)
 * pairs in a single batch — they're approved or rejected together.
 *
 * FormData shape:
 *   movement_type   : 'issue' | 'return' | 'receive' | 'writeoff'
 *   site_id         : project-site UUID for issue/return/writeoff;
 *                     ignored for receive (vendor → plant)
 *   batch_note      : optional free text (driver name, vehicle, etc.)
 *   component_ids[] : N component UUIDs
 *   qtys[]          : N numbers, aligned with component_ids[]
 *   notes[]         : optional N strings, aligned. Empty strings allowed.
 */
export async function proposeMovementAction(
  formData: FormData,
): Promise<
  | { ok: true; batchId: string; rowCount: number }
  | { ok: false; error: string }
> {
  const { profile } = await requireAuth();
  if (!canManageInventory(profile)) {
    return { ok: false, error: "You don't have permission to manage inventory." };
  }

  const movementTypeRaw = String(formData.get("movement_type") || "").trim();
  if (!["issue", "return", "receive", "writeoff"].includes(movementTypeRaw)) {
    return { ok: false, error: "Pick a valid movement type." };
  }
  const movementType = movementTypeRaw as MovementType;

  const projectSiteId = String(formData.get("site_id") || "").trim() || null;
  const batchNote = String(formData.get("batch_note") || "").trim() || null;

  const componentIds = formData.getAll("component_ids[]").map((v) => String(v));
  const qtys = formData.getAll("qtys[]").map((v) => Number(v));
  const notes = formData
    .getAll("notes[]")
    .map((v) => String(v ?? "").trim() || null);

  if (componentIds.length === 0) {
    return { ok: false, error: "Add at least one component to the batch." };
  }
  if (componentIds.length !== qtys.length) {
    return { ok: false, error: "Component / qty list mismatch." };
  }
  // Daksh — scaffolding ships in whole pieces. Reject non-integer
  // quantities at the API boundary (client filters too, but a curl
  // call or autofill could still sneak a "25.01" in). Existing
  // legacy fractional rows in the DB are left alone — only NEW
  // movements are forced to be integers from here on.
  for (const q of qtys) {
    if (!Number.isFinite(q) || q <= 0) {
      return { ok: false, error: "Every quantity must be greater than zero." };
    }
    if (!Number.isInteger(q)) {
      return {
        ok: false,
        error:
          "Quantities must be whole numbers (scaffolding ships in whole pieces — no decimals).",
      };
    }
  }

  let fromSiteId: string | null = null;
  let toSiteId: string | null = null;
  const plantId = await getPlantSiteId();

  switch (movementType) {
    case "issue":
      if (!projectSiteId) {
        return { ok: false, error: "Pick a destination site." };
      }
      if (projectSiteId === plantId) {
        return { ok: false, error: "Destination must be a project site, not the plant." };
      }
      fromSiteId = plantId;
      toSiteId = projectSiteId;
      break;
    case "return":
      if (!projectSiteId) {
        return { ok: false, error: "Pick the site sending stock back." };
      }
      if (projectSiteId === plantId) {
        return { ok: false, error: "Return source must be a project site." };
      }
      fromSiteId = projectSiteId;
      toSiteId = plantId;
      break;
    case "receive":
      // Vendor delivery → plant. from_site_id stays NULL (external).
      fromSiteId = null;
      toSiteId = plantId;
      break;
    case "writeoff":
      if (!projectSiteId) {
        return { ok: false, error: "Pick the location the stock is being written off from." };
      }
      // For writeoff, the chosen site can be the plant itself (parts
      // damaged in the yard) or a project site (parts lost on site).
      fromSiteId = projectSiteId;
      toSiteId = null;
      break;
  }

  // Validate qty against available stock for outgoing movements
  // (issue/return/writeoff). For receive, anything goes — we're
  // adding to plant inventory.
  if (movementType !== "receive" && fromSiteId) {
    for (let i = 0; i < componentIds.length; i++) {
      const bucket = await getStockForComponentAtSite(componentIds[i], fromSiteId);
      const avail = available(bucket);
      if (qtys[i] > avail) {
        const overdraftBy = (qtys[i] - avail).toFixed(2).replace(/\.00$/, "");
        return {
          ok: false,
          error:
            `Component #${i + 1} would overdraw the source by ${overdraftBy}. ` +
            `Available: ${avail.toFixed(2).replace(/\.00$/, "")}, ` +
            `requested: ${qtys[i]}. ` +
            `Pending-approval movements from this location have already been netted.`,
        };
      }
    }
  }

  const supabase = createAdminSupabaseClient();
  const batchId = randomUUID();
  const rows = componentIds.map((cid, i) => ({
    batch_id: batchId,
    movement_type: movementType,
    status: "pending_approval" as const,
    from_site_id: fromSiteId,
    to_site_id: toSiteId,
    component_id: cid,
    qty: qtys[i],
    proposed_by: profile.id,
    proposed_note: notes[i],
    batch_note: batchNote,
  }));

  const { error } = await supabase.from("inventory_movements").insert(rows);
  if (error) return { ok: false, error: error.message };

  void Promise.all([
    logAudit(profile.id, "inventory_movement_proposed", "inventory_batch", batchId, {
      movement_type: movementType,
      from_site_id: fromSiteId,
      to_site_id: toSiteId,
      row_count: rows.length,
      total_qty: qtys.reduce((s, q) => s + q, 0),
    }),
    notify(
      "inventory_movement_pending_approval",
      `${labelForType(movementType)} pending audit — ${rows.length} ${rows.length === 1 ? "item" : "items"}`,
      {
        message: `Submitted by ${profile.full_name ?? "storekeeper"}. Awaiting crosscheck / owner approval.`,
        entityType: "inventory_batch",
        entityId: batchId,
        actorId: profile.id,
        targetRoles: ["crosscheck", "owner", "developer"],
      },
    ),
  ]).catch((e) =>
    console.warn("[proposeMovementAction] audit/notify failed (non-fatal)", e),
  );

  await refreshInventoryPaths();
  return { ok: true, batchId, rowCount: rows.length };
}

function labelForType(t: MovementType): string {
  switch (t) {
    case "issue":
      return "Issue to site";
    case "return":
      return "Return from site";
    case "receive":
      return "Receive at plant";
    case "writeoff":
      return "Write-off";
  }
}

// ──────────────────────────────────────────────────────────────────
// Approve / Reject / Cancel a batch
// ──────────────────────────────────────────────────────────────────

/** Crosscheck / owner approves every row in a batch. Race-guard on
 *  status='pending_approval' so a concurrent reject can't be
 *  silently overwritten. */
export async function approveBatchAction(batchId: string): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canApproveInventoryMovements(profile)) {
    return { ok: false, error: "Not authorised to approve inventory movements." };
  }
  if (!batchId) return { ok: false, error: "Missing batch id." };

  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from("inventory_movements")
    .update({
      status: "approved",
      approved_by: profile.id,
      approved_at: new Date().toISOString(),
    })
    .eq("batch_id", batchId)
    .eq("status", "pending_approval")
    .select("id, movement_type, qty, component_id, from_site_id, to_site_id");

  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) {
    return {
      ok: false,
      error: "Nothing to approve — this batch may have already been approved, rejected, or cancelled.",
    };
  }

  const mt = data[0].movement_type as MovementType;
  void Promise.all([
    logAudit(profile.id, "inventory_movement_approved", "inventory_batch", batchId, {
      movement_type: mt,
      row_count: data.length,
    }),
    notify(
      "inventory_movement_approved",
      `${labelForType(mt)} approved — ${data.length} ${data.length === 1 ? "item" : "items"}`,
      {
        message: `Approved by ${profile.full_name ?? "auditor"}. Stock counts updated.`,
        entityType: "inventory_batch",
        entityId: batchId,
        actorId: profile.id,
        targetRoles: ["storekeeper", "owner", "developer"],
      },
    ),
  ]).catch((e) =>
    console.warn("[approveBatchAction] audit/notify failed (non-fatal)", e),
  );

  await refreshInventoryPaths();
  return { ok: true };
}

/** Reject a batch with a note. All rows flip to 'rejected' atomically. */
export async function rejectBatchAction(
  batchId: string,
  note: string,
): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canApproveInventoryMovements(profile)) {
    return { ok: false, error: "Not authorised to reject inventory movements." };
  }
  if (!batchId) return { ok: false, error: "Missing batch id." };
  const trimmed = (note ?? "").trim();
  if (!trimmed) {
    return { ok: false, error: "Rejection note is required so the storekeeper knows what to fix." };
  }

  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from("inventory_movements")
    .update({
      status: "rejected",
      rejected_by: profile.id,
      rejected_at: new Date().toISOString(),
      rejection_note: trimmed,
    })
    .eq("batch_id", batchId)
    .eq("status", "pending_approval")
    .select("id, movement_type");

  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) {
    return {
      ok: false,
      error: "Nothing to reject — this batch may have already been approved, rejected, or cancelled.",
    };
  }

  const mt = data[0].movement_type as MovementType;
  void Promise.all([
    logAudit(profile.id, "inventory_movement_rejected", "inventory_batch", batchId, {
      movement_type: mt,
      row_count: data.length,
      note: trimmed,
    }),
    notify(
      "inventory_movement_rejected",
      `${labelForType(mt)} sent back for edit`,
      {
        message: `${profile.full_name ?? "Auditor"} rejected: ${trimmed}`,
        entityType: "inventory_batch",
        entityId: batchId,
        actorId: profile.id,
        targetRoles: ["storekeeper", "developer"],
      },
    ),
  ]).catch((e) =>
    console.warn("[rejectBatchAction] audit/notify failed (non-fatal)", e),
  );

  await refreshInventoryPaths();
  return { ok: true };
}

/** Storekeeper cancels their own batch before approval. Owner /
 *  developer can also cancel anyone's pending batch. */
export async function cancelBatchAction(
  batchId: string,
  reason: string,
): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canManageInventory(profile)) {
    return { ok: false, error: "Not authorised." };
  }
  if (!batchId) return { ok: false, error: "Missing batch id." };

  const supabase = createAdminSupabaseClient();

  // Storekeeper can only cancel their own pending batches; owner +
  // dev can cancel any pending batch.
  let updateQuery = supabase
    .from("inventory_movements")
    .update({
      status: "cancelled",
      cancelled_by: profile.id,
      cancelled_at: new Date().toISOString(),
      cancel_reason: (reason ?? "").trim() || "Cancelled by submitter",
    })
    .eq("batch_id", batchId)
    .eq("status", "pending_approval");

  if (profile.role === "storekeeper") {
    updateQuery = updateQuery.eq("proposed_by", profile.id);
  }

  const { data, error } = await updateQuery.select("id, movement_type");

  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) {
    return {
      ok: false,
      error: "Nothing to cancel — this batch may already have moved past pending_approval, or it isn't yours to cancel.",
    };
  }

  const mt = data[0].movement_type as MovementType;
  void logAudit(profile.id, "inventory_movement_cancelled", "inventory_batch", batchId, {
    movement_type: mt,
    row_count: data.length,
    reason,
  }).catch(() => {});

  await refreshInventoryPaths();
  return { ok: true };
}

// ──────────────────────────────────────────────────────────────────
// Form-action wrappers — Approve / Reject / Cancel as button actions
// ──────────────────────────────────────────────────────────────────

export async function approveBatchFormAction(formData: FormData): Promise<void> {
  const batchId = String(formData.get("batch_id") || "").trim();
  const result = await approveBatchAction(batchId);
  if (!result.ok) {
    throw new Error(result.error);
  }
}

export async function rejectBatchFormAction(formData: FormData): Promise<void> {
  const batchId = String(formData.get("batch_id") || "").trim();
  const note = String(formData.get("note") || "").trim();
  const result = await rejectBatchAction(batchId, note);
  if (!result.ok) {
    throw new Error(result.error);
  }
}

export async function cancelBatchFormAction(formData: FormData): Promise<void> {
  const batchId = String(formData.get("batch_id") || "").trim();
  const reason = String(formData.get("reason") || "").trim();
  const result = await cancelBatchAction(batchId, reason);
  if (!result.ok) {
    throw new Error(result.error);
  }
}

// ──────────────────────────────────────────────────────────────────
// Sites CRUD
// ──────────────────────────────────────────────────────────────────

export async function upsertSiteAction(
  formData: FormData,
): Promise<{ ok: true; siteId: string } | { ok: false; error: string }> {
  const { profile } = await requireAuth();
  if (!canManageSites(profile)) {
    return { ok: false, error: "Not authorised to manage sites." };
  }

  const id = String(formData.get("id") || "").trim() || null;
  const code = String(formData.get("code") || "").trim().toUpperCase();
  const name = String(formData.get("name") || "").trim();
  const address = String(formData.get("address") || "").trim() || null;
  const managerName = String(formData.get("manager_name") || "").trim() || null;
  const managerPhone = String(formData.get("manager_phone") || "").trim() || null;
  const startedOn = String(formData.get("started_on") || "").trim() || null;
  const notes = String(formData.get("notes") || "").trim() || null;

  if (!code) return { ok: false, error: "Site code is required (e.g. ALPHA)." };
  if (!/^[A-Z0-9_-]+$/.test(code)) {
    return { ok: false, error: "Site code can only contain letters, digits, hyphens and underscores." };
  }
  if (code === "PLANT") {
    return { ok: false, error: "The code 'PLANT' is reserved." };
  }
  if (!name) return { ok: false, error: "Site name is required." };

  const supabase = createAdminSupabaseClient();
  try {
    if (id) {
      const { error } = await supabase
        .from("sites")
        .update({
          code,
          name,
          address,
          manager_name: managerName,
          manager_phone: managerPhone,
          started_on: startedOn,
          notes,
          updated_by: profile.id,
        })
        .eq("id", id)
        .eq("is_plant", false); // can't rename the plant row through this action
      if (error) {
        if (error.code === PG_UNIQUE_VIOLATION) {
          return { ok: false, error: "Another site already uses that code." };
        }
        return { ok: false, error: error.message };
      }
      void logAudit(profile.id, "site_updated", "site", id, { code, name }).catch(() => {});
      await refreshInventoryPaths();
      return { ok: true, siteId: id };
    } else {
      const { data, error } = await supabase
        .from("sites")
        .insert({
          code,
          name,
          address,
          manager_name: managerName,
          manager_phone: managerPhone,
          started_on: startedOn,
          notes,
          is_plant: false,
          is_active: true,
          created_by: profile.id,
        })
        .select("id")
        .single();
      if (error) {
        if (error.code === PG_UNIQUE_VIOLATION) {
          return { ok: false, error: "Another site already uses that code." };
        }
        return { ok: false, error: error.message };
      }
      void logAudit(profile.id, "site_created", "site", data!.id as string, { code, name }).catch(() => {});
      await refreshInventoryPaths();
      return { ok: true, siteId: data!.id as string };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

export async function archiveSiteAction(
  formData: FormData,
): Promise<void> {
  const { profile } = await requireAuth();
  if (!canManageSites(profile)) {
    throw new Error("Not authorised.");
  }
  const id = String(formData.get("id") || "").trim();
  if (!id) throw new Error("Missing site id.");

  const supabase = createAdminSupabaseClient();
  const { error } = await supabase
    .from("sites")
    .update({ is_active: false, closed_on: new Date().toISOString().slice(0, 10), updated_by: profile.id })
    .eq("id", id)
    .eq("is_plant", false);
  if (error) throw new Error(error.message);

  void logAudit(profile.id, "site_archived", "site", id, {}).catch(() => {});
  await refreshInventoryPaths();
}

export async function unarchiveSiteAction(formData: FormData): Promise<void> {
  const { profile } = await requireAuth();
  if (!canManageSites(profile)) {
    throw new Error("Not authorised.");
  }
  const id = String(formData.get("id") || "").trim();
  if (!id) throw new Error("Missing site id.");

  const supabase = createAdminSupabaseClient();
  const { error } = await supabase
    .from("sites")
    .update({ is_active: true, closed_on: null, updated_by: profile.id })
    .eq("id", id)
    .eq("is_plant", false);
  if (error) throw new Error(error.message);

  void logAudit(profile.id, "site_unarchived", "site", id, {}).catch(() => {});
  await refreshInventoryPaths();
}

// ──────────────────────────────────────────────────────────────────
// Scaffolding components catalog CRUD
// ──────────────────────────────────────────────────────────────────

export async function upsertComponentAction(
  formData: FormData,
): Promise<{ ok: true; componentId: string } | { ok: false; error: string }> {
  const { profile } = await requireAuth();
  if (!canManageScaffoldingComponents(profile)) {
    return { ok: false, error: "Not authorised to manage the component catalog." };
  }

  const id = String(formData.get("id") || "").trim() || null;
  const name = String(formData.get("name") || "").trim();
  const componentType = String(formData.get("component_type") || "").trim();
  const sizeSpec = String(formData.get("size_spec") || "").trim() || null;
  const unit = String(formData.get("unit") || "pcs").trim() || "pcs";
  const description = String(formData.get("description") || "").trim() || null;
  const displayOrderRaw = String(formData.get("display_order") || "0").trim();
  const displayOrder = Number(displayOrderRaw);
  // Mig 044 — image upload as data URL. Empty string means clear
  // any existing image. We validate the shape lightly + cap size
  // server-side too as defence in depth.
  const imageDataUrlRaw = String(formData.get("image_data_url") || "");
  let imageDataUrl: string | null = imageDataUrlRaw.trim() || null;
  if (imageDataUrl) {
    if (!imageDataUrl.startsWith("data:image/")) {
      return {
        ok: false,
        error: "Image upload must be a data URL (data:image/...).",
      };
    }
    // Base64 expands by ~4/3, so 300 KB encoded ≈ 220 KB raw.
    // Match the client cap of 200 KB raw with a small safety
    // margin.
    if (imageDataUrl.length > 300_000) {
      return {
        ok: false,
        error: "Image is too large — keep it under 200 KB.",
      };
    }
  }

  if (!name) return { ok: false, error: "Component name is required." };
  if (!componentType) return { ok: false, error: "Pick a component type." };
  if (!Number.isFinite(displayOrder)) {
    return { ok: false, error: "Display order must be a number." };
  }

  const supabase = createAdminSupabaseClient();
  try {
    if (id) {
      const { error } = await supabase
        .from("scaffolding_components")
        .update({
          name,
          component_type: componentType,
          size_spec: sizeSpec,
          unit,
          description,
          display_order: displayOrder,
          image_data_url: imageDataUrl,
          updated_by: profile.id,
        })
        .eq("id", id);
      if (error) {
        if (error.code === PG_UNIQUE_VIOLATION) {
          return {
            ok: false,
            error: "Another component already has this (type, size) combination.",
          };
        }
        return { ok: false, error: error.message };
      }
      // Mig 083 follow-on (Daksh, June 2026) — image is shared
      // across every component row of the same type. Daksh: "in
      // jali there are 3-4 types in so i want you to show them
      // in group. like i upload image to jali that same jali
      // image will show in all size jali."
      // When the user uploads / changes the image on ANY row, we
      // propagate the new image_data_url to every active row that
      // shares the component_type. NULL image clears them all
      // too (so the user can wipe a wrong image from one place +
      // have it disappear from every size variant).
      if (imageDataUrl !== undefined) {
        await supabase
          .from("scaffolding_components")
          .update({
            image_data_url: imageDataUrl,
            updated_by: profile.id,
          })
          .eq("component_type", componentType)
          .neq("id", id);
      }
      void logAudit(profile.id, "scaffolding_component_updated", "scaffolding_component", id, { name }).catch(() => {});
      await refreshInventoryPaths();
      return { ok: true, componentId: id };
    } else {
      // Mig 083 — when inserting a new size variant, inherit the
      // image already attached to any sibling row of the same
      // type (so the user doesn't have to upload it again for
      // every "Jali 100×50 / 100×100 / 100×200" row). Only does
      // the lookup when the form didn't supply its own image.
      let inheritedImage: string | null = imageDataUrl;
      if (!inheritedImage) {
        const { data: sibling } = await supabase
          .from("scaffolding_components")
          .select("image_data_url")
          .eq("component_type", componentType)
          .eq("is_active", true)
          .not("image_data_url", "is", null)
          .limit(1)
          .maybeSingle();
        inheritedImage = (sibling as { image_data_url?: string | null } | null)?.image_data_url ?? null;
      }
      const { data, error } = await supabase
        .from("scaffolding_components")
        .insert({
          name,
          component_type: componentType,
          size_spec: sizeSpec,
          unit,
          description,
          display_order: displayOrder,
          image_data_url: inheritedImage,
          is_active: true,
          created_by: profile.id,
        })
        .select("id")
        .single();
      if (error) {
        if (error.code === PG_UNIQUE_VIOLATION) {
          return {
            ok: false,
            error: "Another component already has this (type, size) combination.",
          };
        }
        return { ok: false, error: error.message };
      }
      void logAudit(profile.id, "scaffolding_component_created", "scaffolding_component", data!.id as string, { name }).catch(() => {});
      await refreshInventoryPaths();
      return { ok: true, componentId: data!.id as string };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

export async function archiveComponentAction(formData: FormData): Promise<void> {
  const { profile } = await requireAuth();
  if (!canManageScaffoldingComponents(profile)) {
    throw new Error("Not authorised.");
  }
  const id = String(formData.get("id") || "").trim();
  if (!id) throw new Error("Missing component id.");

  const supabase = createAdminSupabaseClient();
  const { error } = await supabase
    .from("scaffolding_components")
    .update({ is_active: false, updated_by: profile.id })
    .eq("id", id);
  if (error) throw new Error(error.message);

  void logAudit(profile.id, "scaffolding_component_archived", "scaffolding_component", id, {}).catch(() => {});
  await refreshInventoryPaths();
}

export async function unarchiveComponentAction(formData: FormData): Promise<void> {
  const { profile } = await requireAuth();
  if (!canManageScaffoldingComponents(profile)) {
    throw new Error("Not authorised.");
  }
  const id = String(formData.get("id") || "").trim();
  if (!id) throw new Error("Missing component id.");

  const supabase = createAdminSupabaseClient();
  const { error } = await supabase
    .from("scaffolding_components")
    .update({ is_active: true, updated_by: profile.id })
    .eq("id", id);
  if (error) throw new Error(error.message);

  void logAudit(profile.id, "scaffolding_component_unarchived", "scaffolding_component", id, {}).catch(() => {});
  await refreshInventoryPaths();
}
