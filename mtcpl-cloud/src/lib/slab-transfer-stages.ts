// Slab-transfer stage toggles — Daksh, June 2026.
//
// Two developer-controlled lanes, each ON (slab routes through the transfer
// runner) or OFF (slab goes straight to its destination). Stored as one JSON
// object in app_settings (mirrors the wa_* pattern). No migration — just a key.
//
//   cuttingToCarving  — when a cut slab is assigned to a CNC / Outsource vendor.
//       ON  → slab waits in the vendor's "Pending stock" until the transfer
//             runner delivers it (then Ready to load).
//       OFF → slab is received immediately on assign → straight to the CNC
//             cockpit "Ready to load" (Outsource auto-starts). Skips the tray.
//
//   carvingToDispatch — when a carving job is done + approved.
//       ON  → slab waits in the Carving→Dispatch bring-in queue (greyed on the
//             Dispatch board) until a runner brings it in to the station.
//       OFF → slab is dispatch-selectable the moment it's approved (no bring-in).
//
// Defaults match today's live behaviour: cutting→carving ON, carving→dispatch
// OFF — so nothing changes until a developer flips a toggle in Settings.

import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export const SLAB_TRANSFER_STAGES_KEY = "slab_transfer_stages";

export type SlabTransferStages = {
  /** Cutting → Carving transfer enabled (slab waits in Pending stock). */
  cuttingToCarving: boolean;
  /** Carving → Dispatch transfer enabled (slab waits for bring-in). */
  carvingToDispatch: boolean;
};

export const SLAB_TRANSFER_DEFAULTS: SlabTransferStages = {
  cuttingToCarving: true,
  carvingToDispatch: false,
};

export async function getSlabTransferStages(): Promise<SlabTransferStages> {
  try {
    const admin = createAdminSupabaseClient();
    const { data } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", SLAB_TRANSFER_STAGES_KEY)
      .maybeSingle();
    const v = data?.value as Partial<SlabTransferStages> | null;
    if (v && typeof v === "object") {
      return {
        cuttingToCarving:
          typeof v.cuttingToCarving === "boolean" ? v.cuttingToCarving : SLAB_TRANSFER_DEFAULTS.cuttingToCarving,
        carvingToDispatch:
          typeof v.carvingToDispatch === "boolean" ? v.carvingToDispatch : SLAB_TRANSFER_DEFAULTS.carvingToDispatch,
      };
    }
  } catch {
    /* fall through to defaults — never block the flow on a settings read */
  }
  return { ...SLAB_TRANSFER_DEFAULTS };
}

export async function saveSlabTransferStages(
  next: SlabTransferStages,
  updatedBy: string,
): Promise<{ ok: true; value: SlabTransferStages } | { ok: false; error: string }> {
  const value: SlabTransferStages = {
    cuttingToCarving: !!next.cuttingToCarving,
    carvingToDispatch: !!next.carvingToDispatch,
  };
  const admin = createAdminSupabaseClient();
  const { error } = await admin.from("app_settings").upsert({
    key: SLAB_TRANSFER_STAGES_KEY,
    value,
    updated_at: new Date().toISOString(),
    updated_by: updatedBy,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, value };
}
