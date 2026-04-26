import type { Profile } from "@/lib/types";

/**
 * Cross-block slab transfer is a sharp tool — claiming a slab from
 * another active plan changes the donor block's layout and forces a
 * reprint. Per business decision, only specific people are trusted
 * with this:
 *
 *   - Every developer (full system access).
 *   - The two named owners — Naresh and Rajesh — regardless of how
 *     their full_name is stored ("Naresh", "Naresh Kumar Soni",
 *     "Mr Naresh", "Rajesh Kumar Sharma" all match). Other owners
 *     (if any are added later) are intentionally NOT granted this
 *     until the rule is widened.
 *
 * The role check is INTENTIONALLY skipped for the named-owner path —
 * even if Naresh or Rajesh are recorded with a non-owner role
 * (team_head, etc.) due to a data setup quirk, they still get
 * permission. If we ever switch to matching by user_id, replace
 * this name-substring approach with the UUIDs.
 */
const TRANSFER_ALLOWED_NAME_SUBSTRINGS = ["NARESH", "RAJESH"];

export function canTransferPlannedSlabs(profile: Pick<Profile, "role" | "full_name">): boolean {
  if (profile.role === "developer") return true;
  const name = (profile.full_name ?? "").toUpperCase().trim();
  if (!name) return false;
  // Substring match — "Naresh", "Naresh Bhai", "Naresh Kumar Soni" etc.
  // all match "NARESH". Same for Rajesh. Tolerates whatever variant
  // the profile happens to be stored as.
  return TRANSFER_ALLOWED_NAME_SUBSTRINGS.some((sub) => name.includes(sub));
}
