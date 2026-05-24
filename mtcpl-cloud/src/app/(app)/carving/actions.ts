"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

/**
 * Daksh May 2026 — temporary feature flag.
 *
 * The slab_transfer runner role isn't stabilised on the floor yet,
 * so the "yard → vendor shade" handoff step is being skipped: when
 * the carving head assigns a slab to a vendor, the slab is treated
 * as IMMEDIATELY received at the vendor's shade. It bypasses the
 * Pending stock tray and lands straight in Ready to load.
 *
 * Mechanics: assign actions stamp received_at_vendor_at=NOW() +
 * received_at_vendor_by=actor on the new carving_items row when
 * this flag is true.
 *
 * To re-enable the real transfer flow (the day the slab_transfer
 * runner is trained up): flip this to false. Existing assignments
 * already in flight are unaffected — only NEW assignments take
 * the new path.
 *
 * Inter-vendor transfers (Problem/Transfer → other vendor) keep
 * their existing flow because they have their own Accept/Flag
 * self-receive path that doesn't depend on slab_transfer.
 */
const SKIP_SLAB_TRANSFER_STAGE = true;

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

// ── Vendor CRUD (team-side) ─────────────────────────────────────────

export async function createVendorAction(formData: FormData) {
  const { profile } = await requireAuth(["developer", "owner"]);
  const admin = createAdminSupabaseClient();

  const name = txt(formData, "name");
  const vendorType = txt(formData, "vendor_type") as "CNC" | "Manual" | "Outsource";
  const machinesJson = txt(formData, "machines_json");
  // Migration 025 — standard slab dropoff location for CNC vendors.
  const dropoffLocation = txt(formData, "dropoff_location") || null;

  if (!name) redirect("/carving/vendors?toast=Vendor+name+is+required");
  if (!["CNC", "Manual", "Outsource"].includes(vendorType)) {
    redirect("/carving/vendors?toast=Invalid+vendor+type");
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
    redirect(`/carving/vendors?toast=${encodeURIComponent(error?.message ?? "Failed to create vendor")}`);
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
        max_length_in?: number | string | null;
        max_width_in?: number | string | null;
        max_thickness_in?: number | string | null;
      }>;
      const rows = machines
        .filter((m) => m.machine_code.trim())
        .map((m) => ({
          // Belt-and-suspenders: generate the UUID app-side so the
          // insert succeeds even if the cnc_machines.id column is
          // missing its gen_random_uuid() default on the target DB.
          // Migration 022 also restores the default — this is just a
          // second line of defence.
          id: crypto.randomUUID(),
          vendor_id: vendor.id,
          machine_code: m.machine_code.trim(),
          operator_name: m.operator_name?.trim() || null,
          // Default new machines to multi_head_2 — the fleet has no
          // single_head machines in real use. Migration 024 keeps
          // single_head as a legal enum value for any legacy rows.
          machine_type: m.machine_type ?? "multi_head_2",
          // Per-machine dimension caps from migration 024. Empty
          // string / undefined / null → NULL (no limit).
          max_length_in: parseDim(m.max_length_in),
          max_width_in: parseDim(m.max_width_in),
          max_thickness_in: parseDim(m.max_thickness_in),
          is_active: true,
        }));
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
  redirect("/carving/vendors?toast=Vendor+created");
}

