"use client";

// ──────────────────────────────────────────────────────────────────
// Bill Statement view (Daksh, Aug 2026) — printable master copy.
// Same letterhead + print discipline as the payment voucher, but the
// body is a LEDGER: every instalment with a running balance, so the
// whole life of a part-paid bill reads on one sheet.
//
// Marked INTERNAL on its face — this is never sent to a vendor.
// Keep the company block in step with voucher-view.tsx.
// ──────────────────────────────────────────────────────────────────

import Link from "next/link";

const COMPANY = {
  name: "MATESHWARI TEMPLE CONSTRUCTION PVT LTD",
  address:
    "G-109, RIICO Ind. Area, Sirohi Road, Teh. Pindwara, Dist. Sirohi, Rajasthan",
  gstin: "08AAFCM15Q1ZA",
  phone: "759 759 1188",
  email: "temple@mtcpl.co",
} as const;

export type StatementPayment = {
  id: string;
  amount: number;
  paidAt: string | null;
  method: string | null;
  reference: string | null;
  note: string | null;
  who: string | null;
  /** bank = real payout; the rest moved the balance without new cash. */
  kind: "bank" | "settlement" | "debit" | "advance";
  reason: string | null;
};

type Bill = {
  token: string; vendorBillNo: string | null; billDate: string | null;
  description: string | null; costHead: string | null; status: string;
  subtotal: number; gstPercent: number; gst: number; total: number;
  tds: number; tcs: number; payable: number; paid: number; outstanding: number;
  held: number; heldReason: string | null; partialRejection: number;
  approvedAt: string | null; approvedBy: string | null;
  submittedAt: string | null; submittedBy: string | null;
};

type Vendor = {
  name: string; address: string | null; gstin: string | null; pan: string | null;
  phone: string | null; email: string | null;
  bankName: string | null; bankAccount: string | null; ifsc: string | null;
};

