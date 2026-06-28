/**
 * Temple-as-client billing resolver (Mig 158 → 165). The invoicing challan /
 * invoice bill-to is the temple itself. Returns the BILLING block flat (so the
 * existing review/detail consumers keep working) plus a structured SHIPPING
 * block (null when no separate shipping is set → the invoice uses billing) and
 * the optional vendor code / work-order no.
 *
 * Billing address falls back to the temple's site_location when bill_address
 * isn't set; billing name falls back to the temple name.
 */

import type { createAdminSupabaseClient } from "@/lib/supabase/admin";

export type ShipAddr = {
  name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  state_code: string | null;
  gstin: string | null;
  pan: string | null;
  phone: string | null;
  email: string | null;
};

export type TempleBilling = {
  /** billing name (bill_name → temple name) */
  name: string;
  gstin: string | null;
  pan: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  state_code: string | null;
  email: string | null;
  phone: string | null;
  vendor_code: string | null;
  work_order_no: string | null;
  /** separate shipping address; null ⇒ same as billing */
  shipping: ShipAddr | null;
};

const COLS =
  "name, bill_name, bill_gstin, bill_pan, bill_address, bill_city, bill_state, bill_state_code, bill_email, bill_phone, " +
  "ship_name, ship_address, ship_city, ship_state, ship_state_code, ship_gstin, ship_pan, ship_phone, ship_email, " +
  "vendor_code, work_order_no, site_location";

export async function fetchTempleBilling(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  templeName: string | null | undefined,
): Promise<TempleBilling | null> {
  if (!templeName) return null;
  const { data } = await admin.from("temples").select(COLS).eq("name", templeName).maybeSingle();
  if (!data) {
    return {
      name: templeName, gstin: null, pan: null, address: null, city: null, state: null,
      state_code: null, email: null, phone: null, vendor_code: null, work_order_no: null, shipping: null,
    };
  }
  const t = data as unknown as Record<string, string | null>;
  const ship: ShipAddr = {
    name: t.ship_name, address: t.ship_address, city: t.ship_city, state: t.ship_state,
    state_code: t.ship_state_code, gstin: t.ship_gstin, pan: t.ship_pan, phone: t.ship_phone, email: t.ship_email,
  };
  const shippingSet = Object.values(ship).some((v) => (v ?? "").trim());
  return {
    name: (t.bill_name ?? "").trim() || t.name || templeName,
    gstin: t.bill_gstin,
    pan: t.bill_pan,
    address: t.bill_address ?? t.site_location ?? null,
    city: t.bill_city,
    state: t.bill_state,
    state_code: t.bill_state_code,
    email: t.bill_email,
    phone: t.bill_phone,
    vendor_code: t.vendor_code,
    work_order_no: t.work_order_no,
    shipping: shippingSet ? ship : null,
  };
}
