// Salary / PF department access (Daksh, Jul 2026).
//
// Salary data is sensitive — only the owner, the developer and the senior
// accountant (accountant_star) can enter. Widen here if Daksh adds roles.

export type SalaryProfile = { role: string };

export const SALARY_ROLES = ["owner", "developer", "accountant_star"] as const;

export function canUseSalary(profile: SalaryProfile): boolean {
  return (SALARY_ROLES as readonly string[]).includes(profile.role);
}
