import Link from "next/link";
import { redirect } from "next/navigation";

import { getAuthContext, getDefaultRouteForRole } from "@/lib/auth";

export default async function HomePage() {
  const { user, profile } = await getAuthContext();

  if (user && profile) {
    redirect(getDefaultRouteForRole(profile.role));
  }

  return (
    <main className="landing-shell">
      <section className="landing-card">
        <h1>MTCPL Stone Management Cloud</h1>
        <p>
          This is the cloud version of your prototype. It is designed for shared access across phones and desktops,
          with separate roles for owner, planner, block entry, slab entry, worker, carving assigner, dispatch, and
          vendor users.
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
