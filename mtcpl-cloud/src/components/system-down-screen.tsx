// Full-screen maintenance lock shown when system_settings.system_status.down
// is true. Rendered from (app)/layout.tsx INSTEAD of the normal app shell.
//
// For non-developer users: pure read-only — heading, message, last-updated
// timestamp, plus an explicit Sign out option so they can leave the locked
// session if they need to. No other clickable links anywhere.
//
// For developer: same screen + TWO options:
//   1. ↑ Bring system back live  — clears the maintenance flag for
//      everyone. Existing behaviour from migration 031.
//   2. 🔓 Access system anyway   — sets the developer-bypass cookie
//      on THIS browser only. Everyone else stays locked, but the
//      dev can continue working. They see a yellow override banner
//      at the top of every page reminding them maintenance is active.
//      Added per Daksh's request — useful during a deploy where the
//      dev still needs to poke around while the rest of the team is
//      locked out.

import Link from "next/link";
import {
  bringSystemUpFormAction,
  enableDevMaintenanceBypassAction,
} from "@/app/(app)/settings/system-status-actions";

export function SystemDownScreen({
  isDeveloper,
  message,
  updatedAt,
  updatedByName,
  availableDepartments,
}: {
  isDeveloper: boolean;
  message: string | null;
  updatedAt: string | null;
  updatedByName: string | null;
  /** Departments that are NOT down right now AND the current user has
   *  access to. Rendered as quick-jump buttons on the lock screen so
   *  the owner / developer can navigate away from a single-department
   *  outage without needing to type a URL or sign out. Empty for
   *  global locks (everything else is locked too) and for locked
   *  roles that can't switch (biller, accountant, etc). */
  availableDepartments?: ReadonlyArray<{
    id: string;
    label: string;
    icon: string;
    href: string;
  }>;
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
            {new Date(updatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata",
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
            {updatedByName ? ` · by ${updatedByName}` : ""}
          </div>
        )}

        {/* Quick-jump to other departments still live. Visible only
            when this is a per-department lock (the layout passes
            availableDepartments only in that case) AND the user has
            permission to access at least one other department.
            Crucial for owner / developer: production going down
            shouldn't strand them out of Finance + Inventory. */}
        {availableDepartments && availableDepartments.length > 0 && (
          <div
            style={{
              marginTop: 4,
              marginBottom: 18,
              padding: "14px 16px",
              background: "rgba(34, 197, 94, 0.10)",
              border: "1px solid rgba(74, 222, 128, 0.30)",
              borderRadius: 12,
              textAlign: "left",
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 800,
                color: "#86efac",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                marginBottom: 10,
              }}
            >
              Other departments still live
            </div>
            <div
              style={{
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
                justifyContent: "center",
              }}
            >
              {availableDepartments.map((d) => (
                <Link
                  key={d.id}
                  href={d.href}
                  style={{
                    flex: "1 1 140px",
                    padding: "10px 14px",
                    fontSize: 13,
                    fontWeight: 700,
                    textAlign: "center",
                    background: "rgba(255, 255, 255, 0.08)",
                    color: "#f0fdf4",
                    border: "1px solid rgba(74, 222, 128, 0.45)",
                    borderRadius: 8,
                    textDecoration: "none",
                    letterSpacing: "-0.005em",
                  }}
                >
                  {d.icon} Go to {d.label}
                </Link>
              ))}
            </div>
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
              Developer options
            </div>
            <p
              style={{
                margin: "0 0 14px",
                fontSize: 13,
                lineHeight: 1.5,
                color: "rgba(248, 250, 252, 0.85)",
              }}
            >
              You're seeing the same lock everyone else sees. Bring the system
              back up to restore normal access, or use the override below to
              keep working alone while everyone else stays locked.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
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
                  ↑ Bring system back live (for everyone)
                </button>
              </form>
              <form action={enableDevMaintenanceBypassAction}>
                <button
                  type="submit"
                  style={{
                    width: "100%",
                    padding: "10px 18px",
                    fontSize: 13,
                    fontWeight: 700,
                    background: "transparent",
                    color: "#fde68a",
                    border: "1px solid #fbbf24",
                    borderRadius: 8,
                    cursor: "pointer",
                    letterSpacing: "-0.005em",
                  }}
                  title="Bypass the lock for this browser session only. Everyone else stays locked. A banner will appear at the top of every page as a reminder."
                >
                  🔓 Access system anyway (only me, 4 hrs)
                </button>
              </form>
            </div>
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
