// ──────────────────────────────────────────────────────────────────
// "Has the shelf moved?" — the few-second poll (mig 236)
// ──────────────────────────────────────────────────────────────────
//
// Daksh, Nov 2026: "stock should update every second, cause if someone
// take something and at some moment someone else try to add or take it
// will be fucked."
//
// Mig 235 made that safe to the LEDGER — the write is refused rather
// than recorded wrong. This is what keeps the SCREEN from lying in the
// meantime. Both the cupboard QR and the keeper screen ask this every
// few seconds and reload only when the answer changes, so a quiet
// store costs one small aggregate per poll and nothing else.
//
// ── Who may ask ───────────────────────────────────────────────────
//
// Two doors, because there are two kinds of caller:
//
//   ?token=<sticker>   the cupboard QR, which has no app login at all.
//                      The token is re-read from the database and must
//                      be live — a revoked sticker stops answering.
//   no token           somebody logged in who may keep the store.
//
// Never open. A list of what the plant holds is not a thing to leave
// on the public internet, even though it is only ids and numbers.
// ──────────────────────────────────────────────────────────────────

import { NextResponse, type NextRequest } from "next/server";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getAuthContext } from "@/lib/auth";
import { canUseCncTools } from "@/lib/cnc-tool-permissions";
import { resolveToolStoreLink } from "@/lib/cnc-tool-guest";
import { stockSignatureFromMap } from "@/lib/cnc-tool-stock";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const token = (req.nextUrl.searchParams.get("token") ?? "").trim();

  if (token) {
    const resolved = await resolveToolStoreLink(token);
    if ("problem" in resolved) {
      return NextResponse.json({ error: "no" }, { status: 404 });
    }
  } else {
    // The logged-in door. getAuthContext() and not requireAuth():
    // requireAuth redirects by throwing, which in a route handler
    // becomes a 500 instead of the 401 a polling client can read and
    // quietly give up on. This also keeps the dev auth bypass working,
    // so the poll behaves here the way it will on the shed floor.
    const { profile } = await getAuthContext();
    if (!profile) return NextResponse.json({ error: "no" }, { status: 401 });
    if (!canUseCncTools(profile)) return NextResponse.json({ error: "no" }, { status: 403 });
  }

  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.rpc("cnc_tool_stock_map");
  if (error) return NextResponse.json({ error: "db" }, { status: 500 });

  const map = (data ?? {}) as Record<string, number | string>;

  return NextResponse.json(
    { sig: stockSignatureFromMap(map), at: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
