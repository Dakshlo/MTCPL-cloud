import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getProfilesMap } from "@/lib/profiles";
import {
  canConfirmPayments,
  canManageAccounts,
} from "@/lib/accounts-permissions";
import {
  AccountsHero,
  ACCOUNTS_TOKENS,
  BUTTON_STYLES,
  EmptyState,
  INPUT_STYLE,
  KpiCard,
  Money,
  TABLE_STYLES,
  VendorIdentity,
} from "../_ui/components";

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
  if (!canManageAccounts(profile) && !canConfirmPayments(profile)) {
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
  const distinctVendors = new Set(payments.map((p) => p.bills?.bill_vendor_id)).size;
  const avgPayment = payments.length === 0 ? 0 : Math.round(totalPaid / payments.length);

  // Method breakdown
  const byMethod = new Map<string, { count: number; total: number }>();
  for (const p of payments) {
    const m = p.payment_method ?? "other";
    const cur = byMethod.get(m) ?? { count: 0, total: 0 };
    cur.count++;
    cur.total += Number(p.paid_amount ?? 0);
    byMethod.set(m, cur);
  }

  return (
    <section className="page-card">
      <AccountsHero
        title="Payment history"
        description="Ledger of every payment that's been marked paid. Filter by date range, vendor, or method."
        actions={
          <Link href="/accounts" style={BUTTON_STYLES.secondary}>
            ← Due Bills
          </Link>
        }
      />

      {/* KPI strip */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <KpiCard
          label="Total paid"
          value={<Money value={totalPaid} size="hero" tone="success" />}
          sublabel={`from ${fromFilter} to ${toFilter}`}
          tone="success"
          icon="💸"
        />
        <KpiCard
          label="Payments recorded"
          value={
            <span style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.02em" }}>
              {payments.length}
            </span>
          }
          sublabel={`across ${distinctVendors} vendor${distinctVendors === 1 ? "" : "s"}`}
          tone="accent"
          icon="🧾"
        />
        <KpiCard
          label="Avg payment"
          value={<Money value={avgPayment} size="large" tone="muted" />}
          sublabel="across the filter window"
          tone="neutral"
          icon="📊"
        />
      </div>

      {/* Filter strip */}
      <form
        method="GET"
        style={{
          background: "var(--surface, #fff)",
          border: `1px solid ${ACCOUNTS_TOKENS.border}`,
          borderRadius: 12,
          padding: "12px 14px",
          marginBottom: 16,
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          alignItems: "flex-end",
          boxShadow: ACCOUNTS_TOKENS.shadow,
        }}
      >
        <Field label="From">
          <input type="date" name="from" defaultValue={fromFilter} style={{ ...INPUT_STYLE, fontFamily: "ui-monospace, monospace" }} />
        </Field>
        <Field label="To">
          <input type="date" name="to" defaultValue={toFilter} style={{ ...INPUT_STYLE, fontFamily: "ui-monospace, monospace" }} />
        </Field>
        <Field label="Vendor">
          <select name="vendor" defaultValue={vendorFilter} style={INPUT_STYLE}>
            <option value="">All vendors</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Method">
          <select name="method" defaultValue={methodFilter} style={INPUT_STYLE}>
            <option value="">All methods</option>
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
        <button type="submit" style={BUTTON_STYLES.primary}>
          Apply
        </button>
        {(vendorFilter || methodFilter || sp.from || sp.to) && (
          <Link href="/accounts/payments" style={{ fontSize: 12, color: "var(--muted)", textDecoration: "underline", paddingBottom: 10 }}>
            Reset
          </Link>
        )}
      </form>

      {/* Method breakdown */}
      {byMethod.size > 0 && (
        <div
          style={{
            display: "flex",
            gap: 8,
            marginBottom: 16,
            flexWrap: "wrap",
          }}
        >
          {[...byMethod.entries()]
            .sort((a, b) => b[1].total - a[1].total)
            .map(([method, { count, total }]) => (
              <div
                key={method}
                style={{
                  padding: "6px 12px",
                  background: "#fff",
                  border: `1px solid ${ACCOUNTS_TOKENS.border}`,
                  borderRadius: 999,
                  fontSize: 12,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <strong style={{ textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text)" }}>
                  {method}
                </strong>
                <span style={{ color: "var(--muted)" }}>
                  {count} · ₹{total.toLocaleString("en-IN")}
                </span>
              </div>
            ))}
        </div>
      )}

      {/* Payment table */}
      {payments.length === 0 ? (
        <EmptyState
          icon="🗂️"
          title="No payments match the current filters"
          description="Try widening the date range or clearing the vendor / method filters."
        />
      ) : (
        <div style={TABLE_STYLES.tableWrap}>
          <div style={{ overflowX: "auto" }}>
            <table style={TABLE_STYLES.table}>
              <thead style={TABLE_STYLES.thead}>
                <tr>
                  <th style={TABLE_STYLES.th}>Paid at</th>
                  <th style={TABLE_STYLES.th}>Vendor / token</th>
                  <th style={TABLE_STYLES.th}>Bill no</th>
                  <th style={TABLE_STYLES.thRight}>Amount</th>
                  <th style={TABLE_STYLES.th}>Method</th>
                  <th style={TABLE_STYLES.th}>Reference</th>
                  <th style={TABLE_STYLES.th}>Note</th>
                  <th style={TABLE_STYLES.th}>By</th>
                  <th style={TABLE_STYLES.th}>Voucher</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p, idx) => {
                  const b = p.bills;
                  const v = b ? (Array.isArray(b.bill_vendors) ? b.bill_vendors[0] ?? null : b.bill_vendors) : null;
                  return (
                    <tr
                      key={p.id}
                      style={{ background: idx % 2 === 0 ? "#fff" : ACCOUNTS_TOKENS.surfaceMuted }}
                    >
                      <td style={{ ...TABLE_STYLES.td, fontSize: 12, color: "var(--muted)" }}>
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
                      <td style={TABLE_STYLES.td}>
                        <Link
                          href={`/accounts/bills/${p.bill_id}`}
                          style={{ textDecoration: "none", color: "inherit" }}
                        >
                          <VendorIdentity name={v?.name ?? "—"} subLabel={b?.token ?? "—"} />
                        </Link>
                      </td>
                      <td style={TABLE_STYLES.td}>
                        <code style={{ fontSize: 12, fontFamily: "ui-monospace, monospace" }}>
                          {b?.vendor_bill_no ?? "—"}
                        </code>
                      </td>
                      <td style={TABLE_STYLES.tdRight}>
                        <Money value={Number(p.paid_amount ?? 0)} tone="success" />
                      </td>
                      <td style={TABLE_STYLES.td}>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            padding: "2px 10px",
                            borderRadius: 999,
                            background: ACCOUNTS_TOKENS.surfaceMuted,
                            color: ACCOUNTS_TOKENS.neutral,
                            letterSpacing: "0.05em",
                            textTransform: "uppercase",
                            border: `1px solid ${ACCOUNTS_TOKENS.border}`,
                          }}
                        >
                          {p.payment_method ?? "—"}
                        </span>
                      </td>
                      <td style={TABLE_STYLES.td}>
                        {p.payment_reference ? (
                          <code style={{ fontSize: 12, fontFamily: "ui-monospace, monospace" }}>
                            {p.payment_reference}
                          </code>
                        ) : (
                          <span style={{ fontSize: 11, color: "var(--muted)" }}>—</span>
                        )}
                      </td>
                      <td style={{ ...TABLE_STYLES.td, maxWidth: 220, fontSize: 12, color: "var(--muted)" }}>
                        {p.payment_note ?? "—"}
                      </td>
                      <td style={{ ...TABLE_STYLES.td, fontSize: 12, color: "var(--muted)" }}>
                        {p.paid_by ? profilesMap[p.paid_by] ?? "—" : "—"}
                      </td>
                      <td style={TABLE_STYLES.td}>
                        <Link
                          href={`/accounts/payments/${p.id}/voucher`}
                          title="Open printable voucher"
                          style={{
                            textDecoration: "none",
                            color: ACCOUNTS_TOKENS.accent,
                            fontWeight: 700,
                            fontSize: 11,
                            padding: "3px 10px",
                            background: ACCOUNTS_TOKENS.accentLight,
                            border: `1px solid ${ACCOUNTS_TOKENS.accentBorder ?? ACCOUNTS_TOKENS.accent}`,
                            borderRadius: 6,
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            whiteSpace: "nowrap",
                          }}
                        >
                          🖨 Voucher
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
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
