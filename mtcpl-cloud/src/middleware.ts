import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { canUseParkota } from "@/lib/parkota-access";
import { readBlackout, BLACKOUT_HTML, COMPANY_URL } from "@/lib/blackout";

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
    if (url && key) {
      const { active, mode } = await readBlackout(url, key);
      if (active && mode === "redirect") {
        /* Send everyone to the public company site instead of showing an
           error. The ERP simply stops appearing to exist at this address.
           302, NEVER 301: browsers cache a permanent redirect aggressively
           and often indefinitely, so a 301 here would keep bouncing staff to
           the company site long after the blackout lifted, with nothing we
           could do from our end to undo it. no-store stops any intermediate
           cache holding on to it either. */
        return NextResponse.redirect(COMPANY_URL, {
          status: 302,
          headers: {
            "Cache-Control": "no-store, no-cache, must-revalidate",
            "X-Robots-Tag": "noindex, nofollow",
          },
        });
      }
      if (active) {
        return new NextResponse(BLACKOUT_HTML, {
          status: 503,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store, no-cache, must-revalidate",
            // Deliberately NO Retry-After. It is a hint about when to come
            // back, and nothing served to the outside should suggest a
            // schedule — the expiry is ours and stays in the database. A bare
            // 503 is already the "temporary, hold the listing" signal search
            // engines act on.
            "X-Robots-Tag": "noindex, nofollow",
          },
        });
      }
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

  // ── The cupboard QR has no app login — don't go looking for one ──
  //
  // Daksh, Nov 2026, for the second time: "it's kicking me again and
  // again from the phone inventory, that this page couldn't load."
  //
  // Everything below this point exists to find out WHICH STAFF MEMBER
  // is making the request. `supabase.auth.getUser()` is not a cookie
  // read — it is a round trip to the Supabase Auth server, on every
  // request. 15,321 of them in the last 24 hours, every one a 200.
  //
  // A man at the cupboard has no app login at all. He is identified by
  // an OTP session of our own (mig 232), read from a cookie by the page
  // itself. So for /guest the auth hop finds nothing, and all it can do
  // is add a network call — and a second place for the request to hang
  // — to every page load, every background refresh and every button he
  // presses on a phone on shed wifi.
  //
  // The blackout above still covers him: it is checked BEFORE this and
  // deliberately has no bypass for anybody. This only skips the lookup
  // of a user who cannot exist on this route.
  if (request.nextUrl.pathname.startsWith("/guest/")) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

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
