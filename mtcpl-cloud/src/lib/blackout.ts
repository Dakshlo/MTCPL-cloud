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
    const rows = (await res.json()) as Array<{ value?: { on?: boolean } }>;
    const on = rows?.[0]?.value?.on === true;
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
 * 503 + Retry-After is the correct signal for a temporary outage: search
 * engines hold the existing listing rather than dropping the site, so nothing
 * has to be re-earned when it returns.
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
