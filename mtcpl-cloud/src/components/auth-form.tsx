"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createBrowserSupabaseClient } from "@/lib/supabase/client";

type Mode = "sign_in" | "sign_up";
type Identity = "phone" | "email";

const initialState = {
  email: "",
  phone: "",
  password: "",
  otp: ""
};

export function AuthForm() {
  const router = useRouter();
  const supabase = createBrowserSupabaseClient();

  const [mode, setMode] = useState<Mode>("sign_in");
  const [identity, setIdentity] = useState<Identity>("phone");
  const [form, setForm] = useState(initialState);
  const [needsOtp, setNeedsOtp] = useState(false);
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
      if (identity === "phone") {
        if (mode === "sign_up") {
          const { error: signUpError } = await supabase.auth.signUp({
            phone: form.phone,
            password: form.password
          });

          if (signUpError) throw signUpError;

          setNeedsOtp(true);
          setMessage("SMS verification code sent. Enter the OTP to finish sign up.");
        } else {
          const { error: signInError } = await supabase.auth.signInWithPassword({
            phone: form.phone,
            password: form.password
          });

          if (signInError) throw signInError;
          router.push("/");
          router.refresh();
        }
      } else {
        if (mode === "sign_up") {
          const { error: signUpError } = await supabase.auth.signUp({
            email: form.email,
            password: form.password
          });

          if (signUpError) throw signUpError;
          setMessage("Account created. Check your email if confirmation is enabled.");
        } else {
          const { error: signInError } = await supabase.auth.signInWithPassword({
            email: form.email,
            password: form.password
          });

          if (signInError) throw signInError;
          router.push("/");
          router.refresh();
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to continue.");
    } finally {
      setPending(false);
    }
  }

  async function handleOtpVerify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");

    try {
      const { error: otpError } = await supabase.auth.verifyOtp({
        phone: form.phone,
        token: form.otp,
        type: "sms"
      });

      if (otpError) throw otpError;

      setMessage("Phone verified. Your account is ready.");
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "OTP verification failed.");
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

      <div className="identity-switch">
        <button className={identity === "phone" ? "active" : ""} onClick={() => setIdentity("phone")} type="button">
          Mobile number
        </button>
        <button className={identity === "email" ? "active" : ""} onClick={() => setIdentity("email")} type="button">
          Email
        </button>
      </div>

      {!needsOtp ? (
        <form onSubmit={handlePasswordSubmit} className="stack">
          {identity === "phone" ? (
            <label className="stack">
              <span>Mobile number</span>
              <input
                placeholder="+91XXXXXXXXXX"
                value={form.phone}
                onChange={(event) => updateField("phone", event.target.value)}
                required
              />
            </label>
          ) : (
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
          )}

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
      ) : (
        <form onSubmit={handleOtpVerify} className="stack">
          <label className="stack">
            <span>OTP code</span>
            <input
              placeholder="6 digit code"
              value={form.otp}
              onChange={(event) => updateField("otp", event.target.value)}
              required
            />
          </label>

          <button className="primary-button" disabled={pending} type="submit">
            {pending ? "Verifying..." : "Verify OTP"}
          </button>
        </form>
      )}

      <div className="help-box">
        <p>Suggested production flow:</p>
        <ul>
          <li>Owner, planner, and office users: email and password</li>
          <li>Workers and vendors: mobile number with OTP or mobile number plus password</li>
          <li>Enable MFA for phone based accounts</li>
        </ul>
      </div>

      {message ? <p className="success-text">{message}</p> : null}
      {error ? <p className="error-text">{error}</p> : null}
    </div>
  );
}
