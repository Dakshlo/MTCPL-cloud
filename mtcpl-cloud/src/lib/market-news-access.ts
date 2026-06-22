import type { Profile } from "@/lib/types";

// Who can see "Today's News" (the market brief + the daily stock/F&O ideas).
// Daksh's request: developer + the owner Naresh ONLY — not every owner. We
// match the owner by name substring (same pattern as canTransferPlannedSlabs
// — "Naresh", "Naresh Bhai", "Naresh Kumar Soni" all match), so it keeps
// working if his display name changes slightly.
const OWNER_NAME_SUBSTRINGS = ["NARESH"];

export function canSeeMarketNews(profile: Pick<Profile, "role" | "full_name">): boolean {
  if (profile.role === "developer") return true;
  if (profile.role === "owner") {
    const name = (profile.full_name ?? "").toUpperCase().trim();
    return OWNER_NAME_SUBSTRINGS.some((sub) => name.includes(sub));
  }
  return false;
}
