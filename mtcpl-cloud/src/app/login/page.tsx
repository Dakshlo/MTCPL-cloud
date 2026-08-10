import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth-form";
import { getAuthContext, getDefaultRouteForProfile } from "@/lib/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ confirmed?: string; error?: string; reason?: string }>;
}) {
  const { user, profile } = await getAuthContext();

  if (user && profile) {
    redirect(getDefaultRouteForProfile(profile));
  }

  // User authenticated but profile missing or inactive — send to pending
  if (user && !profile) {
    redirect("/pending");
  }

  const params = await searchParams;
  const justConfirmed = params.confirmed === "1";
  const idleLogout = params.reason === "idle";

  return (
    <main className="login-shell">
      {/* Left panel — dark branded. Daksh May 2026 — refreshed
          copy + per-department cards now that we run four
          departments end-to-end (Production / Finance / Inventory
          / Invoicing). */}
      {/* Aug 2026 (Daksh) — the left panel used to carry a "Four
          departments. One platform." pitch and four department cards.
          Everyone who reaches this screen already works here; they're
          signing in, not being sold to. It's now just the mark, the
          product name and a single line, so the eye goes straight to
          the form on the right. */}
      <div className="login-left">
        <img
          src="/logo-dark.png"
          alt="MTCPL"
          className="login-logo"
        />

        <div className="login-brand">
          <h2>MTCPL ERP</h2>
          <p>Mateshwari Temple Construction Pvt. Ltd.</p>
        </div>
      </div>

      {/* Right panel — form */}
      <div className="login-right">
        <div className="login-form-card">
          {justConfirmed && (
            <div className="banner" style={{ marginBottom: 16, background: "var(--accent-green-bg, #f0fdf4)", borderColor: "var(--accent-green, #16a34a)", color: "var(--accent-green, #16a34a)" }}>
              ✓ Email confirmed! You can now sign in. Your account will be activated by management shortly.
            </div>
          )}
          {idleLogout && (
            <div className="banner" style={{ marginBottom: 16, background: "rgba(180,83,9,0.08)", borderColor: "rgba(180,83,9,0.4)", color: "#92400e" }}>
              ⏳ You were signed out after 10 minutes of inactivity, for security. Please sign in again.
            </div>
          )}
          <AuthForm />
          <p className="muted" style={{ marginTop: 16, fontSize: 12, textAlign: "center" }}>
            New accounts require management approval before access is granted.
          </p>
        </div>
      </div>
    </main>
  );
}
