"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import {
  canAccessCarvingPage,
  canAddExternalCutSlab,
  canSeeAwaitingReview,
} from "@/lib/cutting-permissions";
import { POWER_CUT_REASON } from "@/lib/carving-power-cut";
import { nextSlabCodeFromMaxId } from "../slabs/utils";
import { jobworkQuantity } from "@/lib/dimensions";

/**
 * Daksh May 2026 → re-enabled Jun 2026.
 *
 * The "yard → vendor shade" handoff (slab_transfer runner) is now
 * LIVE: when the carving head assigns a slab it sits in the vendor's
 * Pending stock tray until a runner claims + delivers it, then it
 * moves to Ready to load. This flag is the global kill-switch — set
 * it back to `true` to make EVERY assignment auto-receive again (the
 * old "skip the runner" behaviour) if the floor handoff falls apart.
 *
 * Per-assignment bypass (the day-to-day escape hatch): the assign
 * form carries a "Receive now (skip transfer)" checkbox. When the
 * carving head ticks it, that single assignment auto-receives even
 * though the flag is false — so work never stalls when no runner is
 * around. See `receiveNow` in the two assign actions below.
 *
 * Mechanics: assign actions stamp received_at_vendor_at=NOW() +
 * received_at_vendor_by=actor on the new carving_items row when
 * EITHER this flag is true OR the per-assignment checkbox is ticked.
 *
 * Inter-vendor transfers (Problem/Transfer → other vendor) keep
 * their existing flow because they have their own Accept/Flag
 * self-receive path that doesn't depend on slab_transfer.
 */
const SKIP_SLAB_TRANSFER_STAGE = false;

// ── Shared helpers ──────────────────────────────────────────────────

