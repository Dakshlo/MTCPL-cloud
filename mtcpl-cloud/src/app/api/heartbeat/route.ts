import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export async function POST(req: Request) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false }, { status: 401 });

    // Read the optional pathname the client sends. Body parsing
    // wrapped in try/catch so an empty body doesn't 500 the route.
    let path: string | null = null;
    try {
      const body = (await req.json().catch(() => null)) as { path?: unknown } | null;
      if (body && typeof body.path === "string") {
        const trimmed = body.path.trim();
        if (trimmed && trimmed.length <= 200) {
          path = trimmed;
        }
      }
    } catch {
      // ignore — older clients post empty bodies
    }

    const admin = createAdminSupabaseClient();
    const now = new Date().toISOString();
    const update: { last_seen_at: string; last_path?: string } = { last_seen_at: now };
    if (path) update.last_path = path;
    await admin.from("profiles").update(update).eq("id", user.id);

    // Log ping for screen-time tracking (fire-and-forget)
    admin.from("heartbeat_log").insert({ user_id: user.id, created_at: now }).then(() => {});

    // ── Take the bin out, occasionally (mig 241) ──────────────────
    //
    // Every browser posts here every couple of minutes, so this table
    // grows for ever on its own. By November it held 176,090 rows going
    // back to April and was the single largest consumer of database
    // time on the instance — 3,628 seconds across 11,217 reads — while
    // the only three things that read it (the dashboard, Settings and
    // the AI tool) never look further back than midnight.
    //
    // Mig 241 cut it to sixty days and added the index that makes
    // "who was active today" a seek instead of a walk. This is what
    // stops it creeping back: the table that fills itself also empties
    // itself.
    //
    // One in five hundred pings, which at roughly 700 pings an hour is
    // a sweep every forty minutes or so. Random rather than scheduled
    // because pg_cron is not installed on this project, and a cleanup
    // that lives beside the insert cannot drift away from it the way a
    // separate job would.
    //
    // Fire-and-forget and deliberately unawaited: a heartbeat exists to
    // say somebody is on screen. It must never be slower, and it must
    // never fail, because the bin needed emptying.
    if (Math.random() < 1 / 500) {
      const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
      admin
        .from("heartbeat_log")
        .delete()
        .lt("created_at", cutoff)
        .then(() => {}, () => {});
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
