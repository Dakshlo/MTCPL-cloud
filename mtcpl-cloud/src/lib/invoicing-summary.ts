// Invoiced-analytics aggregation for the Invoicing dashboard (Daksh, Jul 2026).
// Gathers EVERY issued invoice across the four sources — temple purchase (priced
// + owner-approved challans), work-order (bulk_invoices), running bills (custom-
// billed challans) and Other Sales (converted other_challans) — each with its
// party, date, amount (with GST), taxed portion and CFT/SFT/NOS breakdown.

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { applyDiscount, computeGroupedGstTotals, type GstItem, type GstMode } from "@/lib/challan-pricing";
import { challanCode, invoiceCodeFromDoc } from "@/lib/doc-code";
import { fetchTempleBillNames, displayNameFor } from "@/lib/temple-names";

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
  /** The invoice's source CHALLAN — code + a link to open that challan doc
   *  (Daksh: from an invoice you must be able to reach its challan). */
  challanCode: string | null;
  challanHref: string | null;
};

// ── Challans tab (Daksh, Jul 2026) ─────────────────────────────────
// Every real challan DOCUMENT (temple + Other Sales; archived + cancelled
// excluded) with its stage, quantity breakdown and — once priced — its value.
// Bulk-invoiced challans show qty only; their value lives on the work-order
// invoice (Invoices tab), so tallying both tabs never double-counts.
export type ChallanStatus = "open" | "in_approval" | "in_bulk" | "invoiced" | "running";
export type ChallanSummaryRow = {
  id: string;
  code: string;
  invCode: string | null;
  party: string;
  status: ChallanStatus;
  date: string;
  amount: number;
  taxed: number;
  cft: number;
  sft: number;
  nos: number;
  href: string;
};

/** Mig 200 — the invoice VALUE is the payable (grand − discount). */
const payableOf = (grand: number, r: { discount_mode?: string | null; discount_value?: number | null }) =>
  applyDiscount(grand, r.discount_mode ?? null, Number(r.discount_value) || 0).payable;

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

/** Sum item amounts (+ per-line GST slab, mig 199) + unit breakdown for a set of
 *  parent ids (batched). Every caller asks for section_gst; on a pre-mig-199
 *  schema the select is retried without it (slabs just come back null). */
async function itemsBy(
  admin: Admin, table: string, parentCol: string, ids: string[],
  cols: string, unitCol: "unit" | "measure_unit", qtyCol: "quantity" | "measure_qty",
): Promise<Map<string, { items: GstItem[]; cft: number; sft: number; nos: number }>> {
  const m = new Map<string, { items: GstItem[]; cft: number; sft: number; nos: number }>();
  const withGst = `${cols}, section_gst`;
  for (let i = 0; i < ids.length; i += 300) {
    const chunk = ids.slice(i, i + 300);
    if (!chunk.length) break;
    let { data } = await admin.from(table).select(withGst).in(parentCol, chunk);
    if (data == null) ({ data } = await admin.from(table).select(cols).in(parentCol, chunk));
    for (const it of (data ?? []) as unknown as Array<Record<string, unknown>>) {
      const pid = String(it[parentCol]);
      const e = m.get(pid) ?? { items: [], cft: 0, sft: 0, nos: 0 };
      const qty = Number(it[qtyCol]) || 0;
      const rate = Number(it.rate) || 0;
      const amt = it.amount != null ? Number(it.amount) : qty * rate;
      e.items.push({ amount: amt, gstPercent: it.section_gst != null && Number.isFinite(Number(it.section_gst)) ? Number(it.section_gst) : null });
      e[bucket(it[unitCol] as string | null)] += qty;
      m.set(pid, e);
    }
  }
  return m;
}

