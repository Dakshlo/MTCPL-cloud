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
  /** Temple / client this invoice bills — shown on the Recent card. */
  customer?: string;
  /** How the bill was made — drives the coloured source badge. */
  sourceType?: "purchase" | "work_order" | "running" | "other" | "legacy";
  /** Who generated the invoice (resolved name). */
  createdBy?: string | null;
  /** Source delivery-challan code(s) this invoice bills — work-order invoices
   *  link several (shown as a dropdown). */
  challanCodes?: string[];
  /** A change is staged for approval (mig 184) — edit/cancel are locked until
   *  the owner / accountant★ approves or rejects it. */
  pendingEdit?: boolean;
  pendingCancel?: boolean;
};

const SOURCE_META: Record<NonNullable<InvoiceRow["sourceType"]>, { label: string; color: string; bg: string }> = {
  purchase: { label: "Purchase bill", color: "#0f766e", bg: "rgba(15,118,110,0.12)" },
  work_order: { label: "Work order", color: "#6d28d9", bg: "rgba(124,58,237,0.12)" },
  running: { label: "Running bill", color: "#b45309", bg: "rgba(180,83,9,0.14)" },
  other: { label: "Other sale", color: "#0369a1", bg: "rgba(3,105,161,0.12)" },
  legacy: { label: "Invoice", color: "#64748b", bg: "rgba(100,116,139,0.12)" },
};

