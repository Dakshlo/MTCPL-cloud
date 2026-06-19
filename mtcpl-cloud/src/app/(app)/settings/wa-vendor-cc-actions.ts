"use server";

// Developer-only: turn the vendor-message carbon-copy on/off and set the
// number that receives the copy. Persists to app_settings via lib/wa-vendor-cc.

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { saveVendorCcSetting } from "@/lib/wa-vendor-cc";

export async function updateVendorCcAction(
  formData: FormData,
): Promise<{ ok: true; enabled: boolean; number: string } | { ok: false; error: string }> {
  const { profile } = await requireAuth(["developer"]); // developer only

  const enabled = String(formData.get("enabled") || "") === "true";
  const number = String(formData.get("number") || "");

  const res = await saveVendorCcSetting({ enabled, number }, profile.id);
  if (!res.ok) return res;

  await logAudit(profile.id, "wa_vendor_cc_updated", "app_setting", "wa_vendor_cc", {
    enabled: res.value.enabled,
    number: res.value.number,
  });
  revalidatePath("/settings");
  return { ok: true, enabled: res.value.enabled, number: res.value.number };
}
