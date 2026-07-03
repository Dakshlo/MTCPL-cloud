"use client";

/** Collapsible temple card + per-invoice actions for the Invoices page —
 *  collapsed by default; each row offers: download challan + invoice, ✎ Edit
 *  (everything but the invoice number) and ✕ Cancel (frees the number, sends
 *  the challan back to its source page). Daksh, Jul 2026. */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FinanceLoadingOverlay } from "@/components/finance-loading-overlay";
import { cancelPricedInvoiceAction, cancelRunningInvoiceAction, cancelBulkInvoiceAction } from "../actions";
import { cancelOtherInvoiceAction } from "../other/actions";

export type InvoiceRow = {
  key: string;
  code: string;
  date: string;
  total: number;
  href: string;
  external: boolean;
  /** Delivery-challan print for this invoice (null = none, e.g. bulk). */
  challanHref?: string | null;
  /** Edit surface (number stays locked). null = not editable (legacy). */
  editHref?: string | null;
  /** Which cancel action applies. null = not cancellable (legacy). */
  cancelKind?: "priced" | "running" | "bulk" | "other" | null;
  /** Id posted to the cancel action. */
  cancelId?: string;
};

function money(n: number) {
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const CANCEL_META = {
  priced: { action: cancelPricedInvoiceAction, field: "challan_id", back: "the challan returns to the Challans page" },
  running: { action: cancelRunningInvoiceAction, field: "challan_id", back: "the bill returns to Running bills" },
  bulk: { action: cancelBulkInvoiceAction, field: "id", back: "its challans return to the Bulk pool" },
  other: { action: cancelOtherInvoiceAction, field: "other_challan_id", back: "the challan returns to Other Sales" },
} as const;

/** Row-level action strip — shared by the temple cards and the Other table. */
export function InvoiceActions({ r }: { r: InvoiceRow }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [editConfirm, setEditConfirm] = useState(false);
  const [pending, setPending] = useState(false);
  const meta = r.cancelKind ? CANCEL_META[r.cancelKind] : null;
  return (
    <span style={{ display: "inline-flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}>
      {r.challanHref && (
        <Link href={r.challanHref} target="_blank" rel="noopener noreferrer" style={lnk}>📋 Challan</Link>
      )}
      <Link href={r.href} target={r.external ? "_blank" : undefined} rel={r.external ? "noopener noreferrer" : undefined} style={{ ...lnk, color: "var(--gold-dark)" }}>
        {r.external ? "🧾 Invoice" : "View →"}
      </Link>
      {r.editHref && <button type="button" onClick={() => setEditConfirm(true)} style={{ ...lnk, background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>✎ Edit</button>}
      {editConfirm && r.editHref && (
        <span onClick={(e) => e.stopPropagation()} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(15,23,42,0.45)", display: "grid", placeItems: "center", padding: 20 }}>
          <FinanceLoadingOverlay show={pending} label="Opening editor…" />
          <div style={{ width: "min(420px, 100%)", background: "var(--surface, #fff)", borderRadius: 16, padding: "22px 22px 18px", boxShadow: "0 24px 60px rgba(0,0,0,0.3)", textAlign: "left" }}>
            <div style={{ fontSize: 28, marginBottom: 6 }}>✎</div>
            <div style={{ fontSize: 16.5, fontWeight: 800, color: "var(--text)", marginBottom: 6 }}>Edit invoice {r.code}?</div>
            <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5, margin: "0 0 16px" }}>You can change everything <strong>except the invoice number</strong>, which stays <strong>{r.code}</strong>. The invoice remains approved.</p>
            <span style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button type="button" disabled={pending} onClick={() => setEditConfirm(false)} style={{ fontSize: 13, fontWeight: 700, padding: "9px 15px", borderRadius: 10, border: "1.5px solid var(--border)", background: "var(--bg)", color: "var(--text)", cursor: "pointer" }}>Cancel</button>
              <button type="button" disabled={pending} onClick={() => { setPending(true); router.push(r.editHref!); }} style={{ fontSize: 13, fontWeight: 800, padding: "9px 17px", borderRadius: 10, border: "none", color: "#fff", background: "#0f172a", cursor: "pointer", opacity: pending ? 0.7 : 1 }}>✎ Edit invoice</button>
            </span>
          </div>
        </span>
      )}
      {meta && r.cancelId && (
        <>
          <button type="button" onClick={() => setConfirming(true)} style={{ ...lnk, color: "#b91c1c", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>✕ Cancel</button>
          {confirming && (
            <span onClick={(e) => e.stopPropagation()} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(15,23,42,0.45)", display: "grid", placeItems: "center", padding: 20 }}>
              <FinanceLoadingOverlay show={pending} label="Cancelling invoice…" />
              <form
                action={meta.action}
                onSubmit={() => setPending(true)}
                style={{ width: "min(430px, 100%)", background: "var(--surface, #fff)", borderRadius: 16, padding: "22px 22px 18px", boxShadow: "0 24px 60px rgba(0,0,0,0.3)", textAlign: "left" }}
              >
                <input type="hidden" name={meta.field} value={r.cancelId} />
                <div style={{ fontSize: 30, marginBottom: 6 }}>🗑</div>
                <div style={{ fontSize: 16.5, fontWeight: 800, color: "var(--text)", marginBottom: 6 }}>Cancel invoice {r.code}?</div>
                <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5, margin: "0 0 16px" }}>
                  Its number is <strong>freed</strong> (reused instantly if it was the latest, otherwise shown as a free gap) and {meta.back}. This cannot be undone.
                </p>
                <span style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                  <button type="button" disabled={pending} onClick={() => setConfirming(false)} style={{ fontSize: 13, fontWeight: 700, padding: "9px 15px", borderRadius: 10, border: "1.5px solid var(--border)", background: "var(--bg)", color: "var(--text)", cursor: "pointer" }}>Keep it</button>
                  <button type="submit" disabled={pending} style={{ fontSize: 13, fontWeight: 800, padding: "9px 17px", borderRadius: 10, border: "none", color: "#fff", background: "#b91c1c", cursor: "pointer", opacity: pending ? 0.7 : 1 }}>
                    {pending ? "Cancelling…" : "✕ Cancel invoice"}
                  </button>
                </span>
              </form>
            </span>
          )}
        </>
      )}
    </span>
  );
}

export function CollapsibleInvoiceTemple({ temple, rows }: { temple: string; rows: InvoiceRow[] }) {
  const [open, setOpen] = useState(false);
  const total = rows.reduce((s, r) => s + r.total, 0);
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", background: "var(--surface)" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "11px 14px", background: "var(--bg)", border: "none", cursor: "pointer", textAlign: "left", color: "var(--text)" }}
      >
        <span style={{ fontSize: 12, display: "inline-block", transform: open ? "rotate(90deg)" : "none", transition: "transform .12s", color: "var(--gold-dark)" }}>▶</span>
        <span style={{ fontSize: 15, fontWeight: 800 }}>🏛 {temple}</span>
        <span className="muted" style={{ fontSize: 12.5, fontWeight: 600 }}>{rows.length} invoice{rows.length === 1 ? "" : "s"}</span>
        <span style={{ marginLeft: "auto", fontSize: 13, fontWeight: 800, fontFamily: "ui-monospace, monospace" }}>₹ {money(total)}</span>
      </button>
      {open && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={{ padding: "9px 14px", fontFamily: "ui-monospace, monospace", fontWeight: 700 }}>{r.code}</td>
                <td style={{ padding: "9px 14px", color: "var(--muted)" }}>
                  {new Date(`${r.date}T00:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })}
                </td>
                <td style={{ padding: "9px 14px", textAlign: "right", fontFamily: "ui-monospace, monospace" }}>{money(r.total)}</td>
                <td style={{ padding: "9px 14px", textAlign: "right" }}>
                  <InvoiceActions r={r} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const lnk: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: "var(--text)", textDecoration: "none" };
