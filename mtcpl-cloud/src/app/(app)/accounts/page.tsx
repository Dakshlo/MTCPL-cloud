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
import {
  PeekButton,
  PeekProvider,
  PeekValue,
} from "./_ui/sensitive-peek";
// Mig 061 follow-on (Daksh): category filter helpers — only one
// usage remained after the live-filters refactor (the age-bucket
// "Block Purchase" label lookup on the bucket-tile row). The
// dropdown options moved into LiveDueBillsFilters.
import { billVendorCategoryDisplay } from "@/lib/bill-vendor-categories";
import { LiveDueBillsFilters } from "./live-due-bills-filters";

type SearchParams = Promise<{
  vendor?: string;
  age?: string;
  // Mig 042 follow-on — Daksh: "give search with token no. on due
  // bill. and also user can choose date from to for due page."
  token?: string;
  date_from?: string;
  date_to?: string;
  // Mig 061 follow-on (Daksh): category filter so dad can see
  // outstanding sliced by raw material / equipment / jobwork / etc.
  category?: string;
  // Daksh May 2026 — comma-separated bill IDs that the accountant
  // currently has ticked. Pushed into the URL by dashboard-client
  // whenever the selection set changes (also rehydrated from
  // sessionStorage on mount). The server fires a supplementary
  // query for any of these IDs missing from the filtered result
  // and merges them in so the pinned-to-top logic in the client
  // can always render them — even when the current filter would
  // otherwise hide them.
  selected?: string;
}>;

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
  const tokenFilter = (sp.token ?? "").trim();
  const dateFromFilter = (sp.date_from ?? "").trim();
  const dateToFilter = (sp.date_to ?? "").trim();
  const categoryFilter = (sp.category ?? "").trim();
  // Daksh May 2026 — pinned-bill IDs the accountant has ticked.
  // Parsed from comma-separated `?selected=` URL param (client keeps
  // it in sync with sessionStorage). Used at the bottom of the page
  // logic to supplement the filtered query so a ticked bill is
  // never silently filtered out of view.
  const selectedIds = (sp.selected ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

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
      "id, token, vendor_bill_no, bill_date, description, cost_head, amount_total, amount_gst, amount_tds, amount_tcs, amount_payable_to_vendor, amount_paid, amount_outstanding, status, approved_at, bill_vendor_id, bill_vendors(id, name, nickname, payment_terms_days, category)",
    )
    .eq("status", "approved")
    .gt("amount_outstanding", 0)
    .order("bill_date", { ascending: true })
    .limit(1000);
  if (vendorFilter) dueQuery = dueQuery.eq("bill_vendor_id", vendorFilter);
  // Mig 042 follow-on — token substring search + bill-date range.
  // Token uses ilike with surrounding wildcards so partial entries
  // ("2026" or "T-2026-1") all hit. Date range is inclusive on both
  // ends.
  if (tokenFilter) {
    // Escape % and _ so users can search for literal characters
    const escaped = tokenFilter.replace(/[%_]/g, (m) => `\\${m}`);
    dueQuery = dueQuery.ilike("token", `%${escaped}%`);
  }
  if (dateFromFilter) dueQuery = dueQuery.gte("bill_date", dateFromFilter);
  if (dateToFilter) dueQuery = dueQuery.lte("bill_date", dateToFilter);

  const { data: dueRaw, error } = await dueQuery;
  if (error) throw new Error(error.message);

  // Daksh May 2026 — supplementary query for selected (ticked) bills
  // the user wants pinned. Any IDs in ?selected= that are NOT already
  // in dueRaw (because the current filter excludes them) get a
  // separate fetch and are merged in. The pinned-to-top render
  // logic in dashboard-client then surfaces them above the rest.
  // Skip the query entirely when nothing's selected or every
  // selected ID is already in dueRaw.
  let dueRawWithSelected = dueRaw ?? [];
  if (selectedIds.length > 0) {
    const existingIds = new Set(dueRawWithSelected.map((b) => b.id as string));
    const missingIds = selectedIds.filter((id) => !existingIds.has(id));
    if (missingIds.length > 0) {
      const { data: missingRows } = await supabase
        .from("bills")
        .select(
          "id, token, vendor_bill_no, bill_date, description, cost_head, amount_total, amount_gst, amount_tds, amount_tcs, amount_payable_to_vendor, amount_paid, amount_outstanding, status, approved_at, bill_vendor_id, bill_vendors(id, name, nickname, payment_terms_days, category)",
        )
        // Same gates as the main query — a ticked bill that's been
        // since paid in full / cancelled shouldn't re-surface.
        .eq("status", "approved")
        .gt("amount_outstanding", 0)
        .in("id", missingIds);
      if (missingRows && missingRows.length > 0) {
        dueRawWithSelected = [...dueRawWithSelected, ...missingRows];
      }
    }
  }

  const billIds = dueRawWithSelected.map((b) => b.id as string);
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
      | { id: string; name: string; nickname: string | null; payment_terms_days: number | null; category: string | null }
      | { id: string; name: string; nickname: string | null; payment_terms_days: number | null; category: string | null }[]
      | null;
  };
  // Use the merged set (filtered query + supplementary "selected"
  // pins) so the downstream allDue map renders both groups.
  const dueRows = (dueRawWithSelected as unknown) as DbRow[];

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

  // Mig 064 follow-on (Daksh) — batch-fetch each vendor's approved
  // royalty net (paid − received) so the dashboard can render a
  // peek dot on every row next to the age pill. Only fired for
  // roles that can see royalty data; everyone else gets null per
  // row and the dot doesn't render. One round-trip for the whole
  // page (capped at the vendors actually showing up in dueRows).
  const canSeeRoyaltyNet =
    profile.role === "developer" ||
    profile.role === "owner" ||
    profile.role === "accountant" ||
    profile.role === "accountant_star" ||
    profile.role === "crosscheck";
  const royaltyNetByVendor = new Map<string, number>();
  if (canSeeRoyaltyNet) {
    const vendorIds = [...new Set(dueRows.map((r) => r.bill_vendor_id))];
    if (vendorIds.length > 0) {
      const { data: royaltyRows, error: royaltyErr } = await supabase
        .from("vendor_royalty_entries")
        .select("bill_vendor_id, amount, entry_type")
        .in("bill_vendor_id", vendorIds)
        .eq("status", "approved")
        .is("cancelled_at", null);
      if (!royaltyErr && royaltyRows) {
        // paid − received per vendor; matches the modal's formula.
        const received = new Map<string, number>();
        const paid = new Map<string, number>();
        for (const r of royaltyRows as Array<{
          bill_vendor_id: string;
          amount: number;
          entry_type: string;
        }>) {
          const amt = Number(r.amount ?? 0);
          const m = r.entry_type === "received" ? received : paid;
          m.set(r.bill_vendor_id, (m.get(r.bill_vendor_id) ?? 0) + amt);
        }
        for (const vid of vendorIds) {
          royaltyNetByVendor.set(
            vid,
            (paid.get(vid) ?? 0) - (received.get(vid) ?? 0),
          );
        }
      }
    }
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
      vendorNickname: v?.nickname ?? null,
      vendorCategory: v?.category ?? null,
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
      vendorRoyaltyNet: canSeeRoyaltyNet
        ? royaltyNetByVendor.get(r.bill_vendor_id) ?? 0
        : null,
    };
  });

  // Mig 061 follow-on (Daksh) — category filter applies BEFORE the
  // age-bucket filter so the bucket totals shown in the aging strip
  // reflect the selected category only. (When a user picks "Repair
  // & Maintenance" they want every aging tile to scope to that
  // category too.)
  //
  // Daksh May 2026 follow-on — selected (pinned) bill IDs are
  // EXEMPT from both client-side filters. The server's supplementary
  // query already pulled them into allDue regardless of vendor /
  // date / token filters; without this exemption, picking a Category
  // (client-side filter) would silently drop them again. Same for
  // an age-bucket tile click. The pin-on-top logic in
  // dashboard-client then surfaces them above the rest.
  const pinnedIdSet = new Set(selectedIds);
  const categoryFilteredDue = categoryFilter
    ? allDue.filter(
        (b) => pinnedIdSet.has(b.id) || b.vendorCategory === categoryFilter,
      )
    : allDue;
  const filteredDue = ageFilter
    ? categoryFilteredDue.filter(
        (b) => pinnedIdSet.has(b.id) || b.ageBucket === ageFilter,
      )
    : categoryFilteredDue;

  // Daksh May 2026 — totals + bucket counts use the STRICT filtered
  // set (no pinned-bill exemption) so the headline numbers always
  // reflect what the filter says, never inflated by a Vendor-A bill
  // that's only on screen because it was pinned. The `filteredDue`
  // set above is the DISPLAY set (with pinned exempted) — used only
  // for the row list passed to DueBillsClient.
  const strictCategoryFilteredDue = categoryFilter
    ? allDue.filter((b) => b.vendorCategory === categoryFilter)
    : allDue;
  const strictFilteredDue = ageFilter
    ? strictCategoryFilteredDue.filter((b) => b.ageBucket === ageFilter)
    : strictCategoryFilteredDue;

  const totalOutstanding = strictFilteredDue.reduce((s, b) => s + b.amountOutstanding, 0);
  const billsCount = strictFilteredDue.length;
  const avgDaysOutstanding =
    strictFilteredDue.length === 0
      ? 0
      : Math.round(
          strictFilteredDue.reduce(
            (s, b) => s + Math.floor((todayMs - new Date(b.billDate).getTime()) / 86_400_000),
            0,
          ) / strictFilteredDue.length,
        );
  const topVendor = (() => {
    const totals = new Map<string, { name: string; total: number }>();
    for (const b of strictFilteredDue) {
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

  // Bucket counts/totals respect the category filter so the aging
  // strip stays meaningful when a category is selected (mig 061).
  // Use the strict (no-pin) set so a pinned 90+ bill doesn't inflate
  // the 0-30 bucket when you filter to 0-30.
  const strictCategoryOnly = categoryFilter
    ? allDue.filter((b) => b.vendorCategory === categoryFilter)
    : allDue;
  const bucketCounts = {
    "0_30": strictCategoryOnly.filter((b) => b.ageBucket === "0_30").length,
    "31_60": strictCategoryOnly.filter((b) => b.ageBucket === "31_60").length,
    "61_90": strictCategoryOnly.filter((b) => b.ageBucket === "61_90").length,
    "90_plus": strictCategoryOnly.filter((b) => b.ageBucket === "90_plus").length,
  };
  const bucketTotals = {
    "0_30": strictCategoryOnly.filter((b) => b.ageBucket === "0_30").reduce((s, b) => s + b.amountOutstanding, 0),
    "31_60": strictCategoryOnly.filter((b) => b.ageBucket === "31_60").reduce((s, b) => s + b.amountOutstanding, 0),
    "61_90": strictCategoryOnly.filter((b) => b.ageBucket === "61_90").reduce((s, b) => s + b.amountOutstanding, 0),
    "90_plus": strictCategoryOnly.filter((b) => b.ageBucket === "90_plus").reduce((s, b) => s + b.amountOutstanding, 0),
  };
  const grandTotal = strictCategoryOnly.reduce((s, b) => s + b.amountOutstanding, 0) || 1;

  const isApprover = canApproveBills(profile);
  const isAccountManager = canManageAccounts(profile);
  // Mig 064 follow-on (Daksh): the per-bucket ₹ totals under the
  // aging strip read like "company cash position by age" at a
  // glance. Restrict to dev / owner; everyone else sees only the
  // bill COUNT per bucket (no rupee line).
  const canSeeBucketTotals =
    profile.role === "developer" || profile.role === "owner";

  return (
    <section className="page-card">
      {/* Mig 058 follow-on (Daksh) — Due Bills KPIs reveal a lot:
          total outstanding + top vendor outstanding combined are
          enough to read the company's cash position at a glance.
          Wrapped in PeekProvider so both sensitive amounts blur by
          default. A "👁 Peek for 5s" button sits in the hero
          actions; one click unblurs both for 5 seconds. */}
      <PeekProvider>
      <AccountsHero
        title={profile.role === "accountant" ? "Due Bills" : "Accounts"}
        description={
          profile.role === "accountant"
            ? "Approved bills awaiting payment. Pick rows to propose for today's run."
            : "Finance overview. Audit fresh bills and queue today's payment batch."
        }
        actions={
          <>
            {/* Mig 061 follow-on (Daksh): the Peek button reveals
                the blurred sensitive amounts for 5s. Restricted to
                owner + developer — accountants see the blur but
                can't unblur on screen. They can still drill into a
                specific row if they need the number. */}
            {(profile.role === "developer" || profile.role === "owner") && (
              <PeekButton />
            )}
            <Link href="/accounts/pay-today" style={BUTTON_STYLES.secondary}>
              💸 Pay Today
            </Link>
          </>
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
          value={
            <PeekValue>
              <Money value={totalOutstanding} size="hero" tone={totalOutstanding > 0 ? "danger" : "muted"} />
            </PeekValue>
          }
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
              <PeekValue>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 4, lineHeight: 1.2, wordBreak: "break-word" }}>
                    {topVendor.name}
                  </div>
                  <Money value={topVendor.total} size="large" tone="warning" />
                </div>
              </PeekValue>
            ) : (
              <span style={{ fontSize: 18, color: "var(--muted)", fontWeight: 600 }}>—</span>
            )
          }
          tone="warning"
          icon="🏢"
        />
      </div>
      </PeekProvider>

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
                  title={
                    canSeeBucketTotals
                      ? `${b.replace("_", "–").replace("plus", "+")} days · ₹${bucketTotals[b].toLocaleString("en-IN")}`
                      : `${b.replace("_", "–").replace("plus", "+")} days`
                  }
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
              total={canSeeBucketTotals ? allDue.reduce((s, b) => s + b.amountOutstanding, 0) : null}
              accent={ACCOUNTS_TOKENS.accent}
              vendor={vendorFilter}
              token={tokenFilter}
              dateFrom={dateFromFilter}
              dateTo={dateToFilter}
            />
            <AgeBucket
              label="0–30 days"
              value="0_30"
              current={ageFilter}
              count={bucketCounts["0_30"]}
              total={canSeeBucketTotals ? bucketTotals["0_30"] : null}
              accent={ACCOUNTS_TOKENS.success}
              vendor={vendorFilter}
              token={tokenFilter}
              dateFrom={dateFromFilter}
              dateTo={dateToFilter}
            />
            <AgeBucket
              label="31–60 days"
              value="31_60"
              current={ageFilter}
              count={bucketCounts["31_60"]}
              total={canSeeBucketTotals ? bucketTotals["31_60"] : null}
              accent="#f59e0b"
              vendor={vendorFilter}
              token={tokenFilter}
              dateFrom={dateFromFilter}
              dateTo={dateToFilter}
            />
            <AgeBucket
              label="61–90 days"
              value="61_90"
              current={ageFilter}
              count={bucketCounts["61_90"]}
              total={canSeeBucketTotals ? bucketTotals["61_90"] : null}
              accent="#ea580c"
              vendor={vendorFilter}
              token={tokenFilter}
              dateFrom={dateFromFilter}
              dateTo={dateToFilter}
            />
            <AgeBucket
              label="90+ days"
              value="90_plus"
              current={ageFilter}
              count={bucketCounts["90_plus"]}
              total={canSeeBucketTotals ? bucketTotals["90_plus"] : null}
              accent={ACCOUNTS_TOKENS.danger}
              vendor={vendorFilter}
              token={tokenFilter}
              dateFrom={dateFromFilter}
              dateTo={dateToFilter}
            />
          </div>
        </div>
      )}

      {/* Daksh May 2026 — filter strip is now LIVE (no Apply button).
          Each control auto-pushes the new URL via router.replace on
          change so the bill list refreshes instantly. Selection
          state is persisted in sessionStorage by dashboard-client
          so the reload doesn't unselect already-ticked bills. The
          old <form method="GET"> + Apply button pattern lives in
          git history. */}
      <LiveDueBillsFilters
        vendors={vendors}
        initialToken={tokenFilter}
        initialVendor={vendorFilter}
        initialCategory={categoryFilter}
        initialDateFrom={dateFromFilter}
        initialDateTo={dateToFilter}
        initialAge={ageFilter}
        tokens={{
          borderStrong: ACCOUNTS_TOKENS.borderStrong,
          border: ACCOUNTS_TOKENS.border,
          shadow: ACCOUNTS_TOKENS.shadow,
          surface: "var(--surface, #fff)",
        }}
      />

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
  token,
  dateFrom,
  dateTo,
}: {
  label: string;
  value: string;
  current: string;
  count: number;
  /** Mig 064 follow-on (Daksh): hide the per-bucket ₹ total for
   *  non dev/owner roles. Pass null to skip the rupee line; pass
   *  a number to render it. */
  total: number | null;
  accent: string;
  vendor: string;
  // Mig 042 follow-on — bucket links now preserve token + date
  // range filters too, so the user can narrow by token and click
  // a bucket without losing their search.
  token: string;
  dateFrom: string;
  dateTo: string;
}) {
  const isActive = current === value;
  const params = new URLSearchParams();
  if (value) params.set("age", value);
  if (vendor) params.set("vendor", vendor);
  if (token) params.set("token", token);
  if (dateFrom) params.set("date_from", dateFrom);
  if (dateTo) params.set("date_to", dateTo);
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
      {total !== null && (
        <span
          style={{
            fontSize: 11,
            opacity: isActive ? 0.85 : 0.7,
            fontFamily: "ui-monospace, monospace",
          }}
        >
          ₹{total.toLocaleString("en-IN")}
        </span>
      )}
    </Link>
  );
}
