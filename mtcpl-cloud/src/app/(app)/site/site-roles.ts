import type { AppRole } from "@/lib/types";

// Who runs the site for now. Daksh (June 2026) — owner + developer
// only; a per-temple `site_incharge` scope (and wider access) comes
// later. Kept OUT of actions.ts because a "use server" file may only
// export async functions.
export const SITE_ROLES: AppRole[] = ["developer", "owner"];
