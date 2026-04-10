import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getAuthContext, getDefaultRouteForProfile } from "@/lib/auth";

export default async function HomePage() {
  const { user, profile } = await getAuthContext();

  if (user && profile) {
    redirect(getDefaultRouteForProfile(profile));
  }

  return (
    <main className="landing-shell">
      <section className="landing-hero">
        <div className="landing-kicker">MTCPL Cloud</div>
        <div>
          <Image src="/logo-dark.png" alt="MTCPL" width={240} height={80} className="landing-logo" />
        </div>
        <h1 className="landing-title">Stone. Precision. Scale.</h1>
        <p className="landing-subtitle">End-to-end block tracking and cutting plan system</p>
        <Link className="primary-button" href="/login">
          Open Login
        </Link>
      </section>
    </main>
  );
}
