/**
 * Finance Analysis — the owner's whole-department view.
 *
 * Daksh (Aug 2026), for his dad: "he will be able to analyse the whole
 * finance department from there… and if we open any vendor, they can
 * see all info about it — how much paid, how much left, when paid."
 *
 * Strictly owner-Naresh + developer. Read-only: this page never
 * writes, so it can't disturb any live figure. Every query is
 * paginated (PostgREST silently caps an uncapped .select() at 1000
 * rows — that bug has bitten this codebase repeatedly).
 */

import { redirect } from "next/navigation";

import { requireAuth, getDefaultRouteForRole } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/paginate";

import { FinanceAnalysisClient } from "./analysis-client";
import type { VendorAnalysis, MonthPoint, HeadSlice } from "./analysis-client";
import type { PayMetaMap, VendorGroup } from "./recommend";

export const dynamic = "force-dynamic";

/** Bills that represent real money owed/spent. Pending-approval isn't a
 *  liability yet; rejected/cancelled never were. */
const LEDGER_STATUSES = ["approved", "fully_paid"];

type BillRow = {
  id: string;
  token: string | null;
  vendor_bill_no: string | null;
  bill_date: string | null;
  cost_head: string | null;
  status: string;
  amount_payable_to_vendor: number | null;
  amount_paid: number | null;
  amount_outstanding: number | null;
  /** Mig 072 — slice of outstanding the owner has deliberately
   *  withheld. The payment planner must never suggest paying it. */
  held_amount: number | null;
  held_reason: string | null;
  bill_vendor_id: string | null;
};

type PaymentRow = {
  id: string;
  bill_id: string | null;
  paid_amount: number | null;
  payment_method: string | null;
  paid_at: string | null;
};

