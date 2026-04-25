import type { Profile } from "@/lib/types";

/**
 * Cross-block slab transfer is a sharp tool — claiming a slab from
 * another active plan changes the donor block's layout and forces a
 * reprint. Per business decision, only specific people are trusted
 * with this:
 *
 *   - Every developer (full system access).
 *   - Owner role, BUT only specific named owners (Naresh + Rajesh Kumar).
 *     Other owners (if any are added later) are intentionally NOT
 *     granted this until the rule is widened.
 *
 * Names are normalised to UPPERCASE + trimmed before comparison so
 * "Naresh", "naresh", "  NARESH " all match. If we ever switch to
 * matching by user_id, replace this allowlist with the UUIDs.
 */
const TRANSFER_ALLOWED_OWNER_NAMES = new Set(["NARESH", "RAJESH KUMAR"]);

export function canTransferPlannedSlabs(profile: Pick<Profile, "role" | "full_name">): boolean {
  if (profile.role === "developer") return true;
  if (profile.role !== "owner") return false;
  const name = (profile.full_name ?? "").toUpperCase().trim();
  return TRANSFER_ALLOWED_OWNER_NAMES.has(name);
}
