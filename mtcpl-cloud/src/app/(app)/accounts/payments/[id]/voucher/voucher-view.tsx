"use client";

// ──────────────────────────────────────────────────────────────────
// Migration 042 — Payment voucher view
// ──────────────────────────────────────────────────────────────────
// Renders the printable voucher. A "Print / Save as PDF" button at
// the top calls window.print(); a print stylesheet hides the
// non-voucher chrome so the PDF is clean.
//
// Layout copies HDFC's Payment Advice (sample Daksh shared):
// company header, "PAYMENT VOUCHER" section title, two-column data
// list, salutation paragraph, amount in words, signature line.
// ──────────────────────────────────────────────────────────────────

import Link from "next/link";
import { numberToIndianWords } from "./number-to-words";

const COMPANY = {
  name: "MATESHWARI TEMPLE CONSTRUCTION PVT LTD",
  // Daksh — registered office. Keep in sync with the same const in
  // src/app/(app)/accounts/actions.ts (the email + PDF voucher
  // builder reads from there).
  addressLines: [
    "Opposite Ajari Fatak",
    "Pindwara, Sirohi",
    "Rajasthan",
  ],
} as const;

type VendorInfo = {
  name: string;
  address: string | null;
  gstin: string | null;
  pan: string | null;
  phone: string | null;
  email: string | null;
  bank_name: string | null;
  bank_account: string | null;
  ifsc: string | null;
  upi_id: string | null;
};

