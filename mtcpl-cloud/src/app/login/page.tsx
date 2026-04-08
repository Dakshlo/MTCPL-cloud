import { AuthForm } from "@/components/auth-form";

export default function LoginPage() {
  return (
    <main className="login-shell">
      <section className="login-grid">
        <div className="login-copy page-card">
          <h1>MTCPL Login</h1>
          <p>
            This starter supports mobile number or email based sign-in using Supabase Auth. For office staff, email and
            password is usually cleaner. For workers and vendors, mobile number based login is often easier.
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
