// ──────────────────────────────────────────────────────────────────
// /api/whatsapp-report/preview — owner/developer preview of the daily
// work-report PDF. Builds the SAME PDF the 6 PM cron sends, with real
// data, but returns it inline in the browser and sends NOTHING to
// WhatsApp (no upload, no MSG91 call). Use it to review the design.
// ──────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { buildDailyReportData, buildDailyReportPdf } from "@/lib/whatsapp-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  try {
    const { profile } = await requireAuth();
    if (profile.role !== "owner" && profile.role !== "developer") {
      return NextResponse.json({ ok: false, error: "Owner / developer only." }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }

  try {
    const data = await buildDailyReportData();
    const pdf = await buildDailyReportPdf(data);
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "inline; filename=MTCPL-Daily-Report-preview.pdf",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
