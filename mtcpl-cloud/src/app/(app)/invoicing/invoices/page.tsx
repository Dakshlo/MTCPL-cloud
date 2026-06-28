import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canUseInvoicing } from "@/lib/invoicing-permissions";
import { computeInvoiceTotals, type GstMode } from "@/lib/challan-pricing";
import { invoiceCode } from "@/lib/invoice-code";

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
  id: string; challan_number: string; challan_date: string; temple: string | null; priced_at: string;
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
        .select("id, challan_number, challan_date, temple, priced_at, gst_mode, igst_percent, cgst_percent, sgst_percent")
        .not("priced_at", "is", null)
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

  type Row = { key: string; code: string; date: string; customer: string; total: number; href: string; external: boolean };
  const rows: Row[] = [
    ...legacy.map((r) => ({
      key: `inv:${r.id}`, code: r.invoice_number, date: r.invoice_date, customer: r.customer_name,
      total: Number(r.total) || 0, href: `/invoicing/invoices/${r.id}`, external: false,
    })),
    ...priced.map((c) => ({
      key: `ch:${c.id}`, code: invoiceCode(c.challan_number, c.challan_date), date: c.challan_date,
      customer: c.temple ?? "—", total: totalByChallan.get(c.id) ?? 0,
      href: `/invoicing/challan/${c.id}/print`, external: true,
    })),
  ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  return (
    <section className="page-card">
      <div className="page-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h1>Invoicing</h1>
          <p className="muted">
            Outgoing customer tax invoices — priced challans plus any legacy converted invoices. Different from
            Finance, which handles incoming supplier bills.
          </p>
        </div>
        <Link href="/invoicing/invoices/new" style={{ textDecoration: "none", fontSize: 13, padding: "10px 18px", background: "var(--gold)", color: "#fff", border: "1px solid var(--gold-dark)", borderRadius: 8, fontWeight: 700, whiteSpace: "nowrap" }}>
          🧾 + New invoice
        </Link>
      </div>

      <div style={{ marginTop: 18 }}>
        {rows.length === 0 ? (
          <div style={{ background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: 12, padding: "32px 24px", textAlign: "center", color: "var(--muted)" }}>
            No invoices yet. Price a challan to issue a tax invoice, or click <strong>+ New invoice</strong>.
          </div>
        ) : (
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "var(--bg)" }}>
                  <th style={th}>Invoice #</th>
                  <th style={th}>Date</th>
                  <th style={th}>Customer (temple)</th>
                  <th style={{ ...th, textAlign: "right" }}>Total (₹)</th>
                  <th style={{ ...th, width: 100 }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} style={{ borderTop: "1px solid var(--border-light)" }}>
                    <td style={{ ...td, fontFamily: "ui-monospace, monospace", fontWeight: 700 }}>{r.code}</td>
                    <td style={td}>
                      {new Date(`${r.date}T00:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })}
                    </td>
                    <td style={td}>{r.customer}</td>
                    <td style={{ ...td, textAlign: "right", fontFamily: "ui-monospace, monospace" }}>
                      {r.total.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td style={td}>
                      <Link
                        href={r.href}
                        target={r.external ? "_blank" : undefined}
                        rel={r.external ? "noopener noreferrer" : undefined}
                        style={{ fontSize: 12, fontWeight: 700, color: "var(--gold-dark)", textDecoration: "none" }}
                      >
                        {r.external ? "🖨 Invoice →" : "View →"}
                      </Link>
                    </td>
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
