/**
 * Temple-as-client billing resolver (Mig 158). The invoicing challan / invoice
 * bill-to block is the temple itself — name = temple name, plus the billing
 * fields the accountant fills in Invoicing. Billing address falls back to the
 * temple's site_location when a dedicated bill_address isn't set.
 */

import type { createAdminSupabaseClient } from "@/lib/supabase/admin";

export type TempleBilling = {
  name: string;
  gstin: string | null;
  pan: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
};

export async function fetchTempleBilling(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  templeName: string | null | undefined,
): Promise<TempleBilling | null> {
  if (!templeName) return null;
  const { data } = await admin
    .from("temples")
    .select("name, bill_gstin, bill_pan, bill_address, bill_email, bill_phone, site_location")
    .eq("name", templeName)
    .maybeSingle();
  if (!data) return { name: templeName, gstin: null, pan: null, address: null, email: null, phone: null };
  const t = data as {
    name: string;
    bill_gstin: string | null;
    bill_pan: string | null;
    bill_address: string | null;
    bill_email: string | null;
    bill_phone: string | null;
    site_location: string | null;
  };
  return {
    name: t.name,
    gstin: t.bill_gstin,
    pan: t.bill_pan,
    address: t.bill_address ?? t.site_location ?? null,
    email: t.bill_email,
    phone: t.bill_phone,
  };
}
