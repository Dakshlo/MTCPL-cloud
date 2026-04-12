"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createBrowserSupabaseClient } from "@/lib/supabase/client";

type Step = "phone" | "otp";

function normalizePhone(raw: string): string {
  // Strip all non-digits
  const digits = raw.replace(/\D/g, "");
  // If user entered 10 digits (Indian), prepend +91
  if (digits.length === 10) return `+91${digits}`;
  // If already has country code (12 digits starting with 91)
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  // Otherwise pass through with + prefix
  return `+${digits}`;
}

export function AuthForm() {
  const router = useRouter();
  const supabase = createBrowserSupabaseClient();

  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function handleSendOtp(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError("");

    try {
      const normalized = normalizePhone(phone);
      const { error: err } = await supabase.auth.signInWithOtp({ phone: normalized });
      if (err) throw err;
      setStep("otp");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send OTP. Check the number and try again.");
    } finally {
      setPending(false);
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError("");

    try {
      const normalized = normalizePhone(phone);
      const { error: err } = await supabase.auth.verifyOtp({
        phone: normalized,
        token: otp.trim(),
        type: "sms",
      });
      if (err) throw err;
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid or expired code. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <h2 style={{ marginBottom: 6, fontSize: 20, fontWeight: 700 }}>
        Sign in to MTCPL
      </h2>
      <p className="muted" style={{ fontSize: 13, marginBottom: 24 }}>
        Enter your mobile number to receive a one-time code
      </p>

      {step === "phone" ? (
        <form onSubmit={handleSendOtp} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <label className="stack">
            <span>Mobile Number</span>
            <div style={{ display: "flex", gap: 0 }}>
              <span style={{
                display: "flex", alignItems: "center", padding: "0 12px",
                background: "var(--surface-alt)", border: "1px solid var(--border)",
                borderRight: "none", borderRadius: "6px 0 0 6px",
                fontSize: 14, color: "var(--muted)", flexShrink: 0, whiteSpace: "nowrap"
              }}>
                🇮🇳 +91
              </span>
              <input
                type="tel"
                placeholder="98765 43210"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                required
                maxLength={10}
                style={{ borderRadius: "0 6px 6px 0", flex: 1 }}
                inputMode="numeric"
                pattern="[0-9]*"
              />
            </div>
          </label>

          <button className="primary-button" disabled={pending} type="submit" style={{ marginTop: 4 }}>
            {pending ? "Sending code…" : "Send OTP →"}
          </button>
        </form>
      ) : (
        <form onSubmit={handleVerifyOtp} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ background: "var(--surface-alt)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 14px", fontSize: 13 }}>
            Code sent to <strong>+91 {phone}</strong>
            <button
              type="button"
              onClick={() => { setStep("phone"); setOtp(""); setError(""); }}
              style={{ background: "none", border: "none", color: "var(--gold)", cursor: "pointer", fontSize: 12, marginLeft: 10, padding: 0 }}
            >
              Change
            </button>
          </div>

          <label className="stack">
            <span>6-digit OTP</span>
            <input
              type="text"
              placeholder="• • • • • •"
              value={otp}
              onChange={e => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              required
              maxLength={6}
              inputMode="numeric"
              pattern="[0-9]*"
              style={{ letterSpacing: 6, fontSize: 20, textAlign: "center", fontFamily: "monospace" }}
              autoFocus
            />
          </label>

          <button className="primary-button" disabled={pending || otp.length < 6} type="submit" style={{ marginTop: 4 }}>
            {pending ? "Verifying…" : "Verify & Sign in"}
          </button>

          <button
            type="button"
            className="ghost-button"
            onClick={handleSendOtp}
            disabled={pending}
            style={{ fontSize: 13 }}
          >
            Resend code
          </button>
        </form>
      )}

      {error ? (
        <p style={{ marginTop: 14, fontSize: 13, color: "var(--danger)" }}>{error}</p>
      ) : null}
    </div>
  );
}
