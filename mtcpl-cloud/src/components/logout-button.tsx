"use client";

// Mig 080 follow-on (Daksh) — the sign-out flow used to fire
// supabase.auth.signOut() then router.push("/login") with no
// visible feedback. Now delegates to useSignOut() which plays the
// shared SignOutOverlay flourish (gold-pulsing focal box → ✓ done →
// hard redirect). The button keeps its original markup so the
// topbar layout doesn't shift.
import { useSignOut } from "./sign-out-overlay";

export function LogoutButton() {
  const signOut = useSignOut();
  return (
    <button className="secondary-button" onClick={signOut} type="button">
      Sign out
    </button>
  );
}
