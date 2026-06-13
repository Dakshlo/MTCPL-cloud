import type { AppRole } from "@/lib/types";

// Who runs the site for now. (A per-temple `site_incharge` scope comes
// later — for now the office management circle can operate every site.)
// Kept OUT of actions.ts because a "use server" file may only export
// async functions.
export const SITE_ROLES: AppRole[] = ["developer", "owner", "senior_incharge", "carving_head", "team_head"];
