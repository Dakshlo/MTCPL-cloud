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
