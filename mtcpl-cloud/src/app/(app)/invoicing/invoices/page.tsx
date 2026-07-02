import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canUseInvoicing } from "@/lib/invoicing-permissions";
import { computeInvoiceTotals, type GstMode } from "@/lib/challan-pricing";
import { invoiceCode } from "@/lib/invoice-code";
import { invoiceCodeFromDoc } from "@/lib/doc-code";
import { CollapsibleInvoiceTemple, type InvoiceRow } from "./invoices-collapsible";

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
        .select("id, challan_number, doc_fy, doc_seq, challan_date, temple, priced_at, invoice_no_override, gst_mode, igst_percent, cgst_percent, sgst_percent")
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
  const totalByChallan = new Map<string, number>();
  const challanIds = priced.map((c) => c.id);
  for (let i = 0; i < challanIds.length; i += 300) {
    const chunk = challanIds.slice(i, i + 300);
    if (chunk.length === 0) break;
    const { data: items } = await supabase
      .from("challan_items")
      .select("challan_id, amount, rate, measure_qty, quantity")
      .in("challan_id", chunk);
    const byCh = new Map<string, number[]>();
    for (const it of (items ?? []) as Array<{ challan_id: string; amount: number | null; rate: number | null; measure_qty: number | null; quantity: number | null }>) {
      const meas = it.measure_qty != null && Number(it.measure_qty) > 0 ? Number(it.measure_qty) : Number(it.quantity) || 0;
      const amt = it.amount != null ? Number(it.amount) : (Number(it.rate) || 0) * meas;
      const arr = byCh.get(it.challan_id) ?? []; arr.push(amt); byCh.set(it.challan_id, arr);
    }
    for (const c of priced) {
      if (!chunk.includes(c.id)) continue;
      const t = computeInvoiceTotals(byCh.get(c.id) ?? [], {
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
  type BulkRow = { id: string; temple: string; invoice_date: string; inv_fy: string | null; inv_seq: number | null; invoice_no_override: string | null; gst_mode: string | null; igst_percent: number | null; cgst_percent: number | null; sgst_percent: number | null };
  let bulkApproved: BulkRow[] = [];
  {
    const { data, error } = await supabase.from("bulk_invoices")
      .select("id, temple, invoice_date, inv_fy, inv_seq, invoice_no_override, gst_mode, igst_percent, cgst_percent, sgst_percent")
      .not("owner_approved_at", "is", null).is("cancelled_at", null)
      .order("invoice_date", { ascending: false });
    if (!error) bulkApproved = (data ?? []) as BulkRow[];
  }
  const bulkTotal = new Map<string, number>();
  if (bulkApproved.length) {
    const ids = bulkApproved.map((b) => b.id);
    for (let i = 0; i < ids.length; i += 300) {
      const chunk = ids.slice(i, i + 300); if (!chunk.length) break;
      const { data: its } = await supabase.from("bulk_invoice_items").select("bulk_invoice_id, amount, quantity, rate").in("bulk_invoice_id", chunk);
      const byB = new Map<string, number[]>();
      for (const it of (its ?? []) as Array<{ bulk_invoice_id: string; amount: number | null; quantity: number | null; rate: number | null }>) {
        const amt = it.amount != null ? Number(it.amount) : (Number(it.quantity) || 0) * (Number(it.rate) || 0);
        const a = byB.get(it.bulk_invoice_id) ?? []; a.push(amt); byB.set(it.bulk_invoice_id, a);
      }
      for (const b of bulkApproved) {
        if (!chunk.includes(b.id)) continue;
        const t = computeInvoiceTotals(byB.get(b.id) ?? [], { mode: (b.gst_mode === "igst" || b.gst_mode === "cgst_sgst" ? b.gst_mode : null) as GstMode, igst: Number(b.igst_percent) || 0, cgst: Number(b.cgst_percent) || 0, sgst: Number(b.sgst_percent) || 0 });
        bulkTotal.set(b.id, t.grand);
      }
    }
  }

  type Row = { key: string; code: string; date: string; customer: string; total: number; href: string; external: boolean };
  const rows: Row[] = [
    ...legacy.map((r) => ({
      key: `inv:${r.id}`, code: r.invoice_number, date: r.invoice_date, customer: r.customer_name,
      total: Number(r.total) || 0, href: `/invoicing/invoices/${r.id}`, external: false,
    })),
    ...priced.map((c) => ({
      key: `ch:${c.id}`, code: (c.invoice_no_override?.trim() || invoiceCodeFromDoc(invByChallan.get(c.id)?.fy ?? null, invByChallan.get(c.id)?.seq ?? null) || invoiceCodeFromDoc(c.doc_fy, c.doc_seq) || invoiceCode(c.challan_number, c.challan_date)), date: c.challan_date,
      customer: c.temple ?? "—", total: totalByChallan.get(c.id) ?? 0,
      href: `/invoicing/challan/${c.id}/print`, external: true,
    })),
    ...bulkApproved.map((b) => ({
      key: `bulk:${b.id}`, code: (b.invoice_no_override?.trim() || invoiceCodeFromDoc(b.inv_fy, b.inv_seq) || `INV-${b.id.slice(0, 6).toUpperCase()}`), date: b.invoice_date,
      customer: b.temple ?? "—", total: bulkTotal.get(b.id) ?? 0,
      href: `/invoicing/bulk/${b.id}/print`, external: true,
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
    const { data, error } = await supabase.from("other_challans")
      .select("id, challan_date, inv_fy, inv_seq, gst_mode, igst_percent, cgst_percent, sgst_percent, invoice_parties(name), other_challan_items(amount, quantity, rate)")
      .not("converted_at", "is", null).is("cancelled_at", null)
      .order("converted_at", { ascending: false });
    if (!error) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      otherRows = ((data ?? []) as any[]).map((o) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const amounts = ((o.other_challan_items ?? []) as any[]).map((it) => (it.amount != null ? Number(it.amount) : (Number(it.quantity) || 0) * (Number(it.rate) || 0)));
        const t = computeInvoiceTotals(amounts, { mode: (o.gst_mode === "igst" || o.gst_mode === "cgst_sgst" ? o.gst_mode : null) as GstMode, igst: Number(o.igst_percent) || 0, cgst: Number(o.cgst_percent) || 0, sgst: Number(o.sgst_percent) || 0 });
        const party = Array.isArray(o.invoice_parties) ? o.invoice_parties[0] : o.invoice_parties;
        return { key: `oth:${o.id}`, code: invoiceCodeFromDoc(o.inv_fy, o.inv_seq) ?? `INV-${String(o.id).slice(0, 6).toUpperCase()}`, date: o.challan_date, total: t.grand, href: `/invoicing/other/${o.id}/print`, external: true, customer: party?.name ?? "—" };
      });
    }
  }

  return (
    <section className="page-card">
      <div className="page-header">
        <h1>Invoicing</h1>
        <p className="muted">Every issued tax invoice — temple sales grouped by temple, plus other (non-temple) sales.</p>
      </div>

      {/* Temple invoices — collapsible temple cards, collapsed by default. */}
      <div style={{ marginTop: 16 }}>
        <div style={sectionHead}>🏛 Temple invoices <span style={countPill}>{rows.length}</span></div>
        {templeList.length === 0 ? (
          <Empty text="No temple invoices yet. Price a challan to issue one." />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {templeList.map(([temple, list]) => (
              <CollapsibleInvoiceTemple key={temple} temple={temple} rows={list.map((r) => ({ key: r.key, code: r.code, date: r.date, total: r.total, href: r.href, external: r.external }))} />
            ))}
          </div>
        )}
      </div>

      {/* Other (non-temple) invoices. */}
      <div style={{ marginTop: 22 }}>
        <div style={sectionHead}>🏷 Other invoices <span style={countPill}>{otherRows.length}</span></div>
        {otherRows.length === 0 ? (
          <Empty text="No other invoices yet. Create one in Other Sales." />
        ) : (
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "var(--bg)" }}>
                  <th style={th}>Invoice #</th>
                  <th style={th}>Date</th>
                  <th style={th}>Client</th>
                  <th style={{ ...th, textAlign: "right" }}>Total (₹)</th>
                  <th style={{ ...th, width: 100 }}></th>
                </tr>
              </thead>
              <tbody>
                {otherRows.map((r) => (
                  <tr key={r.key} style={{ borderTop: "1px solid var(--border-light)" }}>
                    <td style={{ ...td, fontFamily: "ui-monospace, monospace", fontWeight: 700 }}>{r.code}</td>
                    <td style={td}>{new Date(`${r.date}T00:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })}</td>
                    <td style={td}>{r.customer}</td>
                    <td style={{ ...td, textAlign: "right", fontFamily: "ui-monospace, monospace" }}>{r.total.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td style={td}><Link href={r.href} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, fontWeight: 700, color: "var(--gold-dark)", textDecoration: "none" }}>🖨 Invoice →</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

const sectionHead: React.CSSProperties = { fontSize: 13, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text)", marginBottom: 10, display: "flex", alignItems: "center", gap: 8 };
const countPill: React.CSSProperties = { fontSize: 11, fontWeight: 800, color: "var(--muted)", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 999, padding: "1px 9px" };
function Empty({ text }: { text: string }) {
  return <div style={{ background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: 12, padding: "26px 20px", textAlign: "center", color: "var(--muted)", fontSize: 13.5 }}>{text}</div>;
}

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 12px",
  fontSize: 11,
  fontWeight: 700,
  color: "var(--muted)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const td: React.CSSProperties = {
  padding: "10px 12px",
  verticalAlign: "middle",
};
