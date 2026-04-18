/**
 * Sentry initialisation for the browser runtime.
 *
 * Loaded by Next.js on every client-side page load. Guarded by
 * NEXT_PUBLIC_SENTRY_DSN so that if the env var is missing (local dev
 * without Sentry credentials, or before Sentry is set up), we skip
 * initialisation entirely and the SDK becomes a no-op.
 */

import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    // Environment tag — makes it easy to filter prod vs preview in the
    // Sentry dashboard. Vercel sets VERCEL_ENV automatically (production,
    // preview, development).
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? "development",

    // Performance monitoring — 10% of page loads get timing samples.
    // Adjust up if throughput is low (currently 10 daily users, so even
    // 100% would be cheap), or leave at 10% as a safe default.
    tracesSampleRate: 0.1,

    // Session replay — records a silent video of the user's screen so you
    // can see exactly what they did before an error. Off by default
    // (bandwidth + privacy), on for 50% of sessions that actually hit an
    // error. Flip both to 0 if you want no replay at all, or raise
    // replaysSessionSampleRate to record every session.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0.5,

    // Don't capture the usual client-side noise: dev tools errors,
    // browser-extension errors, network blips. Add more patterns as they
    // come up.
    ignoreErrors: [
      "ResizeObserver loop limit exceeded",
      "ResizeObserver loop completed with undelivered notifications",
      "Non-Error promise rejection captured",
      // Browser extension noise
      /chrome-extension:\/\//,
      /moz-extension:\/\//,
    ],
  });
}
