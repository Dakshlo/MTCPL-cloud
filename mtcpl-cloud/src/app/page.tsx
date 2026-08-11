import Link from "next/link";
import { redirect } from "next/navigation";

import { getAuthContext, getDefaultRouteForProfile } from "@/lib/auth";
import { getMobileDeveloperLanding } from "@/lib/mobile-landing";

export default async function HomePage() {
  const { user, profile } = await getAuthContext();

  if (user && profile) {
    // Developer on a phone lands straight in Settings — see
    // lib/mobile-landing.ts. Every other role is unaffected.
    const mobileLanding = await getMobileDeveloperLanding(profile);
    redirect(mobileLanding ?? getDefaultRouteForProfile(profile));
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

        {/* Aug 2026 (Daksh) — stripped to logo → headline → one button.
            The marketing tagline and the Block Entry / Plan Generator /
            Cutting feature strip are gone: nobody arriving here is
            choosing a product, they're staff trying to get in. One
            obvious target beats three explanations. */}
        <div className="landing-tagline">
          <h1>
            Stone. <em>Precision.</em> Scale.
          </h1>
        </div>

        {/* The button breathes and carries a travelling sheen, so a
            first-time user can't miss what to press. */}
        <Link href="/login" className="landing-cta landing-cta-live">
          <span>Enter System</span>
          <span className="landing-cta-arrow" aria-hidden="true">
            →
          </span>
        </Link>
      </div>
    </main>
  );
}
