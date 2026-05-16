/**
 * Mig 058 — Challan detail page.
 *
 * Article-style printable card (mirrors the accounts voucher view
 * pattern). On-screen has a "Convert to invoice →" CTA + Cancel
 * button in the chrome (hidden in print via `.print-hide`).
 */

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canUseInvoicing } from "@/lib/invoicing-permissions";
import {
  ACCOUNTS_TOKENS,
  BUTTON_STYLES,
} from "../../../accounts/_ui/components";
import { ChallanStatusPill } from "../../_ui/challan-status-pill";
import { cancelChallanAction } from "../../actions";
import { CancelChallanButton } from "./cancel-button";

type Params = Promise<{ id: string }>;

export default async function ChallanDetailPage({ params }: { params: Params }) {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) redirect("/");

  const { id } = await params;
  const supabase = createAdminSupabaseClient();

  const [{ data: challan }, { data: items }] = await Promise.all([
    supabase
      .from("challans")
      .select(
        "id, challan_number, challan_date, invoice_party_id, notes, cancelled_at, cancel_reason, converted_invoice_id, converted_at, created_at, invoice_parties(name, gstin, address, phone), invoices:converted_invoice_id(invoice_number)",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("challan_items")
      .select("id, description, quantity, unit, position")
      .eq("challan_id", id)
      .order("position"),
  ]);

  if (!challan) notFound();
  const c = challan as {
    id: string;
    challan_number: string;
    challan_date: string;
    invoice_party_id: string;
    notes: string | null;
    cancelled_at: string | null;
    cancel_reason: string | null;
    converted_invoice_id: string | null;
    converted_at: string | null;
    created_at: string;
    invoice_parties:
      | { name: string; gstin: string | null; address: string | null; phone: string | null }
      | Array<{ name: string; gstin: string | null; address: string | null; phone: string | null }>
      | null;
    invoices: { invoice_number: string } | { invoice_number: string }[] | null;
  };
  const party = c.invoice_parties
    ? Array.isArray(c.invoice_parties)
      ? c.invoice_parties[0]
      : c.invoice_parties
    : null;
  const linkedInvoice = c.invoices
    ? Array.isArray(c.invoices)
      ? c.invoices[0]
      : c.invoices
    : null;

  const rows = (items ?? []) as Array<{
    id: string;
    description: string;
    quantity: number;
    unit: string | null;
    position: number;
  }>;

  const status: "open" | "converted" | "cancelled" = c.cancelled_at
    ? "cancelled"
    : c.converted_invoice_id
    ? "converted"
    : "open";

  return (
    <section className="page-card">
      {/* On-screen chrome — hidden when printing */}
      <div
        className="print-hide"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 14,
          flexWrap: "wrap",
        }}
      >
        <Link
          href="/invoicing/challans"
          style={{ fontSize: 13, color: "var(--muted)", textDecoration: "none" }}
        >
          ← All challans
        </Link>
        <span style={{ marginLeft: 6 }}>
          <ChallanStatusPill status={status} />
        </span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {status === "open" && (
            <>
              <Link
                href={`/invoicing/challans/${c.id}/convert`}
                style={BUTTON_STYLES.primary}
              >
                Convert to invoice →
              </Link>
              <CancelChallanButton challanId={c.id} cancelAction={cancelChallanAction} />
            </>
          )}
          {status === "converted" && linkedInvoice && (
            <Link
              href={`/invoicing/invoices?party=${c.invoice_party_id}`}
              style={BUTTON_STYLES.secondary}
            >
              View invoice {linkedInvoice.invoice_number} →
            </Link>
          )}
        </span>
      </div>

      {/* Printable card */}
      <div
        className="challan-print"
        style={{
          background: "#fff",
          color: "#0f172a",
          border: `1px solid ${ACCOUNTS_TOKENS.border}`,
          borderRadius: 12,
          padding: "28px 32px",
          maxWidth: 800,
          margin: "0 auto",
          boxShadow: ACCOUNTS_TOKENS.shadow,
        }}
      >
        {/* Title strip */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            borderBottom: `2px solid ${ACCOUNTS_TOKENS.accent}`,
            paddingBottom: 14,
            marginBottom: 18,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 800,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                color: ACCOUNTS_TOKENS.accent,
              }}
            >
              Delivery Challan
            </div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 800,
                marginTop: 4,
                fontFamily: "ui-monospace, monospace",
                color: "#0f172a",
              }}
            >
              {c.challan_number}
            </div>
          </div>
          <div style={{ textAlign: "right", fontSize: 12, color: "#475569" }}>
            <div>
              Date: <strong style={{ color: "#0f172a" }}>{c.challan_date}</strong>
            </div>
            {c.converted_at && (
              <div style={{ marginTop: 4, fontSize: 11, color: ACCOUNTS_TOKENS.success }}>
                Converted to invoice on {new Date(c.converted_at).toISOString().slice(0, 10)}
              </div>
            )}
            {c.cancelled_at && (
              <div style={{ marginTop: 4, fontSize: 11, color: ACCOUNTS_TOKENS.danger }}>
                Cancelled on {new Date(c.cancelled_at).toISOString().slice(0, 10)}
                {c.cancel_reason ? ` · ${c.cancel_reason}` : ""}
              </div>
            )}
          </div>
        </div>

        {/* Party block */}
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
            Delivered to
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>
            {party?.name ?? "—"}
          </div>
          {party?.address && (
            <div style={{ fontSize: 12, color: "#475569", marginTop: 2, whiteSpace: "pre-wrap" }}>
              {party.address}
            </div>
          )}
          <div style={{ fontSize: 11, color: "#475569", marginTop: 4, display: "flex", gap: 12 }}>
            {party?.gstin && (
              <span>
                GSTIN <strong style={{ fontFamily: "ui-monospace, monospace" }}>{party.gstin}</strong>
              </span>
            )}
            {party?.phone && <span>Phone {party.phone}</span>}
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
            <tr
              style={{
                background: "#f8fafc",
                borderTop: "1px solid #e2e8f0",
                borderBottom: "1px solid #e2e8f0",
              }}
            >
              <th style={{ ...pth, width: 32 }}>#</th>
              <th style={pth}>Description</th>
              <th style={{ ...pth, textAlign: "right", width: 100 }}>Qty</th>
              <th style={{ ...pth, textAlign: "center", width: 70 }}>Unit</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((it, i) => (
              <tr key={it.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                <td style={{ ...ptd, color: "#64748b", textAlign: "center" }}>{i + 1}</td>
                <td style={{ ...ptd, color: "#0f172a" }}>{it.description}</td>
                <td
                  style={{
                    ...ptd,
                    textAlign: "right",
                    fontFamily: "ui-monospace, monospace",
                  }}
                >
                  {Number(it.quantity).toLocaleString("en-IN", { maximumFractionDigits: 3 })}
                </td>
                <td style={{ ...ptd, textAlign: "center", fontWeight: 600 }}>
                  {it.unit ? it.unit.toUpperCase() : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {c.notes && (
          <div
            style={{
              marginTop: 18,
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
            {c.notes}
          </div>
        )}

        <div
          style={{
            marginTop: 24,
            paddingTop: 14,
            borderTop: "1px solid #e2e8f0",
            fontSize: 10,
            color: "#94a3b8",
            textAlign: "center",
          }}
        >
          This is a computer-generated delivery challan · MTCPL Cloud
        </div>
      </div>

      <style>{`
        @media print {
          .print-hide { display: none !important; }
          body, .page-card { background: #fff !important; }
          .challan-print { box-shadow: none !important; border: 0 !important; max-width: 100% !important; margin: 0 !important; padding: 16mm 14mm !important; }
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
