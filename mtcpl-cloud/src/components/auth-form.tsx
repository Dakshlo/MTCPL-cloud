"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createBrowserSupabaseClient } from "@/lib/supabase/client";

type Mode = "sign_in" | "sign_up";

export function AuthForm() {
  const router = useRouter();
  const supabase = createBrowserSupabaseClient();

  const [mode, setMode] = useState<Mode>("sign_in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    setMessage("");

    try {
      if (mode === "sign_up") {
        const redirectTo = `${window.location.origin}/auth/callback`;
        const { error: err } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } });
        if (err) throw err;
        setMessage("Check your email and click the confirmation link. Once confirmed, sign in here — management will then activate your account.");
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
        router.push("/");
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to continue.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <h2 style={{ marginBottom: 20, fontSize: 20, fontWeight: 700 }}>
        {mode === "sign_in" ? "Sign in to MTCPL" : "Create account"}
      </h2>

      {/* Mode toggle */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <button
          type="button"
          onClick={() => setMode("sign_in")}
          className={mode === "sign_in" ? "primary-button" : "secondary-button"}
          style={{ flex: 1, fontSize: 13 }}
        >
          Sign in
        </button>
        <button
          type="button"
          onClick={() => setMode("sign_up")}
          className={mode === "sign_up" ? "primary-button" : "secondary-button"}
          style={{ flex: 1, fontSize: 13 }}
        >
          Sign up
        </button>
      </div>

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <label className="stack">
          <span>Email</span>
          <input
            type="email"
            placeholder="owner@mtcpl.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
          />
        </label>

        <label className="stack">
          <span>Password</span>
          <input
            type="password"
            placeholder="Enter password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
          />
        </label>

        <button className="primary-button" disabled={pending} type="submit" style={{ marginTop: 4 }}>
          {pending ? "Please wait…" : mode === "sign_in" ? "Sign in" : "Create account"}
        </button>
      </form>

      {message ? (
        <div className="banner" style={{ marginTop: 14 }}>{message}</div>
      ) : null}

      {error ? (
        <p style={{ marginTop: 14, fontSize: 13, color: "var(--danger)" }}>{error}</p>
      ) : null}
    </div>
  );
}
