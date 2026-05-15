"use client";

// ──────────────────────────────────────────────────────────────────
// Vendor private notes modal (mig 050)
// ──────────────────────────────────────────────────────────────────
// Three modes the component flips through:
//
//   1. CLOSED  — only the tiny 🔒 button renders. Designed to be
//      low-visibility on the vendor profile.
//   2. SET     — first-ever-use: passphrase row in DB has hash=null.
//      User picks a passphrase (twice for confirmation).
//   3. UNLOCK  — passphrase set, user enters it to unlock.
//   4. EDIT    — unlocked: textarea with the note, Save / Clear /
//      Lock again buttons.
//
// Session-scoped unlock: once unlocked successfully, we set a
// sessionStorage flag so reloads within the same tab skip the
// passphrase prompt. Closing the tab clears it. Server still
// re-verifies the passphrase on every read/save call regardless
// of the client flag (defence in depth).

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  getVendorNotesPassphraseStatusAction,
  setVendorNotesPassphraseAction,
  verifyVendorNotesPassphraseAction,
  getVendorPrivateNoteAction,
  saveVendorPrivateNoteAction,
  clearVendorPrivateNoteAction,
} from "../../actions";

// Mig 050 follow-on (Daksh, May 2026): session-scoped unlock removed
// per request — "asks every time" is now the default behaviour.
// Previously these keys held a sessionStorage flag + stashed
// passphrase so reopens within the same tab skipped the prompt.
// That was too loose for Daksh's threat model. Each modal open now
// asks for the passphrase fresh.
//
// The constants remain so any old sessionStorage values left over
// from a previous deploy are intentionally NOT used — readers
// always re-verify against the server on every action regardless.

type Mode = "closed" | "loading" | "set" | "unlock" | "edit";