const inr = (n: number) =>
  `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const dmy = (iso: string | null) =>
  !iso
    ? "—"
    : new Date(iso).toLocaleDateString("en-IN", {
        timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric",
      });

const dmyTime = (iso: string | null) =>
  !iso
    ? "—"
    : new Date(iso).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      });

const KIND_LABEL: Record<StatementPayment["kind"], string> = {
  bank: "Bank payment",
  settlement: "Settled (paid outside software)",
  debit: "Debit adjustment",
  advance: "Advance applied",
};

export function StatementView({
  bill, vendor, payments, cancelledCount, billId, generatedBy,
}: {
  bill: Bill; vendor: Vendor; payments: StatementPayment[];
  cancelledCount: number; billId: string; generatedBy: string;
}) {
  // Running balance down the ledger — what was still owed after each
  // instalment. This is the column the part-payment story needs.
  let balance = bill.payable;
  const rows = payments.map((p) => {
    balance -= p.amount;
    return { ...p, balanceAfter: balance };
  });
  const bankTotal = payments.filter((p) => p.kind === "bank").reduce((s, p) => s + p.amount, 0);
  const otherTotal = payments.filter((p) => p.kind !== "bank").reduce((s, p) => s + p.amount, 0);
  const pctPaid = bill.payable > 0 ? (bill.paid / bill.payable) * 100 : 0;

  return (
    <>
      <style>{`
        @media print {
          @page { size: A4; margin: 0; }
          .stmt-chrome { display: none !important; }
          body, .page-content { background: #fff !important; }
          .stmt-page {
            box-shadow: none !important; margin: 0 !important;
            padding: 10mm 12mm !important; max-width: none !important;
            border: none !important; font-size: 11px !important;
          }
          .stmt-ledger { font-size: 10px !important; }
          .stmt-ledger th, .stmt-ledger td { padding: 4px 6px !important; }
          .stmt-head img { height: 40px !important; }
          thead { display: table-header-group; }  /* repeat header across pages */
          tr { page-break-inside: avoid; }
        }
        .stmt-page {
          background: #fff; color: #111; max-width: 900px; margin: 0 auto;
          padding: 30px 38px 38px; border: 1px solid #e5e7eb; border-radius: 10px;
          box-shadow: 0 8px 30px rgba(0,0,0,0.06);
          font-family: ui-sans-serif, system-ui, sans-serif;
        }
        .stmt-head { display:flex; align-items:flex-start; gap:16px; border-bottom:2px solid #111; padding-bottom:12px; }
        .stmt-head img { height:52px; width:auto; }
        .stmt-kv { display:grid; grid-template-columns:auto 1fr; gap:4px 12px; font-size:12px; }
        .stmt-kv dt { color:#6b7280; }
        .stmt-kv dd { margin:0; font-weight:600; }
        .stmt-ledger { width:100%; border-collapse:collapse; font-size:11.5px; margin-top:8px; }
        .stmt-ledger th { background:#f3f4f6; text-align:left; padding:7px 8px; border-bottom:1px solid #d1d5db;
                          font-size:9.5px; letter-spacing:.06em; text-transform:uppercase; color:#4b5563; }
        .stmt-ledger td { padding:7px 8px; border-bottom:1px solid #eee; vertical-align:top; }
        .stmt-ledger .r { text-align:right; font-variant-numeric:tabular-nums; }
        .stmt-box { border:1px solid #e5e7eb; border-radius:8px; padding:10px 14px; }
      `}</style>

      {/* Screen-only toolbar */}
      <div className="stmt-chrome" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, maxWidth: 900, margin: "0 auto 14px", flexWrap: "wrap" }}>
        <Link href={`/accounts/bills/${billId}`} style={{ fontSize: 13, fontWeight: 600, color: "var(--muted)", textDecoration: "none" }}>
          ← Back to bill {bill.token}
        </Link>
        <button
          type="button"
          onClick={() => window.print()}
          style={{ padding: "9px 18px", fontSize: 13, fontWeight: 700, background: "var(--gold)", color: "#fff", border: "1px solid var(--gold-dark)", borderRadius: 8, cursor: "pointer" }}
        >
          🖨 Print / Save as PDF
        </button>
      </div>

      <article className="stmt-page">
        <header className="stmt-head">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-dark.png" alt="MTCPL" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 800 }}>{COMPANY.name}</div>
            <div style={{ fontSize: 10, color: "#4b5563" }}>{COMPANY.address}</div>
            <div style={{ fontSize: 10, color: "#4b5563" }}>
              <strong>GSTIN: {COMPANY.gstin}</strong> · ☎ {COMPANY.phone} · ✉ {COMPANY.email}
            </div>
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div style={{ display: "inline-block", background: "#111", color: "#fff", borderRadius: 999, padding: "5px 14px", fontSize: 11, fontWeight: 800, letterSpacing: ".08em" }}>
              BILL STATEMENT
            </div>
            <div style={{ fontSize: 9.5, color: "#9ca3af", marginTop: 5 }}>INTERNAL RECORD</div>
          </div>
        </header>

        {/* Bill + vendor identity */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
          <div className="stmt-box">
            <div style={{ fontSize: 9.5, fontWeight: 800, color: "#6b7280", letterSpacing: ".08em", marginBottom: 7 }}>BILL</div>
            <dl className="stmt-kv">
              <dt>Token</dt><dd>{bill.token}</dd>
              <dt>Vendor bill no.</dt><dd>{bill.vendorBillNo || "—"}</dd>
              <dt>Bill date</dt><dd>{dmy(bill.billDate)}</dd>
              <dt>Cost head</dt><dd>{bill.costHead || "—"}</dd>
              <dt>Description</dt><dd>{bill.description || "—"}</dd>
              <dt>Status</dt><dd style={{ textTransform: "uppercase" }}>{bill.status.replace(/_/g, " ")}</dd>
            </dl>
          </div>
          <div className="stmt-box">
            <div style={{ fontSize: 9.5, fontWeight: 800, color: "#6b7280", letterSpacing: ".08em", marginBottom: 7 }}>VENDOR</div>
            <dl className="stmt-kv">
              <dt>Name</dt><dd>{vendor.name}</dd>
              {vendor.gstin && (<><dt>GSTIN</dt><dd>{vendor.gstin}</dd></>)}
              {vendor.pan && (<><dt>PAN</dt><dd>{vendor.pan}</dd></>)}
              {vendor.phone && (<><dt>Phone</dt><dd>{vendor.phone}</dd></>)}
              {vendor.bankName && (<><dt>Bank</dt><dd>{vendor.bankName}</dd></>)}
              {vendor.bankAccount && (<><dt>A/C no.</dt><dd>{vendor.bankAccount}</dd></>)}
              {vendor.ifsc && (<><dt>IFSC</dt><dd>{vendor.ifsc}</dd></>)}
            </dl>
          </div>
        </div>

        {/* Money breakdown */}
        <div className="stmt-box" style={{ marginTop: 14 }}>
          <div style={{ fontSize: 9.5, fontWeight: 800, color: "#6b7280", letterSpacing: ".08em", marginBottom: 8 }}>AMOUNT</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <tbody>
              <Row label="Taxable value" value={inr(bill.subtotal)} />
              {bill.gst > 0 && <Row label={`GST${bill.gstPercent ? ` @ ${bill.gstPercent}%` : ""}`} value={inr(bill.gst)} />}
              <Row label="Bill total" value={inr(bill.total)} bold />
              {bill.tds > 0 && <Row label="Less: TDS" value={`− ${inr(bill.tds)}`} />}
              {bill.tcs > 0 && <Row label="Add: TCS" value={inr(bill.tcs)} />}
              {bill.partialRejection > 0 && <Row label="Less: partial rejection" value={`− ${inr(bill.partialRejection)}`} />}
              <Row label="Net payable to vendor" value={inr(bill.payable)} bold />
              <Row label="Total paid" value={inr(bill.paid)} tone="#15803d" bold />
              <Row label="Outstanding" value={inr(bill.outstanding)} tone={bill.outstanding > 0 ? "#b45309" : "#15803d"} bold />
              {bill.held > 0 && <Row label={`Owner hold${bill.heldReason ? ` — ${bill.heldReason}` : ""}`} value={inr(bill.held)} tone="#b45309" />}
            </tbody>
          </table>
          <div style={{ marginTop: 8, fontSize: 11, color: "#6b7280" }}>
            {pctPaid.toFixed(1)}% settled · {payments.length} instalment{payments.length === 1 ? "" : "s"}
            {cancelledCount > 0 && ` · ${cancelledCount} cancelled/reversed entr${cancelledCount === 1 ? "y" : "ies"} not shown`}
          </div>
        </div>

        {/* The ledger — the reason this document exists */}
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 9.5, fontWeight: 800, color: "#6b7280", letterSpacing: ".08em" }}>PAYMENT RECORD</div>
          {rows.length === 0 ? (
            <p style={{ fontSize: 12, color: "#6b7280", marginTop: 8 }}>No payments recorded against this bill yet.</p>
          ) : (
            <table className="stmt-ledger">
              <thead>
                <tr>
                  <th style={{ width: 26 }}>#</th>
                  <th>Date</th>
                  <th>Type · Method</th>
                  <th>Reference</th>
                  <th>By</th>
                  <th className="r">Amount</th>
                  <th className="r">Balance after</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p, i) => (
                  <tr key={p.id}>
                    <td>{i + 1}</td>
                    <td>{dmyTime(p.paidAt)}</td>
                    <td>
                      {p.kind === "bank"
                        ? (p.method ? p.method.toUpperCase() : "—")
                        : <span style={{ color: "#6d28d9", fontWeight: 700 }}>{KIND_LABEL[p.kind]}</span>}
                      {p.reason && <div style={{ color: "#6b7280", fontSize: 10 }}>{p.reason}</div>}
                    </td>
                    <td>{p.reference || "—"}</td>
                    <td>{p.who || "—"}</td>
                    <td className="r" style={{ fontWeight: 700 }}>{inr(p.amount)}</td>
                    <td className="r" style={{ color: p.balanceAfter > 0 ? "#b45309" : "#15803d" }}>{inr(p.balanceAfter)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: "#f9fafb" }}>
                  <td colSpan={5} style={{ fontWeight: 800, padding: "8px" }}>
                    Total paid
                    {otherTotal > 0 && (
                      <span style={{ fontWeight: 500, color: "#6b7280" }}>
                        {"  "}(bank {inr(bankTotal)} + non-bank {inr(otherTotal)})
                      </span>
                    )}
                  </td>
                  <td className="r" style={{ fontWeight: 800, padding: "8px" }}>{inr(bill.paid)}</td>
                  <td className="r" style={{ fontWeight: 800, padding: "8px" }}>{inr(bill.outstanding)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>

        {/* Approval trail + footer */}
        <div style={{ display: "flex", gap: 24, marginTop: 16, fontSize: 10.5, color: "#4b5563", flexWrap: "wrap" }}>
          <span>Submitted: {dmy(bill.submittedAt)}{bill.submittedBy ? ` · ${bill.submittedBy}` : ""}</span>
          <span>Approved: {dmy(bill.approvedAt)}{bill.approvedBy ? ` · ${bill.approvedBy}` : ""}</span>
        </div>

        <footer style={{ marginTop: 18, paddingTop: 10, borderTop: "1px solid #e5e7eb", fontSize: 9.5, color: "#6b7280", display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <span>
            <strong>Internal record — not a vendor document.</strong> Generated from MTCPL Cloud on{" "}
            {dmyTime(new Date().toISOString())} by {generatedBy}.
          </span>
          <span>{bill.token}</span>
        </footer>
      </article>
    </>
  );
}

function Row({ label, value, bold, tone }: { label: string; value: string; bold?: boolean; tone?: string }) {
  return (
    <tr>
      <td style={{ padding: "4px 0", color: bold ? "#111" : "#4b5563", fontWeight: bold ? 700 : 400 }}>{label}</td>
      <td style={{ padding: "4px 0", textAlign: "right", fontWeight: bold ? 800 : 600, color: tone ?? "#111", fontVariantNumeric: "tabular-nums" }}>{value}</td>
    </tr>
  );
}
