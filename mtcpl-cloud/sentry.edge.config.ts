/**
 * Sentry initialisation for the Edge runtime (middleware, edge route
 * handlers). Separate from the Node config because edge runtimes have a
 * smaller feature set — e.g. no Node-only integrations like `http`.
 *
 * Guarded by NEXT_PUBLIC_SENTRY_DSN.
 */

import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV ?? "development",
    tracesSampleRate: 0.1,
  });
}
