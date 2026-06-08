"use server";

// ──────────────────────────────────────────────────────────────────
// Maintenance department — server actions (Mig 108–110)
//
// A standalone, isolated module: the company machine registry +
// repair-ticket workflow (raise → inspect → minor-fix OR quote →
// owner approve → in-repair → done). Nothing here reads or writes any
// other module's tables. Every action is gated owner/developer for now;
// to open it later, widen isAllowed().
// ──────────────────────────────────────────────────────────────────

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { sendTemplateSms } from "@/lib/msg91";

const ROUTE = "/maintenance";
const PROOF_BUCKET = "maintenance_proofs";
const PROOF_MAX_BYTES = 15 * 1024 * 1024;
const PROOF_MIME_ALLOW = new Set<string>([
  "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf",
]);

function isAllowed(role: string): boolean {
  return role === "owner" || role === "developer";
}
function txt(fd: FormData, key: string): string {
  return String(fd.get(key) || "").trim();
}
/** Read the form's `back` field (where to return), falling back to the
 *  registry. Appends a toast. */
function back(fd: FormData, toast: string): string {
  const b = txt(fd, "back") || ROUTE;
  const safe = b.startsWith("/maintenance") ? b : ROUTE;
  return `${safe}?toast=${encodeURIComponent(toast)}`;
}

/** Best-effort SMS alert to administration when an URGENT ticket is raised.
 *  Inert until configured — needs MSG91_AUTH_KEY + a DLT-approved template
 *  in MSG91_MAINT_ALERT_TEMPLATE_ID + recipient numbers in
 *  MAINTENANCE_ALERT_NUMBERS (comma-separated). Template variables:
 *  var1 = machine, var2 = ticket no, var3 = problem (trimmed). Never
 *  throws — raising a ticket must not depend on the SMS going out. */
async function notifyUrgent(machineName: string, ticketNo: string, problem: string) {
  const templateId = process.env.MSG91_MAINT_ALERT_TEMPLATE_ID;
  const numbers = (process.env.MAINTENANCE_ALERT_NUMBERS || "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  if (!templateId || numbers.length === 0) return; // not configured → no-op
  const vars = {
    var1: machineName.slice(0, 40),
    var2: ticketNo,
    var3: problem.replace(/\s+/g, " ").slice(0, 60),
  };
  try {
    await Promise.allSettled(numbers.map((n) => sendTemplateSms({ templateId, mobile: n, vars })));
  } catch {
    /* best-effort */
  }
}

function proofExt(mime: string): string {
  switch (mime) {
    case "image/jpeg": return "jpg";
    case "image/png": return "png";
    case "image/webp": return "webp";
    case "image/heic": return "heic";
    case "image/heif": return "heif";
    case "application/pdf": return "pdf";
    default: return "bin";
  }
}
function validatePhoto(file: File): string | null {
  const mime = (file.type || "").toLowerCase();
  if (!PROOF_MIME_ALLOW.has(mime)) return "Photo must be an image (JPG / PNG / WebP / HEIC) or a PDF.";
  if (file.size === 0) return "Photo file is empty.";
  if (file.size > PROOF_MAX_BYTES) return "Photo file too large (max 15 MB).";
  return null;
}
async function uploadPhoto(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  ticketId: string,
  file: File,
): Promise<{ path: string; mime: string }> {
  const mime = (file.type || "").toLowerCase();
  const err = validatePhoto(file);
  if (err) throw new Error(err);
  const path = `${ticketId}/${randomUUID()}.${proofExt(mime)}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error } = await admin.storage
    .from(PROOF_BUCKET)
    .upload(path, buffer, { contentType: mime, cacheControl: "3600", upsert: false });
  if (error) throw new Error(`Photo upload failed: ${error.message}`);
  return { path, mime };
}

// ── Catalog images (public bucket machine_images) ───────────────────
const IMG_BUCKET = "machine_images";
const IMG_MIME_ALLOW = new Set<string>(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
function imgExt(mime: string): string {
  switch (mime) {
    case "image/jpeg": return "jpg";
    case "image/png": return "png";
    case "image/webp": return "webp";
    case "image/heic": return "heic";
    case "image/heif": return "heif";
    default: return "bin";
  }
}
async function uploadImage(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  folder: "groups" | "machines",
  id: string,
  file: File,
): Promise<{ path: string; mime: string }> {
  const mime = (file.type || "").toLowerCase();
  if (!IMG_MIME_ALLOW.has(mime)) throw new Error("Photo must be an image (JPG / PNG / WebP / HEIC).");
  if (file.size === 0) throw new Error("Photo is empty.");
  if (file.size > PROOF_MAX_BYTES) throw new Error("Photo too large (max 15 MB).");
  const path = `${folder}/${id}/${randomUUID()}.${imgExt(mime)}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error } = await admin.storage.from(IMG_BUCKET).upload(path, buffer, { contentType: mime, cacheControl: "3600", upsert: false });
  if (error) throw new Error(`Photo upload failed: ${error.message}`);
  return { path, mime };
}

