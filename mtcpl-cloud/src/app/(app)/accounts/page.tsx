// Accounts landing — role-aware. Zoho Books / FreshBooks-style.
//
//   accountant  → due-bills dashboard (hero KPIs + aging strip + table).
//   owner / dev → same dashboard (they see everything).
//   biller      → redirected to /accounts/bills/new (their primary action).

import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  canApproveBills,
  canManageAccounts,
} from "@/lib/accounts-permissions";
import { DueBillsClient, type DueBillRow } from "./dashboard-client";
import { proposePaymentsAction } from "./actions";
import {
  AccountsHero,
  ACCOUNTS_TOKENS,
  BUTTON_STYLES,
  EmptyState,
  KpiCard,
  Money,
} from "./_ui/components";

type SearchParams = Promise<{ vendor?: string; age?: string }>;

export default async function AccountsHomePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { profile } = await requireAuth();
  if (profile.role === "biller") {
    redirect("/accounts/bills/new");
  }
  if (
    profile.role !== "developer" &&
    profile.role !== "owner" &&
    profile.role !== "accountant"
  ) {
    redirect("/accounts/bills");
  }

  const sp = await searchParams;
  const vendorFilter = sp.vendor ?? "";
  const ageFilter = sp.age ?? "";

  const supabase = createAdminSupabaseClient();

  const { data: vendorRows } = await supabase
    .from("bill_vendors")
    .select("id, name")
    .eq("is_active", true)
    .order("name");
  const vendors = (vendorRows ?? []) as Array<{ id: string; name: string }>;

  let dueQuery = supabase
    .from("bills")
    .select(
      "id, token, vendor_bill_no, bill_date, description, cost_head, amount_total, amount_gst, amount_tds, amount_tcs, amount_payable_to_vendor, amount_paid, amount_outstanding, status, approved_at, bill_vendor_id, bill_vendors(id, name, payment_terms_days)",
    )
    .eq("status", "approved")
    .gt("amount_outstanding", 0)
    .order("bill_date", { ascending: true })
    .limit(1000);
  if (vendorFilter) dueQuery = dueQuery.eq("bill_vendor_id", vendorFilter);

  const { data: dueRaw, error } = await dueQuery;
  if (error) throw new Error(error.message);

  const billIds = (dueRaw ?? []).map((b) => b.id as string);
  const openPaymentBillIds = new Set<string>();
  // Paid-in-parts breakdown — every bill_payments row at status='paid'
  // for the bills on this page, grouped per bill. Used to render the
  // chips Daksh asked for ("₹10k · ₹20k · ₹20k") under each bill's
  // paid total.
  const paidPartsByBill = new Map<
    string,
    Array<{ amount: number; paidAt: string | null; method: string | null }>
  >();
  if (billIds.length > 0) {
    const [{ data: openPayments }, { data: paidPayments }] = await Promise.all([
      supabase
        .from("bill_payments")
        .select("bill_id")
        .in("bill_id", billIds)
        .in("status", ["proposed", "confirmed"]),
      supabase
        .from("bill_payments")
        .select("bill_id, paid_amount, paid_at, payment_method")
        .in("bill_id", billIds)
        .eq("status", "paid")
        .order("paid_at", { ascending: true }),
    ]);
    for (const p of openPayments ?? []) openPaymentBillIds.add(p.bill_id as string);
    for (const p of paidPayments ?? []) {
      const billId = p.bill_id as string;
      const list = paidPartsByBill.get(billId) ?? [];
      list.push({
        amount: Number(p.paid_amount) || 0,
        paidAt: (p.paid_at as string | null) ?? null,
        method: (p.payment_method as string | null) ?? null,
      });
      paidPartsByBill.set(billId, list);
    }
  }

  type DbRow = {
    id: string;
    token: string;
    vendor_bill_no: string;
    bill_date: string;
    description: string;
    cost_head: string | null;
    amount_total: number;
    amount_gst: number | null;
    amount_tds: number | null;
    amount_tcs: number | null;
    amount_payable_to_vendor: number | null;
    amount_paid: number;
    amount_outstanding: number;
    approved_at: string | null;
    bill_vendor_id: string;
    bill_vendors:
      | { id: string; name: string; payment_terms_days: number | null }
      | { id: string; name: string; payment_terms_days: number | null }[]
      | null;
  };
  const dueRows = ((dueRaw ?? []) as unknown) as DbRow[];

  // App-level default if a vendor hasn't set its own terms. Was the
  // global "45 days" constant before mig 040 — keep here as fallback
  // so legacy vendors still get a sensible warning.
  const DEFAULT_PAYMENT_TERMS_DAYS = 45;

  const todayMs = Date.now();
  function bucketFor(dateStr: string): "0_30" | "31_60" | "61_90" | "90_plus" {
    const d = new Date(dateStr).getTime();
    const days = Math.floor((todayMs - d) / 86_400_000);
    if (days <= 30) return "0_30";
    if (days <= 60) return "31_60";
    if (days <= 90) return "61_90";
    return "90_plus";
  }
  function daysSince(dateStr: string): number {
    return Math.floor((todayMs - new Date(dateStr).getTime()) / 86_400_000);
  }

  const allDue: DueBillRow[] = dueRows.map((r) => {
    const v = Array.isArray(r.bill_vendors) ? r.bill_vendors[0] ?? null : r.bill_vendors;
    const days = daysSince(r.bill_date);
    // Per-vendor payment terms (mig 040) — falls back to the legacy
    // 45-day default if this vendor hasn't been migrated yet.
    const terms =
      v?.payment_terms_days != null
        ? Number(v.payment_terms_days)
        : DEFAULT_PAYMENT_TERMS_DAYS;
    return {
      id: r.id,
      token: r.token,
      vendorId: r.bill_vendor_id,
      vendorName: v?.name ?? "—",
      vendorBillNo: r.vendor_bill_no,
      billDate: r.bill_date,
      description: r.description,
      costHead: r.cost_head,
      amountTotal: Number(r.amount_total),
      amountGst: Number(r.amount_gst ?? 0),
      amountTds: Number(r.amount_tds ?? 0),
      amountTcs: Number(r.amount_tcs ?? 0),
      amountPayableToVendor: Number(r.amount_payable_to_vendor ?? r.amount_total),
      amountPaid: Number(r.amount_paid),
      amountOutstanding: Number(r.amount_outstanding),
      ageBucket: bucketFor(r.bill_date),
      hasOpenPayment: openPaymentBillIds.has(r.id),
      daysSinceBill: days,
      // Mig 040: premature = younger than THIS vendor's terms.
      // Vendor with terms=0 ("current") never triggers — they want
      // to be paid on receipt.
      prematureForPayment: terms > 0 && days < terms,
      paymentTermsDays: terms,
      paymentParts: paidPartsByBill.get(r.id) ?? [],
      crosscheckedAt: r.approved_at,
    };
  });

  const filteredDue = ageFilter
    ? allDue.filter((b) => b.ageBucket === ageFilter)
    : allDue;

  const totalOutstanding = filteredDue.reduce((s, b) => s + b.amountOutstanding, 0);
  const billsCount = filteredDue.length;
  const avgDaysOutstanding =
    filteredDue.length === 0
      ? 0
      : Math.round(
          filteredDue.reduce(
            (s, b) => s + Math.floor((todayMs - new Date(b.billDate).getTime()) / 86_400_000),
            0,
          ) / filteredDue.length,
        );
  const topVendor = (() => {
    const totals = new Map<string, { name: string; total: number }>();
    for (const b of filteredDue) {
      const cur = totals.get(b.vendorId) ?? { name: b.vendorName, total: 0 };
      cur.total += b.amountOutstanding;
      totals.set(b.vendorId, cur);
    }
    let top: { name: string; total: number } | null = null;
    for (const v of totals.values()) {
      if (!top || v.total > top.total) top = v;
    }
    return top;
  })();

  const bucketCounts = {
    "0_30": allDue.filter((b) => b.ageBucket === "0_30").length,
    "31_60": allDue.filter((b) => b.ageBucket === "31_60").length,
    "61_90": allDue.filter((b) => b.ageBucket === "61_90").length,
    "90_plus": allDue.filter((b) => b.ageBucket === "90_plus").length,
  };
  const bucketTotals = {
    "0_30": allDue.filter((b) => b.ageBucket === "0_30").reduce((s, b) => s + b.amountOutstanding, 0),
    "31_60": allDue.filter((b) => b.ageBucket === "31_60").reduce((s, b) => s + b.amountOutstanding, 0),
    "61_90": allDue.filter((b) => b.ageBucket === "61_90").reduce((s, b) => s + b.amountOutstanding, 0),
    "90_plus": allDue.filter((b) => b.ageBucket === "90_plus").reduce((s, b) => s + b.amountOutstanding, 0),
  };
  const grandTotal = allDue.reduce((s, b) => s + b.amountOutstanding, 0) || 1;

  const isApprover = canApproveBills(profile);
  const isAccountManager = canManageAccounts(profile);

  return (
    <section className="page-card">
      <AccountsHero
        title={profile.role === "accountant" ? "Due Bills" : "Accounts"}
        description={
          profile.role === "accountant"
            ? "Approved bills awaiting payment. Pick rows to propose for today's run."
            : "Finance overview. Audit fresh bills and queue today's payment batch."
        }
        actions={
          // Bills Audit + Payment History dropped (already in
          // sidebar). Pay Today kept here — it's the one daily-use
          // CTA the accountant launches from this page.
          <Link href="/accounts/pay-today" style={BUTTON_STYLES.secondary}>
            💸 Pay Today
          </Link>
        }
      />

      {/* Hero KPI strip */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <KpiCard
          label="Total outstanding"
          value={<Money value={totalOutstanding} size="hero" tone={totalOutstanding > 0 ? "danger" : "muted"} />}
          sublabel={`across ${billsCount} bill${billsCount === 1 ? "" : "s"}`}
          tone="danger"
          icon="💰"
        />
        <KpiCard
          label="Bills in queue"
          value={
            <span style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-0.02em" }}>
              {billsCount}
            </span>
          }
          sublabel={ageFilter ? "in selected age bucket" : "approved + outstanding"}
          tone="accent"
          icon="📋"
        />
        <KpiCard
          label="Avg days outstanding"
          value={
            <span style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-0.02em", color: avgDaysOutstanding > 60 ? ACCOUNTS_TOKENS.danger : "var(--text)" }}>
              {avgDaysOutstanding}
              <span style={{ fontSize: 16, color: "var(--muted)", fontWeight: 600, marginLeft: 4 }}>days</span>
            </span>
          }
          sublabel={
            avgDaysOutstanding === 0
              ? "—"
              : avgDaysOutstanding <= 30
                ? "Healthy turnaround"
                : avgDaysOutstanding <= 60
                  ? "Watch list"
                  : "Action needed"
          }
          tone={avgDaysOutstanding > 60 ? "danger" : avgDaysOutstanding > 30 ? "warning" : "success"}
          icon="⏱"
        />
        <KpiCard
          label="Top vendor by outstanding"
          value={
            topVendor ? (
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 4, lineHeight: 1.2, wordBreak: "break-word" }}>
                  {topVendor.name}
                </div>
                <Money value={topVendor.total} size="large" tone="warning" />
              </div>
            ) : (
              <span style={{ fontSize: 18, color: "var(--muted)", fontWeight: 600 }}>—</span>
            )
          }
          tone="warning"
          icon="🏢"
        />
      </div>

      {/* Aging analysis — proportional bar + bucket tiles */}
      {allDue.length > 0 && (
        <div
          style={{
            background: "var(--surface, #fff)",
            border: `1px solid ${ACCOUNTS_TOKENS.border}`,
            borderRadius: 12,
            padding: "16px 18px",
            marginBottom: 16,
            boxShadow: ACCOUNTS_TOKENS.shadow,
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
            <h2 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.005em" }}>
              Aging analysis
            </h2>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>
              by days since bill date
            </span>
          </div>

          {/* Proportional aging bar */}
          <div
            style={{
              display: "flex",
              height: 8,
              borderRadius: 4,
              overflow: "hidden",
              background: ACCOUNTS_TOKENS.surfaceMuted,
              marginBottom: 14,
            }}
          >
            {(["0_30", "31_60", "61_90", "90_plus"] as const).map((b) => {
              const colors = {
                "0_30": ACCOUNTS_TOKENS.success,
                "31_60": "#f59e0b",
                "61_90": "#ea580c",
                "90_plus": ACCOUNTS_TOKENS.danger,
              };
              const pct = (bucketTotals[b] / grandTotal) * 100;
              if (pct === 0) return null;
              return (
                <div
                  key={b}
                  style={{
                    width: `${pct}%`,
                    background: colors[b],
                    transition: "width 0.2s",
                  }}
                  title={`${b.replace("_", "–").replace("plus", "+")} days · ₹${bucketTotals[b].toLocaleString("en-IN")}`}
                />
              );
            })}
          </div>

          {/* Bucket tiles */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: 8,
            }}
          >
            <AgeBucket
              label="All bills"
              value=""
              current={ageFilter}
              count={allDue.length}
              total={allDue.reduce((s, b) => s + b.amountOutstanding, 0)}
              accent={ACCOUNTS_TOKENS.accent}
              vendor={vendorFilter}
            />
            <AgeBucket
              label="0–30 days"
              value="0_30"
              current={ageFilter}
              count={bucketCounts["0_30"]}
              total={bucketTotals["0_30"]}
              accent={ACCOUNTS_TOKENS.success}
              vendor={vendorFilter}
            />
            <AgeBucket
              label="31–60 days"
              value="31_60"
              current={ageFilter}
              count={bucketCounts["31_60"]}
              total={bucketTotals["31_60"]}
              accent="#f59e0b"
              vendor={vendorFilter}
            />
            <AgeBucket
              label="61–90 days"
              value="61_90"
              current={ageFilter}
              count={bucketCounts["61_90"]}
              total={bucketTotals["61_90"]}
              accent="#ea580c"
              vendor={vendorFilter}
            />
            <AgeBucket
              label="90+ days"
              value="90_plus"
              current={ageFilter}
              count={bucketCounts["90_plus"]}
              total={bucketTotals["90_plus"]}
              accent={ACCOUNTS_TOKENS.danger}
              vendor={vendorFilter}
            />
          </div>
        </div>
      )}

      {/* Vendor filter */}
      <div
        style={{
          display: "flex",
          gap: 10,
          marginBottom: 14,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <form method="GET" style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
          {ageFilter && <input type="hidden" name="age" value={ageFilter} />}
          <label style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Vendor
          </label>
          <select
            name="vendor"
            defaultValue={vendorFilter}
            style={{
              padding: "6px 12px",
              fontSize: 13,
              background: "#fff",
              border: `1px solid ${ACCOUNTS_TOKENS.borderStrong}`,
              borderRadius: 8,
              color: "var(--text)",
              minWidth: 200,
            }}
          >
            <option value="">All vendors</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
          <button type="submit" style={BUTTON_STYLES.secondary}>
            Apply filter
          </button>
          {(vendorFilter || ageFilter) && (
            <Link href="/accounts" style={{ fontSize: 12, color: "var(--muted)", textDecoration: "underline" }}>
              Clear all
            </Link>
          )}
        </form>
      </div>

      {/* Multi-select propose table */}
      {filteredDue.length === 0 && allDue.length === 0 ? (
        <EmptyState
          icon="💸"
          title="No bills due right now"
          description="When the owner approves a bill, it lands here for payment proposal. Try the Bills Audit queue if you're expecting something."
          action={
            isApprover ? (
              <Link href="/accounts/approvals" style={BUTTON_STYLES.primary}>
                Open Bills Audit
              </Link>
            ) : undefined
          }
        />
      ) : (
        <DueBillsClient
          rows={filteredDue}
          canPropose={isAccountManager}
          proposeAction={proposePaymentsAction}
        />
      )}
    </section>
  );
}

function AgeBucket({
  label,
  value,
  current,
  count,
  total,
  accent,
  vendor,
}: {
  label: string;
  value: string;
  current: string;
  count: number;
  total: number;
  accent: string;
  vendor: string;
}) {
  const isActive = current === value;
  const params = new URLSearchParams();
  if (value) params.set("age", value);
  if (vendor) params.set("vendor", vendor);
  const href = `/accounts${params.toString() ? `?${params.toString()}` : ""}`;
  return (
    <Link
      href={href}
      style={{
        textDecoration: "none",
        padding: "10px 12px",
        background: isActive ? accent : "#fff",
        color: isActive ? "#fff" : "var(--text)",
        border: `1.5px solid ${isActive ? accent : ACCOUNTS_TOKENS.border}`,
        borderRadius: 10,
        display: "flex",
        flexDirection: "column",
        gap: 4,
        transition: "all 0.12s",
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          opacity: isActive ? 0.9 : 0.7,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: 18, fontWeight: 800, fontFamily: "ui-monospace, monospace", letterSpacing: "-0.01em" }}>
        {count}
      </span>
      <span
        style={{
          fontSize: 11,
          opacity: isActive ? 0.85 : 0.7,
          fontFamily: "ui-monospace, monospace",
        }}
      >
        ₹{total.toLocaleString("en-IN")}
      </span>
    </Link>
  );
}
