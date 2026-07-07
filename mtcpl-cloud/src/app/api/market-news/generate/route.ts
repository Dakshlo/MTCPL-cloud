// ──────────────────────────────────────────────────────────────────
// /api/market-news/generate — build the owner's daily market-news brief.
//
//   • GET  — Vercel Cron (8 AM IST weekdays, see vercel.json). Verified
//            via Authorization: Bearer ${CRON_SECRET} (same scheme as the
//            whatsapp-report / email-snapshot crons).
//   • POST — owner/developer manual trigger ("generate now" on the
//            dashboard card, so we can test before the cron fires).
// ──────────────────────────────────────────────────────────────────

import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { generateAndStoreMarketNews } from "@/lib/market-news";
import { canSeeMarketNews } from "@/lib/market-news-access";
import { getMarketNewsAuto } from "@/lib/market-news-auto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // web-search research can take a minute+

function isCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  return !!secret && req.headers.get("authorization") === `Bearer ${secret}`;
}

async function isOwner(): Promise<boolean> {
  try {
    const { profile } = await requireAuth();
    return canSeeMarketNews(profile);
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  if (!isCron(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized — cron only." }, { status: 401 });
  }
  // Owners can pause the daily auto-generation from the Today's News page. When
  // it's off, the cron no-ops (200, so Vercel doesn't retry / alarm). Manual
  // "Generate now" is unaffected — it hits POST, which never checks this.
  const { enabled } = await getMarketNewsAuto();
  if (!enabled) {
    return NextResponse.json({ ok: true, skipped: true, reason: "Daily auto-generation is turned off." });
  }
  const result = await generateAndStoreMarketNews("cron");
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export async function POST() {
  if (!(await isOwner())) {
    return NextResponse.json({ ok: false, error: "Owner / developer only." }, { status: 403 });
  }
  const result = await generateAndStoreMarketNews("manual");
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
