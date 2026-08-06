/**
 * Full blackout — the switch that takes the whole system off the air.
 *
 * Maintenance mode (system-status.ts) shows a lock screen to staff while the
 * app keeps running, and a developer can bypass it with a cookie. Blackout is
 * deliberately harsher: middleware refuses EVERY request to EVERY url from
 * EVERYBODY — staff, owner, developer alike — with no bypass anywhere in the
 * application. Someone probing the site finds a bare 503 and nothing else.
 *
 * ── HOW TO BRING IT BACK ──────────────────────────────────────────────────
 * There is no in-app way, by design: when blackout is on, the Settings page
 * that would turn it off is blacked out too. Run this in the Supabase SQL
 * editor:
 *
 *     update system_settings
 *     set value = '{"on": false}'::jsonb, updated_at = now()
 *     where key = 'blackout';
 *
 * The site returns within ~10 seconds (see CACHE_MS below).
 *
 * ── WHY NO DEVELOPER BYPASS ───────────────────────────────────────────────
 * A developer escape hatch is also an attacker escape hatch, and a
 * cookie-based one is precisely what a stolen session would use. The value of
 * this switch is that it has no exceptions. The escape hatch lives one layer
 * down, in the database, where it needs Supabase credentials rather than
 * anything the website hands out.
 *
 * ── WHAT IT DOES NOT DO ───────────────────────────────────────────────────
 * It changes one boolean. No business data is touched, moved or deleted, and
 * the system comes back exactly as it was left.
 */

/** How long an instance may serve a cached copy of the flag.
 *
 *  Middleware runs on every single request, so reading the database each time
 *  would put a query in front of every page load. Ten seconds is the trade:
 *  turning blackout ON takes up to 10s to cover every running instance, and
 *  turning it OFF takes up to 10s to restore. Both are acceptable; a query per
 *  request is not. */
const CACHE_MS = 10_000;

/**
 * How long a blackout may last. Choosing one is MANDATORY — there is no
 * "until I lift it" option, and that is the safety net.
 *
 * Without an expiry, a blackout stays on until somebody actively turns it off,
 * which means a dead phone, a forgotten Supabase login or a trip with no
 * signal leaves the company offline indefinitely. With one, the worst case is
 * that you wait it out.
 *
 * Needing longer is not a problem: when it lifts, the site is back, so you can
 * sign in and arm it again.
 */
export const BLACKOUT_HOURS = [3, 6, 12, 24] as const;
export type BlackoutHours = (typeof BLACKOUT_HOURS)[number];

export function isValidBlackoutHours(n: unknown): n is BlackoutHours {
  return typeof n === "number" && (BLACKOUT_HOURS as readonly number[]).includes(n);
}

/** The stored shape of the flag. `until` is an ISO timestamp. */
export type BlackoutValue = { on?: boolean; until?: string | null };

/**
 * The single rule for "are we dark right now", shared by the middleware and
 * anything else that needs to ask. Expiry is evaluated at READ time rather
 * than by a background job — so a blackout lifts itself with no cron, no
 * scheduled function, and nothing that can fail to run.
 */
export function isActive(v: BlackoutValue | null | undefined, now = Date.now()): boolean {
  if (!v || v.on !== true) return false;
  if (!v.until) return true;               // legacy row with no expiry — stays on
  const until = Date.parse(v.until);
  if (Number.isNaN(until)) return true;    // unreadable date: fail safe, stay dark
  return now < until;
}

type Cached = { on: boolean; at: number };

/* Module scope: one cache per running instance. Serverless spins up several,
 * each with its own copy — which is fine, they all converge within CACHE_MS. */
let cache: Cached | null = null;

/**
 * Is the system blacked out right now?
 *
 * FAILS OPEN. If Supabase cannot be reached we return the last known value,
 * or `false` if we have never had one. A database blip must not be able to
 * take the whole site down on its own — an outage should require someone to
 * have actually flipped the switch.
 */
export async function isBlackedOut(supabaseUrl: string, serviceKey: string): Promise<boolean> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) return cache.on;

  try {
    /* Plain fetch rather than supabase-js: this runs in middleware on every
       request, and PostgREST over fetch is the lightest thing that works in
       the Edge runtime. */
    const res = await fetch(
      `${supabaseUrl}/rest/v1/system_settings?key=eq.blackout&select=value`,
      {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          Accept: "application/json",
        },
        cache: "no-store",
      },
    );
    if (!res.ok) throw new Error(`status ${res.status}`);
    const rows = (await res.json()) as Array<{ value?: BlackoutValue }>;
    /* Expiry is judged here, at read time. Nothing writes the flag back to
       off when it lapses: a blackout that has run out simply stops counting,
       so there is no cron and no cleanup job that could fail to run and leave
       the company dark. The stale row is harmless and gets overwritten the
       next time the switch is armed. */
    const on = isActive(rows?.[0]?.value, now);
    cache = { on, at: now };
    return on;
  } catch {
    // Keep serving the last known answer rather than guessing.
    if (cache) return cache.on;
    return false;
  }
}

/** Drop the cached value so the next check re-reads. Called right after the
 *  switch is flipped from Settings, so THIS instance reacts immediately
 *  instead of waiting out the TTL. */
export function clearBlackoutCache(): void {
  cache = null;
}

/**
 * What a visitor sees. Deliberately anonymous: no company name, no branding,
 * no "MTCPL is down for maintenance" — someone poking at the domain should
 * learn nothing about what is behind it or why it is off.
 *
 * A bare 503 is already the "temporary, hold the listing" signal search
 * engines act on, so nothing has to be re-earned when the site returns. There
 * is deliberately no Retry-After header: that is a hint about when to come
 * back, and the expiry is ours to know, not the visitor's.
 */
export const BLACKOUT_HTML = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>503 Service Unavailable</title>
<style>
  html,body{height:100%;margin:0}
  body{display:flex;align-items:center;justify-content:center;
       font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;
       background:#0f0f10;color:#8a8a8f;text-align:center;padding:24px}
  .c{max-width:26rem}
  h1{font-size:15px;font-weight:600;color:#c9c9ce;margin:0 0 6px}
  p{margin:0;font-size:13.5px}
</style>
</head><body>
<div class="c">
  <h1>503 Service Unavailable</h1>
  <p>This service is temporarily offline. Please try again later.</p>
</div>
</body></html>`;
