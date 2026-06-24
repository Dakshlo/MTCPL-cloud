"use server";

// Developer/owner: manage the mobile number(s) that get the cutting-approved
// WhatsApp alert. Persists to app_settings via lib/wa-cutting-alert.

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { saveCuttingAlertRecipients } from "@/lib/wa-cutting-alert";

export async function updateWaCuttingRecipientsAction(
  numbers: string[],
): Promise<{ ok: true; numbers: string[] } | { ok: false; error: string }> {
  const { profile } = await requireAuth(["owner", "developer"]);
  const res = await saveCuttingAlertRecipients(Array.isArray(numbers) ? numbers : [], profile.id);
  if (!res.ok) return res;
  await logAudit(profile.id, "wa_cutting_recipients_updated", "app_setting", "wa_cutting_recipients", {
    count: res.numbers.length,
  });
  revalidatePath("/settings");
  return { ok: true, numbers: res.numbers };
}
