// ──────────────────────────────────────────────────────────────────
// /api/royalty-purge/run — permanently delete cleared royalty ledgers
// whose 48-hour recovery window has closed.
//
//   • GET  — Vercel Cron (see vercel.json). Verified via the
//            Authorization: Bearer ${CRON_SECRET} header, same scheme
//            as the other crons.
//   • POST — owner/developer manual trigger, for when you want the
//            sweep to happen now rather than tonight.
//
// The lazy sweep inside the royalty actions already purges a vendor
// whenever someone opens their ledger. This exists so a vendor nobody
// visits again still gets cleaned up.
//
// It deletes rows. The audit_logs line written when the ledger was
// cleared — vendor, actor, entry count, cleared net balance — is NOT
// touched and remains the lasting record of what happened.
// ──────────────────────────────────────────────────────────────────

import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { purgeExpiredRoyaltyWipes } from "@/app/(app)/accounts/actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  return !!secret && req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!isCron(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized — cron only." }, { status: 401 });
  }
  const result = await purgeExpiredRoyaltyWipes();
  return NextResponse.json({ ok: true, ...result });
}

export async function POST() {
  try {
    const { profile } = await requireAuth();
    if (profile.role !== "owner" && profile.role !== "developer") {
      return NextResponse.json({ ok: false, error: "Owner / developer only." }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }
  const result = await purgeExpiredRoyaltyWipes();
  return NextResponse.json({ ok: true, ...result });
}
