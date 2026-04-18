/**
 * Next.js instrumentation entry point.
 *
 * `register()` runs once when each Next.js runtime (Node or Edge) spins up.
 * We use it to bootstrap Sentry on the server side by dynamically importing
 * the runtime-specific config — dynamic imports so Node-only code never
 * gets bundled into the Edge runtime and vice versa.
 *
 * `onRequestError` is Next 15's hook for forwarding server-side render /
 * server-action / route-handler errors into an observability tool. We hand
 * it straight to Sentry.
 *
 * If SENTRY_DSN is not configured, the inner `Sentry.init` calls no-op
 * silently — so a dev clone without Sentry credentials still works.
 */

import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
