// ──────────────────────────────────────────────────────────────────
// /api/whatsapp-report/run — send the daily WhatsApp work-report PDF.
//
//   • GET  — Vercel Cron (10 AM IST, see vercel.json). Verified via the
//            Authorization: Bearer ${CRON_SECRET} header (same scheme as
//            the email-snapshot cron).
//   • POST — owner/developer manual trigger (a "test send now" so we can
//            verify the PDF + WhatsApp delivery before the cron fires).
//            Body {"self": true} sends to the CALLER'S OWN number only,
//            instead of every configured recipient — checking a change
//            should not put a PDF on all three owners' phones.
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

/** The caller's profile when they may trigger a send, else null. */
async function caller(): Promise<{ id: string; phone: string | null } | null> {
  try {
    const { profile } = await requireAuth();
    if (profile.role !== "owner" && profile.role !== "developer") return null;
    const p = profile as unknown as { id: string; phone?: string | null };
    return { id: p.id, phone: p.phone ?? null };
  } catch {
    return null;
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

export async function POST(req: NextRequest) {
  const me = await caller();
  if (!me) {
    return NextResponse.json({ ok: false, error: "Owner / developer only." }, { status: 403 });
  }
  // "self" is a flag, never a number: the phone is read from the signed-in
  // profile on the server, so a tampered request cannot send the company's
  // report to somebody else's handset.
  let self = false;
  try {
    const body = (await req.json()) as { self?: unknown } | null;
    self = body?.self === true;
  } catch {
    /* no body — a plain "send to everyone" trigger */
  }
  if (self && !me.phone) {
    return NextResponse.json(
      { ok: false, error: "Your profile has no mobile number on file." },
      { status: 400 },
    );
  }
  try {
    const result = await sendDailyWhatsAppReport(self ? [me.phone as string] : undefined);
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[whatsapp-report] manual send failed", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
