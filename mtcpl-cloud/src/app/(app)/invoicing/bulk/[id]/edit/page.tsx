/**
 * Edit a bulk (work-order) invoice (Daksh Jul 2026) — line items / GST / notes.
 * The INV number is LOCKED; cancelling (Invoices page) is the only way to free it.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canUseInvoicing } from "@/lib/invoicing-permissions";
import { invoiceCodeFromDoc, challanCode } from "@/lib/doc-code";
import type { GstMode } from "@/lib/challan-pricing";
import { groupBulkItems } from "@/lib/bulk-items";
import { BulkEditForm } from "./bulk-edit-form";

type Params = Promise<{ id: string }>;

export default async function BulkInvoiceEditPage({ params }: { params: Params }) {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) redirect("/");
  const { id } = await params;
  const admin = createAdminSupabaseClient();

  const { data: bi } = await admin.from("bulk_invoices").select("*").eq("id", id).maybeSingle();
  if (!bi) notFound();
  const b = bi as any;
  if (b.cancelled_at) redirect(`/invoicing/invoices?toast=${encodeURIComponent("Invoice is cancelled")}`);

  const { data: itemRows } = await admin.from("bulk_invoice_items").select("*").eq("bulk_invoice_id", id).order("position");
  const gstMode = (b.gst_mode === "igst" || b.gst_mode === "cgst_sgst" ? b.gst_mode : null) as GstMode;
  // Mig 199 — a legacy (pre-per-table-GST) invoice prefills every table with the
  // invoice-level slab, so saving unchanged keeps the same numbers.
  const legacyPct = gstMode === "igst" ? Number(b.igst_percent) || 0 : gstMode === "cgst_sgst" ? (Number(b.cgst_percent) || 0) + (Number(b.sgst_percent) || 0) : 0;
  // Rebuild the tables (mig 179): group by section → each becomes an editable
  // table with its head + GST slab. Pre-mig rows fold into one headless table.
  const initSections = groupBulkItems((itemRows ?? []) as any[]).map((g) => ({
    head: g.head ?? "",
    gst: g.gst != null ? String(g.gst) : legacyPct ? String(legacyPct) : "18",
    lines: g.rows.map((it: any) => ({
      particulars: it.particulars ?? "", hsn: it.hsn ?? "", unit: it.unit ?? "",
      quantity: Number(it.quantity) || 0, rate: Number(it.rate) || 0,
    })),
  }));
  if (initSections.length === 0) initSections.push({ head: "", gst: legacyPct ? String(legacyPct) : "18", lines: [{ particulars: "", hsn: "", unit: "", quantity: 0, rate: 0 }] });

  const invoiceCode = (b.invoice_no_override?.trim?.() || invoiceCodeFromDoc(b.inv_fy, b.inv_seq) || `INV-${id.slice(0, 6).toUpperCase()}`);

  // Mig 184 slice 3 — challans this invoice can (de)select. Pool = sent-to-bulk
  // challans for this temple not on ANOTHER invoice; plus this invoice's own.
  const { data: allLinks } = await admin.from("bulk_invoice_challans").select("bulk_invoice_id, challan_id");
  const links = (allLinks ?? []) as Array<{ bulk_invoice_id: string; challan_id: string }>;
  const linkedIds = links.filter((l) => l.bulk_invoice_id === id).map((l) => l.challan_id);
  const otherLinked = new Set(links.filter((l) => l.bulk_invoice_id !== id).map((l) => l.challan_id));
  const pick = new Map<string, { id: string; code: string; date: string }>();
  if (b.temple) {
    const { data } = await admin.from("challans")
      .select("id, challan_number, doc_fy, doc_seq, challan_date")
      .eq("temple", b.temple).not("sent_to_bulk_at", "is", null).is("cancelled_at", null).is("converted_invoice_id", null);
    for (const r of (data ?? []) as any[]) {
      if (otherLinked.has(r.id)) continue;
      pick.set(r.id, { id: r.id, code: challanCode(r.doc_fy, r.doc_seq) ?? r.challan_number ?? "—", date: r.challan_date });
    }
  }
  if (linkedIds.length) {
    const { data } = await admin.from("challans").select("id, challan_number, doc_fy, doc_seq, challan_date").in("id", linkedIds);
    for (const r of (data ?? []) as any[]) pick.set(r.id, { id: r.id, code: challanCode(r.doc_fy, r.doc_seq) ?? r.challan_number ?? "—", date: r.challan_date });
  }
  const pickable = [...pick.values()].sort((a, z) => (a.date < z.date ? 1 : a.date > z.date ? -1 : 0));

  return (
    <section className="page-card">
      <div className="page-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1>✎ Edit work order invoice</h1>
          <p className="muted">🏛 {b.temple} · everything is editable except the invoice number.</p>
        </div>
        <Link href="/invoicing/invoices" style={{ textDecoration: "none", fontSize: 13, fontWeight: 700, padding: "9px 15px", borderRadius: 10, border: "1.5px solid var(--border)", background: "var(--bg)", color: "var(--text)", whiteSpace: "nowrap" }}>← Invoices</Link>
      </div>
      <div style={{ marginTop: 14 }}>
        <BulkEditForm
          id={id}
          invoiceCode={invoiceCode}
          initSections={initSections}
          initGst={{ mode: gstMode, igst: Number(b.igst_percent) || 18, cgst: Number(b.cgst_percent) || 9, sgst: Number(b.sgst_percent) || 9 }}
          initDiscount={{ mode: b.discount_mode === "amount" || b.discount_mode === "percent" ? b.discount_mode : null, value: Number(b.discount_value) || 0 }}
          initNotes={b.notes ?? ""}
          challans={pickable}
          linkedIds={linkedIds}
        />
      </div>
    </section>
  );
}
