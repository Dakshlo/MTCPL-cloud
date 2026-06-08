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
      <div className="login-left">
        <img
          src="/logo-dark.png"
          alt="MTCPL"
          className="login-logo"
        />

        <div className="login-left-copy">
          <h2>Four departments.<br />One platform.</h2>
          <p>
            From yard intake to dispatch, billing to inventory — every
            team works from the same source of truth, on phone,
            tablet, or desktop.
          </p>
        </div>

        <div className="login-departments">
          {[
            {
              key: "production",
              icon: "🏭",
              name: "Production",
              tone: "#c9a14a",
              copy: "Blocks · Cutting · Carving · Dispatch",
            },
            {
              key: "finance",
              icon: "💰",
              name: "Finance",
              tone: "#5e8c4e",
              copy: "Bills · Vendor advances · Pay Today · Audits",
            },
            {
              key: "inventory",
              icon: "📦",
              name: "Inventory",
              tone: "#c87850",
              copy: "Scaffolding · Sites · Stock movements",
            },
            {
              key: "invoicing",
              icon: "📄",
              name: "Invoicing",
              tone: "#7c3aed",
              copy: "Generate · Track · GST-ready",
            },
          ].map((d) => (
            <div key={d.key} className="login-dept-card">
              <span
                className="login-dept-icon"
                style={{
                  background: `${d.tone}22`,
                  color: d.tone,
                }}
                aria-hidden
              >
                {d.icon}
              </span>
              <div className="login-dept-text">
                <div className="login-dept-name">{d.name}</div>
                <div className="login-dept-copy">{d.copy}</div>
              </div>
            </div>
          ))}
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
