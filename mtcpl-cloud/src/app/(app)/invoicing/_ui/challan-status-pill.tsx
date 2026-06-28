/**
 * Mig 058 — Challan status pill.
 *
 * Mirrors the BillStatusPill / PaymentStatusPill pattern from
 * src/app/(app)/accounts/_ui/components.tsx so the visual rhythm
 * across departments stays consistent: small rounded chip with a
 * coloured dot + label.
 *
 * Three statuses for a challan:
 *   • open       — created, not cancelled, not yet converted to invoice
 *   • converted  — has a converted_invoice_id set
 *   • cancelled  — cancelled_at set
 */

const CHALLAN_STATUS_TINT: Record<
  "open" | "invoiced" | "converted" | "cancelled",
  { label: string; bg: string; fg: string; dot: string }
> = {
  open:      { label: "Open",      bg: "#e0e7ff", fg: "#3730a3", dot: "#6366f1" }, // indigo
  // "invoiced" = priced (the priced challan IS the tax invoice — mig 157).
  invoiced:  { label: "Invoiced",  bg: "#fef3c7", fg: "#92400e", dot: "#f59e0b" }, // amber
  converted: { label: "Converted", bg: "#dcfce7", fg: "#166534", dot: "#22c55e" }, // emerald
  cancelled: { label: "Cancelled", bg: "#f1f5f9", fg: "#475569", dot: "#94a3b8" }, // slate
};

export function ChallanStatusPill({
  status,
}: {
  status: "open" | "invoiced" | "converted" | "cancelled";
}) {
  const t = CHALLAN_STATUS_TINT[status];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 10px 3px 8px",
        borderRadius: 999,
        background: t.bg,
        color: t.fg,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.02em",
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: t.dot,
        }}
      />
      {t.label}
    </span>
  );
}