/** Remember a fixed location name so the picker offers it next time. */
async function rememberLocation(admin: ReturnType<typeof createAdminSupabaseClient>, name: string) {
  if (!name) return;
  try {
    await admin.from("machine_locations").insert({ name }).select("id").single();
  } catch {
    /* unique violation = already exists; ignore */
  }
}

// ── Groups ──────────────────────────────────────────────────────────

export async function createGroupAction(formData: FormData) {
  const { profile } = await requireAuth();
  if (!isAllowed(profile.role)) redirect(back(formData, "Not allowed."));
  const name = txt(formData, "name");
  if (!name) redirect(back(formData, "Group name is required."));
  const parentId = txt(formData, "parent_id") || null;
  const admin = createAdminSupabaseClient();
  const { data: created, error } = await admin
    .from("machine_groups")
    .insert({ name, parent_id: parentId, created_by: profile.id })
    .select("id")
    .single();
  if (error || !created) {
    const dup = (error?.message || "").toLowerCase().includes("duplicate") || (error?.message || "").toLowerCase().includes("unique");
    redirect(back(formData, dup ? `A group named "${name}" already exists.` : (error?.message ?? "Failed to create group.")));
  }
  const image = formData.get("image");
  if (image instanceof File && image.size > 0) {
    try {
      const meta = await uploadImage(admin, "groups", created.id, image);
      await admin.from("machine_groups").update({ image_path: meta.path, image_mime: meta.mime }).eq("id", created.id);
    } catch (e) {
      redirect(back(formData, `Group created, but photo failed: ${e instanceof Error ? e.message : String(e)}`));
    }
  }
  await logAudit(profile.id, "machine_group_created", "machine_group", created.id, { name });
  revalidatePath(ROUTE);
  redirect(back(formData, `Group "${name}" created.`));
}

export async function updateGroupAction(formData: FormData) {
  const { profile } = await requireAuth();
  if (!isAllowed(profile.role)) redirect(back(formData, "Not allowed."));
  const id = txt(formData, "id");
  const name = txt(formData, "name");
  if (!id) redirect(back(formData, "Missing group."));
  if (!name) redirect(back(formData, "Group name is required."));
  // A group can't be its own parent.
  const parentId = (txt(formData, "parent_id") || null);
  const admin = createAdminSupabaseClient();
  const update: Record<string, unknown> = { name, parent_id: parentId === id ? null : parentId, updated_at: new Date().toISOString() };
  const image = formData.get("image");
  if (image instanceof File && image.size > 0) {
    try {
      const { data: cur } = await admin.from("machine_groups").select("image_path").eq("id", id).maybeSingle();
      const oldPath = (cur as { image_path?: string | null } | null)?.image_path ?? null;
      const meta = await uploadImage(admin, "groups", id, image);
      update.image_path = meta.path;
      update.image_mime = meta.mime;
      if (oldPath) { try { await admin.storage.from(IMG_BUCKET).remove([oldPath]); } catch { /* best effort */ } }
    } catch (e) {
      redirect(back(formData, e instanceof Error ? e.message : "Photo upload failed."));
    }
  }
  const { error } = await admin.from("machine_groups").update(update).eq("id", id);
  if (error) redirect(back(formData, error.message));
  await logAudit(profile.id, "machine_group_updated", "machine_group", id, { name });
  revalidatePath(ROUTE);
  redirect(back(formData, "Group updated."));
}

