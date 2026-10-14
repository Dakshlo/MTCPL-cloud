// ──────────────────────────────────────────────────────────────────
// Which CNC is pulling its weight (Daksh's dad, Oct 2026).
//
// "He wants to see most productive CNC from top to bottom, maybe last
//  7 days, 1 month — so he can have an idea if the same kind of machine
//  is doing less, then we can find the root cause."
//
// That last clause is the whole design. A plain league table of job
// counts would put every lathe at the bottom and tell him nothing, so
// machines are ranked WITHIN their own type and each one is measured
// against the median of its own kind. "Doing less" then means less than
// the machines it should match, not less than the biggest machine.
//
// Three numbers per machine, because one does not explain anything:
//
//   jobs        pieces taken off the machine in the period
//   hours run   how long it was actually cutting, clipped to the period
//   hrs / job   how long each piece took
//
// Those three separate the two reasons a machine falls behind, which
// need completely different fixes: FEW HOURS means it sat idle (no work
// queued, operator absent, breakdown), while HIGH HOURS/JOB means it ran
// all week and was slow (blunt tool, hard stone, heavy design, a fault).
// The screen shows both so nobody has to guess which one it is.
//
// Attribution: `completed_on_cnc_machine_id` is the field that matters.
// `cnc_machine_id` is cleared when a job comes off the machine, so it is
// null for every finished job — checked on the live data, 745/745.
// ──────────────────────────────────────────────────────────────────

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/paginate";

export const PERIODS = [
  { key: "7d", label: "Last 7 days", days: 7 },
  { key: "30d", label: "Last 30 days", days: 30 },
  { key: "90d", label: "Last 90 days", days: 90 },
] as const;
export type PeriodKey = (typeof PERIODS)[number]["key"];

export function periodDays(key: string): number {
  return PERIODS.find((p) => p.key === key)?.days ?? 7;
}

/** Human name for a machine_type column value. */
export const MACHINE_TYPE_LABEL: Record<string, string> = {
  multi_head_2: "Multi-head",
  lathe: "Lathe",
};
export const machineTypeLabel = (t: string | null) =>
  t ? MACHINE_TYPE_LABEL[t] ?? t.replace(/_/g, " ") : "Unspecified";

/**
 * A spell on the machine shorter than this is not a carve.
 *
 * Found on the live data (Oct 2026): machine 23 came top of the 7-day
 * board with 14 pieces and 0.1 hours — all fourteen "ran" for about 36
 * SECONDS. Someone had loaded and unloaded them back to back in the app,
 * catching the register up after the fact.
 *
 * The cut-off is not a guess. Over 30 days the durations are in two
 * clearly separate groups: 189 jobs under 15 minutes, only 6 between 15
 * minutes and an hour, and 555 over an hour. Nothing real lives in the
 * gap, so anything under a quarter of an hour is a logging entry and is
 * kept out of the productivity figures — and counted separately, so it
 * is never silently dropped.
 */
const MIN_REAL_RUN_MS = 15 * 60 * 1000;

export type MachineRow = {
  id: string;
  code: string;
  vendorName: string;
  type: string | null;
  typeLabel: string;
  axes: number | null;
  status: string;
  /** Pieces unloaded in the period. */
  jobs: number;
  /** Wall-clock hours the machine was loaded, clipped to the period.
   *  Overlapping jobs are MERGED, not added — see the note in the loader. */
  hoursRun: number;
  /** hoursRun as a share of the hours in the period. Cannot exceed 100%. */
  utilisation: number;
  /** Mean full duration of the jobs it finished, in hours. */
  hoursPerJob: number | null;
  /** Mean number of pieces on the machine at the same time: piece-hours
   *  divided by wall-clock hours. These are multi-head machines, so two
   *  machines can run the same hours and still differ here. */
  piecesAtATime: number | null;
  /** Pieces ticked off in under 15 minutes — register catch-up, not work.
   *  Excluded from `jobs`, shown so nobody thinks rows went missing. */
  loggedOnly: number;
  /** Pieces sitting on the bed right now, still unloaded. A machine that
   *  finished nothing this week but has a full bed is part-way through
   *  long work, not standing idle — those are completely different
   *  problems and must not land in the same warning. */
  onBedNow: number;
};

export type TypeGroup = {
  type: string | null;
  typeLabel: string;
  machines: MachineRow[];
  /** Median jobs across the machines of this type — the "same kind" bar. */
  medianJobs: number;
  medianHoursPerJob: number | null;
  totalJobs: number;
};

