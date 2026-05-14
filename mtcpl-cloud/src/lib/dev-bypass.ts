// Developer maintenance-bypass cookie name (Migration 036 follow-up).
//
// Lives in its own module — NOT in settings/system-status-actions.ts —
// because that file has a "use server" directive, which only allows
// async function exports. A plain string constant exported from a
// server-action file fails the build with "module has no exports at
// all".
//
// The actions that set/clear the cookie live in system-status-actions.ts;
// the cookie name itself is here so both the actions and the root
// layout (which reads the cookie to decide whether to skip the lock
// screen) can import it without crossing the server-action boundary.

export const DEV_BYPASS_COOKIE = "dev_maint_bypass";

/** TTL in seconds — short enough that a forgotten bypass auto-clears
 *  itself (4 hours), long enough to outlast a typical deploy window. */
export const DEV_BYPASS_MAX_AGE_SECONDS = 60 * 60 * 4;
