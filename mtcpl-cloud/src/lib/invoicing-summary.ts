// Invoiced-analytics aggregation for the Invoicing dashboard (Daksh, Jul 2026).
// Gathers EVERY issued invoice across the four sources — temple purchase (priced
// + owner-approved challans), work-order (bulk_invoices), running bills (custom-
// billed challans) and Other Sales (converted other_challans) — each with its
// party, date, amount (with GST), taxed portion and CFT/SFT/NOS breakdown.

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { computeInvoiceTotals, type GstMode } from "@/lib/challan-pricing";
import { invoiceCodeFromDoc } from "@/lib/doc-code";

type Admin = ReturnType<typeof createAdminSupabaseClient>;

export type InvoiceSource = "purchase" | "work_order" | "running" | "other";
export type InvoiceSummaryRow = {
  id: string;
  code: string;
  party: string;
  source: InvoiceSource;
  date: string;
  amount: number;
  taxed: number;
  cft: number;
  sft: number;
  nos: number;
  href: string;
};

const gstOf = (r: { gst_mode?: string | null; igst_percent?: number | null; cgst_percent?: number | null; sgst_percent?: number | null }) => ({
  mode: (r.gst_mode === "igst" || r.gst_mode === "cgst_sgst" ? r.gst_mode : null) as GstMode,
  igst: Number(r.igst_percent) || 0,
  cgst: Number(r.cgst_percent) || 0,
  sgst: Number(r.sgst_percent) || 0,
});

/** Bucket a free-text unit into cft / sft / nos (anything unrecognised → nos). */
function bucket(unit: string | null | undefined): "cft" | "sft" | "nos" {
  const u = (unit ?? "").toLowerCase();
  if (u.includes("cft") || u.includes("cubic")) return "cft";
  if (u.includes("sft") || u.includes("sq")) return "sft";
  return "nos";
}