export async function deleteGroupAction(formData: FormData) {
  const { profile } = await requireAuth();
  if (!isAllowed(profile.role)) redirect(back(formData, "Not allowed."));
  const id = txt(formData, "id");
  if (!id) redirect(back(formData, "Missing group."));
  const admin = createAdminSupabaseClient();
  // Machines in this group fall back to "Ungrouped" (FK ON DELETE SET NULL).
  const { error } = await admin.from("machine_groups").delete().eq("id", id);
  if (error) redirect(back(formData, error.message));
  await logAudit(profile.id, "machine_group_deleted", "machine_group", id, {});
  revalidatePath(ROUTE);
  redirect(back(formData, "Group deleted — its machines are now ungrouped."));
}

// ── Machines ────────────────────────────────────────────────────────

export async function createMachineAction(formData: FormData) {
  const { profile } = await requireAuth();
  if (!isAllowed(profile.role)) redirect(back(formData, "Not allowed."));

  const name = txt(formData, "name");
  if (!name) redirect(back(formData, "Machine name is required."));
  const groupId = txt(formData, "group_id") || null;
  const location = txt(formData, "location") || null;
  const notes = txt(formData, "notes") || null;

  const admin = createAdminSupabaseClient();
  const { data: created, error } = await admin
    .from("company_machines")
    .insert({ name, group_id: groupId, location, notes, created_by: profile.id })
    .select("id, machine_code")
    .single();
  if (error || !created) redirect(back(formData, error?.message ?? "Failed to add machine."));

  const image = formData.get("image");
  if (image instanceof File && image.size > 0) {
    try {
      const meta = await uploadImage(admin, "machines", created.id, image);
      await admin.from("company_machines").update({ image_path: meta.path, image_mime: meta.mime }).eq("id", created.id);
    } catch (e) {
      revalidatePath(ROUTE);
      redirect(back(formData, `Machine added, but photo failed: ${e instanceof Error ? e.message : String(e)}`));
    }
  }
  if (location) await rememberLocation(admin, location);
  await logAudit(profile.id, "machine_created", "company_machine", created.id, { name, group_id: groupId });
  revalidatePath(ROUTE);
  redirect(`${ROUTE}/${created.id}?toast=${encodeURIComponent(`Machine added (${created.machine_code}).`)}`);
}

/** Add MANY machines at once into the same group — one name per line,
 *  sharing the group / location / photo / notes. */
