import type { Profile } from "@/lib/types";

// Who can see "Today's News" (the market brief + the daily stock/F&O ideas).
// Every OWNER plus the developer. (Originally limited to owner Naresh only;
// opened up to all owners on Daksh's request — Jul 2026.)
export function canSeeMarketNews(profile: Pick<Profile, "role">): boolean {
  return profile.role === "owner" || profile.role === "developer";
}
