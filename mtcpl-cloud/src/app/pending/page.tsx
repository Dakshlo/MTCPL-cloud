import Link from "next/link";
import { redirect } from "next/navigation";

import { getAuthContext } from "@/lib/auth";

export default async function PendingAccessPage() {
  const { user, profile } = await getAuthContext();

  if (!user || !profile) {
    redirect("/login");
  }

  if (profile.is_active) {
    redirect("/");
  }

  return (
    <main className="pending-shell">
      <section className="pending-card">
        <span className="role-pill pending-pill">Pending approval</span>
        <h1>Welcome to the MTCPL Management System</h1>
        <p>
          Your account has been created successfully. Management will review your request and assign the correct role
          before access is enabled.
        </p>
        <div className="banner" style={{ marginTop: 18 }}>
          Please sign in later using the same email and password you created. Until approval is complete, this waiting
          screen is the only page available to your account.
        </div>
        <div className="stack" style={{ marginTop: 20 }}>
          <p className="muted" style={{ margin: 0 }}>
            Signed in as <strong>{user.email}</strong>
          </p>
          <p className="muted" style={{ margin: 0 }}>
            If you need urgent access, contact the owner or management team to activate your account from the Users
            page.
          </p>
        </div>
        <div className="landing-actions" style={{ marginTop: 24 }}>
          <Link className="secondary-button" href="/login">
            Back to login
          </Link>
        </div>
      </section>
    </main>
  );
}
