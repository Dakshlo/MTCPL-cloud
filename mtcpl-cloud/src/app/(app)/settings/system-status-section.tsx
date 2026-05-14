"use client";

/**
 * Settings → System Status section. Developer-only.
 *
 * Showing the LIVE state: green pill + "Take system down" button.
 * Clicking opens a two-step modal:
 *   • Step 1 — explains what will happen + optional message.
 *   • Step 2 — final confirmation. Requires typing TAKE DOWN to
 *     prevent muscle-memory clicks.
 *
 * Showing the DOWN state: red pill + "Bring system back live"
 * button (no confirmation required — it's the recovery path).
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Result = { ok: true } | { ok: false; error: string };

export function SystemStatusSection({
  isDown,
  message,
  updatedAt,
  updatedByName,
  takeDownAction,
  bringUpAction,
  department,
  scopeLabel,
  scopeIcon,
  scopeDescription,
}: {
  isDown: boolean;
  message: string | null;
  updatedAt: string | null;
  updatedByName: string | null;
  takeDownAction: (formData: FormData) => Promise<Result>;
  bringUpAction: (formData: FormData) => Promise<Result>;
  /** Migration 036 (+ 038 added 'invoicing') — which department this
   *  card controls. Posted as a hidden form field so takeSystemDownAction
   *  / bringSystemUpAction target the right row in system_settings.
   *  `null` = legacy global flag (system_status row from migration
   *  031). */
  department?: "production" | "finance" | "inventory" | "invoicing" | null;
  /** Display title — e.g. "Production · System status". Defaults to
   *  "System status" for the legacy global card. */
  scopeLabel?: string;
  /** Emoji or single-char icon shown in the avatar tile. */
  scopeIcon?: string;
  /** Short copy under the title explaining what this toggle locks. */
  scopeDescription?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [step, setStep] = useState<"closed" | "step1" | "step2">("closed");
  const [maintenanceMessage, setMaintenanceMessage] = useState("");
  const [confirmText, setConfirmText] = useState("");

  function reset() {
    setStep("closed");
    setMaintenanceMessage("");
    setConfirmText("");
    setError(null);
  }

  function withDept(fd: FormData): FormData {
    if (department) fd.set("department", department);
    return fd;
  }

  function runTakeDown() {
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("message", maintenanceMessage.trim());
      withDept(fd);
      const r = await takeDownAction(fd);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      reset();
      router.refresh();
    });
  }

  function runBringUp() {
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      withDept(fd);
      const r = await bringUpAction(fd);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

  const titleText = scopeLabel ?? "System status";
  const iconText = scopeIcon ?? (isDown ? "🛠️" : "🟢");
  const descriptionDown = scopeDescription
    ? `${scopeDescription} The recovery button below brings it back live.`
    : "The whole app is locked for everyone. Bring it back live below when you're done. You'll also see the same lock screen yourself, with this same button on it as a recovery.";
  const descriptionUp = scopeDescription
    ? scopeDescription
    : "Developer-only kill-switch. Takes the entire app offline — every user sees a maintenance screen with nothing clickable. Use during deploys or critical fixes. The toggle requires a typed confirmation.";

  return (
    <div
      style={{
        background: "var(--surface, #fff)",
        border: `1.5px solid ${isDown ? "#dc2626" : "#22c55e"}`,
        borderRadius: 14,
        padding: "18px 20px",
        marginBottom: 18,
        boxShadow: "0 1px 3px rgba(15, 23, 42, 0.06)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 14,
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            background: isDown ? "rgba(220, 38, 38, 0.12)" : "rgba(34, 197, 94, 0.12)",
            color: isDown ? "#b91c1c" : "#15803d",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 22,
            flexShrink: 0,
          }}
          aria-hidden="true"
        >
          {iconText}
        </div>

        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800, letterSpacing: "-0.01em" }}>
              {titleText}
            </h2>
            <span
              style={{
                fontSize: 11,
                fontWeight: 800,
                padding: "3px 10px",
                borderRadius: 999,
                background: isDown ? "rgba(220, 38, 38, 0.12)" : "rgba(34, 197, 94, 0.12)",
                color: isDown ? "#b91c1c" : "#15803d",
                letterSpacing: "0.06em",
                textTransform: "uppercase",
              }}
            >
              ● {isDown ? "Down" : "Live"}
            </span>
          </div>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--muted)", lineHeight: 1.55 }}>
            {isDown ? descriptionDown : descriptionUp}
          </p>
          {isDown && message && (
            <p
              style={{
                margin: "10px 0 0",
                fontSize: 12,
                color: "var(--text)",
                background: "rgba(220, 38, 38, 0.06)",
                border: "1px solid rgba(220, 38, 38, 0.2)",
                padding: "8px 12px",
                borderRadius: 8,
              }}
            >
              <strong>Banner shown to users:</strong> {message}
            </p>
          )}
          {isDown && updatedAt && (
            <p style={{ margin: "8px 0 0", fontSize: 11, color: "var(--muted)" }}>
              Down since{" "}
              {new Date(updatedAt).toLocaleString("en-IN", {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
              {updatedByName ? ` · ${updatedByName}` : ""}
            </p>
          )}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          {isDown ? (
            <button
              type="button"
              onClick={runBringUp}
              disabled={pending}
              style={{
                padding: "10px 18px",
                fontSize: 13,
                fontWeight: 700,
                background: "#22c55e",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                cursor: "pointer",
                boxShadow: "0 1px 2px rgba(34, 197, 94, 0.25)",
              }}
            >
              {pending ? "Bringing up…" : "↑ Bring system back live"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setStep("step1")}
              style={{
                padding: "10px 18px",
                fontSize: 13,
                fontWeight: 700,
                background: "#fff",
                color: "#b91c1c",
                border: "1px solid #b91c1c",
                borderRadius: 8,
                cursor: "pointer",
              }}
            >
              ↓ Take system down…
            </button>
          )}
        </div>
      </div>

      {error && (
        <div
          role="alert"
          style={{
            marginTop: 12,
            padding: "10px 14px",
            background: "rgba(220, 38, 38, 0.08)",
            border: "1px solid #dc2626",
            borderRadius: 8,
            color: "#7f1d1d",
            fontSize: 13,
          }}
        >
          <strong>Action failed:</strong> {error}
        </div>
      )}

      {/* Step 1 modal */}
      {step === "step1" && (
        <ConfirmModal
          tone="warning"
          icon="⚠️"
          title="Take the system down?"
          onClose={reset}
        >
          <p style={{ margin: "0 0 14px", fontSize: 13, lineHeight: 1.6, color: "var(--text)" }}>
            Every signed-in user will see a full-screen maintenance lock.
            Bills can't be entered, cutting can't be marked done, dispatches
            can't be approved — nothing is clickable. Background data is{" "}
            <strong>not affected</strong>.
          </p>
          <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--muted)" }}>
            You'll also see the same lock yourself. Use it to bring the
            system back live when you're done.
          </p>

          <label style={{ display: "block", marginTop: 14 }}>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "var(--muted)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Message to show users (optional)
            </span>
            <textarea
              value={maintenanceMessage}
              onChange={(e) => setMaintenanceMessage(e.target.value)}
              placeholder="e.g. Back in 20 minutes after a quick database fix."
              rows={2}
              style={{
                width: "100%",
                marginTop: 6,
                padding: "9px 12px",
                fontSize: 13,
                border: "1px solid #cbd5e1",
                borderRadius: 8,
                background: "#fff",
                color: "var(--text)",
                resize: "vertical",
                fontFamily: "inherit",
              }}
            />
          </label>

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>
            <button type="button" onClick={reset} style={btnSecondary}>
              Cancel
            </button>
            <button
              type="button"
              onClick={() => setStep("step2")}
              style={btnWarning}
            >
              Continue →
            </button>
          </div>
        </ConfirmModal>
      )}

      {/* Step 2 modal — type-to-confirm */}
      {step === "step2" && (
        <ConfirmModal
          tone="danger"
          icon="🚨"
          title="Last confirmation"
          onClose={reset}
        >
          <p style={{ margin: "0 0 14px", fontSize: 13, lineHeight: 1.6 }}>
            Type <code style={kbdStyle}>TAKE DOWN</code> below to confirm.
            This is the second and final check.
          </p>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="TAKE DOWN"
            autoFocus
            style={{
              width: "100%",
              padding: "10px 12px",
              fontSize: 14,
              fontFamily: "ui-monospace, monospace",
              fontWeight: 700,
              letterSpacing: "0.05em",
              border: "1px solid #cbd5e1",
              borderRadius: 8,
              background: "#fff",
              color: "var(--text)",
              textTransform: "uppercase",
            }}
          />
          <p style={{ margin: "10px 0 0", fontSize: 11, color: "var(--muted)" }}>
            Cancel if you're not sure. The recovery button is on every
            screen for developers, but it's better to not lock the app
            unless you actually need to.
          </p>

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>
            <button type="button" onClick={() => setStep("step1")} style={btnSecondary}>
              ← Back
            </button>
            <button
              type="button"
              onClick={runTakeDown}
              disabled={pending || confirmText.trim().toUpperCase() !== "TAKE DOWN"}
              style={{
                ...btnDanger,
                opacity:
                  pending || confirmText.trim().toUpperCase() !== "TAKE DOWN" ? 0.5 : 1,
                cursor:
                  pending || confirmText.trim().toUpperCase() !== "TAKE DOWN"
                    ? "not-allowed"
                    : "pointer",
              }}
            >
              {pending ? "Taking down…" : "↓ Lock the system"}
            </button>
          </div>
        </ConfirmModal>
      )}
    </div>
  );
}

