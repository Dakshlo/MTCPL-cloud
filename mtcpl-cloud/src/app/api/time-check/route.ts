// ──────────────────────────────────────────────────────────────────
// /api/time-check — what the SERVER thinks the time is.
//
// Daksh, Aug 2026: "on developer only, on my dashboard give a real
// clock, so if any time the time goes wrong I can report it to you."
//
// The clock already on the hero reads `new Date()` in the browser, so
// it only ever shows the viewer's own laptop clock. That tells you
// nothing when the app's dates go wrong — and they did: on 27 Aug the
// dashboard greeted him with "Friday, 28 August" because a helper
// applied the +5:30 IST offset twice (see lib/ist.ts). The clock on
// screen looked perfectly fine throughout.
//
// So this route reports the values that actually drive the app:
// the server's instant, the IST date/hour derived from it, and the
// 10 AM→10 AM window the daily report is built on. Compare them with
// the browser and any drift shows up immediately.
//
// Developer-only, no caching, and it reads nothing but the clock.
// ──────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { istYmd, istHour, istDateLabel } from "@/lib/ist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The daily-report window: 10:00 IST → 10:00 IST, labelled by its
 *  START day. Mirrors window24() in lib/whatsapp-report.ts — if that
 *  ever disagrees with this, the report is dated wrong. */
const REPORT_HOUR_IST = 10;
function reportWindow() {
  const ist = new Date(Date.now() + 5.5 * 3600 * 1000);
  const endIstMs = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), REPORT_HOUR_IST, 0, 0, 0);
  const startIstMs = endIstMs - 24 * 3600 * 1000;
  const fmt = (ms: number) => {
    const d = new Date(ms);
    return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")} ${String(d.getUTCHours()).padStart(2, "0")}:00`;
  };
  return { start: fmt(startIstMs), end: fmt(endIstMs) };
}

export async function GET() {
  try {
    const { profile } = await requireAuth();
    if (profile.role !== "developer") {
      return NextResponse.json({ ok: false, error: "Developer only." }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }

  const w = reportWindow();
  return NextResponse.json(
    {
      ok: true,
      // Epoch ms — the client syncs its own tick to this.
      now: Date.now(),
      // Everything below is DERIVED. A wrong value here is the bug,
      // even when `now` itself is correct.
      istYmd: istYmd(),
      istHour: istHour(),
      istLabel: istDateLabel(),
      reportWindow: `${w.start} → ${w.end} IST`,
      // The runtime's own idea of where it is. Vercel runs UTC; a
      // laptop dev server runs IST. Both are fine — the derived IST
      // values above must come out identical either way.
      serverTz: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "unknown",
      serverOffsetMin: -new Date().getTimezoneOffset(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
