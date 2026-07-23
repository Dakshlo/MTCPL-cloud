import type { AppRole } from "@/lib/types";

/**
 * Vehicles department access (mig 204; accountant added Jul 2026).
 *
 * Daksh: "for account role give department vehicle access" — the plain
 * ACCOUNTANT (Virendra Pal), with the same rights as owner: view the expiry
 * radar, add/edit vehicles, record EMI, upload and delete documents. That
 * matches who actually pays the EMIs and renews insurance/PUC/fitness.
 *
 * ACCOUNTANT ★ is deliberately NOT included — asked and confirmed.
 *
 * One list, imported by all 8 gates (3 pages + 5 server actions). It used to be
 * the literal ["owner", "developer"] written out 8 times, which is exactly the
 * shape that drifts: add a role, miss one gate, and you get either a broken
 * page or a hole. Same reasoning as invoicing-permissions.ts / parkota-access.ts.
 *
 * NOTE: `developer` is a superuser inside requireAuth() and passes regardless,
 * but it stays listed so this array is also readable as "who may use Vehicles".
 */
export const VEHICLES_ROLES: AppRole[] = ["owner", "developer", "accountant"];

export function canUseVehicles(p: Pick<{ role: AppRole }, "role"> | { role: string } | null | undefined): boolean {
  if (!p) return false;
  return (VEHICLES_ROLES as readonly string[]).includes(p.role);
}
