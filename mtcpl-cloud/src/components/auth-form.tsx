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
      // shouldCreateUser:false — Jul 2026 bot-signup attack: the open OTP
      // endpoint let bots auto-create 2000+ junk users. Login must NEVER
      // create an account; new users are added by owner/dev in Settings →
      // Users → Add user. ("Allow new signups" is also OFF in the Supabase
      // dashboard — this is belt & braces.)
      const otpPromise = supabase.auth.signInWithOtp({ phone: normalized, options: { shouldCreateUser: false } });
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
        friendly += "\n\nTip: This phone number isn't registered. Ask the owner to add you (Settings → Users → Add user), then try again.";
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
      // Daksh May 2026 round 2 — full-card success takeover. The
      // form swaps out entirely: OTP inputs disappear, a centered
      // "Verified successfully" sits above a pulsing orange-glow
      // rounded square with a white spinning circle inside. Holds
      // for 2000 ms so dad clearly sees the flourish before the
      // page navigates. Auth cookie was already set by verifyOtp
      // so the delay is purely cosmetic.
      setPending(false);
      setSucceeded(true);
      setTimeout(() => {
        window.location.href = "/";
      }, 2000);
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
        @keyframes mtcpl-fade-up {
          from { transform: translateY(8px); opacity: 0; }
          to   { transform: translateY(0); opacity: 1; }
        }
        @keyframes mtcpl-success-pop {
          0%   { transform: scale(0.4); opacity: 0; }
          60%  { transform: scale(1.08); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        /* Daksh May 2026 round 2 — the success-glow box. Pulses an
         * orange-red shadow outward while a white loader spins
         * inside. Matches the Instagram reel dad referenced:
         * "verified successfully" sits above, a glowing rounded
         * square with a spinner is the focal point. */
        @keyframes mtcpl-success-glow {
          0%, 100% {
            box-shadow:
              0 0 32px 8px rgba(249, 115, 22, 0.45),
              0 0 64px 16px rgba(220, 38, 38, 0.25),
              inset 0 0 24px 4px rgba(249, 115, 22, 0.30);
            transform: scale(1);
          }
          50% {
            box-shadow:
              0 0 48px 12px rgba(249, 115, 22, 0.65),
              0 0 96px 24px rgba(220, 38, 38, 0.40),
              inset 0 0 32px 6px rgba(249, 115, 22, 0.45);
            transform: scale(1.04);
          }
        }
        @keyframes mtcpl-aura-rotate {
          to { transform: rotate(360deg); }
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
      `}</style>

      {/* ── Full-card success takeover ─────────────────────────── */}
      {succeeded && (
        <div
          aria-live="polite"
          aria-label="Verified successfully — taking you in"
          style={{
            position: "absolute",
            inset: -36, // cancel the card's 36-px padding so the
                        // takeover fills the whole form-card area
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 28,
            padding: "60px 36px",
            background: "var(--surface, #fff)",
            borderRadius: 16,
            zIndex: 10,
            animation: "mtcpl-fade-up 0.32s ease-out both",
          }}
        >
          <h2
            style={{
              fontSize: 22,
              fontWeight: 800,
              color: "var(--text)",
              letterSpacing: "-0.01em",
              margin: 0,
              textAlign: "center",
              animation: "mtcpl-fade-up 0.4s 0.06s both",
            }}
          >
            Verified successfully
          </h2>
          {/* The glowing focal box. Rounded square, orange-red
              pulsing aura, white loader spinning inside. */}
          <div
            style={{
              position: "relative",
              width: 96,
              height: 96,
              borderRadius: 22,
              background:
                "linear-gradient(135deg, #f97316 0%, #ea580c 50%, #dc2626 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              animation:
                "mtcpl-success-pop 0.48s cubic-bezier(0.34, 1.56, 0.64, 1) both, mtcpl-success-glow 1.8s ease-in-out 0.5s infinite",
            }}
          >
            {/* Inner spinning loader — chunky white ring with one
                missing segment, rotates 0.8 s/cycle. */}
            <span
              aria-hidden
              style={{
                display: "block",
                width: 44,
                height: 44,
                border: "4px solid rgba(255, 255, 255, 0.92)",
                borderTopColor: "transparent",
                borderRadius: "50%",
                animation: "mtcpl-aura-rotate 0.8s linear infinite",
              }}
            />
          </div>
          <p
            style={{
              fontSize: 12.5,
              color: "var(--muted)",
              margin: 0,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              fontWeight: 600,
              animation: "mtcpl-fade-up 0.4s 0.12s both",
            }}
          >
            Taking you in…
          </p>
        </div>
      )}

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

          <label className="stack">
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
              transition: "background 0.2s ease, opacity 0.15s ease",
            }}
          >
            {pending ? (
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
