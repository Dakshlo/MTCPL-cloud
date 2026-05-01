import type { Profile } from "@/lib/types";

/**
 * Cross-block slab transfer + Fit-to-Fill access. Trusted to:
 *
 *   - Every developer (full system access).
 *   - Every team_head (per business decision — the role is meant to
 *     own day-to-day cutting decisions, including filling a block
 *     with extra slabs from other plans).
 *   - The two named owners — Naresh and Rajesh — regardless of how
 *     their full_name is stored ("Naresh", "Naresh Kumar Soni",
 *     "Mr Naresh", "Rajesh Kumar Sharma" all match). Kept around
 *     even though team_head now covers Rajesh by role, in case
 *     either of them gets stored under a different role later.
 *
 * Other roles (block_entry, slab_entry, cutting_operator, owner with
 * a different name) are intentionally NOT granted this — that's
 * still a deliberately gated capability.
 */
const TRANSFER_ALLOWED_NAME_SUBSTRINGS = ["NARESH", "RAJESH"];

export function canTransferPlannedSlabs(profile: Pick<Profile, "role" | "full_name">): boolean {
  if (profile.role === "developer") return true;
  if (profile.role === "team_head") return true;
  const name = (profile.full_name ?? "").toUpperCase().trim();
  if (!name) return false;
  // Substring match — "Naresh", "Naresh Bhai", "Naresh Kumar Soni" etc.
  // all match "NARESH". Same for Rajesh. Tolerates whatever variant
  // the profile happens to be stored as.
  return TRANSFER_ALLOWED_NAME_SUBSTRINGS.some((sub) => name.includes(sub));
}

/**
 * Manage cutter operators — pick from list, add new ones, assign to
 * blocks. Initial release is intentionally narrow (developer only) so
 * the team can validate the flow before it goes wider. To open it up
 * to team_heads later: change `=== "developer"` below to also accept
 * "team_head", or call canTransferPlannedSlabs(profile).
 *
 * The operator NAME, however, surfaces on cards for everyone — only
 * the management actions are gated.
 */
export function canManageOperators(profile: Pick<Profile, "role" | "full_name">): boolean {
  return profile.role === "developer";
}
