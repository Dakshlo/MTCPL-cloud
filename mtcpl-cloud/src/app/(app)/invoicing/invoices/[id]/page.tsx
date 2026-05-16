import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canUseInvoicing } from "@/lib/invoicing-permissions";
import { PrintButton } from "./print-button";

// Invoice detail + printable preview (Migration 038, moved under
// /invoicing/invoices/[id] in Mig 058 — dashboard now lives at
// /invoicing/).
//
// The card you see on screen IS the print layout — same DOM. CSS
// `@media print` hides the sidebar / topbar / app chrome via the
// `print-hide` class. Click the Print button (top-right) to fire
// window.print() — the browser renders this card alone.

type Params = Promise<{ id: string }>;

export default async function InvoiceDetailPage({ params }: { params: Params }) {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) redirect("/");
  const { id } = await params;
  const supabase = createAdminSupabaseClient();

  const { data: header, error: headerErr } = await supabase
    .from("invoices")
    .select(
      "id, invoice_number, invoice_date, customer_name, customer_address, customer_gstin, customer_phone, subtotal, gst_percent, amount_gst, total, notes, created_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (headerErr) throw new Error(headerErr.message);
  if (!header) notFound();

  const { data: items } = await supabase
    .from("invoice_items")
    .select("id, description, quantity, rate, amount, position")
    .eq("invoice_id", id)
    .order("position", { ascending: true });

  const rows = (items ?? []) as Array<{
    id: string;
    description: string;
    quantity: number;
    rate: number;
    amount: number;
    position: number;
  }>;

  const inv = header as {
    id: string;
    invoice_number: string;
    invoice_date: string;
    customer_name: string;
    customer_address: string | null;
    customer_gstin: string | null;
    customer_phone: string | null;
    subtotal: number;
    gst_percent: number;
    amount_gst: number;
    total: number;
    notes: string | null;
    created_at: string;
  };

  return (
    <section className="page-card">
      <div
        className="print-hide"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 14,
          gap: 12,
        }}
      >
        <Link href="/invoicing/invoices" style={{ fontSize: 13, color: "var(--gold-dark)", textDecoration: "none" }}>
          ← All invoices
        </Link>
        <PrintButton />
      </div>

      {/* Printable card */}
      <div
        className="invoice-print"
        style={{
          background: "#fff",
          color: "#0f172a",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: "32px 36px",
          maxWidth: 800,
          margin: "0 auto",
          boxShadow: "0 1px 3px rgba(15, 23, 42, 0.05)",
        }}
      >
        {/* Header — MTCPL identity */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 24,
            borderBottom: "2px solid #c8a456",
            paddingBottom: 18,
            marginBottom: 18,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {/* Use the dark logo here — invoice prints on white paper
                and /logo-light.png is the white-on-dark version used in
                the sidebar. The dark version actually renders. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo-dark.png"
              alt="MTCPL"
              style={{ width: 64, height: 64, objectFit: "contain" }}
            />
            <div>
              <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.01em", color: "#1e293b" }}>
                MTCPL
              </div>
              <div style={{ fontSize: 11, color: "#475569", marginTop: 2, lineHeight: 1.5 }}>
                Marble &amp; Stone Solutions
                <br />
                GSTIN: 08AAACS9999A1ZP &nbsp;·&nbsp; +91 99999 99999
              </div>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 800,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                color: "#92400e",
              }}
            >
              Tax Invoice
            </div>
            <div
              style={{
                fontSize: 18,
                fontFamily: "ui-monospace, monospace",
                fontWeight: 700,
                marginTop: 4,
                color: "#0f172a",
              }}
            >
              {inv.invoice_number}
            </div>
            <div style={{ fontSize: 11, color: "#475569", marginTop: 4 }}>
              Date:{" "}
              {new Date(inv.invoice_date).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata",
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </div>
          </div>
        </div>

        {/* Bill-to block */}
        <div style={{ marginBottom: 18 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 800,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "#64748b",
              marginBottom: 4,
            }}
          >
            Bill to
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>{inv.customer_name}</div>
          {inv.customer_address && (
            <div style={{ fontSize: 12, color: "#475569", marginTop: 2, whiteSpace: "pre-wrap" }}>
              {inv.customer_address}
            </div>
          )}
          <div style={{ fontSize: 11, color: "#475569", marginTop: 4, display: "flex", gap: 12 }}>
            {inv.customer_gstin && (
              <span>
                GSTIN: <strong style={{ fontFamily: "ui-monospace, monospace" }}>{inv.customer_gstin}</strong>
              </span>
            )}
            {inv.customer_phone && <span>Phone: {inv.customer_phone}</span>}
          </div>
        </div>

        {/* Items table */}
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 12,
            marginBottom: 14,
          }}
        >
          <thead>
            <tr style={{ background: "#f8fafc", borderTop: "1px solid #e2e8f0", borderBottom: "1px solid #e2e8f0" }}>
              <th style={{ ...pth, width: 32 }}>#</th>
              <th style={pth}>Description</th>
              <th style={{ ...pth, textAlign: "right", width: 80 }}>Qty</th>
              <th style={{ ...pth, textAlign: "right", width: 110 }}>Rate (₹)</th>
              <th style={{ ...pth, textAlign: "right", width: 120 }}>Amount (₹)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((it, i) => (
              <tr key={it.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                <td style={{ ...ptd, color: "#64748b", textAlign: "center" }}>{i + 1}</td>
                <td style={{ ...ptd, color: "#0f172a" }}>{it.description}</td>
                <td style={{ ...ptd, textAlign: "right", fontFamily: "ui-monospace, monospace" }}>
                  {Number(it.quantity).toLocaleString("en-IN", { maximumFractionDigits: 3 })}
                </td>
                <td style={{ ...ptd, textAlign: "right", fontFamily: "ui-monospace, monospace" }}>
                  {Number(it.rate).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </td>
                <td
                  style={{
                    ...ptd,
                    textAlign: "right",
                    fontFamily: "ui-monospace, monospace",
                    fontWeight: 600,
                  }}
                >
                  {Number(it.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <div style={{ minWidth: 280, fontSize: 13, fontFamily: "ui-monospace, monospace" }}>
            <TotalRow label="Subtotal" value={inv.subtotal} />
            <TotalRow label={`GST @ ${inv.gst_percent}%`} value={inv.amount_gst} />
            <div style={{ borderTop: "1.5px solid #1e293b", marginTop: 8, paddingTop: 8 }}>
              <TotalRow label="Total payable" value={inv.total} bold />
            </div>
          </div>
        </div>

        {inv.notes && (
          <div
            style={{
              marginTop: 24,
              padding: "10px 14px",
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              borderRadius: 8,
              fontSize: 12,
              color: "#475569",
              whiteSpace: "pre-wrap",
            }}
          >
            <strong style={{ display: "block", marginBottom: 4, color: "#0f172a" }}>Notes</strong>
            {inv.notes}
          </div>
        )}

        <div
          style={{
            marginTop: 28,
            paddingTop: 16,
            borderTop: "1px solid #e2e8f0",
            display: "flex",
            justifyContent: "space-between",
            fontSize: 10,
            color: "#94a3b8",
          }}
        >
          <span>This is a computer-generated invoice. No signature required.</span>
          <span>Issued via MTCPL Cloud</span>
        </div>
      </div>

      {/* Print-only CSS — hide app chrome when printing. The actual
          mobile-nav class is `.mobile-bottom-nav` (not `.mobile-nav`),
          which is why the previous rule missed it and Daksh saw the
          nav-bar items at the bottom of the print preview. We also
          knock out any leftover MTCPL gradient body background and
          force the invoice card to fill the page edge-to-edge. */}
      <style>{`
        @media print {
          html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
          .sidebar,
          .topbar,
          .mobile-bottom-nav,
          .mobile-nav,
          nav.mobile-bottom-nav,
          .app-shell > aside,
          .print-hide { display: none !important; }
          .app-shell, .page-card, .main-shell, .page-content {
            display: block !important;
            padding: 0 !important;
            margin: 0 !important;
            box-shadow: none !important;
            border: 0 !important;
            background: #fff !important;
            grid-template-columns: 1fr !important;
          }
          .invoice-print {
            box-shadow: none !important;
            border: 0 !important;
            max-width: 100% !important;
            margin: 0 !important;
            padding: 24px !important;
          }
        }
        @page { margin: 14mm; }
      `}</style>
    </section>
  );
}

const pth: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 10px",
  fontSize: 10,
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "#64748b",
};

const ptd: React.CSSProperties = {
  padding: "8px 10px",
  verticalAlign: "top",
};

function TotalRow({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
        padding: "3px 0",
        fontWeight: bold ? 800 : 500,
        fontSize: bold ? 15 : 13,
        color: bold ? "#0f172a" : "#475569",
      }}
    >
      <span>{label}</span>
      <span>
        ₹ {Number(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
    </div>
  );
}

// PrintButton lives in ./print-button.tsx as a client component
// (window.print needs to run in the browser).
