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
      <section className="landing-card">
        <h1>MTCPL Cloud Slab</h1>
        <p>
          This is the separate slab-to-carving system. It is designed for shared access across phones and desktops,
          with a simpler workflow focused on slab intake, vendor assignment, carving progress, and dispatch.
        </p>

        <div className="landing-actions">
          <Link className="primary-button" href="/login">
            Open login
          </Link>
          <Link className="secondary-button" href="/dashboard">
            Go to app
          </Link>
        </div>
      </section>
    </main>
  );
}
