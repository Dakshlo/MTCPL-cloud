import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { createInvoiceAction } from "../actions";
import { InvoiceForm } from "./invoice-form";

type SearchParams = Promise<{ error?: string }>;

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireAuth(["developer", "owner"]);
  const sp = await searchParams;

  return (
    <section className="page-card">
      <div
        className="page-header"
        style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}
      >
        <div>
          <h1>New invoice</h1>
          <p className="muted">
            Fill in the customer details and line items. The invoice number is
            auto-generated. On submit you'll land on the printable preview.
          </p>
        </div>
        <Link
          href="/invoicing"
          style={{
            textDecoration: "none",
            fontSize: 12,
            padding: "8px 14px",
            background: "var(--bg)",
            color: "var(--text)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            fontWeight: 600,
          }}
        >
          ← All invoices
        </Link>
      </div>

      {sp.error && (
        <div
          role="alert"
          style={{
            marginTop: 14,
            padding: "10px 14px",
            background: "rgba(220, 38, 38, 0.08)",
            border: "1px solid #dc2626",
            borderRadius: 8,
            color: "#7f1d1d",
            fontSize: 13,
          }}
        >
          <strong>Could not create:</strong> {sp.error}
        </div>
      )}

      <InvoiceForm action={createInvoiceAction} />
    </section>
  );
}
