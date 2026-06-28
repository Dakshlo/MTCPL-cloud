// Canonical challan status (Mig 167 — owner-approval gate).
//
// Flow: open → [accountant prices = "convert"] → pending_approval
//       → [owner approves] invoiced (final bill, on Invoices page)
//       → [owner rejects]  rejected (back to accountant on Challans)
// "converted" is the legacy invoices-row path (Mig 058); "cancelled" is terminal.
//
// A priced challan is NOT a final invoice until the owner approves it — until
// then it lives on the Approval page and its tax-invoice print is watermarked
// "UNDER APPROVAL — NOT VALID".

export type ChallanStatus =
  | "open"
  | "pending_approval"
  | "invoiced"
  | "rejected"
  | "converted"
  | "cancelled";

export type ChallanStatusFields = {
  cancelled_at?: string | null;
  converted_invoice_id?: string | null;
  priced_at?: string | null;
  owner_approved_at?: string | null;
  owner_rejected_at?: string | null;
};

export function challanStatus(c: ChallanStatusFields): ChallanStatus {
  if (c.cancelled_at) return "cancelled";
  if (c.converted_invoice_id) return "converted";
  if (c.priced_at && c.owner_approved_at) return "invoiced";
  if (c.priced_at && c.owner_rejected_at) return "rejected";
  if (c.priced_at) return "pending_approval";
  return "open";
}

export const CHALLAN_STATUS_META: Record<ChallanStatus, { label: string; tone: string; bg: string; fg: string }> = {
  open:             { label: "Open",             tone: "indigo", bg: "#eef2ff", fg: "#3730a3" },
  pending_approval: { label: "Under owner review", tone: "amber", bg: "#fef3c7", fg: "#92400e" },
  invoiced:         { label: "Invoiced",         tone: "emerald", bg: "#d1fae5", fg: "#065f46" },
  rejected:         { label: "Rejected",         tone: "red",    bg: "#fee2e2", fg: "#991b1b" },
  converted:        { label: "Converted",        tone: "emerald", bg: "#d1fae5", fg: "#065f46" },
  cancelled:        { label: "Cancelled",        tone: "slate",  bg: "#f1f5f9", fg: "#475569" },
};