type VendorRow = {
  id: string;
  name: string;
  /** The person behind the firm. Daksh: several owners run multiple
   *  firms, so dad searches by the man, not the letterhead. 202 of 304
   *  vendors carry one. */
  nickname: string | null;
  category: string | null;
  is_active: boolean | null;
  /** Credit period agreed with the vendor (262 of 304 have one,
   *  10–60d). The payment planner skips bills still inside it. */
  payment_terms_days: number | null;
};

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default async function FinanceAnalysisPage() {
  const { profile } = await requireAuth();
  // Same named-trusted-user convention the rest of the app uses
  // (cutting-permissions.ts, sidebar.tsx): match on the display name
  // so any spelling variant of the owner's account still resolves.
  const upperName = (profile.full_name ?? "").toUpperCase();
  const isAllowed =
    profile.role === "developer" ||
    (profile.role === "owner" && upperName.includes("NARESH"));
  if (!isAllowed) {
    redirect(getDefaultRouteForRole(profile.role));
  }

  const admin = createAdminSupabaseClient();

  const [bills, payments, vendors] = await Promise.all([
    fetchAllPaged<BillRow>((from, to) =>
      admin
        .from("bills")
        .select(
          "id, token, vendor_bill_no, bill_date, cost_head, status, amount_payable_to_vendor, amount_paid, amount_outstanding, held_amount, held_reason, bill_vendor_id",
        )
        .in("status", LEDGER_STATUSES)
        .order("id")
        .range(from, to),
    ),
    fetchAllPaged<PaymentRow>((from, to) =>
      admin
        .from("bill_payments")
        .select("id, bill_id, paid_amount, payment_method, paid_at")
        // Mig 219 — settlements never counted as "the vendor was paid".
        .eq("is_settlement", false)
        .order("id")
        .range(from, to),
    ),
    fetchAllPaged<VendorRow>((from, to) =>
      admin
        .from("bill_vendors")
        .select("id, name, nickname, category, is_active, payment_terms_days")
        .order("id")
        .range(from, to),
    ),
  ]);

  // ── Planner metadata (app_settings; absent = defaults) ───────────
  // Dad's mood/pressure dials + firm groups. Two tiny jsonb blobs —
  // see actions.ts for shape and why app_settings (no migration).
  const { data: settingRows } = await admin
    .from("app_settings")
    .select("key, value")
    .in("key", ["fa_vendor_meta", "fa_vendor_groups"]);
  let payMeta: PayMetaMap = {};
  let payGroups: VendorGroup[] = [];
  for (const r of settingRows ?? []) {
    if (r.key === "fa_vendor_meta" && r.value && typeof r.value === "object") {
      payMeta = r.value as PayMetaMap;
    }
    if (r.key === "fa_vendor_groups" && r.value && typeof r.value === "object") {
      const g = (r.value as { groups?: unknown }).groups;
      if (Array.isArray(g)) payGroups = g as VendorGroup[];
    }
  }

  const vendorById = new Map(vendors.map((v) => [v.id, v]));
  const billById = new Map(bills.map((b) => [b.id, b]));

  // ── Per-vendor rollup ───────────────────────────────────────────
  type Acc = VendorAnalysis;
  const accs = new Map<string, Acc>();

  function accFor(vid: string): Acc {
    let a = accs.get(vid);
    if (!a) {
      const v = vendorById.get(vid);
      a = {
        id: vid,
        name: v?.name ?? "(unknown vendor)",
        nickname: v?.nickname?.trim() || null,
        category: v?.category ?? null,
        isActive: v?.is_active !== false,
        termsDays: v?.payment_terms_days ?? null,
        billed: 0,
        paid: 0,
        outstanding: 0,
        held: 0,
        billCount: 0,
        openBillCount: 0,
        firstBillDate: null,
        lastPaymentDate: null,
        oldestOpenDate: null,
        bills: [],
        payments: [],
      };
      accs.set(vid, a);
    }
    return a;
  }

  for (const b of bills) {
    if (!b.bill_vendor_id) continue;
    const a = accFor(b.bill_vendor_id);
    const billed = Number(b.amount_payable_to_vendor) || 0;
    const paid = Number(b.amount_paid) || 0;
    const out = Number(b.amount_outstanding) || 0;
    // Hold is only meaningful against money still owed — a fully-paid
    // bill with a stale held_amount shouldn't count as held money.
    const held = Math.min(Math.max(Number(b.held_amount) || 0, 0), out);
    a.billed += billed;
    a.paid += paid;
    a.outstanding += out;
    a.held += held;
    a.billCount += 1;
    if (out > 0.5) {
      a.openBillCount += 1;
      if (b.bill_date && (!a.oldestOpenDate || b.bill_date < a.oldestOpenDate)) {
        a.oldestOpenDate = b.bill_date;
      }
    }
    if (b.bill_date && (!a.firstBillDate || b.bill_date < a.firstBillDate)) {
      a.firstBillDate = b.bill_date;
    }
    a.bills.push({
      id: b.id,
      token: b.token,
      billNo: b.vendor_bill_no,
      date: b.bill_date,
      costHead: b.cost_head,
      status: b.status,
      billed,
      paid,
      outstanding: out,
      held,
      heldReason: held > 0 ? (b.held_reason?.trim() || null) : null,
    });
  }

  // ── Payments: monthly trend + per-vendor timeline ────────────────
  const paidByMonth = new Map<string, number>();
  for (const p of payments) {
    const amt = Number(p.paid_amount) || 0;
    const when = p.paid_at ? p.paid_at.slice(0, 10) : null;
    if (when) {
      const mk = when.slice(0, 7); // YYYY-MM
      paidByMonth.set(mk, (paidByMonth.get(mk) ?? 0) + amt);
    }
    const bill = p.bill_id ? billById.get(p.bill_id) : undefined;
    if (!bill?.bill_vendor_id) continue;
    const a = accFor(bill.bill_vendor_id);
    a.payments.push({
      id: p.id,
      date: when,
      amount: amt,
      method: p.payment_method,
      billToken: bill.token,
    });
    if (when && (!a.lastPaymentDate || when > a.lastPaymentDate)) {
      a.lastPaymentDate = when;
    }
  }

  // Bills billed-per-month, to pair against paid-per-month.
  const billedByMonth = new Map<string, number>();
  for (const b of bills) {
    if (!b.bill_date) continue;
    const mk = b.bill_date.slice(0, 7);
    billedByMonth.set(
      mk,
      (billedByMonth.get(mk) ?? 0) + (Number(b.amount_payable_to_vendor) || 0),
    );
  }

  // Last 12 months ending this month (IST-ish — dates are stored as
  // plain YYYY-MM-DD so calendar maths is enough).
  const nowIso = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const curY = Number(nowIso.slice(0, 4));
  const curM = Number(nowIso.slice(5, 7));
  const months: MonthPoint[] = [];
  for (let i = 11; i >= 0; i--) {
    let y = curY;
    let m = curM - i;
    while (m <= 0) {
      m += 12;
      y -= 1;
    }
    const key = `${y}-${String(m).padStart(2, "0")}`;
    months.push({
      key,
      label: `${MON[m - 1]}`,
      year: y,
      paid: Math.round(paidByMonth.get(key) ?? 0),
      billed: Math.round(billedByMonth.get(key) ?? 0),
    });
  }

  // ── Cost-head split (of everything billed) ───────────────────────
  const headMap = new Map<string, number>();
  for (const b of bills) {
    const head = (b.cost_head || "unspecified").trim() || "unspecified";
    headMap.set(head, (headMap.get(head) ?? 0) + (Number(b.amount_payable_to_vendor) || 0));
  }
  const heads: HeadSlice[] = [...headMap.entries()]
    .map(([head, amount]) => ({ head, amount: Math.round(amount) }))
    .sort((a, b) => b.amount - a.amount);

  // ── Aging of what's still open ───────────────────────────────────
  const todayMs = Date.parse(`${nowIso}T00:00:00+05:30`);
  const aging = [
    { label: "0–30 days", amount: 0, count: 0 },
    { label: "31–60 days", amount: 0, count: 0 },
    { label: "61–90 days", amount: 0, count: 0 },
    { label: "90+ days", amount: 0, count: 0 },
  ];
  for (const b of bills) {
    const out = Number(b.amount_outstanding) || 0;
    if (out <= 0.5 || !b.bill_date) continue;
    const days = Math.floor(
      (todayMs - Date.parse(`${b.bill_date}T00:00:00+05:30`)) / 86400000,
    );
    const i = days <= 30 ? 0 : days <= 60 ? 1 : days <= 90 ? 2 : 3;
    aging[i].amount += out;
    aging[i].count += 1;
  }
  for (const a of aging) a.amount = Math.round(a.amount);

  // Biggest vendors first; each vendor's sub-lists sorted below.
  const vendorList = [...accs.values()];
  for (const v of vendorList) {
    // Bills oldest → newest (Daksh, Aug 2026): a vendor's ledger should
    // read like a passbook, so the oldest bill — usually the one still
    // unpaid — is the first thing you see.
    v.bills.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
    // Payments stay newest-first: "when did we last pay them" is the
    // question that list answers.
    v.payments.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
    v.billed = Math.round(v.billed);
    v.paid = Math.round(v.paid);
    v.outstanding = Math.round(v.outstanding);
    v.held = Math.round(v.held);
  }
  vendorList.sort((a, b) => b.outstanding - a.outstanding || b.billed - a.billed);

  const totals = vendorList.reduce(
    (acc, v) => ({
      billed: acc.billed + v.billed,
      paid: acc.paid + v.paid,
      outstanding: acc.outstanding + v.outstanding,
      bills: acc.bills + v.billCount,
    }),
    { billed: 0, paid: 0, outstanding: 0, bills: 0 },
  );

  return (
    <FinanceAnalysisClient
      vendors={vendorList}
      months={months}
      heads={heads}
      aging={aging}
      totals={totals}
      activeVendorCount={vendorList.filter((v) => v.outstanding > 0.5).length}
      generatedFor={profile.full_name ?? "Owner"}
      payMeta={payMeta}
      payGroups={payGroups}
    />
  );
}
