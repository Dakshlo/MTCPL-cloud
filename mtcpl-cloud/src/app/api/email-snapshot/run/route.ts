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
import { runEmailSnapshot } from "@/lib/email-snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// IMAP fetch + AI summarize can take ~20-40s.
export const maxDuration = 60;

function isCronRequest(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

async function isOwnerSession(): Promise<boolean> {
  try {
    const { profile } = await requireAuth();
    return profile.role === "owner" || profile.role === "developer";
  } catch {
    return false;
  }
}

async function handle(req: NextRequest, trigger: "cron" | "manual") {
  if (!isCronRequest(req) && !(await isOwnerSession())) {
    return NextResponse.json({ ok: false, error: "Not allowed." }, { status: 403 });
  }
  const result = await runEmailSnapshot(trigger);
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export async function GET(req: NextRequest) {
  return handle(req, "cron");
}

export async function POST(req: NextRequest) {
  return handle(req, "manual");
}
