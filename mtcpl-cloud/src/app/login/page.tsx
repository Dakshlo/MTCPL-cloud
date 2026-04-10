import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth-form";
import { getAuthContext, getDefaultRouteForProfile } from "@/lib/auth";

export default async function LoginPage() {
  const { user, profile } = await getAuthContext();

  if (user && profile) {
    redirect(getDefaultRouteForProfile(profile));
  }

  return (
    <main className="login-shell">
      {/* Left panel — dark branded */}
      <div className="login-left">
        <img
          src="/logo-dark.png"
          alt="MTCPL"
          className="login-logo"
        />

        <div className="login-left-copy">
          <h2>Stone Management,<br />Brought Online</h2>
          <p>
            Track every block from yard to slab. Generate cutting plans, manage workflow, and keep your team in sync.
          </p>
        </div>

        <div className="login-features">
          {[
            "Block inventory with CFT tracking",
            "Automated cut plan generation",
            "Real-time cutting workflow",
            "Role-based access for your team"
          ].map(f => (
            <div key={f} className="login-feature">
              <span className="login-feature-dot" />
              {f}
            </div>
          ))}
        </div>
      </div>

      {/* Right panel — form */}
      <div className="login-right">
        <div className="login-form-card">
          <AuthForm />
          <p className="muted" style={{ marginTop: 16, fontSize: 12, textAlign: "center" }}>
            New accounts require management approval before access is granted.
          </p>
        </div>
      </div>
    </main>
  );
}
