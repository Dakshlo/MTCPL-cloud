/**
 * Sentry initialisation for the Node server runtime.
 *
 * Catches errors thrown in server components, server actions, route
 * handlers, and middleware. Guarded by NEXT_PUBLIC_SENTRY_DSN so that
 * without credentials the SDK becomes a no-op.
 */

import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
    tracesSampleRate: 0.1,
    // Server-side: redact anything in the event body that looks like a
    // Supabase service-role key before it leaves our process. The Sentry
    // SDK already strips Authorization headers; this is extra defence.
    beforeSend(event) {
      if (event.extra) {
        for (const k of Object.keys(event.extra)) {
          const v = event.extra[k];
          if (typeof v === "string" && /eyJ[A-Za-z0-9_.-]{40,}/.test(v)) {
            event.extra[k] = "[REDACTED_JWT]";
          }
        }
      }
      return event;
    },
  });
}
