import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      bodySizeLimit: "5mb",
    },
  },
  // Mig 054 follow-on (Daksh): xlsx uses Node-only APIs (Buffer,
  // fs guards, dynamic requires) that Next's bundler can't reliably
  // package into serverless functions on Vercel. Marking it
  // external tells Next to require() it from node_modules at
  // request time — same approach Next docs recommend for `xlsx`,
  // `puppeteer`, `sharp`, etc.
  // exceljs (Daksh June 2026) — same treatment as xlsx. It builds the
  // colourful slab-import template server-side (/api/slabs/import-template);
  // marking it external keeps Next/Turbopack from re-bundling its Node
  // internals, which is exactly the trap that broke the styled xlsx fork.
  // imapflow + mailparser (June 2026) — Node-only TCP/stream internals for
  // the owner email snapshot; same keep-out-of-the-bundle treatment.
  serverExternalPackages: ["xlsx", "exceljs", "imapflow", "mailparser"],

  /**
   * Parkota Pillar Tracker (Daksh, Jul 2026) — a standalone, self-contained
   * single-file HTML app (Baba Mastnath Ji parkota: pillar map, made/fixed
   * status, parts, stock). It lives in `public/` and is served as a plain
   * static asset, so it is deliberately NOT part of the Next app: no auth,
   * no layout, no sidebar entry. This rewrite just gives it a clean URL —
   *     /parkota   →   /parkota-tracker.html
   * so it can be shared as <domain>/parkota. Nothing else links to it yet.
   */
  async rewrites() {
    return [{ source: "/parkota", destination: "/parkota-tracker.html" }];
  },
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
