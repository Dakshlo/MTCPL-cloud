/**
 * Mig 058 — Convert challan → invoice.
 *
 * Loads the challan + items + party, hands off to the client
 * convert-form. Refuses if challan is cancelled / already
 * converted.
 */

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canUseInvoicing } from "@/lib/invoicing-permissions";
import { AccountsHero } from "../../../../accounts/_ui/components";
import { convertChallanToInvoiceAction } from "../../../actions";
import { ConvertChallanForm, type ChallanItemPrefill } from "./convert-form";

type Params = Promise<{ id: string }>;

export default async function ConvertChallanPage({ params }: { params: Params }) {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) redirect("/");

  const { id } = await params;
  const supabase = createAdminSupabaseClient();

  const [{ data: challan }, { data: itemsRaw }] = await Promise.all([
    supabase
      .from("challans")
      .select(
        "id, challan_number, challan_date, invoice_party_id, notes, cancelled_at, converted_invoice_id, invoice_parties(name)",
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
    converted_invoice_id: string | null;
    invoice_parties: { name: string } | { name: string }[] | null;
  };

  if (c.cancelled_at) {
    // Cancelled challans can't be converted — bounce back to view.
    redirect(`/invoicing/challans/${id}`);
  }
  if (c.converted_invoice_id) {
    // Already converted — bounce to the invoice.
    redirect(`/invoicing/invoices/${c.converted_invoice_id}`);
  }

  const partyName = c.invoice_parties
    ? Array.isArray(c.invoice_parties)
      ? c.invoice_parties[0]?.name ?? "—"
      : c.invoice_parties.name
    : "—";

  const items: ChallanItemPrefill[] = ((itemsRaw ?? []) as Array<{
    id: string;
    description: string;
    quantity: number;
    unit: string | null;
    position: number;
  }>).map((it) => ({
    id: it.id,
    description: it.description,
    quantity: Number(it.quantity),
    unit: it.unit,
  }));

  return (
    <section className="page-card">
      <AccountsHero
        title={
          <>
            Convert{" "}
            <span style={{ fontFamily: "ui-monospace, monospace" }}>{c.challan_number}</span>{" "}
            to invoice
          </>
        }
        description={
          <>
            Items are pre-filled from the challan. Add a rate per item + GST → submit.
            The original challan stays linked to the resulting invoice.
          </>
        }
        actions={
          <Link
            href={`/invoicing/challans/${id}`}
            style={{ fontSize: 12, color: "var(--muted)", textDecoration: "none" }}
          >
            ← Back to challan
          </Link>
        }
      />

      <div style={{ marginTop: 18 }}>
        <ConvertChallanForm
          action={convertChallanToInvoiceAction}
          challanId={c.id}
          challanNumber={c.challan_number}
          partyName={partyName}
          challanNotes={c.notes ?? ""}
          items={items}
        />
      </div>
    </section>
  );
}
