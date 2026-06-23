// Plain (non-"use server") shared bits for the developer file-transfer feature,
// so the bucket name + ensure helper can be imported from both server actions
// and the page/client (a "use server" module may only export async functions).

import type { createAdminSupabaseClient } from "@/lib/supabase/admin";

export const DEV_TRANSFER_BUCKET = "dev_transfers";

/** Create the private dev_transfers bucket if it doesn't exist (idempotent —
 *  createBucket returns { error } for "already exists", which we ignore). */
export async function ensureDevTransferBucket(
  admin: ReturnType<typeof createAdminSupabaseClient>,
): Promise<void> {
  await admin.storage.createBucket(DEV_TRANSFER_BUCKET, { public: false });
}
