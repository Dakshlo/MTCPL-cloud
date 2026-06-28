// Billing/shipping field metadata for the Client-billing page (mig 165).
// PLAIN module (NOT "use client") so the server page can import the real
// ALL_FIELDS array — values exported from a "use client" file become client
// references when imported by a server component and throw when used.

export type FieldMeta = { key: string; label: string; wide?: boolean };

export const BILLING_FIELDS: readonly FieldMeta[] = [
  { key: "bill_name", label: "Name" },
  { key: "bill_address", label: "Address", wide: true },
  { key: "bill_city", label: "City" },
  { key: "bill_state", label: "State" },
  { key: "bill_state_code", label: "State code" },
  { key: "bill_gstin", label: "GSTIN" },
  { key: "bill_pan", label: "PAN" },
  { key: "bill_phone", label: "Phone" },
  { key: "bill_email", label: "Email" },
];
export const SHIPPING_FIELDS: readonly FieldMeta[] = [
  { key: "ship_name", label: "Name" },
  { key: "ship_address", label: "Address", wide: true },
  { key: "ship_city", label: "City" },
  { key: "ship_state", label: "State" },
  { key: "ship_state_code", label: "State code" },
  { key: "ship_gstin", label: "GSTIN" },
  { key: "ship_pan", label: "PAN" },
  { key: "ship_phone", label: "Phone" },
  { key: "ship_email", label: "Email" },
];
export const SHARED_FIELDS: readonly FieldMeta[] = [
  { key: "vendor_code", label: "Vendor code" },
  { key: "work_order_no", label: "Work order no" },
];

export type Field =
  | "bill_name" | "bill_address" | "bill_city" | "bill_state" | "bill_state_code" | "bill_gstin" | "bill_pan" | "bill_phone" | "bill_email"
  | "ship_name" | "ship_address" | "ship_city" | "ship_state" | "ship_state_code" | "ship_gstin" | "ship_pan" | "ship_phone" | "ship_email"
  | "vendor_code" | "work_order_no";

export const ALL_FIELDS: Field[] = [...BILLING_FIELDS, ...SHIPPING_FIELDS, ...SHARED_FIELDS].map((f) => f.key as Field);

export type TempleRow = {
  id: string;
  name: string;
  code_prefix: string;
  is_active: boolean;
  site_location: string;
} & Record<Field, string>;