async function pageAll<T>(make: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let off = 0; off < 100_000; off += 1000) {
    const { data, error } = await make(off, off + 999);
    if (error) break;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

/** Sum item amounts + unit breakdown for a set of parent ids (batched). */
async function itemsBy(
  admin: Admin, table: string, parentCol: string, ids: string[],
  cols: string, unitCol: "unit" | "measure_unit", qtyCol: "quantity" | "measure_qty",
): Promise<Map<string, { amounts: number[]; cft: number; sft: number; nos: number }>> {
  const m = new Map<string, { amounts: number[]; cft: number; sft: number; nos: number }>();
  for (let i = 0; i < ids.length; i += 300) {
    const chunk = ids.slice(i, i + 300);
    if (!chunk.length) break;
    const { data } = await admin.from(table).select(cols).in(parentCol, chunk);
    for (const it of (data ?? []) as unknown as Array<Record<string, unknown>>) {
      const pid = String(it[parentCol]);
      const e = m.get(pid) ?? { amounts: [], cft: 0, sft: 0, nos: 0 };
      const qty = Number(it[qtyCol]) || 0;
      const rate = Number(it.rate) || 0;
      const amt = it.amount != null ? Number(it.amount) : qty * rate;
      e.amounts.push(amt);
      e[bucket(it[unitCol] as string | null)] += qty;
      m.set(pid, e);
    }
  }
  return m;
}

export async function gatherInvoiced(admin: Admin): Promise<InvoiceSummaryRow[]> {
  const out: InvoiceSummaryRow[] = [];

  // 1 — Temple PURCHASE invoices: priced + owner-approved challans (not running,
  // not archived/cancelled/legacy-converted). Items are challan_items (cft/sft).
  {
    type Row = { id: string; challan_number: string; doc_fy: string | null; doc_seq: number | null; challan_date: string; temple: string | null; inv_fy: string | null; inv_seq: number | null; invoice_no_override: string | null; custom_billed_at: string | null; gst_mode: string | null; igst_percent: number | null; cgst_percent: number | null; sgst_percent: number | null };
    const rows = await pageAll<Row>((from, to) => admin.from("challans")
      .select("id, challan_number, doc_fy, doc_seq, challan_date, temple, inv_fy, inv_seq, invoice_no_override, custom_billed_at, gst_mode, igst_percent, cgst_percent, sgst_percent")
      .not("priced_at", "is", null).not("owner_approved_at", "is", null)
      .is("cancelled_at", null).is("converted_invoice_id", null).is("archived_at", null)
      .order("challan_date", { ascending: false }).range(from, to));
    const purchase = rows.filter((r) => !r.custom_billed_at); // running bills excluded here
    const items = await itemsBy(admin, "challan_items", "challan_id", purchase.map((r) => r.id), "challan_id, amount, rate, quantity, measure_qty, measure_unit", "measure_unit", "measure_qty");
    for (const r of purchase) {
      const it = items.get(r.id) ?? { amounts: [], cft: 0, sft: 0, nos: 0 };
      const t = computeInvoiceTotals(it.amounts, gstOf(r));
      out.push({ id: r.id, code: (r.invoice_no_override?.trim() || invoiceCodeFromDoc(r.inv_fy, r.inv_seq) || invoiceCodeFromDoc(r.doc_fy, r.doc_seq) || r.challan_number), party: r.temple ?? "—", source: "purchase", date: r.challan_date, amount: t.grand, taxed: t.grand - t.subtotal, cft: it.cft, sft: it.sft, nos: it.nos, href: `/invoicing/challan/${r.id}/print` });
    }
  }

  // 2 — WORK ORDER invoices: bulk_invoices (owner-approved). Items carry a text unit.
  {
    type Row = { id: string; temple: string | null; invoice_date: string; inv_fy: string | null; inv_seq: number | null; invoice_no_override: string | null; gst_mode: string | null; igst_percent: number | null; cgst_percent: number | null; sgst_percent: number | null };
    const { data } = await admin.from("bulk_invoices")
      .select("id, temple, invoice_date, inv_fy, inv_seq, invoice_no_override, gst_mode, igst_percent, cgst_percent, sgst_percent")
      .not("owner_approved_at", "is", null).is("cancelled_at", null).order("invoice_date", { ascending: false });
    const rows = (data ?? []) as Row[];
    const items = await itemsBy(admin, "bulk_invoice_items", "bulk_invoice_id", rows.map((r) => r.id), "bulk_invoice_id, amount, rate, quantity, unit", "unit", "quantity");
    for (const r of rows) {
      const it = items.get(r.id) ?? { amounts: [], cft: 0, sft: 0, nos: 0 };
      const t = computeInvoiceTotals(it.amounts, gstOf(r));
      out.push({ id: r.id, code: (r.invoice_no_override?.trim() || invoiceCodeFromDoc(r.inv_fy, r.inv_seq) || `INV-${r.id.slice(0, 6).toUpperCase()}`), party: r.temple ?? "—", source: "work_order", date: r.invoice_date, amount: t.grand, taxed: t.grand - t.subtotal, cft: it.cft, sft: it.sft, nos: it.nos, href: `/invoicing/bulk/${r.id}/print` });
    }
  }

  // 3 — RUNNING bills: custom-billed + invoiced challans. Items = challan_custom_items.
  {
    type Row = { id: string; challan_number: string; doc_fy: string | null; doc_seq: number | null; challan_date: string; temple: string | null; inv_fy: string | null; inv_seq: number | null; gst_mode: string | null; igst_percent: number | null; cgst_percent: number | null; sgst_percent: number | null };
    const rows = await pageAll<Row>((from, to) => admin.from("challans")
      .select("id, challan_number, doc_fy, doc_seq, challan_date, temple, inv_fy, inv_seq, gst_mode, igst_percent, cgst_percent, sgst_percent")
      .not("custom_billed_at", "is", null).not("inv_seq", "is", null).is("cancelled_at", null).is("archived_at", null)
      .order("challan_date", { ascending: false }).range(from, to));
    const items = await itemsBy(admin, "challan_custom_items", "challan_id", rows.map((r) => r.id), "challan_id, amount, rate, quantity, unit", "unit", "quantity");
    for (const r of rows) {
      const it = items.get(r.id) ?? { amounts: [], cft: 0, sft: 0, nos: 0 };
      const t = computeInvoiceTotals(it.amounts, gstOf(r));
      out.push({ id: r.id, code: (invoiceCodeFromDoc(r.inv_fy, r.inv_seq) || r.challan_number), party: r.temple ?? "—", source: "running", date: r.challan_date, amount: t.grand, taxed: t.grand - t.subtotal, cft: it.cft, sft: it.sft, nos: it.nos, href: `/invoicing/challan/${r.id}/custom/print` });
    }
  }

  // 4 — OTHER SALES: converted other_challans. Party = the client.
  {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await admin.from("other_challans")
      .select("id, challan_date, inv_fy, inv_seq, gst_mode, igst_percent, cgst_percent, sgst_percent, invoice_parties(name)")
      .not("converted_at", "is", null).is("cancelled_at", null).order("converted_at", { ascending: false });
    if (!error) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = (data ?? []) as any[];
      const items = await itemsBy(admin, "other_challan_items", "other_challan_id", rows.map((r) => r.id), "other_challan_id, amount, rate, quantity, unit", "unit", "quantity");
      for (const r of rows) {
        const it = items.get(r.id) ?? { amounts: [], cft: 0, sft: 0, nos: 0 };
        const t = computeInvoiceTotals(it.amounts, gstOf(r));
        const party = Array.isArray(r.invoice_parties) ? r.invoice_parties[0]?.name : r.invoice_parties?.name;
        out.push({ id: r.id, code: (invoiceCodeFromDoc(r.inv_fy, r.inv_seq) || `INV-${String(r.id).slice(0, 6).toUpperCase()}`), party: party ?? "—", source: "other", date: r.challan_date, amount: t.grand, taxed: t.grand - t.subtotal, cft: it.cft, sft: it.sft, nos: it.nos, href: `/invoicing/other/${r.id}/print` });
      }
    }
  }

  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}