function money(n: number) {
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Source challan reference — one code as a chip, several as a click-to-open
 *  dropdown (work-order invoices bundle multiple delivery challans). */
function ChallanRef({ codes }: { codes?: string[] }) {
  const [open, setOpen] = useState(false);
  if (!codes || codes.length === 0) return null;
  const chip: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, color: "var(--muted)", fontFamily: "ui-monospace, monospace", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, padding: "1px 7px", whiteSpace: "nowrap" };
  if (codes.length === 1) return <span style={chip}>📋 {codes[0]}</span>;
  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      <button type="button" onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }} style={{ ...chip, cursor: "pointer" }}>📋 {codes.length} challans {open ? "▴" : "▾"}</button>
      {open && (
        <span onClick={(e) => e.stopPropagation()} style={{ position: "absolute", top: "100%", left: 0, marginTop: 4, zIndex: 50, background: "var(--surface, #fff)", border: "1px solid var(--border)", borderRadius: 8, boxShadow: "0 10px 30px rgba(0,0,0,0.18)", padding: "6px 4px", minWidth: 130, maxHeight: 240, overflowY: "auto", display: "flex", flexDirection: "column", gap: 1 }}>
          {codes.map((c) => <span key={c} style={{ fontSize: 11, fontFamily: "ui-monospace, monospace", fontWeight: 700, color: "var(--text)", padding: "3px 10px", whiteSpace: "nowrap" }}>{c}</span>)}
        </span>
      )}
    </span>
  );
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
  const hasPending = r.pendingEdit || r.pendingCancel;
  return (
    <span style={{ display: "inline-flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}>
      {r.challanHref && (
        <Link href={r.challanHref} target="_blank" rel="noopener noreferrer" style={lnk}>📋 Challan</Link>
      )}
      <Link href={r.href} target={r.external ? "_blank" : undefined} rel={r.external ? "noopener noreferrer" : undefined} style={{ ...lnk, color: "var(--gold-dark)" }}>
        {r.external ? "🧾 Invoice" : "View →"}
      </Link>
      {hasPending && <span title="A change is waiting on the Approval page" style={{ fontSize: 10.5, fontWeight: 800, color: "#b45309", background: "rgba(217,119,6,0.12)", borderRadius: 999, padding: "3px 10px", whiteSpace: "nowrap" }}>⏳ {r.pendingCancel ? "Cancel in approval" : "Edit in approval"}</span>}
      {!hasPending && r.editHref && <button type="button" onClick={() => setEditConfirm(true)} style={{ ...lnk, background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>✎ Edit</button>}
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
      {!hasPending && meta && r.cancelId && (
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
                <td style={{ padding: "9px 14px", fontFamily: "ui-monospace, monospace", fontWeight: 700 }}>
                  {r.code}
                  {r.challanCodes && r.challanCodes.length > 0 && <div style={{ marginTop: 4 }}><ChallanRef codes={r.challanCodes} /></div>}
                </td>
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

/** One invoice card in the Recent view — code, temple, source badge, who made
 *  it, total + actions. */
function InvoiceCard({ r }: { r: InvoiceRow }) {
  const src = SOURCE_META[r.sourceType ?? "legacy"];
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)", padding: "12px 14px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
      <div style={{ minWidth: 150, flex: "0 0 auto" }}>
        <div style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 14.5 }}>{r.code}</div>
        <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{new Date(`${r.date}T00:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })}</div>
      </div>
      <div style={{ flex: "1 1 200px", minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text)" }}>{r.customer || "—"}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3, flexWrap: "wrap" }}>
          <span style={{ fontSize: 10.5, fontWeight: 800, color: src.color, background: src.bg, borderRadius: 999, padding: "2px 9px" }}>{src.label}</span>
          {r.createdBy && <span style={{ fontSize: 11, color: "var(--muted)" }}>by {r.createdBy}</span>}
          <ChallanRef codes={r.challanCodes} />
        </div>
      </div>
      <div style={{ flex: "0 0 auto", fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 14, minWidth: 110, textAlign: "right" }}>₹ {money(r.total)}</div>
      <div style={{ flex: "0 0 auto" }}><InvoiceActions r={r} /></div>
    </div>
  );
}

/** Invoices page body — a Recent/Temple-wise toggle (default Recent). Recent is
 *  one flat list newest-first; Temple-wise keeps the collapsible temple cards +
 *  the Other-sales table. Daksh, Jul 2026. */
export function InvoicesView({ recent, templeList, otherRows }: {
  recent: InvoiceRow[];
  templeList: Array<[string, InvoiceRow[]]>;
  otherRows: InvoiceRow[];
}) {
  const [view, setView] = useState<"recent" | "temple">("recent");
  const seg = (active: boolean): React.CSSProperties => ({
    fontSize: 13, fontWeight: 800, padding: "8px 16px", borderRadius: 9, cursor: "pointer", border: "none",
    background: active ? "var(--gold)" : "transparent", color: active ? "#fff" : "var(--muted)",
  });
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: "inline-flex", gap: 4, padding: 4, borderRadius: 12, background: "var(--bg)", border: "1px solid var(--border)", marginBottom: 16 }}>
        <button type="button" onClick={() => setView("recent")} style={seg(view === "recent")}>🕑 Recent</button>
        <button type="button" onClick={() => setView("temple")} style={seg(view === "temple")}>🏛 Temple-wise</button>
      </div>

      {view === "recent" ? (
        recent.length === 0 ? (
          <div style={{ background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: 12, padding: "30px 22px", textAlign: "center", color: "var(--muted)" }}>No invoices yet.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {recent.map((r) => <InvoiceCard key={r.key} r={r} />)}
          </div>
        )
      ) : (
        <>
          <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", marginBottom: 10 }}>🏛 Temple invoices</div>
          {templeList.length === 0 ? (
            <div style={{ background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: 12, padding: "22px", textAlign: "center", color: "var(--muted)" }}>No temple invoices yet.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {templeList.map(([temple, rows]) => <CollapsibleInvoiceTemple key={temple} temple={temple} rows={rows} />)}
            </div>
          )}
          <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", margin: "22px 0 10px" }}>🏷 Other invoices</div>
          {otherRows.length === 0 ? (
            <div style={{ background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: 12, padding: "22px", textAlign: "center", color: "var(--muted)" }}>No other invoices yet.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {otherRows.map((r) => <InvoiceCard key={r.key} r={r} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