export async function createMachinesBulkAction(formData: FormData) {
  const { profile } = await requireAuth();
  if (!isAllowed(profile.role)) redirect(back(formData, "Not allowed."));
  const groupId = txt(formData, "group_id") || null;
  const location = txt(formData, "location") || null;
  const notes = txt(formData, "notes") || null;
  const names = String(formData.get("names") || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (names.length === 0) redirect(back(formData, "Enter at least one machine name (one per line)."));
  if (names.length > 100) redirect(back(formData, "Too many at once — add up to 100 at a time."));

  const admin = createAdminSupabaseClient();

  // Optional shared photo — uploaded once, applied to every machine created.
  let sharedPath: string | null = null;
  let sharedMime: string | null = null;
  const image = formData.get("image");
  if (image instanceof File && image.size > 0) {
    try {
      const meta = await uploadImage(admin, "machines", `bulk-${randomUUID()}`, image);
      sharedPath = meta.path;
      sharedMime = meta.mime;
    } catch (e) {
      redirect(back(formData, e instanceof Error ? e.message : "Photo upload failed."));
    }
  }

  const rows = names.map((name) => ({
    name, group_id: groupId, location, notes,
    image_path: sharedPath, image_mime: sharedMime, created_by: profile.id,
  }));
  const { data: created, error } = await admin.from("company_machines").insert(rows).select("id");
  if (error) redirect(back(formData, error.message));
  if (location) await rememberLocation(admin, location);
  await logAudit(profile.id, "machines_bulk_created", "company_machine", created?.[0]?.id ?? "", {
    count: created?.length ?? 0, group_id: groupId,
  });
  revalidatePath(ROUTE);
  redirect(back(formData, `Added ${created?.length ?? names.length} machine(s).`));
}

export async function updateMachineAction(formData: FormData) {
  const { profile } = await requireAuth();
  if (!isAllowed(profile.role)) redirect(back(formData, "Not allowed."));
  const id = txt(formData, "id");
  if (!id) redirect(back(formData, "Missing machine."));
  const name = txt(formData, "name");
  if (!name) redirect(back(formData, "Machine name is required."));
  const groupId = txt(formData, "group_id") || null;
  const location = txt(formData, "location") || null;
  const notes = txt(formData, "notes") || null;

  const admin = createAdminSupabaseClient();
  const update: Record<string, unknown> = {
    name, group_id: groupId, location, notes,
    updated_at: new Date().toISOString(), updated_by: profile.id,
  };
  const image = formData.get("image");
  if (image instanceof File && image.size > 0) {
    try {
      const { data: cur } = await admin.from("company_machines").select("image_path").eq("id", id).maybeSingle();
      const oldPath = (cur as { image_path?: string | null } | null)?.image_path ?? null;
      const meta = await uploadImage(admin, "machines", id, image);
      update.image_path = meta.path;
      update.image_mime = meta.mime;
      if (oldPath) { try { await admin.storage.from(IMG_BUCKET).remove([oldPath]); } catch { /* best effort */ } }
    } catch (e) {
      redirect(back(formData, e instanceof Error ? e.message : "Photo upload failed."));
    }
  }
  const { error } = await admin.from("company_machines").update(update).eq("id", id);
  if (error) redirect(back(formData, error.message));
  if (location) await rememberLocation(admin, location);
  await logAudit(profile.id, "machine_updated", "company_machine", id, { name, group_id: groupId });
  revalidatePath(ROUTE);
  redirect(back(formData, "Machine updated."));
}

/** Manually set machine status (working / under_maintenance / retired). */
export async function setMachineStatusAction(formData: FormData) {
  const { profile } = await requireAuth();
  if (!isAllowed(profile.role)) redirect(back(formData, "Not allowed."));
  const id = txt(formData, "id");
  const status = txt(formData, "status");
  if (!id || !["working", "under_maintenance", "retired"].includes(status)) {
    redirect(back(formData, "Invalid status change."));
  }
  const admin = createAdminSupabaseClient();
  const { error } = await admin
    .from("company_machines")
    .update({ status, updated_at: new Date().toISOString(), updated_by: profile.id })
    .eq("id", id);
  if (error) redirect(back(formData, error.message));
  await logAudit(profile.id, "machine_status_set", "company_machine", id, { status });
  revalidatePath(ROUTE);
  redirect(back(formData, `Machine marked ${status.replace(/_/g, " ")}.`));
}

/** Delete a machine — only when it has no tickets (otherwise retire it). */
export async function deleteMachineAction(formData: FormData) {
  const { profile } = await requireAuth();
  if (!isAllowed(profile.role)) redirect(back(formData, "Not allowed."));
  const id = txt(formData, "id");
  if (!id) redirect(back(formData, "Missing machine."));
  const admin = createAdminSupabaseClient();
  const { count } = await admin
    .from("machine_maintenance_tickets")
    .select("*", { count: "exact", head: true })
    .eq("machine_id", id);
  if ((count ?? 0) > 0) {
    redirect(back(formData, "This machine has tickets — retire it instead of deleting."));
  }
  const { error } = await admin.from("company_machines").delete().eq("id", id);
  if (error) redirect(back(formData, error.message));
  await logAudit(profile.id, "machine_deleted", "company_machine", id, {});
  revalidatePath(ROUTE);
  redirect(`${ROUTE}?toast=${encodeURIComponent("Machine deleted.")}`);
}

// ── Tickets ─────────────────────────────────────────────────────────

export async function raiseTicketAction(formData: FormData) {
  const { profile } = await requireAuth();
  if (!isAllowed(profile.role)) redirect(back(formData, "Not allowed."));
  const machineId = txt(formData, "machine_id");
  const problem = txt(formData, "problem");
  const priority = ["low", "normal", "high", "urgent"].includes(txt(formData, "priority")) ? txt(formData, "priority") : "normal";
  if (!machineId) redirect(back(formData, "Missing machine."));
  if (!problem) redirect(back(formData, "Describe the problem."));

  const admin = createAdminSupabaseClient();
  const { data: machine } = await admin
    .from("company_machines")
    .select("name, section")
    .eq("id", machineId)
    .maybeSingle();
  if (!machine) redirect(back(formData, "That machine no longer exists."));

  const { data: created, error } = await admin
    .from("machine_maintenance_tickets")
    .insert({
      machine_id: machineId,
      machine_name: (machine as { name: string }).name,
      section: (machine as { section: string | null }).section,
      problem,
      priority,
      raised_by: profile.id,
    })
    .select("id, ticket_no")
    .single();
  if (error || !created) redirect(back(formData, error?.message ?? "Failed to raise ticket."));

  const photo = formData.get("problem_photo");
  if (photo instanceof File && photo.size > 0) {
    try {
      const meta = await uploadPhoto(admin, created.id, photo);
      await admin
        .from("machine_maintenance_tickets")
        .update({ problem_photo_path: meta.path, problem_photo_mime: meta.mime })
        .eq("id", created.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      revalidatePath(ROUTE);
      redirect(back(formData, `Ticket raised, but photo upload failed: ${msg}`));
    }
  }
  // Urgent → best-effort SMS alert to administration (inert unless configured).
  if (priority === "urgent") {
    await notifyUrgent(
      (machine as { name: string }).name,
      (created as { ticket_no: string | null }).ticket_no ?? "",
      problem,
    );
  }
  await logAudit(profile.id, "maintenance_ticket_raised", "machine_maintenance_ticket", created.id, { machine_id: machineId, priority });
  revalidatePath(ROUTE);
  redirect(back(formData, "Ticket raised."));
}

export async function inspectTicketAction(formData: FormData) {
  const { profile } = await requireAuth();
  if (!isAllowed(profile.role)) redirect(back(formData, "Not allowed."));
  const id = txt(formData, "id");
  if (!id) redirect(back(formData, "Missing ticket."));
  const notes = txt(formData, "inspection_notes") || null;
  const admin = createAdminSupabaseClient();
  const { error } = await admin
    .from("machine_maintenance_tickets")
    .update({ status: "inspecting", inspection_notes: notes, inspected_by: profile.id, inspected_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id)
    .in("status", ["raised", "inspecting"]);
  if (error) redirect(back(formData, error.message));
  await logAudit(profile.id, "maintenance_ticket_inspected", "machine_maintenance_ticket", id, {});
  revalidatePath(ROUTE);
  redirect(back(formData, "Marked inspecting."));
}

/** Minor problem — fixed directly, no quote/approval. Machine stays/returns working. */
export async function markMinorFixedAction(formData: FormData) {
  const { profile } = await requireAuth();
  if (!isAllowed(profile.role)) redirect(back(formData, "Not allowed."));
  const id = txt(formData, "id");
  if (!id) redirect(back(formData, "Missing ticket."));
  const admin = createAdminSupabaseClient();

  const { data: ticket } = await admin
    .from("machine_maintenance_tickets")
    .select("machine_id")
    .eq("id", id)
    .maybeSingle();

  const update: Record<string, unknown> = {
    status: "completed",
    resolution_kind: "minor",
    repair_completed_at: new Date().toISOString(),
    completed_by: profile.id,
    updated_at: new Date().toISOString(),
  };
  const photo = formData.get("done_photo");
  if (photo instanceof File && photo.size > 0) {
    try {
      const meta = await uploadPhoto(admin, id, photo);
      update.done_photo_path = meta.path;
      update.done_photo_mime = meta.mime;
    } catch (e) {
      redirect(back(formData, e instanceof Error ? e.message : "Photo upload failed."));
    }
  }
  const { error } = await admin.from("machine_maintenance_tickets").update(update).eq("id", id);
  if (error) redirect(back(formData, error.message));
  // Ensure the machine reads as working.
  if (ticket?.machine_id) {
    await admin.from("company_machines").update({ status: "working", updated_at: new Date().toISOString() }).eq("id", ticket.machine_id);
  }
  await logAudit(profile.id, "maintenance_ticket_minor_fixed", "machine_maintenance_ticket", id, {});
  revalidatePath(ROUTE);
  redirect(back(formData, "Marked fixed (minor)."));
}

/** Major repair — administration fills the simple quotation; goes to owner. */
export async function fillQuotationAction(formData: FormData) {
  const { profile } = await requireAuth();
  if (!isAllowed(profile.role)) redirect(back(formData, "Not allowed."));
  const id = txt(formData, "id");
  if (!id) redirect(back(formData, "Missing ticket."));
  const amount = Number(txt(formData, "quote_amount"));
  const vendor = txt(formData, "quote_vendor") || null;
  const scope = txt(formData, "quote_scope") || null;
  const daysRaw = Number(txt(formData, "quote_expected_days"));
  const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.round(daysRaw) : null;
  if (!Number.isFinite(amount) || amount <= 0) redirect(back(formData, "Enter a valid quotation amount."));

  const admin = createAdminSupabaseClient();
  const { error } = await admin
    .from("machine_maintenance_tickets")
    .update({
      status: "awaiting_approval",
      resolution_kind: "major",
      quote_amount: amount,
      quote_vendor: vendor,
      quote_scope: scope,
      quote_expected_days: days,
      quoted_by: profile.id,
      quoted_at: new Date().toISOString(),
      // clear any prior rejection so a resubmit reads clean
      rejected_by: null,
      rejected_at: null,
      rejection_reason: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) redirect(back(formData, error.message));
  await logAudit(profile.id, "maintenance_quotation_filled", "machine_maintenance_ticket", id, { amount });
  revalidatePath(ROUTE);
  redirect(back(formData, "Quotation sent for owner approval."));
}

/** Owner approves the quotation — repair starts, machine → under_maintenance. */
export async function approveTicketAction(formData: FormData) {
  const { profile } = await requireAuth();
  if (!isAllowed(profile.role)) redirect(back(formData, "Not allowed."));
  const id = txt(formData, "id");
  if (!id) redirect(back(formData, "Missing ticket."));
  const admin = createAdminSupabaseClient();

  const { data: ticket } = await admin
    .from("machine_maintenance_tickets")
    .select("machine_id, quote_expected_days")
    .eq("id", id)
    .maybeSingle();
  if (!ticket) redirect(back(formData, "Ticket not found."));

  const days = Number((ticket as { quote_expected_days: number | null }).quote_expected_days) || 0;
  let expected: string | null = null;
  if (days > 0) {
    const d = new Date(Date.now() + days * 86400000);
    expected = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  const { error } = await admin
    .from("machine_maintenance_tickets")
    .update({
      status: "in_repair",
      approved_by: profile.id,
      approved_at: new Date().toISOString(),
      repair_started_at: new Date().toISOString(),
      repair_expected_at: expected,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "awaiting_approval");
  if (error) redirect(back(formData, error.message));
  if (ticket.machine_id) {
    await admin.from("company_machines").update({ status: "under_maintenance", updated_at: new Date().toISOString() }).eq("id", ticket.machine_id);
  }
  await logAudit(profile.id, "maintenance_ticket_approved", "machine_maintenance_ticket", id, {});
  revalidatePath(ROUTE);
  redirect(back(formData, "Approved — repair started."));
}

/** Owner rejects the quotation. Admin can edit + resubmit. */
export async function rejectTicketAction(formData: FormData) {
  const { profile } = await requireAuth();
  if (!isAllowed(profile.role)) redirect(back(formData, "Not allowed."));
  const id = txt(formData, "id");
  if (!id) redirect(back(formData, "Missing ticket."));
  const reason = txt(formData, "rejection_reason") || null;
  const admin = createAdminSupabaseClient();
  const { error } = await admin
    .from("machine_maintenance_tickets")
    .update({ status: "rejected", rejected_by: profile.id, rejected_at: new Date().toISOString(), rejection_reason: reason, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "awaiting_approval");
  if (error) redirect(back(formData, error.message));
  await logAudit(profile.id, "maintenance_ticket_rejected", "machine_maintenance_ticket", id, { reason });
  revalidatePath(ROUTE);
  redirect(back(formData, "Quotation rejected."));
}

/** Repair finished — machine back to working. */
export async function markRepairDoneAction(formData: FormData) {
  const { profile } = await requireAuth();
  if (!isAllowed(profile.role)) redirect(back(formData, "Not allowed."));
  const id = txt(formData, "id");
  if (!id) redirect(back(formData, "Missing ticket."));
  const admin = createAdminSupabaseClient();
  const { data: ticket } = await admin
    .from("machine_maintenance_tickets")
    .select("machine_id")
    .eq("id", id)
    .maybeSingle();

  const update: Record<string, unknown> = {
    status: "completed",
    repair_completed_at: new Date().toISOString(),
    completed_by: profile.id,
    updated_at: new Date().toISOString(),
  };
  const photo = formData.get("done_photo");
  if (photo instanceof File && photo.size > 0) {
    try {
      const meta = await uploadPhoto(admin, id, photo);
      update.done_photo_path = meta.path;
      update.done_photo_mime = meta.mime;
    } catch (e) {
      redirect(back(formData, e instanceof Error ? e.message : "Photo upload failed."));
    }
  }
  const { error } = await admin.from("machine_maintenance_tickets").update(update).eq("id", id).eq("status", "in_repair");
  if (error) redirect(back(formData, error.message));
  if (ticket?.machine_id) {
    await admin.from("company_machines").update({ status: "working", updated_at: new Date().toISOString() }).eq("id", ticket.machine_id);
  }
  await logAudit(profile.id, "maintenance_ticket_completed", "machine_maintenance_ticket", id, {});
  revalidatePath(ROUTE);
  redirect(back(formData, "Repair completed — machine back to working."));
}

/** Cancel a ticket (any non-terminal stage). Restores machine to working. */
export async function cancelTicketAction(formData: FormData) {
  const { profile } = await requireAuth();
  if (!isAllowed(profile.role)) redirect(back(formData, "Not allowed."));
  const id = txt(formData, "id");
  if (!id) redirect(back(formData, "Missing ticket."));
  const reason = txt(formData, "cancel_reason") || null;
  const admin = createAdminSupabaseClient();
  const { data: ticket } = await admin
    .from("machine_maintenance_tickets")
    .select("machine_id")
    .eq("id", id)
    .maybeSingle();
  const { error } = await admin
    .from("machine_maintenance_tickets")
    .update({ status: "cancelled", cancel_reason: reason, updated_at: new Date().toISOString() })
    .eq("id", id)
    .not("status", "in", "(completed,cancelled,rejected)");
  if (error) redirect(back(formData, error.message));
  if (ticket?.machine_id) {
    await admin.from("company_machines").update({ status: "working", updated_at: new Date().toISOString() }).eq("id", ticket.machine_id);
  }
  await logAudit(profile.id, "maintenance_ticket_cancelled", "machine_maintenance_ticket", id, { reason });
  revalidatePath(ROUTE);
  redirect(back(formData, "Ticket cancelled."));
}
