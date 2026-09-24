// ──────────────────────────────────────────────────────────────────
// POST /api/client-error — write a browser-side failure into the
// server log so somebody can actually find out what it was.
// ──────────────────────────────────────────────────────────────────
//
// Next hides server error messages from the browser in production and
// hands out only a digest; a CLIENT-side error gets not even that. The
// carving wall proved the cost of it — the TV sat on an error card for
// hours saying "no error reference was produced", and there was nothing
// recorded anywhere to say what had happened.
//
// This is not error tracking. It is one line in the Vercel runtime log,
// which is what exists today. Sentry is wired into this codebase and
// switched off for want of a DSN (docs/SENTRY_SETUP.md); when that is
// turned on, this stays useful as the thing that catches what Sentry's
// client bundle misses, and costs nothing when nothing is failing.
//
// Deliberately small: authenticated callers only, a hard size cap, and
// no database write. A logging endpoint that can be spammed into the
// database is a worse problem than the one it solves.

import { NextRequest, NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 8_000;

export async function POST(req: NextRequest) {
  let who = "unknown";
  try {
    const { profile } = await requireAuth();
    who = `${profile.full_name ?? "—"} (${profile.role})`;
  } catch {
    // Not signed in — nothing to log against, and an open endpoint is
    // not something to leave lying around.
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let body: unknown = null;
  try {
    const raw = await req.text();
    body = JSON.parse(raw.slice(0, MAX_BYTES));
  } catch {
    body = { unparsed: true };
  }

  // One line, greppable. Vercel keeps runtime logs; this is what a
  // future "the TV showed an error again" question gets answered from.
  console.error("[client-error]", JSON.stringify({ who, ...(body as object) }));

  return NextResponse.json({ ok: true });
}