export type ProductivityReport = {
  periodKey: string;
  periodLabel: string;
  days: number;
  from: string;
  groups: TypeGroup[];
  totalJobs: number;
  machinesCounted: number;
  /** Machines that finished something in the period. */
  machinesRunning: number;
  /** Finished nothing but have a loaded bed — working on something long. */
  machinesMidJob: number;
  /** Finished nothing and have an empty bed — genuinely standing still. */
  machinesIdle: number;
  /** Register catch-up entries excluded from the figures, across all machines. */
  loggedOnly: number;
  /** Machines well under the median of their own type — what dad is after. */
  laggards: MachineRow[];
};

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export async function loadCncProductivity(periodKey: string): Promise<ProductivityReport> {
  const period = PERIODS.find((p) => p.key === periodKey) ?? PERIODS[0];
  const days = period.days;
  const now = Date.now();
  const fromMs = now - days * 86_400_000;
  const fromIso = new Date(fromMs).toISOString();

  const admin = createAdminSupabaseClient();

  const [{ data: machineRows }, { data: vendorRows }, items, { data: onBedRows }] = await Promise.all([
    admin
      .from("cnc_machines")
      .select("id, machine_code, vendor_id, machine_type, cnc_axes, is_active, status")
      .eq("is_active", true),
    admin.from("vendors").select("id, name"),
    // Only the three columns the arithmetic needs. Paged because a 90-day
    // window is a couple of thousand rows and PostgREST caps a plain
    // select at 1,000 with no error.
    fetchAllPaged<{ completed_on_cnc_machine_id: string | null; loaded_at: string | null; unloaded_at: string }>(
      (f, t) =>
        admin
          .from("carving_items")
          .select("completed_on_cnc_machine_id, loaded_at, unloaded_at")
          .gte("unloaded_at", fromIso)
          .not("completed_on_cnc_machine_id", "is", null)
          .order("unloaded_at", { ascending: false })
          .order("id", { ascending: true })
          .range(f, t),
    ),
    // Still on the bed — the difference between "idle" and "mid-job".
    admin.from("carving_items").select("cnc_machine_id").is("unloaded_at", null).not("cnc_machine_id", "is", null),
  ]);

  const onBed = new Map<string, number>();
  for (const r of (onBedRows ?? []) as Array<{ cnc_machine_id: string }>) {
    onBed.set(r.cnc_machine_id, (onBed.get(r.cnc_machine_id) ?? 0) + 1);
  }

  const vendorName = new Map(
    ((vendorRows ?? []) as Array<{ id: string; name: string }>).map((v) => [v.id, v.name]),
  );

  // These are MULTI-HEAD machines: several pieces sit on one bed at the
  // same time. Adding each piece's hours together therefore counts the
  // same wall-clock hour once per piece, which first showed up on screen
  // as machines "122% used". Wall-clock time has to be the UNION of the
  // loaded intervals, not their sum — so the intervals are collected per
  // machine here and merged below.
  type Acc = { jobs: number; fullMs: number; withDuration: number; spans: Array<[number, number]>; loggedOnly: number };
  const acc = new Map<string, Acc>();
  for (const it of items) {
    const mid = it.completed_on_cnc_machine_id;
    if (!mid) continue;
    const a = acc.get(mid) ?? { jobs: 0, fullMs: 0, withDuration: 0, spans: [], loggedOnly: 0 };

    const end = new Date(it.unloaded_at).getTime();
    const start = it.loaded_at ? new Date(it.loaded_at).getTime() : NaN;
    // A sub-15-minute spell is register catch-up, not a carve — see
    // MIN_REAL_RUN_MS. It counts nowhere except its own tally.
    if (Number.isFinite(start) && end - start < MIN_REAL_RUN_MS) {
      a.loggedOnly += 1;
      acc.set(mid, a);
      continue;
    }
    a.jobs += 1;
    if (Number.isFinite(start) && end > start) {
      // Full run, for "how long does a piece take on this machine".
      a.fullMs += end - start;
      a.withDuration += 1;
      // Clipped to the window, so a job loaded three weeks before the
      // period cannot stretch past the period it is being counted in.
      const clipped = Math.max(start, fromMs);
      if (end > clipped) a.spans.push([clipped, end]);
    }
    acc.set(mid, a);
  }

  /** Total length of a set of intervals, counting overlap once. */
  const unionMs = (spans: Array<[number, number]>): number => {
    if (spans.length === 0) return 0;
    const s = [...spans].sort((a, b) => a[0] - b[0]);
    let total = 0;
    let [curStart, curEnd] = s[0];
    for (let i = 1; i < s.length; i++) {
      const [st, en] = s[i];
      if (st > curEnd) {
        total += curEnd - curStart;
        curStart = st;
        curEnd = en;
      } else if (en > curEnd) {
        curEnd = en;
      }
    }
    return total + (curEnd - curStart);
  };

  const windowHours = days * 24;
  const machines: MachineRow[] = ((machineRows ?? []) as Array<{
    id: string; machine_code: string; vendor_id: string | null;
    machine_type: string | null; cnc_axes: number | null; status: string;
  }>).map((m) => {
    const a = acc.get(m.id);
    const hoursRun = a ? unionMs(a.spans) / 3_600_000 : 0;
    const pieceHours = a ? a.fullMs / 3_600_000 : 0;
    return {
      id: m.id,
      code: m.machine_code,
      vendorName: m.vendor_id ? vendorName.get(m.vendor_id) ?? "—" : "—",
      type: m.machine_type,
      typeLabel: machineTypeLabel(m.machine_type),
      axes: m.cnc_axes,
      status: m.status,
      jobs: a?.jobs ?? 0,
      hoursRun,
      utilisation: windowHours > 0 ? hoursRun / windowHours : 0,
      hoursPerJob: a && a.withDuration > 0 ? a.fullMs / a.withDuration / 3_600_000 : null,
      piecesAtATime: hoursRun > 0.05 ? pieceHours / hoursRun : null,
      loggedOnly: a?.loggedOnly ?? 0,
      onBedNow: onBed.get(m.id) ?? 0,
    };
  });

  // Group by type, rank inside each group — the "same kind" comparison.
  const byType = new Map<string, MachineRow[]>();
  for (const m of machines) {
    const key = m.type ?? "__none__";
    byType.set(key, [...(byType.get(key) ?? []), m]);
  }

  const groups: TypeGroup[] = [...byType.entries()]
    .map(([key, list]) => {
      const sorted = [...list].sort(
        (a, b) => b.jobs - a.jobs || b.hoursRun - a.hoursRun || a.code.localeCompare(b.code, undefined, { numeric: true }),
      );
      const perJob = sorted.map((m) => m.hoursPerJob).filter((h): h is number => h != null);
      return {
        type: key === "__none__" ? null : key,
        typeLabel: machineTypeLabel(key === "__none__" ? null : key),
        machines: sorted,
        medianJobs: median(sorted.map((m) => m.jobs)),
        medianHoursPerJob: perJob.length ? median(perJob) : null,
        totalJobs: sorted.reduce((s, m) => s + m.jobs, 0),
      };
    })
    .sort((a, b) => b.machines.length - a.machines.length);

  // "Doing less than the same kind": at or below half its type's median,
  // and only where the group is big enough for a median to mean anything.
  //
  // A machine with a loaded bed is NOT in this list however little it
  // finished. Checked on the live data: machines 2, 18 and 29 finished
  // nothing in seven days with 132, 48 and 96 pieces on them, part-way
  // through long work — ringing their vendor would be a wasted call,
  // and a warning that cries wolf stops being read.
  const laggards: MachineRow[] = [];
  for (const g of groups) {
    if (g.machines.length < 3 || g.medianJobs <= 0) continue;
    for (const m of g.machines) {
      if (m.jobs <= g.medianJobs / 2 && m.onBedNow === 0) laggards.push(m);
    }
  }
  laggards.sort((a, b) => a.jobs - b.jobs);

  return {
    periodKey: period.key,
    periodLabel: period.label,
    days,
    from: fromIso,
    groups,
    totalJobs: machines.reduce((s, m) => s + m.jobs, 0),
    machinesRunning: machines.filter((m) => m.jobs > 0).length,
    machinesMidJob: machines.filter((m) => m.jobs === 0 && m.onBedNow > 0).length,
    machinesIdle: machines.filter((m) => m.jobs === 0 && m.onBedNow === 0).length,
    loggedOnly: machines.reduce((s, m) => s + m.loggedOnly, 0),
    machinesCounted: machines.length,
    laggards,
  };
}