function ConfirmModal({
  tone,
  icon,
  title,
  onClose,
  children,
}: {
  tone: "warning" | "danger";
  icon: string;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const accent = tone === "danger" ? "#dc2626" : "#b45309";
  const accentBg = tone === "danger" ? "rgba(220, 38, 38, 0.10)" : "rgba(180, 83, 9, 0.10)";
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 200,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          border: `1px solid #e2e8f0`,
          borderRadius: 14,
          padding: 24,
          minWidth: 360,
          maxWidth: 500,
          width: "100%",
          boxShadow: "0 30px 80px rgba(0, 0, 0, 0.20)",
        }}
      >
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 14 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: accentBg,
              color: accent,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 20,
              flexShrink: 0,
            }}
            aria-hidden="true"
          >
            {icon}
          </div>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800, letterSpacing: "-0.01em" }}>
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 28,
              height: 28,
              border: "none",
              background: "transparent",
              fontSize: 18,
              color: "#475569",
              cursor: "pointer",
              borderRadius: 6,
            }}
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const btnSecondary: React.CSSProperties = {
  padding: "9px 16px",
  fontSize: 13,
  fontWeight: 600,
  background: "#fff",
  color: "#475569",
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  cursor: "pointer",
};
const btnWarning: React.CSSProperties = {
  padding: "9px 18px",
  fontSize: 13,
  fontWeight: 700,
  background: "#b45309",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  cursor: "pointer",
};
const btnDanger: React.CSSProperties = {
  padding: "9px 18px",
  fontSize: 13,
  fontWeight: 700,
  background: "#dc2626",
  color: "#fff",
  border: "none",
  borderRadius: 8,
};

const kbdStyle: React.CSSProperties = {
  padding: "2px 8px",
  background: "#f1f5f9",
  border: "1px solid #cbd5e1",
  borderRadius: 4,
  fontFamily: "ui-monospace, monospace",
  fontSize: 12,
  fontWeight: 700,
  color: "#dc2626",
  letterSpacing: "0.05em",
};
