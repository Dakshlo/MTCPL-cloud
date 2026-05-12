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
 * blocks. Open to every role that already touches cutting flow:
 * developer, owner, team_head, cutting_operator. Block-entry /
 * slab-entry roles stay locked out — they don't run cutting.
 *
 * The operator NAME, however, surfaces on cards for everyone — only
 * the management actions are gated.
 */
export function canManageOperators(profile: Pick<Profile, "role" | "full_name">): boolean {
  if (profile.role === "developer") return true;
  if (profile.role === "owner") return true;
  if (profile.role === "team_head") return true;
  if (profile.role === "cutting_operator") return true;
  return false;
}

/**
 * Cutting-Done supervisor approval (migration 027). Only this small
 * set of people sees the top-bar Approvals button + can press
 * Approve / Edit / Send back for edit:
 *
 *   - developer (always)
 *   - owner (always)
 *   - team_head, but ONLY if their profile has can_approve_cuts=TRUE
 *
 * The flag is set on Rajesh Kumar's profile post-migration. Other
 * team_heads (Alkesh, Paresh Kumar, etc.) keep all their existing
 * capabilities but don't see the approval surface — by design,
 * cut approval is an owner-level checkpoint that one trusted
 * team_head handles in practice.
 */
export function canApproveCuts(
  profile: Pick<Profile, "role" | "can_approve_cuts">,
): boolean {
  if (profile.role === "developer") return true;
  if (profile.role === "owner") return true;
  if (profile.role === "team_head" && profile.can_approve_cuts === true) return true;
  return false;
}
