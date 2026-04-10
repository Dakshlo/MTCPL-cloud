"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createBrowserSupabaseClient } from "@/lib/supabase/client";

type Mode = "sign_in" | "sign_up";

const initialState = {
  email: "",
  password: ""
};

export function AuthForm() {
  const router = useRouter();
  const supabase = createBrowserSupabaseClient();

  const [mode, setMode] = useState<Mode>("sign_in");
  const [form, setForm] = useState(initialState);
  const [message, setMessage] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [pending, setPending] = useState(false);

  function updateField(field: keyof typeof initialState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handlePasswordSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    setMessage("");

    try {
      if (mode === "sign_up") {
        const { error: signUpError } = await supabase.auth.signUp({
          email: form.email,
          password: form.password
        });

        if (signUpError) throw signUpError;
        setMessage(
          "Account created. Use the same email and password to sign in after confirmation. You will see a waiting screen until management activates and assigns your role."
        );
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: form.email,
          password: form.password
        });

        if (signInError) throw signInError;
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
    <div className="auth-card">
      <div className="auth-switch">
        <button className={mode === "sign_in" ? "active" : ""} onClick={() => setMode("sign_in")} type="button">
          Sign in
        </button>
        <button className={mode === "sign_up" ? "active" : ""} onClick={() => setMode("sign_up")} type="button">
          Sign up
        </button>
      </div>

      <form onSubmit={handlePasswordSubmit} className="stack">
        <label className="stack">
          <span>Email</span>
          <input
            type="email"
            placeholder="owner@mtcpl.com"
            value={form.email}
            onChange={(event) => updateField("email", event.target.value)}
            required
          />
        </label>

        <label className="stack">
          <span>Password</span>
          <input
            type="password"
            placeholder="Enter password"
            value={form.password}
            onChange={(event) => updateField("password", event.target.value)}
            required
          />
        </label>

        <button className="primary-button" disabled={pending} type="submit">
          {pending ? "Please wait..." : mode === "sign_in" ? "Continue" : "Create account"}
        </button>
      </form>

      <div className="help-box">
        <p>Suggested production flow:</p>
        <ul>
          <li>Use company email and password for every operator account</li>
          <li>New accounts wait in a pending state until management activates them</li>
          <li>After approval, each person lands in the workflow area tied to their role</li>
        </ul>
      </div>

      {message ? <p className="success-text">{message}</p> : null}
      {error ? <p className="error-text">{error}</p> : null}
    </div>
  );
}
