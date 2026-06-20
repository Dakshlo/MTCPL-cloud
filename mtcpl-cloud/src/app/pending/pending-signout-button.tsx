"use client";

// Real sign-out for the /pending waiting screen.
//
// /pending lives OUTSIDE the (app) layout, so it has no top-bar logout and no
// SignOutOverlay host. The old "Back to login" link only navigated to /login
// without ending the session — so the user stayed authenticated, got bounced
// straight back to /pending, and couldn't log in with a different number
// without clearing the browser. This button actually clears the Supabase
// session, then hard-redirects so the server cookies are fresh on /login.

import { useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

export function PendingSignOutButton() {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="secondary-button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await createBrowserSupabaseClient().auth.signOut();
        } catch {
          // Even if Supabase choked, still navigate — the auth gate
          // reruns on the next load and will send a stale session back here.
        }
        // Hard navigation (not router.push) so the new page sees cleared cookies.
        window.location.href = "/login";
      }}
    >
      {busy ? "Signing out…" : "Sign out / use another number"}
    </button>
  );
}
