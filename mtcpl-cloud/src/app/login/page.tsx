import { AuthForm } from "@/components/auth-form";

export default function LoginPage() {
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
            Use separate roles in the database so each person only sees the screens they are supposed to access.
          </div>
        </div>

        <AuthForm />
      </section>
    </main>
  );
}