function txt(formData: FormData, key: string) {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

function num(formData: FormData, key: string, fallback = 0) {
  const raw = formData.get(key);
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

// Parse a per-machine dimension cap from machines_json. Empty string
// / null / undefined / NaN / non-positive → NULL (no limit). Used by
// createVendorAction + updateVendorAction for max_length_in,
// max_width_in, max_thickness_in (migration 024).
function parseDim(v: number | string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Orientation-agnostic slab-vs-bed fit check (migration 024).
// Returns an error string when the slab can't fit, NULL if all OK.
// Length / width compare in matched long-vs-long, short-vs-short
// pairs so a 30×50 slab still fits a 50×30 bed. Thickness is a
// direct compare. NULL caps = no limit. NULL slab dim = treat as 0
// (slab DB rows are NOT NULL but defensive).
function checkSlabFits(
  slab: { length_ft: number | string; width_ft: number | string; thickness_ft: number | string } | null,
  machine: {
    machine_code: string | null;
    max_length_in: number | string | null;
    max_width_in: number | string | null;
    max_thickness_in: number | string | null;
  },
): string | null {
  if (!slab) return null; // can't check; let the load proceed
  const slabL = Number(slab.length_ft) || 0;
  const slabW = Number(slab.width_ft) || 0;
  const slabT = Number(slab.thickness_ft) || 0;
  const slabLong = Math.max(slabL, slabW);
  const slabShort = Math.min(slabL, slabW);

  const maxL = parseDim(machine.max_length_in);
  const maxW = parseDim(machine.max_width_in);
  const maxT = parseDim(machine.max_thickness_in);

  // No L/W caps set → skip the bed-area check.
  if (maxL != null || maxW != null) {
    const bedLong = Math.max(maxL ?? Infinity, maxW ?? Infinity);
    const bedShort = Math.min(maxL ?? Infinity, maxW ?? Infinity);
    if (slabLong > bedLong || slabShort > bedShort) {
      const code = machine.machine_code ?? "machine";
      const maxLStr = maxL ?? "—";
      const maxWStr = maxW ?? "—";
      const maxTStr = maxT ?? "—";
      return `Slab ${slabL}×${slabW}×${slabT}″ exceeds ${code}'s bed (${maxLStr}×${maxWStr}×${maxTStr}″)`;
    }
  }
  if (maxT != null && slabT > maxT) {
    const code = machine.machine_code ?? "machine";
    return `Slab thickness ${slabT}″ exceeds ${code}'s max thickness ${maxT}″`;
  }
  return null;
}

// Mig 079 / 093 — strict CNC axis match. Single-sources the rule used
// by EVERY machine-load path (single load, 2-head pair load, reload
// from hold, pair reload). Daksh's spec is EXACT equality, not >=:
//   requires = NULL → "Any CNC", fits any axis (backward-compatible
//                     default for every slab assigned before mig 079).
//   requires = 3/4/5 → machine.cnc_axes MUST equal it exactly. A
//                     4-axis slab cannot run on a 3- OR a 5-axis
//                     machine (hardware-axis mismatches damage tooling).
// Lathe loads never reach here — the machine_type guard rules them out
// first. Returns a friendly error string, or null when the load is OK.
function checkAxisMatch(
  requires: number | null | undefined,
  machine: { cnc_axes: number | null; machine_code: string | null },
): string | null {
  if (requires == null) return null; // "Any CNC" → fits any axis
  const machineAxis = machine.cnc_axes ?? 3; // NULL backfills to 3 (mig 079)
  if (machineAxis === requires) return null;
  return (
    `This slab needs a ${requires}-axis CNC. ` +
    `Machine ${machine.machine_code ?? ""} is ${machineAxis}-axis. ` +
    `Pick a ${requires}-axis machine.`
  ).trim();
}

async function recordEvent(
  carvingItemId: string,
  eventType: string,
  userId: string | null,
  message?: string,
) {
  const admin = createAdminSupabaseClient();
  await admin.from("carving_job_events").insert({
    carving_item_id: carvingItemId,
    event_type: eventType,
    message: message ?? null,
    user_id: userId,
  });
}

function refreshAll() {
  revalidatePath("/carving");
  // Dynamic-segment revalidation — without this, the detail page
  // /carving/[id] stayed cached after an approve and showed the
  // stale Approve form (giving the impression the action didn't
  // run).
  revalidatePath("/carving/[id]", "page");
  revalidatePath("/carving/vendors");
  revalidatePath("/dashboard");
  revalidatePath("/vendor");
  revalidatePath("/dispatch");
}

// ── External cut-slab entry (Daksh May 2026 round 2) ────────────────
//
// Use case: a ready-to-carve slab walks in from an outside supplier
// (was never cut in our plant), so there's no block → cut session →
// slab_requirement chain. Without a way to register it, the carving
// team can't assign work on it via the normal Unassigned tab flow.
//
// Shape: inserts a slab_requirements row directly at status='cut_done'
// with source_block_id=NULL. Same ID-allocation pattern as the
// existing addSlabAction on /slabs (per-temple prefix + collision
// retry) so the external slabs co-exist cleanly with in-system ones.
// The row immediately appears in the /carving Unassigned tab, ready
// to assign to a vendor.
//
// Importantly: NO cut_session_blocks or block rows are touched, so
// cutting reports + cutter costing stay clean. The lack of
// source_block_id is the marker for "this came from outside".

// Mig 081 follow-on (Daksh) — extended to support multi-add (quantity
// field, 1-100, mirrors the /slabs Required Sizes add form). When
// qty > 1 we generate a shared batch_id (slab_requirements.batch_id
// already exists from mig 026) so the panel can render the group as
// a single "batch of N" card and the new
// bulkUpdate/Delete-ExternalCutSlabs actions can edit/delete them
// together.
//
// Also: label / description / stock_location are now MANDATORY at
// the server. Daksh wants every externally-sourced slab to carry
// proper identifying metadata so vendors aren't guessing what's in
// front of them. The client form also marks the fields required, but
// the server is the authoritative gate.
export async function addExternalCutSlabAction(formData: FormData) {
  const { profile } = await requireAuth();
  if (!canAddExternalCutSlab(profile)) {
    redirect("/carving?toast=Not+authorised+to+add+external+slabs");
  }
  const admin = createAdminSupabaseClient();
  const redirectTo = txt(formData, "redirect_to") || "/carving";

  const temple = txt(formData, "temple");
  if (!temple) redirect(`${redirectTo}?toast=Temple+is+required`);
  const stone = txt(formData, "stone");
  if (!stone) redirect(`${redirectTo}?toast=Stone+type+is+required`);

  const lengthIn = num(formData, "length_in");
  const widthIn = num(formData, "width_in");
  const thicknessIn = num(formData, "thickness_in");
  if (lengthIn <= 0 || widthIn <= 0 || thicknessIn <= 0) {
    redirect(`${redirectTo}?toast=Length+%2F+width+%2F+thickness+must+be+positive`);
  }

  // Mig 081 follow-on — mandatory metadata. Each is its own toast so
  // the user knows exactly which field they skipped.
  const label = txt(formData, "label");
  if (!label) redirect(`${redirectTo}?toast=${encodeURIComponent("Label is required")}`);
  const description = txt(formData, "description");
  if (!description) {
    redirect(`${redirectTo}?toast=${encodeURIComponent("Description is required")}`);
  }
  const stockLocation = txt(formData, "stock_location");
  if (!stockLocation) {
    redirect(`${redirectTo}?toast=${encodeURIComponent("Stock location is required")}`);
  }
  const quality = txt(formData, "quality") || null;
  const priority = txt(formData, "priority") === "true";

  // Quantity (default 1, clamp 1-100). On qty > 1 we mint a batch_id
  // and insert N rows under shared metadata; on qty = 1 batch_id stays
  // null so single-slab edit/delete still flows through the existing
  // single-slab paths.
  const qty = Math.min(100, Math.max(1, parseInt(txt(formData, "quantity") || "1", 10) || 1));
  const batchId = qty > 1 ? crypto.randomUUID() : null;

  // Look up the temple's code_prefix so the new ID slots into the same
  // numbering as in-system slabs from that temple.
  const { data: templeRow } = await admin
    .from("temples")
    .select("code_prefix")
    .eq("name", temple)
    .maybeSingle();
  const prefix = (templeRow as { code_prefix?: string } | null)?.code_prefix ?? "SLB";

  // ID allocation: copy the addSlabAction batch pattern. Highest-
  // existing-ID lookup + collision retry handles concurrent inserts.
  // Batch IDs are: baseId, baseId-1, baseId-2, ... baseId-(qty-1).
  let baseId = "";
  let insertedIds: string[] = [];
  let lastError: { message: string; code?: string } | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: maxRow } = await admin
      .from("slab_requirements")
      .select("id")
      .like("id", `${prefix}-%`)
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    baseId = nextSlabCodeFromMaxId(
      (maxRow as { id?: string } | null)?.id ?? null,
      prefix,
    );

    const common = {
      label,
      description,
      temple,
      stone,
      quality,
      length_ft: lengthIn,
      width_ft: widthIn,
      thickness_ft: thicknessIn,
      priority,
      // Drop the slab straight into Unassigned on /carving. Skips
      // the open → cut_session → cut_done lifecycle entirely.
      status: "cut_done" as const,
      // No block — the slab never went through our cutting.
      source_block_id: null,
      stock_location: stockLocation,
      batch_id: batchId,
      created_by: profile.id,
      updated_by: profile.id,
    };

    const rows = Array.from({ length: qty }, (_, i) => ({
      ...common,
      id: i === 0 ? baseId : `${baseId}-${i}`,
    }));

    const { error } = await admin.from("slab_requirements").insert(rows);
    if (!error) {
      lastError = null;
      insertedIds = rows.map((r) => r.id);
      break;
    }
    lastError = { message: error.message, code: error.code };
    if (error.code !== "23505") break;
    // 23505 = primary-key collision; refetch + retry.
  }
  if (lastError) {
    redirect(
      `${redirectTo}?toast=${encodeURIComponent(lastError.message)}`,
    );
  }

  await logAudit(
    profile.id,
    "external_cut_slab_added",
    "slab",
    baseId,
    {
      temple,
      stone,
      length_in: lengthIn,
      width_in: widthIn,
      thickness_in: thicknessIn,
      stock_location: stockLocation,
      qty,
      batch_id: batchId,
      ids: insertedIds,
    },
  );

  refreshAll();
  const toastMsg =
    qty > 1
      ? `${qty} external slabs added (${baseId} … ${insertedIds[insertedIds.length - 1]})`
      : `External slab ${baseId} added`;
  redirect(
    `${redirectTo}?tab=unassigned&toast=${encodeURIComponent(toastMsg)}`,
  );
}

/** Edit an externally-added cut slab. Same permission gate as the add
 *  action. Refuses to touch slabs that came from cutting
 *  (source_block_id IS NOT NULL) or that have left the Unassigned tab
 *  (status !== 'cut_done') — once assigned, dimensions must not change
 *  out from under the vendor.
 */
export async function updateExternalCutSlabAction(formData: FormData) {
  const { profile } = await requireAuth();
  if (!canAddExternalCutSlab(profile)) {
    redirect("/carving?toast=Not+authorised+to+edit+external+slabs");
  }
  const admin = createAdminSupabaseClient();
  const redirectTo = txt(formData, "redirect_to") || "/carving";

  const id = txt(formData, "id");
  if (!id) redirect(`${redirectTo}?toast=Missing+slab+id`);

  // Load + validate it's an external + still unassigned.
  const { data: existing } = await admin
    .from("slab_requirements")
    .select("id, status, source_block_id")
    .eq("id", id)
    .maybeSingle();
  if (!existing) redirect(`${redirectTo}?toast=Slab+not+found`);
  const row = existing as {
    id: string;
    status: string;
    source_block_id: string | null;
  };
  if (row.source_block_id !== null) {
    redirect(
      `${redirectTo}?toast=${encodeURIComponent("Only externally-added slabs can be edited here")}`,
    );
  }
  if (row.status !== "cut_done") {
    redirect(
      `${redirectTo}?toast=${encodeURIComponent(`Slab is in ${row.status} state — already assigned, can't edit here`)}`,
    );
  }

  const temple = txt(formData, "temple");
  if (!temple) redirect(`${redirectTo}?toast=Temple+is+required`);
  const stone = txt(formData, "stone");
  if (!stone) redirect(`${redirectTo}?toast=Stone+type+is+required`);
  const lengthIn = num(formData, "length_in");
  const widthIn = num(formData, "width_in");
  const thicknessIn = num(formData, "thickness_in");
  if (lengthIn <= 0 || widthIn <= 0 || thicknessIn <= 0) {
    redirect(`${redirectTo}?toast=Length+%2F+width+%2F+thickness+must+be+positive`);
  }

  // Mig 081 follow-on — same mandatory metadata as the add action.
  // Each field gets its own toast so the user knows what they missed.
  const label = txt(formData, "label");
  if (!label) redirect(`${redirectTo}?toast=${encodeURIComponent("Label is required")}`);
  const description = txt(formData, "description");
  if (!description) {
    redirect(`${redirectTo}?toast=${encodeURIComponent("Description is required")}`);
  }
  const stockLocation = txt(formData, "stock_location");
  if (!stockLocation) {
    redirect(`${redirectTo}?toast=${encodeURIComponent("Stock location is required")}`);
  }
  const quality = txt(formData, "quality") || null;
  const priority = txt(formData, "priority") === "true";

  const { error } = await admin
    .from("slab_requirements")
    .update({
      label,
      description,
      temple,
      stone,
      quality,
      length_ft: lengthIn,
      width_ft: widthIn,
      thickness_ft: thicknessIn,
      priority,
      stock_location: stockLocation,
      updated_by: profile.id,
    })
    .eq("id", id)
    .is("source_block_id", null)
    .eq("status", "cut_done");
  if (error) {
    redirect(
      `${redirectTo}?toast=${encodeURIComponent(error.message)}`,
    );
  }

  await logAudit(
    profile.id,
    "external_cut_slab_updated",
    "slab",
    id,
    {
      temple,
      stone,
      length_in: lengthIn,
      width_in: widthIn,
      thickness_in: thicknessIn,
      stock_location: stockLocation,
    },
  );

  refreshAll();
  redirect(
    `${redirectTo}?tab=unassigned&toast=${encodeURIComponent(`Slab ${id} updated`)}`,
  );
}

/** Delete an externally-added cut slab. Same gates as the edit action:
 *  external only (source_block_id IS NULL) + unassigned only
 *  (status='cut_done'). Hard delete because there's no downstream
 *  paper trail to preserve — the slab never went through cutting and
 *  was never assigned to a vendor.
 */
export async function deleteExternalCutSlabAction(formData: FormData) {
  const { profile } = await requireAuth();
  if (!canAddExternalCutSlab(profile)) {
    redirect("/carving?toast=Not+authorised+to+delete+external+slabs");
  }
  const admin = createAdminSupabaseClient();
  const redirectTo = txt(formData, "redirect_to") || "/carving";

  const id = txt(formData, "id");
  if (!id) redirect(`${redirectTo}?toast=Missing+slab+id`);

  // Same validation as the edit path — match-by-id with the safety
  // filters so a race can't sneak through.
  const { data: existing } = await admin
    .from("slab_requirements")
    .select("id, status, source_block_id, temple")
    .eq("id", id)
    .maybeSingle();
  if (!existing) redirect(`${redirectTo}?toast=Slab+not+found`);
  const row = existing as {
    id: string;
    status: string;
    source_block_id: string | null;
    temple: string;
  };
  if (row.source_block_id !== null) {
    redirect(
      `${redirectTo}?toast=${encodeURIComponent("Only externally-added slabs can be deleted here")}`,
    );
  }
  if (row.status !== "cut_done") {
    redirect(
      `${redirectTo}?toast=${encodeURIComponent(`Slab is in ${row.status} state — already assigned, can't delete here`)}`,
    );
  }

  const { error } = await admin
    .from("slab_requirements")
    .delete()
    .eq("id", id)
    .is("source_block_id", null)
    .eq("status", "cut_done");
  if (error) {
    redirect(
      `${redirectTo}?toast=${encodeURIComponent(error.message)}`,
    );
  }

  await logAudit(
    profile.id,
    "external_cut_slab_deleted",
    "slab",
    id,
    { temple: row.temple },
  );

  refreshAll();
  redirect(
    `${redirectTo}?tab=unassigned&toast=${encodeURIComponent(`Slab ${id} deleted`)}`,
  );
}

// ── Mig 081 follow-on — bulk edit/delete for external-cut-slab batches
//
// When the reviewer added multiple external slabs at once
// (addExternalCutSlabAction with quantity > 1), every row shares a
// batch_id. These two actions let the user edit or delete the
// entire batch in one go without ticking checkboxes.
//
// Guards mirror the single-slab paths:
//   • source_block_id IS NULL  — externals only
//   • status = 'cut_done'      — only unassigned slabs (anything
//     already on a CNC must stay frozen so the vendor isn't
//     pulled out from under)
// Plus an explicit batch_id presence + non-empty match check so a
// stray client can't trigger a no-op or mass-update.
//
// The form sends only the batch_id; we resolve all matching slab
// ids server-side, then apply the same payload to every one.

export async function bulkUpdateExternalCutSlabsAction(formData: FormData) {
  const { profile } = await requireAuth();
  if (!canAddExternalCutSlab(profile)) {
    redirect("/carving?toast=Not+authorised+to+edit+external+slabs");
  }
  const admin = createAdminSupabaseClient();
  const redirectTo = txt(formData, "redirect_to") || "/carving";

  const batchId = txt(formData, "batch_id");
  if (!batchId) redirect(`${redirectTo}?toast=${encodeURIComponent("Missing batch id")}`);

  const temple = txt(formData, "temple");
  if (!temple) redirect(`${redirectTo}?toast=Temple+is+required`);
  const stone = txt(formData, "stone");
  if (!stone) redirect(`${redirectTo}?toast=Stone+type+is+required`);
  const lengthIn = num(formData, "length_in");
  const widthIn = num(formData, "width_in");
  const thicknessIn = num(formData, "thickness_in");
  if (lengthIn <= 0 || widthIn <= 0 || thicknessIn <= 0) {
    redirect(`${redirectTo}?toast=Length+%2F+width+%2F+thickness+must+be+positive`);
  }

  // Mandatory metadata (same as single-slab paths).
  const label = txt(formData, "label");
  if (!label) redirect(`${redirectTo}?toast=${encodeURIComponent("Label is required")}`);
  const description = txt(formData, "description");
  if (!description) {
    redirect(`${redirectTo}?toast=${encodeURIComponent("Description is required")}`);
  }
  const stockLocation = txt(formData, "stock_location");
  if (!stockLocation) {
    redirect(`${redirectTo}?toast=${encodeURIComponent("Stock location is required")}`);
  }
  const quality = txt(formData, "quality") || null;
  const priority = txt(formData, "priority") === "true";

  // Resolve targets server-side so the caller can't smuggle in ids
  // from a different batch.
  const { data: targets } = await admin
    .from("slab_requirements")
    .select("id")
    .eq("batch_id", batchId)
    .is("source_block_id", null)
    .eq("status", "cut_done");
  if (!targets || targets.length === 0) {
    redirect(
      `${redirectTo}?toast=${encodeURIComponent("Batch is empty or already assigned — nothing to edit")}`,
    );
  }
  const targetIds = (targets as Array<{ id: string }>).map((t) => t.id);

  const { error } = await admin
    .from("slab_requirements")
    .update({
      label,
      description,
      temple,
      stone,
      quality,
      length_ft: lengthIn,
      width_ft: widthIn,
      thickness_ft: thicknessIn,
      priority,
      stock_location: stockLocation,
      updated_by: profile.id,
    })
    .in("id", targetIds)
    .eq("batch_id", batchId)
    .is("source_block_id", null)
    .eq("status", "cut_done");
  if (error) {
    redirect(`${redirectTo}?toast=${encodeURIComponent(error.message)}`);
  }

  await logAudit(
    profile.id,
    "external_cut_slab_batch_updated",
    "slab",
    batchId,
    { ids: targetIds, qty: targetIds.length, temple, stone },
  );

  refreshAll();
  redirect(
    `${redirectTo}?tab=unassigned&toast=${encodeURIComponent(`${targetIds.length} slabs updated`)}`,
  );
}

export async function bulkDeleteExternalCutSlabsAction(formData: FormData) {
  const { profile } = await requireAuth();
  if (!canAddExternalCutSlab(profile)) {
    redirect("/carving?toast=Not+authorised+to+delete+external+slabs");
  }
  const admin = createAdminSupabaseClient();
  const redirectTo = txt(formData, "redirect_to") || "/carving";

  const batchId = txt(formData, "batch_id");
  if (!batchId) redirect(`${redirectTo}?toast=${encodeURIComponent("Missing batch id")}`);

  // Pull the target rows first — we need (a) the count for the
  // toast, (b) ids for the audit log, (c) the temple for logging.
  const { data: targets } = await admin
    .from("slab_requirements")
    .select("id, temple")
    .eq("batch_id", batchId)
    .is("source_block_id", null)
    .eq("status", "cut_done");
  if (!targets || targets.length === 0) {
    redirect(
      `${redirectTo}?toast=${encodeURIComponent("Batch is empty or already assigned — nothing to delete")}`,
    );
  }
  const targetIds = (targets as Array<{ id: string; temple: string }>).map((t) => t.id);
  const temple = (targets[0] as { temple?: string } | undefined)?.temple ?? "";

  const { error } = await admin
    .from("slab_requirements")
    .delete()
    .in("id", targetIds)
    .eq("batch_id", batchId)
    .is("source_block_id", null)
    .eq("status", "cut_done");
  if (error) {
    redirect(`${redirectTo}?toast=${encodeURIComponent(error.message)}`);
  }

  await logAudit(
    profile.id,
    "external_cut_slab_batch_deleted",
    "slab",
    batchId,
    { ids: targetIds, qty: targetIds.length, temple },
  );

  refreshAll();
  redirect(
    `${redirectTo}?tab=unassigned&toast=${encodeURIComponent(`${targetIds.length} slabs deleted`)}`,
  );
}

// ── Vendor CRUD (team-side) ─────────────────────────────────────────

// Mig 081 follow-on (Daksh) — vendor CRUD allowlist widened to
// include carving_head + senior_incharge. The Manage Vendors peek
// surfaces to those roles now (gated on the carving page) so the
// actions they hit from there must accept the role too. Mohit
// (role='vendor') is still excluded — the parent button isn't
// rendered for him, and the action would reject him if he tried to
// post directly.
const VENDOR_CRUD_ROLES = [
  "developer",
  "owner",
  "carving_head",
  "senior_incharge",
  "tender_manager",
] as const;

export async function createVendorAction(formData: FormData) {
  const { profile } = await requireAuth([...VENDOR_CRUD_ROLES]);
  const admin = createAdminSupabaseClient();

  const name = txt(formData, "name");
  const vendorType = txt(formData, "vendor_type") as "CNC" | "Outsource";
  const machinesJson = txt(formData, "machines_json");
  // Migration 025 — standard slab dropoff location for CNC vendors.
  const dropoffLocation = txt(formData, "dropoff_location") || null;
  // Daksh June 2026 — caller can pass redirect_to so creating a vendor
  // from the /carving Manage-Vendors peek lands back on /carving (where
  // the new Manual carver is immediately assignable) instead of
  // bouncing to the standalone /carving/vendors page.
  const redirectTo = txt(formData, "redirect_to") || "/carving/vendors";

  if (!name) redirect(`${redirectTo}?toast=Vendor+name+is+required`);
  if (!["CNC", "Outsource"].includes(vendorType)) {
    redirect(`${redirectTo}?toast=Invalid+vendor+type`);
  }

  const { data: vendor, error } = await admin
    .from("vendors")
    .insert({
      name,
      vendor_type: vendorType,
      is_active: true,
      // Only persist dropoff_location for CNC vendors (Manual has no
      // shade to deliver to).
      ...(vendorType === "CNC" ? { dropoff_location: dropoffLocation } : {}),
    })
    .select("id")
    .single();

  if (error || !vendor) {
    redirect(`${redirectTo}?toast=${encodeURIComponent(error?.message ?? "Failed to create vendor")}`);
  }

  // If CNC, insert machines. Surface errors via toast — silently
  // logging means the user sees "Vendor created" but no machines
  // appear and they can't tell why.
  if (vendorType === "CNC" && machinesJson) {
    let machineErr: string | null = null;
    try {
      const machines = JSON.parse(machinesJson) as Array<{
        machine_code: string;
        operator_name?: string;
        machine_type?: "single_head" | "multi_head_2" | "lathe";
        cnc_axes?: number | null;
        max_length_in?: number | string | null;
        max_width_in?: number | string | null;
        max_thickness_in?: number | string | null;
      }>;
      const rows = machines
        .filter((m) => m.machine_code.trim())
        .map((m) => {
          const type = m.machine_type ?? "multi_head_2";
          // Mig 079 — Lathe never carries cnc_axes (axis count
          // doesn't apply). CNC types default to 3-axis if the
          // form didn't send a value, to match the existing fleet's
          // backfilled behaviour.
          const axes =
            type === "lathe"
              ? null
              : m.cnc_axes === 4 || m.cnc_axes === 5
                ? m.cnc_axes
                : 3;
          return {
            // Belt-and-suspenders: generate the UUID app-side so the
            // insert succeeds even if the cnc_machines.id column is
            // missing its gen_random_uuid() default on the target DB.
            id: crypto.randomUUID(),
            vendor_id: vendor.id,
            machine_code: m.machine_code.trim(),
            operator_name: m.operator_name?.trim() || null,
            machine_type: type,
            cnc_axes: axes,
            // Per-machine dimension caps from migration 024. Empty
            // string / undefined / null → NULL (no limit).
            max_length_in: parseDim(m.max_length_in),
            max_width_in: parseDim(m.max_width_in),
            max_thickness_in: parseDim(m.max_thickness_in),
            is_active: true,
          };
        });
      if (rows.length > 0) {
        const { error: mErr } = await admin.from("cnc_machines").insert(rows);
        if (mErr) throw new Error(mErr.message);
      }
    } catch (e) {
      machineErr = e instanceof Error ? e.message : String(e);
      console.error("[createVendorAction] machine insert error:", e);
    }
    if (machineErr) {
      await logAudit(profile.id, "vendor_created", "vendor", vendor.id, { name, type: vendorType, machine_error: machineErr });
      refreshAll();
      redirect(
        `/carving/vendors/${vendor.id}?toast=${encodeURIComponent(`Vendor saved but machines failed: ${machineErr}`)}`,
      );
    }
  }

  await logAudit(profile.id, "vendor_created", "vendor", vendor.id, { name, type: vendorType });
  refreshAll();
  redirect(`${redirectTo}?toast=Vendor+created`);
}

export async function updateVendorAction(formData: FormData) {
  const { profile } = await requireAuth([...VENDOR_CRUD_ROLES]);
  const admin = createAdminSupabaseClient();

  const vendorId = txt(formData, "vendor_id");
  const name = txt(formData, "name");
  const vendorType = txt(formData, "vendor_type") as "CNC" | "Outsource";
  const isActive = txt(formData, "is_active") === "true";
  const machinesJson = txt(formData, "machines_json");
  // Migration 025 — slab dropoff location (CNC only). Empty string
  // from the form means "no value" → NULL.
  const dropoffLocation = txt(formData, "dropoff_location") || null;
  // Caller can pass redirect_to to land back where they came from
  // (carving page peek modal sends "/carving"). Defaults to the
  // vendor's detail page for back-compat with the old form.
  const redirectTo = txt(formData, "redirect_to") || `/carving/vendors/${vendorId}`;

  if (!vendorId || !name) redirect(`${redirectTo}?toast=Missing+fields`);

  const { error } = await admin
    .from("vendors")
    .update({
      name,
      vendor_type: vendorType,
      is_active: isActive,
      // Only update dropoff_location when the vendor is CNC. Switching
      // CNC→Manual or back-and-forth doesn't wipe a previously-set
      // value (we just leave it alone).
      ...(vendorType === "CNC" ? { dropoff_location: dropoffLocation } : {}),
    })
    .eq("id", vendorId);

  if (error) {
    redirect(`${redirectTo}?toast=${encodeURIComponent(error.message)}`);
  }

  // Sync machines for CNC vendors. Errors here used to be swallowed
  // (logged + ignored) which meant the user clicked "Save changes",
  // saw "Vendor saved", and had no idea why the new machine wasn't
  // there. Now we redirect with the real error in the toast.
  if (vendorType === "CNC" && machinesJson) {
    let machineErr: string | null = null;
    try {
      const machines = JSON.parse(machinesJson) as Array<{
        id?: string;
        machine_code: string;
        operator_name?: string;
        machine_type?: "single_head" | "multi_head_2" | "lathe";
        cnc_axes?: number | null;
        max_length_in?: number | string | null;
        max_width_in?: number | string | null;
        max_thickness_in?: number | string | null;
        is_active?: boolean;
        _delete?: boolean;
      }>;

      // Delete marked machines
      const toDelete = machines.filter((m) => m._delete && m.id).map((m) => m.id!);
      if (toDelete.length > 0) {
        const { error: dErr } = await admin.from("cnc_machines").delete().in("id", toDelete);
        if (dErr) throw new Error(`delete failed: ${dErr.message}`);
      }

      // Look up rows already in the DB for this vendor so we can map
      // existing (vendor_id, machine_code) → id. If the form sends a
      // machine without an `id` but a row with that code already
      // exists for this vendor, we use the existing id so the upsert
      // UPDATES the row instead of trying to INSERT a new one (which
      // would violate the unique (vendor_id, machine_code) constraint).
      // This handles three failure modes:
      //   1. Pre-fix partial saves left orphan rows that the form
      //      doesn't know the id of.
      //   2. Two browser tabs racing each other.
      //   3. User typing the same code as an inactive deleted row.
      const { data: existingForVendor } = await admin
        .from("cnc_machines")
        .select("id, machine_code")
        .eq("vendor_id", vendorId);
      const codeToExistingId = new Map<string, string>();
      for (const row of existingForVendor ?? []) {
        codeToExistingId.set(row.machine_code, row.id);
      }

      // Upsert the rest. Order of preference for the row's id:
      //   1. id supplied by the form (existing row being updated)
      //   2. id we just looked up by (vendor_id, machine_code)
      //   3. a fresh UUID (genuinely new row)
      // Migration 022 also restores gen_random_uuid() as the column
      // default — this app-side path is the second line of defence.
      const toUpsert = machines
        .filter((m) => !m._delete && m.machine_code.trim())
        .map((m) => {
          const code = m.machine_code.trim();
          const id = m.id || codeToExistingId.get(code) || crypto.randomUUID();
          const type = m.machine_type ?? "multi_head_2";
          // Mig 079 — same axis logic as createVendorAction. Lathes
          // get NULL; CNCs default to 3-axis if the form didn't
          // send a valid value. Stays in sync with the row's
          // machine_type even if a user flips between CNC ↔ Lathe.
          const axes =
            type === "lathe"
              ? null
              : m.cnc_axes === 4 || m.cnc_axes === 5
                ? m.cnc_axes
                : 3;
          return {
            id,
            vendor_id: vendorId,
            machine_code: code,
            operator_name: m.operator_name?.trim() || null,
            machine_type: type,
            cnc_axes: axes,
            // Per-machine dimension caps (migration 024).
            max_length_in: parseDim(m.max_length_in),
            max_width_in: parseDim(m.max_width_in),
            max_thickness_in: parseDim(m.max_thickness_in),
            is_active: m.is_active ?? true,
          };
        });

      if (toUpsert.length > 0) {
        const { error: mErr } = await admin.from("cnc_machines").upsert(toUpsert);
        if (mErr) throw new Error(mErr.message);
      }
    } catch (e) {
      machineErr = e instanceof Error ? e.message : String(e);
      console.error("[updateVendorAction] machine sync error:", e);
    }
    if (machineErr) {
      await logAudit(profile.id, "vendor_updated", "vendor", vendorId, { name, machine_error: machineErr });
      refreshAll();
      redirect(`${redirectTo}?toast=${encodeURIComponent(`Machine sync failed: ${machineErr}`)}`);
    }
  }

  await logAudit(profile.id, "vendor_updated", "vendor", vendorId, { name });
  refreshAll();
  redirect(`${redirectTo}?toast=Vendor+saved`);
}

export async function deactivateVendorAction(formData: FormData) {
  const { profile } = await requireAuth([...VENDOR_CRUD_ROLES]);
  const admin = createAdminSupabaseClient();
  const vendorId = txt(formData, "vendor_id");
  const redirectTo = txt(formData, "redirect_to") || "/carving/vendors";

  await admin.from("vendors").update({ is_active: false }).eq("id", vendorId);
  await logAudit(profile.id, "vendor_deactivated", "vendor", vendorId, {});
  refreshAll();
  redirect(`${redirectTo}?toast=Vendor+deactivated`);
}

export async function reactivateVendorAction(formData: FormData) {
  const { profile } = await requireAuth([...VENDOR_CRUD_ROLES]);
  const admin = createAdminSupabaseClient();
  const vendorId = txt(formData, "vendor_id");
  const redirectTo = txt(formData, "redirect_to") || "/carving/vendors";

  await admin.from("vendors").update({ is_active: true }).eq("id", vendorId);
  await logAudit(profile.id, "vendor_reactivated", "vendor", vendorId, {});
  refreshAll();
  redirect(`${redirectTo}?toast=Vendor+reactivated`);
}

// Hard-delete a vendor. Only allowed when the vendor has no carving
// items referencing it AND no machines.
//
// Mig 081 follow-on (Daksh) — hardened from "silent soft-delete
// fallback" to a HARD BLOCK with a clear toast. Daksh: "create a
// protective lock if with that vendor any slab or cnc is there it
// should be locked to delete." Silent fallback was confusing — the
// user clicked Delete + got a vague "deactivated instead" toast and
// didn't realise the vendor was still around. The new posture:
//   • Any cnc_machines row referencing this vendor → REFUSE delete.
//     Show count + tell the user to remove the machines first
//     (vendor detail page → Machines).
//   • Any carving_items row referencing this vendor (any status,
//     past or present) → REFUSE delete. Show count + tell the user
//     to use Deactivate instead (preserves history).
//   • Clean — no machines, no items → HARD DELETE proceeds.
// Deactivate is still available as a separate button in the UI for
// the "I just want this off the active list" case, so this gate
// doesn't close off any legitimate workflow.
export async function deleteVendorAction(formData: FormData) {
  const { profile } = await requireAuth([...VENDOR_CRUD_ROLES]);
  const admin = createAdminSupabaseClient();
  const vendorId = txt(formData, "vendor_id");
  const redirectTo = txt(formData, "redirect_to") || "/carving/vendors";

  if (!vendorId) redirect(`${redirectTo}?toast=Missing+vendor+id`);

  // Fetch the name + reference counts in parallel.
  const [{ data: vendorRow }, { count: itemCount }, { count: machineCount }] =
    await Promise.all([
      admin.from("vendors").select("name").eq("id", vendorId).maybeSingle(),
      admin
        .from("carving_items")
        .select("id", { count: "exact", head: true })
        .eq("vendor_id", vendorId),
      admin
        .from("cnc_machines")
        .select("id", { count: "exact", head: true })
        .eq("vendor_id", vendorId),
    ]);
  const vendorName = (vendorRow as { name?: string } | null)?.name ?? "Vendor";

  // HARD BLOCK if anything references the vendor. Audit-log the
  // attempt so we have a trail of who tried to delete what (useful
  // if a junior staff member is poking at the UI).
  if ((itemCount ?? 0) > 0 || (machineCount ?? 0) > 0) {
    await logAudit(profile.id, "vendor_delete_blocked", "vendor", vendorId, {
      reason: "has_references",
      carving_items: itemCount ?? 0,
      machines: machineCount ?? 0,
    });
    const parts: string[] = [];
    if ((machineCount ?? 0) > 0) {
      parts.push(`${machineCount} machine${machineCount === 1 ? "" : "s"}`);
    }
    if ((itemCount ?? 0) > 0) {
      parts.push(`${itemCount} slab${itemCount === 1 ? "" : "s"}`);
    }
    const detail = parts.join(" + ");
    const hint =
      (machineCount ?? 0) > 0
        ? "Remove the machines first (vendor → Machines), or use Deactivate."
        : "Use Deactivate instead to keep the audit trail.";
    redirect(
      `${redirectTo}?toast=${encodeURIComponent(
        `Cannot delete ${vendorName} — has ${detail}. ${hint}`,
      )}`,
    );
  }

  // Clean — safe to hard delete.
  const { error } = await admin.from("vendors").delete().eq("id", vendorId);
  if (error) {
    redirect(`${redirectTo}?toast=${encodeURIComponent(error.message)}`);
  }
  await logAudit(profile.id, "vendor_deleted", "vendor", vendorId, {
    name: vendorName,
  });
  refreshAll();
  redirect(`${redirectTo}?toast=${encodeURIComponent(`${vendorName} deleted`)}`);
}

// ── Carving job lifecycle ───────────────────────────────────────────

/**
 * WhatsApp ping to the slab-transfer runner when a slab lands in Pending
 * stock (awaiting transfer). Fire-and-forget: gated behind the
 * MSG91_WA_SLAB_TRANSFER_TEMPLATE env (set once the DLT template is
 * approved), never throws — it can't block an assign.
 * Template body variables — register them in THIS order:
 *   {{1}} slab code · {{2}} size · {{3}} from (stock location) · {{4}} to (vendor).
 */
async function notifySlabTransferWaiting(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  slabId: string,
  vendorName: string,
) {
  try {
    const templateName = process.env.MSG91_WA_SLAB_TRANSFER_TEMPLATE;
    if (!templateName || !process.env.MSG91_AUTH_KEY) return;
    const { sendWhatsAppTemplate } = await import("@/lib/wa-send");
    // Recipient + on/off come from the developer "WhatsApp alerts" setting
    // (app_settings) — not role phones — so it's controllable from the UI.
    const { getSlabTransferAlert, getSlabTransferRecipients } = await import("@/lib/wa-alerts");
    if (!(await getSlabTransferAlert()).enabled) return;
    const to = await getSlabTransferRecipients();
    if (to.length === 0) return;

    const { data: slab } = await admin
      .from("slab_requirements")
      .select("length_ft, width_ft, thickness_ft, stock_location")
      .eq("id", slabId)
      .maybeSingle();
    const s = (slab ?? {}) as {
      length_ft?: number | string; width_ft?: number | string;
      thickness_ft?: number | string; stock_location?: string | null;
    };
    const dims = `${Number(s.length_ft) || 0}×${Number(s.width_ft) || 0}×${Number(s.thickness_ft) || 0} in`;
    const from = String(s.stock_location || "Yard");

    await sendWhatsAppTemplate({
      to,
      templateName,
      components: {
        body_1: { type: "text", value: slabId },
        body_2: { type: "text", value: dims },
        body_3: { type: "text", value: from },
        body_4: { type: "text", value: vendorName },
      },
    });
  } catch (e) {
    console.warn("[notifySlabTransferWaiting] non-fatal", e);
  }
}

/**
 * WhatsApp alert when the carving "Done Approval" backlog crosses a
 * milestone. Fires when the pending-approval count first reaches the
 * configured threshold (default 15) and again every `step` (default 5)
 * above it — at 15, 20, 25 … — always with the live total in the message.
 * A stored "last alerted level" means it only pings on a NEW high and
 * re-arms once the queue drains. Call at the END of any action that moves
 * a slab into the approval queue. Fire-and-forget; never throws.
 * Gated behind MSG91_WA_CARVING_BACKLOG_TEMPLATE + the Settings toggle.
 */
async function notifyCarvingApprovalBacklog(
  admin: ReturnType<typeof createAdminSupabaseClient>,
) {
  try {
    const templateName = process.env.MSG91_WA_CARVING_BACKLOG_TEMPLATE;
    if (!templateName || !process.env.MSG91_AUTH_KEY) return;
    const {
      getCarvingBacklog,
      getCarvingBacklogRecipients,
      getBacklogAlertLevel,
      setBacklogAlertLevel,
      backlogLevelFor,
    } = await import("@/lib/wa-alerts");
    const cfg = await getCarvingBacklog();
    if (!cfg.enabled) return;
    const to = await getCarvingBacklogRecipients();
    if (to.length === 0) return;

    // Same predicate as the carving "Done Approval" tab (page.tsx), so the
    // alerted number always matches what the reviewer sees: marked done, not
    // yet approved, not parked in "Still Pending".
    const { data: pendingRows } = await admin
      .from("carving_items")
      .select("slab_requirement_id, vendor_name, completed_at, temporary_location")
      .not("completed_at", "is", null)
      .is("review_approved_at", null)
      .is("pending_work_at", null);
    const pending = (pendingRows ?? []) as {
      slab_requirement_id: string;
      vendor_name: string | null;
      completed_at: string | null;
      temporary_location: string | null;
    }[];
    const total = pending.length;

    const level = backlogLevelFor(total, cfg.threshold, cfg.step);
    const prev = await getBacklogAlertLevel();
    if (level <= prev) {
      // Flat or draining — re-arm to the lower level so it can fire again
      // next time it climbs, but don't ping now.
      if (level < prev) await setBacklogAlertLevel(level);
      return;
    }
    await setBacklogAlertLevel(level);

    // Hydrate full slab detail + stone palette + the active CNC vendor list
    // (the latter so every CNC vendor shows, "No pending" if empty, and new
    // CNC vendors appear automatically).
    const slabIds = [...new Set(pending.map((p) => p.slab_requirement_id))];
    const slabInfo = new Map<
      string,
      {
        temple: string;
        label: string | null;
        stone: string | null;
        length_ft: number;
        width_ft: number;
        thickness_ft: number;
        stock_location: string | null;
      }
    >();
    if (slabIds.length > 0) {
      const { data: slabs } = await admin
        .from("slab_requirements")
        .select("id, temple, label, stone, length_ft, width_ft, thickness_ft, stock_location")
        .in("id", slabIds);
      for (const s of (slabs ?? []) as Array<Record<string, unknown>>) {
        slabInfo.set(String(s.id), {
          temple: (s.temple as string) ?? "—",
          label: (s.label as string | null) ?? null,
          stone: (s.stone as string | null) ?? null,
          length_ft: Number(s.length_ft) || 0,
          width_ft: Number(s.width_ft) || 0,
          thickness_ft: Number(s.thickness_ft) || 0,
          stock_location: (s.stock_location as string | null) ?? null,
        });
      }
    }
    const { data: stoneTypesData } = await admin
      .from("stone_types")
      .select("name, color_top, color_front, color_side");
    const { data: cncVendors } = await admin
      .from("vendors")
      .select("name")
      .eq("vendor_type", "CNC")
      .eq("is_active", true);
    const cncNames = ((cncVendors ?? []) as { name: string | null }[])
      .map((v) => (v.name || "").trim())
      .filter(Boolean);

    const byVendor = new Map<
      string,
      Array<{
        code: string;
        temple: string;
        label: string | null;
        stone: string | null;
        l: number;
        w: number;
        t: number;
        location: string | null;
        completedAt: string | null;
      }>
    >();
    for (const p of pending) {
      const name = (p.vendor_name || "—").trim() || "—";
      const info = slabInfo.get(p.slab_requirement_id);
      const arr = byVendor.get(name) ?? [];
      arr.push({
        code: p.slab_requirement_id,
        temple: info?.temple ?? "—",
        label: info?.label ?? null,
        stone: info?.stone ?? null,
        l: info?.length_ft ?? 0,
        w: info?.width_ft ?? 0,
        t: info?.thickness_ft ?? 0,
        location: p.temporary_location ?? info?.stock_location ?? null,
        completedAt: p.completed_at,
      });
      byVendor.set(name, arr);
    }
    const allNames = [...new Set([...cncNames, ...byVendor.keys()])].sort((a, b) =>
      a.localeCompare(b),
    );
    const vendors = allNames.map((name) => ({ name, slabs: byVendor.get(name) ?? [] }));

    // Build the vendor-wise slab-card PDF and upload it to the public bucket
    // (same one the daily report uses) so MSG91 can fetch it by URL.
    const { buildCarvingBacklogPdf } = await import("@/lib/carving-backlog-pdf");
    const pdfBytes = await buildCarvingBacklogPdf({
      total,
      vendors,
      stoneTypes: (stoneTypesData ?? []) as Array<{
        name: string;
        color_top: string;
        color_front: string;
        color_side: string;
      }>,
    });
    const objPath = `carving-approval/${new Date().toISOString().slice(0, 10)}-${Date.now()}.pdf`;
    const { error: upErr } = await admin.storage
      .from("whatsapp_reports")
      .upload(objPath, Buffer.from(pdfBytes), { contentType: "application/pdf", upsert: false });
    if (upErr) throw new Error(`Backlog PDF upload failed: ${upErr.message}`);
    const pdfUrl = admin.storage.from("whatsapp_reports").getPublicUrl(objPath).data.publicUrl;

    const { sendWhatsAppTemplate } = await import("@/lib/wa-send");
    await sendWhatsAppTemplate({
      to,
      templateName,
      components: {
        header_1: { type: "document", value: pdfUrl, filename: "Carving-Approval.pdf" },
        body_1: { type: "text", value: String(total) },
      },
    });
  } catch (e) {
    console.warn("[notifyCarvingApprovalBacklog] non-fatal", e);
  }
}

export async function assignCarvingJobAction(formData: FormData) {
  // Mig 074/076 — anyone who can ACCESS the /carving page can assign
  // (dev/owner/carving_head/senior_incharge/team_head + vendors with
  // can_assign_carving). Mohit's submission was failing because his
  // vendor role isn't in the role-list above; canAccessCarvingPage
  // wraps the same logic the page guard uses.
  const { profile } = await requireAuth();
  if (!canAccessCarvingPage(profile)) {
    redirect("/carving?toast=Not+authorised+to+assign+carving");
  }
  const admin = createAdminSupabaseClient();

  const slabId = txt(formData, "slab_id");
  const vendorId = txt(formData, "vendor_id");
  const note = txt(formData, "note") || null;
  // Per-assignment slab-transfer bypass (Jun 2026). When the carving
  // head ticks "Receive now (skip transfer)" the slab auto-receives
  // even though SKIP_SLAB_TRANSFER_STAGE is false — so a slab never
  // stalls in Pending stock when no runner is on the floor.
  const receiveNow = txt(formData, "receive_now") === "1";
  // CNC ops: urgency + rough estimated carving minutes from the
  // carving head. Machine is NOT picked here — the vendor (CNC
  // supervisor) decides which of their machines to load it on.
  const urgency = txt(formData, "urgency") === "urgent" ? "urgent" : "normal";
  const estimatedMinutes = Math.max(0, num(formData, "estimated_minutes", 0));
  // Mig 094 — Outsource jobwork rate snapshot (₹ per cft/sft). Applied
  // only for Outsource vendors below; ignored for CNC. Optional — the
  // rate can also be set later on the challan.
  const jobworkRateRaw = txt(formData, "jobwork_rate");
  const jobworkRate =
    jobworkRateRaw && Number(jobworkRateRaw) > 0 ? Number(jobworkRateRaw) : null;
  const jobworkUnit = txt(formData, "jobwork_unit") === "sft" ? "sft" : "cft";
  // Mig 088 — double-side carving. 2 → output counts x2 in the CNC
  // costing + cockpit stat. Anything but "2" collapses to 1.
  const carvingSides = num(formData, "carving_sides", 1) === 2 ? 2 : 1;
  // Work-type tag (migration 024). Empty → NULL → flat-panel default.
  // Only "lathe" is user-selectable today; "multi_head_2" / "single_head"
  // are reserved for forward-compat.
  const requiresMachineTypeRaw = txt(formData, "requires_machine_type");
  const requiresMachineType: string | null =
    requiresMachineTypeRaw === "lathe" ||
    requiresMachineTypeRaw === "multi_head_2" ||
    requiresMachineTypeRaw === "single_head"
      ? requiresMachineTypeRaw
      : null;
  // Mig 079 — CNC axis requirement. Empty / unknown → NULL ("Any
  // CNC"); 4 or 5 → strict match enforced at load time. Only
  // meaningful when the assignment is to a CNC vendor + work-type
  // is flat-panel; we still pass NULL on lathe / Manual to keep
  // the behaviour byte-identical to before mig 079.
  const requiresCncAxesRaw = txt(formData, "requires_cnc_axes");
  const requiresCncAxes: number | null =
    requiresCncAxesRaw === "3"
      ? 3
      : requiresCncAxesRaw === "4"
        ? 4
        : requiresCncAxesRaw === "5"
          ? 5
          : null;

  if (!slabId || !vendorId) {
    redirect("/carving?toast=Missing+slab+or+vendor");
  }

  // Mig 132 — a slab with a pending cancel request is LOCKED: no new
  // assignment until the owner approves or rejects the cancel.
  {
    const { data: cancelCheck } = await admin
      .from("slab_requirements")
      .select("cancel_requested_at")
      .eq("id", slabId)
      .maybeSingle();
    if ((cancelCheck as { cancel_requested_at?: string | null } | null)?.cancel_requested_at) {
      redirect(`/carving?toast=${encodeURIComponent(`${slabId} has a pending CANCEL request — locked until the owner decides`)}`);
    }
  }

  // Load vendor so we can snapshot name/type into carving_items.
  // CNC + Manual are both allowed. Manual vendors skip the receive /
  // load / unload lifecycle — the carving head fires
  // markCarvingStartedManuallyAction + markCarvingCompleteManuallyAction
  // on their behalf (see Part E of the carving Phase 4 plan).
  const { data: vendor } = await admin
    .from("vendors")
    .select("id, name, vendor_type, is_active")
    .eq("id", vendorId)
    .single();

  if (!vendor) redirect("/carving?toast=Vendor+not+found");
  const vendorType = (vendor as { vendor_type: string }).vendor_type;
  if (vendorType !== "CNC" && vendorType !== "Outsource") {
    redirect("/carving?toast=Only+CNC+or+Outsource+vendors+supported");
  }
  if (!(vendor as { is_active: boolean }).is_active) {
    redirect("/carving?toast=Vendor+is+inactive");
  }

  // Daksh June 2026 — server-side backstop for the Outsource gating.
  // The /carving toggle hides Outsource mode from CNC operators, but a
  // CNC operator (vendor role + can_assign_carving, e.g. Mohit) can
  // still reach this action through the CNC assign form. Assigning to an
  // Outsource vendor (auto-start → Receive → jobwork challan) is the
  // office team's flow only, so reject it for anyone outside the four
  // roles — a replayed form can't push work to an Outsource carver.
  if (
    vendorType === "Outsource" &&
    !["developer", "owner", "carving_head", "senior_incharge", "tender_manager"].includes(profile.role)
  ) {
    redirect("/carving?toast=Not+authorised+for+Outsource+carving");
  }

  // Work-type tag only applies to CNC vendors. For Manual jobs we
  // ignore the field and store NULL (manual carvers have no machines
  // to match).
  const finalRequiresMachineType =
    vendorType === "CNC" ? requiresMachineType : null;
  // Mig 079 — axis requirement also applies only to CNC + flat-panel
  // (multi_head_2 / single_head). On Manual or Lathe assigns it's
  // meaningless; store NULL.
  const isCncFlat =
    vendorType === "CNC" &&
    (finalRequiresMachineType === null ||
      finalRequiresMachineType === "multi_head_2" ||
      finalRequiresMachineType === "single_head");
  const finalRequiresCncAxes = isCncFlat ? requiresCncAxes : null;

  // Mig 079 — vendor capability gate. If the assigner picked a
  // specific axis, the vendor MUST have at least one active CNC
  // machine of that axis count. Without this, dad's flow was
  // "pick 4-axis → assign to Alkesh → load action rejects". Now
  // we refuse the assignment up-front so the slab never moves and
  // the toast is on the assign surface where the assigner is
  // looking, not the cockpit they don't see.
  if (finalRequiresCncAxes != null) {
    const { data: matchingMachines } = await admin
      .from("cnc_machines")
      .select("id")
      .eq("vendor_id", vendorId)
      .eq("is_active", true)
      .eq("cnc_axes", finalRequiresCncAxes)
      .limit(1);
    if (!matchingMachines || matchingMachines.length === 0) {
      const vendorName = (vendor as { name: string }).name;
      const friendly = `${vendorName} has no ${finalRequiresCncAxes}-axis CNC. Pick a different vendor or change the CNC axes requirement to "Any".`;
      redirect(`/carving?toast=${encodeURIComponent(friendly)}`);
    }
  }

  // Daksh (Jun 2026) — Outsource now routes through the cutting→carving
  // transfer too: an assigned slab waits at carving_assigned (In Transit)
  // until the transfer runner delivers it to the vendor; receipt then flips
  // it to carving_in_progress (Active). CNC works the same way.
  const isOutsource = vendorType === "Outsource";
  const assignedStatus = "carving_assigned";

  // Race guard: slab must currently be cut_done
  const { data: slabRow, error: slabErr } = await admin
    .from("slab_requirements")
    .update({ status: assignedStatus, updated_by: profile.id, updated_at: new Date().toISOString() })
    .eq("id", slabId)
    .eq("status", "cut_done")
    .select("id");

  if (slabErr) redirect(`/carving?toast=${encodeURIComponent(slabErr.message)}`);
  if (!slabRow?.length) redirect(`/carving?toast=Slab+no+longer+available+for+assignment`);

  // Daksh May 2026 — SKIP_SLAB_TRANSFER_STAGE flag: stamp the
  // receipt timestamp at assign time so the slab lands directly in
  // the vendor's Ready to load bucket, skipping the Pending stock
  // (transfer in-progress) tray. Reverting the flag to false
  // restores the regular yard→shade flow.
  const nowIso = new Date().toISOString();
  // Both CNC and Outsource route through the Pending stock tray now — the
  // transfer runner delivers and stamps receipt. (The global skip flag or a
  // per-slab "receive now" still bypasses the tray.)
  const autoReceipt = SKIP_SLAB_TRANSFER_STAGE || receiveNow
    ? {
        received_at_vendor_at: nowIso,
        received_at_vendor_by: profile.id,
      }
    : {};
  const { data: item, error: itemErr } = await admin
    .from("carving_items")
    .insert({
      slab_requirement_id: slabId,
      vendor_id: vendorId,
      vendor_name: (vendor as { name: string }).name,
      vendor_type: vendorType,
      // cnc_machine_id intentionally null — vendor picks at load time
      // (CNC). Stays null forever for Manual vendors.
      cnc_machine_id: null,
      note,
      // Outsource received immediately (skip-flag / receive-now) auto-starts
      // → in_progress + loaded. Otherwise it sits at carving_assigned (In
      // Transit) until the runner delivers it.
      status: isOutsource && Object.keys(autoReceipt).length > 0 ? "carving_in_progress" : assignedStatus,
      ...(isOutsource && Object.keys(autoReceipt).length > 0 ? { loaded_at: nowIso, loaded_by: profile.id } : {}),
      // Mig 094 — snapshot the jobwork rate (Outsource only, if given).
      ...(isOutsource && jobworkRate != null
        ? { jobwork_rate: jobworkRate, jobwork_unit: jobworkUnit }
        : {}),
      urgency,
      estimated_minutes: estimatedMinutes || null,
      carving_sides: carvingSides,
      requires_machine_type: finalRequiresMachineType,
      requires_cnc_axes: finalRequiresCncAxes,
      assigned_by: profile.id,
      ...autoReceipt,
    })
    .select("id")
    .single();

  if (itemErr || !item) {
    // Rollback slab status
    await admin
      .from("slab_requirements")
      .update({ status: "cut_done", updated_by: profile.id, updated_at: new Date().toISOString() })
      .eq("id", slabId);
    redirect(`/carving?toast=${encodeURIComponent(itemErr?.message ?? "Failed to create job")}`);
  }

  const eta = estimatedMinutes ? `${estimatedMinutes}min` : "no eta";
  const urgencyTag = urgency === "urgent" ? " · ⚡ URGENT" : "";
  const typeTag = finalRequiresMachineType === "lathe" ? " · 🌀 lathe" : "";
  const manualTag = vendorType === "Outsource" ? " · 🏭 outsource" : "";
  await recordEvent(
    item.id,
    "assigned",
    profile.id,
    `Queued for ${(vendor as { name: string }).name} · ${eta}${urgencyTag}${typeTag}${manualTag}`,
  );
  await logAudit(profile.id, "carving_assigned", "carving_item", item.id, {
    slab_id: slabId,
    vendor_id: vendorId,
    vendor_type: vendorType,
    urgency,
    estimated_minutes: estimatedMinutes,
    requires_machine_type: finalRequiresMachineType,
  });

  // Pending stock (empty autoReceipt) → ping the transfer runner.
  if (Object.keys(autoReceipt).length === 0) {
    await notifySlabTransferWaiting(admin, slabId, (vendor as { name: string }).name);
  }

  refreshAll();
  // Outsource assigns stay in the Outsource flow. A normal assign lands in
  // the new In Transit tab (waiting for the runner); a received-now bypass
  // lands straight in Active.
  const outsourceLanded = isOutsource && Object.keys(autoReceipt).length === 0 ? "in_transit" : "active";
  redirect(
    isOutsource
      ? `/carving?tab=${outsourceLanded}&mode=outsource&toast=${outsourceLanded === "in_transit" ? "Sent+for+transfer" : "Job+queued"}`
      : "/carving?tab=active&toast=Job+queued",
  );
}

// ── Migration 026: bulk-assign up to 10 slabs in one shot ──────────
//
// The carving head usually assigns slabs in pairs (for 2-head CNCs)
// or small batches (a temple's full panel set, 3-10 slabs going to
// the same vendor at once). The single-slab assign flow makes them
// open the modal N times. Original cap was 4 (Daksh May 2026 round
// 1); bumped to 10 round 2 once it was clear bigger batches were
// common.
//
// This action accepts an array of slab_ids (1-10), one vendor, and a
// single urgency/note/requires_machine_type. It creates N
// carving_items rows that all share a fresh `batch_id` UUID so the
// downstream UI (cockpit + transfer page) can colour-group them
// visually as "these came together — pair them up if you can."
//
// Failure model: best-effort sequential inserts. If a later slab
// fails (e.g. another head grabbed it first), the earlier successes
// are KEPT — the vendor gets a partial batch. Toast surfaces the
// count of successes vs failures so the head can retry the rest.
export async function assignCarvingJobsBatchAction(formData: FormData) {
  // Mig 074/076 — same widening as the single-assign action above.
  const { profile } = await requireAuth();
  if (!canAccessCarvingPage(profile)) {
    redirect("/carving?toast=Not+authorised+to+assign+carving");
  }
  const admin = createAdminSupabaseClient();

  // slab_ids is a JSON-stringified array (form sends "[a,b,c]").
  const slabIdsJson = txt(formData, "slab_ids");
  const vendorId = txt(formData, "vendor_id");
  const note = txt(formData, "note") || null;
  // Per-assignment slab-transfer bypass — see single-assign note above.
  const receiveNow = txt(formData, "receive_now") === "1";
  const urgency = txt(formData, "urgency") === "urgent" ? "urgent" : "normal";
  const estimatedMinutes = Math.max(0, num(formData, "estimated_minutes", 0));
  // Mig 088 — double-side carving; one choice applies to the whole batch.
  const carvingSides = num(formData, "carving_sides", 1) === 2 ? 2 : 1;
  const requiresMachineTypeRaw = txt(formData, "requires_machine_type");
  const requiresMachineType: string | null =
    requiresMachineTypeRaw === "lathe" ||
    requiresMachineTypeRaw === "multi_head_2" ||
    requiresMachineTypeRaw === "single_head"
      ? requiresMachineTypeRaw
      : null;
  // Mig 079 — bulk axis requirement (same shape as single-slab).
  const requiresCncAxesBatchRaw = txt(formData, "requires_cnc_axes");
  const requiresCncAxesBatch: number | null =
    requiresCncAxesBatchRaw === "3"
      ? 3
      : requiresCncAxesBatchRaw === "4"
        ? 4
        : requiresCncAxesBatchRaw === "5"
          ? 5
          : null;
  // Mig 094 — Outsource jobwork rate snapshot for the batch (₹ per
  // cft/sft). Applied only to Outsource vendors below; CNC ignores it.
  const jobworkRateBatchRaw = txt(formData, "jobwork_rate");
  const jobworkRateBatch =
    jobworkRateBatchRaw && Number(jobworkRateBatchRaw) > 0 ? Number(jobworkRateBatchRaw) : null;
  const jobworkUnitBatch = txt(formData, "jobwork_unit") === "sft" ? "sft" : "cft";

  let slabIds: string[] = [];
  try {
    const parsed = JSON.parse(slabIdsJson);
    if (Array.isArray(parsed)) {
      slabIds = parsed.filter((x): x is string => typeof x === "string" && !!x);
    }
  } catch {
    /* fall through — empty list will redirect with error below */
  }

  if (slabIds.length === 0) {
    redirect("/carving?toast=No+slabs+selected");
  }
  // Daksh May 2026 — bumped from 4 → 10 to match dashboard-client's
  // BULK_MAX. Must stay in sync; the server-side cap is the last
  // line of defence if a tampered form somehow gets more slabs in.
  if (slabIds.length > 10) {
    redirect("/carving?toast=Max+10+slabs+per+batch");
  }
  if (!vendorId) {
    redirect("/carving?toast=Pick+a+vendor");
  }

  // Mig 132 — pending-cancel slabs are locked out of new assignments.
  {
    const { data: lockedRows } = await admin
      .from("slab_requirements")
      .select("id")
      .in("id", slabIds)
      .not("cancel_requested_at", "is", null);
    const locked = ((lockedRows ?? []) as Array<{ id: string }>).map((r) => r.id);
    if (locked.length > 0) {
      redirect(`/carving?toast=${encodeURIComponent(`Cancel request pending on ${locked.join(", ")} — locked until the owner decides`)}`);
    }
  }

  const { data: vendor } = await admin
    .from("vendors")
    .select("id, name, vendor_type, is_active")
    .eq("id", vendorId)
    .single();
  if (!vendor) redirect("/carving?toast=Vendor+not+found");
  const vendorType = (vendor as { vendor_type: string }).vendor_type;
  if (vendorType !== "CNC" && vendorType !== "Outsource") {
    redirect("/carving?toast=Only+CNC+or+Outsource+vendors+supported");
  }
  if (!(vendor as { is_active: boolean }).is_active) {
    redirect("/carving?toast=Vendor+is+inactive");
  }
  // Daksh June 2026 — same Outsource backstop as the single-slab assign:
  // a CNC operator (vendor role, e.g. Mohit) may never batch-assign to an
  // Outsource vendor. The toggle hides it; this guards a replayed form.
  if (
    vendorType === "Outsource" &&
    !["developer", "owner", "carving_head", "senior_incharge", "tender_manager"].includes(profile.role)
  ) {
    redirect("/carving?toast=Not+authorised+for+Outsource+carving");
  }
  const finalRequiresMachineType = vendorType === "CNC" ? requiresMachineType : null;
  // Mig 079 — axis requirement applies only to CNC + flat-panel.
  const isCncFlatBatch =
    vendorType === "CNC" &&
    (finalRequiresMachineType === null ||
      finalRequiresMachineType === "multi_head_2" ||
      finalRequiresMachineType === "single_head");
  const finalRequiresCncAxesBatch = isCncFlatBatch ? requiresCncAxesBatch : null;

  // Mig 079 — same vendor-capability gate as the single-slab action.
  // Refuses the whole batch up-front if the vendor doesn't have a
  // matching axis machine; the toast surfaces on /carving where
  // the assigner is looking.
  if (finalRequiresCncAxesBatch != null) {
    const { data: matchingMachines } = await admin
      .from("cnc_machines")
      .select("id")
      .eq("vendor_id", vendorId)
      .eq("is_active", true)
      .eq("cnc_axes", finalRequiresCncAxesBatch)
      .limit(1);
    if (!matchingMachines || matchingMachines.length === 0) {
      const vendorName = (vendor as { name: string }).name;
      const friendly = `${vendorName} has no ${finalRequiresCncAxesBatch}-axis CNC. Pick a different vendor or change the CNC axes requirement to "Any".`;
      redirect(`/carving?toast=${encodeURIComponent(friendly)}`);
    }
  }

  // One batch_id for every slab in this assignment. Downstream UIs
  // group slabs sharing a batch_id with the same colour stripe.
  const batchId = crypto.randomUUID();
  const now = new Date().toISOString();
  // Daksh (Jun 2026) — Outsource routes through the transfer too now, so it
  // no longer auto-receives. Only the skip-flag / receive-now bypass the tray.
  const autoReceiptBatch = SKIP_SLAB_TRANSFER_STAGE || receiveNow
    ? {
        received_at_vendor_at: now,
        received_at_vendor_by: profile.id,
      }
    : {};
  const successes: string[] = [];
  const failures: Array<{ slab: string; reason: string }> = [];

  // Both types wait at carving_assigned (In Transit) until receipt.
  const isOutsourceBatch = vendorType === "Outsource";
  const assignedStatusBatch = "carving_assigned";
  // Daksh June 2026 — keep Outsource batch assigns inside the Outsource
  // view on redirect (mode=outsource), mirroring the single-assign fix.
  const modeQ = isOutsourceBatch ? "mode=outsource&" : "";

  const isPendingStockBatch = Object.keys(autoReceiptBatch).length === 0;
  const pendingStockSlabs: string[] = [];
  for (const slabId of slabIds) {
    // Race-guard the slab transition first.
    const { data: slabRow, error: slabErr } = await admin
      .from("slab_requirements")
      .update({ status: assignedStatusBatch, updated_by: profile.id, updated_at: now })
      .eq("id", slabId)
      .eq("status", "cut_done")
      .select("id");
    if (slabErr) {
      failures.push({ slab: slabId, reason: slabErr.message });
      continue;
    }
    if (!slabRow?.length) {
      failures.push({ slab: slabId, reason: "no longer available" });
      continue;
    }

    const { data: item, error: itemErr } = await admin
      .from("carving_items")
      .insert({
        slab_requirement_id: slabId,
        vendor_id: vendorId,
        vendor_name: (vendor as { name: string }).name,
        vendor_type: vendorType,
        cnc_machine_id: null,
        note,
        // Outsource received-now auto-starts; otherwise In Transit until the
        // runner delivers it.
        status: isOutsourceBatch && !isPendingStockBatch ? "carving_in_progress" : assignedStatusBatch,
        ...(isOutsourceBatch && !isPendingStockBatch ? { loaded_at: now, loaded_by: profile.id } : {}),
        ...(isOutsourceBatch && jobworkRateBatch != null
          ? { jobwork_rate: jobworkRateBatch, jobwork_unit: jobworkUnitBatch }
          : {}),
        urgency,
        estimated_minutes: estimatedMinutes || null,
        carving_sides: carvingSides,
        requires_machine_type: finalRequiresMachineType,
        requires_cnc_axes: finalRequiresCncAxesBatch,
        batch_id: batchId,
        assigned_by: profile.id,
        ...autoReceiptBatch,
      })
      .select("id")
      .single();
    if (itemErr || !item) {
      // Roll back the slab status flip for this one.
      await admin
        .from("slab_requirements")
        .update({ status: "cut_done", updated_by: profile.id, updated_at: now })
        .eq("id", slabId);
      failures.push({ slab: slabId, reason: itemErr?.message ?? "insert failed" });
      continue;
    }

    const eta = estimatedMinutes ? `${estimatedMinutes}min` : "no eta";
    const urgencyTag = urgency === "urgent" ? " · ⚡ URGENT" : "";
    const typeTag = finalRequiresMachineType === "lathe" ? " · 🌀 lathe" : "";
    const batchTag = slabIds.length > 1 ? ` · 📦 batch of ${slabIds.length}` : "";
    await recordEvent(
      item.id,
      "assigned",
      profile.id,
      `Queued for ${(vendor as { name: string }).name} · ${eta}${urgencyTag}${typeTag}${batchTag}`,
    );
    successes.push(item.id);
    if (isPendingStockBatch) pendingStockSlabs.push(slabId);
  }

  // Pending stock → ping the transfer runner for each waiting slab.
  if (pendingStockSlabs.length > 0) {
    await Promise.all(
      pendingStockSlabs.map((sid) =>
        notifySlabTransferWaiting(admin, sid, (vendor as { name: string }).name),
      ),
    );
  }

  await logAudit(profile.id, "carving_batch_assigned", "carving_item", batchId, {
    batch_id: batchId,
    vendor_id: vendorId,
    vendor_type: vendorType,
    urgency,
    estimated_minutes: estimatedMinutes,
    requires_machine_type: finalRequiresMachineType,
    slab_count_requested: slabIds.length,
    slab_count_succeeded: successes.length,
    failures,
  });

  refreshAll();
  // Outsource batches that went to the transfer tray land in In Transit.
  const landTab = isOutsourceBatch && isPendingStockBatch ? "in_transit" : "active";
  if (successes.length === 0) {
    redirect(
      `/carving?${modeQ}toast=${encodeURIComponent(
        `Batch failed — no slabs could be assigned. ${failures[0]?.reason ?? ""}`,
      )}`,
    );
  }
  if (failures.length > 0) {
    redirect(
      `/carving?tab=${landTab}&${modeQ}toast=${encodeURIComponent(
        `Assigned ${successes.length} of ${slabIds.length} · ${failures.length} failed (${failures[0]?.reason ?? "see log"})`,
      )}`,
    );
  }
  redirect(
    `/carving?tab=${landTab}&${modeQ}toast=${encodeURIComponent(
      `📦 Batch of ${successes.length} ${landTab === "in_transit" ? "sent for transfer" : "queued"}`,
    )}`,
  );
}

// ── CNC ops: load slab on a specific machine ────────────────────────
//
// Vendor (CNC supervisor) picks a slab from their queue and loads it
// onto a free CNC. Atomic side-effects:
//   1. carving_items: status → carving_in_progress, cnc_machine_id,
//      loaded_at, loaded_by, vendor_estimated_minutes (vendor's tighter
//      estimate; defaults to the carving head's estimated_minutes)
//   2. cnc_machines: status → 'carving', current_carving_item_id
//   3. cnc_machine_events: event 'loaded'
//   4. slab_requirements: status → carving_in_progress
//
// Race guards: machine must currently be 'idle', carving item must
// currently be 'carving_assigned' with no cnc_machine_id.
export async function loadSlabOnMachineAction(formData: FormData) {
  const { profile } = await requireAuth(["developer", "owner", "carving_head", "vendor"]);
  const admin = createAdminSupabaseClient();

  const carvingItemId = txt(formData, "carving_item_id");
  const machineId = txt(formData, "cnc_machine_id");
  const vendorEstMinutes = Math.max(0, num(formData, "vendor_estimated_minutes", 0));

  if (!carvingItemId || !machineId) {
    redirect("/vendor?toast=Missing+slab+or+machine");
  }

  // Load both rows so we can sanity-check vendor ownership (machine
  // must belong to the same vendor as the carving item) AND validate
  // the machine type + dimensions against the job's requirements
  // (migration 024).
  const [{ data: ci }, { data: mc }] = await Promise.all([
    admin
      .from("carving_items")
      .select(
        "id, vendor_id, status, cnc_machine_id, slab_requirement_id, estimated_minutes, requires_machine_type, requires_cnc_axes, received_at_vendor_at",
      )
      .eq("id", carvingItemId)
      .maybeSingle(),
    admin
      .from("cnc_machines")
      .select(
        "id, vendor_id, status, is_active, machine_type, cnc_axes, machine_code, max_length_in, max_width_in, max_thickness_in",
      )
      .eq("id", machineId)
      .maybeSingle(),
  ]);

  if (!ci) redirect("/vendor?toast=Carving+job+not+found");
  if (!mc) redirect("/vendor?toast=Machine+not+found");
  const item = ci as {
    id: string;
    vendor_id: string;
    status: string;
    cnc_machine_id: string | null;
    slab_requirement_id: string;
    estimated_minutes: number | null;
    requires_machine_type: string | null;
    requires_cnc_axes: number | null;
    received_at_vendor_at: string | null;
  };
  const machine = mc as {
    id: string;
    vendor_id: string;
    status: string;
    is_active: boolean;
    machine_type: string | null;
    cnc_axes: number | null;
    machine_code: string | null;
    max_length_in: number | string | null;
    max_width_in: number | string | null;
    max_thickness_in: number | string | null;
  };
  if (item.vendor_id !== machine.vendor_id) {
    redirect("/vendor?toast=Machine+belongs+to+a+different+vendor");
  }
  if (!machine.is_active) redirect("/vendor?toast=Machine+is+inactive");
  if (machine.status !== "idle") redirect("/vendor?toast=Machine+is+not+idle");
  if (item.status !== "carving_assigned" || item.cnc_machine_id) {
    redirect("/vendor?toast=Job+is+not+in+queue");
  }

  // ── Machine type check (migration 024) ──────────────────────────
  // Derive the job's required machine type. NULL on the job means
  // "flat-panel default" which always maps to multi_head_2 (the only
  // non-lathe type in the fleet). Daksh May 2026 — the prior derivation
  // had a bug where if the machine itself was a lathe, requiredType
  // would collapse to NULL and the check would pass, letting flat
  // slabs land on a lathe. Fixed: flat-panel always demands
  // multi_head_2 regardless of which machine is being loaded.
  const requiredType = item.requires_machine_type ?? "multi_head_2";
  if (machine.machine_type !== requiredType) {
    const friendly =
      requiredType === "lathe"
        ? "This is a lathe (cylindrical) slab — pick a lathe machine, not a flat-panel CNC."
        : machine.machine_type === "lathe"
          ? "This is a flat-panel slab — it cannot be loaded onto a lathe machine."
          : `This job is tagged for ${requiredType}. Pick a ${requiredType} machine.`;
    redirect(`/vendor?toast=${encodeURIComponent(friendly)}`);
  }

  // ── Mig 079 / 093 — Strict CNC axis match (shared helper) ───────
  // Skipped on Lathe assignments (the machine_type guard above
  // already rules them out). NULL = "Any CNC"; 3/4/5 = exact match.
  const axisErr = checkAxisMatch(item.requires_cnc_axes, machine);
  if (axisErr) redirect(`/vendor?toast=${encodeURIComponent(axisErr)}`);

  // ── Dimension check (migration 024) ─────────────────────────────
  // Orientation-agnostic on L/W: a slab whose longest face fits the
  // machine's longest bed dim AND whose shorter face fits the
  // shorter bed dim is loadable. NULL caps = no limit.
  const { data: slabDimRow } = await admin
    .from("slab_requirements")
    .select("length_ft, width_ft, thickness_ft")
    .eq("id", item.slab_requirement_id)
    .maybeSingle();
  const dimError = checkSlabFits(slabDimRow, machine);
  if (dimError) redirect(`/vendor?toast=${encodeURIComponent(dimError)}`);

  const now = new Date().toISOString();
  const finalVendorEst = vendorEstMinutes || item.estimated_minutes || null;
  // Auto-receipt: if the vendor never explicitly clicked Mark
  // received, stamp it now so the assign → load gap has at least an
  // approximate timestamp (we attribute to the loader, not a
  // separate receiver).
  const autoReceiptAt = item.received_at_vendor_at ? null : now;

  // Flip carving_items first. Race-guard: only update if status is
  // still carving_assigned (avoids the rare two-phones-at-once case).
  const { data: updatedCi } = await admin
    .from("carving_items")
    .update({
      status: "carving_in_progress",
      cnc_machine_id: machineId,
      loaded_at: now,
      loaded_by: profile.id,
      vendor_estimated_minutes: finalVendorEst,
      ...(autoReceiptAt
        ? { received_at_vendor_at: autoReceiptAt, received_at_vendor_by: profile.id }
        : {}),
    })
    .eq("id", carvingItemId)
    .eq("status", "carving_assigned")
    .is("cnc_machine_id", null)
    .select("id");

  if (!updatedCi?.length) {
    redirect("/vendor?toast=Slab+already+loaded+or+state+changed");
  }

  // Flip the machine.
  await admin
    .from("cnc_machines")
    .update({
      status: "carving",
      current_carving_item_id: carvingItemId,
    })
    .eq("id", machineId)
    .eq("status", "idle");

  // Slab table mirrors the carving_items state.
  await admin
    .from("slab_requirements")
    .update({ status: "carving_in_progress", updated_by: profile.id, updated_at: now })
    .eq("id", item.slab_requirement_id);

  // Audit trails — both per-item (carving_job_events) + per-machine
  // (cnc_machine_events).
  await recordEvent(carvingItemId, "loaded", profile.id, `Loaded on machine · ETA ${finalVendorEst ?? "?"}min`);
  await admin.from("cnc_machine_events").insert({
    cnc_machine_id: machineId,
    event_type: "loaded",
    carving_item_id: carvingItemId,
    user_id: profile.id,
    message: `ETA ${finalVendorEst ?? "?"}min`,
  });
  await logAudit(profile.id, "carving_loaded", "carving_item", carvingItemId, {
    machine_id: machineId,
    vendor_estimated_minutes: finalVendorEst,
  });

  refreshAll();
  redirect("/vendor?toast=Slab+loaded");
}

// ── 2-head CNC: load TWO identical slabs simultaneously ───────────
//
// On a multi_head_2 machine both heads carve the same shape on
// IDENTICAL slabs in lockstep — same temple, same label, same
// L/W/T. The vendor picks two queued items, this action validates
// the match and atomically loads BOTH onto the machine.
//
// Subsequent unload finishes both at once (see completeAndUnload
// below — when the machine is multi_head_2 it pairs and unloads
// every active item on it).
export async function loadTwoSlabsOnMultiHeadAction(formData: FormData) {
  const { profile } = await requireAuth(["developer", "owner", "carving_head", "vendor"]);
  const admin = createAdminSupabaseClient();

  const carvingItemAId = txt(formData, "carving_item_a_id");
  const carvingItemBId = txt(formData, "carving_item_b_id");
  const machineId = txt(formData, "cnc_machine_id");
  const vendorEstMinutes = Math.max(0, num(formData, "vendor_estimated_minutes", 0));

  if (!carvingItemAId || !carvingItemBId || !machineId) {
    redirect("/vendor?toast=Pick+two+slabs+and+a+machine");
  }
  if (carvingItemAId === carvingItemBId) {
    redirect("/vendor?toast=Pick+TWO+different+slabs");
  }

  const [{ data: itemA }, { data: itemB }, { data: mc }] = await Promise.all([
    admin
      .from("carving_items")
      .select(
        "id, vendor_id, status, cnc_machine_id, slab_requirement_id, estimated_minutes, requires_machine_type, requires_cnc_axes, received_at_vendor_at",
      )
      .eq("id", carvingItemAId)
      .maybeSingle(),
    admin
      .from("carving_items")
      .select(
        "id, vendor_id, status, cnc_machine_id, slab_requirement_id, estimated_minutes, requires_machine_type, requires_cnc_axes, received_at_vendor_at",
      )
      .eq("id", carvingItemBId)
      .maybeSingle(),
    admin
      .from("cnc_machines")
      .select(
        "id, vendor_id, status, is_active, machine_type, cnc_axes, machine_code, max_length_in, max_width_in, max_thickness_in",
      )
      .eq("id", machineId)
      .maybeSingle(),
  ]);

  if (!itemA || !itemB) redirect("/vendor?toast=One+of+the+jobs+was+not+found");
  if (!mc) redirect("/vendor?toast=Machine+not+found");
  const a = itemA as {
    id: string;
    vendor_id: string;
    status: string;
    cnc_machine_id: string | null;
    slab_requirement_id: string;
    estimated_minutes: number | null;
    requires_machine_type: string | null;
    requires_cnc_axes: number | null;
    received_at_vendor_at: string | null;
  };
  const b = itemB as {
    id: string;
    vendor_id: string;
    status: string;
    cnc_machine_id: string | null;
    slab_requirement_id: string;
    estimated_minutes: number | null;
    requires_machine_type: string | null;
    requires_cnc_axes: number | null;
    received_at_vendor_at: string | null;
  };
  const m = mc as {
    id: string;
    vendor_id: string;
    status: string;
    is_active: boolean;
    machine_type: string | null;
    cnc_axes: number | null;
    machine_code: string | null;
    max_length_in: number | string | null;
    max_width_in: number | string | null;
    max_thickness_in: number | string | null;
  };

  if (m.machine_type !== "multi_head_2") {
    redirect("/vendor?toast=This+action+is+only+for+2-head+machines");
  }
  if (!m.is_active) redirect("/vendor?toast=Machine+is+inactive");
  if (m.status !== "idle") redirect("/vendor?toast=Machine+is+not+idle");
  if (a.vendor_id !== m.vendor_id || b.vendor_id !== m.vendor_id) {
    redirect("/vendor?toast=One+of+the+jobs+belongs+to+a+different+vendor");
  }
  if (a.status !== "carving_assigned" || a.cnc_machine_id || b.status !== "carving_assigned" || b.cnc_machine_id) {
    redirect("/vendor?toast=One+of+the+jobs+is+not+in+queue");
  }

  // Migration 024: neither slab may be tagged for a non-multi-head
  // type (e.g. a lathe-tagged job mistakenly paired up here).
  for (const j of [a, b]) {
    if (j.requires_machine_type && j.requires_machine_type !== "multi_head_2") {
      redirect(
        `/vendor?toast=${encodeURIComponent(
          `One of the jobs is tagged for ${j.requires_machine_type}. Pick a ${j.requires_machine_type} machine instead.`,
        )}`,
      );
    }
  }

  // Mig 079 / 093 — strict CNC axis match for BOTH slabs (this is the
  // path that was silently skipping the axis guard — a 2-head load
  // could land a 4/5-axis slab on any machine). Each slab independently
  // must fit the machine's axis count.
  for (const j of [a, b]) {
    const axisErr = checkAxisMatch(j.requires_cnc_axes, m);
    if (axisErr) redirect(`/vendor?toast=${encodeURIComponent(axisErr)}`);
  }

  // Mig 081 follow-on (Daksh) — opt-in "force mismatched" flag for
  // the rare case where the vendor needs to load two DIFFERENT
  // slabs on one 2-head CNC. Default behaviour (no flag) keeps the
  // identical-pair guard exactly as before. With the flag set, the
  // L×W×T + temple + label match is skipped, but EVERY other guard
  // (status, machine type, lathe filter, machine bed dims for each
  // slab independently) still runs.
  const forceMismatched = txt(formData, "force_mismatched") === "true";

  // Load both slabs' geometry — needed both for the identity check
  // (when not forcing) AND for the per-slab bed-fit check (always).
  const { data: slabRows } = await admin
    .from("slab_requirements")
    .select("id, label, temple, length_ft, width_ft, thickness_ft")
    .in("id", [a.slab_requirement_id, b.slab_requirement_id]);
  if (!slabRows || slabRows.length !== 2) {
    redirect("/vendor?toast=Could+not+load+slab+geometry+for+matching");
  }
  const slabA = (slabRows as Array<{
    id: string; label: string | null; temple: string;
    length_ft: number | string; width_ft: number | string; thickness_ft: number | string;
  }>).find((s) => s.id === a.slab_requirement_id)!;
  const slabB = (slabRows as Array<{
    id: string; label: string | null; temple: string;
    length_ft: number | string; width_ft: number | string; thickness_ft: number | string;
  }>).find((s) => s.id === b.slab_requirement_id)!;

  if (!forceMismatched) {
    // Default path — strict identity check.
    const dimsMatch =
      Number(slabA.length_ft) === Number(slabB.length_ft) &&
      Number(slabA.width_ft) === Number(slabB.width_ft) &&
      Number(slabA.thickness_ft) === Number(slabB.thickness_ft);
    const labelMatch = (slabA.label ?? "") === (slabB.label ?? "");
    const templeMatch = (slabA.temple ?? "") === (slabB.temple ?? "");
    if (!dimsMatch || !labelMatch || !templeMatch) {
      redirect(
        `/vendor?toast=${encodeURIComponent(
          "2-head load needs IDENTICAL slabs (same L×W×T + temple + label). Pick a matching pair from the queue.",
        )}`,
      );
    }
  }

  // Mig 024 — machine bed-envelope check. Always runs; with
  // forceMismatched the slabs differ so we check EACH one against
  // the machine bed, not just one. Either failing kills the load.
  const dimErrA = checkSlabFits(slabA, m);
  if (dimErrA) {
    redirect(`/vendor?toast=${encodeURIComponent(`Slab A: ${dimErrA}`)}`);
  }
  if (forceMismatched) {
    const dimErrB = checkSlabFits(slabB, m);
    if (dimErrB) {
      redirect(`/vendor?toast=${encodeURIComponent(`Slab B: ${dimErrB}`)}`);
    }
  }

  const now = new Date().toISOString();
  const finalEst = vendorEstMinutes || a.estimated_minutes || b.estimated_minutes || null;
  // Auto-receipt for both items if they were never explicitly
  // acknowledged. We attribute to the loader.
  const autoReceiptA = a.received_at_vendor_at ? null : now;
  const autoReceiptB = b.received_at_vendor_at ? null : now;

  // Flip both items + machine atomically. Race-guard on each item.
  const updateOne = async (id: string, autoReceiptAt: string | null) =>
    admin
      .from("carving_items")
      .update({
        status: "carving_in_progress",
        cnc_machine_id: machineId,
        loaded_at: now,
        loaded_by: profile.id,
        vendor_estimated_minutes: finalEst,
        ...(autoReceiptAt
          ? { received_at_vendor_at: autoReceiptAt, received_at_vendor_by: profile.id }
          : {}),
      })
      .eq("id", id)
      .eq("status", "carving_assigned")
      .is("cnc_machine_id", null)
      .select("id");

  const [{ data: updA }, { data: updB }] = await Promise.all([
    updateOne(a.id, autoReceiptA),
    updateOne(b.id, autoReceiptB),
  ]);
  if (!updA?.length || !updB?.length) {
    // Roll back the one that succeeded if the other didn't.
    if (updA?.length) {
      await admin
        .from("carving_items")
        .update({
          status: "carving_assigned",
          cnc_machine_id: null,
          loaded_at: null,
          loaded_by: null,
          vendor_estimated_minutes: null,
        })
        .eq("id", a.id);
    }
    if (updB?.length) {
      await admin
        .from("carving_items")
        .update({
          status: "carving_assigned",
          cnc_machine_id: null,
          loaded_at: null,
          loaded_by: null,
          vendor_estimated_minutes: null,
        })
        .eq("id", b.id);
    }
    redirect("/vendor?toast=Could+not+claim+both+slabs+(state+changed).+Refresh+and+retry.");
  }

  // Machine + slab status flips. Machine.current_carving_item_id
  // points at the first head's item; the second is implicit
  // (we'll fetch all carving_items where cnc_machine_id=m.id when
  // we need both).
  await admin
    .from("cnc_machines")
    .update({ status: "carving", current_carving_item_id: a.id })
    .eq("id", machineId)
    .eq("status", "idle");

  await admin
    .from("slab_requirements")
    .update({ status: "carving_in_progress", updated_by: profile.id, updated_at: now })
    .in("id", [a.slab_requirement_id, b.slab_requirement_id]);

  // Audit on both items + the machine. Mig 081 follow-on — when the
  // load was mismatched (vendor used the "load any 2 slabs" mode)
  // we tag every event with [MISMATCHED] so anyone reading the
  // timeline + audit later can tell it apart from a normal pair.
  const mismatchTag = forceMismatched ? " · [MISMATCHED PAIR]" : "";
  await Promise.all([
    recordEvent(a.id, "loaded", profile.id, `2-head load (paired with ${b.id}) · ETA ${finalEst ?? "?"}min${mismatchTag}`),
    recordEvent(b.id, "loaded", profile.id, `2-head load (paired with ${a.id}) · ETA ${finalEst ?? "?"}min${mismatchTag}`),
  ]);
  await admin.from("cnc_machine_events").insert({
    cnc_machine_id: machineId,
    event_type: "loaded",
    carving_item_id: a.id,
    user_id: profile.id,
    message: `2-head load · pair ${a.id} + ${b.id} · ETA ${finalEst ?? "?"}min${mismatchTag}`,
  });
  await logAudit(profile.id, "carving_loaded_pair", "carving_item", a.id, {
    machine_id: machineId,
    paired_with: b.id,
    vendor_estimated_minutes: finalEst,
    // Mig 081 follow-on — explicit so analytics queries can filter
    // by mismatched vs identical loads later.
    mismatched: forceMismatched,
  });

  refreshAll();
  redirect("/vendor?toast=Both+slabs+loaded");
}

// ── Unload-with-problem — bail out mid-carving ─────────────────────
//
// Real-world need: during carving, something breaks. The vendor
// hits a hardware fault, the slab cracks, the design is wrong, or
// they realise they can't finish it. They need to take this slab
// OFF the machine without marking it complete + tell the team why.
// On a 2-head pair load, this unloads JUST one slab — the partner
// keeps running on the other head.
//
// Reasons (form field `reason`):
//   broken_slab    — slab cracked / chipped, can't continue
//   carving_problem — tool wear, run-out, mis-cut
//   design_problem  — file is wrong, wrong toolpath
//   needs_transfer  — vendor can't handle, route to another vendor
//   other          — free-form (notes required)
//
// Outcomes:
//   - carving_item.cnc_machine_id → null, loaded_at → null
//   - status → 'carving_assigned' (back in vendor's stock)
//     OR 'rejected' if broken_slab (lets team triage)
//   - cnc_machine: if no other items still in_progress → 'idle' +
//     current_carving_item_id null; if partner still running →
//     keep 'carving' but reset current_carving_item_id to survivor.
//   - cnc_machine_events row: 'unloaded_with_problem'
//   - carving_job_events row: 'unload_problem' with reason+notes
//   - If needs_transfer: also flip vendor_id to new_vendor_id
//     (same plumbing as transferCarvingJobAction).
export async function unloadWithProblemAction(formData: FormData) {
  const { profile } = await requireAuth([
    "developer",
    "owner",
    "carving_head",
    "vendor",
  ]);
  const admin = createAdminSupabaseClient();

  const carvingItemId = txt(formData, "carving_item_id");
  const reason = txt(formData, "reason");
  const notes = txt(formData, "notes") || null;
  const newVendorId = txt(formData, "new_vendor_id") || null;
  const redirectTo = txt(formData, "redirect_to") || "/vendor";

  const validReasons = ["broken_slab", "carving_problem", "design_problem", "needs_transfer", "other"];
  if (!carvingItemId) redirect(`${redirectTo}?toast=Missing+job+id`);
  if (!validReasons.includes(reason)) {
    redirect(`${redirectTo}?toast=Pick+a+reason`);
  }
  if (reason === "other" && (!notes || notes.length < 3)) {
    redirect(`${redirectTo}?toast=Notes+required+for+'other'`);
  }
  if (reason === "needs_transfer" && !newVendorId) {
    redirect(`${redirectTo}?toast=Pick+a+vendor+to+transfer+to`);
  }

  // Load the row + its machine.
  const { data: ci } = await admin
    .from("carving_items")
    .select(
      "id, vendor_id, vendor_name, vendor_type, status, cnc_machine_id, slab_requirement_id",
    )
    .eq("id", carvingItemId)
    .maybeSingle();
  if (!ci) redirect(`${redirectTo}?toast=Job+not+found`);
  const item = ci as {
    id: string;
    vendor_id: string;
    vendor_name: string;
    vendor_type: string;
    status: string;
    cnc_machine_id: string | null;
    slab_requirement_id: string;
  };

  // Vendor ownership check.
  if (profile.role === "vendor") {
    // Mig 077 — a vendor user's profile.managed_vendor_ids array
    // extends ownership to those vendor ids. Used so Mohit can act
    // on Alkesh's cockpit while Alkesh is unavailable.
    const managedVendorIds = profile.managed_vendor_ids ?? [];
    const ownsOrManages =
      !!profile.vendor_id &&
      (profile.vendor_id === item.vendor_id ||
        managedVendorIds.includes(item.vendor_id));
    if (!ownsOrManages) {
      redirect(`${redirectTo}?toast=Not+your+slab`);
    }
  }
  if (item.status !== "carving_in_progress") {
    redirect(`${redirectTo}?toast=Slab+is+not+currently+on+a+machine`);
  }
  if (!item.cnc_machine_id) {
    redirect(`${redirectTo}?toast=Slab+has+no+machine`);
  }

  const machineId = item.cnc_machine_id;
  const now = new Date().toISOString();

  // If transferring, validate the destination vendor first so we
  // don't half-execute on a bad input.
  let newVendor: { id: string; name: string; vendor_type: string } | null = null;
  if (reason === "needs_transfer" && newVendorId) {
    const { data: v } = await admin
      .from("vendors")
      .select("id, name, vendor_type, is_active")
      .eq("id", newVendorId)
      .maybeSingle();
    if (!v) redirect(`${redirectTo}?toast=Destination+vendor+not+found`);
    const vendor = v as { id: string; name: string; vendor_type: string; is_active: boolean };
    if (!vendor.is_active) redirect(`${redirectTo}?toast=Destination+vendor+is+inactive`);
    if (vendor.vendor_type !== "CNC" && vendor.vendor_type !== "Outsource") {
      redirect(`${redirectTo}?toast=Destination+must+be+CNC+or+Outsource`);
    }
    // A CNC vendor's slab cannot be handed off to an Outsource vendor.
    if (item.vendor_type === "CNC" && vendor.vendor_type === "Outsource") {
      redirect(`${redirectTo}?toast=${encodeURIComponent("A CNC vendor cannot transfer to an outsource vendor.")}`);
    }
    if (vendor.id === item.vendor_id) {
      redirect(`${redirectTo}?toast=Already+with+that+vendor`);
    }
    newVendor = vendor;
  }

  // ── Flip the carving_item ────────────────────────────────────
  // broken_slab → status='rejected' so the team triages it. The
  // other reasons → back to 'carving_assigned' for the vendor (or
  // new vendor on transfer) to retry/handle.
  const targetStatus = reason === "broken_slab" ? "rejected" : "carving_assigned";
  const updatePayload: Record<string, unknown> = {
    status: targetStatus,
    cnc_machine_id: null,
    loaded_at: null,
    loaded_by: null,
    vendor_estimated_minutes: null,
  };
  if (newVendor) {
    updatePayload.vendor_id = newVendor.id;
    updatePayload.vendor_name = newVendor.name;
    updatePayload.vendor_type = newVendor.vendor_type;
    // Slab needs to physically travel to new vendor → reset receipt.
    updatePayload.received_at_vendor_at = null;
    updatePayload.received_at_vendor_by = null;
    // Mig 070 — stamp the source vendor so the receiving cockpit
    // can render the "Transferred from X" badge + the Accept / Flag
    // buttons in Pending stock. Snapshot the name so the badge
    // keeps reading even if the source vendor row is later
    // archived. transferred_by is the operator who fired the
    // transfer (usually the source vendor themselves).
    updatePayload.transferred_from_vendor_id = item.vendor_id;
    updatePayload.transferred_from_vendor_name = item.vendor_name;
    updatePayload.transferred_at = now;
    updatePayload.transferred_by = profile.id;
  }
  await admin.from("carving_items").update(updatePayload).eq("id", carvingItemId);

  // Mirror to slab_requirements so the slab pool view is consistent.
  await admin
    .from("slab_requirements")
    .update({
      status: reason === "broken_slab" ? "rejected" : "carving_assigned",
      updated_by: profile.id,
      updated_at: now,
    })
    .eq("id", item.slab_requirement_id);

  // ── Machine state ────────────────────────────────────────────
  // For 2-head pair loads, the partner may still be running. Check
  // if any other carving_items are still in_progress on this
  // machine — if yes, keep machine 'carving' and point
  // current_carving_item_id at the survivor; if no, machine 'idle'.
  const { data: partners } = await admin
    .from("carving_items")
    .select("id")
    .eq("cnc_machine_id", machineId)
    .eq("status", "carving_in_progress")
    .neq("id", carvingItemId);
  const survivors = (partners ?? []) as Array<{ id: string }>;
  if (survivors.length > 0) {
    // Keep machine carving; if the unloaded item was the one
    // referenced by current_carving_item_id, swap to a survivor.
    const { data: mach } = await admin
      .from("cnc_machines")
      .select("current_carving_item_id")
      .eq("id", machineId)
      .maybeSingle();
    if ((mach as { current_carving_item_id?: string | null } | null)?.current_carving_item_id === carvingItemId) {
      await admin
        .from("cnc_machines")
        .update({ current_carving_item_id: survivors[0].id })
        .eq("id", machineId);
    }
  } else {
    // Last item leaving the machine — flip idle.
    await admin
      .from("cnc_machines")
      .update({ status: "idle", current_carving_item_id: null })
      .eq("id", machineId);
  }

  // ── Event log on both surfaces ───────────────────────────────
  const reasonLabel: Record<string, string> = {
    broken_slab: "🪨 Broken slab",
    carving_problem: "🛠 Carving problem",
    design_problem: "📐 Design problem",
    needs_transfer: `↔ Transfer to ${newVendor?.name ?? "vendor"}`,
    other: "⚠ Other",
  };
  const eventMsg = `${reasonLabel[reason]}${notes ? ` · ${notes}` : ""}`;
  await admin.from("cnc_machine_events").insert({
    cnc_machine_id: machineId,
    event_type: "unloaded_with_problem",
    carving_item_id: carvingItemId,
    user_id: profile.id,
    message: eventMsg,
  });
  await recordEvent(carvingItemId, "unload_problem", profile.id, eventMsg);
  await logAudit(profile.id, "carving_unloaded_with_problem", "carving_item", carvingItemId, {
    reason,
    notes,
    new_vendor_id: newVendor?.id ?? null,
  });

  refreshAll();
  const toastMsg =
    reason === "needs_transfer" && newVendor
      ? `Transferred to ${newVendor.name}`
      : reason === "broken_slab"
        ? "Flagged as broken — team will triage"
        : "Unloaded with problem note";
  redirect(`${redirectTo}?toast=${encodeURIComponent(toastMsg)}`);
}

// ── Inter-vendor transfer Accept / Flag (mig 070) ───────────────
//
// The regular yard→shade receipt flow is driven by the
// slab_transfer role (acknowledgeReceiptAction in this file). For
// vendor→vendor transfers we don't necessarily involve the runner
// — the source and target vendor are often a few metres apart and
// just walk the slab over. So the receiving vendor needs to be able
// to self-receive AND to refuse if the transfer was a mistake.
//
// Both actions are gated to the RECEIVING vendor (i.e. the current
// vendor_id on the row) + carving_head + dev/owner. And both refuse
// if the row isn't an in-transit transfer (transferred_from_vendor_id
// NULL, or already received).

/** Daksh May 2026 — Mig 070 follow-on. Transfer a READY-TO-LOAD slab
 *  (status='carving_assigned', not yet on a machine) from one vendor
 *  to another, without going through the Problem/Unload flow. Same
 *  attribution pattern as unloadWithProblemAction(reason='needs_transfer')
 *  but it skips the machine-state plumbing entirely (slab was never
 *  on a machine).
 *
 *  Use case: vendor sees a slab in their Ready-to-load list, realises
 *  they shouldn't carve it (overbooked, wrong machine type available,
 *  etc.), and shoots it to another vendor without putting it on a
 *  CNC first. Receiver gets the standard Accept / Flag pair from
 *  mig 070 on their Pending Stock list.
 */
export async function transferReadySlabAction(formData: FormData) {
  const { profile } = await requireAuth([
    "developer",
    "owner",
    "carving_head",
    "vendor",
  ]);
  const admin = createAdminSupabaseClient();

  const carvingItemId = txt(formData, "carving_item_id");
  const newVendorId = txt(formData, "new_vendor_id");
  const notes = txt(formData, "notes") || null;
  const redirectTo = txt(formData, "redirect_to") || "/vendor";

  if (!carvingItemId) redirect(`${redirectTo}?toast=Missing+job+id`);
  if (!newVendorId) redirect(`${redirectTo}?toast=Pick+a+vendor+to+transfer+to`);

  const { data: ci } = await admin
    .from("carving_items")
    .select(
      "id, vendor_id, vendor_name, vendor_type, status, cnc_machine_id, slab_requirement_id, requires_machine_type",
    )
    .eq("id", carvingItemId)
    .maybeSingle();
  if (!ci) redirect(`${redirectTo}?toast=Job+not+found`);
  const item = ci as {
    id: string;
    vendor_id: string;
    vendor_name: string;
    vendor_type: string;
    status: string;
    cnc_machine_id: string | null;
    slab_requirement_id: string;
    requires_machine_type: string | null;
  };

  // Vendor ownership.
  if (profile.role === "vendor") {
    // Mig 077 — a vendor user's profile.managed_vendor_ids array
    // extends ownership to those vendor ids. Used so Mohit can act
    // on Alkesh's cockpit while Alkesh is unavailable.
    const managedVendorIds = profile.managed_vendor_ids ?? [];
    const ownsOrManages =
      !!profile.vendor_id &&
      (profile.vendor_id === item.vendor_id ||
        managedVendorIds.includes(item.vendor_id));
    if (!ownsOrManages) {
      redirect(`${redirectTo}?toast=Not+your+slab`);
    }
  }

  // Status gate — must be Ready-to-load shaped (assigned, not on a
  // machine). Held / in-progress / completed cases go through their
  // own dedicated paths.
  if (item.status !== "carving_assigned") {
    redirect(
      `${redirectTo}?toast=${encodeURIComponent(`Slab is in ${item.status} state — use the matching flow (hold / problem / etc.).`)}`,
    );
  }
  if (item.cnc_machine_id) {
    redirect(`${redirectTo}?toast=Slab+is+loaded+%E2%80%94+use+Problem%2FTransfer+from+the+machine+card+instead`);
  }

  // Destination vendor validation.
  const { data: v } = await admin
    .from("vendors")
    .select("id, name, vendor_type, is_active")
    .eq("id", newVendorId)
    .maybeSingle();
  if (!v) redirect(`${redirectTo}?toast=Destination+vendor+not+found`);
  const vendor = v as {
    id: string;
    name: string;
    vendor_type: string;
    is_active: boolean;
  };
  if (!vendor.is_active) redirect(`${redirectTo}?toast=Destination+vendor+is+inactive`);
  if (vendor.vendor_type !== "CNC" && vendor.vendor_type !== "Outsource") {
    redirect(`${redirectTo}?toast=Destination+must+be+CNC+or+Outsource`);
  }
  if (vendor.id === item.vendor_id) {
    redirect(`${redirectTo}?toast=Already+with+that+vendor`);
  }
  // A CNC vendor's slab cannot be handed off to an Outsource vendor.
  if (item.vendor_type === "CNC" && vendor.vendor_type === "Outsource") {
    redirect(`${redirectTo}?toast=${encodeURIComponent("A CNC vendor cannot transfer to an outsource vendor.")}`);
  }

  const now = new Date().toISOString();

  // Flip the carving_item: new vendor, reset receipt, stamp the
  // transfer-from attribution (same shape as unloadWithProblemAction's
  // needs_transfer branch). Keep status='carving_assigned' so the
  // receiving cockpit shows it in Pending Stock with Accept / Flag.
  await admin
    .from("carving_items")
    .update({
      vendor_id: vendor.id,
      vendor_name: vendor.name,
      vendor_type: vendor.vendor_type,
      received_at_vendor_at: null,
      received_at_vendor_by: null,
      transferred_from_vendor_id: item.vendor_id,
      transferred_from_vendor_name: item.vendor_name,
      transferred_at: now,
      transferred_by: profile.id,
    })
    .eq("id", carvingItemId)
    .eq("status", "carving_assigned")
    .is("cnc_machine_id", null);

  // slab_requirements stays at 'carving_assigned' — nothing else
  // changes for the slab pool view.

  // Audit + per-job event.
  const evtMsg = `Transferred ready slab to ${vendor.name}${notes ? ` · ${notes}` : ""}`;
  await recordEvent(carvingItemId, "transferred_ready", profile.id, evtMsg);
  await logAudit(
    profile.id,
    "carving_ready_slab_transferred",
    "carving_item",
    carvingItemId,
    {
      from_vendor_id: item.vendor_id,
      from_vendor_name: item.vendor_name,
      to_vendor_id: vendor.id,
      to_vendor_name: vendor.name,
      notes,
    },
  );

  refreshAll();
  redirect(
    `${redirectTo}?toast=${encodeURIComponent(`Sent to ${vendor.name}`)}`,
  );
}

/** Vendor self-receives a slab that another vendor transferred to
 *  them. Equivalent to acknowledgeReceiptAction but scoped to inter-
 *  vendor transfers so the slab_transfer runner role isn't
 *  required. Clears the transfer attribution and stamps
 *  received_at_vendor_at so the slab flips into Ready to load. */
export async function acceptTransferReceiptAction(formData: FormData) {
  const { profile } = await requireAuth([
    "developer",
    "owner",
    "carving_head",
    "vendor",
  ]);
  const admin = createAdminSupabaseClient();

  const carvingItemId = txt(formData, "carving_item_id");
  const redirectTo = txt(formData, "redirect_to") || "/vendor";
  if (!carvingItemId) redirect(`${redirectTo}?toast=Missing+job+id`);

  const { data: ci } = await admin
    .from("carving_items")
    .select(
      "id, vendor_id, transferred_from_vendor_id, transferred_from_vendor_name, received_at_vendor_at, status",
    )
    .eq("id", carvingItemId)
    .maybeSingle();
  if (!ci) redirect(`${redirectTo}?toast=Job+not+found`);
  const item = ci as {
    id: string;
    vendor_id: string;
    transferred_from_vendor_id: string | null;
    transferred_from_vendor_name: string | null;
    received_at_vendor_at: string | null;
    status: string;
  };

  if (profile.role === "vendor") {
    // Mig 077 — a vendor user's profile.managed_vendor_ids array
    // extends ownership to those vendor ids. Used so Mohit can act
    // on Alkesh's cockpit while Alkesh is unavailable.
    const managedVendorIds = profile.managed_vendor_ids ?? [];
    const ownsOrManages =
      !!profile.vendor_id &&
      (profile.vendor_id === item.vendor_id ||
        managedVendorIds.includes(item.vendor_id));
    if (!ownsOrManages) {
      redirect(`${redirectTo}?toast=Not+your+slab`);
    }
  }
  if (!item.transferred_from_vendor_id) {
    redirect(
      `${redirectTo}?toast=${encodeURIComponent("Not an inter-vendor transfer — runner needs to deliver this one.")}`,
    );
  }
  if (item.received_at_vendor_at) {
    redirect(`${redirectTo}?toast=Already+received`);
  }
  if (item.status !== "carving_assigned") {
    redirect(`${redirectTo}?toast=Slab+is+not+in+a+receivable+state`);
  }

  const now = new Date().toISOString();
  await admin
    .from("carving_items")
    .update({
      received_at_vendor_at: now,
      received_at_vendor_by: profile.id,
      // Clear the transfer attribution — the slab is now firmly at
      // the receiving vendor's shade. Source vendor doesn't need to
      // see it anymore. The audit trail keeps the history.
      transferred_from_vendor_id: null,
      transferred_from_vendor_name: null,
      transferred_at: null,
      transferred_by: null,
    })
    .eq("id", carvingItemId);

  await recordEvent(
    carvingItemId,
    "transfer_accepted",
    profile.id,
    `Accepted transfer from ${item.transferred_from_vendor_name ?? "another vendor"}`,
  );
  await logAudit(
    profile.id,
    "carving_transfer_accepted",
    "carving_item",
    carvingItemId,
    { from_vendor_id: item.transferred_from_vendor_id },
  );

  refreshAll();
  redirect(
    `${redirectTo}?toast=${encodeURIComponent("Slab marked received — now in Ready to load")}`,
  );
}

/** Vendor refuses an inter-vendor transfer. The slab returns to the
 *  source vendor's queue (vendor_id, vendor_name swap back), the
 *  transferred_from columns clear, and a rejection note is logged
 *  so the original vendor sees why it came back.
 *  Reason is a short free-text string; the cockpit form supplies
 *  one of "wrong_machine", "wrong_design", "overbooked", "other"
 *  plus optional notes for "other". */
export async function flagTransferIssueAction(formData: FormData) {
  const { profile } = await requireAuth([
    "developer",
    "owner",
    "carving_head",
    "vendor",
  ]);
  const admin = createAdminSupabaseClient();

  const carvingItemId = txt(formData, "carving_item_id");
  const reasonRaw = txt(formData, "reason");
  const notes = txt(formData, "notes") || null;
  const redirectTo = txt(formData, "redirect_to") || "/vendor";

  const VALID_REASONS = ["wrong_machine", "wrong_design", "overbooked", "other"];
  const reason = VALID_REASONS.includes(reasonRaw) ? reasonRaw : "other";
  if (!carvingItemId) redirect(`${redirectTo}?toast=Missing+job+id`);
  if (reason === "other" && (!notes || notes.trim().length < 3)) {
    redirect(`${redirectTo}?toast=Notes+required+for+'other'`);
  }

  const { data: ci } = await admin
    .from("carving_items")
    .select(
      "id, vendor_id, vendor_name, transferred_from_vendor_id, transferred_from_vendor_name, received_at_vendor_at, status",
    )
    .eq("id", carvingItemId)
    .maybeSingle();
  if (!ci) redirect(`${redirectTo}?toast=Job+not+found`);
  const item = ci as {
    id: string;
    vendor_id: string;
    vendor_name: string;
    transferred_from_vendor_id: string | null;
    transferred_from_vendor_name: string | null;
    received_at_vendor_at: string | null;
    status: string;
  };

  if (profile.role === "vendor") {
    // Mig 077 — a vendor user's profile.managed_vendor_ids array
    // extends ownership to those vendor ids. Used so Mohit can act
    // on Alkesh's cockpit while Alkesh is unavailable.
    const managedVendorIds = profile.managed_vendor_ids ?? [];
    const ownsOrManages =
      !!profile.vendor_id &&
      (profile.vendor_id === item.vendor_id ||
        managedVendorIds.includes(item.vendor_id));
    if (!ownsOrManages) {
      redirect(`${redirectTo}?toast=Not+your+slab`);
    }
  }
  if (!item.transferred_from_vendor_id) {
    redirect(`${redirectTo}?toast=Not+an+inter-vendor+transfer`);
  }
  if (item.received_at_vendor_at) {
    redirect(
      `${redirectTo}?toast=${encodeURIComponent("Already received — use Problem/transfer to send it back.")}`,
    );
  }

  // Load source vendor row so we can re-snapshot the vendor_type
  // (might have been NULL on the original carving_item if legacy).
  const { data: srcVendorRow } = await admin
    .from("vendors")
    .select("id, name, vendor_type, is_active")
    .eq("id", item.transferred_from_vendor_id)
    .maybeSingle();
  const srcVendor = srcVendorRow as
    | { id: string; name: string; vendor_type: string; is_active: boolean }
    | null;
  if (!srcVendor) {
    redirect(`${redirectTo}?toast=Source+vendor+no+longer+exists`);
  }
  if (!srcVendor.is_active) {
    redirect(`${redirectTo}?toast=Source+vendor+is+inactive`);
  }

  const reasonLabel: Record<string, string> = {
    wrong_machine: "🛠 Wrong machine type for our setup",
    wrong_design: "📐 Wrong design / file",
    overbooked: "📅 Overbooked — can't take it",
    other: "⚠ Other",
  };
  const flagNote = `${reasonLabel[reason]}${notes ? ` · ${notes}` : ""}`;
  const refusedByVendorName = item.vendor_name;

  await admin
    .from("carving_items")
    .update({
      // Send the slab back to the source vendor's queue. Same shape
      // as a fresh assignment (status='carving_assigned', no
      // machine, no received marker).
      vendor_id: srcVendor.id,
      vendor_name: srcVendor.name,
      vendor_type: srcVendor.vendor_type,
      status: "carving_assigned",
      received_at_vendor_at: null,
      received_at_vendor_by: null,
      cnc_machine_id: null,
      loaded_at: null,
      loaded_by: null,
      vendor_estimated_minutes: null,
      // Clear the transfer attribution — slab is back home.
      transferred_from_vendor_id: null,
      transferred_from_vendor_name: null,
      transferred_at: null,
      transferred_by: null,
    })
    .eq("id", carvingItemId);

  await recordEvent(
    carvingItemId,
    "transfer_rejected",
    profile.id,
    `${refusedByVendorName} flagged the transfer · ${flagNote}`,
  );
  await logAudit(
    profile.id,
    "carving_transfer_rejected",
    "carving_item",
    carvingItemId,
    {
      refused_by_vendor_id: item.vendor_id,
      returned_to_vendor_id: srcVendor.id,
      reason,
      notes,
    },
  );

  refreshAll();
  redirect(
    `${redirectTo}?toast=${encodeURIComponent(`Flagged — slab returned to ${srcVendor.name}`)}`,
  );
}

// ── Complete + unload — vendor marks done after the cut ────────────
//
// Atomic:
//   1. carving_items: completed_at, unloaded_at, unloaded_by,
//      temporary_location
//   2. cnc_machines: status → 'idle', current_carving_item_id → null
//   3. cnc_machine_events: 'unloaded'
//   4. slab_requirements unchanged — the team approval step is what
//      flips the slab to 'completed'.
export async function completeAndUnloadAction(formData: FormData) {
  const { profile } = await requireAuth(["developer", "owner", "carving_head", "vendor"]);
  const admin = createAdminSupabaseClient();

  const carvingItemId = txt(formData, "carving_item_id");
  const tempLocation = txt(formData, "temporary_location");

  if (!carvingItemId) redirect("/vendor?toast=Missing+job+id");
  if (!tempLocation) redirect("/vendor?toast=Temporary+location+is+required");

  const { data: ci } = await admin
    .from("carving_items")
    .select("id, status, cnc_machine_id, slab_requirement_id, completed_at")
    .eq("id", carvingItemId)
    .maybeSingle();

  if (!ci) redirect("/vendor?toast=Job+not+found");
  const item = ci as { id: string; status: string; cnc_machine_id: string | null; slab_requirement_id: string; completed_at: string | null };
  if (item.completed_at) redirect("/vendor?toast=Already+marked+complete");
  if (!item.cnc_machine_id) redirect("/vendor?toast=Job+is+not+loaded+on+a+machine");

  const now = new Date().toISOString();

  // 2-head machines load + unload as a paired set. If the machine
  // is multi_head_2, find every active item on this machine and
  // complete them together so neither head is left in a half-state.
  const { data: machineRow } = await admin
    .from("cnc_machines")
    .select("id, machine_type")
    .eq("id", item.cnc_machine_id)
    .maybeSingle();
  const isMultiHead = (machineRow as { machine_type?: string } | null)?.machine_type === "multi_head_2";

  const idsToComplete = [carvingItemId];
  if (isMultiHead) {
    const { data: pair } = await admin
      .from("carving_items")
      .select("id, slab_requirement_id")
      .eq("cnc_machine_id", item.cnc_machine_id)
      .eq("status", "carving_in_progress")
      .is("completed_at", null);
    for (const r of (pair ?? []) as Array<{ id: string }>) {
      if (r.id !== carvingItemId) idsToComplete.push(r.id);
    }
  }

  // Update every paired item with the same completed/unloaded stamp
  // + temp location so the pair lands in Awaiting Review together.
  // Daksh May 2026 — also CLEAR cnc_machine_id. Without this, the
  // items kept appearing on the machine card alongside any new pair
  // loaded after (because the cockpit's activeByMachine grouping
  // keys on cnc_machine_id and the items still had
  // status='carving_in_progress'). The Awaiting Review query reads
  // completed_at IS NOT NULL so it picks them up regardless.
  //
  // Mig 075 — preserve the machine attribution into
  // completed_on_cnc_machine_id BEFORE the clear, so the CNC monthly
  // report (which used to read cnc_machine_id) still groups completed
  // slabs under the right machine. cnc_machine_id stays "is this slab
  // currently on a machine" — true only while running. The new column
  // is "which machine did the work", set once and never cleared.
  await admin
    .from("carving_items")
    .update({
      completed_at: now,
      unloaded_at: now,
      unloaded_by: profile.id,
      temporary_location: tempLocation,
      cnc_machine_id: null,
      completed_on_cnc_machine_id: item.cnc_machine_id,
    })
    .in("id", idsToComplete);

  await admin
    .from("cnc_machines")
    .update({ status: "idle", current_carving_item_id: null })
    .eq("id", item.cnc_machine_id);

  // Audit each item separately so the timeline records both unloads.
  for (const id of idsToComplete) {
    await recordEvent(id, "completed", profile.id, `Unloaded · location: ${tempLocation}${idsToComplete.length > 1 ? " (2-head pair)" : ""}`);
  }
  await admin.from("cnc_machine_events").insert({
    cnc_machine_id: item.cnc_machine_id,
    event_type: "unloaded",
    carving_item_id: carvingItemId,
    user_id: profile.id,
    message:
      idsToComplete.length > 1
        ? `Unloaded 2-head pair · ${tempLocation}`
        : `Unloaded · ${tempLocation}`,
  });
  await logAudit(profile.id, "carving_completed", "carving_item", carvingItemId, {
    temporary_location: tempLocation,
    paired_count: idsToComplete.length,
  });

  await notifyCarvingApprovalBacklog(admin);
  refreshAll();
  redirect(
    idsToComplete.length > 1
      ? "/vendor?toast=Both+slabs+unloaded+%E2%80%94+awaiting+team+review"
      : "/vendor?toast=Slab+unloaded+%E2%80%94+awaiting+team+review",
  );
}

// ── Hold / Reload / Complete-from-hold (mig 069) ────────────────
//
// Daksh, May 2026: vendors needed a "park this slab" pattern between
// loaded and complete. Three flows, all symmetric:
//
//   HOLD     — currently-loaded slab → status='carving_on_hold',
//              machine freed back to 'idle' (unless a partner head
//              is still cutting). Remembers the machine + reason so
//              the reload modal can default back to that CNC.
//   RELOAD   — held slab → status='carving_in_progress' on a chosen
//              machine. Defaults to held_from_machine_id; the vendor
//              can override to any idle CNC of compatible work-type.
//              Resets the loaded_at clock — held time isn't carving
//              time.
//   COMPLETE — held slab → status='carving_complete' without a
//              re-load. Used when the vendor decides the held slab
//              is actually done (e.g. side-1-only carve was enough).
//
// Permissions match the existing load/unload pair: vendor (their
// own slab), carving_head, developer, owner.

/** Move a currently-loaded slab into the on-hold tray. Frees the
 *  CNC machine. Records held_from_machine_id so the reload modal
 *  can default back. */
export async function holdSlabOnVendorAction(formData: FormData) {
  const { profile } = await requireAuth([
    "developer",
    "owner",
    "carving_head",
    "vendor",
  ]);
  const admin = createAdminSupabaseClient();

  const carvingItemId = txt(formData, "carving_item_id");
  const reasonRaw = txt(formData, "reason"); // "two_side_flip" | "no_power" | "tool_change" | "other"
  const notes = txt(formData, "notes") || null;
  const redirectTo = txt(formData, "redirect_to") || "/vendor";

  const VALID_REASONS = ["two_side_flip", "no_power", "tool_change", "other"];
  const reason = VALID_REASONS.includes(reasonRaw) ? reasonRaw : "other";
  if (!carvingItemId) redirect(`${redirectTo}?toast=Missing+job+id`);
  if (reason === "other" && (!notes || notes.trim().length < 3)) {
    redirect(`${redirectTo}?toast=Notes+required+for+'other'`);
  }

  // Load the row + its current machine.
  const { data: ci } = await admin
    .from("carving_items")
    .select("id, vendor_id, status, cnc_machine_id, slab_requirement_id")
    .eq("id", carvingItemId)
    .maybeSingle();
  if (!ci) redirect(`${redirectTo}?toast=Job+not+found`);
  const item = ci as {
    id: string;
    vendor_id: string;
    status: string;
    cnc_machine_id: string | null;
    slab_requirement_id: string;
  };

  // Vendor ownership check — same gate as unloadWithProblem.
  if (profile.role === "vendor") {
    // Mig 077 — a vendor user's profile.managed_vendor_ids array
    // extends ownership to those vendor ids. Used so Mohit can act
    // on Alkesh's cockpit while Alkesh is unavailable.
    const managedVendorIds = profile.managed_vendor_ids ?? [];
    const ownsOrManages =
      !!profile.vendor_id &&
      (profile.vendor_id === item.vendor_id ||
        managedVendorIds.includes(item.vendor_id));
    if (!ownsOrManages) {
      redirect(`${redirectTo}?toast=Not+your+slab`);
    }
  }
  if (item.status !== "carving_in_progress") {
    redirect(`${redirectTo}?toast=Slab+is+not+currently+on+a+machine`);
  }
  if (!item.cnc_machine_id) {
    redirect(`${redirectTo}?toast=Slab+has+no+machine`);
  }

  const machineId = item.cnc_machine_id;
  const now = new Date().toISOString();
  const fullReason = `${reason}${notes ? ` · ${notes}` : ""}`;

  // ── Flip the carving_item to on-hold. ───────────────────────
  // Detach from the machine but REMEMBER which machine it was on
  // via held_from_machine_id so reload defaults back. loaded_at /
  // vendor_estimated_minutes wiped because the held clock is a
  // different metric.
  await admin
    .from("carving_items")
    .update({
      status: "carving_on_hold",
      cnc_machine_id: null,
      loaded_at: null,
      loaded_by: null,
      vendor_estimated_minutes: null,
      held_at: now,
      held_by: profile.id,
      held_reason: fullReason,
      held_from_machine_id: machineId,
    })
    .eq("id", carvingItemId);

  // slab_requirements stays at 'carving_in_progress' — from the
  // production side, the slab is still actively being worked (just
  // off-machine for now). Same as carving_assigned in that sense.

  // ── Machine state: same partner-survivor logic as unloadWithProblem. ──
  const { data: partners } = await admin
    .from("carving_items")
    .select("id")
    .eq("cnc_machine_id", machineId)
    .eq("status", "carving_in_progress")
    .neq("id", carvingItemId);
  const survivors = (partners ?? []) as Array<{ id: string }>;
  if (survivors.length > 0) {
    const { data: mach } = await admin
      .from("cnc_machines")
      .select("current_carving_item_id")
      .eq("id", machineId)
      .maybeSingle();
    if (
      (mach as { current_carving_item_id?: string | null } | null)
        ?.current_carving_item_id === carvingItemId
    ) {
      await admin
        .from("cnc_machines")
        .update({ current_carving_item_id: survivors[0].id })
        .eq("id", machineId);
    }
  } else {
    await admin
      .from("cnc_machines")
      .update({ status: "idle", current_carving_item_id: null })
      .eq("id", machineId);
  }

  // ── Event log + audit ────────────────────────────────────────
  const reasonLabel: Record<string, string> = {
    two_side_flip: "🔄 Flip & carve other side",
    no_power: "⚡ No power / scheduling",
    tool_change: "🛠 Tool change",
    other: "⏸ Other",
  };
  const evtMsg = `${reasonLabel[reason]}${notes ? ` · ${notes}` : ""}`;
  await admin.from("cnc_machine_events").insert({
    cnc_machine_id: machineId,
    event_type: "held",
    carving_item_id: carvingItemId,
    user_id: profile.id,
    message: evtMsg,
  });
  await recordEvent(carvingItemId, "held", profile.id, evtMsg);
  await logAudit(profile.id, "carving_held", "carving_item", carvingItemId, {
    reason,
    notes,
    from_machine_id: machineId,
  });

  refreshAll();
  redirect(
    `${redirectTo}?toast=${encodeURIComponent("Slab on hold — see ⏸ On Hold to reload")}`,
  );
}

/** Re-load a held slab onto a chosen machine. The reload modal
 *  defaults `target_machine_id` to held_from_machine_id but the
 *  vendor can override. Requires the target machine to be currently
 *  idle (compatible work-type check is done at the picker level on
 *  the client — same rule as the existing Load modal). */
export async function reloadHeldSlabAction(formData: FormData) {
  const { profile } = await requireAuth([
    "developer",
    "owner",
    "carving_head",
    "vendor",
  ]);
  const admin = createAdminSupabaseClient();

  const carvingItemId = txt(formData, "carving_item_id");
  const targetMachineId = txt(formData, "target_machine_id");
  const vendorEstimatedMinutesRaw = txt(formData, "vendor_estimated_minutes");
  const redirectTo = txt(formData, "redirect_to") || "/vendor";

  if (!carvingItemId) redirect(`${redirectTo}?toast=Missing+job+id`);
  if (!targetMachineId) redirect(`${redirectTo}?toast=Pick+a+machine`);

  const vendorEstimatedMinutes = vendorEstimatedMinutesRaw
    ? Math.max(0, Number(vendorEstimatedMinutesRaw))
    : null;

  // Load the held row.
  const { data: ci } = await admin
    .from("carving_items")
    .select(
      "id, vendor_id, status, cnc_machine_id, slab_requirement_id, requires_machine_type, requires_cnc_axes, held_from_machine_id",
    )
    .eq("id", carvingItemId)
    .maybeSingle();
  if (!ci) redirect(`${redirectTo}?toast=Job+not+found`);
  const item = ci as {
    id: string;
    vendor_id: string;
    status: string;
    cnc_machine_id: string | null;
    slab_requirement_id: string;
    requires_machine_type: string | null;
    requires_cnc_axes: number | null;
    held_from_machine_id: string | null;
  };

  if (profile.role === "vendor") {
    // Mig 077 — a vendor user's profile.managed_vendor_ids array
    // extends ownership to those vendor ids. Used so Mohit can act
    // on Alkesh's cockpit while Alkesh is unavailable.
    const managedVendorIds = profile.managed_vendor_ids ?? [];
    const ownsOrManages =
      !!profile.vendor_id &&
      (profile.vendor_id === item.vendor_id ||
        managedVendorIds.includes(item.vendor_id));
    if (!ownsOrManages) {
      redirect(`${redirectTo}?toast=Not+your+slab`);
    }
  }
  if (item.status !== "carving_on_hold") {
    redirect(`${redirectTo}?toast=Slab+is+not+on+hold`);
  }

  // Load target machine + check it's idle + compatible.
  // Daksh May 2026 — was selecting `name` which doesn't exist on
  // cnc_machines; the row came back null and the action errored
  // with "Machine not found" even though the ID was valid. Correct
  // column is `machine_code` (the human label like "MA10").
  const { data: mach } = await admin
    .from("cnc_machines")
    .select("id, machine_code, status, machine_type, vendor_id")
    .eq("id", targetMachineId)
    .maybeSingle();
  if (!mach) redirect(`${redirectTo}?toast=Machine+not+found`);
  const machine = mach as {
    id: string;
    machine_code: string;
    status: string;
    machine_type: string;
    cnc_axes: number | null;
    vendor_id: string;
  };
  if (machine.vendor_id !== item.vendor_id) {
    redirect(`${redirectTo}?toast=Machine+belongs+to+another+vendor`);
  }
  // Work-type check: lathe slab → lathe machine; non-lathe → non-lathe.
  if (item.requires_machine_type === "lathe" && machine.machine_type !== "lathe") {
    redirect(`${redirectTo}?toast=Lathe+slab+needs+a+lathe+machine`);
  }
  if (item.requires_machine_type !== "lathe" && machine.machine_type === "lathe") {
    redirect(`${redirectTo}?toast=Non-lathe+slab+cannot+go+on+a+lathe`);
  }

  // Mig 079 / 093 — strict CNC axis match (was missing on reload, so a
  // held 4/5-axis slab could be reloaded onto the wrong machine).
  const axisErr = checkAxisMatch(item.requires_cnc_axes, machine);
  if (axisErr) redirect(`${redirectTo}?toast=${encodeURIComponent(axisErr)}`);

  // Daksh May 2026 — busy-machine reload is allowed only when the
  // target is a 2-head CNC currently running EXACTLY ONE matching
  // slab (same L×W×T + temple + label as the held one). Otherwise
  // the original "machine not idle" reject still applies.
  let isPairJoin = false;
  if (machine.status !== "idle") {
    const isCandidateBusy =
      machine.machine_type === "multi_head_2" && machine.status === "carving";
    if (!isCandidateBusy) {
      redirect(
        `${redirectTo}?toast=${encodeURIComponent(`${machine.machine_code} is not idle right now`)}`,
      );
    }
    // Confirm exactly one active item + matching geometry.
    const { data: active } = await admin
      .from("carving_items")
      .select("id, slab_requirement_id")
      .eq("cnc_machine_id", targetMachineId)
      .eq("status", "carving_in_progress");
    const activeRows = (active ?? []) as Array<{ id: string; slab_requirement_id: string }>;
    if (activeRows.length !== 1) {
      redirect(
        `${redirectTo}?toast=${encodeURIComponent(`${machine.machine_code} can't accept a partner right now (has ${activeRows.length} active slab${activeRows.length === 1 ? "" : "s"}).`)}`,
      );
    }
    const partnerSlabId = activeRows[0].slab_requirement_id;
    if (partnerSlabId === item.slab_requirement_id) {
      // Same slab_requirement_id on both sides means the held row
      // IS the running one (impossible in practice but cheap to guard).
      redirect(
        `${redirectTo}?toast=${encodeURIComponent(`That slab is already on ${machine.machine_code}.`)}`,
      );
    }
    const { data: slabRows } = await admin
      .from("slab_requirements")
      .select("id, label, temple, length_ft, width_ft, thickness_ft")
      .in("id", [item.slab_requirement_id, partnerSlabId]);
    if (!slabRows || slabRows.length !== 2) {
      redirect(`${redirectTo}?toast=Could+not+load+slab+geometry+for+matching`);
    }
    const sRows = slabRows as Array<{
      id: string;
      label: string | null;
      temple: string;
      length_ft: number | string;
      width_ft: number | string;
      thickness_ft: number | string;
    }>;
    const selfSlab = sRows.find((s) => s.id === item.slab_requirement_id)!;
    const partner = sRows.find((s) => s.id === partnerSlabId)!;
    const dimsMatch =
      Number(selfSlab.length_ft) === Number(partner.length_ft) &&
      Number(selfSlab.width_ft) === Number(partner.width_ft) &&
      Number(selfSlab.thickness_ft) === Number(partner.thickness_ft);
    const labelMatch = (selfSlab.label ?? "") === (partner.label ?? "");
    const templeMatch = (selfSlab.temple ?? "") === (partner.temple ?? "");
    if (!dimsMatch || !labelMatch || !templeMatch) {
      redirect(
        `${redirectTo}?toast=${encodeURIComponent(
          `Held slab doesn't match the slab running on ${machine.machine_code} (needs identical L×W×T + temple + label).`,
        )}`,
      );
    }
    isPairJoin = true;
  }

  const now = new Date().toISOString();

  // ── Update carving_item ─────────────────────────────────────
  await admin
    .from("carving_items")
    .update({
      status: "carving_in_progress",
      cnc_machine_id: targetMachineId,
      loaded_at: now,
      loaded_by: profile.id,
      vendor_estimated_minutes: vendorEstimatedMinutes,
      // Keep held_from_machine_id on the row as history — useful if
      // the vendor needs to hold again later. Cleared by the next
      // hold call when it re-stamps with the new machine.
      held_at: null,
      held_by: null,
      held_reason: null,
    })
    .eq("id", carvingItemId);

  // ── Update CNC machine ──────────────────────────────────────
  // Pair-join: machine is ALREADY 'carving' with current_carving_item_id
  // pointing at the partner — leave those columns alone so the partner
  // stays the pair anchor.
  if (!isPairJoin) {
    await admin
      .from("cnc_machines")
      .update({ status: "carving", current_carving_item_id: carvingItemId })
      .eq("id", targetMachineId);
  }

  // ── Events + audit ──────────────────────────────────────────
  const sameMachine = machine.id === item.held_from_machine_id;
  const evtMsg = sameMachine
    ? `Reloaded onto ${machine.machine_code} (same machine)`
    : `Reloaded onto ${machine.machine_code} (was held from ${item.held_from_machine_id ?? "unknown"})`;
  await admin.from("cnc_machine_events").insert({
    cnc_machine_id: targetMachineId,
    event_type: "loaded",
    carving_item_id: carvingItemId,
    user_id: profile.id,
    message: evtMsg,
  });
  await recordEvent(carvingItemId, "reloaded_from_hold", profile.id, evtMsg);
  await logAudit(
    profile.id,
    "carving_reloaded_from_hold",
    "carving_item",
    carvingItemId,
    { target_machine_id: targetMachineId, was_from: item.held_from_machine_id },
  );

  refreshAll();
  redirect(
    `${redirectTo}?toast=${encodeURIComponent(`Reloaded on ${machine.machine_code}`)}`,
  );
}

/** Mig 069 + Daksh May 2026 — reload TWO held slabs onto a 2-head
 *  CNC in one shot. Without this, the vendor would have to load slab
 *  A first (machine flips to 'carving') and then can't load slab B
 *  to the same machine because the idle guard rejects it. This
 *  mirrors loadTwoSlabsOnMultiHeadAction but for items currently in
 *  the on-hold state, atomically clearing both rows' hold metadata
 *  and flipping the target multi_head_2 machine to 'carving'.
 *
 *  Both slabs must:
 *    - belong to the same vendor as the target machine,
 *    - be in status 'carving_on_hold',
 *    - have non-lathe requires_machine_type,
 *    - share L×W×T + temple + label (geometry must match for the jig).
 *  Target machine must be multi_head_2 + idle. */
export async function reloadTwoHeldSlabsOnMultiHeadAction(formData: FormData) {
  const { profile } = await requireAuth([
    "developer",
    "owner",
    "carving_head",
    "vendor",
  ]);
  const admin = createAdminSupabaseClient();

  const carvingItemAId = txt(formData, "carving_item_a_id");
  const carvingItemBId = txt(formData, "carving_item_b_id");
  const targetMachineId = txt(formData, "target_machine_id");
  const vendorEstimatedMinutesRaw = txt(formData, "vendor_estimated_minutes");
  const redirectTo = txt(formData, "redirect_to") || "/vendor";

  if (!carvingItemAId || !carvingItemBId) {
    redirect(`${redirectTo}?toast=Missing+one+of+the+slabs`);
  }
  if (carvingItemAId === carvingItemBId) {
    redirect(`${redirectTo}?toast=Pick+two+different+held+slabs`);
  }
  if (!targetMachineId) redirect(`${redirectTo}?toast=Pick+a+machine`);

  const vendorEstimatedMinutes = vendorEstimatedMinutesRaw
    ? Math.max(0, Number(vendorEstimatedMinutesRaw))
    : null;

  // Load both held items + the machine in parallel.
  const [{ data: aRow }, { data: bRow }, { data: mRow }] = await Promise.all([
    admin
      .from("carving_items")
      .select(
        "id, vendor_id, status, cnc_machine_id, slab_requirement_id, requires_machine_type, requires_cnc_axes, held_from_machine_id",
      )
      .eq("id", carvingItemAId)
      .maybeSingle(),
    admin
      .from("carving_items")
      .select(
        "id, vendor_id, status, cnc_machine_id, slab_requirement_id, requires_machine_type, requires_cnc_axes, held_from_machine_id",
      )
      .eq("id", carvingItemBId)
      .maybeSingle(),
    admin
      .from("cnc_machines")
      .select("id, machine_code, status, machine_type, cnc_axes, vendor_id")
      .eq("id", targetMachineId)
      .maybeSingle(),
  ]);

  if (!aRow || !bRow) redirect(`${redirectTo}?toast=One+of+the+slabs+not+found`);
  if (!mRow) redirect(`${redirectTo}?toast=Machine+not+found`);

  type Item = {
    id: string;
    vendor_id: string;
    status: string;
    cnc_machine_id: string | null;
    slab_requirement_id: string;
    requires_machine_type: string | null;
    requires_cnc_axes: number | null;
    held_from_machine_id: string | null;
  };
  const a = aRow as Item;
  const b = bRow as Item;
  const machine = mRow as {
    id: string;
    machine_code: string;
    status: string;
    machine_type: string;
    cnc_axes: number | null;
    vendor_id: string;
  };

  // Vendor ownership: same vendor on every row.
  if (profile.role === "vendor") {
    // Mig 077 — extend ownership via managed_vendor_ids. Both slabs
    // must belong to a vendor the actor either IS or manages.
    const managedVendorIds = profile.managed_vendor_ids ?? [];
    const allowed = (id: string) =>
      !!profile.vendor_id &&
      (profile.vendor_id === id || managedVendorIds.includes(id));
    if (!allowed(a.vendor_id) || !allowed(b.vendor_id)) {
      redirect(`${redirectTo}?toast=Not+your+slab`);
    }
  }
  if (a.vendor_id !== machine.vendor_id || b.vendor_id !== machine.vendor_id) {
    redirect(`${redirectTo}?toast=Machine+belongs+to+a+different+vendor`);
  }

  // Both must be on hold.
  if (a.status !== "carving_on_hold" || b.status !== "carving_on_hold") {
    redirect(`${redirectTo}?toast=Both+slabs+must+be+on+hold`);
  }

  // Target machine must be a 2-head + idle.
  if (machine.machine_type !== "multi_head_2") {
    redirect(`${redirectTo}?toast=Pair+reload+needs+a+2-head+CNC`);
  }
  if (machine.status !== "idle") {
    redirect(
      `${redirectTo}?toast=${encodeURIComponent(`${machine.machine_code} is not idle right now`)}`,
    );
  }

  // Neither slab may be tagged for a non-multi-head type.
  for (const j of [a, b]) {
    if (j.requires_machine_type && j.requires_machine_type !== "multi_head_2") {
      redirect(
        `${redirectTo}?toast=${encodeURIComponent(
          `One of the slabs is tagged for ${j.requires_machine_type}. Pair reload only works for multi_head_2.`,
        )}`,
      );
    }
  }

  // Mig 079 / 093 — strict CNC axis match for BOTH held slabs.
  for (const j of [a, b]) {
    const axisErr = checkAxisMatch(j.requires_cnc_axes, machine);
    if (axisErr) redirect(`${redirectTo}?toast=${encodeURIComponent(axisErr)}`);
  }

  // Validate identical slab geometry — must match for the jig.
  const { data: slabRows } = await admin
    .from("slab_requirements")
    .select("id, label, temple, length_ft, width_ft, thickness_ft")
    .in("id", [a.slab_requirement_id, b.slab_requirement_id]);
  if (!slabRows || slabRows.length !== 2) {
    redirect(`${redirectTo}?toast=Could+not+load+slab+geometry+for+matching`);
  }
  const sRows = slabRows as Array<{
    id: string;
    label: string | null;
    temple: string;
    length_ft: number | string;
    width_ft: number | string;
    thickness_ft: number | string;
  }>;
  const slabA = sRows.find((s) => s.id === a.slab_requirement_id)!;
  const slabB = sRows.find((s) => s.id === b.slab_requirement_id)!;
  const dimsMatch =
    Number(slabA.length_ft) === Number(slabB.length_ft) &&
    Number(slabA.width_ft) === Number(slabB.width_ft) &&
    Number(slabA.thickness_ft) === Number(slabB.thickness_ft);
  const labelMatch = (slabA.label ?? "") === (slabB.label ?? "");
  const templeMatch = (slabA.temple ?? "") === (slabB.temple ?? "");
  if (!dimsMatch || !labelMatch || !templeMatch) {
    redirect(
      `${redirectTo}?toast=${encodeURIComponent(
        "Pair reload needs IDENTICAL slabs (same L×W×T + temple + label).",
      )}`,
    );
  }

  const now = new Date().toISOString();

  // Atomically flip both items. Race-guard: only update if STILL
  // on-hold. If either flips out from under us, roll back the one
  // that succeeded so we don't leave a half-loaded machine.
  const updateOne = (id: string) =>
    admin
      .from("carving_items")
      .update({
        status: "carving_in_progress",
        cnc_machine_id: targetMachineId,
        loaded_at: now,
        loaded_by: profile.id,
        vendor_estimated_minutes: vendorEstimatedMinutes,
        held_at: null,
        held_by: null,
        held_reason: null,
      })
      .eq("id", id)
      .eq("status", "carving_on_hold")
      .select("id");

  const [{ data: updA }, { data: updB }] = await Promise.all([
    updateOne(a.id),
    updateOne(b.id),
  ]);
  if (!updA?.length || !updB?.length) {
    // Roll back any partial success — restore the on-hold state on
    // whichever slab DID flip so we don't end up with a held slab
    // pointing at a machine that's now occupied by only one slab.
    const rollback = async (id: string, originalHeldFrom: string | null) => {
      await admin
        .from("carving_items")
        .update({
          status: "carving_on_hold",
          cnc_machine_id: null,
          loaded_at: null,
          loaded_by: null,
          vendor_estimated_minutes: null,
          held_at: now,
          held_by: profile.id,
          held_reason: "auto-reverted pair reload conflict",
          held_from_machine_id: originalHeldFrom,
        })
        .eq("id", id);
    };
    if (updA?.length) await rollback(a.id, a.held_from_machine_id);
    if (updB?.length) await rollback(b.id, b.held_from_machine_id);
    redirect(
      `${redirectTo}?toast=Could+not+claim+both+slabs+(state+changed).+Refresh+and+retry.`,
    );
  }

  // Flip the machine. Mirror loadTwoSlabsOnMultiHeadAction —
  // current_carving_item_id points at the first head's item; the
  // second is implicit (any caller that needs both reads
  // cnc_machines.current_carving_item_id + queries carving_items
  // WHERE cnc_machine_id=machine.id).
  await admin
    .from("cnc_machines")
    .update({ status: "carving", current_carving_item_id: a.id })
    .eq("id", targetMachineId)
    .eq("status", "idle");

  // Events + audit on both items + the machine.
  const evtMsg = `Pair-reloaded from hold onto ${machine.machine_code}`;
  await Promise.all([
    recordEvent(
      a.id,
      "reloaded_from_hold",
      profile.id,
      `${evtMsg} (paired with ${b.id})`,
    ),
    recordEvent(
      b.id,
      "reloaded_from_hold",
      profile.id,
      `${evtMsg} (paired with ${a.id})`,
    ),
  ]);
  await admin.from("cnc_machine_events").insert({
    cnc_machine_id: targetMachineId,
    event_type: "loaded",
    carving_item_id: a.id,
    user_id: profile.id,
    message: `${evtMsg} · pair ${a.id} + ${b.id}`,
  });
  await logAudit(
    profile.id,
    "carving_reloaded_pair_from_hold",
    "carving_item",
    a.id,
    {
      paired_with: b.id,
      target_machine_id: targetMachineId,
      was_a_from: a.held_from_machine_id,
      was_b_from: b.held_from_machine_id,
      vendor_estimated_minutes: vendorEstimatedMinutes,
    },
  );

  refreshAll();
  redirect(
    `${redirectTo}?toast=${encodeURIComponent(`Both slabs reloaded on ${machine.machine_code}`)}`,
  );
}

/** Daksh May 2026 — flip a held slab back into the regular "ready
 *  to load" queue without picking a machine right now. Use case:
 *  the vendor parked the slab mid-carve, the situation changes
 *  (different priority lands, a different vendor will take it, the
 *  vendor wants to load it via the standard load modal so they
 *  can pair it), and they want it out of the On Hold tray and back
 *  in the regular queue. NOT the same as Mark done — the carve
 *  hasn't finished, just the hold is released.
 *
 *  Resets all hold metadata + cnc_machine_id + loaded_at so the
 *  row looks identical to a freshly-assigned-not-loaded job. */
export async function sendHeldSlabBackToReadyAction(formData: FormData) {
  const { profile } = await requireAuth([
    "developer",
    "owner",
    "carving_head",
    "vendor",
  ]);
  const admin = createAdminSupabaseClient();

  const carvingItemId = txt(formData, "carving_item_id");
  const redirectTo = txt(formData, "redirect_to") || "/vendor";

  if (!carvingItemId) redirect(`${redirectTo}?toast=Missing+job+id`);

  const { data: ci } = await admin
    .from("carving_items")
    .select(
      "id, vendor_id, status, slab_requirement_id, held_from_machine_id",
    )
    .eq("id", carvingItemId)
    .maybeSingle();
  if (!ci) redirect(`${redirectTo}?toast=Job+not+found`);
  const item = ci as {
    id: string;
    vendor_id: string;
    status: string;
    slab_requirement_id: string;
    held_from_machine_id: string | null;
  };

  if (profile.role === "vendor") {
    // Mig 077 — a vendor user's profile.managed_vendor_ids array
    // extends ownership to those vendor ids. Used so Mohit can act
    // on Alkesh's cockpit while Alkesh is unavailable.
    const managedVendorIds = profile.managed_vendor_ids ?? [];
    const ownsOrManages =
      !!profile.vendor_id &&
      (profile.vendor_id === item.vendor_id ||
        managedVendorIds.includes(item.vendor_id));
    if (!ownsOrManages) {
      redirect(`${redirectTo}?toast=Not+your+slab`);
    }
  }
  if (item.status !== "carving_on_hold") {
    redirect(`${redirectTo}?toast=Slab+is+not+on+hold`);
  }

  const now = new Date().toISOString();
  await admin
    .from("carving_items")
    .update({
      status: "carving_assigned",
      cnc_machine_id: null,
      loaded_at: null,
      loaded_by: null,
      vendor_estimated_minutes: null,
      held_at: null,
      held_by: null,
      held_reason: null,
      // Keep held_from_machine_id as soft history so the next load
      // modal's defaulting can still suggest the same machine.
    })
    .eq("id", carvingItemId)
    .eq("status", "carving_on_hold");

  // Slab table mirrors the carving_items state.
  await admin
    .from("slab_requirements")
    .update({
      status: "carving_assigned",
      updated_by: profile.id,
      updated_at: now,
    })
    .eq("id", item.slab_requirement_id);

  await recordEvent(
    carvingItemId,
    "hold_released",
    profile.id,
    "Returned to Ready-to-load queue from On Hold",
  );
  await logAudit(
    profile.id,
    "carving_hold_released",
    "carving_item",
    carvingItemId,
    { was_held_from: item.held_from_machine_id },
  );

  refreshAll();
  redirect(`${redirectTo}?toast=Slab+is+back+in+Ready+to+load`);
}

/** Mark a held slab as complete WITHOUT re-loading. The vendor
 *  decides the held carving is actually done (e.g. they only needed
 *  side 1 carved, or a partner is unable to finish side 2). Mirrors
 *  the tail end of completeAndUnloadAction but skips the machine
 *  side because the slab isn't on a machine. */
export async function completeHeldSlabAction(formData: FormData) {
  const { profile } = await requireAuth([
    "developer",
    "owner",
    "carving_head",
    "vendor",
  ]);
  const admin = createAdminSupabaseClient();

  const carvingItemId = txt(formData, "carving_item_id");
  const temporaryLocation = txt(formData, "temporary_location") || null;
  const redirectTo = txt(formData, "redirect_to") || "/vendor";

  if (!carvingItemId) redirect(`${redirectTo}?toast=Missing+job+id`);

  const { data: ci } = await admin
    .from("carving_items")
    .select("id, vendor_id, status, slab_requirement_id, held_from_machine_id")
    .eq("id", carvingItemId)
    .maybeSingle();
  if (!ci) redirect(`${redirectTo}?toast=Job+not+found`);
  const item = ci as {
    id: string;
    vendor_id: string;
    status: string;
    slab_requirement_id: string;
    held_from_machine_id: string | null;
  };

  if (profile.role === "vendor") {
    // Mig 077 — a vendor user's profile.managed_vendor_ids array
    // extends ownership to those vendor ids. Used so Mohit can act
    // on Alkesh's cockpit while Alkesh is unavailable.
    const managedVendorIds = profile.managed_vendor_ids ?? [];
    const ownsOrManages =
      !!profile.vendor_id &&
      (profile.vendor_id === item.vendor_id ||
        managedVendorIds.includes(item.vendor_id));
    if (!ownsOrManages) {
      redirect(`${redirectTo}?toast=Not+your+slab`);
    }
  }
  if (item.status !== "carving_on_hold") {
    redirect(`${redirectTo}?toast=Slab+is+not+on+hold`);
  }

  const now = new Date().toISOString();

  await admin
    .from("carving_items")
    .update({
      status: "carving_complete",
      completed_at: now,
      unloaded_at: now,
      unloaded_by: profile.id,
      temporary_location: temporaryLocation,
      // Clear held fields — done is done.
      held_at: null,
      held_by: null,
      held_reason: null,
      cnc_machine_id: null,
      // Mig 075 — preserve machine attribution for the CNC monthly
      // report. held_from_machine_id was saved when the slab was
      // first held + survived reload cycles, so it's the right
      // "which machine did the work" answer for a hold→complete row.
      completed_on_cnc_machine_id: item.held_from_machine_id,
    })
    .eq("id", carvingItemId);

  // slab_requirements doesn't flip here either — the team review
  // step (approveCarvingJobAction) handles the final transition.

  await recordEvent(
    carvingItemId,
    "completed_from_hold",
    profile.id,
    `Marked complete from on-hold tray${temporaryLocation ? ` · 📍 ${temporaryLocation}` : ""}`,
  );
  await logAudit(
    profile.id,
    "carving_completed_from_hold",
    "carving_item",
    carvingItemId,
    { temporary_location: temporaryLocation },
  );

  await notifyCarvingApprovalBacklog(admin);
  refreshAll();
  redirect(
    `${redirectTo}?toast=${encodeURIComponent("Marked complete — awaiting team review")}`,
  );
}

// ── Mig 080 — complete a rework slab from the bench ─────────────────
// Sibling of completeHeldSlabAction, but the precondition is "this
// slab is in the Rework Pending tray" (status='carving_assigned' +
// review_decision='rework_needed' + review_reworked_at IS NOT NULL),
// not "this slab is on hold". Used when the vendor looks at the
// rework photo + reason, decides the slab was fine after all (or
// they fixed it on a bench), and wants to bounce it straight back
// to the review queue without re-loading it onto a CNC.
//
// Sets completed_on_cnc_machine_id = NULL because there is no CNC
// involvement on the redo — the rework either happened on a bench
// or was a no-op. The CNC monthly report ignores rows with this
// field NULL, so the original carving CNC stays attributed via the
// pre-rework completed_on_cnc_machine_id which we DON'T clear.
//
// Permission: same as completeHeldSlabAction (vendor + managed
// vendors + dev/owner/carving_head).
export async function completeReworkSlabAction(formData: FormData) {
  const { profile } = await requireAuth([
    "developer",
    "owner",
    "carving_head",
    "vendor",
  ]);
  const admin = createAdminSupabaseClient();

  const carvingItemId = txt(formData, "carving_item_id");
  const temporaryLocation = txt(formData, "temporary_location") || null;
  const redirectTo = txt(formData, "redirect_to") || "/vendor";

  if (!carvingItemId) redirect(`${redirectTo}?toast=Missing+job+id`);

  const { data: ci } = await admin
    .from("carving_items")
    .select(
      "id, vendor_id, status, slab_requirement_id, review_decision, review_reworked_at, completed_on_cnc_machine_id",
    )
    .eq("id", carvingItemId)
    .maybeSingle();
  if (!ci) redirect(`${redirectTo}?toast=Job+not+found`);
  const item = ci as {
    id: string;
    vendor_id: string;
    status: string;
    slab_requirement_id: string;
    review_decision: string | null;
    review_reworked_at: string | null;
    completed_on_cnc_machine_id: string | null;
  };

  if (profile.role === "vendor") {
    const managedVendorIds = profile.managed_vendor_ids ?? [];
    const ownsOrManages =
      !!profile.vendor_id &&
      (profile.vendor_id === item.vendor_id ||
        managedVendorIds.includes(item.vendor_id));
    if (!ownsOrManages) {
      redirect(`${redirectTo}?toast=Not+your+slab`);
    }
  }
  if (
    item.status !== "carving_assigned" ||
    item.review_decision !== "rework_needed" ||
    !item.review_reworked_at
  ) {
    redirect(`${redirectTo}?toast=Slab+is+not+in+rework+state`);
  }

  const now = new Date().toISOString();

  await admin
    .from("carving_items")
    .update({
      status: "carving_complete",
      completed_at: now,
      unloaded_at: now,
      unloaded_by: profile.id,
      temporary_location: temporaryLocation,
      // Don't touch completed_on_cnc_machine_id — the original CNC
      // attribution from the first carve stays valid for reporting.
    })
    .eq("id", carvingItemId);

  await recordEvent(
    carvingItemId,
    "completed_from_rework",
    profile.id,
    `Marked complete from Rework Pending tray${temporaryLocation ? ` · 📍 ${temporaryLocation}` : ""}`,
  );
  await logAudit(
    profile.id,
    "carving_completed_from_rework",
    "carving_item",
    carvingItemId,
    { temporary_location: temporaryLocation },
  );

  await notifyCarvingApprovalBacklog(admin);
  refreshAll();
  redirect(
    `${redirectTo}?toast=${encodeURIComponent("Marked complete — back in review queue")}`,
  );
}

// Update temporary location after unload (e.g., slab moved across
// the yard).
export async function updateTemporaryLocationAction(formData: FormData) {
  const { profile } = await requireAuth(["developer", "owner", "carving_head", "vendor"]);
  const admin = createAdminSupabaseClient();

  const carvingItemId = txt(formData, "carving_item_id");
  const tempLocation = txt(formData, "temporary_location");

  if (!carvingItemId) redirect("/vendor?toast=Missing+job+id");

  await admin
    .from("carving_items")
    .update({ temporary_location: tempLocation || null })
    .eq("id", carvingItemId);

  await recordEvent(carvingItemId, "location_updated", profile.id, `Temp location: ${tempLocation || "(cleared)"}`);
  await logAudit(profile.id, "carving_temp_location_updated", "carving_item", carvingItemId, {
    temporary_location: tempLocation,
  });

  refreshAll();
  redirect("/vendor?toast=Location+saved");
}

// ── Maintenance: flag / resolve a CNC machine ──────────────────────
//
// Reasons are a fixed dropdown list — kept in sync between the form
// and this action. We don't gate against currently-carving here:
// instead the UI prevents picking maintenance on a busy machine. This
// guard is the safety net.
const MAINTENANCE_REASONS = new Set([
  "tool_change",
  "spindle_issue",
  "electrical",
  "coolant",
  "scheduled_service",
  "pending_program",
  "other",
]);

export async function flagMaintenanceAction(formData: FormData) {
  const { profile } = await requireAuth(["developer", "owner", "carving_head", "vendor"]);
  const admin = createAdminSupabaseClient();

  const machineId = txt(formData, "cnc_machine_id");
  const reason = txt(formData, "reason");
  const detail = txt(formData, "detail");

  if (!machineId) redirect("/vendor?toast=Missing+machine+id");
  if (!MAINTENANCE_REASONS.has(reason)) {
    redirect("/vendor?toast=Pick+a+maintenance+reason");
  }

  const { data: m } = await admin
    .from("cnc_machines")
    .select("id, status, current_carving_item_id")
    .eq("id", machineId)
    .maybeSingle();
  if (!m) redirect("/vendor?toast=Machine+not+found");
  const machineRow = m as {
    id: string;
    status: string;
    current_carving_item_id: string | null;
  };
  if (machineRow.status === "maintenance") {
    redirect("/vendor?toast=Machine+is+already+under+maintenance");
  }
  if (machineRow.status === "inactive") {
    redirect("/vendor?toast=Machine+is+offline");
  }

  // Daksh May 2026 — was idle-only ("Unload the slab before flagging
  // maintenance"). Now: flagging maintenance on a RUNNING machine
  // pauses the slab timer in place. We keep current_carving_item_id
  // intact + flip status to maintenance. resolveMaintenanceAction
  // shifts loaded_at forward by the maintenance duration so the
  // timer resumes from where it stopped.
  const wasCarving = machineRow.status === "carving";

  const now = new Date().toISOString();
  await admin
    .from("cnc_machines")
    .update({
      status: "maintenance",
      maintenance_reason: detail ? `${reason}: ${detail}` : reason,
      maintenance_flagged_at: now,
      maintenance_flagged_by: profile.id,
    })
    .eq("id", machineId);

  await admin.from("cnc_machine_events").insert({
    cnc_machine_id: machineId,
    event_type: "maintenance_start",
    reason,
    message: detail
      ? wasCarving
        ? `${detail} (timer paused — slab still loaded)`
        : detail
      : wasCarving
        ? "timer paused — slab still loaded"
        : null,
    user_id: profile.id,
  });
  await logAudit(profile.id, "cnc_maintenance_start", "cnc_machine", machineId, {
    reason,
    detail,
    paused_carving: wasCarving,
  });

  refreshAll();
  redirect(
    wasCarving
      ? "/vendor?toast=Machine+down+%E2%80%94+slab+timer+paused"
      : "/vendor?toast=Machine+flagged+for+maintenance",
  );
}

export async function resolveMaintenanceAction(formData: FormData) {
  const { profile } = await requireAuth(["developer", "owner", "carving_head", "vendor"]);
  const admin = createAdminSupabaseClient();

  const machineId = txt(formData, "cnc_machine_id");
  if (!machineId) redirect("/vendor?toast=Missing+machine+id");

  const { data: m } = await admin
    .from("cnc_machines")
    .select(
      "id, status, current_carving_item_id, maintenance_flagged_at",
    )
    .eq("id", machineId)
    .maybeSingle();
  if (!m) redirect("/vendor?toast=Machine+not+found");
  const machineRow = m as {
    id: string;
    status: string;
    current_carving_item_id: string | null;
    maintenance_flagged_at: string | null;
  };

  const now = Date.now();
  const flaggedAt = machineRow.maintenance_flagged_at
    ? new Date(machineRow.maintenance_flagged_at).getTime()
    : null;
  // If maintenance was applied while the machine was carving, the
  // current_carving_item_id is still set. Resume to 'carving' and
  // shift every active carving_item's loaded_at FORWARD by the
  // maintenance duration so the elapsed display picks up exactly
  // where it stopped. Multi-head pairs share the same machine, so
  // we update by cnc_machine_id (catches both heads at once).
  const resumeCarving = machineRow.current_carving_item_id != null;
  let pauseMinutes = 0;
  if (resumeCarving && flaggedAt != null) {
    const pauseMs = Math.max(0, now - flaggedAt);
    pauseMinutes = Math.round(pauseMs / 60_000);
    // Postgres: loaded_at = loaded_at + pause_interval
    // Use an RPC-free approach by reading + writing per item (rare
    // case — usually 1-2 items on a 2-head). Keeps the migration
    // surface small (no new SQL function).
    const { data: items } = await admin
      .from("carving_items")
      .select("id, loaded_at")
      .eq("cnc_machine_id", machineId)
      .eq("status", "carving_in_progress");
    if (items && items.length > 0) {
      await Promise.all(
        items.map((row) => {
          const r = row as { id: string; loaded_at: string | null };
          if (!r.loaded_at) return Promise.resolve();
          const shifted = new Date(
            new Date(r.loaded_at).getTime() + pauseMs,
          ).toISOString();
          return admin
            .from("carving_items")
            .update({ loaded_at: shifted })
            .eq("id", r.id);
        }),
      );
    }
  }

  await admin
    .from("cnc_machines")
    .update({
      status: resumeCarving ? "carving" : "idle",
      maintenance_reason: null,
      maintenance_flagged_at: null,
      maintenance_flagged_by: null,
    })
    .eq("id", machineId);

  await admin.from("cnc_machine_events").insert({
    cnc_machine_id: machineId,
    event_type: "maintenance_end",
    user_id: profile.id,
    message: resumeCarving
      ? `paused ${pauseMinutes}m — slab timer resumed`
      : null,
  });
  await logAudit(profile.id, "cnc_maintenance_end", "cnc_machine", machineId, {
    resumed_carving: resumeCarving,
    pause_minutes: pauseMinutes,
  });

  refreshAll();
  redirect(
    resumeCarving
      ? `/vendor?toast=${encodeURIComponent(`Back online — slab timer resumed (was paused ${pauseMinutes}m)`)}`
      : "/vendor?toast=Machine+back+online",
  );
}

// ──────────────────────────────────────────────────────────────────
// Power cut — pause / resume EVERY machine of a vendor at once
// ──────────────────────────────────────────────────────────────────
// Daksh (June 2026) — when the plant loses power, every CNC stops at
// once. Rather than flag each machine individually, the vendor hits one
// button: every running/idle machine is pushed into the SAME
// maintenance-pause used per-machine (so loaded slabs' timers freeze),
// tagged with POWER_CUT_REASON. When power's back, one button resumes
// exactly those machines — shifting each loaded slab's loaded_at forward
// by the outage duration so its timer picks up where it stopped.
// Machines already under a genuine individual maintenance issue are left
// untouched (and won't be auto-resumed).

function canActOnVendorCockpit(
  profile: { role: string; vendor_id?: string | null; managed_vendor_ids?: string[] | null },
  vendorId: string,
): boolean {
  if (profile.role !== "vendor") return true; // staff act on any cockpit
  const managed = profile.managed_vendor_ids ?? [];
  return (
    !!profile.vendor_id &&
    (profile.vendor_id === vendorId || managed.includes(vendorId))
  );
}

export async function flagPowerCutAction(formData: FormData) {
  const { profile } = await requireAuth([
    "developer",
    "owner",
    "carving_head",
    "vendor",
    "senior_incharge",
  ]);
  const admin = createAdminSupabaseClient();

  const vendorId = txt(formData, "vendor_id");
  if (!vendorId) redirect("/vendor?toast=Missing+vendor");
  if (!canActOnVendorCockpit(profile, vendorId)) {
    redirect("/vendor?toast=Not+your+cockpit");
  }

  const now = new Date().toISOString();
  // Down every currently running or idle machine for this vendor.
  // Skip ones already in maintenance (real individual issue) + inactive.
  const { data: machines } = await admin
    .from("cnc_machines")
    .select("id")
    .eq("vendor_id", vendorId)
    .eq("is_active", true)
    .in("status", ["carving", "idle"]);
  const ids = ((machines ?? []) as Array<{ id: string }>).map((m) => m.id);
  if (ids.length === 0) {
    redirect("/vendor?toast=No+running+machines+to+pause");
  }

  await admin
    .from("cnc_machines")
    .update({
      status: "maintenance",
      maintenance_reason: POWER_CUT_REASON,
      maintenance_flagged_at: now,
      maintenance_flagged_by: profile.id,
    })
    .in("id", ids);

  await admin.from("cnc_machine_events").insert(
    ids.map((id) => ({
      cnc_machine_id: id,
      event_type: "maintenance_start",
      reason: "power_cut",
      message: "Power cut — all machines paused (slab timers paused)",
      user_id: profile.id,
    })),
  );
  await logAudit(profile.id, "cnc_power_cut_start", "vendor", vendorId, {
    machine_count: ids.length,
  });

  refreshAll();
  redirect(
    `/vendor?toast=${encodeURIComponent(
      `Power cut — ${ids.length} machine${ids.length === 1 ? "" : "s"} paused, slab timers paused`,
    )}`,
  );
}

export async function resolvePowerCutAction(formData: FormData) {
  const { profile } = await requireAuth([
    "developer",
    "owner",
    "carving_head",
    "vendor",
    "senior_incharge",
  ]);
  const admin = createAdminSupabaseClient();

  const vendorId = txt(formData, "vendor_id");
  if (!vendorId) redirect("/vendor?toast=Missing+vendor");
  if (!canActOnVendorCockpit(profile, vendorId)) {
    redirect("/vendor?toast=Not+your+cockpit");
  }

  const now = Date.now();
  // Resume ONLY the machines this power cut downed (tagged reason).
  const { data: machines } = await admin
    .from("cnc_machines")
    .select("id, current_carving_item_id, maintenance_flagged_at")
    .eq("vendor_id", vendorId)
    .eq("status", "maintenance")
    .eq("maintenance_reason", POWER_CUT_REASON);
  const rows = (machines ?? []) as Array<{
    id: string;
    current_carving_item_id: string | null;
    maintenance_flagged_at: string | null;
  }>;
  if (rows.length === 0) {
    redirect("/vendor?toast=No+power-cut+machines+to+resume");
  }

  let earliestFlagged: number | null = null;
  for (const m of rows) {
    const flaggedAt = m.maintenance_flagged_at
      ? new Date(m.maintenance_flagged_at).getTime()
      : null;
    if (
      flaggedAt != null &&
      (earliestFlagged == null || flaggedAt < earliestFlagged)
    ) {
      earliestFlagged = flaggedAt;
    }
    const resumeCarving = m.current_carving_item_id != null;
    if (resumeCarving && flaggedAt != null) {
      const pauseMs = Math.max(0, now - flaggedAt);
      // Shift each loaded slab's loaded_at forward by the outage so the
      // elapsed display resumes exactly where it stopped (same trick as
      // resolveMaintenanceAction; multi-head pairs caught via machine id).
      const { data: items } = await admin
        .from("carving_items")
        .select("id, loaded_at")
        .eq("cnc_machine_id", m.id)
        .eq("status", "carving_in_progress");
      if (items && items.length > 0) {
        await Promise.all(
          items.map((row) => {
            const r = row as { id: string; loaded_at: string | null };
            if (!r.loaded_at) return Promise.resolve();
            const shifted = new Date(
              new Date(r.loaded_at).getTime() + pauseMs,
            ).toISOString();
            return admin
              .from("carving_items")
              .update({ loaded_at: shifted })
              .eq("id", r.id);
          }),
        );
      }
    }
    await admin
      .from("cnc_machines")
      .update({
        status: resumeCarving ? "carving" : "idle",
        maintenance_reason: null,
        maintenance_flagged_at: null,
        maintenance_flagged_by: null,
      })
      .eq("id", m.id);
    await admin.from("cnc_machine_events").insert({
      cnc_machine_id: m.id,
      event_type: "maintenance_end",
      user_id: profile.id,
      message: "Power back — slab timer resumed",
    });
  }
  // Outage length for the log (future power-cut reporting). Audit rows
  // are the persistent power-cut log: cnc_power_cut_start (machine_count)
  // + cnc_power_cut_end (machine_count, outage_minutes), plus a
  // maintenance_start / maintenance_end event per machine.
  const outageMinutes =
    earliestFlagged != null
      ? Math.round((now - earliestFlagged) / 60_000)
      : null;
  await logAudit(profile.id, "cnc_power_cut_end", "vendor", vendorId, {
    machine_count: rows.length,
    outage_minutes: outageMinutes,
  });

  refreshAll();
  redirect(
    `/vendor?toast=${encodeURIComponent(
      `Power back — ${rows.length} machine${rows.length === 1 ? "" : "s"} resumed${
        outageMinutes != null ? ` (outage ${outageMinutes}m)` : ""
      }`,
    )}`,
  );
}

// ── Mig 080 — carving review storage helpers ───────────────────────
//
// Reason images for approve / rework / reject get uploaded into a
// private bucket. uploadReviewImage handles validation + upload;
// getSignedReviewMediaUrl mints a 5-min signed URL the modal can
// drop into an <img src>. Mirrors the messenger storage pattern
// (mig 078) so the two surfaces share an audit-able shape.

const REVIEW_BUCKET = "carving_review_media";
const REVIEW_IMAGE_MAX_BYTES = 5 * 1024 * 1024; // 5 MB — phone photos
const REVIEW_IMAGE_MIME_ALLOW = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

function reviewImageExt(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/heic") return "heic";
  if (mime === "image/heif") return "heif";
  return "jpg";
}

/** Validate + upload a review reason image. Returns the storage
 *  path or throws. The caller decides whether the upload is
 *  mandatory (rework + reject) or optional (approve). */
async function uploadReviewImage(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  jobId: string,
  reviewerId: string,
  file: File,
): Promise<string> {
  const mime = (file.type || "").toLowerCase();
  if (!REVIEW_IMAGE_MIME_ALLOW.has(mime)) {
    throw new Error("Unsupported image format (use JPG / PNG / WEBP / HEIC).");
  }
  if (file.size === 0) throw new Error("Image is empty.");
  if (file.size > REVIEW_IMAGE_MAX_BYTES) {
    throw new Error("Image too large (max 5 MB).");
  }
  const ext = reviewImageExt(mime);
  const path = `${reviewerId}/${jobId}-${crypto.randomUUID()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: uploadErr } = await admin.storage
    .from(REVIEW_BUCKET)
    .upload(path, buffer, {
      contentType: mime,
      cacheControl: "3600",
      upsert: false,
    });
  if (uploadErr) {
    throw new Error(`Image upload failed: ${uploadErr.message}`);
  }
  return path;
}

/** Mig 089 — collect up to 3 review photos from a FormData (keys
 *  review_image, review_image_2, review_image_3), validate + upload
 *  each, return the storage paths in order. Empty / missing slots are
 *  skipped. The caller decides whether ≥1 is mandatory. */
async function uploadReviewImages(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  jobId: string,
  reviewerId: string,
  formData: FormData,
): Promise<string[]> {
  const keys = ["review_image", "review_image_2", "review_image_3"];
  const paths: string[] = [];
  for (const k of keys) {
    const f = formData.get(k);
    if (f instanceof File && f.size > 0) {
      paths.push(await uploadReviewImage(admin, jobId, reviewerId, f));
      if (paths.length >= 3) break;
    }
  }
  return paths;
}

/** Sign a stored review image for the modal / cockpit cards.
 *  5-min freshness — the next router.refresh re-mints. Returns
 *  null on missing path or sign-failure so the UI can fall back
 *  to a "media unavailable" stub instead of crashing. */
export async function getSignedReviewMediaUrl(
  path: string,
): Promise<string | null> {
  // Anyone who can READ the table can read the image — the bucket
  // is private but the URL is signed + short-lived.
  await requireAuth();
  if (!path || typeof path !== "string") return null;
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.storage
    .from(REVIEW_BUCKET)
    .createSignedUrl(path, 300);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

// Mig 081 — preset quality flags the Approve dropdown can post.
// Anything else gets rejected as "invalid quality flag" so a
// future client typo doesn't quietly land a garbage value.
const APPROVE_QUALITY_FLAGS = new Set([
  "carving_not_good",
  "too_many_cracks",
  "color_variation",
  "minor_chips",
  "other",
]);

/**
 * Mig 145 — resolve a dispatch-station name from the approval form to a
 * dispatch_stations.id, creating it if brand-new (pick-or-create). Case-
 * insensitive find so duplicates collapse. Returns null when no name was
 * supplied. Non-fatal: never blocks an approval over station bookkeeping.
 */
async function resolveDispatchStationByName(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  name: string,
  userId: string,
): Promise<string | null> {
  const clean = (name ?? "").trim();
  if (!clean) return null;
  try {
    const { data: existing } = await admin
      .from("dispatch_stations")
      .select("id")
      .ilike("name", clean)
      .maybeSingle();
    if (existing) return (existing as { id: string }).id;
    const { data: created } = await admin
      .from("dispatch_stations")
      .insert({ name: clean, created_by: userId })
      .select("id")
      .maybeSingle();
    return created ? (created as { id: string }).id : null;
  } catch (e) {
    console.warn("[resolveDispatchStationByName] non-fatal", e);
    return null;
  }
}

/**
 * Mig 145 — active dispatch stations for the Carving-Done approval
 * picker. Fetched on mount by ApproveRejectForms so the list needn't be
 * threaded through the whole carving dashboard tree. Default station
 * sorts first so the form can pre-select it.
 */
export async function getDispatchStationsAction(): Promise<
  | { ok: true; stations: { id: string; name: string; is_default: boolean }[] }
  | { ok: false }
> {
  try {
    await requireAuth(["developer", "owner", "carving_head", "senior_incharge", "tender_manager"]);
    const admin = createAdminSupabaseClient();
    const { data } = await admin
      .from("dispatch_stations")
      .select("id, name, is_default")
      .eq("is_active", true)
      .order("is_default", { ascending: false })
      .order("name");
    return {
      ok: true,
      stations: (data ?? []) as { id: string; name: string; is_default: boolean }[],
    };
  } catch {
    return { ok: false };
  }
}

export async function approveCarvingJobAction(formData: FormData) {
  const { profile } = await requireAuth(["developer", "owner", "carving_head", "senior_incharge", "tender_manager"]);
  const admin = createAdminSupabaseClient();
  const jobId = txt(formData, "job_id");
  const notes = txt(formData, "notes") || null;
  // Mig 097 — "Depart": approve the slab (it goes to Carving Done) but
  // HOLD it out of dispatch because it needs a finishing touch first.
  // Photo + note are mandatory when departing (validated after the photo
  // upload below). Applies to both CNC + Outsource.
  const depart = txt(formData, "depart") === "1";
  // Mig 088 — the reviewer can confirm / correct carved sides (1 or 2)
  // at approval, right before it counts in costing. Only an explicit
  // "1"/"2" changes the column — absence leaves whatever was set at
  // assign untouched (so other approve callers don't reset it).
  const sidesRaw = txt(formData, "carving_sides");
  const carvingSidesUpdate: { carving_sides?: number } =
    sidesRaw === "2" ? { carving_sides: 2 } : sidesRaw === "1" ? { carving_sides: 1 } : {};
  // Mig 081 — structured quality flag. Optional (NULL = reviewer
  // didn't pick anything, slab was fine). When 'other' is selected
  // the freeform notes textarea is shown + the typed text rides in
  // on the existing `notes` field. For any of the 4 preset flags
  // the notes field is suppressed in the UI; if a stale client
  // still posts notes alongside a preset we accept both so the
  // round-trip is lossless.
  const qualityFlagRaw = txt(formData, "quality_flag");
  let qualityFlag: string | null = null;
  if (qualityFlagRaw) {
    if (!APPROVE_QUALITY_FLAGS.has(qualityFlagRaw)) {
      const msg = `Invalid quality flag: ${qualityFlagRaw}`;
      const stay = txt(formData, "stay") === "1";
      if (stay) throw new Error(msg);
      redirect(`/carving/${jobId}?toast=${encodeURIComponent(msg)}`);
    }
    qualityFlag = qualityFlagRaw;
  }
  // "Other" selected but no notes typed → fail. Otherwise the
  // analytics row would be tagged 'other' with no detail (useless).
  if (qualityFlag === "other" && !notes) {
    const msg = "Please describe the issue when selecting 'Other'.";
    const stay = txt(formData, "stay") === "1";
    if (stay) throw new Error(msg);
    redirect(`/carving/${jobId}?toast=${encodeURIComponent(msg)}`);
  }
  // Mig 080/089 — optional photo upload on approve (mandatory on the
  // rework + reject paths; see below). Up to 3 photos. Upload before we
  // write the row so the DB always points at real storage objects.
  let reviewImagePaths: string[] = [];
  try {
    reviewImagePaths = await uploadReviewImages(admin, jobId, profile.id, formData);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const stay = txt(formData, "stay") === "1";
    if (stay) throw new Error(msg);
    redirect(`/carving/${jobId}?toast=${encodeURIComponent(msg)}`);
  }
  // First photo also lands in the legacy single column so every surface
  // that still reads review_image_path keeps showing photo #1.
  const reviewImagePath: string | null = reviewImagePaths[0] ?? null;
  // Mig 097 — Depart requires a photo + a note (the proof of what still
  // needs doing). Reuses the approval photo, so just check we have one.
  if (depart) {
    const stayD = txt(formData, "stay") === "1";
    if (reviewImagePaths.length === 0) {
      const msg = "A photo is required when marking Depart.";
      if (stayD) throw new Error(msg);
      redirect(`/carving/${jobId}?toast=${encodeURIComponent(msg)}`);
    }
    if (!notes) {
      const msg = "A note is required when marking Depart.";
      if (stayD) throw new Error(msg);
      redirect(`/carving/${jobId}?toast=${encodeURIComponent(msg)}`);
    }
  }
  // When the action is called from the JobDetailPeek modal we don't
  // want to redirect — the modal closes itself + parent revalidates
  // in place. Set `stay=1` from the form to opt out of the redirect.
  const stay = txt(formData, "stay") === "1";

  if (!jobId) {
    if (stay) return;
    redirect("/carving?toast=Missing+job+id");
  }

  // Use select("*") + maybeSingle so a stale prod schema (missing
  // optional columns like temporary_location) doesn't make the
  // whole row come back as null — that bug would surface as a
  // misleading "Job not found" toast. Surface the real Supabase
  // error if any so we can debug schema drift.
  const { data: job, error: readErr } = await admin
    .from("carving_items")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();

  if (readErr) {
    if (stay) throw new Error(`Approve failed: ${readErr.message}`);
    redirect(`/carving?toast=${encodeURIComponent(`Approve failed: ${readErr.message}`)}`);
  }
  if (!job) {
    if (stay) throw new Error(`Job not found (id ${jobId.slice(0, 8)}…)`);
    redirect(`/carving?toast=Job+not+found+(id+${encodeURIComponent(jobId.slice(0, 8))}…)`);
  }
  const j = job as {
    id: string;
    slab_requirement_id: string;
    completed_at: string | null;
    temporary_location?: string | null;
    location?: string | null;
  };
  if (!j.completed_at) {
    if (stay) throw new Error("Vendor hasn't marked it complete yet");
    redirect(`/carving/${jobId}?toast=Vendor+hasn%27t+marked+it+complete+yet`);
  }

  // Phase 3 simplification: approval now auto-marks the slab as
  // ready-for-dispatch using the vendor's temporary_location (set
  // when they unloaded). The "enter a location and click Ready to
  // Dispatch" intermediate step is gone — Carving Done items appear
  // in the Dispatch Station's Ready tab immediately.
  const now = new Date().toISOString();
  const finalLocation = j.temporary_location ?? j.location ?? "Carving area";

  // Mig 145 — dispatch station the reviewer routed this slab to, and
  // whether they SELF-TRANSFERRED. Self-transfer bypasses the carving→
  // dispatch runner: we stamp received_at_dispatch_at now so the slab is
  // immediately clickable on the Dispatch board. A normal approval
  // leaves received_at_dispatch_at NULL until the transfer person brings
  // it in (Phase 5 gate).
  const dispatchStationId = await resolveDispatchStationByName(
    admin,
    txt(formData, "dispatch_station_name"),
    profile.id,
  );
  const selfTransfer = txt(formData, "self_transfer") === "1";

  // Surface the actual error if the update fails (could be a
  // missing column on prod schema if migration 014 wasn't run).
  const { error: updateErr } = await admin
    .from("carving_items")
    .update({
      review_approved_at: now,
      review_approved_by: profile.id,
      review_notes: notes,
      // Mig 080 — tag the action explicitly. Old approvals (pre-080)
      // stay at NULL on this field; new ones are stamped 'approved'
      // so analytics can tell apart "I clicked approve" from "this
      // row's status happens to be 'completed' for other reasons."
      review_decision: "approved",
      review_image_path: reviewImagePath,
      review_image_paths: reviewImagePaths.length ? reviewImagePaths : null,
      // Mig 081 — structured quality flag (NULL or one of the five
      // values whitelisted above). The reviewer's drop-down maps
      // 1:1 to these keys; analytics will GROUP BY this column to
      // surface vendor mistake patterns.
      review_quality_flag: qualityFlag,
      // Mig 097 — Depart: still approved (review_approved_at set above) but
      // flagged so the Carving Done card shows it apart + Dispatch holds it.
      // Only written when departing so a normal approve never references
      // the new columns (safe if the migration runs a little after deploy).
      ...(depart ? { depart_flag: true, depart_note: notes, depart_at: now, depart_by: profile.id } : {}),
      // Mig 088 — confirm/correct carved sides at approval (only when
      // the form explicitly posted 1 or 2; otherwise untouched).
      ...carvingSidesUpdate,
      status: "completed",
      location: finalLocation,
      ready_to_dispatch_at: now,
      ready_to_dispatch_by: profile.id,
      // Mig 145 — dispatch routing + (optional) instant self-transfer.
      // Only reference the new columns when we actually have a value, so
      // an approve that runs a little BEFORE the migration (or from a
      // surface that doesn't send these fields) never touches them — same
      // safety posture as the depart columns above.
      ...(dispatchStationId ? { dispatch_station_id: dispatchStationId } : {}),
      // Daksh (Jun 2026) — carving→dispatch transfer removed: every approval
      // marks the slab received at dispatch NOW, so it is immediately
      // selectable on the Dispatch board (no bring-in step). mig 145 columns
      // exist in prod, so writing them unconditionally is safe.
      received_at_dispatch_at: now,
      received_at_dispatch_by: profile.id,
      ...(selfTransfer ? { dispatch_self_transfer: true } : {}),
    })
    .eq("id", jobId);
  if (updateErr) {
    if (stay) throw new Error(`Approve failed: ${updateErr.message}`);
    redirect(`/carving?toast=${encodeURIComponent(`Approve failed: ${updateErr.message}`)}`);
  }

  // Flip the slab to 'completed' so it surfaces in the Dispatch
  // Station "Ready" tab. Soft-fail here — slab might already be
  // 'completed' or may have been deleted; we don't want to undo the
  // approve we just wrote.
  if (j.slab_requirement_id) {
    await admin
      .from("slab_requirements")
      // Mig 097 — dispatch_hold mirrors depart so the Dispatch page can
      // sort departed slabs into a "Needs work" section, out of Make Dispatch.
      // Set only when departing (keeps a normal approve off the new column).
      .update({ status: "completed", ...(depart ? { dispatch_hold: true } : {}), updated_by: profile.id, updated_at: now })
      .eq("id", j.slab_requirement_id);
  }

  // Mig 081 — human-readable label for the quality flag, used in
  // both the event timeline string + the audit log payload. Maps
  // the column key back to the dropdown's display label so the
  // event log reads naturally instead of in machine-speak.
  const QUALITY_FLAG_LABEL: Record<string, string> = {
    carving_not_good: "carving quality not great",
    too_many_cracks: "too many cracks",
    color_variation: "color variation",
    minor_chips: "minor chips / rough edges",
    other: "other",
  };
  const qualityLabel = qualityFlag ? QUALITY_FLAG_LABEL[qualityFlag] : null;
  const eventDetail = [
    `Approved + ready for dispatch · ${finalLocation}`,
    qualityLabel ? `flag: ${qualityLabel}` : null,
    notes ? `note: ${notes}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  await recordEvent(jobId, "approved", profile.id, eventDetail);
  await logAudit(profile.id, "carving_approved", "carving_item", jobId, {
    slab_id: j.slab_requirement_id,
    location: finalLocation,
    quality_flag: qualityFlag,
    quality_label: qualityLabel,
  });

  refreshAll();
  if (stay) return;
  redirect(`/carving/${jobId}?toast=Approved+%E2%80%94+ready+for+dispatch`);
}

// ── Outsource "Still Pending Work" (Mig 097) ────────────────────────
// Replaces Rework + Reject for Outsource on Carving Done Approval. The
// slab stays RECEIVED (completed_at set, review_approved_at NULL) but
// leaves the approval queue into the vendor-wise "Still Pending Work"
// tab. The vendor reworks; backToApprovalAction returns it for approval.
export async function stillPendingWorkAction(formData: FormData) {
  const { profile } = await requireAuth(["developer", "owner", "carving_head", "senior_incharge", "tender_manager"]);
  const admin = createAdminSupabaseClient();
  const jobId = txt(formData, "job_id");
  const note = txt(formData, "notes") || null;
  const stay = txt(formData, "stay") === "1";
  if (!jobId) {
    if (stay) return;
    redirect("/carving?toast=Missing+job+id");
  }

  // Optional photo(s) — reuse the review-image uploader.
  let imgs: string[] = [];
  try {
    imgs = await uploadReviewImages(admin, jobId, profile.id, formData);
  } catch {
    /* photo optional here — ignore upload errors */
  }

  const { data: jobRow } = await admin
    .from("carving_items")
    .select("id, vendor_type, vendor_name, completed_at, review_approved_at")
    .eq("id", jobId)
    .maybeSingle();
  const job = jobRow as {
    vendor_type: string;
    vendor_name: string;
    completed_at: string | null;
    review_approved_at: string | null;
  } | null;
  if (!job) {
    if (stay) throw new Error("Job not found");
    redirect("/carving?toast=Job+not+found");
  }
  if (job!.vendor_type !== "Outsource") {
    if (stay) throw new Error("Still Pending Work is for Outsource jobs only");
    redirect(`/carving/${jobId}?toast=Outsource+only`);
  }
  if (!job!.completed_at || job!.review_approved_at) {
    if (stay) throw new Error("Job is not awaiting approval");
    redirect(`/carving/${jobId}?toast=Not+awaiting+approval`);
  }

  const now = new Date().toISOString();
  await admin
    .from("carving_items")
    .update({
      pending_work_at: now,
      pending_work_by: profile.id,
      pending_work_note: note,
      ...(imgs.length ? { review_image_paths: imgs, review_image_path: imgs[0] } : {}),
    })
    .eq("id", jobId);
  await recordEvent(jobId, "pending_work", profile.id, `Still pending work${note ? ` · ${note}` : ""}`);
  await logAudit(profile.id, "carving_pending_work", "carving_item", jobId, { note });

  refreshAll();
  if (stay) return;
  redirect("/carving?tab=pending&mode=outsource&toast=Moved+to+Still+Pending+Work");
}

// Clears the pending-work flag → the slab returns to Carving Done
// Approval so it can be approved after the vendor's rework. (Mig 097)
export async function backToApprovalAction(formData: FormData) {
  const { profile } = await requireAuth(["developer", "owner", "carving_head", "senior_incharge", "tender_manager"]);
  const admin = createAdminSupabaseClient();
  const jobId = txt(formData, "job_id");
  if (!jobId) redirect("/carving?toast=Missing+job+id");
  await admin
    .from("carving_items")
    .update({ pending_work_at: null })
    .eq("id", jobId)
    .is("review_approved_at", null);
  await recordEvent(jobId, "pending_work_cleared", profile.id, "Back to approval");
  await logAudit(profile.id, "carving_pending_work_cleared", "carving_item", jobId, {});
  refreshAll();
  redirect("/carving?tab=review&mode=outsource&toast=Back+to+approval");
}

export async function markReadyToDispatchAction(formData: FormData) {
  const { profile } = await requireAuth(["developer", "owner", "carving_head", "senior_incharge", "tender_manager"]);
  const admin = createAdminSupabaseClient();
  const jobId = txt(formData, "job_id");
  const location = txt(formData, "location");

  if (!jobId) redirect("/carving?toast=Missing+job+id");
  if (!location) redirect(`/carving/${jobId}?toast=Location+is+required+before+marking+ready+to+dispatch`);

  const { data: job } = await admin
    .from("carving_items")
    .select("id, slab_requirement_id, review_approved_at, ready_to_dispatch_at")
    .eq("id", jobId)
    .single();

  if (!job) redirect("/carving?toast=Job+not+found");
  if (!job.review_approved_at) {
    redirect(`/carving/${jobId}?toast=Approve+the+job+first`);
  }
  if (job.ready_to_dispatch_at) {
    // Idempotent: just update the location and bail.
    await admin.from("carving_items").update({ location }).eq("id", jobId);
    refreshAll();
    redirect(`/carving/${jobId}?toast=Location+updated`);
  }

  const now = new Date().toISOString();

  // Atomic side-effects:
  //   1. carving_items: location + ready_to_dispatch_at + ready_to_dispatch_by
  //   2. slab_requirements.status='completed' so it appears in Dispatch Station
  await admin
    .from("carving_items")
    .update({
      location,
      ready_to_dispatch_at: now,
      ready_to_dispatch_by: profile.id,
    })
    .eq("id", jobId);

  await admin
    .from("slab_requirements")
    .update({ status: "completed", updated_by: profile.id, updated_at: now })
    .eq("id", job.slab_requirement_id);

  await recordEvent(jobId, "ready_to_dispatch", profile.id, `Ready for dispatch · location: ${location}`);
  await logAudit(profile.id, "carving_ready_to_dispatch", "carving_item", jobId, {
    slab_id: job.slab_requirement_id,
    location,
  });

  refreshAll();
  redirect(`/carving/${jobId}?toast=Ready+to+dispatch+%E2%80%94+visible+in+Dispatch+Station`);
}

export async function updateCarvingLocationAction(formData: FormData) {
  const { profile } = await requireAuth(["developer", "owner", "carving_head", "senior_incharge", "tender_manager"]);
  const admin = createAdminSupabaseClient();
  const jobId = txt(formData, "job_id");
  const location = txt(formData, "location");

  if (!jobId) redirect("/carving?toast=Missing+job+id");

  await admin.from("carving_items").update({ location: location || null }).eq("id", jobId);
  await recordEvent(jobId, "location_updated", profile.id, `Location set to: ${location || "(cleared)"}`);
  await logAudit(profile.id, "carving_location_updated", "carving_item", jobId, { location });

  refreshAll();
  redirect(`/carving/${jobId}?toast=Location+saved`);
}

// ── Mig 080 — Rework Needed (NEW, replaces the old soft "reject") ─
//
// Daksh's three-outcome split: between Approve (everything's fine)
// and Reject (this carving is unsalvageable) sits Rework Needed —
// "fix this, then re-submit." Image + reason are MANDATORY (you're
// telling the vendor what to fix; "do it better" isn't actionable).
//
// State machine on the carving_item:
//   completed_at        → cleared (vendor must re-mark complete)
//   status              → 'carving_in_progress' (back on the floor)
//   review_decision     → 'rework_needed'
//   review_reworked_at  → now (distinguishes from pre-080 rejects)
//   review_reworked_by  → profile.id
//   review_image_path   → uploaded photo
//   review_notes        → reason text
//   review_approved_at  → cleared (the carving_in_progress check on
//                         load expects no prior approval)
//
// Vendor cockpit gets a new "Rework Pending" window that filters
// on review_reworked_at + review_decision so old-style soft rejects
// don't accidentally show up here.
export async function reworkCarvingJobAction(formData: FormData) {
  const { profile } = await requireAuth(["developer", "owner", "carving_head", "senior_incharge", "tender_manager"]);
  const admin = createAdminSupabaseClient();
  const jobId = txt(formData, "job_id");
  const notes = txt(formData, "notes").trim();
  const stay = txt(formData, "stay") === "1";

  if (!jobId || !notes) {
    const msg = "Rework reason is required.";
    if (stay) throw new Error(msg);
    redirect(`/carving/${jobId}?toast=${encodeURIComponent(msg)}`);
  }
  // Mandatory photo(s) for Rework — up to 3 (mig 089).
  let reviewImagePaths: string[] = [];
  try {
    reviewImagePaths = await uploadReviewImages(admin, jobId, profile.id, formData);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (stay) throw new Error(msg);
    redirect(`/carving/${jobId}?toast=${encodeURIComponent(msg)}`);
  }
  if (reviewImagePaths.length === 0) {
    const msg = "Photo of the problem is required for Rework.";
    if (stay) throw new Error(msg);
    redirect(`/carving/${jobId}?toast=${encodeURIComponent(msg)}`);
  }
  const reviewImagePath = reviewImagePaths[0];

  const now = new Date().toISOString();
  const { error: updateErr } = await admin
    .from("carving_items")
    .update({
      completed_at: null,
      review_notes: notes,
      review_decision: "rework_needed",
      review_reworked_at: now,
      review_reworked_by: profile.id,
      review_image_path: reviewImagePath,
      review_image_paths: reviewImagePaths,
      // Clear any prior approval flags so the load-time guard
      // doesn't think this slab has already been signed off.
      review_approved_at: null,
      review_approved_by: null,
      // Mig 080 — drop status back to carving_assigned (NOT
      // carving_in_progress) so the existing loadSlabOnMachineAction
      // accepts it without a special-case branch — that action
      // requires status='carving_assigned' + cnc_machine_id IS NULL
      // (line 1226). The review_decision='rework_needed' tag +
      // review_reworked_at timestamp are what mark this slab as
      // rework so the vendor cockpit can route it into the Rework
      // Pending tray instead of the regular Ready-to-load queue.
      // cnc_machine_id was already cleared by completeAndUnloadAction
      // before review, so we don't have to touch it here.
      status: "carving_assigned",
    })
    .eq("id", jobId);
  if (updateErr) {
    const msg = `Rework save failed: ${updateErr.message}`;
    if (stay) throw new Error(msg);
    redirect(`/carving/${jobId}?toast=${encodeURIComponent(msg)}`);
  }

  await recordEvent(jobId, "rework_needed", profile.id, notes);
  await logAudit(profile.id, "carving_rework_needed", "carving_item", jobId, {
    notes,
    image_path: reviewImagePath,
  });

  refreshAll();
  if (stay) return;
  redirect(`/carving/${jobId}?toast=${encodeURIComponent("Rework requested — sent back to vendor")}`);
}

// ── Mig 080 — Reject (NEW, hard version, replaces the old soft one) ─
//
// "This carving cannot be salvaged." The slab leaves the active
// loop entirely:
//   status → 'carving_rejected' (new enum value, mig 080)
//   review_decision → 'rejected'
//   review_rejected_at + by → stamped
//   review_image_path → mandatory
//   review_notes → mandatory
//
// The /vendor cockpit gets a read-only "Rejected" window. The
// owner / dev / carving_head / senior_incharge get a "Carving
// Rejected" tasks badge so the rare-but-critical events surface
// at the top of the app.
//
// The CLIENT enforces two-step confirmation (Daksh's spec —
// "reject is very hard in our operation, we try to use it
// anyhow"). The server doesn't double-confirm; that's purely UX.
// But the server-side image + reason requirements ensure no
// half-completed reject ever lands.
//
// Old pre-080 callers that hit this action without an image will
// fail with a clear error rather than silently degrading to the
// pre-080 soft-reject behaviour. If we want to allow the legacy
// shape in a future migration we can add a back-compat fallback,
// but for now Daksh's spec is "image is mandatory" and we honor it.
export async function rejectCarvingJobAction(formData: FormData) {
  const { profile } = await requireAuth(["developer", "owner", "carving_head", "senior_incharge", "tender_manager"]);
  const admin = createAdminSupabaseClient();
  const jobId = txt(formData, "job_id");
  const notes = txt(formData, "notes").trim();
  const stay = txt(formData, "stay") === "1";

  if (!jobId || !notes) {
    const msg = "Rejection reason is required.";
    if (stay) throw new Error(msg);
    redirect(`/carving/${jobId}?toast=${encodeURIComponent(msg)}`);
  }
  // Mandatory photo(s) for Reject — up to 3 (mig 089).
  let reviewImagePaths: string[] = [];
  try {
    reviewImagePaths = await uploadReviewImages(admin, jobId, profile.id, formData);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (stay) throw new Error(msg);
    redirect(`/carving/${jobId}?toast=${encodeURIComponent(msg)}`);
  }
  if (reviewImagePaths.length === 0) {
    const msg = "Photo of the problem is required for Reject.";
    if (stay) throw new Error(msg);
    redirect(`/carving/${jobId}?toast=${encodeURIComponent(msg)}`);
  }
  const reviewImagePath = reviewImagePaths[0];

  // Need the slab_requirement_id so we can flip the source slab's
  // status too — the slab is out of the carving loop entirely.
  const { data: jobRow } = await admin
    .from("carving_items")
    .select("slab_requirement_id")
    .eq("id", jobId)
    .maybeSingle();

  const now = new Date().toISOString();
  const { error: updateErr } = await admin
    .from("carving_items")
    .update({
      completed_at: null,
      review_notes: notes,
      review_decision: "rejected",
      review_rejected_at: now,
      review_rejected_by: profile.id,
      review_image_path: reviewImagePath,
      review_image_paths: reviewImagePaths,
      // A rejected job's prior approval flags should NOT persist —
      // the row is fully out of the active loop.
      review_approved_at: null,
      review_approved_by: null,
      status: "carving_rejected",
    })
    .eq("id", jobId);
  if (updateErr) {
    const msg = `Reject save failed: ${updateErr.message}`;
    if (stay) throw new Error(msg);
    redirect(`/carving/${jobId}?toast=${encodeURIComponent(msg)}`);
  }

  // Also flip the source slab's status so it doesn't keep showing
  // up in the Ready Sizes / Carving Jobs Active boards.
  if (jobRow?.slab_requirement_id) {
    await admin
      .from("slab_requirements")
      .update({
        status: "carving_rejected",
        updated_by: profile.id,
        updated_at: now,
      })
      .eq("id", jobRow.slab_requirement_id);
  }

  await recordEvent(jobId, "rejected", profile.id, notes);
  await logAudit(profile.id, "carving_rejected", "carving_item", jobId, {
    notes,
    image_path: reviewImagePath,
  });

  refreshAll();
  if (stay) return;
  redirect(`/carving/${jobId}?toast=${encodeURIComponent("Rejected — slab is out of the carving loop")}`);
}

// dispatchCarvingJobAction was removed — carved slabs now flow through
// markReadyToDispatchAction (above) and then through the Dispatch
// Station instead of being one-click-dispatched from the carving
// detail page. See migration 014 for the schema change.

export async function cancelCarvingJobAction(formData: FormData) {
  const { profile } = await requireAuth(["developer", "owner", "carving_head", "senior_incharge", "tender_manager"]);
  const admin = createAdminSupabaseClient();
  const jobId = txt(formData, "job_id");

  const { data: job } = await admin
    .from("carving_items")
    .select("id, slab_requirement_id")
    .eq("id", jobId)
    .single();

  if (!job) redirect("/carving?toast=Job+not+found");

  await recordEvent(jobId, "cancelled", profile.id, "Assignment cancelled by team");
  await admin.from("carving_items").delete().eq("id", jobId);
  await admin
    .from("slab_requirements")
    .update({ status: "cut_done", updated_by: profile.id, updated_at: new Date().toISOString() })
    .eq("id", job.slab_requirement_id);

  await logAudit(profile.id, "carving_cancelled", "carving_item", jobId, { slab_id: job.slab_requirement_id });

  refreshAll();
  redirect("/carving?toast=Assignment+cancelled");
}

// ── Migration 023 + 025: receipt acknowledgement ───────────────────
//
// Anyone in the chain can mark a slab as physically received at the
// vendor's shade:
//   - slab_transfer role (PRIMARY — they're the runner doing the
//     physical move and they capture an optional dropoff_note saying
//     exactly where they left the slab).
//   - carving_head (fallback when transfer person isn't around).
//   - vendor operator (fallback when transfer person isn't around).
//   - owner / developer (oversight).
//
// Clears the claim_by lock if one was set (migration 025) — once
// delivered, the slab is no longer "in transit, claimed by X".
//
// No-op if already received. CNC vendors only.
export async function acknowledgeReceiptAction(formData: FormData) {
  const { profile } = await requireAuth([
    "developer",
    "owner",
    "carving_head",
    "senior_incharge",
    "vendor",
    "slab_transfer",
    // Mig 083 — storekeeper is the same human as the slab-transfer
    // runner today (Daksh's call), so they share every auth gate.
    "storekeeper",
    "senior_incharge",
  ]);
  const admin = createAdminSupabaseClient();

  const carvingItemId = txt(formData, "carving_item_id");
  const dropoffNote = txt(formData, "dropoff_note") || null;
  const redirectTo = txt(formData, "redirect_to") || "/carving";

  if (!carvingItemId) redirect(`${redirectTo}?toast=Missing+job+id`);

  const { data: ci } = await admin
    .from("carving_items")
    .select(
      "id, slab_requirement_id, vendor_id, vendor_type, vendor_name, status, received_at_vendor_at, claimed_by",
    )
    .eq("id", carvingItemId)
    .maybeSingle();
  if (!ci) redirect(`${redirectTo}?toast=Job+not+found`);
  const item = ci as {
    id: string;
    slab_requirement_id: string;
    vendor_id: string;
    vendor_type: string;
    vendor_name: string;
    status: string;
    received_at_vendor_at: string | null;
    claimed_by: string | null;
  };

  // Daksh (Jun 2026) — receipt now handles BOTH CNC and Outsource. (Outsource
  // routes through the transfer too; on receipt it auto-starts — see below.)
  if (item.received_at_vendor_at) {
    redirect(`${redirectTo}?toast=Already+marked+received`);
  }
  // Vendor role: must own the job.
  if (profile.role === "vendor") {
    if (!profile.vendor_id || profile.vendor_id !== item.vendor_id) {
      redirect(`${redirectTo}?toast=Not+your+job+to+acknowledge`);
    }
  }
  // slab_transfer role: if the slab is claimed by someone ELSE,
  // refuse — they need to coordinate with the claimant.
  if ((profile.role === "slab_transfer" || profile.role === "storekeeper") && item.claimed_by && item.claimed_by !== profile.id) {
    redirect(`${redirectTo}?toast=Claimed+by+another+runner`);
  }

  const now = new Date().toISOString();
  // Outsource auto-starts on arrival (no separate load step) → in_progress
  // + loaded. CNC stays carving_assigned ("Ready to load") until the vendor
  // loads it on a machine.
  const isOutsourceReceipt = item.vendor_type === "Outsource";
  await admin
    .from("carving_items")
    .update({
      received_at_vendor_at: now,
      received_at_vendor_by: profile.id,
      // Clear the claim so the row drops out of the "claimed by me" list.
      claimed_by: null,
      claimed_at: null,
      claim_batch_id: null,
      ...(isOutsourceReceipt ? { status: "carving_in_progress", loaded_at: now, loaded_by: profile.id } : {}),
      // Only overwrite dropoff_note if the form supplied one — don't
      // wipe a previously-set note.
      ...(dropoffNote ? { dropoff_note: dropoffNote } : {}),
    })
    .eq("id", carvingItemId)
    .is("received_at_vendor_at", null);
  if (isOutsourceReceipt) {
    await admin
      .from("slab_requirements")
      .update({ status: "carving_in_progress", updated_by: profile.id, updated_at: now })
      .eq("id", item.slab_requirement_id);
  }

  const noteSuffix = dropoffNote ? ` · left at ${dropoffNote}` : "";
  await recordEvent(
    carvingItemId,
    "received_at_vendor",
    profile.id,
    `Received at ${item.vendor_name}${noteSuffix}`,
  );
  await logAudit(profile.id, "carving_received_at_vendor", "carving_item", carvingItemId, {
    vendor_id: item.vendor_id,
    dropoff_note: dropoffNote,
  });

  refreshAll();
  redirect(`${redirectTo}?toast=Marked+received`);
}

// ── Migration 025: claim / unclaim a slab for transfer ─────────────
//
// Slab transfer runners "claim" a slab before picking it up so two
// runners don't both grab the same one. The claim is cleared
// automatically when the delivery is marked.
//
// Anyone with the slab_transfer role can claim. Carving head + owner +
// developer can also claim (and can unclaim someone else's grab if
// they need to redirect — useful when a runner goes off shift).
/**
 * Mig 144 (Jun 2026, choose-only) — resolve a truck name from the form to
 * a trucks.id. Trucks are managed in Settings now, so this only FINDS an
 * existing one (case-insensitive); it NEVER creates a truck. An
 * unrecognised name resolves to null (claim_truck_id stays empty) — the
 * pickers only offer existing trucks, so this is just a safety net.
 */
async function resolveTruckByName(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  name: string,
  _userId: string,
): Promise<string | null> {
  const clean = (name ?? "").trim();
  if (!clean) return null;
  try {
    const { data: existing } = await admin
      .from("trucks")
      .select("id")
      .ilike("name", clean)
      .maybeSingle();
    return existing ? (existing as { id: string }).id : null;
  } catch (e) {
    console.warn("[resolveTruckByName] non-fatal", e);
    return null;
  }
}

export async function claimSlabTransferAction(formData: FormData) {
  const { profile } = await requireAuth([
    "developer",
    "owner",
    "carving_head",
    "slab_transfer",
    // Mig 083 — storekeeper is the same human as the slab-transfer
    // runner today (Daksh's call), so they share every auth gate.
    "storekeeper",
    "senior_incharge",
  ]);
  const admin = createAdminSupabaseClient();

  const carvingItemId = txt(formData, "carving_item_id");
  const redirectTo = txt(formData, "redirect_to") || "/carving/transfer";
  if (!carvingItemId) redirect(`${redirectTo}?toast=Missing+job+id`);

  const { data: ci } = await admin
    .from("carving_items")
    .select("id, status, received_at_vendor_at, claimed_by")
    .eq("id", carvingItemId)
    .maybeSingle();
  if (!ci) redirect(`${redirectTo}?toast=Job+not+found`);
  const item = ci as {
    id: string;
    status: string;
    received_at_vendor_at: string | null;
    claimed_by: string | null;
  };

  if (item.received_at_vendor_at) {
    redirect(`${redirectTo}?toast=Already+delivered`);
  }
  if (item.status !== "carving_assigned") {
    redirect(`${redirectTo}?toast=Not+in+transfer+queue`);
  }
  if (item.claimed_by && item.claimed_by !== profile.id) {
    redirect(`${redirectTo}?toast=Already+claimed`);
  }

  // One-active-claim limit (real-world: the runner operates a crane,
  // grabs one slab, drives it to the shade, comes back for the next).
  // Reject if this user already has any other slab claimed and not
  // yet delivered. Carving_head + owner + developer are also subject
  // to this — they shouldn't be hoarding claims either.
  const { data: existingClaim } = await admin
    .from("carving_items")
    .select("id")
    .eq("claimed_by", profile.id)
    .is("received_at_vendor_at", null)
    .neq("id", carvingItemId)
    .limit(1)
    .maybeSingle();
  if (existingClaim) {
    redirect(
      `${redirectTo}?toast=${encodeURIComponent(
        "You already have a slab claimed. Deliver or release it first.",
      )}`,
    );
  }

  const now = new Date().toISOString();
  // Mig 065 — stamp a fresh claim_batch_id even for single-slab
  // claims so the "Claimed by me" UI groups all rows by batch
  // uniformly. A single-slab claim renders as a group of one.
  const claimBatchId = crypto.randomUUID();
  // Mig 144 — which truck carries this claim (pick-or-create on the form).
  const claimTruckId = await resolveTruckByName(admin, txt(formData, "truck_name"), profile.id);
  // Race-guard: only claim if still unclaimed. Whoever wins the race
  // gets the lock; the loser sees "Already claimed" on the next view.
  const { data: updated } = await admin
    .from("carving_items")
    .update({ claimed_by: profile.id, claimed_at: now, claim_batch_id: claimBatchId, claim_truck_id: claimTruckId })
    .eq("id", carvingItemId)
    .is("claimed_by", null)
    .select("id");

  if (!updated?.length && item.claimed_by !== profile.id) {
    redirect(`${redirectTo}?toast=Already+claimed`);
  }

  await recordEvent(carvingItemId, "transfer_claimed", profile.id, "Claimed for transfer");
  await logAudit(profile.id, "transfer_claimed", "carving_item", carvingItemId, {});

  refreshAll();
  redirect(`${redirectTo}?toast=Claimed`);
}

// Mig 065 — Slab Transfer batch claim. The runner now drives a
// truck and picks up to 10 slabs at once. This action accepts a
// JSON array of carving_item_ids, validates the cap, applies the
// same one-active-batch rule (you can't open a new batch while
// you have any active claims), and stamps every claimed row with
// a shared claim_batch_id so the "Claimed by me" UI groups them
// together as one truck-load.
export async function claimSlabTransferBatchAction(formData: FormData) {
  const { profile } = await requireAuth([
    "developer",
    "owner",
    "carving_head",
    "slab_transfer",
    // Mig 083 — storekeeper is the same human as the slab-transfer
    // runner today (Daksh's call), so they share every auth gate.
    "storekeeper",
    "senior_incharge",
  ]);
  const admin = createAdminSupabaseClient();

  const redirectTo = txt(formData, "redirect_to") || "/carving/transfer";

  // Parse the ids
  let ids: string[] = [];
  const raw = txt(formData, "carving_item_ids");
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) ids = parsed.map((x) => String(x)).filter(Boolean);
    } catch {
      redirect(`${redirectTo}?toast=Bad+payload`);
    }
  }
  if (ids.length === 0) {
    redirect(`${redirectTo}?toast=No+slabs+selected`);
  }
  // Hard cap per Daksh's truck-load size.
  if (ids.length > 10) {
    redirect(`${redirectTo}?toast=${encodeURIComponent("Max 10 slabs per claim batch.")}`);
  }

  // One-active-batch rule: the runner can't open a new batch while
  // they have ANY undelivered claim. They must deliver or release
  // the current batch first.
  const { data: existing } = await admin
    .from("carving_items")
    .select("id")
    .eq("claimed_by", profile.id)
    .is("received_at_vendor_at", null)
    .limit(1)
    .maybeSingle();
  if (existing) {
    redirect(
      `${redirectTo}?toast=${encodeURIComponent(
        "You already have an active claim batch. Deliver or release it first.",
      )}`,
    );
  }

  // Load + validate each carving_item: must be in carving_assigned,
  // not yet delivered, not claimed by someone else. Cross-vendor
  // mixing is allowed (a truck can hit multiple shades on one run).
  const { data: items, error: itemsErr } = await admin
    .from("carving_items")
    .select("id, status, received_at_vendor_at, claimed_by")
    .in("id", ids);
  if (itemsErr) {
    redirect(`${redirectTo}?toast=${encodeURIComponent(itemsErr.message)}`);
  }
  type Item = {
    id: string;
    status: string;
    received_at_vendor_at: string | null;
    claimed_by: string | null;
  };
  const itemRows = (items ?? []) as Item[];
  if (itemRows.length !== ids.length) {
    redirect(
      `${redirectTo}?toast=${encodeURIComponent("Some selected slabs no longer exist.")}`,
    );
  }
  for (const it of itemRows) {
    if (it.received_at_vendor_at) {
      redirect(`${redirectTo}?toast=${encodeURIComponent("One slab is already delivered — refresh and retry.")}`);
    }
    if (it.status !== "carving_assigned") {
      redirect(`${redirectTo}?toast=${encodeURIComponent("One slab is not in the transfer queue — refresh and retry.")}`);
    }
    if (it.claimed_by && it.claimed_by !== profile.id) {
      redirect(`${redirectTo}?toast=${encodeURIComponent("One slab is already claimed — refresh and retry.")}`);
    }
  }

  const now = new Date().toISOString();
  const claimBatchId = crypto.randomUUID();
  // Mig 144 — one truck carries the whole batch (pick-or-create on form).
  const claimTruckId = await resolveTruckByName(admin, txt(formData, "truck_name"), profile.id);
  // Race-guard: only claim items still unclaimed. If any one was
  // grabbed mid-call by another runner, the UPDATE will return
  // fewer rows than ids.length — bail and show a stale-state toast
  // so the user can refresh and re-select.
  const { data: updated, error: updErr } = await admin
    .from("carving_items")
    .update({
      claimed_by: profile.id,
      claimed_at: now,
      claim_batch_id: claimBatchId,
      claim_truck_id: claimTruckId,
    })
    .in("id", ids)
    .is("claimed_by", null)
    .select("id");
  if (updErr) {
    redirect(`${redirectTo}?toast=${encodeURIComponent(updErr.message)}`);
  }
  if (!updated || updated.length !== ids.length) {
    // Partial claim — some slabs got grabbed by another runner mid-
    // call. Roll back what we did claim so the user can re-select
    // the whole batch cleanly.
    const claimedIds = (updated ?? []).map((u) => (u as { id: string }).id);
    if (claimedIds.length > 0) {
      await admin
        .from("carving_items")
        .update({ claimed_by: null, claimed_at: null, claim_batch_id: null, claim_truck_id: null })
        .in("id", claimedIds);
    }
    redirect(
      `${redirectTo}?toast=${encodeURIComponent(
        "Some slabs were claimed by another runner — refresh and retry.",
      )}`,
    );
  }

  // Audit one row per slab + one batch-level row so the audit log
  // can be filtered both ways.
  await Promise.all(
    ids.map((id) =>
      recordEvent(id, "transfer_claimed", profile.id, `Claimed in batch ${claimBatchId.slice(0, 8)}`),
    ),
  );
  await logAudit(profile.id, "transfer_claim_batch", "claim_batch", claimBatchId, {
    carving_item_ids: ids,
    count: ids.length,
  });

  refreshAll();
  redirect(`${redirectTo}?toast=${encodeURIComponent(`Claimed ${ids.length} slab(s)`)}`);
}

export async function unclaimSlabTransferAction(formData: FormData) {
  const { profile } = await requireAuth([
    "developer",
    "owner",
    "carving_head",
    "slab_transfer",
    // Mig 083 — storekeeper is the same human as the slab-transfer
    // runner today (Daksh's call), so they share every auth gate.
    "storekeeper",
    "senior_incharge",
  ]);
  const admin = createAdminSupabaseClient();

  const carvingItemId = txt(formData, "carving_item_id");
  const redirectTo = txt(formData, "redirect_to") || "/carving/transfer";
  if (!carvingItemId) redirect(`${redirectTo}?toast=Missing+job+id`);

  const { data: ci } = await admin
    .from("carving_items")
    .select("id, claimed_by, received_at_vendor_at")
    .eq("id", carvingItemId)
    .maybeSingle();
  if (!ci) redirect(`${redirectTo}?toast=Job+not+found`);
  const item = ci as { id: string; claimed_by: string | null; received_at_vendor_at: string | null };

  if (item.received_at_vendor_at) redirect(`${redirectTo}?toast=Already+delivered`);
  if (!item.claimed_by) redirect(`${redirectTo}?toast=Not+claimed`);

  // slab_transfer can only unclaim their own. Higher roles can
  // unclaim anyone's (useful when a runner goes off shift).
  if ((profile.role === "slab_transfer" || profile.role === "storekeeper") && item.claimed_by !== profile.id) {
    redirect(`${redirectTo}?toast=Not+your+claim`);
  }

  await admin
    .from("carving_items")
    .update({ claimed_by: null, claimed_at: null, claim_batch_id: null, claim_truck_id: null })
    .eq("id", carvingItemId);

  await recordEvent(carvingItemId, "transfer_unclaimed", profile.id, "Released claim");
  await logAudit(profile.id, "transfer_unclaimed", "carving_item", carvingItemId, {});

  refreshAll();
  redirect(`${redirectTo}?toast=Claim+released`);
}

// Mig 065 follow-on — batch unclaim. Releases every undelivered
// slab in the runner's active claim batch in one shot. Useful when
// the runner aborts a truck-load (vehicle broke down, lift jammed,
// etc.) — they can clear the whole 10 at once instead of clicking
// Release Claim ten times.
export async function unclaimSlabTransferBatchAction(formData: FormData) {
  const { profile } = await requireAuth([
    "developer",
    "owner",
    "carving_head",
    "slab_transfer",
    // Mig 083 — storekeeper is the same human as the slab-transfer
    // runner today (Daksh's call), so they share every auth gate.
    "storekeeper",
    "senior_incharge",
  ]);
  const admin = createAdminSupabaseClient();

  const claimBatchId = txt(formData, "claim_batch_id");
  const redirectTo = txt(formData, "redirect_to") || "/carving/transfer";
  if (!claimBatchId) redirect(`${redirectTo}?toast=Missing+batch+id`);

  // Load every undelivered carving_item in this batch. Validate the
  // user owns the batch (slab_transfer can only release their own;
  // higher roles can release any batch).
  const { data: items } = await admin
    .from("carving_items")
    .select("id, claimed_by, received_at_vendor_at")
    .eq("claim_batch_id", claimBatchId)
    .is("received_at_vendor_at", null);
  const rows = (items ?? []) as Array<{ id: string; claimed_by: string | null; received_at_vendor_at: string | null }>;
  if (rows.length === 0) {
    redirect(`${redirectTo}?toast=${encodeURIComponent("Nothing to release in that batch.")}`);
  }
  if (profile.role === "slab_transfer" || profile.role === "storekeeper") {
    const anyForeign = rows.some((r) => r.claimed_by && r.claimed_by !== profile.id);
    if (anyForeign) {
      redirect(`${redirectTo}?toast=${encodeURIComponent("Not your batch to release.")}`);
    }
  }

  const ids = rows.map((r) => r.id);
  await admin
    .from("carving_items")
    .update({ claimed_by: null, claimed_at: null, claim_batch_id: null, claim_truck_id: null })
    .in("id", ids);

  await Promise.all(
    ids.map((id) =>
      recordEvent(id, "transfer_unclaimed", profile.id, `Released in batch ${claimBatchId.slice(0, 8)}`),
    ),
  );
  await logAudit(profile.id, "transfer_unclaim_batch", "claim_batch", claimBatchId, {
    carving_item_ids: ids,
    count: ids.length,
  });

  refreshAll();
  redirect(`${redirectTo}?toast=${encodeURIComponent(`Released ${ids.length} slab(s)`)}`);
}

// Mig 065 follow-on — batch deliver. Marks every undelivered slab
// in the runner's claim batch as received-at-vendor in one shot.
// Optional shared dropoff_note applies to every row. Useful when
// the runner drops the whole truck-load at the same shade in one
// trip — no need to click Mark Delivered ten times.
export async function acknowledgeReceiptBatchAction(formData: FormData) {
  const { profile } = await requireAuth([
    "developer",
    "owner",
    "carving_head",
    "slab_transfer",
    // Mig 083 — storekeeper is the same human as the slab-transfer
    // runner today (Daksh's call), so they share every auth gate.
    "storekeeper",
    "senior_incharge",
  ]);
  const admin = createAdminSupabaseClient();

  const claimBatchId = txt(formData, "claim_batch_id");
  const dropoffNote = txt(formData, "dropoff_note") || null;
  const redirectTo = txt(formData, "redirect_to") || "/carving/transfer";
  if (!claimBatchId) redirect(`${redirectTo}?toast=Missing+batch+id`);

  const { data: items } = await admin
    .from("carving_items")
    .select("id, slab_requirement_id, vendor_id, vendor_type, claimed_by, received_at_vendor_at")
    .eq("claim_batch_id", claimBatchId)
    .is("received_at_vendor_at", null);
  const rows = (items ?? []) as Array<{
    id: string;
    slab_requirement_id: string;
    vendor_id: string;
    vendor_type: string;
    claimed_by: string | null;
    received_at_vendor_at: string | null;
  }>;
  if (rows.length === 0) {
    redirect(`${redirectTo}?toast=${encodeURIComponent("Nothing to deliver in that batch.")}`);
  }
  // Daksh (Jun 2026) — outsource batches are allowed now; the outsource rows
  // auto-start on receipt (see below). CNC rows stay at Ready-to-load.
  if (profile.role === "slab_transfer" || profile.role === "storekeeper") {
    const anyForeign = rows.some((r) => r.claimed_by && r.claimed_by !== profile.id);
    if (anyForeign) {
      redirect(`${redirectTo}?toast=${encodeURIComponent("Not your batch to deliver.")}`);
    }
  }

  const now = new Date().toISOString();
  const ids = rows.map((r) => r.id);
  await admin
    .from("carving_items")
    .update({
      received_at_vendor_at: now,
      received_at_vendor_by: profile.id,
      claimed_by: null,
      claimed_at: null,
      claim_batch_id: null,
      ...(dropoffNote ? { dropoff_note: dropoffNote } : {}),
    })
    .in("id", ids)
    .is("received_at_vendor_at", null);

  // Outsource rows auto-start on arrival → in_progress + loaded (CNC stays
  // Ready-to-load). Flip both the carving job and the slab.
  const outsourceRows = rows.filter((r) => r.vendor_type === "Outsource");
  if (outsourceRows.length > 0) {
    const outIds = outsourceRows.map((r) => r.id);
    const outSlabIds = outsourceRows.map((r) => r.slab_requirement_id);
    await admin
      .from("carving_items")
      .update({ status: "carving_in_progress", loaded_at: now, loaded_by: profile.id })
      .in("id", outIds);
    await admin
      .from("slab_requirements")
      .update({ status: "carving_in_progress", updated_by: profile.id, updated_at: now })
      .in("id", outSlabIds);
  }

  const noteSuffix = dropoffNote ? ` · left at ${dropoffNote}` : "";
  await Promise.all(
    ids.map((id) =>
      recordEvent(
        id,
        "received_at_vendor",
        profile.id,
        `Delivered in batch ${claimBatchId.slice(0, 8)}${noteSuffix}`,
      ),
    ),
  );
  await logAudit(profile.id, "transfer_deliver_batch", "claim_batch", claimBatchId, {
    carving_item_ids: ids,
    count: ids.length,
    dropoff_note: dropoffNote,
  });

  refreshAll();
  redirect(`${redirectTo}?toast=${encodeURIComponent(`Delivered ${ids.length} slab(s)`)}`);
}

// ── Phase 5 (Mig 145/146) — carving → dispatch transfer lane ───────
//
// After a carving job is approved (status='completed' + ready_to_dispatch_at
// set) the slab waits at the carving station until the transfer person
// BRINGS IT IN to the dispatch station. That stamps received_at_dispatch_at,
// the gate that makes the slab clickable on the Dispatch board. Self-
// transfer at approval stamps it instantly and bypasses this lane.

export async function bringInToDispatchAction(formData: FormData) {
  const { profile } = await requireAuth([
    "developer",
    "owner",
    "carving_head",
    "slab_transfer",
    "storekeeper",
    "senior_incharge",
  ]);
  const admin = createAdminSupabaseClient();

  const carvingItemId = txt(formData, "carving_item_id");
  const redirectTo = txt(formData, "redirect_to") || "/carving/transfer";
  if (!carvingItemId) redirect(`${redirectTo}?toast=Missing+job+id`);

  const { data: ci } = await admin
    .from("carving_items")
    .select("id, status, ready_to_dispatch_at, received_at_dispatch_at")
    .eq("id", carvingItemId)
    .maybeSingle();
  if (!ci) redirect(`${redirectTo}?toast=Job+not+found`);
  const item = ci as {
    id: string;
    status: string;
    ready_to_dispatch_at: string | null;
    received_at_dispatch_at: string | null;
  };
  if (item.received_at_dispatch_at) redirect(`${redirectTo}?toast=Already+at+dispatch`);
  if (item.status !== "completed" || !item.ready_to_dispatch_at) {
    redirect(`${redirectTo}?toast=Not+ready+for+dispatch+transfer`);
  }

  const now = new Date().toISOString();
  // Mig 144 — record which truck moved it to dispatch (pick-or-create).
  const claimTruckId = await resolveTruckByName(admin, txt(formData, "truck_name"), profile.id);
  await admin
    .from("carving_items")
    .update({
      received_at_dispatch_at: now,
      received_at_dispatch_by: profile.id,
      ...(claimTruckId ? { claim_truck_id: claimTruckId } : {}),
    })
    .eq("id", carvingItemId)
    .is("received_at_dispatch_at", null);

  await recordEvent(carvingItemId, "received_at_dispatch", profile.id, "Brought in to dispatch");
  await logAudit(profile.id, "dispatch_transfer_in", "carving_item", carvingItemId, {});

  refreshAll();
  redirect(`${redirectTo}?toast=${encodeURIComponent("Brought in to dispatch")}`);
}

export async function bringInToDispatchBatchAction(formData: FormData) {
  const { profile } = await requireAuth([
    "developer",
    "owner",
    "carving_head",
    "slab_transfer",
    "storekeeper",
    "senior_incharge",
  ]);
  const admin = createAdminSupabaseClient();

  const redirectTo = txt(formData, "redirect_to") || "/carving/transfer";
  let ids: string[] = [];
  const raw = txt(formData, "carving_item_ids");
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) ids = parsed.map((x) => String(x)).filter(Boolean);
    } catch {
      redirect(`${redirectTo}?toast=Bad+payload`);
    }
  }
  if (ids.length === 0) redirect(`${redirectTo}?toast=No+slabs+selected`);

  // Only stamp rows genuinely awaiting dispatch transfer (approved,
  // ready, not already brought in). Anything stale is silently skipped.
  const { data: items } = await admin
    .from("carving_items")
    .select("id, status, ready_to_dispatch_at, received_at_dispatch_at")
    .in("id", ids);
  const eligible = ((items ?? []) as Array<{
    id: string;
    status: string;
    ready_to_dispatch_at: string | null;
    received_at_dispatch_at: string | null;
  }>)
    .filter((r) => r.status === "completed" && r.ready_to_dispatch_at && !r.received_at_dispatch_at)
    .map((r) => r.id);
  if (eligible.length === 0) {
    redirect(`${redirectTo}?toast=${encodeURIComponent("Nothing to bring in — refresh and retry.")}`);
  }

  const now = new Date().toISOString();
  // Mig 144 — record which truck moved the load to dispatch.
  const claimTruckId = await resolveTruckByName(admin, txt(formData, "truck_name"), profile.id);
  await admin
    .from("carving_items")
    .update({
      received_at_dispatch_at: now,
      received_at_dispatch_by: profile.id,
      ...(claimTruckId ? { claim_truck_id: claimTruckId } : {}),
    })
    .in("id", eligible)
    .is("received_at_dispatch_at", null);

  await Promise.all(
    eligible.map((id) =>
      recordEvent(id, "received_at_dispatch", profile.id, "Brought in to dispatch (batch)"),
    ),
  );
  await logAudit(profile.id, "dispatch_transfer_in_batch", "carving_item", eligible[0], {
    carving_item_ids: eligible,
    count: eligible.length,
  });

  refreshAll();
  redirect(
    `${redirectTo}?toast=${encodeURIComponent(`Brought ${eligible.length} slab(s) in to dispatch`)}`,
  );
}

// ── Carving → Dispatch, TWO-STEP claim → deliver (Daksh, Jun 2026) ──
//
// Mirrors the cutting→carving claim → deliver flow for the dispatch
// lane, REUSING the same claim columns (claimed_by / claimed_at /
// claim_batch_id / claim_truck_id) — they're free again by the time a
// slab is approved + awaiting dispatch (it was long since delivered to
// the vendor). Deliver stamps received_at_dispatch_at, the gate that
// makes the slab clickable on the Dispatch board.

export async function claimDispatchBatchAction(formData: FormData) {
  const { profile } = await requireAuth([
    "developer", "owner", "carving_head", "senior_incharge", "slab_transfer", "storekeeper",
  ]);
  const admin = createAdminSupabaseClient();
  const redirectTo = txt(formData, "redirect_to") || "/carving/transfer?tab=dispatch";

  let ids: string[] = [];
  const raw = txt(formData, "carving_item_ids");
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) ids = parsed.map((x) => String(x)).filter(Boolean);
    } catch { redirect(`${redirectTo}?toast=Bad+payload`); }
  }
  if (ids.length === 0) redirect(`${redirectTo}?toast=No+slabs+selected`);

  const { data: items } = await admin
    .from("carving_items")
    .select("id, status, ready_to_dispatch_at, received_at_dispatch_at, claimed_by")
    .in("id", ids);
  const eligible = ((items ?? []) as Array<{
    id: string; status: string; ready_to_dispatch_at: string | null;
    received_at_dispatch_at: string | null; claimed_by: string | null;
  }>)
    .filter((r) => r.status === "completed" && r.ready_to_dispatch_at && !r.received_at_dispatch_at && (!r.claimed_by || r.claimed_by === profile.id))
    .map((r) => r.id);
  if (eligible.length === 0) {
    redirect(`${redirectTo}?toast=${encodeURIComponent("Nothing to claim — refresh and retry.")}`);
  }

  const now = new Date().toISOString();
  const claimBatchId = crypto.randomUUID();
  const claimTruckId = await resolveTruckByName(admin, txt(formData, "truck_name"), profile.id);
  const { data: updated } = await admin
    .from("carving_items")
    .update({ claimed_by: profile.id, claimed_at: now, claim_batch_id: claimBatchId, claim_truck_id: claimTruckId })
    .in("id", eligible)
    .is("claimed_by", null)
    .select("id");
  const claimed = (updated ?? []) as Array<{ id: string }>;
  if (claimed.length === 0) {
    redirect(`${redirectTo}?toast=${encodeURIComponent("Already claimed — refresh and retry.")}`);
  }

  await Promise.all(claimed.map((u) =>
    recordEvent(u.id, "dispatch_claimed", profile.id, `Claimed for dispatch ${claimBatchId.slice(0, 8)}`)));
  await logAudit(profile.id, "dispatch_claim_batch", "claim_batch", claimBatchId, { count: claimed.length });

  refreshAll();
  redirect(`${redirectTo}?toast=${encodeURIComponent(`Claimed ${claimed.length} slab(s) for dispatch`)}`);
}

export async function deliverToDispatchBatchAction(formData: FormData) {
  const { profile } = await requireAuth([
    "developer", "owner", "carving_head", "senior_incharge", "slab_transfer", "storekeeper",
  ]);
  const admin = createAdminSupabaseClient();
  const redirectTo = txt(formData, "redirect_to") || "/carving/transfer?tab=dispatch";
  const claimBatchId = txt(formData, "claim_batch_id");
  if (!claimBatchId) redirect(`${redirectTo}?toast=Missing+batch+id`);

  const { data: items } = await admin
    .from("carving_items")
    .select("id, claimed_by")
    .eq("claim_batch_id", claimBatchId)
    .is("received_at_dispatch_at", null);
  const rows = (items ?? []) as Array<{ id: string; claimed_by: string | null }>;
  if (rows.length === 0) redirect(`${redirectTo}?toast=${encodeURIComponent("Nothing to deliver in that batch.")}`);
  if ((profile.role === "slab_transfer" || profile.role === "storekeeper") &&
      rows.some((r) => r.claimed_by && r.claimed_by !== profile.id)) {
    redirect(`${redirectTo}?toast=${encodeURIComponent("Not your batch to deliver.")}`);
  }

  const now = new Date().toISOString();
  const ids = rows.map((r) => r.id);
  await admin
    .from("carving_items")
    .update({ received_at_dispatch_at: now, received_at_dispatch_by: profile.id, claimed_by: null, claimed_at: null, claim_batch_id: null })
    .in("id", ids)
    .is("received_at_dispatch_at", null);

  await Promise.all(ids.map((id) => recordEvent(id, "received_at_dispatch", profile.id, `Delivered to dispatch ${claimBatchId.slice(0, 8)}`)));
  await logAudit(profile.id, "dispatch_deliver_batch", "claim_batch", claimBatchId, { carving_item_ids: ids, count: ids.length });

  refreshAll();
  redirect(`${redirectTo}?toast=${encodeURIComponent(`Delivered ${ids.length} slab(s) to dispatch`)}`);
}

export async function unclaimDispatchBatchAction(formData: FormData) {
  const { profile } = await requireAuth([
    "developer", "owner", "carving_head", "senior_incharge", "slab_transfer", "storekeeper",
  ]);
  const admin = createAdminSupabaseClient();
  const redirectTo = txt(formData, "redirect_to") || "/carving/transfer?tab=dispatch";
  const claimBatchId = txt(formData, "claim_batch_id");
  if (!claimBatchId) redirect(`${redirectTo}?toast=Missing+batch+id`);

  const { data: items } = await admin
    .from("carving_items")
    .select("id, claimed_by")
    .eq("claim_batch_id", claimBatchId)
    .is("received_at_dispatch_at", null);
  const rows = (items ?? []) as Array<{ id: string; claimed_by: string | null }>;
  if (rows.length === 0) redirect(`${redirectTo}?toast=${encodeURIComponent("Nothing to release.")}`);
  if ((profile.role === "slab_transfer" || profile.role === "storekeeper") &&
      rows.some((r) => r.claimed_by && r.claimed_by !== profile.id)) {
    redirect(`${redirectTo}?toast=${encodeURIComponent("Not your batch to release.")}`);
  }

  const ids = rows.map((r) => r.id);
  await admin
    .from("carving_items")
    .update({ claimed_by: null, claimed_at: null, claim_batch_id: null, claim_truck_id: null })
    .in("id", ids);

  await Promise.all(ids.map((id) => recordEvent(id, "dispatch_unclaimed", profile.id, `Released dispatch ${claimBatchId.slice(0, 8)}`)));
  await logAudit(profile.id, "dispatch_unclaim_batch", "claim_batch", claimBatchId, { count: ids.length });

  refreshAll();
  redirect(`${redirectTo}?toast=${encodeURIComponent(`Released ${ids.length} slab(s)`)}`);
}

// ── Migration 024: re-tag work-type on an existing job ─────────────
//
// Carving head can change a job's requires_machine_type after the
// initial assignment — e.g. realised mid-flight that the design
// actually needs a lathe. Only allowed while the job is still in
// the queue or actively carving.
export async function updateRequiresMachineTypeAction(formData: FormData) {
  const { profile } = await requireAuth(["developer", "owner", "carving_head", "senior_incharge", "tender_manager"]);
  const admin = createAdminSupabaseClient();

  const carvingItemId = txt(formData, "carving_item_id");
  const rawType = txt(formData, "requires_machine_type");
  const redirectTo = txt(formData, "redirect_to") || `/carving/${carvingItemId}`;

  if (!carvingItemId) redirect(`${redirectTo}?toast=Missing+job+id`);

  // Empty string → NULL (flat-panel default). Only "lathe" /
  // "multi_head_2" / "single_head" are legal CHECK values.
  const newType =
    rawType === "lathe" || rawType === "multi_head_2" || rawType === "single_head"
      ? rawType
      : null;

  const { data: ci } = await admin
    .from("carving_items")
    .select("id, vendor_type, status, requires_machine_type, cnc_machine_id")
    .eq("id", carvingItemId)
    .maybeSingle();
  if (!ci) redirect(`${redirectTo}?toast=Job+not+found`);
  const item = ci as {
    id: string;
    vendor_type: string;
    status: string;
    requires_machine_type: string | null;
    cnc_machine_id: string | null;
  };

  if (item.vendor_type !== "CNC") {
    redirect(`${redirectTo}?toast=Work-type+tag+is+CNC-only`);
  }
  if (item.status !== "carving_assigned" && item.status !== "carving_in_progress") {
    redirect(`${redirectTo}?toast=Can+only+re-tag+queued+or+active+jobs`);
  }
  if (item.cnc_machine_id) {
    redirect(
      `${redirectTo}?toast=${encodeURIComponent(
        "Job is loaded on a machine. Unload first if the new type doesn't match.",
      )}`,
    );
  }

  await admin
    .from("carving_items")
    .update({ requires_machine_type: newType })
    .eq("id", carvingItemId);

  await recordEvent(
    carvingItemId,
    "work_type_tagged",
    profile.id,
    `Tagged as ${newType ?? "flat panel"}`,
  );
  await logAudit(profile.id, "carving_work_type_tagged", "carving_item", carvingItemId, {
    from: item.requires_machine_type,
    to: newType,
  });

  refreshAll();
  redirect(`${redirectTo}?toast=Work+type+updated`);
}

// ── Mig 088: change carved sides (1 ↔ 2) on a job ─────────────────
// Staff fallback for a wrong single/double choice at assign. Output is
// summed at read time keyed on review_approved_at, so correcting this
// before/at approval (and even shortly after) fixes the CNC costing.
// Staff-only — NOT the vendor role; the vendor cockpit has no control.
export async function updateCarvingSidesAction(formData: FormData) {
  const { profile } = await requireAuth(["developer", "owner", "carving_head", "senior_incharge", "tender_manager"]);
  const admin = createAdminSupabaseClient();

  const carvingItemId = txt(formData, "carving_item_id");
  const redirectTo = txt(formData, "redirect_to") || `/carving/${carvingItemId}`;
  const newSides = num(formData, "carving_sides", 1) === 2 ? 2 : 1;
  if (!carvingItemId) redirect(`${redirectTo}?toast=Missing+job+id`);

  const { data: ci } = await admin
    .from("carving_items")
    .select("id, status, carving_sides")
    .eq("id", carvingItemId)
    .maybeSingle();
  if (!ci) redirect(`${redirectTo}?toast=Job+not+found`);
  const item = ci as { id: string; status: string; carving_sides: number | null };

  // Allowed while the slab is in the active carving loop or just
  // approved (not on rejected slabs — they're out of the loop).
  const editable = [
    "carving_assigned",
    "carving_in_progress",
    "carving_on_hold",
    "completed",
  ];
  if (!editable.includes(item.status)) {
    redirect(
      `${redirectTo}?toast=${encodeURIComponent("Can't change carved sides for this slab's state.")}`,
    );
  }

  await admin
    .from("carving_items")
    .update({ carving_sides: newSides })
    .eq("id", carvingItemId);

  await recordEvent(
    carvingItemId,
    "carving_sides_updated",
    profile.id,
    `Carved sides set to ${newSides}`,
  );
  await logAudit(profile.id, "carving_sides_updated", "carving_item", carvingItemId, {
    from: item.carving_sides ?? 1,
    to: newSides,
  });

  refreshAll();
  redirect(
    `${redirectTo}?toast=${encodeURIComponent(`Carved sides set to ${newSides}`)}`,
  );
}

// ── Part D: transfer a job to another vendor ──────────────────────
//
// Allowed at any point before completion. If the slab is currently
// loaded on a CNC, we auto-unload the machine and reset machine
// links on the carving_items row. The vendor flip is preserved on
// the SAME carving_items row (no DELETE+INSERT) so all
// carving_job_events stay attached for the full audit trail.
//
// 2-head pairs are blocked here — the operator must unload the
// partner first so the system doesn't have to reason about which
// half-pair to leave behind.
export async function transferCarvingJobAction(formData: FormData) {
  // Vendor role is allowed too — vendors can hand off their own
  // work when they realise they can't handle it (broken stock,
  // wrong machine type, overbooked, etc). Ownership check below
  // ensures vendors can only transfer slabs they currently own.
  // Mig 076 — senior_incharge added so Rajesh can transfer from
  // the /carving/[id] detail page. (Daksh flagged the bug: clicking
  // Transfer from the detail page redirected him to /slabs because
  // his role wasn't in the list.)
  const { profile } = await requireAuth(["developer", "owner", "carving_head", "senior_incharge", "tender_manager", "vendor"]);
  const admin = createAdminSupabaseClient();

  const carvingItemId = txt(formData, "carving_item_id");
  const newVendorId = txt(formData, "new_vendor_id");
  const reason = txt(formData, "reason");
  const redirectTo = txt(formData, "redirect_to") || `/carving/${carvingItemId}`;

  if (!carvingItemId || !newVendorId) {
    redirect(`${redirectTo}?toast=Missing+job+or+vendor`);
  }
  if (reason.length < 8) {
    redirect(`${redirectTo}?toast=Please+enter+a+reason+(min+8+chars)`);
  }

  const { data: ci } = await admin
    .from("carving_items")
    .select("id, vendor_id, vendor_name, status, cnc_machine_id")
    .eq("id", carvingItemId)
    .maybeSingle();
  if (!ci) redirect(`${redirectTo}?toast=Job+not+found`);
  const item = ci as {
    id: string;
    vendor_id: string;
    vendor_name: string;
    status: string;
    cnc_machine_id: string | null;
  };

  // Vendor role: must currently own the slab. Higher roles can move
  // anyone's work.
  if (profile.role === "vendor") {
    if (!profile.vendor_id || profile.vendor_id !== item.vendor_id) {
      redirect(`${redirectTo}?toast=Not+your+slab+to+transfer`);
    }
  }

  if (item.vendor_id === newVendorId) {
    redirect(`${redirectTo}?toast=Already+with+that+vendor`);
  }
  if (["completed", "dispatched", "rejected"].includes(item.status)) {
    redirect(`${redirectTo}?toast=Cannot+transfer+completed+or+dispatched+jobs`);
  }

  // 2-head pair guard: if the slab is loaded on a multi_head_2 and
  // the partner is also active, refuse and tell the user to unload
  // both first.
  if (item.cnc_machine_id) {
    const { data: machineRow } = await admin
      .from("cnc_machines")
      .select("id, machine_type, machine_code")
      .eq("id", item.cnc_machine_id)
      .maybeSingle();
    const mt = (machineRow as { machine_type?: string; machine_code?: string } | null);
    if (mt?.machine_type === "multi_head_2") {
      const { data: partners } = await admin
        .from("carving_items")
        .select("id")
        .eq("cnc_machine_id", item.cnc_machine_id)
        .eq("status", "carving_in_progress");
      if ((partners ?? []).length > 1) {
        redirect(
          `${redirectTo}?toast=${encodeURIComponent(
            "This is part of a 2-head pair. Unload both first, then transfer.",
          )}`,
        );
      }
    }
  }

  const { data: newVendor } = await admin
    .from("vendors")
    .select("id, name, vendor_type, is_active")
    .eq("id", newVendorId)
    .maybeSingle();
  if (!newVendor) redirect(`${redirectTo}?toast=Destination+vendor+not+found`);
  const nv = newVendor as { id: string; name: string; vendor_type: string; is_active: boolean };
  if (!nv.is_active) redirect(`${redirectTo}?toast=Destination+vendor+is+inactive`);
  if (nv.vendor_type !== "CNC" && nv.vendor_type !== "Outsource") {
    redirect(`${redirectTo}?toast=Destination+must+be+CNC+or+Outsource`);
  }

  const now = new Date().toISOString();
  const wasLoaded = !!item.cnc_machine_id;
  const oldMachineId = item.cnc_machine_id;
  const oldVendorName = item.vendor_name;

  // Auto-unload from the current machine if loaded.
  if (oldMachineId) {
    await admin
      .from("cnc_machines")
      .update({ status: "idle", current_carving_item_id: null })
      .eq("id", oldMachineId)
      .eq("current_carving_item_id", carvingItemId);
    await admin.from("cnc_machine_events").insert({
      cnc_machine_id: oldMachineId,
      event_type: "unloaded_for_transfer",
      carving_item_id: carvingItemId,
      user_id: profile.id,
      message: `Unloaded for transfer → ${nv.name}`,
    });
  }

  await admin
    .from("carving_items")
    .update({
      vendor_id: nv.id,
      vendor_name: nv.name,
      vendor_type: nv.vendor_type,
      status: "carving_assigned",
      cnc_machine_id: null,
      loaded_at: null,
      loaded_by: null,
      vendor_estimated_minutes: null,
      received_at_vendor_at: null,
      received_at_vendor_by: null,
    })
    .eq("id", carvingItemId);

  // Slab status mirrors the carving item (back to assigned).
  const { data: slabIdRow } = await admin
    .from("carving_items")
    .select("slab_requirement_id")
    .eq("id", carvingItemId)
    .maybeSingle();
  if ((slabIdRow as { slab_requirement_id?: string } | null)?.slab_requirement_id) {
    await admin
      .from("slab_requirements")
      .update({
        status: "carving_assigned",
        updated_by: profile.id,
        updated_at: now,
      })
      .eq("id", (slabIdRow as { slab_requirement_id: string }).slab_requirement_id);
  }

  await recordEvent(
    carvingItemId,
    "transferred",
    profile.id,
    `Transferred ${oldVendorName} → ${nv.name}${wasLoaded ? " (was loaded)" : ""} · ${reason}`,
  );
  await logAudit(profile.id, "carving_transferred", "carving_item", carvingItemId, {
    from_vendor: item.vendor_id,
    to_vendor: nv.id,
    was_loaded: wasLoaded,
    reason,
  });

  refreshAll();
  redirect(`${redirectTo}?toast=${encodeURIComponent(`Transferred to ${nv.name}`)}`);
}

// ── Part E: Manual vendor lifecycle ───────────────────────────────
//
// Manual carvers have no CNC and no system login. The carving head
// runs the lifecycle on their behalf via two simple actions:
//   markCarvingStartedManuallyAction → starts the timer
//   markCarvingCompleteManuallyAction → marks ready for review
// Approve / Reject reuse the existing CNC-side actions.

export async function markCarvingStartedManuallyAction(formData: FormData) {
  const { profile } = await requireAuth(["developer", "owner", "carving_head", "senior_incharge", "tender_manager"]);
  const admin = createAdminSupabaseClient();

  const carvingItemId = txt(formData, "carving_item_id");
  const redirectTo = txt(formData, "redirect_to") || `/carving/${carvingItemId}`;
  if (!carvingItemId) redirect(`${redirectTo}?toast=Missing+job+id`);

  const { data: ci } = await admin
    .from("carving_items")
    .select("id, vendor_type, vendor_name, status, slab_requirement_id")
    .eq("id", carvingItemId)
    .maybeSingle();
  if (!ci) redirect(`${redirectTo}?toast=Job+not+found`);
  const item = ci as {
    id: string;
    vendor_type: string;
    vendor_name: string;
    status: string;
    slab_requirement_id: string;
  };

  if (item.vendor_type !== "Outsource") {
    redirect(`${redirectTo}?toast=Use+the+load+action+for+CNC+vendors`);
  }
  if (item.status !== "carving_assigned") {
    redirect(`${redirectTo}?toast=Job+is+not+in+queue`);
  }

  const now = new Date().toISOString();
  await admin
    .from("carving_items")
    .update({ status: "carving_in_progress", loaded_at: now, loaded_by: profile.id })
    .eq("id", carvingItemId)
    .eq("status", "carving_assigned");

  await admin
    .from("slab_requirements")
    .update({ status: "carving_in_progress", updated_by: profile.id, updated_at: now })
    .eq("id", item.slab_requirement_id);

  await recordEvent(
    carvingItemId,
    "started_manually",
    profile.id,
    `Outsource carving started · ${item.vendor_name}`,
  );
  await logAudit(profile.id, "carving_started_manually", "carving_item", carvingItemId, {
    vendor_name: item.vendor_name,
  });

  refreshAll();
  redirect(`${redirectTo}?toast=Marked+started`);
}

export async function markCarvingCompleteManuallyAction(formData: FormData) {
  const { profile } = await requireAuth(["developer", "owner", "carving_head", "senior_incharge", "tender_manager"]);
  const admin = createAdminSupabaseClient();

  const carvingItemId = txt(formData, "carving_item_id");
  const tempLocation = txt(formData, "temporary_location") || "Outsource carver yard";
  const redirectTo = txt(formData, "redirect_to") || `/carving/${carvingItemId}`;
  if (!carvingItemId) redirect(`${redirectTo}?toast=Missing+job+id`);

  const { data: ci } = await admin
    .from("carving_items")
    .select("id, vendor_type, vendor_name, status, completed_at")
    .eq("id", carvingItemId)
    .maybeSingle();
  if (!ci) redirect(`${redirectTo}?toast=Job+not+found`);
  const item = ci as {
    id: string;
    vendor_type: string;
    vendor_name: string;
    status: string;
    completed_at: string | null;
  };

  if (item.vendor_type !== "Outsource") {
    redirect(`${redirectTo}?toast=Use+the+unload+action+for+CNC+vendors`);
  }
  if (item.status !== "carving_in_progress") {
    redirect(`${redirectTo}?toast=Job+is+not+in+progress`);
  }
  if (item.completed_at) redirect(`${redirectTo}?toast=Already+marked+complete`);

  const now = new Date().toISOString();
  await admin
    .from("carving_items")
    .update({
      // Daksh June 2026 — set status='completed' on Receive so the slab
      // LEAVES the Active tab (status no longer carving_in_progress) and
      // shows only under Carving Done Approval. Without this it matched
      // both tabs at once.
      status: "completed",
      completed_at: now,
      unloaded_at: now,
      unloaded_by: profile.id,
      temporary_location: tempLocation,
    })
    .eq("id", carvingItemId)
    .is("completed_at", null);

  await recordEvent(
    carvingItemId,
    "completed_manually",
    profile.id,
    `Outsource carving received (back from vendor) · ${item.vendor_name} · stored at ${tempLocation}`,
  );
  await logAudit(profile.id, "carving_completed_manually", "carving_item", carvingItemId, {
    vendor_name: item.vendor_name,
    temporary_location: tempLocation,
  });

  await notifyCarvingApprovalBacklog(admin);
  refreshAll();
  // Daksh June 2026 — redirect_to already carries a query string
  // (?tab=active&mode=outsource), so the toast MUST be joined with & —
  // using ? here produced "…&mode=outsource?toast=Received", which broke
  // the mode param and dragged the user to the CNC Active tab.
  const sep1 = redirectTo.includes("?") ? "&" : "?";
  redirect(`${redirectTo}${sep1}toast=Received`);
}

// ── Batch Receive for Outsource carving (Daksh June 2026) ────────────
// Marks up to 8 returned Outsource slabs as received in one press. Same
// per-slab effect as markCarvingCompleteManuallyAction (status→completed,
// completed_at/unloaded_at stamped → slab moves to Carving Done Approval),
// just looped. Office roles only. Skips any row that isn't a still-in-
// progress Outsource job (CNC + cutting untouched).
export async function receiveOutsourceCarvingBatchAction(formData: FormData) {
  const { profile } = await requireAuth(["developer", "owner", "carving_head", "senior_incharge", "tender_manager"]);
  const admin = createAdminSupabaseClient();

  const redirectTo = txt(formData, "redirect_to") || "/carving?tab=active&mode=outsource";
  const sep = redirectTo.includes("?") ? "&" : "?";
  const tempLocation = txt(formData, "temporary_location") || "Outsource carver yard";

  let ids: string[] = [];
  try {
    const parsed = JSON.parse(txt(formData, "carving_item_ids"));
    if (Array.isArray(parsed)) {
      ids = parsed.filter((x): x is string => typeof x === "string" && !!x);
    }
  } catch {
    /* empty → handled below */
  }
  // De-dupe + hard cap at 8 (the UI caps too; this is the last line of
  // defence against a tampered form).
  ids = [...new Set(ids)].slice(0, 8);
  if (ids.length === 0) redirect(`${redirectTo}${sep}toast=No+slabs+selected`);

  const { data: rows } = await admin
    .from("carving_items")
    .select("id, vendor_type, vendor_name, status, completed_at")
    .in("id", ids);
  const items = (rows ?? []) as Array<{
    id: string;
    vendor_type: string;
    vendor_name: string;
    status: string;
    completed_at: string | null;
  }>;

  const now = new Date().toISOString();
  let received = 0;
  for (const it of items) {
    if (it.vendor_type !== "Outsource") continue;
    if (it.status !== "carving_in_progress") continue;
    if (it.completed_at) continue;
    const { data: upd } = await admin
      .from("carving_items")
      .update({
        status: "completed",
        completed_at: now,
        unloaded_at: now,
        unloaded_by: profile.id,
        temporary_location: tempLocation,
      })
      .eq("id", it.id)
      .is("completed_at", null)
      .select("id");
    if (upd && upd.length > 0) {
      received += 1;
      await recordEvent(
        it.id,
        "completed_manually",
        profile.id,
        `Outsource carving received (back from vendor) · ${it.vendor_name} · stored at ${tempLocation}`,
      );
      await logAudit(profile.id, "carving_completed_manually", "carving_item", it.id, {
        vendor_name: it.vendor_name,
        temporary_location: tempLocation,
        batch: true,
      });
    }
  }

  await notifyCarvingApprovalBacklog(admin);
  refreshAll();
  redirect(
    `${redirectTo}${sep}toast=${encodeURIComponent(
      received > 0 ? `📥 Received ${received} slab${received === 1 ? "" : "s"}` : "Nothing to receive",
    )}`,
  );
}

// ── Outsource jobwork challan generation (Mig 094/096) ───────────────
// Builds a printable JW-YYYY-N challan from approved Outsource carving
// jobs for one vendor: each slab's CFT/SFT × rate = amount, plus optional
// GST / RCM. Everything (qty/rate/amount) is snapshotted so the bill
// can't drift if dims or rates change later. NOT wired to accounts.
export async function generateCarvingChallanAction(formData: FormData) {
  const { profile } = await requireAuth([
    "developer",
    "owner",
    "carving_head",
    "senior_incharge",
  ]);
  const admin = createAdminSupabaseClient();

  const vendorId = txt(formData, "vendor_id");
  const idsRaw = txt(formData, "carving_item_ids");
  const ratesRaw = txt(formData, "rates_json");
  const gstPctRaw = txt(formData, "gst_pct");
  const gstPct = gstPctRaw && Number(gstPctRaw) > 0 ? Number(gstPctRaw) : null;
  const isRcm = txt(formData, "is_rcm") === "true";
  const notes = txt(formData, "notes") || null;

  if (!vendorId) redirect("/carving/challans/new?toast=Pick+a+vendor");

  // Per-slab rate overrides {carving_item_id: rate}. Falls back to the slab's
  // owner-approved snapshot rate when absent. Each slab is billed by its OWN
  // unit (cft / sft / job-flat), so one challan can mix units correctly.
  const rateMap: Record<string, number> = {};
  try {
    const parsed = JSON.parse(ratesRaw);
    if (parsed && typeof parsed === "object") {
      for (const [k, v] of Object.entries(parsed)) {
        const n = Number(v);
        if (Number.isFinite(n) && n > 0) rateMap[k] = n;
      }
    }
  } catch {
    /* empty */
  }

  let ids: string[] = [];
  try {
    const parsed = JSON.parse(idsRaw);
    if (Array.isArray(parsed)) {
      ids = parsed.filter((x): x is string => typeof x === "string" && !!x);
    }
  } catch {
    /* empty */
  }
  if (ids.length === 0) redirect("/carving/challans/new?toast=Select+at+least+one+slab");

  const { data: itemsData } = await admin
    .from("carving_items")
    .select(
      "id, vendor_id, vendor_name, vendor_type, slab_requirement_id, review_approved_at, jobwork_rate, jobwork_unit",
    )
    .in("id", ids)
    .eq("vendor_id", vendorId);
  const items = (itemsData ?? []) as Array<{
    id: string;
    vendor_id: string;
    vendor_name: string;
    vendor_type: string;
    slab_requirement_id: string;
    review_approved_at: string | null;
    jobwork_rate: number | string | null;
    jobwork_unit: string | null;
  }>;
  if (items.length === 0) redirect("/carving/challans/new?toast=No+matching+approved+slabs");
  if (items.some((i) => i.vendor_type !== "Outsource" || !i.review_approved_at)) {
    redirect("/carving/challans/new?toast=Only+approved+Outsource+slabs+can+be+billed");
  }

  // Refuse any slab already on a non-cancelled challan (no double-billing).
  const { data: already } = await admin
    .from("carving_challan_items")
    .select("carving_item_id, carving_challans!inner(cancelled_at)")
    .in("carving_item_id", ids);
  const billed = ((already ?? []) as unknown as Array<{
    carving_item_id: string | null;
    carving_challans: { cancelled_at: string | null } | null;
  }>).some((r) => r.carving_item_id && !r.carving_challans?.cancelled_at);
  if (billed) {
    redirect("/carving/challans/new?toast=Some+slabs+are+already+on+a+challan");
  }

  const { data: slabRows } = await admin
    .from("slab_requirements")
    .select("id, label, temple, length_ft, width_ft, thickness_ft")
    .in("id", items.map((i) => i.slab_requirement_id));
  const slabById = new Map(
    ((slabRows ?? []) as Array<{
      id: string;
      label: string | null;
      temple: string;
      length_ft: number | string;
      width_ft: number | string;
      thickness_ft: number | string;
    }>).map((s) => [s.id, s]),
  );

  const lines = items.map((it, idx) => {
    const slab = slabById.get(it.slab_requirement_id);
    // Each slab keeps its OWN unit (snapshot from the work order) and its own
    // rate (per-slab override from the form, else the snapshot rate). 'job' is
    // a flat amount per slab; cft/sft multiply by the slab's quantity.
    const u = it.jobwork_unit === "sft" ? "sft" : it.jobwork_unit === "job" ? "job" : "cft";
    const r = rateMap[it.id] ?? (it.jobwork_rate != null ? Number(it.jobwork_rate) : 0);
    const qty =
      u === "job"
        ? 1
        : slab
          ? jobworkQuantity(u as "cft" | "sft", slab.length_ft, slab.width_ft, slab.thickness_ft)
          : 0;
    const amount = Math.round((u === "job" ? r : qty * r) * 100) / 100;
    const dims = slab
      ? `${Number(slab.length_ft)}x${Number(slab.width_ft)}x${Number(slab.thickness_ft)} in`
      : "";
    const desc = slab
      ? `${it.slab_requirement_id} · ${slab.label ?? slab.temple} · ${dims}`
      : it.slab_requirement_id;
    return {
      carving_item_id: it.id,
      slab_requirement_id: it.slab_requirement_id,
      description: desc,
      quantity: Math.round(qty * 1000) / 1000,
      unit: u,
      rate: r,
      amount,
      position: idx,
    };
  });
  // Every billed slab must carry a positive rate (per-slab or snapshot).
  if (lines.some((l) => !(l.rate > 0))) {
    redirect("/carving/challans/new?toast=" + encodeURIComponent("Every slab needs a rate"));
  }
  const subtotal = Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100;
  const gstAmount = gstPct ? Math.round(subtotal * gstPct) / 100 : 0;
  const total = Math.round((subtotal + (isRcm ? 0 : gstAmount)) * 100) / 100;

  const { data: challan, error: chErr } = await admin
    .from("carving_challans")
    .insert({
      vendor_id: vendorId,
      vendor_name: items[0].vendor_name,
      amount_subtotal: subtotal,
      gst_pct: gstPct,
      gst_amount: gstAmount,
      is_rcm: isRcm,
      amount_total: total,
      notes,
      created_by: profile.id,
    })
    .select("id")
    .single();
  if (chErr || !challan) {
    redirect(
      `/carving/challans/new?toast=${encodeURIComponent(chErr?.message ?? "Failed to create challan")}`,
    );
  }

  await admin
    .from("carving_challan_items")
    .insert(lines.map((l) => ({ challan_id: challan.id, ...l })));

  await logAudit(profile.id, "carving_challan_generated", "carving_challan", challan.id, {
    vendor_id: vendorId,
    items: lines.length,
    total,
  });
  refreshAll();
  redirect(`/carving/challans/${challan.id}?toast=Challan+generated`);
}

// ── Outsource work orders (Mig 095) ──────────────────────────────────
// A work order is a future-need order to an Outsource vendor. Lines may
// reference an existing slab (any status) OR be pure text until the slab
// is cut. NOTHING here touches slab_requirements.status or carving_items
// until a line is "Sent" (slab must be cut_done by then).

const WO_ROLES = ["developer", "owner", "carving_head", "senior_incharge", "tender_manager"] as const;

/** Shared "send slab to outsource vendor" — the cut_done-gated bridge that
 *  the work order's Send action uses. Mirrors the Outsource auto-start in
 *  assignCarvingJobAction but returns a result instead of redirecting. */
async function sendSlabToOutsourceVendor(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  opts: {
    slabId: string;
    vendorId: string;
    vendorName: string;
    rate: number | null;
    unit: "cft" | "sft" | "job";
    profileId: string;
  },
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  const nowIso = new Date().toISOString();
  const { data: slabRow } = await admin
    .from("slab_requirements")
    .update({ status: "carving_assigned", updated_by: opts.profileId, updated_at: nowIso })
    .eq("id", opts.slabId)
    .eq("status", "cut_done")
    .select("id");
  if (!slabRow?.length) return { ok: false, reason: "Slab is not cut-done yet" };
  // Daksh (Jun 2026) — work-order sends route through the cutting→carving
  // transfer too: the slab waits at carving_assigned (In Transit) until the
  // runner delivers it to the vendor; receipt flips it to in_progress.
  const { data: item, error } = await admin
    .from("carving_items")
    .insert({
      slab_requirement_id: opts.slabId,
      vendor_id: opts.vendorId,
      vendor_name: opts.vendorName,
      vendor_type: "Outsource",
      cnc_machine_id: null,
      status: "carving_assigned",
      urgency: "normal",
      assigned_by: opts.profileId,
      ...(opts.rate != null ? { jobwork_rate: opts.rate, jobwork_unit: opts.unit } : {}),
    })
    .select("id")
    .single();
  if (error || !item) {
    await admin
      .from("slab_requirements")
      .update({ status: "cut_done", updated_by: opts.profileId, updated_at: nowIso })
      .eq("id", opts.slabId);
    return { ok: false, reason: error?.message ?? "Failed to create carving job" };
  }
  await recordEvent(
    item.id,
    "assigned",
    opts.profileId,
    `Work-order send → ${opts.vendorName} (sent for transfer) · 🏭 outsource`,
  );
  // Ping the transfer runner — the slab is waiting to be carried to the vendor.
  await notifySlabTransferWaiting(admin, opts.slabId, opts.vendorName);
  return { ok: true, id: item.id };
}

export async function createWorkOrderAction(formData: FormData) {
  const { profile } = await requireAuth([...WO_ROLES]);
  const admin = createAdminSupabaseClient();

  const vendorId = txt(formData, "vendor_id");
  const title = txt(formData, "title") || null;
  const temple = txt(formData, "temple") || null;
  const rateRaw = txt(formData, "jobwork_rate");
  const rate = rateRaw && Number(rateRaw) > 0 ? Number(rateRaw) : null;
  // Mig 100 — units: cft / sft / job (job = a flat ₹ per slab).
  const unitRaw = txt(formData, "jobwork_unit");
  const unit = unitRaw === "sft" ? "sft" : unitRaw === "job" ? "job" : "cft";
  if (!vendorId) redirect("/carving/work-orders/new?toast=Pick+a+vendor");
  // Mig 100 — price is OPTIONAL at creation; the owner sets/approves it.

  const { data: vendor } = await admin
    .from("vendors")
    .select("id, name, vendor_type, is_active")
    .eq("id", vendorId)
    .maybeSingle();
  const v = vendor as { name: string; vendor_type: string; is_active: boolean } | null;
  if (!v) redirect("/carving/work-orders/new?toast=Vendor+not+found");
  if (v!.vendor_type !== "Outsource") {
    redirect("/carving/work-orders/new?toast=Work+orders+are+for+Outsource+vendors");
  }

  type LineIn = {
    slab_requirement_id?: string | null;
    description?: string | null;
    planned_length_ft?: number | null;
    planned_width_ft?: number | null;
    planned_thickness_ft?: number | null;
    qty?: number | null;
  };
  let lines: LineIn[] = [];
  try {
    const parsed = JSON.parse(txt(formData, "lines_json"));
    if (Array.isArray(parsed)) lines = parsed as LineIn[];
  } catch {
    /* empty */
  }
  lines = lines.filter(
    (l) => (l.slab_requirement_id && String(l.slab_requirement_id).trim()) || (l.description && String(l.description).trim()),
  );
  if (lines.length === 0) redirect("/carving/work-orders/new?toast=Add+at+least+one+line");

  const { data: wo, error: woErr } = await admin
    .from("carving_work_orders")
    .insert({
      vendor_id: vendorId,
      vendor_name: v!.name,
      title,
      temple,
      jobwork_rate: rate,
      jobwork_unit: unit,
      // Mig 098 — new work orders wait for owner approval before they can
      // be used (slabs sent to the vendor).
      status: "pending_approval",
      created_by: profile.id,
    })
    .select("id")
    .single();
  if (woErr || !wo) {
    redirect(`/carving/work-orders/new?toast=${encodeURIComponent(woErr?.message ?? "Failed to create work order")}`);
  }

  await admin.from("carving_work_order_items").insert(
    lines.map((l, i) => ({
      work_order_id: wo.id,
      slab_requirement_id: l.slab_requirement_id ? String(l.slab_requirement_id) : null,
      description: l.description ? String(l.description) : null,
      planned_length_ft: l.planned_length_ft != null ? Number(l.planned_length_ft) : null,
      planned_width_ft: l.planned_width_ft != null ? Number(l.planned_width_ft) : null,
      planned_thickness_ft: l.planned_thickness_ft != null ? Number(l.planned_thickness_ft) : null,
      qty: l.qty && Number(l.qty) > 0 ? Math.floor(Number(l.qty)) : 1,
      line_status: "planned",
      position: i,
    })),
  );

  await logAudit(profile.id, "work_order_created", "carving_work_order", wo.id, {
    vendor_id: vendorId,
    lines: lines.length,
  });
  refreshAll();
  redirect(`/carving/work-orders/${wo.id}?toast=${encodeURIComponent("Work order created — pending owner approval")}`);
}

// ── Owner work-order approval (Mig 098) ─────────────────────────────
// Only the owner (or developer) approves a work order. Approving makes it
// usable (slabs can be sent); the owner may edit the price at approval.
export async function approveWorkOrderAction(formData: FormData) {
  const { profile } = await requireAuth(["developer", "owner"]);
  const admin = createAdminSupabaseClient();
  const woId = txt(formData, "work_order_id");
  if (!woId) redirect("/carving/work-orders?toast=Missing+work+order");

  // Price edit at approval time. Mig 100 — units: cft / sft / job.
  const rateRaw = txt(formData, "jobwork_rate");
  const newRate = rateRaw && Number(rateRaw) > 0 ? Number(rateRaw) : null;
  const unitRaw = txt(formData, "jobwork_unit");
  const newUnit = unitRaw === "sft" || unitRaw === "cft" || unitRaw === "job" ? unitRaw : null;

  // Mig 100 — the owner MUST set a price to approve. Use the edited rate,
  // else whatever rate is already on the work order.
  const { data: cur } = await admin
    .from("carving_work_orders")
    .select("jobwork_rate")
    .eq("id", woId)
    .maybeSingle();
  const curRate = (cur as { jobwork_rate?: number | string | null } | null)?.jobwork_rate;
  const effectiveRate = newRate ?? (curRate != null ? Number(curRate) : null);
  if (effectiveRate == null || !(effectiveRate > 0)) {
    redirect(`/carving/work-orders/${woId}?toast=${encodeURIComponent("Enter a price before approving.")}`);
  }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    status: "open",
    approved_at: now,
    approved_by: profile.id,
    updated_at: now,
    updated_by: profile.id,
    jobwork_rate: effectiveRate,
  };
  if (newUnit) patch.jobwork_unit = newUnit;

  const { error } = await admin
    .from("carving_work_orders")
    .update(patch)
    .eq("id", woId)
    .eq("status", "pending_approval");
  if (error) redirect(`/carving/work-orders?toast=${encodeURIComponent(error.message)}`);

  await logAudit(profile.id, "work_order_approved", "carving_work_order", woId, {
    rate: effectiveRate,
  });
  refreshAll();
  // Mig 100 — approved → print the work-order doc + hand over to the vendor.
  redirect(`/carving/work-orders/${woId}?toast=${encodeURIComponent("Approved — print the work order & hand it to the vendor")}`);
}

// Mig 100 — after approval, the office prints the signed work-order
// document and hands it to the vendor; only then can slabs be sent.
// Office roles (incl. owner) can mark it handed over.
export async function handoverWorkOrderAction(formData: FormData) {
  const { profile } = await requireAuth([...WO_ROLES]);
  const admin = createAdminSupabaseClient();
  const woId = txt(formData, "work_order_id");
  if (!woId) redirect("/carving/work-orders?toast=Missing+work+order");
  const redirectTo = txt(formData, "redirect_to") || `/carving/work-orders/${woId}`;
  const sep = redirectTo.includes("?") ? "&" : "?";
  const now = new Date().toISOString();
  const { error } = await admin
    .from("carving_work_orders")
    .update({ handed_over_at: now, handed_over_by: profile.id, updated_at: now, updated_by: profile.id })
    .eq("id", woId)
    .in("status", ["open", "in_progress"]);
  if (error) redirect(`${redirectTo}${sep}toast=${encodeURIComponent(error.message)}`);
  await logAudit(profile.id, "work_order_handed_over", "carving_work_order", woId, {});
  refreshAll();
  redirect(`${redirectTo}${sep}toast=${encodeURIComponent("Handed over to vendor — you can now send slabs")}`);
}

// Owner rejects a pending work order (with a reason). Office team can edit
// and re-create / re-submit.
export async function rejectWorkOrderAction(formData: FormData) {
  const { profile } = await requireAuth(["developer", "owner"]);
  const admin = createAdminSupabaseClient();
  const woId = txt(formData, "work_order_id");
  const reason = txt(formData, "reason") || null;
  if (!woId) redirect("/carving/work-orders?toast=Missing+work+order");
  const now = new Date().toISOString();
  await admin
    .from("carving_work_orders")
    .update({ status: "rejected", rejected_at: now, rejected_by: profile.id, reject_reason: reason, updated_at: now, updated_by: profile.id })
    .eq("id", woId)
    .eq("status", "pending_approval");
  // Daksh June 2026 — release the slabs. A rejected work order's lines were
  // still 'planned', which kept every slab on it hostage: hidden from the
  // New-work-order picker (it skips slabs with a planned line) even though
  // they were back in the cut_done pool and visible in CNC-unassigned. Cancel
  // the lines, mirroring cancelWorkOrderAction, so the slabs are free again.
  await admin
    .from("carving_work_order_items")
    .update({ line_status: "cancelled" })
    .eq("work_order_id", woId)
    .eq("line_status", "planned");
  await logAudit(profile.id, "work_order_rejected", "carving_work_order", woId, { reason });
  refreshAll();
  redirect(`/carving/work-orders?toast=${encodeURIComponent("Work order rejected")}`);
}

export async function addWorkOrderLineAction(formData: FormData) {
  // Mig 098 — editing a work order's lines is owner-only.
  const { profile } = await requireAuth(["developer", "owner"]);
  const admin = createAdminSupabaseClient();
  const woId = txt(formData, "work_order_id");
  if (!woId) redirect("/carving/work-orders?toast=Missing+work+order");
  const slabId = txt(formData, "slab_requirement_id") || null;
  const description = txt(formData, "description") || null;
  if (!slabId && !description) {
    redirect(`/carving/work-orders/${woId}?toast=Add+a+slab+or+a+description`);
  }
  const { data: maxRow } = await admin
    .from("carving_work_order_items")
    .select("position")
    .eq("work_order_id", woId)
    .order("position", { ascending: false })
    .limit(1);
  const nextPos = ((maxRow?.[0] as { position: number } | undefined)?.position ?? -1) + 1;
  await admin.from("carving_work_order_items").insert({
    work_order_id: woId,
    slab_requirement_id: slabId,
    description,
    qty: 1,
    line_status: "planned",
    position: nextPos,
  });
  await logAudit(profile.id, "work_order_line_added", "carving_work_order", woId, {});
  refreshAll();
  redirect(`/carving/work-orders/${woId}?toast=Line+added`);
}

export async function bindSlabToWorkOrderLineAction(formData: FormData) {
  await requireAuth(["developer", "owner"]);
  const admin = createAdminSupabaseClient();
  const lineId = txt(formData, "line_id");
  const woId = txt(formData, "work_order_id");
  const slabId = txt(formData, "slab_requirement_id");
  if (!lineId || !slabId) redirect(`/carving/work-orders/${woId}?toast=Pick+a+slab`);
  await admin
    .from("carving_work_order_items")
    .update({ slab_requirement_id: slabId })
    .eq("id", lineId)
    .eq("line_status", "planned");
  refreshAll();
  redirect(`/carving/work-orders/${woId}?toast=Slab+linked`);
}

export async function removeWorkOrderLineAction(formData: FormData) {
  await requireAuth(["developer", "owner"]);
  const admin = createAdminSupabaseClient();
  const lineId = txt(formData, "line_id");
  const woId = txt(formData, "work_order_id");
  if (!lineId) redirect(`/carving/work-orders/${woId}?toast=Missing+line`);
  // Only remove planned (un-sent) lines.
  await admin
    .from("carving_work_order_items")
    .update({ line_status: "cancelled" })
    .eq("id", lineId)
    .eq("line_status", "planned");
  refreshAll();
  redirect(`/carving/work-orders/${woId}?toast=Line+removed`);
}

export async function sendWorkOrderLineToVendorAction(formData: FormData) {
  const { profile } = await requireAuth([...WO_ROLES]);
  const admin = createAdminSupabaseClient();
  const lineId = txt(formData, "line_id");
  const woId = txt(formData, "work_order_id");
  if (!lineId) redirect(`/carving/work-orders/${woId}?toast=Missing+line`);

  const { data: lineRow } = await admin
    .from("carving_work_order_items")
    .select("id, work_order_id, slab_requirement_id, carving_item_id, line_status, jobwork_rate, jobwork_unit")
    .eq("id", lineId)
    .maybeSingle();
  const line = lineRow as {
    id: string;
    work_order_id: string;
    slab_requirement_id: string | null;
    carving_item_id: string | null;
    line_status: string;
    jobwork_rate: number | string | null;
    jobwork_unit: string | null;
  } | null;
  if (!line) redirect(`/carving/work-orders/${woId}?toast=Line+not+found`);
  if (line!.line_status !== "planned" || line!.carving_item_id) {
    redirect(`/carving/work-orders/${woId}?toast=Line+already+sent`);
  }
  if (!line!.slab_requirement_id) {
    redirect(`/carving/work-orders/${woId}?toast=Link+a+cut+slab+to+this+line+first`);
  }

  const { data: woRow } = await admin
    .from("carving_work_orders")
    .select("id, vendor_id, vendor_name, jobwork_rate, jobwork_unit, status, handed_over_at")
    .eq("id", line!.work_order_id)
    .maybeSingle();
  const wo = woRow as {
    vendor_id: string;
    vendor_name: string;
    jobwork_rate: number | string | null;
    jobwork_unit: string | null;
    status: string;
    handed_over_at: string | null;
  } | null;
  if (!wo) redirect(`/carving/work-orders/${woId}?toast=Work+order+not+found`);
  // Mig 098 — a work order must be owner-approved before any slab is sent.
  if (wo!.status !== "open" && wo!.status !== "in_progress") {
    redirect(`/carving/work-orders/${woId}?toast=${encodeURIComponent("Needs owner approval before sending")}`);
  }
  // Mig 100 — the work order must be handed over to the vendor first.
  if (!wo!.handed_over_at) {
    redirect(`/carving/work-orders/${woId}?toast=${encodeURIComponent("Hand over to the vendor first, then send")}`);
  }

  const rate =
    line!.jobwork_rate != null
      ? Number(line!.jobwork_rate)
      : wo!.jobwork_rate != null
        ? Number(wo!.jobwork_rate)
        : null;
  const uSingle = line!.jobwork_unit ?? wo!.jobwork_unit;
  const unit = uSingle === "sft" ? "sft" : uSingle === "job" ? "job" : "cft";

  const res = await sendSlabToOutsourceVendor(admin, {
    slabId: line!.slab_requirement_id,
    vendorId: wo!.vendor_id,
    vendorName: wo!.vendor_name,
    rate,
    unit,
    profileId: profile.id,
  });
  if (!res.ok) {
    redirect(`/carving/work-orders/${woId}?toast=${encodeURIComponent(res.reason)}`);
  }

  await admin
    .from("carving_work_order_items")
    .update({ carving_item_id: res.id, line_status: "sent", sent_batch_at: new Date().toISOString() })
    .eq("id", lineId);
  await admin
    .from("carving_work_orders")
    .update({ status: "in_progress", updated_at: new Date().toISOString(), updated_by: profile.id })
    .eq("id", line!.work_order_id)
    .eq("status", "open");
  await logAudit(profile.id, "work_order_line_sent", "carving_work_order", line!.work_order_id, {
    line_id: lineId,
    carving_item_id: res.id,
  });
  refreshAll();
  // ?sent=<code> → the detail page offers a gate pass for the batch just sent.
  redirect(`/carving/work-orders/${woId}?toast=Sent+to+vendor&sent=${encodeURIComponent(line!.slab_requirement_id!)}`);
}

// Daksh June 2026 — send EVERY ready (cut-done, un-sent) line of a work
// order to the vendor in one press. Loops the per-line bridge so the head
// doesn't tap Send slab-by-slab. Lines whose slab isn't cut-done yet are
// skipped (stay planned). Office roles only.
export async function sendAllReadyWorkOrderLinesAction(formData: FormData) {
  const { profile } = await requireAuth([...WO_ROLES]);
  const admin = createAdminSupabaseClient();
  const woId = txt(formData, "work_order_id");
  if (!woId) redirect("/carving/work-orders?toast=Missing+work+order");

  const { data: woRow } = await admin
    .from("carving_work_orders")
    .select("id, vendor_id, vendor_name, jobwork_rate, jobwork_unit, status, handed_over_at")
    .eq("id", woId)
    .maybeSingle();
  const wo = woRow as {
    vendor_id: string;
    vendor_name: string;
    jobwork_rate: number | string | null;
    jobwork_unit: string | null;
    status: string;
    handed_over_at: string | null;
  } | null;
  if (!wo) redirect(`/carving/work-orders/${woId}?toast=Work+order+not+found`);
  // Mig 098 — only send once the owner has approved the work order.
  if (wo!.status !== "open" && wo!.status !== "in_progress") {
    redirect(`/carving/work-orders/${woId}?toast=${encodeURIComponent("Needs owner approval before sending")}`);
  }
  // Mig 100 — the work order must be handed over to the vendor first.
  if (!wo!.handed_over_at) {
    redirect(`/carving/work-orders/${woId}?toast=${encodeURIComponent("Hand over to the vendor first, then send")}`);
  }

  const { data: lineRows } = await admin
    .from("carving_work_order_items")
    .select("id, slab_requirement_id, carving_item_id, line_status, jobwork_rate, jobwork_unit, position")
    .eq("work_order_id", woId)
    .eq("line_status", "planned")
    .is("carving_item_id", null)
    .not("slab_requirement_id", "is", null)
    .order("position", { ascending: true });
  const lines = (lineRows ?? []) as Array<{
    id: string;
    slab_requirement_id: string;
    jobwork_rate: number | string | null;
    jobwork_unit: string | null;
  }>;
  if (lines.length === 0) {
    redirect(`/carving/work-orders/${woId}?toast=No+ready+lines+to+send`);
  }

  let sent = 0;
  const sentCodes: string[] = [];
  const batchAt = new Date().toISOString(); // one gate-pass batch per send action
  for (const line of lines) {
    const rate =
      line.jobwork_rate != null
        ? Number(line.jobwork_rate)
        : wo!.jobwork_rate != null
          ? Number(wo!.jobwork_rate)
          : null;
    const u = line.jobwork_unit ?? wo!.jobwork_unit;
    const unit = u === "sft" ? "sft" : u === "job" ? "job" : "cft";
    const res = await sendSlabToOutsourceVendor(admin, {
      slabId: line.slab_requirement_id,
      vendorId: wo!.vendor_id,
      vendorName: wo!.vendor_name,
      rate,
      unit,
      profileId: profile.id,
    });
    if (res.ok) {
      await admin
        .from("carving_work_order_items")
        .update({ carving_item_id: res.id, line_status: "sent", sent_batch_at: batchAt })
        .eq("id", line.id);
      sent += 1;
      sentCodes.push(line.slab_requirement_id);
    }
    // Not cut-done yet → skip; the line stays planned for next time.
  }
  if (sent > 0) {
    await admin
      .from("carving_work_orders")
      .update({ status: "in_progress", updated_at: new Date().toISOString(), updated_by: profile.id })
      .eq("id", woId)
      .eq("status", "open");
  }
  await logAudit(profile.id, "work_order_send_all", "carving_work_order", woId, { sent });
  refreshAll();
  // ?sent=<codes> → the detail page offers a gate pass for the batch just sent.
  redirect(
    `/carving/work-orders/${woId}?toast=${encodeURIComponent(
      sent > 0 ? `📤 Sent ${sent} to vendor` : "Nothing ready to send yet",
    )}${sent > 0 ? `&sent=${encodeURIComponent(sentCodes.join(","))}` : ""}`,
  );
}

// Daksh — send a SELECTED subset of a work order's ready lines (checkbox pick
// on the detail page), not just all-or-one. Same gates as send-all; only the
// chosen, cut-done, un-sent lines go.
export async function sendSelectedWorkOrderLinesAction(formData: FormData) {
  const { profile } = await requireAuth([...WO_ROLES]);
  const admin = createAdminSupabaseClient();
  const woId = txt(formData, "work_order_id");
  if (!woId) redirect("/carving/work-orders?toast=Missing+work+order");
  let lineIds: string[] = [];
  try { lineIds = JSON.parse(txt(formData, "line_ids") || "[]"); } catch { lineIds = []; }
  lineIds = (Array.isArray(lineIds) ? lineIds : []).filter(Boolean);
  if (lineIds.length === 0) redirect(`/carving/work-orders/${woId}?toast=No+slabs+selected`);

  const { data: woRow } = await admin
    .from("carving_work_orders")
    .select("id, vendor_id, vendor_name, jobwork_rate, jobwork_unit, status, handed_over_at")
    .eq("id", woId)
    .maybeSingle();
  const wo = woRow as {
    vendor_id: string; vendor_name: string; jobwork_rate: number | string | null;
    jobwork_unit: string | null; status: string; handed_over_at: string | null;
  } | null;
  if (!wo) redirect(`/carving/work-orders/${woId}?toast=Work+order+not+found`);
  if (wo!.status !== "open" && wo!.status !== "in_progress") {
    redirect(`/carving/work-orders/${woId}?toast=${encodeURIComponent("Needs owner approval before sending")}`);
  }
  if (!wo!.handed_over_at) {
    redirect(`/carving/work-orders/${woId}?toast=${encodeURIComponent("Hand over to the vendor first, then send")}`);
  }

  const { data: lineRows } = await admin
    .from("carving_work_order_items")
    .select("id, slab_requirement_id, carving_item_id, line_status, jobwork_rate, jobwork_unit")
    .eq("work_order_id", woId)
    .in("id", lineIds)
    .eq("line_status", "planned")
    .is("carving_item_id", null)
    .not("slab_requirement_id", "is", null);
  const lines = (lineRows ?? []) as Array<{
    id: string; slab_requirement_id: string;
    jobwork_rate: number | string | null; jobwork_unit: string | null;
  }>;
  if (lines.length === 0) redirect(`/carving/work-orders/${woId}?toast=No+ready+lines+to+send`);

  let sent = 0;
  const sentCodes: string[] = [];
  const batchAt = new Date().toISOString(); // one gate-pass batch per send action
  for (const line of lines) {
    const rate =
      line.jobwork_rate != null ? Number(line.jobwork_rate)
        : wo!.jobwork_rate != null ? Number(wo!.jobwork_rate) : null;
    const u = line.jobwork_unit ?? wo!.jobwork_unit;
    const unit = u === "sft" ? "sft" : u === "job" ? "job" : "cft";
    const res = await sendSlabToOutsourceVendor(admin, {
      slabId: line.slab_requirement_id,
      vendorId: wo!.vendor_id,
      vendorName: wo!.vendor_name,
      rate,
      unit,
      profileId: profile.id,
    });
    if (res.ok) {
      await admin.from("carving_work_order_items").update({ carving_item_id: res.id, line_status: "sent", sent_batch_at: batchAt }).eq("id", line.id);
      sent += 1;
      sentCodes.push(line.slab_requirement_id);
    }
  }
  if (sent > 0) {
    await admin
      .from("carving_work_orders")
      .update({ status: "in_progress", updated_at: new Date().toISOString(), updated_by: profile.id })
      .eq("id", woId)
      .eq("status", "open");
  }
  await logAudit(profile.id, "work_order_send_selected", "carving_work_order", woId, { sent, requested: lineIds.length });
  refreshAll();
  redirect(
    `/carving/work-orders/${woId}?toast=${encodeURIComponent(
      sent > 0 ? `📤 Sent ${sent} to vendor` : "Nothing ready to send",
    )}${sent > 0 ? `&sent=${encodeURIComponent(sentCodes.join(","))}` : ""}`,
  );
}

// Mig 098 follow-up — owner/dev can pull a slab back OFF the vendor and
// return its work-order line to 'planned' (assigned in the work order but
// NOT yet shipped). Works even when the slab is active (being carved) or
// approved (Carving Done). Deletes the carving_item and resets the slab to
// cut_done so it can be re-sent later. Blocked once the slab is billed on a
// live challan or already dispatched (undo those first).
export async function recallWorkOrderLineAction(formData: FormData) {
  const { profile } = await requireAuth(["developer", "owner"]);
  const admin = createAdminSupabaseClient();
  const lineId = txt(formData, "line_id");
  const woId = txt(formData, "work_order_id");
  if (!lineId) redirect(`/carving/work-orders/${woId}?toast=Missing+line`);

  const { data: lineRow } = await admin
    .from("carving_work_order_items")
    .select("id, work_order_id, slab_requirement_id, carving_item_id, line_status")
    .eq("id", lineId)
    .maybeSingle();
  const line = lineRow as {
    work_order_id: string;
    slab_requirement_id: string | null;
    carving_item_id: string | null;
    line_status: string;
  } | null;
  if (!line) redirect(`/carving/work-orders/${woId}?toast=Line+not+found`);
  if (!line!.carving_item_id) redirect(`/carving/work-orders/${woId}?toast=Nothing+to+recall`);

  // Block if this slab is already billed on a live (non-cancelled) challan.
  const { data: billedRows } = await admin
    .from("carving_challan_items")
    .select("id, carving_challans!inner(cancelled_at)")
    .eq("carving_item_id", line!.carving_item_id);
  const billed = ((billedRows ?? []) as unknown as Array<{ carving_challans: { cancelled_at: string | null } | null }>).some(
    (r) => !r.carving_challans?.cancelled_at,
  );
  if (billed) {
    redirect(`/carving/work-orders/${woId}?toast=${encodeURIComponent("Cancel its challan first, then recall")}`);
  }

  // Block if the slab has already been dispatched.
  if (line!.slab_requirement_id) {
    const { data: slabRow } = await admin
      .from("slab_requirements")
      .select("status")
      .eq("id", line!.slab_requirement_id)
      .maybeSingle();
    if ((slabRow as { status: string } | null)?.status === "dispatched") {
      redirect(`/carving/work-orders/${woId}?toast=${encodeURIComponent("Already dispatched — cannot recall")}`);
    }
  }

  await recordEvent(line!.carving_item_id, "cancelled", profile.id, "Recalled to work order (un-shipped) by owner");
  await admin.from("carving_items").delete().eq("id", line!.carving_item_id);
  if (line!.slab_requirement_id) {
    await admin
      .from("slab_requirements")
      .update({ status: "cut_done", updated_by: profile.id, updated_at: new Date().toISOString() })
      .eq("id", line!.slab_requirement_id);
  }
  await admin
    .from("carving_work_order_items")
    .update({ carving_item_id: null, line_status: "planned" })
    .eq("id", lineId);
  await logAudit(profile.id, "work_order_line_recalled", "carving_work_order", line!.work_order_id, {
    line_id: lineId,
    carving_item_id: line!.carving_item_id,
  });
  refreshAll();
  redirect(`/carving/work-orders/${woId}?toast=${encodeURIComponent("Recalled — back to not yet shipped")}`);
}

export async function cancelWorkOrderAction(formData: FormData) {
  // Mig 098 — only the owner (or dev) can cancel a work order.
  const { profile } = await requireAuth(["developer", "owner"]);
  const admin = createAdminSupabaseClient();
  const woId = txt(formData, "work_order_id");
  const reason = txt(formData, "reason") || null;
  if (!woId) redirect("/carving/work-orders?toast=Missing+work+order");
  const now = new Date().toISOString();

  // Cancel only the un-sent (planned) lines — sent lines have live carving_items
  // and continue through the normal flow.
  await admin
    .from("carving_work_order_items")
    .update({ line_status: "cancelled" })
    .eq("work_order_id", woId)
    .eq("line_status", "planned");

  // Daksh — a work order is only "cancelled" when NOTHING is left in it. If
  // slabs are still out at the vendor it isn't cancelled: completed if they're
  // all approved, else in_progress. Removable-from-list ⟺ truly empty.
  const { data: remaining } = await admin
    .from("carving_work_order_items")
    .select("carving_item_id")
    .eq("work_order_id", woId)
    .neq("line_status", "cancelled");
  const active = (remaining ?? []) as Array<{ carving_item_id: string | null }>;
  let status = "cancelled";
  let cancelledAt: string | null = now;
  let cancelReason: string | null = reason;
  if (active.length > 0) {
    cancelledAt = null;
    cancelReason = null;
    const ciIds = active.map((a) => a.carving_item_id).filter(Boolean) as string[];
    let allApproved = ciIds.length === active.length && ciIds.length > 0;
    if (allApproved) {
      const { data: cis } = await admin.from("carving_items").select("review_approved_at").in("id", ciIds);
      const rows = (cis ?? []) as Array<{ review_approved_at: string | null }>;
      allApproved = rows.length === ciIds.length && rows.every((c) => !!c.review_approved_at);
    }
    status = allApproved ? "completed" : "in_progress";
  }

  await admin
    .from("carving_work_orders")
    .update({ status, cancelled_at: cancelledAt, cancel_reason: cancelReason, updated_at: now, updated_by: profile.id })
    .eq("id", woId);
  await logAudit(profile.id, "work_order_cancelled", "carving_work_order", woId, { reason, kept_active: active.length, status });
  refreshAll();
  redirect(`/carving/work-orders?toast=${encodeURIComponent(active.length === 0 ? "Work order cancelled" : `Un-sent lines cancelled · ${active.length} still at vendor`)}`);
}

// Mig 135 — soft-hide a cancelled / rejected work order from the Outsource
// list. Owner/dev only; the record + its history are kept (audit), it just
// stops cluttering the list. Guarded so it never hides a live order.
export async function dismissWorkOrderAction(formData: FormData) {
  const { profile } = await requireAuth(["developer", "owner"]);
  const admin = createAdminSupabaseClient();
  const woId = txt(formData, "work_order_id");
  if (!woId) redirect("/carving?mode=outsource&tab=workorders&toast=Missing+work+order");
  const { data: row } = await admin.from("carving_work_orders").select("status").eq("id", woId).maybeSingle();
  const status = (row as { status?: string } | null)?.status;
  if (status !== "cancelled" && status !== "rejected") {
    redirect(`/carving?mode=outsource&tab=workorders&toast=${encodeURIComponent("Only cancelled / rejected orders can be removed")}`);
  }
  const { error } = await admin
    .from("carving_work_orders")
    .update({ dismissed_at: new Date().toISOString(), dismissed_by: profile.id })
    .eq("id", woId);
  if (error) redirect(`/carving?mode=outsource&tab=workorders&toast=${encodeURIComponent(error.message)}`);
  await logAudit(profile.id, "work_order_dismissed", "carving_work_order", woId, {});
  refreshAll();
  redirect("/carving?mode=outsource&tab=workorders&toast=Removed+from+list");
}

// ── Job event timeline — used by JobDetailPeek modal ─────────────
//
// Returns the carving_job_events for a single carving_item, with
// user names hydrated. Same shape the legacy /carving/[id] detail
// page renders, just delivered as a server-action call so the peek
// modal can mount it without a route navigation.
export type JobEvent = {
  id: string;
  event_type: string;
  message: string | null;
  created_at: string;
  user_name: string | null;
};

export async function getJobEvents(jobId: string): Promise<JobEvent[]> {
  await requireAuth(["developer", "owner", "carving_head", "senior_incharge", "tender_manager"]);
  const admin = createAdminSupabaseClient();

  const { data: events } = await admin
    .from("carving_job_events")
    .select("id, event_type, message, created_at, user_id")
    .eq("carving_item_id", jobId)
    .order("created_at", { ascending: false })
    .limit(200);

  const userIds = [
    ...new Set(
      ((events ?? []) as { user_id: string | null }[])
        .map((e) => e.user_id)
        .filter(Boolean) as string[],
    ),
  ];
  const { data: profs } = userIds.length > 0
    ? await admin.from("profiles").select("id, full_name").in("id", userIds)
    : { data: [] as { id: string; full_name: string | null }[] };
  const nameById = new Map<string, string>();
  for (const p of profs ?? []) nameById.set(p.id, p.full_name ?? "—");

  return ((events ?? []) as Array<{
    id: string; event_type: string; message: string | null;
    created_at: string; user_id: string | null;
  }>).map((e) => ({
    id: e.id,
    event_type: e.event_type,
    message: e.message,
    created_at: e.created_at,
    user_name: e.user_id ? nameById.get(e.user_id) ?? null : null,
  }));
}

// ── Machine history — events + computed aggregates ────────────────
//
// Surfaces a machine's full event timeline (loaded / unloaded /
// maintenance start / maintenance end) plus rolled-up totals so the
// supervisor can see at a glance:
//   • how much time the machine has spent CARVING vs DOWN over a
//     given window (default last 30d)
//   • how many slabs it has produced
//   • how many maintenance episodes it had + cumulative downtime
//
// Read-only; can be called from any logged-in user with carving-
// related access.
export type MachineEvent = {
  id: string;
  event_type: string;
  carving_item_id: string | null;
  reason: string | null;
  message: string | null;
  user_id: string | null;
  user_name: string | null;
  slab_id: string | null;
  created_at: string;
};

export type MachineHistory = {
  machine: {
    id: string;
    machine_code: string;
    operator_name: string | null;
    machine_type: "single_head" | "multi_head_2" | "lathe";
    status: string;
  };
  windowDays: number;
  totals: {
    /** Number of carving sessions completed in the window. */
    sessions: number;
    /** Total minutes the machine spent carving (sum of unload − load
     *  pairs). Open sessions count up to "now". */
    carvingMinutes: number;
    /** Number of maintenance episodes started in the window. */
    maintEpisodes: number;
    /** Total minutes the machine spent in maintenance (sum of end −
     *  start pairs). Open episodes count up to "now". */
    maintMinutes: number;
  };
  events: MachineEvent[];
};

export async function getMachineHistory(
  machineId: string,
  windowDays = 30,
): Promise<MachineHistory | null> {
  await requireAuth(["developer", "owner", "carving_head", "vendor"]);
  const admin = createAdminSupabaseClient();

  const sinceIso = new Date(Date.now() - windowDays * 86400000).toISOString();

  const [{ data: machine }, { data: rawEvents }] = await Promise.all([
    admin
      .from("cnc_machines")
      .select("id, machine_code, operator_name, machine_type, status")
      .eq("id", machineId)
      .maybeSingle(),
    admin
      .from("cnc_machine_events")
      .select("id, event_type, carving_item_id, reason, message, user_id, created_at")
      .eq("cnc_machine_id", machineId)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(500),
  ]);

  if (!machine) return null;
  const m = machine as {
    id: string;
    machine_code: string;
    operator_name: string | null;
    machine_type: string | null;
    status: string;
  };

  // Hydrate user names + slab ids in one round-trip each.
  const userIds = [...new Set((rawEvents ?? [])
    .map((e) => (e as { user_id: string | null }).user_id)
    .filter(Boolean) as string[])];
  const itemIds = [...new Set((rawEvents ?? [])
    .map((e) => (e as { carving_item_id: string | null }).carving_item_id)
    .filter(Boolean) as string[])];

  const [{ data: profs }, { data: items }] = await Promise.all([
    userIds.length > 0
      ? admin.from("profiles").select("id, full_name").in("id", userIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string | null }[] }),
    itemIds.length > 0
      ? admin
          .from("carving_items")
          .select("id, slab_requirement_id")
          .in("id", itemIds)
      : Promise.resolve({ data: [] as { id: string; slab_requirement_id: string }[] }),
  ]);
  const nameById = new Map<string, string>();
  for (const p of profs ?? []) nameById.set(p.id, p.full_name ?? "—");
  const slabIdByItem = new Map<string, string>();
  for (const i of items ?? []) slabIdByItem.set(i.id, i.slab_requirement_id);

  const events: MachineEvent[] = ((rawEvents ?? []) as Array<{
    id: string; event_type: string; carving_item_id: string | null;
    reason: string | null; message: string | null; user_id: string | null;
    created_at: string;
  }>).map((e) => ({
    id: e.id,
    event_type: e.event_type,
    carving_item_id: e.carving_item_id,
    reason: e.reason,
    message: e.message,
    user_id: e.user_id,
    user_name: e.user_id ? nameById.get(e.user_id) ?? null : null,
    slab_id: e.carving_item_id ? slabIdByItem.get(e.carving_item_id) ?? null : null,
    created_at: e.created_at,
  }));

  // Walk the events in chronological order and pair load↔unload +
  // maintenance_start↔maintenance_end to compute durations. Open
  // sessions / episodes count up to `now`.
  const chronological = [...events].reverse();
  const now = Date.now();
  let carvingMinutes = 0;
  let sessions = 0;
  let maintMinutes = 0;
  let maintEpisodes = 0;
  let openLoadAt: number | null = null;
  let openMaintAt: number | null = null;
  for (const ev of chronological) {
    const t = new Date(ev.created_at).getTime();
    if (ev.event_type === "loaded") {
      openLoadAt = t;
    } else if (ev.event_type === "unloaded") {
      if (openLoadAt != null) {
        carvingMinutes += (t - openLoadAt) / 60000;
        sessions += 1;
        openLoadAt = null;
      }
    } else if (ev.event_type === "maintenance_start") {
      openMaintAt = t;
      maintEpisodes += 1;
    } else if (ev.event_type === "maintenance_end") {
      if (openMaintAt != null) {
        maintMinutes += (t - openMaintAt) / 60000;
        openMaintAt = null;
      }
    }
  }
  // Currently-open session / episode → count up to now.
  if (openLoadAt != null) {
    carvingMinutes += (now - openLoadAt) / 60000;
    sessions += 1; // still in progress; show in count
  }
  if (openMaintAt != null) {
    maintMinutes += (now - openMaintAt) / 60000;
  }

  return {
    machine: {
      id: m.id,
      machine_code: m.machine_code,
      operator_name: m.operator_name,
      machine_type:
        m.machine_type === "multi_head_2" || m.machine_type === "lathe"
          ? (m.machine_type as "multi_head_2" | "lathe")
          : "single_head",
      status: m.status,
    },
    windowDays,
    totals: {
      sessions,
      carvingMinutes: Math.round(carvingMinutes),
      maintEpisodes,
      maintMinutes: Math.round(maintMinutes),
    },
    events,
  };
}

// ──────────────────────────────────────────────────────────────────
// Mig 118 — "Involve owner" from Carving Done Approval.
// The reviewer escalates a problem (e.g. "No slab code") to the owner.
// The slab stays approvable/reworkable; state lives on the carving_items
// row (one open issue per slab) and surfaces on the owner Tasks page.
// ──────────────────────────────────────────────────────────────────
const OWNER_REVIEW_KINDS = new Set(["no_slab_code", "other"]);

/** Reviewer flags a slab for the owner's attention. Called from the approval
 *  modal with stay=1, so it RETURNS a {ok,error} result instead of throwing —
 *  server-action throws are redacted to a generic message in production, which
 *  hid the real cause. The client reads `error` and shows it inline. */
export async function involveOwnerAction(
  formData: FormData,
): Promise<{ ok: boolean; error?: string } | void> {
  const { profile } = await requireAuth(["developer", "owner", "carving_head", "senior_incharge", "tender_manager"]);
  const admin = createAdminSupabaseClient();
  const jobId = txt(formData, "job_id");
  const stay = txt(formData, "stay") === "1";
  const kind = txt(formData, "problem_kind");
  const note = txt(formData, "problem_note") || null;

  const fail = (msg: string): { ok: false; error: string } | never => {
    if (stay) return { ok: false, error: msg };
    redirect(`/carving?toast=${encodeURIComponent(msg)}`);
  };
  if (!jobId) return fail("Missing job id.");
  if (!OWNER_REVIEW_KINDS.has(kind)) return fail("Pick a problem to report.");
  if (kind === "other" && !note) return fail("Describe the problem when choosing 'Other'.");

  const now = new Date().toISOString();
  const { error } = await admin
    .from("carving_items")
    .update({
      owner_review_status: "open",
      owner_review_kind: kind,
      owner_review_note: kind === "no_slab_code" ? (note ?? "No slab code") : note,
      owner_review_by: profile.id,
      owner_review_at: now,
      // Re-raising after a previous resolution clears the old resolution.
      owner_review_resolved_by: null,
      owner_review_resolved_at: null,
      owner_review_resolution_note: null,
    })
    .eq("id", jobId);
  if (error) {
    return fail(
      /owner_review/i.test(error.message)
        ? "Owner-review columns missing — run migration 118 in Supabase, then retry."
        : error.message,
    );
  }
  void logAudit(profile.id, "carving_owner_involved", "carving_item", jobId, { kind });
  if (stay) return { ok: true };
  redirect("/carving?toast=Sent+to+owner+for+review");
}

/** Owner / developer marks an involved slab resolved (from the Tasks page). */
export async function resolveOwnerReviewAction(formData: FormData) {
  const { profile } = await requireAuth(["owner", "developer"]);
  const admin = createAdminSupabaseClient();
  const jobId = txt(formData, "job_id");
  const note = txt(formData, "resolution_note") || null;
  if (!jobId) redirect("/tasks/owner-reviews?toast=Missing+id");

  const now = new Date().toISOString();
  const { error } = await admin
    .from("carving_items")
    .update({
      owner_review_status: "resolved",
      owner_review_resolved_by: profile.id,
      owner_review_resolved_at: now,
      owner_review_resolution_note: note,
    })
    .eq("id", jobId)
    .eq("owner_review_status", "open");
  if (error) redirect(`/tasks/owner-reviews?toast=${encodeURIComponent(error.message)}`);
  void logAudit(profile.id, "carving_owner_resolved", "carving_item", jobId, {});
  revalidatePath("/tasks/owner-reviews");
  redirect("/tasks/owner-reviews?toast=Issue+resolved");
}

// ────────────────────────────────────────────────────────────────────────────
// Temporary Storage / "park" (mig 125, Daksh June 2026)
//
// Move cut-done slabs that are "ready to assign to carving" into a temporary
// Storage so they stop cluttering the Unassigned list (a historical backlog
// that was, in reality, already carved & shipped). Parked slabs keep
// status='cut_done' — nothing else changes — they're just hidden from the
// assign list. Bringing one back clears the flag. Owner / dev / carving_head.
// ────────────────────────────────────────────────────────────────────────────

function canManageStorage(role: string): boolean {
  return role === "owner" || role === "developer" || role === "carving_head";
}

/** Park selected cut-done slabs (hide from the carving Unassigned list). */
export async function parkSlabsAction(
  ids: string[],
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const { profile } = await requireAuth();
  if (!canManageStorage(profile.role)) return { ok: false, error: "Not allowed." };
  const list = (Array.isArray(ids) ? ids : []).map((s) => String(s).trim()).filter(Boolean);
  if (list.length === 0) return { ok: false, error: "No slabs selected." };
  const admin = createAdminSupabaseClient();
  // Only park slabs that are genuinely still ready-to-assign (cut_done,
  // not already parked) — never touch in-flight or assigned slabs.
  const { data, error } = await admin
    .from("slab_requirements")
    .update({ is_parked: true, parked_at: new Date().toISOString(), parked_by: profile.id })
    .in("id", list)
    .eq("status", "cut_done")
    .eq("is_parked", false)
    .select("id");
  if (error) return { ok: false, error: error.message };
  const count = (data ?? []).length;
  void logAudit(profile.id, "slabs_parked", "slab", "batch", { count });
  revalidatePath("/carving");
  revalidatePath("/carving/storage");
  return { ok: true, count };
}

/** Park EVERY currently-unassigned slab (one-click clear of the backlog). */
export async function parkAllUnassignedAction(): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const { profile } = await requireAuth();
  if (!canManageStorage(profile.role)) return { ok: false, error: "Not allowed." };
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("slab_requirements")
    .update({ is_parked: true, parked_at: new Date().toISOString(), parked_by: profile.id })
    .eq("status", "cut_done")
    .eq("is_parked", false)
    .select("id");
  if (error) return { ok: false, error: error.message };
  const count = (data ?? []).length;
  void logAudit(profile.id, "slabs_parked_all", "slab", "batch", { count });
  revalidatePath("/carving");
  revalidatePath("/carving/storage");
  return { ok: true, count };
}

/** Bring parked slabs back into the Unassigned list. */
export async function unparkSlabsAction(
  ids: string[],
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const { profile } = await requireAuth();
  if (!canManageStorage(profile.role)) return { ok: false, error: "Not allowed." };
  const list = (Array.isArray(ids) ? ids : []).map((s) => String(s).trim()).filter(Boolean);
  if (list.length === 0) return { ok: false, error: "No slabs selected." };
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("slab_requirements")
    .update({ is_parked: false, parked_at: null, parked_by: null })
    .in("id", list)
    .eq("is_parked", true)
    .select("id");
  if (error) return { ok: false, error: error.message };
  const count = (data ?? []).length;
  void logAudit(profile.id, "slabs_unparked", "slab", "batch", { count });
  revalidatePath("/carving");
  revalidatePath("/carving/storage");
  return { ok: true, count };
}

// ── Direct Dispatch (mig 130) ──────────────────────────────────────
// Some slabs skip carving entirely — cut, then straight onto a truck.
// This flips the selected cut_done slabs to 'completed' (so they appear
// in Dispatch → Make Dispatch) and stamps direct_dispatched_at/by as the
// permanent record. Flipping the status also removes them from CNC
// Unassigned and from the Outsource work-order picker (both fetch
// status='cut_done' only).
//
// PRE-CUT slabs (block still cutting, mig 126) are ALLOWED too (Daksh):
// the slab is physically cut, so it can roll. Mig 131 guards the final
// finish_block_cut so the eventual cutting approval never drags an
// already-advanced slab back to cut_done.
export async function directDispatchSlabsAction(
  formData: FormData,
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const { profile } = await requireAuth(["developer", "owner", "carving_head", "senior_incharge", "tender_manager"]);
  const admin = createAdminSupabaseClient();

  const slabIds = JSON.parse(String(formData.get("slab_ids") || "[]")) as string[];

  try {
    if (!Array.isArray(slabIds) || slabIds.length === 0) {
      throw new Error("Select at least one slab.");
    }

    // Race-guarded flip: only slabs still cut_done move. Anything
    // assigned/parked/changed since the page loaded is skipped and
    // reported.
    const now = new Date().toISOString();
    const { data: flipped, error } = await admin
      .from("slab_requirements")
      .update({
        status: "completed",
        direct_dispatched_at: now,
        direct_dispatched_by: profile.id,
        updated_by: profile.id,
        updated_at: now,
      })
      .in("id", slabIds)
      .eq("status", "cut_done")
      // Mig 132 — pending-cancel slabs are locked.
      .is("cancel_requested_at", null)
      .select("id, temple");
    if (error) throw new Error(error.message);
    const rows = (flipped ?? []) as Array<{ id: string; temple: string }>;
    const count = rows.length;
    if (count === 0) {
      throw new Error(
        "Nothing moved — the selected slabs are no longer cut-&-ready (already assigned, parked or pending a cancel request). Refresh and retry.",
      );
    }

    const temples = [...new Set(rows.map((r) => r.temple))];
    void Promise.all([
      logAudit(profile.id, "slabs_direct_dispatched", "slab", "batch", {
        slab_ids: rows.map((r) => r.id),
        temples,
        count,
      }),
      notify("direct_dispatch", `${count} slab(s) sent DIRECT to dispatch`, {
        message: `Skipped carving — now in Dispatch → Make Dispatch. Temple(s): ${temples.join(", ")}.`,
        entityType: "slab",
        entityId: rows[0].id,
        actorId: profile.id,
        targetRoles: ["owner", "carving_head", "developer"],
      }),
    ]).catch((e) => console.warn("[directDispatchSlabsAction] audit/notify failed (non-fatal)", e));

    revalidatePath("/carving");
    revalidatePath("/dispatch");
    revalidatePath("/slabs");
    const skipped = slabIds.length - count;
    if (skipped > 0) {
      console.warn(`[directDispatchSlabsAction] ${skipped} of ${slabIds.length} slabs skipped (status changed)`);
    }
    return { ok: true, count };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[directDispatchSlabsAction] FAILED", { slabIds, error: msg });
    return { ok: false, error: msg };
  }
}
