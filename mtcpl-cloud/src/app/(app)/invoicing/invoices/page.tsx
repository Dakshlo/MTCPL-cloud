import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canUseInvoicing } from "@/lib/invoicing-permissions";
import { computeGroupedGstTotals, type GstItem, type GstMode } from "@/lib/challan-pricing";
import { invoiceCode } from "@/lib/invoice-code";
import { invoiceCodeFromDoc, challanCode } from "@/lib/doc-code";
import { InvoicesView, type InvoiceRow } from "./invoices-collapsible";
import { getProfilesMap } from "@/lib/profiles";
import { fetchTempleBillNames, displayNameFor } from "@/lib/temple-names";

// Page through a query (the invoices register can exceed the 1000-row cap over a
// financial year — never silently truncate).
async function pageAll<T>(
  make: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let off = 0; off < 100_000; off += PAGE) {
    const { data, error } = await make(off, off + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

type PricedChallan = {
  id: string; challan_number: string; doc_fy: string | null; doc_seq: number | null; challan_date: string; temple: string | null; priced_at: string;
  source_dispatch_id: string | null;
  priced_by: string | null;
  invoice_no_override: string | null;
  gst_mode: string | null; igst_percent: number | null; cgst_percent: number | null; sgst_percent: number | null;
};
type LegacyInvoice = { id: string; invoice_number: string; invoice_date: string; customer_name: string; total: number };

// Mig 038 → Mig 058. The /invoicing/ landing is the dashboard; this is the
// dedicated invoices list. Daksh June 2026 — a PRICED challan IS a tax invoice
// (mig 157) but never creates an `invoices` row, so it was missing here. We now
// merge priced challans (linking to their landscape tax-invoice print) with the
// legacy converted invoices, newest first.
export default async function InvoicingListPage() {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) redirect("/");
  const supabase = createAdminSupabaseClient();

  const [legacy, priced] = await Promise.all([
    pageAll<LegacyInvoice>((from, to) =>
      supabase
        .from("invoices")
        .select("id, invoice_number, invoice_date, customer_name, total, created_at")
        .order("created_at", { ascending: false })
        .range(from, to),
    ),
    pageAll<PricedChallan>((from, to) =>
      supabase
        .from("challans")
        .select("id, challan_number, doc_fy, doc_seq, challan_date, temple, priced_at, priced_by, source_dispatch_id, invoice_no_override, gst_mode, igst_percent, cgst_percent, sgst_percent")
        .not("priced_at", "is", null)
        // Mig 167 — only OWNER-APPROVED priced challans are final invoices.
        // A priced-but-pending (or rejected) challan stays in the Approval
        // queue and must NOT show on the Invoices list.
        .not("owner_approved_at", "is", null)
        .is("cancelled_at", null)
        .is("converted_invoice_id", null)
        .order("priced_at", { ascending: false })
        .range(from, to),
    ),
  ]);

  // Compute each priced challan's grand total from its items + GST snapshot.
  // Mig 199 — items carry a per-line slab (section_gst); pre-mig items fall back
  // to the invoice-level % (the select is retried without the column pre-mig).
  const totalByChallan = new Map<string, number>();
  const challanIds = priced.map((c) => c.id);
  for (let i = 0; i < challanIds.length; i += 300) {
    const chunk = challanIds.slice(i, i + 300);
    if (chunk.length === 0) break;
    let { data: items } = await supabase
      .from("challan_items")
      .select("challan_id, amount, rate, measure_qty, quantity, section_gst")
      .in("challan_id", chunk);
    if (items == null) ({ data: items } = (await supabase.from("challan_items").select("challan_id, amount, rate, measure_qty, quantity").in("challan_id", chunk)) as unknown as { data: typeof items });
    const byCh = new Map<string, GstItem[]>();
    for (const it of (items ?? []) as Array<{ challan_id: string; amount: number | null; rate: number | null; measure_qty: number | null; quantity: number | null; section_gst?: number | null }>) {
      const meas = it.measure_qty != null && Number(it.measure_qty) > 0 ? Number(it.measure_qty) : Number(it.quantity) || 0;
      const amt = it.amount != null ? Number(it.amount) : (Number(it.rate) || 0) * meas;
      const arr = byCh.get(it.challan_id) ?? []; arr.push({ amount: amt, gstPercent: it.section_gst != null ? Number(it.section_gst) : null }); byCh.set(it.challan_id, arr);
    }
    for (const c of priced) {
      if (!chunk.includes(c.id)) continue;
      const t = computeGroupedGstTotals(byCh.get(c.id) ?? [], {
        mode: (c.gst_mode === "igst" || c.gst_mode === "cgst_sgst" ? c.gst_mode : null) as GstMode,
        igst: Number(c.igst_percent) || 0, cgst: Number(c.cgst_percent) || 0, sgst: Number(c.sgst_percent) || 0,
      });
      totalByChallan.set(c.id, t.grand);
    }
  }

  // Mig 172 — independent invoice number (inv_fy/inv_seq), best-effort batch fetch.
  const invByChallan = new Map<string, { fy: string | null; seq: number | null }>();
  for (let i = 0; i < challanIds.length; i += 300) {
    const chunk = challanIds.slice(i, i + 300);
    if (chunk.length === 0) break;
    const { data, error } = await supabase.from("challans").select("id, inv_fy, inv_seq").in("id", chunk);
    if (error) break;
    for (const r of (data ?? []) as Array<{ id: string; inv_fy: string | null; inv_seq: number | null }>) invByChallan.set(r.id, { fy: r.inv_fy, seq: r.inv_seq });
  }

  // Mig 173 — approved BULK invoices (best-effort).
  type BulkRow = { id: string; temple: string; invoice_date: string; inv_fy: string | null; inv_seq: number | null; invoice_no_override: string | null; created_by: string | null; gst_mode: string | null; igst_percent: number | null; cgst_percent: number | null; sgst_percent: number | null };
  let bulkApproved: BulkRow[] = [];
  {
    const { data, error } = await supabase.from("bulk_invoices")
      .select("id, temple, invoice_date, inv_fy, inv_seq, invoice_no_override, created_by, gst_mode, igst_percent, cgst_percent, sgst_percent")
      .not("owner_approved_at", "is", null).is("cancelled_at", null)
      .order("invoice_date", { ascending: false });
    if (!error) bulkApproved = (data ?? []) as BulkRow[];
  }
  const bulkTotal = new Map<string, number>();
  if (bulkApproved.length) {
    const ids = bulkApproved.map((b) => b.id);
    for (let i = 0; i < ids.length; i += 300) {
      const chunk = ids.slice(i, i + 300); if (!chunk.length) break;
      let { data: its } = await supabase.from("bulk_invoice_items").select("bulk_invoice_id, amount, quantity, rate, section_gst").in("bulk_invoice_id", chunk);
      if (its == null) ({ data: its } = (await supabase.from("bulk_invoice_items").select("bulk_invoice_id, amount, quantity, rate").in("bulk_invoice_id", chunk)) as unknown as { data: typeof its });
      const byB = new Map<string, GstItem[]>();
      for (const it of (its ?? []) as Array<{ bulk_invoice_id: string; amount: number | null; quantity: number | null; rate: number | null; section_gst?: number | null }>) {
        const amt = it.amount != null ? Number(it.amount) : (Number(it.quantity) || 0) * (Number(it.rate) || 0);
        const a = byB.get(it.bulk_invoice_id) ?? []; a.push({ amount: amt, gstPercent: it.section_gst != null ? Number(it.section_gst) : null }); byB.set(it.bulk_invoice_id, a);
      }
      for (const b of bulkApproved) {
        if (!chunk.includes(b.id)) continue;
        const t = computeGroupedGstTotals(byB.get(b.id) ?? [], { mode: (b.gst_mode === "igst" || b.gst_mode === "cgst_sgst" ? b.gst_mode : null) as GstMode, igst: Number(b.igst_percent) || 0, cgst: Number(b.cgst_percent) || 0, sgst: Number(b.sgst_percent) || 0 });
        bulkTotal.set(b.id, t.grand);
      }
    }
  }

  // Linked delivery-challan codes per BULK invoice (bulk_invoice_challans →
  // challans) — a work-order invoice bundles several, shown as a dropdown on the
  // card. Best-effort so a pre-mig deploy just shows none.
  const bulkChallanCodes = new Map<string, string[]>();
  if (bulkApproved.length) {
    const bids = bulkApproved.map((b) => b.id);
    const links: Array<{ bulk_invoice_id: string; challan_id: string }> = [];
    for (let i = 0; i < bids.length; i += 300) {
      const chunk = bids.slice(i, i + 300); if (!chunk.length) break;
      const { data } = await supabase.from("bulk_invoice_challans").select("bulk_invoice_id, challan_id").in("bulk_invoice_id", chunk);
      for (const r of (data ?? []) as Array<{ bulk_invoice_id: string; challan_id: string }>) links.push(r);
    }
    const codeById = new Map<string, string>();
    const chIds = [...new Set(links.map((l) => l.challan_id))];
    for (let i = 0; i < chIds.length; i += 300) {
      const chunk = chIds.slice(i, i + 300); if (!chunk.length) break;
      const { data } = await supabase.from("challans").select("id, doc_fy, doc_seq, challan_number").in("id", chunk);
      for (const r of (data ?? []) as Array<{ id: string; doc_fy: string | null; doc_seq: number | null; challan_number: string | null }>) {
        codeById.set(r.id, challanCode(r.doc_fy, r.doc_seq) ?? r.challan_number ?? "—");
      }
    }
    for (const l of links) {
      const arr = bulkChallanCodes.get(l.bulk_invoice_id) ?? [];
      const code = codeById.get(l.challan_id); if (code) arr.push(code);
      bulkChallanCodes.set(l.bulk_invoice_id, arr);
    }
    for (const [k, v] of bulkChallanCodes) bulkChallanCodes.set(k, v.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })));
  }

  // Who generated each invoice — resolve creator ids to names for the Recent card.
  const profNames = await getProfilesMap();
  const nameOf = (id: string | null | undefined) => (id ? profNames[id] ?? null : null);
  // Accountants know a temple by its BILLING name — use it as the client name.
  const billNames = await fetchTempleBillNames(supabase);

  // Mig 184 — invoices with a staged edit/cancel awaiting approval (best-effort;
  // empty until the migration is run) so the card can lock its actions.
  const pendingEditIds = new Set<string>();
  const pendingCancelIds = new Set<string>();
  {
    const collect = async (table: "challans" | "bulk_invoices" | "other_challans") => {
      const { data, error } = await supabase.from(table).select("id, pending_edit_at, pending_cancel_at").or("pending_edit_at.not.is.null,pending_cancel_at.not.is.null");
      if (error) return;
      for (const r of (data ?? []) as Array<{ id: string; pending_edit_at: string | null; pending_cancel_at: string | null }>) {
        if (r.pending_edit_at) pendingEditIds.add(r.id);
        if (r.pending_cancel_at) pendingCancelIds.add(r.id);
      }
    };
    await collect("challans"); await collect("bulk_invoices"); await collect("other_challans");
  }

  // Mig 177 — invoiced custom (dropped) bills: temple challans re-billed as a
  // whole piece then invoiced. Best-effort so a pre-migration deploy skips them.
  type Row = InvoiceRow & { customer: string };
  const customRows: Row[] = [];
  {
    let { data, error } = await supabase.from("challans")
      .select("id, doc_fy, doc_seq, challan_date, temple, inv_fy, inv_seq, source_dispatch_id, custom_billed_by, gst_mode, igst_percent, cgst_percent, sgst_percent, challan_custom_items(amount, quantity, rate, section_gst)")
      .not("custom_billed_at", "is", null).not("inv_seq", "is", null).is("cancelled_at", null)
      .order("challan_date", { ascending: false });
    if (error) {
      // Pre-mig-199 — retry without the per-line slab column.
      ({ data, error } = (await supabase.from("challans")
        .select("id, doc_fy, doc_seq, challan_date, temple, inv_fy, inv_seq, source_dispatch_id, custom_billed_by, gst_mode, igst_percent, cgst_percent, sgst_percent, challan_custom_items(amount, quantity, rate)")
        .not("custom_billed_at", "is", null).not("inv_seq", "is", null).is("cancelled_at", null)
        .order("challan_date", { ascending: false })) as unknown as { data: typeof data; error: typeof error });
    }
    if (!error) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const r of (data ?? []) as any[]) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const gstItems = ((r.challan_custom_items ?? []) as any[]).map((it) => ({ amount: it.amount != null ? Number(it.amount) : (Number(it.quantity) || 0) * (Number(it.rate) || 0), gstPercent: it.section_gst != null ? Number(it.section_gst) : null }));
        const t = computeGroupedGstTotals(gstItems, { mode: (r.gst_mode === "igst" || r.gst_mode === "cgst_sgst" ? r.gst_mode : null) as GstMode, igst: Number(r.igst_percent) || 0, cgst: Number(r.cgst_percent) || 0, sgst: Number(r.sgst_percent) || 0 });
        customRows.push({
          key: `cust:${r.id}`, code: invoiceCodeFromDoc(r.inv_fy, r.inv_seq) ?? `INV-${String(r.id).slice(0, 6).toUpperCase()}`,
          date: r.challan_date, customer: displayNameFor(billNames, r.temple), total: t.grand,
          href: `/invoicing/challan/${r.id}/custom/print`, external: true,
          challanHref: r.source_dispatch_id ? `/dispatch/${r.source_dispatch_id}/print` : null,
          editHref: `/invoicing/running/${r.id}/invoice`, cancelKind: "running", cancelId: r.id,
          challanCodes: challanCode(r.doc_fy, r.doc_seq) ? [challanCode(r.doc_fy, r.doc_seq)!] : [],
          pendingEdit: pendingEditIds.has(r.id), pendingCancel: pendingCancelIds.has(r.id),
          sourceType: "running", createdBy: nameOf(r.custom_billed_by),
        });
      }
    }
  }

  const rows: Row[] = [
    ...customRows,
    ...legacy.map((r) => ({
      key: `inv:${r.id}`, code: r.invoice_number, date: r.invoice_date, customer: r.customer_name,
      total: Number(r.total) || 0, href: `/invoicing/invoices/${r.id}`, external: false,
      sourceType: "legacy" as const,
    })),
    ...priced.map((c) => ({
      key: `ch:${c.id}`, code: (c.invoice_no_override?.trim() || invoiceCodeFromDoc(invByChallan.get(c.id)?.fy ?? null, invByChallan.get(c.id)?.seq ?? null) || invoiceCodeFromDoc(c.doc_fy, c.doc_seq) || invoiceCode(c.challan_number, c.challan_date)), date: c.challan_date,
      customer: displayNameFor(billNames, c.temple), total: totalByChallan.get(c.id) ?? 0,
      href: `/invoicing/challan/${c.id}/print`, external: true,
      challanHref: c.source_dispatch_id ? `/dispatch/${c.source_dispatch_id}/print` : null,
      editHref: `/invoicing/challans/${c.id}/review?edit=1`, cancelKind: "priced" as const, cancelId: c.id,
      challanCodes: [challanCode(c.doc_fy, c.doc_seq) ?? c.challan_number],
      pendingEdit: pendingEditIds.has(c.id), pendingCancel: pendingCancelIds.has(c.id),
      sourceType: "purchase" as const, createdBy: nameOf(c.priced_by),
    })),
    ...bulkApproved.map((b) => ({
      key: `bulk:${b.id}`, code: (b.invoice_no_override?.trim() || invoiceCodeFromDoc(b.inv_fy, b.inv_seq) || `INV-${b.id.slice(0, 6).toUpperCase()}`), date: b.invoice_date,
      customer: displayNameFor(billNames, b.temple), total: bulkTotal.get(b.id) ?? 0,
      href: `/invoicing/bulk/${b.id}/print`, external: true,
      challanHref: null, editHref: `/invoicing/bulk/${b.id}/edit`, cancelKind: "bulk" as const, cancelId: b.id,
      challanCodes: bulkChallanCodes.get(b.id) ?? [],
      pendingEdit: pendingEditIds.has(b.id), pendingCancel: pendingCancelIds.has(b.id),
      sourceType: "work_order" as const, createdBy: nameOf(b.created_by),
    })),
  ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  // Group temple invoices (legacy + priced + bulk) into collapsible temple cards.
  const templeGroups = new Map<string, Row[]>();
  for (const r of rows) { const k = r.customer || "—"; const a = templeGroups.get(k) ?? []; a.push(r); templeGroups.set(k, a); }
  const templeList = [...templeGroups.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  // Mig 176 — "Other" (non-temple) invoices = converted other_challans. Best-
  // effort so a pre-migration deploy just shows an empty Other section.
  type OtherRow = InvoiceRow & { customer: string };
  let otherRows: OtherRow[] = [];
  {
    let { data, error } = await supabase.from("other_challans")
      .select("id, challan_date, doc_fy, doc_seq, inv_fy, inv_seq, converted_by, gst_mode, igst_percent, cgst_percent, sgst_percent, invoice_parties(name), other_challan_items(amount, quantity, rate, section_gst)")
      .not("converted_at", "is", null).is("cancelled_at", null)
      .order("converted_at", { ascending: false });
    if (error) {
      // Pre-mig-199 — retry without the per-line slab column.
      ({ data, error } = (await supabase.from("other_challans")
        .select("id, challan_date, doc_fy, doc_seq, inv_fy, inv_seq, converted_by, gst_mode, igst_percent, cgst_percent, sgst_percent, invoice_parties(name), other_challan_items(amount, quantity, rate)")
        .not("converted_at", "is", null).is("cancelled_at", null)
        .order("converted_at", { ascending: false })) as unknown as { data: typeof data; error: typeof error });
    }
    if (!error) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      otherRows = ((data ?? []) as any[]).map((o) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const gstItems = ((o.other_challan_items ?? []) as any[]).map((it) => ({ amount: it.amount != null ? Number(it.amount) : (Number(it.quantity) || 0) * (Number(it.rate) || 0), gstPercent: it.section_gst != null ? Number(it.section_gst) : null }));
        const t = computeGroupedGstTotals(gstItems, { mode: (o.gst_mode === "igst" || o.gst_mode === "cgst_sgst" ? o.gst_mode : null) as GstMode, igst: Number(o.igst_percent) || 0, cgst: Number(o.cgst_percent) || 0, sgst: Number(o.sgst_percent) || 0 });
        const party = Array.isArray(o.invoice_parties) ? o.invoice_parties[0] : o.invoice_parties;
        return {
          key: `oth:${o.id}`, code: invoiceCodeFromDoc(o.inv_fy, o.inv_seq) ?? `INV-${String(o.id).slice(0, 6).toUpperCase()}`,
          date: o.challan_date, total: t.grand, href: `/invoicing/other/${o.id}/print`, external: true, customer: party?.name ?? "—",
          editHref: `/invoicing/other/${o.id}/invoice`, cancelKind: "other" as const, cancelId: o.id,
          challanCodes: challanCode(o.doc_fy, o.doc_seq) ? [challanCode(o.doc_fy, o.doc_seq)!] : [],
          pendingEdit: pendingEditIds.has(o.id), pendingCancel: pendingCancelIds.has(o.id),
          sourceType: "other" as const, createdBy: nameOf(o.converted_by),
        };
      });
    }
  }

  // Recent view = every invoice (temple + other) newest first.
  const recent = [...rows, ...otherRows].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  return (
    <section className="page-card">
      <div className="page-header">
        <h1>Invoicing</h1>
        <p className="muted">Every issued tax invoice — newest first, or grouped by temple. <span style={{ fontWeight: 700 }}>{recent.length}</span> total.</p>
      </div>
      <InvoicesView recent={recent} templeList={templeList} otherRows={otherRows} />
    </section>
  );
}
