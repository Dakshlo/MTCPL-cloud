# Sentry error monitoring — activation guide

The code is wired up. To actually start seeing errors in a dashboard, you
need to create a free Sentry account and paste four environment variables
into Vercel. Total time: **~5 minutes**.

Until you do this, the Sentry SDK in the code is a harmless no-op — the
app runs normally, it just doesn't report anywhere.

## Step 1 — Create a Sentry account (one-time)

1. Go to <https://sentry.io/signup/>.
2. Sign up with the same Google account you use for Supabase / Vercel
   (easier admin later).
3. Create an **Organization** — name it whatever (e.g. `mtcpl`).
4. When Sentry asks what you want to monitor, pick **Next.js**.
5. Create a **Project** — name it `mtcpl-cloud`.
6. Sentry will show you a **DSN** URL that looks like:

   ```
   https://abc123@o987654.ingest.us.sentry.io/1234567
   ```

   Copy it. This is not secret — it's safe in client-side code.

7. Also go to **Settings → Account → API → Auth Tokens → Create New Token**.
   Give it the scope **project:releases** (needed for source-map uploads).
   Copy the token. **This one IS secret** — never commit it.

## Step 2 — Add 4 env vars to Vercel

Open your project in Vercel → **Settings → Environment Variables** → add
the following four, all for **Production, Preview, and Development**:

| Name | Value | Notes |
|---|---|---|
| `NEXT_PUBLIC_SENTRY_DSN` | `https://abc123@o987.../1234567` | The DSN from step 1.6 |
| `SENTRY_ORG` | `mtcpl` (your org slug) | Find in Sentry URL |
| `SENTRY_PROJECT` | `mtcpl-cloud` | Your project slug |
| `SENTRY_AUTH_TOKEN` | `sntrys_eyJ...` | The token from step 1.7 — **keep secret** |

Click **Save**, then **Redeploy** the latest production build (Deployments
tab → three-dot menu → Redeploy).

## Step 3 — Verify it's working

1. After the redeploy finishes, open the live app in your browser.
2. Temporarily add an error — the easiest way: log into the app as owner,
   open the browser DevTools Console, run:

   ```js
   throw new Error("Sentry test");
   ```

3. Within a few seconds it should appear in the Sentry dashboard under
   **Issues**. You'll see the stack trace, which page it happened on, the
   user's role, etc.

If it doesn't appear, double-check:

- `NEXT_PUBLIC_SENTRY_DSN` is set in Vercel and you **redeployed** after
  setting it (env vars only apply to new builds).
- No ad-blocker / privacy extension is intercepting requests to
  `*.ingest.sentry.io` in the browser you're testing in.

## What you'll see going forward

Every server error, server-action failure, and uncaught client error flows
into Sentry automatically. You don't have to log anything manually —
`try/catch` blocks in our code already re-throw on unexpected paths, and
anything that reaches the Next.js error boundary is captured by the
`onRequestError` export in `instrumentation.ts`.

**Configure email alerts** — Sentry → **Alerts → Create Alert** → pick
"Issue Alerts" → "New Issue". Set frequency to "immediately" if you want
every new unique error emailed to you, or "daily digest" for a quieter
inbox.

## What's in scope of this monitoring

| Event | Reported? |
|---|---|
| JavaScript error in the browser | ✅ |
| Error in a server component render | ✅ |
| Error thrown from a server action | ✅ |
| Error in an API route | ✅ |
| Slow page loads (top 10%) | ✅ (performance sample) |
| Database query errors at Supabase | ❌ — those don't throw in our code, they return `error` in the response. If you want those surfaced, let me know and I'll add a wrapper. |
| User clicked the wrong button | ❌ — that's not an error, it's user behaviour |

## Privacy / redaction

The server config strips anything that looks like a Supabase JWT before
sending events (see `beforeSend` in `sentry.server.config.ts`). If you
notice specific fields in Sentry that shouldn't be there, flag it and I'll
add more redaction rules.

## Free-tier limits

Sentry free tier gives you:

- **5,000 errors/month** (we'll use way less than this)
- **10,000 transactions/month** (page-load + action samples)
- **50 replays/month** (session recordings of errored sessions)
- **30-day** data retention

Easily enough for 10 internal users. If you ever outgrow it, the next
tier (`Developer` / `Team`) is modestly priced.

## Turning it off

If you ever want to disable Sentry temporarily, just clear
`NEXT_PUBLIC_SENTRY_DSN` in Vercel and redeploy. The SDK guards every
init call with `if (dsn)` — no DSN means zero Sentry traffic. You don't
need to pull the code out.
