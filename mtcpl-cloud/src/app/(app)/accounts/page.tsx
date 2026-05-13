// Accounts landing — role-aware.
//
//   accountant  → due-bills dashboard (KPI cards + aging buckets + multi-select propose).
//   owner / dev → summary cards for both halves: audit queue + accountant dashboard.
//   biller      → redirected to /accounts/bills/new (their primary action).
//
// The dashboard query is bounded — we only pull `approved` bills with
// outstanding > 0 (the partial index `bills_due_idx` covers this).

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

type SearchParams = Promise<{ vendor?: string; age?: string }>;

export default async function AccountsHomePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { profile } = await requireAuth();
  // Biller routes here from getDefaultRouteForRole would be /accounts/bills/new
  // already. If a biller ever hits /accounts directly, bounce them.
  if (profile.role === "biller") {
    redirect("/accounts/bills/new");
  }

  // Only roles that should see the dashboard:
  if (
    profile.role !== "developer" &&
    profile.role !== "owner" &&
    profile.role !== "accountant"
  ) {
    redirect("/accounts/bills");
  }

  const sp = await searchParams;
  const vendorFilter = sp.vendor ?? "";
  const ageFilter = sp.age ?? ""; // '0_30' | '31_60' | '61_90' | '90_plus'

  const supabase = createAdminSupabaseClient();

  // Active vendors for the filter dropdown
  const { data: vendorRows } = await supabase
    .from("bill_vendors")
    .select("id, name")
    .eq("is_active", true)
    .order("name");
  const vendors = (vendorRows ?? []) as Array<{ id: string; name: string }>;

  // Due bills — all `approved` with outstanding > 0.
  let dueQuery = supabase
    .from("bills")
    .select(
      "id, token, vendor_bill_no, bill_date, description, cost_head, amount_total, amount_paid, amount_outstanding, status, bill_vendor_id, bill_vendors(id, name)",
    )
    .eq("status", "approved")
    .gt("amount_outstanding", 0)
    .order("bill_date", { ascending: true })
    .limit(1000);
  if (vendorFilter) dueQuery = dueQuery.eq("bill_vendor_id", vendorFilter);

  const { data: dueRaw, error } = await dueQuery;
  if (error) throw new Error(error.message);

  // Bills already in an open payment (proposed / confirmed) — hidden
  // from the propose-multi-select so the accountant can't double-stage.
  const billIds = (dueRaw ?? []).map((b) => b.id as string);
  const openPaymentBillIds = new Set<string>();
  if (billIds.length > 0) {
    const { data: openPayments } = await supabase
      .from("bill_payments")
      .select("bill_id")
      .in("bill_id", billIds)
      .in("status", ["proposed", "confirmed"]);
    for (const p of openPayments ?? []) openPaymentBillIds.add(p.bill_id as string);
  }

  type DbRow = {
    id: string;
    token: string;
    vendor_bill_no: string;
    bill_date: string;
    description: string;
    cost_head: string | null;
    amount_total: number;
    amount_paid: number;
    amount_outstanding: number;
    bill_vendor_id: string;
    bill_vendors:
      | { id: string; name: string }
      | { id: string; name: string }[]
      | null;
  };
  const dueRows = ((dueRaw ?? []) as unknown) as DbRow[];

  const todayMs = Date.now();
  function bucketFor(dateStr: string): "0_30" | "31_60" | "61_90" | "90_plus" {
    const d = new Date(dateStr).getTime();
    const days = Math.floor((todayMs - d) / 86_400_000);
    if (days <= 30) return "0_30";
    if (days <= 60) return "31_60";
    if (days <= 90) return "61_90";
    return "90_plus";
  }

  const allDue: DueBillRow[] = dueRows.map((r) => {
    const v = Array.isArray(r.bill_vendors) ? r.bill_vendors[0] ?? null : r.bill_vendors;
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
      amountPaid: Number(r.amount_paid),
      amountOutstanding: Number(r.amount_outstanding),
      ageBucket: bucketFor(r.bill_date),
      hasOpenPayment: openPaymentBillIds.has(r.id),
    };
  });

  // Filter by age bucket if requested
  const filteredDue = ageFilter
    ? allDue.filter((b) => b.ageBucket === ageFilter)
    : allDue;

  // KPI rollups (over the visible-scope `allDue`, ignoring vendor + age filters
  // would lie about "Total outstanding" — instead let the filters narrow the
  // KPI cards too so they always agree with the table below.)
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

  // Aging bucket counts (always over allDue regardless of age filter so the
  // tabs themselves stay accurate).
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

  const isApprover = canApproveBills(profile);
  const isAccountManager = canManageAccounts(profile);

  return (
    <section className="page-card">
      <div className="record-head">
        <div>
          <h1>{profile.role === "accountant" ? "Due bills" : "Accounts"}</h1>
          <p className="muted">
            {profile.role === "accountant"
              ? "Approved bills awaiting payment. Pick rows to propose for today's run."
              : "Finance overview. Use the cards to jump into the audit queue or the payment workflow."}
          </p>
        </div>
        {isApprover && (
          <Link
            href="/accounts/approvals"
            style={{
              textDecoration: "none",
              fontSize: 13,
              padding: "8px 16px",
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              color: "var(--text)",
              fontWeight: 600,
              whiteSpace: "nowrap",
              alignSelf: "flex-start",
            }}
          >
            ✓ Bills Audit →
          </Link>
        )}
      </div>

      {/* KPI cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
          marginTop: 18,
        }}
      >
        <KpiCard
          label="Total outstanding"
          value={`₹${totalOutstanding.toLocaleString("en-IN")}`}
          tone="#b45309"
        />
        <KpiCard label="Due bills" value={String(billsCount)} tone="var(--gold-dark)" />
        <KpiCard label="Avg days outstanding" value={`${avgDaysOutstanding}d`} tone="#0f766e" />
        <KpiCard
          label="Top vendor by outstanding"
          value={
            topVendor
              ? `${topVendor.name} · ₹${topVendor.total.toLocaleString("en-IN")}`
              : "—"
          }
          tone="#7c3aed"
        />
      </div>

      {/* Aging buckets */}
      <div
        style={{
          marginTop: 16,
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <AgeChip
          label="All"
          value=""
          current={ageFilter}
          count={allDue.length}
          total={allDue.reduce((s, b) => s + b.amountOutstanding, 0)}
          tint="var(--gold-dark)"
          vendor={vendorFilter}
        />
        <AgeChip
          label="0–30 days"
          value="0_30"
          current={ageFilter}
          count={bucketCounts["0_30"]}
          total={bucketTotals["0_30"]}
          tint="#15803d"
          vendor={vendorFilter}
        />
        <AgeChip
          label="31–60"
          value="31_60"
          current={ageFilter}
          count={bucketCounts["31_60"]}
          total={bucketTotals["31_60"]}
          tint="#b45309"
          vendor={vendorFilter}
        />
        <AgeChip
          label="61–90"
          value="61_90"
          current={ageFilter}
          count={bucketCounts["61_90"]}
          total={bucketTotals["61_90"]}
          tint="#dc2626"
          vendor={vendorFilter}
        />
        <AgeChip
          label="90+ days"
          value="90_plus"
          current={ageFilter}
          count={bucketCounts["90_plus"]}
          total={bucketTotals["90_plus"]}
          tint="#7f1d1d"
          vendor={vendorFilter}
        />

        <form method="GET" style={{ marginLeft: "auto", display: "inline-flex", gap: 6 }}>
          {ageFilter && <input type="hidden" name="age" value={ageFilter} />}
          <select
            name="vendor"
            defaultValue={vendorFilter}
            style={{
              padding: "5px 10px",
              fontSize: 12,
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              color: "var(--text)",
            }}
          >
            <option value="">All vendors</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            style={{
              padding: "5px 10px",
              fontSize: 12,
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              cursor: "pointer",
              color: "var(--text)",
            }}
          >
            Filter
          </button>
        </form>
      </div>

      {/* Multi-select propose table */}
      <div style={{ marginTop: 18 }}>
        <DueBillsClient
          rows={filteredDue}
          canPropose={isAccountManager}
          proposeAction={proposePaymentsAction}
        />
      </div>
    </section>
  );
}

function KpiCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: string;
}) {
  return (
    <div
      style={{
        padding: "12px 14px",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderLeft: `4px solid ${tone}`,
        borderRadius: 8,
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 18,
          fontWeight: 800,
          color: tone,
          marginTop: 4,
          fontFamily: "ui-monospace, monospace",
          wordBreak: "break-word",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function AgeChip({
  label,
  value,
  current,
  count,
  total,
  tint,
  vendor,
}: {
  label: string;
  value: string;
  current: string;
  count: number;
  total: number;
  tint: string;
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
        padding: "8px 14px",
        background: isActive ? tint : "var(--bg)",
        color: isActive ? "#fff" : "var(--text)",
        border: `1.5px solid ${isActive ? tint : "var(--border)"}`,
        borderRadius: 8,
        display: "flex",
        flexDirection: "column",
        gap: 2,
        minWidth: 120,
      }}
    >
      <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {label}
      </span>
      <span style={{ fontSize: 15, fontWeight: 800, fontFamily: "ui-monospace, monospace" }}>
        {count}
      </span>
      <span style={{ fontSize: 10, opacity: 0.85, fontFamily: "ui-monospace, monospace" }}>
        ₹{total.toLocaleString("en-IN")}
      </span>
    </Link>
  );
}
