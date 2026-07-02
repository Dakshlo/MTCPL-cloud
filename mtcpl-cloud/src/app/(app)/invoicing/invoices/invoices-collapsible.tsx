"use client";

/** Collapsible temple card for the Invoices page — collapsed by default; expand
 *  to see that temple's invoices (Daksh, Jul 2026). */

import { useState } from "react";
import Link from "next/link";

export type InvoiceRow = { key: string; code: string; date: string; total: number; href: string; external: boolean };

function money(n: number) {
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
                <td style={{ padding: "9px 14px", width: 100 }}>
                  <Link href={r.href} target={r.external ? "_blank" : undefined} rel={r.external ? "noopener noreferrer" : undefined} style={{ fontSize: 12, fontWeight: 700, color: "var(--gold-dark)", textDecoration: "none" }}>
                    {r.external ? "🖨 Invoice →" : "View →"}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
