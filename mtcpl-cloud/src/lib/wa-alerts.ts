// WhatsApp operational alerts — Daksh, June 2026.
//
// Two developer-controlled alerts, each with its own on/off + recipient
// number, stored in app_settings (one JSON object per key). Mirrors the
// wa_vendor_cc pattern (lib/wa-vendor-cc.ts).
//
//   1. wa_slab_transfer_alert — the "slab waiting for transfer" ping that
//      fires when a slab lands in Pending stock. Template: slab_request
//      (env MSG91_WA_SLAB_TRANSFER_TEMPLATE).
//
//   2. wa_carving_backlog — fires when the carving "Done Approval" backlog
//      crosses a milestone (at `threshold`, then every `step` above it:
//      15, 20, 25 …). Template env MSG91_WA_CARVING_BACKLOG_TEMPLATE. The
//      last-alerted milestone is kept in wa_carving_backlog_state so it
//      only pings on a NEW high and re-arms when the queue drains.
//
// Both default to OFF with no number, so nothing sends until a developer
// turns it on in Settings and sets a number.

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { normalizeIndianMobile } from "@/lib/wa-send";

const digits = (n: string) => String(n).replace(/\D/g, "");

// ── 1. Slab-transfer "waiting" ping ─────────────────────────────────
export const WA_SLAB_TRANSFER_KEY = "wa_slab_transfer_alert";
export type SlabTransferAlertSetting = { enabled: boolean; number: string };

export async function getSlabTransferAlert(): Promise<SlabTransferAlertSetting> {
  try {
    const admin = createAdminSupabaseClient();
    const { data } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", WA_SLAB_TRANSFER_KEY)
      .maybeSingle();
    const v = data?.value as { enabled?: unknown; number?: unknown } | null;
    if (v && typeof v.enabled === "boolean") {
      return { enabled: v.enabled, number: digits(typeof v.number === "string" ? v.number : "") };
    }
  } catch {
    /* fall through to default */
  }
  return { enabled: false, number: "" };
}

/** Normalised recipient(s) for the slab-transfer ping, or [] when OFF. */
export async function getSlabTransferRecipients(): Promise<string[]> {
  const s = await getSlabTransferAlert();
  if (!s.enabled) return [];
  const n = normalizeIndianMobile(s.number);
  return n ? [n] : [];
}

export async function saveSlabTransferAlert(
  next: SlabTransferAlertSetting,
  updatedBy: string,
): Promise<{ ok: true; value: SlabTransferAlertSetting } | { ok: false; error: string }> {
  const number = digits(next.number);
  if (next.enabled && (number.length < 10 || number.length > 12)) {
    return { ok: false, error: "Enter a valid 10-digit mobile number." };
  }
  const value: SlabTransferAlertSetting = { enabled: !!next.enabled, number };
  const admin = createAdminSupabaseClient();
  const { error } = await admin.from("app_settings").upsert({
    key: WA_SLAB_TRANSFER_KEY,
    value,
    updated_at: new Date().toISOString(),
    updated_by: updatedBy,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, value };
}

// ── 2. Carving "Done Approval" backlog alert ────────────────────────
export const WA_CARVING_BACKLOG_KEY = "wa_carving_backlog";
export const WA_CARVING_BACKLOG_STATE_KEY = "wa_carving_backlog_state";
export type CarvingBacklogSetting = {
  enabled: boolean;
  number: string;
  /** Fire when pending reaches this count (default 15). */
  threshold: number;
  /** …then again every `step` slabs above it (default 5). */
  step: number;
};

export async function getCarvingBacklog(): Promise<CarvingBacklogSetting> {
  try {
    const admin = createAdminSupabaseClient();
    const { data } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", WA_CARVING_BACKLOG_KEY)
      .maybeSingle();
    const v = data?.value as Partial<CarvingBacklogSetting> | null;
    if (v && typeof v.enabled === "boolean") {
      return {
        enabled: v.enabled,
        number: digits(typeof v.number === "string" ? v.number : ""),
        threshold: Number(v.threshold) > 0 ? Math.floor(Number(v.threshold)) : 15,
        step: Number(v.step) > 0 ? Math.floor(Number(v.step)) : 5,
      };
    }
  } catch {
    /* fall through to default */
  }
  return { enabled: false, number: "", threshold: 15, step: 5 };
}

/** Normalised recipient(s) for the backlog alert, or [] when OFF. */
export async function getCarvingBacklogRecipients(): Promise<string[]> {
  const s = await getCarvingBacklog();
  if (!s.enabled) return [];
  const n = normalizeIndianMobile(s.number);
  return n ? [n] : [];
}

export async function saveCarvingBacklog(
  next: CarvingBacklogSetting,
  updatedBy: string,
): Promise<{ ok: true; value: CarvingBacklogSetting } | { ok: false; error: string }> {
  const number = digits(next.number);
  if (next.enabled && (number.length < 10 || number.length > 12)) {
    return { ok: false, error: "Enter a valid 10-digit mobile number." };
  }
  const threshold = Number(next.threshold) > 0 ? Math.floor(Number(next.threshold)) : 15;
  const step = Number(next.step) > 0 ? Math.floor(Number(next.step)) : 5;
  const value: CarvingBacklogSetting = { enabled: !!next.enabled, number, threshold, step };
  const admin = createAdminSupabaseClient();
  const { error } = await admin.from("app_settings").upsert({
    key: WA_CARVING_BACKLOG_KEY,
    value,
    updated_at: new Date().toISOString(),
    updated_by: updatedBy,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, value };
}

/** Which milestone a given pending count sits at. 0 = below threshold,
 *  1 = at threshold, 2 = threshold+step, … Used to decide "new high". */
export function backlogLevelFor(count: number, threshold: number, step: number): number {
  if (count < threshold) return 0;
  return Math.floor((count - threshold) / Math.max(1, step)) + 1;
}

/** The last milestone we alerted at (runtime state, separate key so the
 *  settings editor never clobbers it). */
export async function getBacklogAlertLevel(): Promise<number> {
  try {
    const admin = createAdminSupabaseClient();
    const { data } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", WA_CARVING_BACKLOG_STATE_KEY)
      .maybeSingle();
    const v = data?.value as { level?: unknown } | null;
    if (v && typeof v.level === "number") return v.level;
  } catch {
    /* default 0 */
  }
  return 0;
}

export async function setBacklogAlertLevel(level: number): Promise<void> {
  try {
    const admin = createAdminSupabaseClient();
    await admin.from("app_settings").upsert({
      key: WA_CARVING_BACKLOG_STATE_KEY,
      value: { level },
      updated_at: new Date().toISOString(),
    });
  } catch {
    /* non-fatal */
  }
}