export function PrivateNotesModal({
  vendorId,
  canShow,
}: {
  vendorId: string;
  canShow: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("closed");
  const [content, setContent] = useState<string>("");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [updatedByName, setUpdatedByName] = useState<string | null>(null);
  const [passphrase, setPassphrase] = useState<string>("");
  const [passphrase2, setPassphrase2] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState<boolean>(false);
  const [pending, startTransition] = useTransition();

  if (!canShow) return null;

  async function open() {
    setError(null);
    setMode("loading");
    const status = await getVendorNotesPassphraseStatusAction();
    if (!status.ok) {
      setError(status.error);
      setMode("closed");
      return;
    }
    if (!status.isSet) {
      setMode("set");
      return;
    }
    // Always prompt for the passphrase on open. Previous version
    // cached an unlock for the tab session; Daksh's call: ask every
    // time so an unattended screen doesn't leak the notes.
    setMode("unlock");
  }

  async function loadContent(plain: string) {
    const fd = new FormData();
    fd.set("vendor_id", vendorId);
    fd.set("passphrase", plain);
    const result = await getVendorPrivateNoteAction(fd);
    if (!result.ok) {
      setError(result.error);
      setMode("unlock");
      return;
    }
    setContent(result.content);
    setUpdatedAt(result.updatedAt);
    setUpdatedByName(result.updatedByName);
    setPassphrase(plain);
    setMode("edit");
  }

  function close() {
    setMode("closed");
    setContent("");
    setPassphrase("");
    setPassphrase2("");
    setError(null);
  }

  function handleSetSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (passphrase.length < 6) {
      setError("Passphrase must be at least 6 characters.");
      return;
    }
    if (passphrase !== passphrase2) {
      setError("The two passphrases don't match.");
      return;
    }
    startTransition(async () => {
      const fd = new FormData();
      fd.set("new_plain", passphrase);
      const r = await setVendorNotesPassphraseAction(fd);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      // Now load this vendor's note using the freshly-set passphrase.
      await loadContent(passphrase);
    });
  }

  function handleUnlockSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("plain", passphrase);
      const v = await verifyVendorNotesPassphraseAction(fd);
      if (!v.ok) {
        setError(v.error);
        return;
      }
      await loadContent(passphrase);
    });
  }

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("vendor_id", vendorId);
      fd.set("content", content);
      fd.set("passphrase", passphrase);
      const r = await saveVendorPrivateNoteAction(fd);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
      router.refresh();
    });
  }

  function handleClear() {
    setError(null);
    if (!window.confirm("Clear the note for this vendor? Content will be erased. (Recoverable from Supabase backup within retention window.)")) {
      return;
    }
    startTransition(async () => {
      const fd = new FormData();
      fd.set("vendor_id", vendorId);
      fd.set("passphrase", passphrase);
      const r = await clearVendorPrivateNoteAction(fd);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setContent("");
      router.refresh();
    });
  }

  // ── ESC closes the modal ─────────────────────────────────────────
  useEffect(() => {
    if (mode === "closed") return;
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [mode]);

  // ── The tiny entry button. Renders in-flow, ~22px, muted. ────────
  // stopPropagation on click + mousedown so the parent <summary>
  // element on the vendor profile page doesn't toggle <details>
  // when the user clicks the lock. Same for preventDefault.
  const triggerButton = (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        open();
      }}
      onMouseDown={(e) => e.stopPropagation()}
      title="Private notes"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 22,
        height: 22,
        border: "1px solid rgba(15, 23, 42, 0.10)",
        background: "transparent",
        borderRadius: 6,
        color: "rgba(15, 23, 42, 0.30)",
        fontSize: 11,
        lineHeight: 1,
        cursor: "pointer",
        padding: 0,
      }}
      aria-label="Private notes (developer)"
    >
      🔒
    </button>
  );

  if (mode === "closed") return triggerButton;

  // ── Modal backdrop ───────────────────────────────────────────────
  return (
    <>
      {triggerButton}
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(15, 23, 42, 0.5)",
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1000,
          padding: 16,
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 560,
            background: "var(--surface, #fff)",
            border: "1px solid var(--border)",
            borderRadius: 14,
            boxShadow: "0 20px 60px rgba(15, 23, 42, 0.35)",
            padding: 20,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 18 }} aria-hidden>🔒</span>
              <strong style={{ fontSize: 14 }}>
                {mode === "set" && "Set notes passphrase"}
                {mode === "unlock" && "Unlock private notes"}
                {mode === "edit" && "Private notes"}
                {mode === "loading" && "Loading…"}
              </strong>
            </div>
            <button
              type="button"
              onClick={close}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--muted)",
                fontSize: 18,
                cursor: "pointer",
                padding: 4,
                lineHeight: 1,
              }}
              title="Close (Esc)"
            >
              ×
            </button>
          </div>

          {/* Loading */}
          {mode === "loading" && (
            <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
              Loading…
            </p>
          )}

          {/* SET mode — first-ever-use */}
          {mode === "set" && (
            <form
              onSubmit={handleSetSubmit}
              style={{ display: "flex", flexDirection: "column", gap: 10 }}
            >
              <p style={{ margin: 0, fontSize: 12, color: "var(--muted)", lineHeight: 1.55 }}>
                First time setting up. Pick a passphrase to lock private notes across all vendors.
                Min 6 characters. Don't lose it — recovery requires a developer to reset the lock.
              </p>
              <input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="New passphrase"
                autoFocus
                style={INPUT_STYLE}
              />
              <input
                type="password"
                value={passphrase2}
                onChange={(e) => setPassphrase2(e.target.value)}
                placeholder="Confirm passphrase"
                style={INPUT_STYLE}
              />
              {error && <ErrorBox text={error} />}
              <button
                type="submit"
                disabled={pending}
                style={PRIMARY_BUTTON_STYLE}
              >
                {pending ? "Setting…" : "Set passphrase"}
              </button>
            </form>
          )}

          {/* UNLOCK mode */}
          {mode === "unlock" && (
            <form
              onSubmit={handleUnlockSubmit}
              style={{ display: "flex", flexDirection: "column", gap: 10 }}
            >
              <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>
                Enter the notes passphrase. Lasts for this browser tab session.
              </p>
              <input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="Passphrase"
                autoFocus
                style={INPUT_STYLE}
              />
              {error && <ErrorBox text={error} />}
              <button
                type="submit"
                disabled={pending}
                style={PRIMARY_BUTTON_STYLE}
              >
                {pending ? "Unlocking…" : "Unlock"}
              </button>
            </form>
          )}

          {/* EDIT mode */}
          {mode === "edit" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <p style={{ margin: 0, fontSize: 11, color: "var(--muted)" }}>
                Text only. Max 10,000 characters. Edits are recorded in the audit log (length only, not content).
                {updatedAt && (
                  <>
                    {" · Last edit "}
                    {new Date(updatedAt).toLocaleString("en-IN", {
                      timeZone: "Asia/Kolkata",
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    {updatedByName ? ` by ${updatedByName}` : ""}
                  </>
                )}
              </p>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value.slice(0, 10000))}
                placeholder="Notes about this vendor…"
                rows={12}
                style={{
                  ...INPUT_STYLE,
                  fontFamily: "inherit",
                  resize: "vertical",
                  minHeight: 180,
                }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, fontSize: 11, color: "var(--muted)" }}>
                <span>{content.length} / 10,000 chars</span>
                {savedFlash && (
                  <span style={{ color: "#15803d", fontWeight: 700 }}>✓ Saved</span>
                )}
              </div>
              {error && <ErrorBox text={error} />}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={pending}
                  style={PRIMARY_BUTTON_STYLE}
                >
                  {pending ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={handleClear}
                  disabled={pending || content.length === 0}
                  style={{
                    ...SECONDARY_BUTTON_STYLE,
                    color: "#b91c1c",
                    borderColor: "#b91c1c",
                  }}
                >
                  🗑 Clear
                </button>
                <button
                  type="button"
                  onClick={close}
                  style={SECONDARY_BUTTON_STYLE}
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function ErrorBox({ text }: { text: string }) {
  return (
    <div
      role="alert"
      style={{
        fontSize: 12,
        color: "#b91c1c",
        background: "rgba(220, 38, 38, 0.08)",
        border: "1px solid rgba(220, 38, 38, 0.30)",
        padding: "6px 10px",
        borderRadius: 6,
      }}
    >
      {text}
    </div>
  );
}

const INPUT_STYLE: React.CSSProperties = {
  fontSize: 13,
  padding: "9px 12px",
  border: "1px solid var(--border)",
  borderRadius: 8,
  background: "#fff",
  color: "var(--text)",
  fontFamily: "ui-monospace, monospace",
};

const PRIMARY_BUTTON_STYLE: React.CSSProperties = {
  padding: "9px 16px",
  fontSize: 13,
  fontWeight: 700,
  background: "var(--gold)",
  color: "#fff",
  border: "1.5px solid var(--gold-dark)",
  borderRadius: 8,
  cursor: "pointer",
};

const SECONDARY_BUTTON_STYLE: React.CSSProperties = {
  padding: "9px 16px",
  fontSize: 13,
  fontWeight: 700,
  background: "#fff",
  color: "var(--text)",
  border: "1.5px solid var(--border)",
  borderRadius: 8,
  cursor: "pointer",
};