export function VoucherView({
  payment,
  bill,
  vendor,
}: {
  payment: {
    id: string;
    paidAmount: number;
    paymentMethod: string | null;
    paymentReference: string | null;
    paymentNote: string | null;
    paidAt: string | null;
    paidByName: string | null;
  };
  bill: {
    id: string;
    token: string;
    vendorBillNo: string;
    billDate: string;
    description: string;
    amountSubtotal: number;
    amountTotal: number;
    amountPayableToVendor: number;
    amountTds: number;
    amountTcs: number;
    costHead: string | null;
  };
  vendor: VendorInfo;
}) {
  const paidDate = payment.paidAt
    ? new Date(payment.paidAt)
    : new Date();
  const voucherNo = formatVoucherNo(payment.id, paidDate);
  const amountInWords = numberToIndianWords(payment.paidAmount);

  return (
    <>
      {/* Print + screen styles. The .voucher-only class hides
          everything except the voucher itself when printing. */}
      <style>{`
        @media print {
          .voucher-screen-chrome { display: none !important; }
          body, .page-content { background: #fff !important; }
          .voucher-page { box-shadow: none !important; margin: 0 !important; padding: 18mm 16mm !important; max-width: none !important; border: none !important; }
        }
        .voucher-page {
          background: #fff;
          color: #111;
          max-width: 820px;
          margin: 0 auto;
          padding: 32px 40px 40px;
          border: 1px solid #d8d4c7;
          border-radius: 8px;
          box-shadow: 0 2px 12px rgba(0,0,0,0.06);
          font-family: ui-sans-serif, system-ui, "Helvetica Neue", Arial, sans-serif;
          position: relative;
        }
        /* Letterhead chrome — logo top-left + gold accent line. */
        .voucher-letterhead-header {
          display: flex;
          align-items: center;
          padding-bottom: 14px;
          border-bottom: 1px solid #222;
          margin-bottom: 0;
        }
        .voucher-letterhead-header img {
          height: 56px;
          width: auto;
        }
        .voucher-title-pill {
          display: inline-block;
          padding: 7px 18px;
          background: var(--gold-dark, #b87333);
          color: #fff;
          font-size: 13px;
          font-weight: 800;
          letter-spacing: 0.08em;
          border-radius: 4px;
        }
        /* Letterhead footer — address + phones + websites. */
        .voucher-letterhead-footer {
          margin-top: 28px;
          padding-top: 10px;
          border-top: 1px solid #222;
          text-align: center;
          font-size: 10.5px;
          color: #555;
          line-height: 1.55;
        }
        .voucher-letterhead-footer .gen-note {
          font-size: 9px;
          font-style: italic;
          color: #888;
          margin-top: 6px;
        }
        .voucher-kv { display: grid; grid-template-columns: 200px auto 1fr; gap: 6px 12px; font-size: 13px; }
        .voucher-kv dt { color: #555; font-weight: 600; }
        .voucher-kv dd { margin: 0; color: #111; font-weight: 600; }
        .voucher-kv .sep { color: #888; }
      `}</style>

      {/* Screen-only toolbar */}
      <div
        className="voucher-screen-chrome"
        style={{
          maxWidth: 780,
          margin: "0 auto 14px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <Link
          href={`/accounts/bills/${bill.id}`}
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--muted)",
            textDecoration: "none",
          }}
        >
          ← Back to bill {bill.token}
        </Link>
        <button
          type="button"
          onClick={() => window.print()}
          style={{
            padding: "9px 18px",
            fontSize: 13,
            fontWeight: 700,
            background: "var(--gold)",
            color: "#fff",
            border: "1px solid var(--gold-dark)",
            borderRadius: 8,
            cursor: "pointer",
          }}
        >
          🖨 Print / Save as PDF
        </button>
      </div>

      <article className="voucher-page">
        {/* Letterhead chrome — logo top-left + dark accent line.
            Mirrors the printed MTCPL letterhead so the on-screen and
            emailed PDF feel like the same document. */}
        <header className="voucher-letterhead-header">
          <img src="/logo-dark.png" alt="MTCPL" />
        </header>

        {/* "PAYMENT VOUCHER" title as a gold pill, sitting just below
            the letterhead logo line. */}
        <div style={{ textAlign: "center", margin: "20px 0 22px" }}>
          <span className="voucher-title-pill">PAYMENT VOUCHER</span>
        </div>

        {/* Two-column key/value list (HDFC-style) */}
        <dl className="voucher-kv">
          <KV k="Voucher No" v={voucherNo} mono />
          <KV
            k="Voucher Date"
            v={paidDate.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata",
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
            })}
          />
          <KV k="Remitter Name" v={COMPANY.name} />
          <KV
            k="Beneficiary Name"
            v={vendor.name.toUpperCase()}
          />
          {vendor.bank_account && <KV k="Beneficiary A/c No" v={vendor.bank_account} mono />}
          {vendor.ifsc && <KV k="Beneficiary IFSC" v={vendor.ifsc} mono />}
          {vendor.gstin && <KV k="Beneficiary GSTIN" v={vendor.gstin} mono />}
          {vendor.pan && <KV k="Beneficiary PAN" v={vendor.pan} mono />}
          <KV
            k="Bill Token"
            v={bill.token}
            mono
            highlight
          />
          <KV
            k="Vendor's Bill No"
            v={bill.vendorBillNo}
            mono
          />
          <KV
            k="Bill Date"
            v={new Date(bill.billDate).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata",
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
            })}
          />
          {bill.costHead && <KV k="Cost Head" v={bill.costHead} />}
          <KV
            k="Payment Mode"
            v={(payment.paymentMethod ?? "—").toUpperCase()}
            mono
          />
          {payment.paymentReference && (
            <KV
              k={
                payment.paymentMethod === "cheque"
                  ? "Cheque No"
                  : payment.paymentMethod === "upi"
                    ? "UPI Txn Ref"
                    : "UTR / Reference"
              }
              v={payment.paymentReference}
              mono
              highlight
            />
          )}
          {payment.paymentNote && <KV k="Payment Note" v={payment.paymentNote} />}
          <KV
            k="Amount"
            v={`₹${payment.paidAmount.toLocaleString("en-IN", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}`}
            mono
            highlight
          />
          <KV k="Amount in Words" v={`${amountInWords} Only`} />
          {bill.amountTds > 0 && (
            <KV
              k="TDS deducted (info only)"
              v={`₹${bill.amountTds.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`}
              mono
            />
          )}
          {bill.amountTcs > 0 && (
            <KV
              k="TCS in total (info only)"
              v={`₹${bill.amountTcs.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`}
              mono
            />
          )}
        </dl>

        {/* Salutation paragraph (mirrors HDFC's "Dear Sir/Madam …") */}
        <p
          style={{
            margin: "22px 0 0",
            fontSize: 13,
            lineHeight: 1.6,
            color: "#222",
          }}
        >
          Dear Sir / Madam,
          <br />
          We are pleased to credit your account
          {vendor.bank_account ? ` (${vendor.bank_account})` : ""} with us for
          <strong>
            {" "}
            ₹{payment.paidAmount.toLocaleString("en-IN", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}{" "}
          </strong>
          ({amountInWords} Only) against bill{" "}
          <strong>{bill.token}</strong>
          {" "}({bill.vendorBillNo}) dated{" "}
          {new Date(bill.billDate).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata",
            day: "2-digit",
            month: "long",
            year: "numeric",
          })}.
        </p>

        {/* Bill description for reference */}
        {bill.description && (
          <div
            style={{
              marginTop: 18,
              padding: "10px 14px",
              background: "#f9f7f1",
              border: "1px solid #ddd6c2",
              borderRadius: 6,
              fontSize: 12,
              color: "#333",
              lineHeight: 1.6,
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 800,
                color: "#666",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                marginBottom: 4,
              }}
            >
              Bill description
            </div>
            {bill.description}
          </div>
        )}

        {/* Signature line */}
        <div
          style={{
            marginTop: 56,
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 36,
          }}
        >
          <SignatureBlock label="Prepared by" name={payment.paidByName ?? "Accountant"} />
          <SignatureBlock label="Authorised signatory" name="For " companySuffix />
        </div>

        {/* Letterhead-style footer with address + phones + websites
            (matches the printed letterhead PDF), plus a tiny
            computer-generated note underneath. */}
        <footer className="voucher-letterhead-footer">
          <div>
            Mateshwari Temples Construction Pvt. Ltd. · Nh-27, Opposite Ajari Gate, Pindwara, Dist-Sirohi, Rajasthan
          </div>
          <div>
            ☎ +91 9414152740 / +91 9414374979 · 🌐 Mtcpl.org · mateshwaritemples.com
          </div>
          <div className="gen-note">
            Computer-generated voucher · {new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata",
              day: "2-digit",
              month: "short",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </div>
        </footer>
      </article>
    </>
  );
}

