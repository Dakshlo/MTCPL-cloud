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

// ── Fixed vs by-attendance ("worker") pay ───────────────────────────
// Salary type is NOT chosen by hand any more — it follows the designation.
// A "Worker" is paid BY ATTENDANCE (days present ÷ days in the month × salary);
// every other designation is FIXED (the full monthly salary, whatever the
// attendance). Daksh, Jul 2026.

/** True when a designation means "paid by attendance" (a worker). Case-
 *  insensitive; the singular or plural word both count. */
export function isWorkerDesignation(designation: string | null | undefined): boolean {
  const d = (designation ?? "").trim().toLowerCase();
  return d === "worker" || d === "workers";
}

/** The salary type a designation implies. */
export function salaryTypeForDesignation(designation: string | null | undefined): "fixed" | "variable" {
  return isWorkerDesignation(designation) ? "variable" : "fixed";
}

/** Calendar days in the month of a "YYYY-MM" / "YYYY-MM-01" key (28–31). */
export function daysInSalaryMonth(monthKey: string): number {
  const m = /^(\d{4})-(\d{2})/.exec(monthKey ?? "");
  if (!m) return 30;
  // day 0 of the NEXT month (month here is 1-indexed, passed as JS's 0-indexed
  // next-month) = the last day of THIS month.
  return new Date(Number(m[1]), Number(m[2]), 0).getDate();
}

/** A row's EARNED base salary for the month, BEFORE OT / advances / deductions
 *  / PF:
 *    • fixed  → the full monthly salary, whatever the attendance;
 *    • worker → monthly salary × (attendance ÷ days-in-month), capped at the
 *               full month; an UNSET attendance earns 0 (days present must be
 *               recorded before the worker is paid).
 *  ONE source of truth for the server (authoritative) and the live UI preview. */
export function earnedSalary(args: {
  monthlySalary: number;
  salaryType: "fixed" | "variable";
  attendanceDays: number | null;
  monthKey: string;
}): number {
  const base = Math.max(0, Number(args.monthlySalary) || 0);
  if (args.salaryType !== "variable") return Math.round(base * 100) / 100;
  if (args.attendanceDays == null || !Number.isFinite(args.attendanceDays)) return 0;
  const days = daysInSalaryMonth(args.monthKey);
  const factor = Math.max(0, Math.min(1, args.attendanceDays / days));
  return Math.round(base * factor * 100) / 100;
}
