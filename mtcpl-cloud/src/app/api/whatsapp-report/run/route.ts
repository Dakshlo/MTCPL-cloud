// ──────────────────────────────────────────────────────────────────
// /api/whatsapp-report/run — send the daily WhatsApp work-report PDF.
//
//   • GET  — Vercel Cron (6 PM IST, see vercel.json). Verified via the
//            Authorization: Bearer ${CRON_SECRET} header (same scheme as
//            the email-snapshot cron).
//   • POST — owner/developer manual trigger (a "test send now" so we can
//            verify the PDF + WhatsApp delivery before the cron fires).
// ──────────────────────────────────────────────────────────────────

import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { sendDailyWhatsAppReport } from "@/lib/whatsapp-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function isCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  return !!secret && req.headers.get("authorization") === `Bearer ${secret}`;
}

async function isOwner(): Promise<boolean> {
  try {
    const { profile } = await requireAuth();
    return profile.role === "owner" || profile.role === "developer";
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  if (!isCron(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized — cron only." }, { status: 401 });
  }
  try {
    const result = await sendDailyWhatsAppReport();
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[whatsapp-report] cron send failed", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function POST() {
  if (!(await isOwner())) {
    return NextResponse.json({ ok: false, error: "Owner / developer only." }, { status: 403 });
  }
  try {
    const result = await sendDailyWhatsAppReport();
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[whatsapp-report] manual send failed", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