function KV({
  k,
  v,
  mono,
  highlight,
}: {
  k: string;
  v: string;
  mono?: boolean;
  highlight?: boolean;
}) {
  return (
    <>
      <dt>{k}</dt>
      <dd className="sep">:</dd>
      <dd
        style={{
          fontFamily: mono ? "ui-monospace, SFMono-Regular, Menlo, monospace" : undefined,
          background: highlight ? "#fff3cd" : undefined,
          padding: highlight ? "2px 8px" : undefined,
          borderRadius: highlight ? 4 : undefined,
          display: highlight ? "inline-block" : undefined,
          justifySelf: "start",
        }}
      >
        {v}
      </dd>
    </>
  );
}

function SignatureBlock({
  label,
  name,
  companySuffix,
}: {
  label: string;
  name: string;
  companySuffix?: boolean;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          fontWeight: 800,
          color: "#666",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginBottom: 32,
        }}
      >
        {label}
      </div>
      <div
        style={{
          borderTop: "1px solid #444",
          paddingTop: 6,
          fontSize: 12,
          fontWeight: 700,
          color: "#222",
        }}
      >
        {name}
        {companySuffix && <em style={{ fontStyle: "normal" }}>{COMPANY.name}</em>}
      </div>
    </div>
  );
}

const COMPANY_NAME_FOR_VOUCHER_NO = "MTCPL";

/** Short voucher number format: MTCPL/<DDMMYY>/<last-6-of-uuid>.
 *  Date-stamped so a quick scan tells you when the voucher was
 *  generated; last-6 of the UUID disambiguates same-day vouchers. */
function formatVoucherNo(paymentId: string, paidAt: Date): string {
  const dd = String(paidAt.getDate()).padStart(2, "0");
  const mm = String(paidAt.getMonth() + 1).padStart(2, "0");
  const yy = String(paidAt.getFullYear()).slice(2);
  const short = paymentId.replace(/-/g, "").slice(-6).toUpperCase();
  return `${COMPANY_NAME_FOR_VOUCHER_NO}/${dd}${mm}${yy}/${short}`;
}
