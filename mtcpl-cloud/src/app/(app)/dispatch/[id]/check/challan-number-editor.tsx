"use client";

// Challan No. on Check & verify. LOCKED (Daksh Jul 2026) — the number is assigned
// once when the dispatch is created and held through every re-verify; it can no
// longer be hand-edited here. Cancelling the dispatch frees it for reuse.

export function ChallanNumberEditor({ dispatchId: _dispatchId, fy, seq }: { dispatchId: string; fy: string; seq: number | null }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
      <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, color: "#D97706", fontSize: 15 }}>
        CH-{fy}-{seq != null ? String(seq).padStart(2, "0") : "—"}
      </span>
      <span title="The challan number is fixed — assigned when the dispatch was created." style={{ fontSize: 10, fontWeight: 800, color: "var(--muted)", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 999, padding: "1px 8px", whiteSpace: "nowrap" }}>🔒 LOCKED</span>
    </span>
  );
}
