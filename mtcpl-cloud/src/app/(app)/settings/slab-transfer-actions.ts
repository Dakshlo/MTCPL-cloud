"use server";

// Developer-only: ON/OFF for the two slab-transfer lanes (cutting→carving,
// carving→dispatch). Persists to app_settings via lib/slab-transfer-stages.

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { saveSlabTransferStages } from "@/lib/slab-transfer-stages";

export async function updateSlabTransferStagesAction(
  formData: FormData,
): Promise<{ ok: true; cuttingToCarving: boolean; carvingToDispatch: boolean } | { ok: false; error: string }> {
  const { profile } = await requireAuth(["developer"]); // developer only

  const cuttingToCarving = String(formData.get("cuttingToCarving") || "") === "true";
  const carvingToDispatch = String(formData.get("carvingToDispatch") || "") === "true";

  const res = await saveSlabTransferStages({ cuttingToCarving, carvingToDispatch }, profile.id);
  if (!res.ok) return res;

  await logAudit(profile.id, "slab_transfer_stages_updated", "app_setting", "slab_transfer_stages", {
    cuttingToCarving: res.value.cuttingToCarving,
    carvingToDispatch: res.value.carvingToDispatch,
  });
  // The lanes affect carving assign + dispatch board.
  revalidatePath("/settings");
  revalidatePath("/carving");
  revalidatePath("/dispatch");
  return { ok: true, cuttingToCarving: res.value.cuttingToCarving, carvingToDispatch: res.value.carvingToDispatch };
}
