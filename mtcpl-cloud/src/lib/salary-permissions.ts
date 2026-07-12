// Salary / PF department access (Daksh, Jul 2026).
//
// Salary data is sensitive — only the owner, the developer and the senior
// accountant (accountant_star) can enter. Widen here if Daksh adds roles.

export type SalaryProfile = { role: string };

export const SALARY_ROLES = ["owner", "developer", "accountant_star"] as const;

export function canUseSalary(profile: SalaryProfile): boolean {
  return (SALARY_ROLES as readonly string[]).includes(profile.role);
}

/** EPF statutory wage ceiling — PF is 12% of min(salary, this). So above
 *  ₹15,000 salary the PF stays ₹1,800 no matter how high the pay (Daksh). */
export const PF_WAGE_CEILING = 15000;

/** Employee-share PF for a month: pct% of the wage capped at the ceiling. */
export function computePf(base: number, pct: number, enabled: boolean): number {
  if (!enabled) return 0;
  const wage = Math.min(Math.max(0, base), PF_WAGE_CEILING);
  const p = Number.isFinite(pct) ? pct : 12;
  return Math.round(wage * p) / 100;
}

/** Employee-share ESI for a month: pct% (default 1) of the earned gross —
 *  SAME base as the salary, no wage ceiling (Daksh: "salary 10000 → 1% of
 *  10000 is the ESI"). Mig 193. */
export function computeEsi(base: number, pct: number, enabled: boolean): number {
  if (!enabled) return 0;
  const wage = Math.max(0, base);
  const p = Number.isFinite(pct) ? pct : 1;
  return Math.round(wage * p) / 100;
}

// ── Fixed vs by-attendance pay ──────────────────────────────────────
// The salary type is an EXPLICIT per-employee toggle (Daksh, Jul 2026 —
// replaced the short-lived "designation Worker ⇒ by attendance" rule):
//   fixed    → the full monthly salary, whatever the attendance;
//   variable → paid BY ATTENDANCE (days present ÷ days in month × salary).
// Any designation can be either.

/** Calendar days in the month of a "YYYY-MM" / "YYYY-MM-01" key (28–31). */
export function daysInSalaryMonth(monthKey: string): number {
  const m = /^(\d{4})-(\d{2})/.exec(monthKey ?? "");
  if (!m) return 30;
  // day 0 of the NEXT month (month here is 1-indexed, passed as JS's 0-indexed
  // next-month) = the last day of THIS month.
  return new Date(Number(m[1]), Number(m[2]), 0).getDate();
}

/** A row's EARNED base salary for the month, BEFORE OT / advances / deductions
 *  / PF / ESI:
 *    • fixed        → the full monthly salary, whatever the attendance;
 *    • by attendance → dailySalary × days present (mig 194). Falls back to the
 *                      legacy monthlySalary × (attendance ÷ days-in-month),
 *                      capped, when no daily rate is stored, so employees added
 *                      before the daily-wage change keep working.
 *  An UNSET attendance earns 0 (days present must be recorded first).
 *  ONE source of truth for the server (authoritative) and the live UI preview. */
export function earnedSalary(args: {
  monthlySalary: number;
  dailySalary?: number | null;
  salaryType: "fixed" | "variable";
  attendanceDays: number | null;
  monthKey: string;
}): number {
  if (args.salaryType !== "variable") {
    return Math.round(Math.max(0, Number(args.monthlySalary) || 0) * 100) / 100;
  }
  if (args.attendanceDays == null || !Number.isFinite(args.attendanceDays)) return 0;
  const daily = Math.max(0, Number(args.dailySalary) || 0);
  if (daily > 0) return Math.round(daily * Math.max(0, args.attendanceDays) * 100) / 100;
  // Legacy fallback — monthly salary prorated by days-in-month, capped.
  const monthly = Math.max(0, Number(args.monthlySalary) || 0);
  const days = daysInSalaryMonth(args.monthKey);
  const factor = Math.max(0, Math.min(1, args.attendanceDays / days));
  return Math.round(monthly * factor * 100) / 100;
}
