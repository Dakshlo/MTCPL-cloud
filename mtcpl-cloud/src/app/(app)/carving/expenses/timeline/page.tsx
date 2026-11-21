/**
 * A year of CNC expense entry, at a glance — where the holes are.
 *
 * Daksh, Nov 2026: "this expenses entry page is good, but it's hard to
 * find out if the team misses entry of any expense of any month. And if
 * they miss, data will be not real. So add a button — see expenses in
 * timeline. It will open a page where we see expense year-wise: 2026,
 * months Jan to December left to right, each month a dot. If any month
 * data missing, no dot."
 *
 * ── Why a dot is not enough on its own ────────────────────────────
 *
 * Because an empty month means two completely different things, and
 * the live data shows both:
 *
 *   MANTHAN entered maintenance in Jun, Jul, Aug and Sep — and not in
 *   October, a month where he DID enter tools and labour. That is a
 *   hole in the middle of something he plainly does every month.
 *
 *   VIVEK has never entered maintenance at all, in any month. That is
 *   not a miss. Painting it the same red as Manthan's October would
 *   cry wolf five times a year and the page would stop being read.
 *
 * So an empty cell is only called a MISS when two things are both
 * true: this lane has been filled at least once this year, and the
 * vendor entered something else in that same month — so somebody sat
 * down to do that month and left this one out. Everything else that is
 * empty just reads as empty.
 *
 * The number at the top counts only the misses. A page that says "17
 * blanks" when 14 of them are normal is a page nobody opens twice.
 *
 * ── The live month is not a miss ──────────────────────────────────
 *
 * Entries land at month end. November sitting empty on the 21st is not
 * a failure, so the current month gets its own mark — still open —
 * rather than being counted against anybody.
 *
 * ── Who appears ───────────────────────────────────────────────────
 *
 * "No need of Alkesh." True, and the reason is worth encoding rather
 * than his name: Alkesh has no CNC machines assigned, which is also
 * exactly why he has no row in the per-vendor costing breakdown. So
 * the rule is "vendors with machines" — Mohit 23, Manthan 17, Vivek 7,
 * Alkesh 0 — and it keeps working when the shed changes hands.
 *
 * He does have three maintenance rows from September, though, and
 * silently dropping money off a page about missing money would be its
 * own kind of lie. Anybody hidden who has spend is named underneath.
 *
 * CNC only. Daksh: "for now make only for CNC costing, not cutter."
 */

import { redirect } from "next/navigation";

import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canEnterCncExpenses } from "@/lib/expenses-permissions";

import { ExpenseTimelineClient, type TimelineVendor, type LaneKey } from "./timeline-client";

export const dynamic = "force-dynamic";

type Search = Promise<{ year?: string }>;

/** The three the costing table now prints a ₹/unit for, in the order it
 *  prints them. Electricity is plant-wide and gets its own lane; office
 *  and other are occasional by nature and would only add noise. */
const LANES: { key: LaneKey; label: string }[] = [
  { key: "tools", label: "Tools" },
  { key: "maintenance", label: "Maintenance" },
  { key: "labor", label: "Labour" },
];

