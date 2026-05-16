import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canUseInvoicing } from "@/lib/invoicing-permissions";
import { createInvoiceAction } from "../../actions";
import { InvoiceForm, type PartyOption } from "./invoice-form";

type SearchParams = Promise<{ error?: string; party?: string; challan?: string }>;

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) redirect("/");
  const sp = await searchParams;

  // Mig 058 — load the party list so the form can show a picker.
  // Pre-selection via ?party=<id> (e.g. from party detail page).
  const supabase = createAdminSupabaseClient();
  const { data: partiesRaw } = await supabase
    .from("invoice_parties")
    .select("id, name, gstin, address, phone")
    .eq("is_active", true)
    .order("name");
  const parties: PartyOption[] = ((partiesRaw ?? []) as Array<{
    id: string;
    name: string;
    gstin: string | null;
    address: string | null;
    phone: string | null;
  }>).map((p) => ({
    id: p.id,
    name: p.name,
    gstin: p.gstin,
    address: p.address,
    phone: p.phone,
  }));

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
          href="/invoicing/invoices"
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

      <InvoiceForm
        action={createInvoiceAction}
        parties={parties}
        initialPartyId={sp.party ?? null}
        initialChallanId={sp.challan ?? null}
      />
    </section>
  );
}
