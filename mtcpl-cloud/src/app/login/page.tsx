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
      <section className="login-grid">
        <div className="login-copy page-card">
          <h1>MTCPL Login</h1>
          <p>
            Sign in with your email and password to access the correct MTCPL portal for your role. Each user should
            have their own account so blocks, planning, cutting, carving, and dispatch stay properly separated.
          </p>

          <div className="banner" style={{ marginTop: 18 }}>
            New users will wait for management approval before their portal becomes active.
          </div>
        </div>

        <AuthForm />
      </section>
    </main>
  );
}
