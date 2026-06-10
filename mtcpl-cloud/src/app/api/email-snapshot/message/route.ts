// ──────────────────────────────────────────────────────────────────
// /api/email-snapshot/message?uid=N — open ONE email in full
//
// Owner/developer only. Fetches the full email LIVE over read-only IMAP
// (see src/lib/email-snapshot.ts) — the body is never stored, only the
// AI summary is. Returns the exact words + attachment list.
// ──────────────────────────────────────────────────────────────────

import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { fetchFullMessage } from "@/lib/email-snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

async function isOwnerSession(): Promise<boolean> {
  try {
    const { profile } = await requireAuth();
    return profile.role === "owner" || profile.role === "developer";
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  if (!(await isOwnerSession())) {
    return NextResponse.json({ ok: false, error: "Not allowed." }, { status: 403 });
  }
  const uid = Number(new URL(req.url).searchParams.get("uid"));
  if (!Number.isFinite(uid) || uid <= 0) {
    return NextResponse.json({ ok: false, error: "Missing or bad uid." }, { status: 400 });
  }
  try {
    const message = await fetchFullMessage(uid);
    if (!message) {
      return NextResponse.json(
        { ok: false, error: "Couldn't load this email — it may have moved or been deleted." },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, message });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
