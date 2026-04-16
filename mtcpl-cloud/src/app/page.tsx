import Link from "next/link";
import { redirect } from "next/navigation";

import { getAuthContext, getDefaultRouteForProfile } from "@/lib/auth";

export default async function HomePage() {
  const { user, profile } = await getAuthContext();

  if (user && profile) {
    redirect(getDefaultRouteForProfile(profile));
  }

  // User authenticated but no profile row yet (trigger race condition) — send to pending
  if (user && !profile) {
    redirect("/pending");
  }

  return (
    <main className="landing-shell">
      <div className="landing-glow" />
      <div className="landing-hero">
        {/* Logo — filter inverts dark logo to white on dark bg */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo-dark.png"
          alt="MTCPL"
          className="landing-logo"
        />

        <div className="landing-tagline">
          <h1>
            Stone. <em>Precision.</em> Scale.
          </h1>
          <p>
            End-to-end block inventory and cutting plan management.<br />
            Built for the yard. Designed for clarity.
          </p>
        </div>

        <Link href="/login" className="landing-cta">
          Enter System →
        </Link>

        <div className="landing-divider" />

        <div className="landing-features">
          <div className="landing-feature">
            <strong>Block Entry</strong>
            <span>Inventory</span>
          </div>
          <div className="landing-feature">
            <strong>Plan Generator</strong>
            <span>Cut Planning</span>
          </div>
          <div className="landing-feature">
            <strong>Cutting</strong>
            <span>Workflow</span>
          </div>
        </div>
      </div>
    </main>
  );
}
