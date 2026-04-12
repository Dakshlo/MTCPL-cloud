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
          <h1>MTCPL Cloud Slab</h1>
          <p>
            Sign in with your email and password to access the correct slab-to-carving portal for your role. This
            system is separate from the stone cutting app so we can redesign the flow safely without touching the live
            production setup.
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
