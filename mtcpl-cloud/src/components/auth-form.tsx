"use client";

import { useEffect, useState } from "react";

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
  const supabase = createBrowserSupabaseClient();

  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  // Daksh May 2026 — success overlay state. Set true the moment
  // verifyOtp resolves cleanly; triggers the rainbow-sweep + check
  // pop animation; redirect happens 1100 ms later so the user
  // sees the flourish before the page navigates.
  const [succeeded, setSucceeded] = useState(false);

  async function handleSendOtp(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError("");

    try {
      const normalized = normalizePhone(phone);
      // 20-second timeout race so the button never hangs forever when
      // Supabase / the SMS provider is unreachable. Without this, a
      // network stall or SMS-provider outage left the form stuck on
      // "Sending code…" with no feedback to the user.
      const otpPromise = supabase.auth.signInWithOtp({ phone: normalized });
      const timeoutPromise = new Promise<{ error: Error }>((resolve) =>
        setTimeout(
          () => resolve({ error: new Error("Request timed out — server didn't respond in 20 seconds. Check network or contact support.") }),
          20000,
        ),
      );
      const result = await Promise.race([otpPromise, timeoutPromise]);
      const err = (result as { error?: { message: string } | null }).error;
      if (err) throw err;
      setStep("otp");
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      // Surface raw Supabase error verbatim so the operator can act on
      // it (e.g. "SMS rate limit exceeded", "Phone signups are disabled
      // for this project", "Invalid phone number"). Also log to console
      // for the developer's own debugging.
      // eslint-disable-next-line no-console
      console.error("[auth-form] signInWithOtp failed:", err);
      let friendly = raw;
      // Common cases — append a hint so the end-user knows what to try.
      if (raw.toLowerCase().includes("rate limit")) {
        friendly += "\n\nTip: SMS provider has hit a rate limit. Wait 60 seconds and retry.";
      } else if (raw.toLowerCase().includes("signup") || raw.toLowerCase().includes("disabled")) {
        friendly += "\n\nTip: This phone number isn't registered. Ask the developer to add it to the profiles table first.";
      } else if (raw.toLowerCase().includes("timed out")) {
        friendly += "\n\nTip: Check your internet connection. If it's working, the Supabase project / SMS provider may be down.";
      }
      setError(friendly);
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
      // Daksh May 2026 — show the success flourish before redirect.
      // Pending → false, succeeded → true triggers the overlay; the
      // hard navigation fires 1100 ms later so the user actually
      // sees the rainbow-check animation. Auth cookie is already
      // set by verifyOtp so the delay is purely cosmetic.
      setPending(false);
      setSucceeded(true);
      setTimeout(() => {
        window.location.href = "/";
      }, 1100);
      return;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid or expired code. Try again.");
      setPending(false);
    }
  }

  // Auto-submit when the 6-digit OTP is fully entered — saves a tap
  // and feels modern (matches what users see on banking apps).
  useEffect(() => {
    if (step !== "otp") return;
    if (otp.length !== 6) return;
    if (pending || succeeded) return;
    // Fake form-submit event so the existing handler runs.
    const fakeEvent = { preventDefault: () => {} } as React.FormEvent;
    handleVerifyOtp(fakeEvent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otp, step]);

  return (
    <div style={{ position: "relative" }}>
      {/* ── Inline keyframes for the success flourish + spinner ── */}
      <style>{`
        @keyframes mtcpl-spin {
          to { transform: rotate(360deg); }
        }
        @keyframes mtcpl-rainbow-sweep {
          0%   { background-position: 0% 50%; }
          100% { background-position: 200% 50%; }
        }
        @keyframes mtcpl-check-pop {
          0%   { transform: scale(0) rotate(-45deg); opacity: 0; }
          50%  { transform: scale(1.25) rotate(0deg); opacity: 1; }
          80%  { transform: scale(0.92) rotate(0deg); opacity: 1; }
          100% { transform: scale(1) rotate(0deg); opacity: 1; }
        }
        @keyframes mtcpl-fade-up {
          from { transform: translateY(8px); opacity: 0; }
          to   { transform: translateY(0); opacity: 1; }
        }
        @keyframes mtcpl-card-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(99, 102, 241, 0); }
          50%      { box-shadow: 0 0 0 8px rgba(99, 102, 241, 0.18); }
        }
        @keyframes mtcpl-digit-collide {
          0%   { transform: translateX(0); opacity: 1; }
          60%  { transform: translateX(var(--collide-dx, 0)); opacity: 0.4; }
          100% { transform: translateX(var(--collide-dx, 0)); opacity: 0; }
        }
        .mtcpl-spinner {
          display: inline-block;
          width: 14px;
          height: 14px;
          border: 2px solid currentColor;
          border-top-color: transparent;
          border-radius: 50%;
          animation: mtcpl-spin 0.7s linear infinite;
          vertical-align: -2px;
          margin-right: 8px;
        }
        .mtcpl-otp-input--success {
          background: linear-gradient(
            90deg,
            #f87171,
            #fbbf24,
            #34d399,
            #60a5fa,
            #c084fc,
            #f87171
          );
          background-size: 200% 100%;
          color: transparent !important;
          -webkit-text-fill-color: transparent;
          animation: mtcpl-rainbow-sweep 1.1s linear;
          border-color: transparent !important;
          transition: background 0.18s ease;
        }
      `}</style>

      <h2 style={{ marginBottom: 6, fontSize: 22, fontWeight: 800, letterSpacing: "-0.01em" }}>
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
                borderRight: "none", borderRadius: "8px 0 0 8px",
                fontSize: 14, color: "var(--muted)", flexShrink: 0, whiteSpace: "nowrap",
                fontWeight: 600,
              }}>
                🇮🇳 +91
              </span>
              <input
                type="tel"
                // Daksh May 2026 — removed the "98765 43210" placeholder.
                // It looked pre-filled and confused new users.
                placeholder=""
                value={phone}
                onChange={e => setPhone(e.target.value)}
                required
                maxLength={10}
                style={{
                  borderRadius: "0 8px 8px 0",
                  flex: 1,
                  fontSize: 16,
                  letterSpacing: "0.04em",
                  fontFamily: "ui-monospace, monospace",
                  padding: "10px 14px",
                }}
                inputMode="numeric"
                pattern="[0-9]*"
                autoFocus
              />
            </div>
          </label>

          <button
            className="primary-button"
            disabled={pending || phone.replace(/\D/g, "").length < 10}
            type="submit"
            style={{
              marginTop: 4,
              padding: "11px 16px",
              fontSize: 14,
              fontWeight: 700,
              transition: "opacity 0.15s ease",
            }}
          >
            {pending ? (
              <>
                <span className="mtcpl-spinner" />
                Sending code…
              </>
            ) : (
              "Send OTP →"
            )}
          </button>
        </form>
      ) : (
        <form
          onSubmit={handleVerifyOtp}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 14,
            position: "relative",
          }}
        >
          <div style={{
            background: "var(--surface-alt)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: "10px 14px",
            fontSize: 13,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}>
            <span>
              Code sent to <strong>+91 {phone}</strong>
            </span>
            <button
              type="button"
              onClick={() => { setStep("phone"); setOtp(""); setError(""); }}
              disabled={succeeded}
              style={{
                background: "none",
                border: "none",
                color: "var(--gold)",
                cursor: succeeded ? "not-allowed" : "pointer",
                fontSize: 12,
                fontWeight: 700,
                padding: 0,
                whiteSpace: "nowrap",
              }}
            >
              Change
            </button>
          </div>

          <label className="stack" style={{ position: "relative" }}>
            <span>6-digit OTP</span>
            <input
              type="text"
              placeholder="– – – – – –"
              value={otp}
              onChange={e => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              required
              maxLength={6}
              inputMode="numeric"
              pattern="[0-9]*"
              disabled={succeeded}
              className={succeeded ? "mtcpl-otp-input--success" : undefined}
              style={{
                letterSpacing: 12,
                fontSize: 24,
                textAlign: "center",
                fontFamily: "ui-monospace, monospace",
                fontWeight: 700,
                padding: "12px 14px",
                borderRadius: 10,
                color: "var(--text)",
                transition: "border-color 0.18s ease, background 0.18s ease",
              }}
              autoFocus
            />
            {/* Success-state overlay — sits above the input, shows
                the big check pop + welcome message. Pointer events
                pass through so a screen reader still sees the input
                underneath. */}
            {succeeded && (
              <div
                aria-live="polite"
                style={{
                  position: "absolute",
                  inset: "26px 0 0 0",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 12,
                  pointerEvents: "none",
                  fontWeight: 800,
                  fontSize: 18,
                  color: "#fff",
                  textShadow: "0 1px 2px rgba(0,0,0,0.18)",
                }}
              >
                <span
                  aria-hidden
                  style={{
                    display: "inline-flex",
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    background: "rgba(255,255,255,0.95)",
                    color: "#16a34a",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 18,
                    animation: "mtcpl-check-pop 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) both",
                  }}
                >
                  ✓
                </span>
                <span style={{ animation: "mtcpl-fade-up 0.4s 0.18s both" }}>
                  Welcome back!
                </span>
              </div>
            )}
          </label>

          <button
            className="primary-button"
            disabled={pending || succeeded || otp.length < 6}
            type="submit"
            style={{
              marginTop: 4,
              padding: "11px 16px",
              fontSize: 14,
              fontWeight: 700,
              background: succeeded ? "#16a34a" : undefined,
              transition: "background 0.2s ease, opacity 0.15s ease",
            }}
          >
            {succeeded ? (
              <>✓ Signed in — taking you in…</>
            ) : pending ? (
              <>
                <span className="mtcpl-spinner" />
                Verifying…
              </>
            ) : (
              "Verify & Sign in"
            )}
          </button>

          <button
            type="button"
            className="ghost-button"
            onClick={handleSendOtp}
            disabled={pending || succeeded}
            style={{ fontSize: 13 }}
          >
            Resend code
          </button>
        </form>
      )}

      {error ? (
        <p
          style={{
            marginTop: 14,
            fontSize: 13,
            color: "var(--danger)",
            whiteSpace: "pre-wrap", // honour the \n\n in friendly hint text
            lineHeight: 1.5,
          }}
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
