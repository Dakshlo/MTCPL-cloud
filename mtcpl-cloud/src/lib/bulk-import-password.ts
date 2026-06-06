/**
 * Bulk slab-import password guard (Daksh June 2026).
 *
 * The "import slabs from Excel" flow asks for a password before it
 * commits the bulk insert. The password is stored HASHED in the
 * existing `system_settings` key/value table (key =
 * 'bulk_import_password', value = { hash }) — so no migration is
 * needed (the table was built in mig 031 specifically to let global
 * flags piggyback without one).
 *
 * Verification is SERVER-SIDE ONLY — the plaintext/hash is never sent
 * to the client. Owner / developer / senior_incharge can change the
 * password from Settings.
 *
 * Server-only module (imports the admin client). Do NOT import it into
 * a client component.
 */

import { createHash } from "crypto";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

const SALT = "mtcpl-bulk-import-v1";
export const BULK_IMPORT_PASSWORD_KEY = "bulk_import_password";
// Used until an owner / dev / senior_incharge sets a custom one.
export const DEFAULT_BULK_IMPORT_PASSWORD = "mtcpl";

export function hashBulkImportPassword(pw: string): string {
  return createHash("sha256").update(`${SALT}:${pw}`).digest("hex");
}

/** The stored hash, or the default password's hash if none is set yet. */
async function getStoredHash(): Promise<string> {
  try {
    const admin = createAdminSupabaseClient();
    const { data } = await admin
      .from("system_settings")
      .select("value")
      .eq("key", BULK_IMPORT_PASSWORD_KEY)
      .maybeSingle();
    const v = (data?.value ?? null) as { hash?: string } | null;
    if (v && typeof v.hash === "string" && v.hash) return v.hash;
  } catch {
    /* table/row missing → fall back to default */
  }
  return hashBulkImportPassword(DEFAULT_BULK_IMPORT_PASSWORD);
}

/** True if `input` matches the stored (or default) bulk-import password. */
export async function verifyBulkImportPassword(input: string): Promise<boolean> {
  if (!input) return false;
  const stored = await getStoredHash();
  return hashBulkImportPassword(input) === stored;
}
