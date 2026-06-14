"use server";

// Manage the daily WhatsApp work-report recipient list from Settings
// (owner / developer). Persists to app_settings via lib/wa-recipients.

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { saveReportRecipientNumbers } from "@/lib/wa-recipients";

export async function updateWaReportRecipientsAction(
  formData: FormData,
): Promise<{ ok: true; numbers: string[] } | { ok: false; error: string }> {
  const { profile } = await requireAuth(["owner", "developer"]);

  let numbers: string[] = [];
  try { numbers = JSON.parse(String(formData.get("numbers") || "[]")); } catch { numbers = []; }
  const res = await saveReportRecipientNumbers(Array.isArray(numbers) ? numbers : [], profile.id);
  if (!res.ok) return res;

  await logAudit(profile.id, "wa_report_recipients_updated", "app_setting", "wa_report_recipients", { count: res.numbers.length });
  revalidatePath("/settings");
  return { ok: true, numbers: res.numbers };
}