export async function gatherInvoiced(admin: Admin): Promise<InvoiceSummaryRow[]> {
  const out: InvoiceSummaryRow[] = [];
  // Accountants know a temple by its BILLING name (Daksh) — same resolution as
  // the ALL board, so all three tabs + exports read the same party names.
  const billNames = await fetchTempleBillNames(admin);
  const partyOf = (temple: string | null) => displayNameFor(billNames, temple) || "—";

  // 1 — Temple PURCHASE invoices: priced + owner-approved challans (not running,
  // not archived/cancelled/legacy-converted). Items are challan_items (cft/sft).
  {
    type Row = { id: string; challan_number: string; doc_fy: string | null; doc_seq: number | null; challan_date: string; temple: string | null; source_dispatch_id: string | null; inv_fy: string | null; inv_seq: number | null; invoice_no_override: string | null; custom_billed_at: string | null; gst_mode: string | null; igst_percent: number | null; cgst_percent: number | null; sgst_percent: number | null; discount_mode?: string | null; discount_value?: number | null };
    const PUR_COLS = "id, challan_number, doc_fy, doc_seq, challan_date, temple, source_dispatch_id, inv_fy, inv_seq, invoice_no_override, custom_billed_at, gst_mode, igst_percent, cgst_percent, sgst_percent";
    const purSel = (cols: string) => pageAll<Row>((from, to) => admin.from("challans")
      .select(cols)
      .not("priced_at", "is", null).not("owner_approved_at", "is", null)
      .is("cancelled_at", null).is("converted_invoice_id", null).is("archived_at", null)
      .order("challan_date", { ascending: false }).range(from, to));
    // Discount cols (mig 200) — pageAll swallows a bad-column error into an empty
    // list, so an empty first pass re-runs without them (pre-mig safe).
    let rows = await purSel(`${PUR_COLS}, discount_mode, discount_value`);
    if (rows.length === 0) rows = await purSel(PUR_COLS);
    const purchase = rows.filter((r) => !r.custom_billed_at); // running bills excluded here
    const items = await itemsBy(admin, "challan_items", "challan_id", purchase.map((r) => r.id), "challan_id, amount, rate, quantity, measure_qty, measure_unit", "measure_unit", "measure_qty");
    for (const r of purchase) {
      const it = items.get(r.id) ?? { items: [], cft: 0, sft: 0, nos: 0 };
      const t = computeGroupedGstTotals(it.items, gstOf(r));
      out.push({
        id: r.id, code: (r.invoice_no_override?.trim() || invoiceCodeFromDoc(r.inv_fy, r.inv_seq) || invoiceCodeFromDoc(r.doc_fy, r.doc_seq) || r.challan_number),
        party: partyOf(r.temple), source: "purchase", date: r.challan_date,
        amount: payableOf(t.grand, r), taxed: t.grand - t.subtotal, cft: it.cft, sft: it.sft, nos: it.nos,
        href: `/invoicing/challan/${r.id}/print`,
        // The source delivery challan — the dispatch print IS that document.
        challanCode: challanCode(r.doc_fy, r.doc_seq) ?? r.challan_number,
        challanHref: r.source_dispatch_id ? `/dispatch/${r.source_dispatch_id}/print` : `/invoicing/challans/${r.id}`,
      });
    }
  }

  // 2 — WORK ORDER invoices: bulk_invoices (owner-approved). Items carry a text unit.
  {
    type Row = { id: string; temple: string | null; invoice_date: string; inv_fy: string | null; inv_seq: number | null; invoice_no_override: string | null; gst_mode: string | null; igst_percent: number | null; cgst_percent: number | null; sgst_percent: number | null; discount_mode?: string | null; discount_value?: number | null };
    const WO_COLS = "id, temple, invoice_date, inv_fy, inv_seq, invoice_no_override, gst_mode, igst_percent, cgst_percent, sgst_percent";
    let { data } = await admin.from("bulk_invoices")
      .select(`${WO_COLS}, discount_mode, discount_value`)
      .not("owner_approved_at", "is", null).is("cancelled_at", null).order("invoice_date", { ascending: false });
    if (data == null) ({ data } = (await admin.from("bulk_invoices")
      .select(WO_COLS)
      .not("owner_approved_at", "is", null).is("cancelled_at", null).order("invoice_date", { ascending: false })) as unknown as { data: typeof data });
    const rows = (data ?? []) as unknown as Row[];
    const items = await itemsBy(admin, "bulk_invoice_items", "bulk_invoice_id", rows.map((r) => r.id), "bulk_invoice_id, amount, rate, quantity, unit", "unit", "quantity");
    // How many challans each work-order invoice covers (best-effort).
    const chCount = new Map<string, number>();
    {
      const ids = rows.map((r) => r.id);
      for (let i = 0; i < ids.length; i += 300) {
        const chunk = ids.slice(i, i + 300);
        if (!chunk.length) break;
        const { data: bc, error } = await admin.from("bulk_invoice_challans").select("bulk_invoice_id").in("bulk_invoice_id", chunk);
        if (error) break;
        for (const b of (bc ?? []) as Array<{ bulk_invoice_id: string }>) chCount.set(b.bulk_invoice_id, (chCount.get(b.bulk_invoice_id) ?? 0) + 1);
      }
    }
    for (const r of rows) {
      const it = items.get(r.id) ?? { items: [], cft: 0, sft: 0, nos: 0 };
      const t = computeGroupedGstTotals(it.items, gstOf(r));
      const n = chCount.get(r.id) ?? 0;
      out.push({
        id: r.id, code: (r.invoice_no_override?.trim() || invoiceCodeFromDoc(r.inv_fy, r.inv_seq) || `INV-${r.id.slice(0, 6).toUpperCase()}`),
        party: partyOf(r.temple), source: "work_order", date: r.invoice_date,
        amount: payableOf(t.grand, r), taxed: t.grand - t.subtotal, cft: it.cft, sft: it.sft, nos: it.nos,
        href: `/invoicing/bulk/${r.id}/print`,
        challanCode: n > 0 ? `${n} challan${n === 1 ? "" : "s"}` : null,
        challanHref: n > 0 ? "/invoicing/bulk" : null,
      });
    }
  }

  // 3 — RUNNING bills: custom-billed + invoiced challans. Items = challan_custom_items.
  {
    type Row = { id: string; challan_number: string; doc_fy: string | null; doc_seq: number | null; challan_date: string; temple: string | null; inv_fy: string | null; inv_seq: number | null; running_challan_at: string | null; gst_mode: string | null; igst_percent: number | null; cgst_percent: number | null; sgst_percent: number | null; discount_mode?: string | null; discount_value?: number | null };
    const RUN_COLS = "id, challan_number, doc_fy, doc_seq, challan_date, temple, inv_fy, inv_seq, running_challan_at, gst_mode, igst_percent, cgst_percent, sgst_percent";
    const runSel = (cols: string) => pageAll<Row>((from, to) => admin.from("challans")
      .select(cols)
      .not("custom_billed_at", "is", null).not("inv_seq", "is", null).is("cancelled_at", null).is("archived_at", null)
      .order("challan_date", { ascending: false }).range(from, to));
    let rows = await runSel(`${RUN_COLS}, discount_mode, discount_value`);
    if (rows.length === 0) rows = await runSel(RUN_COLS);
    const items = await itemsBy(admin, "challan_custom_items", "challan_id", rows.map((r) => r.id), "challan_id, amount, rate, quantity, unit", "unit", "quantity");
    for (const r of rows) {
      const it = items.get(r.id) ?? { items: [], cft: 0, sft: 0, nos: 0 };
      const t = computeGroupedGstTotals(it.items, gstOf(r));
      out.push({
        id: r.id, code: (invoiceCodeFromDoc(r.inv_fy, r.inv_seq) || r.challan_number),
        party: partyOf(r.temple), source: "running", date: r.challan_date,
        amount: payableOf(t.grand, r), taxed: t.grand - t.subtotal, cft: it.cft, sft: it.sft, nos: it.nos,
        href: `/invoicing/challan/${r.id}/custom/print`,
        challanCode: challanCode(r.doc_fy, r.doc_seq) ?? r.challan_number,
        // Only route to the running-challan print when that step actually
        // happened (running_challan_at). A "drop the challan" bill never had it
        // → running/print 404s; fall back to the custom document (always valid).
        challanHref: r.running_challan_at ? `/invoicing/challan/${r.id}/running/print` : `/invoicing/challan/${r.id}/custom/print`,
      });
    }
  }

  // 4 — OTHER SALES: converted other_challans. Party = the client.
  {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const OC_COLS = "id, challan_date, doc_fy, doc_seq, inv_fy, inv_seq, gst_mode, igst_percent, cgst_percent, sgst_percent, invoice_parties(name)";
    let { data, error } = await admin.from("other_challans")
      .select(`${OC_COLS}, discount_mode, discount_value`)
      .not("converted_at", "is", null).is("cancelled_at", null).order("converted_at", { ascending: false });
    if (error) ({ data, error } = (await admin.from("other_challans")
      .select(OC_COLS)
      .not("converted_at", "is", null).is("cancelled_at", null).order("converted_at", { ascending: false })) as unknown as { data: typeof data; error: typeof error });
    if (!error) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = (data ?? []) as any[];
      const items = await itemsBy(admin, "other_challan_items", "other_challan_id", rows.map((r) => r.id), "other_challan_id, amount, rate, quantity, unit", "unit", "quantity");
      for (const r of rows) {
        const it = items.get(r.id) ?? { items: [], cft: 0, sft: 0, nos: 0 };
        const t = computeGroupedGstTotals(it.items, gstOf(r));
        const party = Array.isArray(r.invoice_parties) ? r.invoice_parties[0]?.name : r.invoice_parties?.name;
        out.push({
          id: r.id, code: (invoiceCodeFromDoc(r.inv_fy, r.inv_seq) || `INV-${String(r.id).slice(0, 6).toUpperCase()}`),
          party: party ?? "—", source: "other", date: r.challan_date,
          amount: payableOf(t.grand, r), taxed: t.grand - t.subtotal, cft: it.cft, sft: it.sft, nos: it.nos,
          href: `/invoicing/other/${r.id}/print`,
          challanCode: challanCode(r.doc_fy, r.doc_seq),
          challanHref: `/invoicing/other/${r.id}/print`,
        });
      }
    }
  }

  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** Every challan document (temple + Other Sales), with stage + qty + value. */