function istNow(): { year: number; month: number } {
  const d = new Date(Date.now() + 5.5 * 3_600_000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

export default async function CncExpenseTimelinePage({ searchParams }: { searchParams: Search }) {
  const { profile } = await requireAuth();
  if (!canEnterCncExpenses(profile)) redirect("/");

  const sp = await searchParams;
  const now = istNow();
  const year = Math.min(2100, Math.max(2020, Number(sp.year) || now.year));

  const admin = createAdminSupabaseClient();

  // Vendors that actually run machines — see the note above.
  const [{ data: vendorsRaw }, { data: machinesRaw }] = await Promise.all([
    admin.from("vendors").select("id, name").eq("vendor_type", "CNC").order("name"),
    admin.from("cnc_machines").select("vendor_id"),
  ]);

  const machineCount = new Map<string, number>();
  for (const m of (machinesRaw ?? []) as Array<{ vendor_id: string | null }>) {
    if (m.vendor_id) machineCount.set(m.vendor_id, (machineCount.get(m.vendor_id) ?? 0) + 1);
  }

  const allVendors = (vendorsRaw ?? []) as Array<{ id: string; name: string }>;

  const [{ data: expRaw }, { data: elecRaw }] = await Promise.all([
    admin
      .from("cnc_vendor_expenses")
      .select("vendor_id, month, category, amount")
      .eq("year", year)
      .is("cancelled_at", null),
    admin
      .from("cnc_plant_electricity")
      .select("month, amount")
      .eq("year", year)
      .is("cancelled_at", null),
  ]);

  const exp = (expRaw ?? []) as Array<{
    vendor_id: string; month: number; category: string; amount: number | string;
  }>;

  // vendor → lane → month → total. Built once rather than filtered per
  // cell: twelve months by three lanes by three vendors is 108 lookups
  // a render, and a Map makes every one of them free.
  const money = new Map<string, number>();
  const anyEntryThatMonth = new Map<string, boolean>();
  const key = (v: string, l: string, m: number) => `${v}|${l}|${m}`;

  for (const e of exp) {
    const amt = Number(e.amount ?? 0);
    const k = key(e.vendor_id, e.category, e.month);
    money.set(k, (money.get(k) ?? 0) + amt);
    anyEntryThatMonth.set(`${e.vendor_id}|${e.month}`, true);
  }

  const shown = allVendors.filter((v) => (machineCount.get(v.id) ?? 0) > 0);

  // Anybody with spend but no machines: named, not dropped in silence.
  const hiddenWithSpend = allVendors
    .filter((v) => (machineCount.get(v.id) ?? 0) === 0)
    .filter((v) => exp.some((e) => e.vendor_id === v.id))
    .map((v) => v.name);

  const vendors: TimelineVendor[] = shown.map((v) => ({
    id: v.id,
    name: v.name,
    machines: machineCount.get(v.id) ?? 0,
    lanes: LANES.map((lane) => {
      const filledMonths = exp
        .filter((e) => e.vendor_id === v.id && e.category === lane.key)
        .map((e) => e.month);
      const everFilled = filledMonths.length > 0;
      /**
       * A lane does not exist before the first time it was used, and
       * that boundary is load-bearing.
       *
       * The first version only asked "did this vendor enter ANYTHING
       * that month", and the live data broke it immediately: Manthan
       * has a single stray ₹5,000 electricity row in April, two months
       * before he starts recording anything else. That one row made
       * April look like three separate failures — tools, maintenance
       * AND labour — on a vendor who had not begun. Three false alarms
       * from one stray entry is how a page like this gets ignored.
       *
       * From his first real entry onward the question is fair, and
       * stays fair after a lane stops: Manthan kept maintenance from
       * June to September and then filed tools and labour for October
       * without it, which IS the thing worth asking about.
       */
      const firstFilled = everFilled ? Math.min(...filledMonths) : 0;
      return {
        key: lane.key,
        label: lane.label,
        everFilled,
        months: Array.from({ length: 12 }, (_, i) => {
          const m = i + 1;
          const amount = money.get(key(v.id, lane.key, m)) ?? 0;
          return {
            month: m,
            amount,
            // The one judgement on this page, made here so the screen
            // only has to draw it: this lane had started, somebody sat
            // down and did this month for this vendor, and this line
            // was left out of it.
            missed:
              amount === 0 &&
              everFilled &&
              m >= firstFilled &&
              !!anyEntryThatMonth.get(`${v.id}|${m}`),
          };
        }),
      };
    }),
  }));

  const elecByMonth = new Map<number, number>();
  for (const r of (elecRaw ?? []) as Array<{ month: number; amount: number | string }>) {
    elecByMonth.set(r.month, (elecByMonth.get(r.month) ?? 0) + Number(r.amount ?? 0));
  }
  /** The plant's own bill — one row a month, plant-wide, and just as
   *  easy to forget as a vendor's. Not asked for; it is on the same
   *  page and carries the same risk. */
  const plantElectricity = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    amount: elecByMonth.get(i + 1) ?? 0,
  }));

  return (
    <ExpenseTimelineClient
      year={year}
      currentYear={now.year}
      currentMonth={now.month}
      vendors={vendors}
      plantElectricity={plantElectricity}
      hiddenWithSpend={hiddenWithSpend}
    />
  );
}
