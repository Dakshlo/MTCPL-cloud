import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      bodySizeLimit: "5mb",
    },
  },
  // Mig 054 follow-on (Daksh): xlsx-js-style + xlsx use Node-only
  // APIs (Buffer, fs guards, dynamic requires) that Next's bundler
  // can't reliably package into serverless functions on Vercel.
  // Marking them external tells Next to require() them from
  // node_modules at request time — same approach Next docs
  // recommend for `xlsx`, `puppeteer`, `sharp`, etc. Fixes the
  // 500 on /api/reports/cnc-monthly.xlsx in production.
  serverExternalPackages: ["xlsx-js-style", "xlsx"],
};

/**
 * Wrap with Sentry so the build uploads source maps (makes stack traces in
 * the Sentry dashboard show real TypeScript file/line numbers instead of
 * minified garbage). Credentials are read from env vars:
 *
 *   SENTRY_ORG          – your org slug
 *   SENTRY_PROJECT      – the project slug
 *   SENTRY_AUTH_TOKEN   – write-scoped auth token (put in Vercel env, NOT in git)
 *
 * If those vars are missing, withSentryConfig still wraps the build but
 * skips the upload step — so the app continues to build cleanly in
 * environments (like a fresh clone) that don't have Sentry set up.
 */
export default withSentryConfig(nextConfig, {
  // Widen the stack-frame matching so Next's generated route files don't
  // show as "unknown". Small build-time cost; worth it for debuggability.
  widenClientFileUpload: true,

  // Source maps — delete them from the public build output after uploading
  // to Sentry so end users can't download them from the CDN.
  sourcemaps: {
    deleteSourcemapsAfterUpload: true,
  },

  // Suppress build logs when the auth token isn't configured — keeps
  // local / preview / first-time builds quiet.
  silent: !process.env.SENTRY_AUTH_TOKEN,

  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Disable Sentry's opt-in build telemetry.
  telemetry: false,
});