export async function gatherChallans(admin: Admin): Promise<ChallanSummaryRow[]> {
  const out: ChallanSummaryRow[] = [];
  // Billing names, same as gatherInvoiced — parties read identically everywhere.
  const billNames = await fetchTempleBillNames(admin);
  const partyOf = (temple: string | null) => displayNameFor(billNames, temple) || "—";

  // Bulk membership + the bulk invoice's INV code (best-effort — mig 173).
  const inBulk = new Set<string>();
  {
    const { data, error } = await admin.from("challans").select("id").not("sent_to_bulk_at", "is", null);
    if (!error) for (const r of (data ?? []) as Array<{ id: string }>) inBulk.add(r.id);
  }
  const bulkByChallan = new Map<string, string>();
  {
    const { data, error } = await admin.from("bulk_invoice_challans").select("challan_id, bulk_invoice_id");
    if (!error) for (const r of (data ?? []) as Array<{ challan_id: string; bulk_invoice_id: string }>) bulkByChallan.set(r.challan_id, r.bulk_invoice_id);
  }
  const bulkCodeByChallan = new Map<string, string>();
  {
    const bids = [...new Set(bulkByChallan.values())];
    const codeByBulk = new Map<string, string>();
    for (let i = 0; i < bids.length; i += 300) {
      const chunk = bids.slice(i, i + 300);
      if (!chunk.length) break;
      const { data } = await admin.from("bulk_invoices").select("id, inv_fy, inv_seq, invoice_no_override").in("id", chunk);
      for (const b of (data ?? []) as Array<{ id: string; inv_fy: string | null; inv_seq: number | null; invoice_no_override: string | null }>) {
        const code = b.invoice_no_override?.trim() || invoiceCodeFromDoc(b.inv_fy, b.inv_seq) || "";
        if (code) codeByBulk.set(b.id, code);
      }
    }
    for (const [ch, bid] of bulkByChallan) { const c = codeByBulk.get(bid); if (c) bulkCodeByChallan.set(ch, c); }
  }

  // 1 — Temple challans (every stage; archived + cancelled excluded).
  {
    type Row = {
      id: string; challan_number: string; doc_fy: string | null; doc_seq: number | null; challan_date: string;
      temple: string | null; converted_invoice_id: string | null; priced_at: string | null;
      owner_approved_at: string | null; owner_rejected_at: string | null; custom_billed_at: string | null;
      inv_fy: string | null; inv_seq: number | null; invoice_no_override: string | null;
      gst_mode: string | null; igst_percent: number | null; cgst_percent: number | null; sgst_percent: number | null;
      discount_mode?: string | null; discount_value?: number | null;
    };
    const CH_COLS = "id, challan_number, doc_fy, doc_seq, challan_date, temple, converted_invoice_id, priced_at, owner_approved_at, owner_rejected_at, custom_billed_at, inv_fy, inv_seq, invoice_no_override, gst_mode, igst_percent, cgst_percent, sgst_percent";
    const chSel = (cols: string) => pageAll<Row>((from, to) => admin.from("challans")
      .select(cols)
      .is("archived_at", null).is("cancelled_at", null)
      .order("challan_date", { ascending: false }).range(from, to));
    let rows = await chSel(`${CH_COLS}, discount_mode, discount_value`);
    if (rows.length === 0) rows = await chSel(CH_COLS);
    const ids = rows.map((r) => r.id);
    const items = await itemsBy(admin, "challan_items", "challan_id", ids, "challan_id, amount, rate, quantity, measure_qty, measure_unit", "measure_unit", "measure_qty");
    // Running / get-challan docs carry their lines in challan_custom_items
    // instead — fall back to those when a challan has no challan_items.
    const customItems = await itemsBy(admin, "challan_custom_items", "challan_id", ids.filter((id) => !items.has(id)), "challan_id, amount, rate, quantity, unit", "unit", "quantity");

    for (const r of rows) {
      const isRunning = !!r.custom_billed_at && r.inv_seq != null;
      let status: ChallanStatus;
      if (isRunning) status = "running";
      else if (bulkByChallan.has(r.id) || r.converted_invoice_id || (r.priced_at && r.owner_approved_at)) status = "invoiced";
      else if (r.priced_at && !r.owner_rejected_at) status = "in_approval";
      else if (inBulk.has(r.id)) status = "in_bulk";
      else status = "open";

      const it = items.get(r.id) ?? customItems.get(r.id) ?? { items: [], cft: 0, sft: 0, nos: 0 };
      // Value only exists once priced/billed — an open challan's items carry no
      // rates, so totals come out 0 and the UI/export shows "—".
      const t = computeGroupedGstTotals(it.items, gstOf(r));
      const invCode =
        isRunning || status === "invoiced"
          ? (bulkCodeByChallan.get(r.id) ?? r.invoice_no_override?.trim() ?? invoiceCodeFromDoc(r.inv_fy, r.inv_seq))
          : null;
      const href =
        isRunning ? `/invoicing/challan/${r.id}/custom/print`
        : status === "invoiced" && !bulkByChallan.has(r.id) ? `/invoicing/challan/${r.id}/print`
        : status === "in_bulk" || bulkByChallan.has(r.id) ? "/invoicing/bulk"
        : `/invoicing/challans/${r.id}`;
      out.push({
        id: r.id,
        code: challanCode(r.doc_fy, r.doc_seq) ?? r.challan_number,
        invCode: invCode || null,
        party: partyOf(r.temple),
        status, date: r.challan_date,
        amount: payableOf(t.grand, r), taxed: t.grand - t.subtotal,
        cft: it.cft, sft: it.sft, nos: it.nos, href,
      });
    }
  }

  // 2 — Other Sales challans (converted or not; cancelled excluded). Best-effort.
  {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const OC2_COLS = "id, challan_date, doc_fy, doc_seq, inv_fy, inv_seq, converted_at, gst_mode, igst_percent, cgst_percent, sgst_percent, invoice_parties(name)";
    let { data, error } = await admin.from("other_challans")
      .select(`${OC2_COLS}, discount_mode, discount_value`)
      .is("cancelled_at", null).order("challan_date", { ascending: false });
    if (error) ({ data, error } = (await admin.from("other_challans")
      .select(OC2_COLS)
      .is("cancelled_at", null).order("challan_date", { ascending: false })) as unknown as { data: typeof data; error: typeof error });
    if (!error) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = (data ?? []) as any[];
      const items = await itemsBy(admin, "other_challan_items", "other_challan_id", rows.map((r) => String(r.id)), "other_challan_id, amount, rate, quantity, unit", "unit", "quantity");
      for (const r of rows) {
        const it = items.get(String(r.id)) ?? { items: [], cft: 0, sft: 0, nos: 0 };
        const converted = !!r.converted_at;
        const t = computeGroupedGstTotals(it.items, gstOf(r));
        const party = Array.isArray(r.invoice_parties) ? r.invoice_parties[0]?.name : r.invoice_parties?.name;
        out.push({
          id: `other:${String(r.id)}`,
          code: challanCode(r.doc_fy, r.doc_seq) ?? `CH-${String(r.id).slice(0, 6).toUpperCase()}`,
          invCode: converted ? invoiceCodeFromDoc(r.inv_fy, r.inv_seq) : null,
          party: party ?? "Other Sales",
          status: converted ? "invoiced" : "open",
          date: String(r.challan_date),
          amount: payableOf(t.grand, r), taxed: t.grand - t.subtotal,
          cft: it.cft, sft: it.sft, nos: it.nos,
          href: `/invoicing/other/${String(r.id)}/print`,
        });
      }
    }
  }

  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}