export async function updateVendorAction(formData: FormData) {
  const { profile } = await requireAuth(["developer", "owner"]);
  const admin = createAdminSupabaseClient();

  const vendorId = txt(formData, "vendor_id");
  const name = txt(formData, "name");
  const vendorType = txt(formData, "vendor_type") as "CNC" | "Manual" | "Outsource";
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
          return {
            id,
            vendor_id: vendorId,
            machine_code: code,
            operator_name: m.operator_name?.trim() || null,
            // Default new machines to multi_head_2 — the fleet only
            // has multi_head_2 + lathe in real use.
            machine_type: m.machine_type ?? "multi_head_2",
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
  const { profile } = await requireAuth(["developer", "owner"]);
  const admin = createAdminSupabaseClient();
  const vendorId = txt(formData, "vendor_id");
  const redirectTo = txt(formData, "redirect_to") || "/carving/vendors";

  await admin.from("vendors").update({ is_active: false }).eq("id", vendorId);
  await logAudit(profile.id, "vendor_deactivated", "vendor", vendorId, {});
  refreshAll();
  redirect(`${redirectTo}?toast=Vendor+deactivated`);
}

export async function reactivateVendorAction(formData: FormData) {
  const { profile } = await requireAuth(["developer", "owner"]);
  const admin = createAdminSupabaseClient();
  const vendorId = txt(formData, "vendor_id");
  const redirectTo = txt(formData, "redirect_to") || "/carving/vendors";

  await admin.from("vendors").update({ is_active: true }).eq("id", vendorId);
  await logAudit(profile.id, "vendor_reactivated", "vendor", vendorId, {});
  refreshAll();
  redirect(`${redirectTo}?toast=Vendor+reactivated`);
}

// Hard-delete a vendor. Only allowed when the vendor has no carving
// items referencing it AND no machines (cascading delete on machines
// would lose history we want to keep). If either guard fails, falls
// back to a deactivate so the carving head doesn't have to think
// about which command to run.
export async function deleteVendorAction(formData: FormData) {
  const { profile } = await requireAuth(["developer", "owner"]);
  const admin = createAdminSupabaseClient();
  const vendorId = txt(formData, "vendor_id");
  const redirectTo = txt(formData, "redirect_to") || "/carving/vendors";

  if (!vendorId) redirect(`${redirectTo}?toast=Missing+vendor+id`);

  const [{ count: itemCount }, { count: machineCount }] = await Promise.all([
    admin
      .from("carving_items")
      .select("id", { count: "exact", head: true })
      .eq("vendor_id", vendorId),
    admin
      .from("cnc_machines")
      .select("id", { count: "exact", head: true })
      .eq("vendor_id", vendorId),
  ]);

  if ((itemCount ?? 0) > 0 || (machineCount ?? 0) > 0) {
    // Has history — soft-delete instead so audit trails stay intact.
    await admin.from("vendors").update({ is_active: false }).eq("id", vendorId);
    await logAudit(profile.id, "vendor_soft_deleted", "vendor", vendorId, {
      reason: "has_history",
      carving_items: itemCount ?? 0,
      machines: machineCount ?? 0,
    });
    refreshAll();
    redirect(
      `${redirectTo}?toast=${encodeURIComponent(
        `Vendor has ${itemCount} job(s) and ${machineCount} machine(s) — deactivated instead`,
      )}`,
    );
  }

  // Truly no history — safe to hard delete.
  const { error } = await admin.from("vendors").delete().eq("id", vendorId);
  if (error) {
    redirect(`${redirectTo}?toast=${encodeURIComponent(error.message)}`);
  }
  await logAudit(profile.id, "vendor_deleted", "vendor", vendorId, {});
  refreshAll();
  redirect(`${redirectTo}?toast=Vendor+deleted`);
}

// ── Carving job lifecycle ───────────────────────────────────────────

export async function assignCarvingJobAction(formData: FormData) {
  const { profile } = await requireAuth(["developer", "owner", "carving_head"]);
  const admin = createAdminSupabaseClient();

  const slabId = txt(formData, "slab_id");
  const vendorId = txt(formData, "vendor_id");
  const note = txt(formData, "note") || null;
  // CNC ops: urgency + rough estimated carving minutes from the
  // carving head. Machine is NOT picked here — the vendor (CNC
  // supervisor) decides which of their machines to load it on.
  const urgency = txt(formData, "urgency") === "urgent" ? "urgent" : "normal";
  const estimatedMinutes = Math.max(0, num(formData, "estimated_minutes", 0));
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

  if (!slabId || !vendorId) {
    redirect("/carving?toast=Missing+slab+or+vendor");
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
  if (vendorType !== "CNC" && vendorType !== "Manual") {
    redirect("/carving?toast=Only+CNC+or+Manual+vendors+supported");
  }
  if (!(vendor as { is_active: boolean }).is_active) {
    redirect("/carving?toast=Vendor+is+inactive");
  }

  // Work-type tag only applies to CNC vendors. For Manual jobs we
  // ignore the field and store NULL (manual carvers have no machines
  // to match).
  const finalRequiresMachineType =
    vendorType === "CNC" ? requiresMachineType : null;

  // Race guard: slab must currently be cut_done
  const { data: slabRow, error: slabErr } = await admin
    .from("slab_requirements")
    .update({ status: "carving_assigned", updated_by: profile.id, updated_at: new Date().toISOString() })
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
  const autoReceipt = SKIP_SLAB_TRANSFER_STAGE
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
      status: "carving_assigned",
      urgency,
      estimated_minutes: estimatedMinutes || null,
      requires_machine_type: finalRequiresMachineType,
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
  const manualTag = vendorType === "Manual" ? " · 🪚 manual" : "";
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

  refreshAll();
  redirect("/carving?tab=active&toast=Job+queued");
}

// ── Migration 026: bulk-assign up to 4 slabs in one shot ───────────
//
// The carving head usually assigns slabs in pairs (for 2-head CNCs)
// or small batches (3-4 slabs going to the same vendor at once). The
// single-slab assign flow makes them open the modal N times.
//
// This action accepts an array of slab_ids (1-4), one vendor, and a
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
  const { profile } = await requireAuth(["developer", "owner", "carving_head"]);
  const admin = createAdminSupabaseClient();

  // slab_ids is a JSON-stringified array (form sends "[a,b,c]").
  const slabIdsJson = txt(formData, "slab_ids");
  const vendorId = txt(formData, "vendor_id");
  const note = txt(formData, "note") || null;
  const urgency = txt(formData, "urgency") === "urgent" ? "urgent" : "normal";
  const estimatedMinutes = Math.max(0, num(formData, "estimated_minutes", 0));
  const requiresMachineTypeRaw = txt(formData, "requires_machine_type");
  const requiresMachineType: string | null =
    requiresMachineTypeRaw === "lathe" ||
    requiresMachineTypeRaw === "multi_head_2" ||
    requiresMachineTypeRaw === "single_head"
      ? requiresMachineTypeRaw
      : null;

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
  if (slabIds.length > 4) {
    redirect("/carving?toast=Max+4+slabs+per+batch");
  }
  if (!vendorId) {
    redirect("/carving?toast=Pick+a+vendor");
  }

  const { data: vendor } = await admin
    .from("vendors")
    .select("id, name, vendor_type, is_active")
    .eq("id", vendorId)
    .single();
  if (!vendor) redirect("/carving?toast=Vendor+not+found");
  const vendorType = (vendor as { vendor_type: string }).vendor_type;
  if (vendorType !== "CNC" && vendorType !== "Manual") {
    redirect("/carving?toast=Only+CNC+or+Manual+vendors+supported");
  }
  if (!(vendor as { is_active: boolean }).is_active) {
    redirect("/carving?toast=Vendor+is+inactive");
  }
  const finalRequiresMachineType = vendorType === "CNC" ? requiresMachineType : null;

  // One batch_id for every slab in this assignment. Downstream UIs
  // group slabs sharing a batch_id with the same colour stripe.
  const batchId = crypto.randomUUID();
  const now = new Date().toISOString();
  // Daksh May 2026 — see SKIP_SLAB_TRANSFER_STAGE comment at the
  // top of this file. Same auto-receipt as the single-slab path.
  const autoReceiptBatch = SKIP_SLAB_TRANSFER_STAGE
    ? {
        received_at_vendor_at: now,
        received_at_vendor_by: profile.id,
      }
    : {};
  const successes: string[] = [];
  const failures: Array<{ slab: string; reason: string }> = [];

  for (const slabId of slabIds) {
    // Race-guard the slab transition first.
    const { data: slabRow, error: slabErr } = await admin
      .from("slab_requirements")
      .update({ status: "carving_assigned", updated_by: profile.id, updated_at: now })
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
        status: "carving_assigned",
        urgency,
        estimated_minutes: estimatedMinutes || null,
        requires_machine_type: finalRequiresMachineType,
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
  if (successes.length === 0) {
    redirect(
      `/carving?toast=${encodeURIComponent(
        `Batch failed — no slabs could be assigned. ${failures[0]?.reason ?? ""}`,
      )}`,
    );
  }
  if (failures.length > 0) {
    redirect(
      `/carving?tab=active&toast=${encodeURIComponent(
        `Assigned ${successes.length} of ${slabIds.length} · ${failures.length} failed (${failures[0]?.reason ?? "see log"})`,
      )}`,
    );
  }
  redirect(
    `/carving?tab=active&toast=${encodeURIComponent(
      `📦 Batch of ${successes.length} queued`,
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
        "id, vendor_id, status, cnc_machine_id, slab_requirement_id, estimated_minutes, requires_machine_type, received_at_vendor_at",
      )
      .eq("id", carvingItemId)
      .maybeSingle(),
    admin
      .from("cnc_machines")
      .select(
        "id, vendor_id, status, is_active, machine_type, machine_code, max_length_in, max_width_in, max_thickness_in",
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
    received_at_vendor_at: string | null;
  };
  const machine = mc as {
    id: string;
    vendor_id: string;
    status: string;
    is_active: boolean;
    machine_type: string | null;
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
  // "flat-panel default" which maps to multi_head_2 (the only
  // non-lathe type in the fleet). Lathes only do cylindrical work,
  // so a flat-panel job can never go on a lathe.
  const requiredType =
    item.requires_machine_type ??
    (machine.machine_type === "lathe" ? null : "multi_head_2");
  if (requiredType && machine.machine_type !== requiredType) {
    redirect(
      `/vendor?toast=${encodeURIComponent(
        `This job is tagged for ${requiredType}. Pick a ${requiredType} machine.`,
      )}`,
    );
  }

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
        "id, vendor_id, status, cnc_machine_id, slab_requirement_id, estimated_minutes, requires_machine_type, received_at_vendor_at",
      )
      .eq("id", carvingItemAId)
      .maybeSingle(),
    admin
      .from("carving_items")
      .select(
        "id, vendor_id, status, cnc_machine_id, slab_requirement_id, estimated_minutes, requires_machine_type, received_at_vendor_at",
      )
      .eq("id", carvingItemBId)
      .maybeSingle(),
    admin
      .from("cnc_machines")
      .select(
        "id, vendor_id, status, is_active, machine_type, machine_code, max_length_in, max_width_in, max_thickness_in",
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
    received_at_vendor_at: string | null;
  };
  const m = mc as {
    id: string;
    vendor_id: string;
    status: string;
    is_active: boolean;
    machine_type: string | null;
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

  // Validate identical slab geometry. Two cylinders on a 2-head CNC
  // must have matching L/W/T or they won't sit in the jig together.
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

  // Migration 024: dim check vs the machine's bed envelope.
  // Both slabs are identical so a single check covers both.
  const dimErr = checkSlabFits(slabA, m);
  if (dimErr) redirect(`/vendor?toast=${encodeURIComponent(dimErr)}`);

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

  // Audit on both items + the machine.
  await Promise.all([
    recordEvent(a.id, "loaded", profile.id, `2-head load (paired with ${b.id}) · ETA ${finalEst ?? "?"}min`),
    recordEvent(b.id, "loaded", profile.id, `2-head load (paired with ${a.id}) · ETA ${finalEst ?? "?"}min`),
  ]);
  await admin.from("cnc_machine_events").insert({
    cnc_machine_id: machineId,
    event_type: "loaded",
    carving_item_id: a.id,
    user_id: profile.id,
    message: `2-head load · pair ${a.id} + ${b.id} · ETA ${finalEst ?? "?"}min`,
  });
  await logAudit(profile.id, "carving_loaded_pair", "carving_item", a.id, {
    machine_id: machineId,
    paired_with: b.id,
    vendor_estimated_minutes: finalEst,
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
      "id, vendor_id, vendor_name, status, cnc_machine_id, slab_requirement_id",
    )
    .eq("id", carvingItemId)
    .maybeSingle();
  if (!ci) redirect(`${redirectTo}?toast=Job+not+found`);
  const item = ci as {
    id: string;
    vendor_id: string;
    vendor_name: string;
    status: string;
    cnc_machine_id: string | null;
    slab_requirement_id: string;
  };

  // Vendor ownership check.
  if (profile.role === "vendor") {
    if (!profile.vendor_id || profile.vendor_id !== item.vendor_id) {
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
    if (vendor.vendor_type !== "CNC" && vendor.vendor_type !== "Manual") {
      redirect(`${redirectTo}?toast=Destination+must+be+CNC+or+Manual`);
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
    if (!profile.vendor_id || profile.vendor_id !== item.vendor_id) {
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
    if (!profile.vendor_id || profile.vendor_id !== item.vendor_id) {
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
  await admin
    .from("carving_items")
    .update({
      completed_at: now,
      unloaded_at: now,
      unloaded_by: profile.id,
      temporary_location: tempLocation,
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
    if (!profile.vendor_id || profile.vendor_id !== item.vendor_id) {
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
      "id, vendor_id, status, cnc_machine_id, requires_machine_type, held_from_machine_id",
    )
    .eq("id", carvingItemId)
    .maybeSingle();
  if (!ci) redirect(`${redirectTo}?toast=Job+not+found`);
  const item = ci as {
    id: string;
    vendor_id: string;
    status: string;
    cnc_machine_id: string | null;
    requires_machine_type: string | null;
    held_from_machine_id: string | null;
  };

  if (profile.role === "vendor") {
    if (!profile.vendor_id || profile.vendor_id !== item.vendor_id) {
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
    vendor_id: string;
  };
  if (machine.vendor_id !== item.vendor_id) {
    redirect(`${redirectTo}?toast=Machine+belongs+to+another+vendor`);
  }
  if (machine.status !== "idle") {
    redirect(
      `${redirectTo}?toast=${encodeURIComponent(`${machine.machine_code} is not idle right now`)}`,
    );
  }
  // Work-type check: lathe slab → lathe machine; non-lathe → non-lathe.
  if (item.requires_machine_type === "lathe" && machine.machine_type !== "lathe") {
    redirect(`${redirectTo}?toast=Lathe+slab+needs+a+lathe+machine`);
  }
  if (item.requires_machine_type !== "lathe" && machine.machine_type === "lathe") {
    redirect(`${redirectTo}?toast=Non-lathe+slab+cannot+go+on+a+lathe`);
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
  await admin
    .from("cnc_machines")
    .update({ status: "carving", current_carving_item_id: carvingItemId })
    .eq("id", targetMachineId);

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
    .select("id, vendor_id, status, slab_requirement_id")
    .eq("id", carvingItemId)
    .maybeSingle();
  if (!ci) redirect(`${redirectTo}?toast=Job+not+found`);
  const item = ci as {
    id: string;
    vendor_id: string;
    status: string;
    slab_requirement_id: string;
  };

  if (profile.role === "vendor") {
    if (!profile.vendor_id || profile.vendor_id !== item.vendor_id) {
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

  refreshAll();
  redirect(
    `${redirectTo}?toast=${encodeURIComponent("Marked complete — awaiting team review")}`,
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
    .select("id, status")
    .eq("id", machineId)
    .maybeSingle();
  if (!m) redirect("/vendor?toast=Machine+not+found");
  if ((m as { status: string }).status === "carving") {
    redirect("/vendor?toast=Unload+the+slab+before+flagging+maintenance");
  }

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
    message: detail || null,
    user_id: profile.id,
  });
  await logAudit(profile.id, "cnc_maintenance_start", "cnc_machine", machineId, {
    reason,
    detail,
  });

  refreshAll();
  redirect("/vendor?toast=Machine+flagged+for+maintenance");
}

export async function resolveMaintenanceAction(formData: FormData) {
  const { profile } = await requireAuth(["developer", "owner", "carving_head", "vendor"]);
  const admin = createAdminSupabaseClient();

  const machineId = txt(formData, "cnc_machine_id");
  if (!machineId) redirect("/vendor?toast=Missing+machine+id");

  const { data: m } = await admin
    .from("cnc_machines")
    .select("id, status")
    .eq("id", machineId)
    .maybeSingle();
  if (!m) redirect("/vendor?toast=Machine+not+found");

  await admin
    .from("cnc_machines")
    .update({
      status: "idle",
      maintenance_reason: null,
      maintenance_flagged_at: null,
      maintenance_flagged_by: null,
    })
    .eq("id", machineId);

  await admin.from("cnc_machine_events").insert({
    cnc_machine_id: machineId,
    event_type: "maintenance_end",
    user_id: profile.id,
  });
  await logAudit(profile.id, "cnc_maintenance_end", "cnc_machine", machineId, {});

  refreshAll();
  redirect("/vendor?toast=Machine+back+online");
}

export async function approveCarvingJobAction(formData: FormData) {
  const { profile } = await requireAuth(["developer", "owner", "carving_head"]);
  const admin = createAdminSupabaseClient();
  const jobId = txt(formData, "job_id");
  const notes = txt(formData, "notes") || null;
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

  // Surface the actual error if the update fails (could be a
  // missing column on prod schema if migration 014 wasn't run).
  const { error: updateErr } = await admin
    .from("carving_items")
    .update({
      review_approved_at: now,
      review_approved_by: profile.id,
      review_notes: notes,
      status: "completed",
      location: finalLocation,
      ready_to_dispatch_at: now,
      ready_to_dispatch_by: profile.id,
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
      .update({ status: "completed", updated_by: profile.id, updated_at: now })
      .eq("id", j.slab_requirement_id);
  }

  await recordEvent(jobId, "approved", profile.id, `Approved + ready for dispatch · ${finalLocation}${notes ? ` · ${notes}` : ""}`);
  await logAudit(profile.id, "carving_approved", "carving_item", jobId, {
    slab_id: j.slab_requirement_id,
    location: finalLocation,
  });

  refreshAll();
  if (stay) return;
  redirect(`/carving/${jobId}?toast=Approved+%E2%80%94+ready+for+dispatch`);
}

export async function markReadyToDispatchAction(formData: FormData) {
  const { profile } = await requireAuth(["developer", "owner", "carving_head"]);
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
  const { profile } = await requireAuth(["developer", "owner", "carving_head"]);
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

export async function rejectCarvingJobAction(formData: FormData) {
  const { profile } = await requireAuth(["developer", "owner", "carving_head"]);
  const admin = createAdminSupabaseClient();
  const jobId = txt(formData, "job_id");
  const notes = txt(formData, "notes");
  const stay = txt(formData, "stay") === "1";

  if (!jobId || !notes) {
    if (stay) throw new Error("Rejection notes required");
    redirect(`/carving/${jobId}?toast=Rejection+notes+required`);
  }

  await admin
    .from("carving_items")
    .update({
      completed_at: null,
      review_notes: notes,
      status: "carving_in_progress",
    })
    .eq("id", jobId);

  await recordEvent(jobId, "rejected", profile.id, notes);
  await logAudit(profile.id, "carving_rejected", "carving_item", jobId, { notes });

  refreshAll();
  if (stay) return;
  redirect(`/carving/${jobId}?toast=Rejected+-+sent+back+to+vendor`);
}

// dispatchCarvingJobAction was removed — carved slabs now flow through
// markReadyToDispatchAction (above) and then through the Dispatch
// Station instead of being one-click-dispatched from the carving
// detail page. See migration 014 for the schema change.

export async function cancelCarvingJobAction(formData: FormData) {
  const { profile } = await requireAuth(["developer", "owner", "carving_head"]);
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
    "vendor",
    "slab_transfer",
  ]);
  const admin = createAdminSupabaseClient();

  const carvingItemId = txt(formData, "carving_item_id");
  const dropoffNote = txt(formData, "dropoff_note") || null;
  const redirectTo = txt(formData, "redirect_to") || "/carving";

  if (!carvingItemId) redirect(`${redirectTo}?toast=Missing+job+id`);

  const { data: ci } = await admin
    .from("carving_items")
    .select(
      "id, vendor_id, vendor_type, vendor_name, status, received_at_vendor_at, claimed_by",
    )
    .eq("id", carvingItemId)
    .maybeSingle();
  if (!ci) redirect(`${redirectTo}?toast=Job+not+found`);
  const item = ci as {
    id: string;
    vendor_id: string;
    vendor_type: string;
    vendor_name: string;
    status: string;
    received_at_vendor_at: string | null;
    claimed_by: string | null;
  };

  if (item.vendor_type !== "CNC") {
    redirect(`${redirectTo}?toast=Receipt+step+is+CNC-only`);
  }
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
  if (profile.role === "slab_transfer" && item.claimed_by && item.claimed_by !== profile.id) {
    redirect(`${redirectTo}?toast=Claimed+by+another+runner`);
  }

  const now = new Date().toISOString();
  await admin
    .from("carving_items")
    .update({
      received_at_vendor_at: now,
      received_at_vendor_by: profile.id,
      // Clear the claim so the row drops out of the "claimed by me" list.
      claimed_by: null,
      claimed_at: null,
      claim_batch_id: null,
      // Only overwrite dropoff_note if the form supplied one — don't
      // wipe a previously-set note.
      ...(dropoffNote ? { dropoff_note: dropoffNote } : {}),
    })
    .eq("id", carvingItemId)
    .is("received_at_vendor_at", null);

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
export async function claimSlabTransferAction(formData: FormData) {
  const { profile } = await requireAuth([
    "developer",
    "owner",
    "carving_head",
    "slab_transfer",
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
  // Race-guard: only claim if still unclaimed. Whoever wins the race
  // gets the lock; the loser sees "Already claimed" on the next view.
  const { data: updated } = await admin
    .from("carving_items")
    .update({ claimed_by: profile.id, claimed_at: now, claim_batch_id: claimBatchId })
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
        .update({ claimed_by: null, claimed_at: null, claim_batch_id: null })
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
  if (profile.role === "slab_transfer" && item.claimed_by !== profile.id) {
    redirect(`${redirectTo}?toast=Not+your+claim`);
  }

  await admin
    .from("carving_items")
    .update({ claimed_by: null, claimed_at: null, claim_batch_id: null })
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
  if (profile.role === "slab_transfer") {
    const anyForeign = rows.some((r) => r.claimed_by && r.claimed_by !== profile.id);
    if (anyForeign) {
      redirect(`${redirectTo}?toast=${encodeURIComponent("Not your batch to release.")}`);
    }
  }

  const ids = rows.map((r) => r.id);
  await admin
    .from("carving_items")
    .update({ claimed_by: null, claimed_at: null, claim_batch_id: null })
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
  ]);
  const admin = createAdminSupabaseClient();

  const claimBatchId = txt(formData, "claim_batch_id");
  const dropoffNote = txt(formData, "dropoff_note") || null;
  const redirectTo = txt(formData, "redirect_to") || "/carving/transfer";
  if (!claimBatchId) redirect(`${redirectTo}?toast=Missing+batch+id`);

  const { data: items } = await admin
    .from("carving_items")
    .select("id, vendor_id, vendor_type, claimed_by, received_at_vendor_at")
    .eq("claim_batch_id", claimBatchId)
    .is("received_at_vendor_at", null);
  const rows = (items ?? []) as Array<{
    id: string;
    vendor_id: string;
    vendor_type: string;
    claimed_by: string | null;
    received_at_vendor_at: string | null;
  }>;
  if (rows.length === 0) {
    redirect(`${redirectTo}?toast=${encodeURIComponent("Nothing to deliver in that batch.")}`);
  }
  // Refuse if the batch contains non-CNC slabs (Manual vendors don't
  // need a receipt step in this app).
  if (rows.some((r) => r.vendor_type !== "CNC")) {
    redirect(`${redirectTo}?toast=${encodeURIComponent("Batch contains non-CNC slabs — deliver individually.")}`);
  }
  if (profile.role === "slab_transfer") {
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

// ── Migration 024: re-tag work-type on an existing job ─────────────
//
// Carving head can change a job's requires_machine_type after the
// initial assignment — e.g. realised mid-flight that the design
// actually needs a lathe. Only allowed while the job is still in
// the queue or actively carving.
export async function updateRequiresMachineTypeAction(formData: FormData) {
  const { profile } = await requireAuth(["developer", "owner", "carving_head"]);
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
  const { profile } = await requireAuth(["developer", "owner", "carving_head", "vendor"]);
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
  if (nv.vendor_type !== "CNC" && nv.vendor_type !== "Manual") {
    redirect(`${redirectTo}?toast=Destination+must+be+CNC+or+Manual`);
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
  const { profile } = await requireAuth(["developer", "owner", "carving_head"]);
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

  if (item.vendor_type !== "Manual") {
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
    `Manual carving started · ${item.vendor_name}`,
  );
  await logAudit(profile.id, "carving_started_manually", "carving_item", carvingItemId, {
    vendor_name: item.vendor_name,
  });

  refreshAll();
  redirect(`${redirectTo}?toast=Marked+started`);
}

export async function markCarvingCompleteManuallyAction(formData: FormData) {
  const { profile } = await requireAuth(["developer", "owner", "carving_head"]);
  const admin = createAdminSupabaseClient();

  const carvingItemId = txt(formData, "carving_item_id");
  const tempLocation = txt(formData, "temporary_location") || "Manual carver yard";
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

  if (item.vendor_type !== "Manual") {
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
    `Manual carving complete · ${item.vendor_name} · stored at ${tempLocation}`,
  );
  await logAudit(profile.id, "carving_completed_manually", "carving_item", carvingItemId, {
    vendor_name: item.vendor_name,
    temporary_location: tempLocation,
  });

  refreshAll();
  redirect(`${redirectTo}?toast=Marked+complete`);
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
  await requireAuth(["developer", "owner", "carving_head"]);
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
