/**
 * Developer-on-a-phone landing.
 *
 * Daksh (Aug 2026): "for developer only — for me — in phone make the
 * settings page, cause sometimes I may have to add a user or blackout
 * the site and I may not have my PC/laptop with me. So I can just go to
 * phone settings and do that easily… even if in my developer login in
 * phone, directly takes to settings page."
 *
 * So: role `developer` + a phone/tablet browser → land on /settings
 * instead of the usual role/department home. Deliberately narrow:
 *   • no other role is affected — owner, accountant, everyone else
 *     lands exactly where they always did;
 *   • desktop is untouched, so normal dev work is unchanged;
 *   • it only sets the LANDING route. The sidebar still works, so a
 *     developer on a phone can navigate anywhere from there.
 *
 * Kept out of lib/auth.ts on purpose: `getDefaultRouteForProfile` is a
 * pure function used in hot paths, and this needs the async `headers()`
 * request API.
 */

import { headers } from "next/headers";

/** Phones and tablets. Android tablets report "Android" without
 *  "Mobile", and an iPad in desktop mode reports "Macintosh" — that one
 *  falls through to the desktop route, which is the safe direction to
 *  be wrong in. */
const MOBILE_UA = /iPhone|iPod|iPad|Android|Mobile|Windows Phone|BlackBerry|Opera Mini|IEMobile/i;

export function isMobileUserAgent(ua: string): boolean {
  return MOBILE_UA.test(ua);
}

/**
 * Returns the override landing route, or `null` to mean "use the normal
 * one" — so callers read as `redirect(override ?? getDefaultRoute(...))`.
 */
export async function getMobileDeveloperLanding(
  profile: { role: string },
): Promise<string | null> {
  if (profile.role !== "developer") return null;
  const ua = (await headers()).get("user-agent") ?? "";
  return isMobileUserAgent(ua) ? "/settings" : null;
}
