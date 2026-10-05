// ──────────────────────────────────────────────────────────────────
// Vehicle paperwork — the one-line summary the dashboard card shows.
//
// Daksh, Oct 2026: "on dashboard add one more KPI card … in that will
// show glimpse of vehicle department, eg if any vehicle there is any
// expiry then that card can show."
//
// The rules here are deliberately COPIED from the Vehicles department's
// own card rail (vehicles-client.tsx: expired = red, ≤30 days = amber,
// and fitness only counts for commercial vehicles), so a red chip on the
// dashboard always matches a red rail on /vehicles. The Cockpit's own
// alert uses a 45-day window instead — it predates this and is left
// alone, but it is why the two screens can differ by a few days.
//
// Why not reuse loadVehicles(): that pulls every document row, every
// timeline event and signs a public URL per file. This card needs six
// columns off a 34-row table, so it reads them directly.
// ──────────────────────────────────────────────────────────────────

import { createAdminSupabaseClient } from "@/lib/supabase/admin";

/** Days from now until `date`, counted from midnight IST — the same
 *  arithmetic the Vehicles pages use, so the numbers agree. */
export function daysToExpiry(date: string | null): number | null {
  if (!date) return null;
  const target = new Date(`${date.slice(0, 10)}T00:00:00+05:30`).getTime();
  return Math.floor((target - Date.now()) / 86_400_000);
}

/** Anything inside this many days counts as "due soon" (amber). */
export const EXPIRY_SOON_DAYS = 30;

export type VehicleExpiryItem = {
  /** Registration number if we have one, else the vehicle's name. */
  who: string;
  /** "Insurance" · "PUC" · "Fitness" */
  label: string;
  daysLeft: number;
};

export type VehicleExpirySummary = {
  /** False only on a pre-mig-204 database, where the card hides itself. */
  available: boolean;
  vehicles: number;
  /** How many expiry dates are actually on record (a blank date is not "clear"). */
  tracked: number;
  expired: number;
  dueSoon: number;
  /** The single most urgent paper — what the card names. */
  worst: VehicleExpiryItem | null;
};

const EMPTY: VehicleExpirySummary = {
  available: false, vehicles: 0, tracked: 0, expired: 0, dueSoon: 0, worst: null,
};

type Row = {
  kind: string | null;
  name: string | null;
  reg_no: string | null;
  insurance_expiry: string | null;
  puc_expiry: string | null;
  fitness_expiry: string | null;
};

export async function loadVehicleExpirySummary(): Promise<VehicleExpirySummary> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("vehicles")
    .select("kind, name, reg_no, insurance_expiry, puc_expiry, fitness_expiry")
    .limit(2000);

  // Table missing (old deploy) — say so rather than claiming a clear fleet.
  if (error) return EMPTY;

  const rows = (data ?? []) as Row[];
  let tracked = 0;
  let expired = 0;
  let dueSoon = 0;
  let worst: VehicleExpiryItem | null = null;

  for (const v of rows) {
    const who = (v.reg_no || "").trim() || (v.name || "").trim() || "Unnamed vehicle";
    // Fitness applies to commercial vehicles only — same rule as the
    // department's own card rail.
    const papers: Array<[string, string | null]> = [
      ["Insurance", v.insurance_expiry],
      ["PUC", v.puc_expiry],
      ...(v.kind === "commercial" ? ([["Fitness", v.fitness_expiry]] as Array<[string, string | null]>) : []),
    ];

    for (const [label, date] of papers) {
      const daysLeft = daysToExpiry(date);
      if (daysLeft == null) continue; // no date on record — not counted either way
      tracked += 1;
      if (daysLeft < 0) expired += 1;
      else if (daysLeft <= EXPIRY_SOON_DAYS) dueSoon += 1;
      else continue; // healthy, never the "worst"
      if (!worst || daysLeft < worst.daysLeft) worst = { who, label, daysLeft };
    }
  }

  return { available: true, vehicles: rows.length, tracked, expired, dueSoon, worst };
}

/** How the card should read, in words. Kept next to the rule it describes. */
export function describeVehicleExpiry(s: VehicleExpirySummary): {
  tone: "bad" | "warn" | "good" | "idle";
  chip: string;
  detail: string;
} {
  if (s.expired > 0) {
    const parts = [`${s.expired} expired`];
    if (s.dueSoon > 0) parts.push(`${s.dueSoon} due soon`);
    return { tone: "bad", chip: parts.join(" · "), detail: worstLine(s.worst) };
  }
  if (s.dueSoon > 0) {
    return {
      tone: "warn",
      chip: `${s.dueSoon} due in ${EXPIRY_SOON_DAYS} days`,
      detail: worstLine(s.worst),
    };
  }
  if (s.tracked > 0) {
    return {
      tone: "good",
      chip: "All papers clear",
      detail: `${s.vehicles} vehicle${s.vehicles === 1 ? "" : "s"} · nothing due in ${EXPIRY_SOON_DAYS} days`,
    };
  }
  return {
    tone: "idle",
    chip: "No dates on record",
    detail: `${s.vehicles} vehicle${s.vehicles === 1 ? "" : "s"} · add insurance and PUC dates to get warnings`,
  };
}

function worstLine(w: VehicleExpiryItem | null): string {
  if (!w) return "";
  if (w.daysLeft < 0) {
    const d = Math.abs(w.daysLeft);
    return `${w.who} — ${w.label} expired ${d} day${d === 1 ? "" : "s"} ago`;
  }
  if (w.daysLeft === 0) return `${w.who} — ${w.label} expires today`;
  return `${w.who} — ${w.label} due in ${w.daysLeft} day${w.daysLeft === 1 ? "" : "s"}`;
}
