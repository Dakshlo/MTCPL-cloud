import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

// Invoicing department landing — list of past invoices + "+ New" CTA.
// Migration 038. Open to developer + owner for v1.
//
// The list is intentionally minimal — invoice number, customer, date,
// total, "View" button. Clicking View opens /invoicing/[id] which
// shows the printable preview + a print button.
export default async function InvoicingListPage() {
  await requireAuth(["developer", "owner"]);
  const supabase = createAdminSupabaseClient();

  const { data, error } = await supabase
    .from("invoices")
    .select("id, invoice_number, invoice_date, customer_name, total, created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Array<{
    id: string;
    invoice_number: string;
    invoice_date: string;
    customer_name: string;
    total: number;
    created_at: string;
  }>;

  return (
    <section className="page-card">
      <div
        className="page-header"
        style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}
      >
        <div>
          <h1>Invoicing</h1>
          <p className="muted">
            Outgoing customer invoices. Generate, print, and archive. Different
            from Finance — Finance handles incoming supplier bills, this
            handles invoices you issue to clients.
          </p>
        </div>
        <Link
          href="/invoicing/new"
          style={{
            textDecoration: "none",
            fontSize: 13,
            padding: "10px 18px",
            background: "var(--gold)",
            color: "#fff",
            border: "1px solid var(--gold-dark)",
            borderRadius: 8,
            fontWeight: 700,
            whiteSpace: "nowrap",
          }}
        >
          🧾 + New invoice
        </Link>
      </div>

      <div style={{ marginTop: 18 }}>
        {rows.length === 0 ? (
          <div
            style={{
              background: "var(--surface)",
              border: "1px dashed var(--border)",
              borderRadius: 12,
              padding: "32px 24px",
              textAlign: "center",
              color: "var(--muted)",
            }}
          >
            No invoices yet. Click <strong>+ New invoice</strong> to generate
            the first one.
          </div>
        ) : (
          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              overflow: "hidden",
            }}
          >
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 13,
              }}
            >
              <thead>
                <tr style={{ background: "var(--bg)" }}>
                  <th style={th}>Invoice #</th>
                  <th style={th}>Date</th>
                  <th style={th}>Customer</th>
                  <th style={{ ...th, textAlign: "right" }}>Total (₹)</th>
                  <th style={{ ...th, width: 100 }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} style={{ borderTop: "1px solid var(--border-light)" }}>
                    <td style={{ ...td, fontFamily: "ui-monospace, monospace", fontWeight: 700 }}>
                      {r.invoice_number}
                    </td>
                    <td style={td}>
                      {new Date(r.invoice_date).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </td>
                    <td style={td}>{r.customer_name}</td>
                    <td style={{ ...td, textAlign: "right", fontFamily: "ui-monospace, monospace" }}>
                      {Number(r.total).toLocaleString("en-IN", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td style={td}>
                      <Link
                        href={`/invoicing/${r.id}`}
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: "var(--gold-dark)",
                          textDecoration: "none",
                        }}
                      >
                        View →
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
