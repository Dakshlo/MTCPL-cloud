import Image from "next/image";
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
        <div className="login-copy">
          <Image src="/logo-light.png" alt="MTCPL" width={220} height={72} className="login-logo" />
          <h1>Stone. Precision. Scale.</h1>
          <p>
            Sign in to manage block intake, slab demand, planning, and live cutting sessions from one streamlined
            workspace.
          </p>
          <div className="banner" style={{ marginTop: 20, color: "rgba(248, 246, 242, 0.8)", background: "rgba(255,255,255,0.04)", borderColor: "rgba(232,197,114,0.16)" }}>
            New users remain in a pending state until management activates the account and assigns a core workflow role.
          </div>
        </div>

        <AuthForm />
      </section>
    </main>
  );
}
