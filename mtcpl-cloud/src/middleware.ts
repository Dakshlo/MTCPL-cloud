import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { canUseParkota } from "@/lib/parkota-access";
import { isBlackedOut, BLACKOUT_HTML } from "@/lib/blackout";

export async function middleware(request: NextRequest) {
  // ── Full blackout (mig 218) ───────────────────────────────────────
  // Checked FIRST, before auth, before anything. When it is on, every url
  // answers 503 for everybody — staff, owner and developer alike. There is
  // no bypass in the application on purpose: an escape hatch for the
  // developer is an escape hatch for whoever steals a developer session.
  //
  // Middleware is the only layer that can do this. The root layout covers
  // (app) pages but not API routes or the static /parkota file, and a
  // page-level guard cannot answer for a url that has no page.
  //
  // TO BRING THE SYSTEM BACK, in the Supabase SQL editor:
  //   update system_settings set value = '{"on": false}'::jsonb,
  //     updated_at = now() where key = 'blackout';
  // It returns within ~10s. See src/lib/blackout.ts.
  //
  // The flag is cached per instance for 10s, so this is not a database
  // query per request, and it fails OPEN — a Supabase blip cannot black
  // out the site by itself.
  {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (url && key && (await isBlackedOut(url, key))) {
      return new NextResponse(BLACKOUT_HTML, {
        status: 503,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store, no-cache, must-revalidate",
          // Deliberately NO Retry-After. It is a hint about when to come back,
          // and nothing served to the outside should suggest a schedule — the
          // expiry is ours and stays in the database. A bare 503 is already
          // the "temporary, hold the listing" signal search engines act on.
          "X-Robots-Tag": "noindex, nofollow",
        },
      });
    }
  }

  // Migration 036 — surface the request pathname as a header so
  // Server Components can read it via next/headers. The root layout
  // uses this to map the incoming route to a department
  // (Production / Finance / Inventory) and check the matching
  // per-dept maintenance flag. Next.js doesn't expose pathname to
  // Server Components otherwise.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", request.nextUrl.pathname);

  let response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value));
          response = NextResponse.next({
            request: { headers: requestHeaders },
          });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        }
      }
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  // ── Parkota Pillar Tracker gate (mig 207) ────────────────────────
  // /parkota is a ~20 MB self-contained static file in public/, so it is served
  // by the static handler and never passes through requireAuth() the way a page
  // would. Middleware is therefore the only place we can gate the shell itself.
  // The live data has its own identical check in /api/parkota/state — that is
  // the gate that actually protects the board; this one keeps the drawing from
  // being opened by anyone who happens to have the URL.
  if (request.nextUrl.pathname.startsWith("/parkota")) {
    const devBypass = process.env.NODE_ENV === "development" && process.env.DEV_BYPASS_AUTH === "1";
    if (!devBypass) {
      if (!user) return NextResponse.redirect(new URL("/login", request.url));
      // Service-role read: a user must always be able to resolve their own role,
      // and this sidesteps any RLS edge-case on profiles (same reasoning as
      // getAuthContext). supabase-js is fetch-based, so it runs fine here.
      const admin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } },
      );
      const { data: prof } = await admin
        .from("profiles")
        .select("role, is_active")
        .eq("id", user.id)
        .maybeSingle();
      const p = prof as { role?: string; is_active?: boolean } | null;
      if (!p?.is_active || !canUseParkota({ role: p.role ?? "" })) {
        return NextResponse.redirect(new URL("/", request.url));
      }
    }
  }

  return response;
}

export const config = {
  // NOTE: /parkota is deliberately NOT excluded. The tracker is a static file,
  // so middleware is the only thing standing between it and anyone with the
  // URL — see the Parkota gate above. The extra round-trip is the price of
  // that gate, and the browser still revalidates the asset from cache.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
