// Payment history ledger.
//
// All `paid` bill_payments rows. Default scope is last 30 days; user
// can widen. Filters: vendor, payment method, date range.

import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getProfilesMap } from "@/lib/profiles";
import {
  canConfirmPayments,
  canManageAccounts,
} from "@/lib/accounts-permissions";

type SearchParams = Promise<{
  vendor?: string;
  method?: string;
  from?: string;
  to?: string;
}>;

export default async function PaymentsHistoryPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { profile } = await requireAuth();
  if (
    !canManageAccounts(profile) &&
    !canConfirmPayments(profile)
  ) {
    redirect("/accounts");
  }

  const sp = await searchParams;
  const vendorFilter = sp.vendor ?? "";
  const methodFilter = sp.method ?? "";
  const today = new Date();
  const defaultFromDate = new Date(today.getTime() - 30 * 86_400_000);
  const fromFilter = sp.from || toDateInput(defaultFromDate);
  const toFilter = sp.to || toDateInput(today);

  const supabase = createAdminSupabaseClient();
  const profilesMap = await getProfilesMap();

  const { data: vendorRows } = await supabase
    .from("bill_vendors")
    .select("id, name")
    .order("name");
  const vendors = (vendorRows ?? []) as Array<{ id: string; name: string }>;

  // Build the paid-payments query
  const fromIso = new Date(`${fromFilter}T00:00:00.000Z`).toISOString();
  const toIso = new Date(`${toFilter}T23:59:59.999Z`).toISOString();
  let query = supabase
    .from("bill_payments")
    .select(
      "id, bill_id, paid_amount, payment_method, payment_reference, payment_note, paid_by, paid_at, bills(id, token, vendor_bill_no, bill_vendor_id, bill_vendors(id, name))",
    )
    .eq("status", "paid")
    .gte("paid_at", fromIso)
    .lte("paid_at", toIso)
    .order("paid_at", { ascending: false })
    .limit(2000);
  if (methodFilter) query = query.eq("payment_method", methodFilter);

  const { data: paidRaw, error } = await query;
  if (error) throw new Error(error.message);

  type PaidRow = {
    id: string;
    bill_id: string;
    paid_amount: number | null;
    payment_method: string | null;
    payment_reference: string | null;
    payment_note: string | null;
    paid_by: string | null;
    paid_at: string | null;
    bills:
      | {
          id: string;
          token: string;
          vendor_bill_no: string;
          bill_vendor_id: string;
          bill_vendors:
            | { id: string; name: string }
            | { id: string; name: string }[]
            | null;
        }
      | null;
  };

  let payments = ((paidRaw ?? []) as unknown) as PaidRow[];
  if (vendorFilter) {
    payments = payments.filter((p) => p.bills?.bill_vendor_id === vendorFilter);
  }

  const totalPaid = payments.reduce((s, p) => s + Number(p.paid_amount ?? 0), 0);

  return (
    <section className="page-card">
      <div className="record-head">
        <div>
          <h1>Payment history</h1>
          <p className="muted">
            Every payment that's been recorded as paid. Filter by date range,
            vendor, or method.
          </p>
        </div>
        <Link
          href="/accounts"
          style={{
            textDecoration: "none",
            fontSize: 13,
            padding: "6px 14px",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            color: "var(--muted)",
            fontWeight: 500,
            whiteSpace: "nowrap",
            alignSelf: "flex-start",
          }}
        >
          ← Due Bills
        </Link>
      </div>

      <form
        method="GET"
        style={{
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          alignItems: "flex-end",
          marginTop: 16,
          padding: "12px 14px",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 8,
        }}
      >
        <Field label="From">
          <input
            type="date"
            name="from"
            defaultValue={fromFilter}
            style={filterInputStyle}
          />
        </Field>
        <Field label="To">
          <input
            type="date"
            name="to"
            defaultValue={toFilter}
            style={filterInputStyle}
          />
        </Field>
        <Field label="Vendor">
          <select name="vendor" defaultValue={vendorFilter} style={filterInputStyle}>
            <option value="">All</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Method">
          <select name="method" defaultValue={methodFilter} style={filterInputStyle}>
            <option value="">All</option>
            <option value="cash">Cash</option>
            <option value="cheque">Cheque</option>
            <option value="neft">NEFT</option>
            <option value="rtgs">RTGS</option>
            <option value="upi">UPI</option>
            <option value="imps">IMPS</option>
            <option value="card">Card</option>
            <option value="other">Other</option>
          </select>
        </Field>
        <button
          type="submit"
          className="primary-button"
          style={{ fontSize: 13, padding: "8px 18px" }}
        >
          Apply
        </button>
        <div style={{ flex: 1 }} />
        <div
          style={{
            fontSize: 13,
            color: "var(--muted)",
            fontFamily: "ui-monospace, monospace",
          }}
        >
          {payments.length} payment{payments.length === 1 ? "" : "s"} ·{" "}
          <strong style={{ color: "#15803d" }}>
            ₹{totalPaid.toLocaleString("en-IN")}
          </strong>
        </div>
      </form>

      <div style={{ marginTop: 18, overflowX: "auto" }}>
        {payments.length === 0 ? (
          <div className="banner">No payments match these filters.</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid var(--border)" }}>
                <th style={thStyle}>Paid at</th>
                <th style={thStyle}>Token</th>
                <th style={thStyle}>Vendor</th>
                <th style={thStyle}>Bill no</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Amount</th>
                <th style={thStyle}>Method</th>
                <th style={thStyle}>Reference</th>
                <th style={thStyle}>Note</th>
                <th style={thStyle}>By</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => {
                const b = p.bills;
                const v = b ? (Array.isArray(b.bill_vendors) ? b.bill_vendors[0] ?? null : b.bill_vendors) : null;
                return (
                  <tr key={p.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={tdStyle}>
                      {p.paid_at
                        ? new Date(p.paid_at).toLocaleString("en-IN", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "—"}
                    </td>
                    <td style={tdStyle}>
                      <Link
                        href={`/accounts/bills/${p.bill_id}`}
                        style={{
                          textDecoration: "none",
                          fontFamily: "ui-monospace, monospace",
                          fontWeight: 700,
                          color: "var(--text)",
                        }}
                      >
                        {b?.token ?? "—"}
                      </Link>
                    </td>
                    <td style={tdStyle}>{v?.name ?? "—"}</td>
                    <td style={tdStyle}>
                      <code style={{ fontSize: 12 }}>{b?.vendor_bill_no ?? "—"}</code>
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right", fontFamily: "ui-monospace, monospace" }}>
                      <strong style={{ color: "#15803d" }}>
                        ₹{Number(p.paid_amount ?? 0).toLocaleString("en-IN")}
                      </strong>
                    </td>
                    <td style={tdStyle}>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          padding: "2px 8px",
                          borderRadius: 4,
                          background: "rgba(0,0,0,0.04)",
                          color: "var(--text)",
                          letterSpacing: "0.05em",
                          textTransform: "uppercase",
                        }}
                      >
                        {p.payment_method ?? "—"}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      {p.payment_reference ? (
                        <code style={{ fontSize: 12 }}>{p.payment_reference}</code>
                      ) : (
                        <span className="muted" style={{ fontSize: 11 }}>—</span>
                      )}
                    </td>
                    <td style={{ ...tdStyle, maxWidth: 240 }}>
                      <span style={{ fontSize: 12, color: "var(--muted)" }}>
                        {p.payment_note ?? "—"}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <span className="muted" style={{ fontSize: 12 }}>
                        {p.paid_by ? profilesMap[p.paid_by] ?? "—" : "—"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

function toDateInput(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

const filterInputStyle: React.CSSProperties = {
  padding: "6px 10px",
  fontSize: 13,
  border: "1px solid var(--border)",
  borderRadius: 6,
  background: "var(--bg)",
  color: "var(--text)",
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 10px",
  fontSize: 10,
  fontWeight: 700,
  color: "var(--muted)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};
const tdStyle: React.CSSProperties = {
  padding: "10px 10px",
  verticalAlign: "middle",
};
