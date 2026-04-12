import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Handles the email confirmation redirect from Supabase.
 * Supabase sends users here after they click the confirmation link in their email.
 * We exchange the code for a session, then send them to /pending (awaiting owner approval).
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/pending";

  if (code) {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll(); },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          },
        },
      }
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Successfully confirmed — redirect to pending approval page
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Something went wrong — send them to login with a message
  return NextResponse.redirect(`${origin}/login?confirmed=1`);
}
