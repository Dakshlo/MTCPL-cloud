"use server";

// Developer-only: on/off + recipient number for the two WhatsApp
// operational alerts (slab-transfer waiting ping, carving-approval
// backlog). Persists to app_settings via lib/wa-alerts.

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { saveSlabTransferAlert, saveCarvingBacklog } from "@/lib/wa-alerts";

export async function updateSlabTransferAlertAction(
  formData: FormData,
): Promise<{ ok: true; enabled: boolean; number: string } | { ok: false; error: string }> {
  const { profile } = await requireAuth(["developer"]); // developer only

  const enabled = String(formData.get("enabled") || "") === "true";
  const number = String(formData.get("number") || "");

  const res = await saveSlabTransferAlert({ enabled, number }, profile.id);
  if (!res.ok) return res;

  await logAudit(profile.id, "wa_slab_transfer_alert_updated", "app_setting", "wa_slab_transfer_alert", {
    enabled: res.value.enabled,
    number: res.value.number,
  });
  revalidatePath("/settings");
  return { ok: true, enabled: res.value.enabled, number: res.value.number };
}

export async function updateCarvingBacklogAction(
  formData: FormData,
): Promise<
  | { ok: true; enabled: boolean; number: string; threshold: number; step: number }
  | { ok: false; error: string }
> {
  const { profile } = await requireAuth(["developer"]); // developer only

  const enabled = String(formData.get("enabled") || "") === "true";
  const number = String(formData.get("number") || "");
  const threshold = Number(formData.get("threshold") || "15");
  const step = Number(formData.get("step") || "5");

  const res = await saveCarvingBacklog({ enabled, number, threshold, step }, profile.id);
  if (!res.ok) return res;

  await logAudit(profile.id, "wa_carving_backlog_updated", "app_setting", "wa_carving_backlog", {
    enabled: res.value.enabled,
    number: res.value.number,
    threshold: res.value.threshold,
    step: res.value.step,
  });
  revalidatePath("/settings");
  return {
    ok: true,
    enabled: res.value.enabled,
    number: res.value.number,
    threshold: res.value.threshold,
    step: res.value.step,
  };
}
