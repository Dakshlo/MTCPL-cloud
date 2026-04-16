import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export async function POST() {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false }, { status: 401 });

    const admin = createAdminSupabaseClient();
    const now = new Date().toISOString();
    await admin.from("profiles")
      .update({ last_seen_at: now })
      .eq("id", user.id);

    // Log ping for screen-time tracking (fire-and-forget)
    admin.from("heartbeat_log").insert({ user_id: user.id, created_at: now }).then(() => {});

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
