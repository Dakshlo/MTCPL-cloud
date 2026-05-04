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

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
