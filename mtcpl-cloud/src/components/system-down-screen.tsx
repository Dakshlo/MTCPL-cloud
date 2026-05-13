// Full-screen maintenance lock shown when system_settings.system_status.down
// is true. Rendered from (app)/layout.tsx INSTEAD of the normal app shell.
//
// For non-developer users: pure read-only — heading, message, last-updated
// timestamp, plus an explicit Sign out option so they can leave the locked
// session if they need to. No other clickable links anywhere.
//
// For developer: same screen + a "Bring system back up" form. This is the
// only way to recover without SQL Editor access. Developer is intentionally
// NOT given full app access during a maintenance window — keeps the
// experience identical to what every other user sees, which makes it
// safer to verify the lock is working before logging off.

import { bringSystemUpFormAction } from "@/app/(app)/settings/system-status-actions";

export function SystemDownScreen({
  isDeveloper,
  message,
  updatedAt,
  updatedByName,
}: {
  isDeveloper: boolean;
  message: string | null;
  updatedAt: string | null;
  updatedByName: string | null;
}) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background:
          "linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #1e1b4b 100%)",
        color: "#f8fafc",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        zIndex: 9999,
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
      }}
    >
      <div
        style={{
          maxWidth: 540,
          width: "100%",
          background: "rgba(15, 23, 42, 0.55)",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          borderRadius: 18,
          padding: "32px 36px",
          textAlign: "center",
          backdropFilter: "blur(12px)",
          boxShadow: "0 30px 80px rgba(0, 0, 0, 0.35)",
        }}
      >
        <div
          style={{
            fontSize: 56,
            lineHeight: 1,
            marginBottom: 16,
            filter: "drop-shadow(0 6px 12px rgba(0,0,0,0.4))",
          }}
          aria-hidden="true"
        >
          🛠️
        </div>

        <h1
          style={{
            margin: 0,
            fontSize: 28,
            fontWeight: 800,
            letterSpacing: "-0.02em",
            color: "#fff",
          }}
        >
          MTCPL is under maintenance
        </h1>

        <p
          style={{
            margin: "12px auto 18px",
            fontSize: 15,
            lineHeight: 1.55,
            color: "rgba(248, 250, 252, 0.78)",
            maxWidth: 420,
          }}
        >
          {message ??
            "The system is temporarily locked while we work on it. Please check back shortly — no action is needed from your side."}
        </p>

        {updatedAt && (
          <div
            style={{
              fontSize: 11,
              color: "rgba(248, 250, 252, 0.55)",
              padding: "8px 14px",
              background: "rgba(255, 255, 255, 0.06)",
              borderRadius: 999,
              display: "inline-block",
              fontWeight: 500,
              letterSpacing: "0.02em",
              marginBottom: 18,
            }}
          >
            Locked at{" "}
            {new Date(updatedAt).toLocaleString("en-IN", {
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
            {updatedByName ? ` · by ${updatedByName}` : ""}
          </div>
        )}

        {isDeveloper && (
          <div
            style={{
              marginTop: 12,
              padding: "16px 18px",
              background: "rgba(99, 102, 241, 0.12)",
              border: "1px solid rgba(165, 180, 252, 0.35)",
              borderRadius: 12,
              textAlign: "left",
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 800,
                color: "#a5b4fc",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                marginBottom: 6,
              }}
            >
              Developer override
            </div>
            <p style={{ margin: "0 0 12px", fontSize: 13, lineHeight: 1.5, color: "rgba(248, 250, 252, 0.85)" }}>
              You're seeing the same lock everyone else sees. Bring the
              system back up below to restore normal access.
            </p>
            <form action={bringSystemUpFormAction}>
              <button
                type="submit"
                style={{
                  width: "100%",
                  padding: "10px 18px",
                  fontSize: 14,
                  fontWeight: 700,
                  background: "#4f46e5",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  cursor: "pointer",
                  letterSpacing: "-0.005em",
                  boxShadow: "0 4px 12px rgba(79, 70, 229, 0.35)",
                }}
              >
                ↑ Bring system back live
              </button>
            </form>
          </div>
        )}

        <form
          action="/api/auth/signout"
          method="post"
          style={{ marginTop: isDeveloper ? 14 : 22 }}
        >
          <button
            type="submit"
            style={{
              background: "transparent",
              border: "1px solid rgba(255, 255, 255, 0.18)",
              color: "rgba(248, 250, 252, 0.7)",
              padding: "8px 18px",
              fontSize: 12,
              fontWeight: 600,
              borderRadius: 8,
              cursor: "pointer",
              letterSpacing: "0.02em",
            }}
          >
            Sign out
          </button>
        </form>

        <p
          style={{
            marginTop: 20,
            fontSize: 11,
            color: "rgba(248, 250, 252, 0.45)",
          }}
        >
          MTCPL · system status
        </p>
      </div>
    </div>
  );
}
