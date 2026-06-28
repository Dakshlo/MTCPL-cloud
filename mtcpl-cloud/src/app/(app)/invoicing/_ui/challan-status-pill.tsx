/**
 * Mig 058 → Mig 167 — Challan status pill.
 *
 * Mirrors the BillStatusPill / PaymentStatusPill pattern from
 * src/app/(app)/accounts/_ui/components.tsx so the visual rhythm
 * across departments stays consistent: small rounded chip with a
 * coloured dot + label.
 *
 * Mig 167 — status is now derived from the canonical `challanStatus()`
 * helper (open · pending_approval · invoiced · rejected · converted ·
 * cancelled). Pass the challan's status FIELDS (the same loose shape
 * `challanStatus` accepts) and the pill computes + renders it via
 * CHALLAN_STATUS_META.
 */

import {
  challanStatus,
  CHALLAN_STATUS_META,
  type ChallanStatus,
  type ChallanStatusFields,
} from "@/lib/challan-status";

// Per-status dot colour (the chip bg/fg comes from CHALLAN_STATUS_META).
const DOT: Record<ChallanStatus, string> = {
  open: "#6366f1",             // indigo
  pending_approval: "#f59e0b", // amber
  invoiced: "#10b981",         // emerald
  rejected: "#ef4444",         // red
  converted: "#22c55e",        // emerald
  cancelled: "#94a3b8",        // slate
};

export function ChallanStatusPill({ challan }: { challan: ChallanStatusFields }) {
  const status = challanStatus(challan);
  const meta = CHALLAN_STATUS_META[status];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 10px 3px 8px",
        borderRadius: 999,
        background: meta.bg,
        color: meta.fg,
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
          background: DOT[status],
        }}
      />
      {meta.label}
    </span>
  );
}
