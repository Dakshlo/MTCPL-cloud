// ──────────────────────────────────────────────────────────────────
// /api/email-snapshot/run — generate an owner email snapshot
//
// Called two ways:
//   • Vercel Cron (GET, 5:00 + 14:00 IST — see vercel.json). Verified
//     via the Authorization: Bearer ${CRON_SECRET} header Vercel sends
//     automatically when the CRON_SECRET env var is set.
//   • The dashboard's "Refresh now" button (POST, owner/developer only).
//
// Read-only by construction — see src/lib/email-snapshot.ts.
// ──────────────────────────────────────────────────────────────────

import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { runEmailSnapshot, recordSnapshotDiagnostic } from "@/lib/email-snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// IMAP fetch + AI summarize can take ~20-40s.
export const maxDuration = 60;

function isCronRequest(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

// Vercel stamps every cron invocation with this user-agent (and an
// x-vercel-cron header). We use it ONLY to tell "the cron fired but auth
// failed" apart from "the cron never fired" — not to authorise anything.
function looksLikeVercelCron(req: NextRequest): boolean {
  const ua = (req.headers.get("user-agent") ?? "").toLowerCase();
  return ua.includes("vercel-cron") || req.headers.has("x-vercel-cron");
}

async function isOwnerSession(): Promise<boolean> {
  try {
    const { profile } = await requireAuth();
    return profile.role === "owner" || profile.role === "developer";
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  // Cron path — always reads just today (range is fixed server-side).
  if (!isCronRequest(req) && !(await isOwnerSession())) {
    // If this WAS a Vercel cron but the CRON_SECRET check failed, record a
    // visible diagnostic so the dashboard stops looking "stuck with no
    // error". The usual cause: the CRON_SECRET env var is missing or was
    // changed (Vercel then can't send the matching Bearer token).
    if (looksLikeVercelCron(req)) {
      const why = process.env.CRON_SECRET
        ? "Cron fired but the Authorization token didn't match CRON_SECRET — re-set CRON_SECRET in Vercel and redeploy."
        : "Cron fired but CRON_SECRET is not set in Vercel — add it (any random string) so the cron can authenticate, then redeploy.";
      await recordSnapshotDiagnostic("cron", why).catch(() => {});
      return NextResponse.json({ ok: false, error: why }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: "Not allowed." }, { status: 403 });
  }
  const result = await runEmailSnapshot("cron", "today");
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export async function POST(req: NextRequest) {
  // Manual refresh from the dashboard — owner/dev only, with a chosen window.
  if (!(await isOwnerSession())) {
    return NextResponse.json({ ok: false, error: "Not allowed." }, { status: 403 });
  }
  const range = new URL(req.url).searchParams.get("range") ?? "today";
  const result = await runEmailSnapshot("manual", range);
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
