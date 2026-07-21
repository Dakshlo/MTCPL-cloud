import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function middleware(request: NextRequest) {
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

  await supabase.auth.getUser();
  return response;
}

export const config = {
  // `parkota` is excluded because the Parkota Pillar Tracker is a ~20 MB
  // self-contained static file in public/ (served at /parkota). It needs no
  // Supabase session, so running the auth refresh above on it would just add
  // a network round-trip — and an edge invocation — to every load of a large
  // asset. Covers both /parkota and /parkota-tracker.html.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|parkota).*)"]
};
