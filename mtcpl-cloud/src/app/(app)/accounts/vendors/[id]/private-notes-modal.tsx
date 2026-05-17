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
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  getVendorNotesPassphraseStatusAction,
  setVendorNotesPassphraseAction,
  verifyVendorNotesPassphraseAction,
  getVendorPrivateNoteAction,
  saveVendorPrivateNoteAction,
  clearVendorPrivateNoteAction,
  getVendorRoyaltyEntriesAction,
  addVendorRoyaltyEntryAction,
  cancelVendorRoyaltyEntryAction,
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
type Tab = "notes" | "royalty";

type RoyaltyEntry = {
  id: string;
  amount: number;
  entryType: "received" | "given";
  description: string | null;
  createdAt: string;
  createdByName: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
};

export function PrivateNotesModal({
  vendorId,
  canShow,
  canCancelRoyalty = false,
}: {
  vendorId: string;
  canShow: boolean;
  /** Mig 061 follow-on (Daksh): adding a royalty entry stays open
   *  to anyone with private-notes access, but DELETING (cancelling)
   *  one is dev / owner only. Hides the × on each row when false. */
  canCancelRoyalty?: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("closed");
  const [tab, setTab] = useState<Tab>("notes");
  const [content, setContent] = useState<string>("");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [updatedByName, setUpdatedByName] = useState<string | null>(null);
  const [passphrase, setPassphrase] = useState<string>("");
  const [passphrase2, setPassphrase2] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState<boolean>(false);
  const [pending, startTransition] = useTransition();

  // Royalty tab state
  const [royaltyEntries, setRoyaltyEntries] = useState<RoyaltyEntry[]>([]);
  const [royaltyNet, setRoyaltyNet] = useState<number>(0);
  const [royaltyReceived, setRoyaltyReceived] = useState<number>(0);
  const [royaltyGiven, setRoyaltyGiven] = useState<number>(0);
  // New-entry form state
  const [newEntryType, setNewEntryType] = useState<"received" | "given">("received");
  const [newEntryAmount, setNewEntryAmount] = useState<string>("");
  const [newEntryDescription, setNewEntryDescription] = useState<string>("");

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
    // Load royalty entries in the background so switching tabs is
    // instant. Errors here don't block notes display.
    void loadRoyalty(plain);
  }

  async function loadRoyalty(plain: string) {
    const fd = new FormData();
    fd.set("vendor_id", vendorId);
    fd.set("passphrase", plain);
    const result = await getVendorRoyaltyEntriesAction(fd);
    if (!result.ok) {
      // Soft fail — keep current entries, surface error if user is
      // on the royalty tab.
      console.warn("[private-notes-modal] royalty load failed", result.error);
      return;
    }
    setRoyaltyEntries(result.entries);
    setRoyaltyNet(result.netBalance);
    setRoyaltyReceived(result.receivedTotal);
    setRoyaltyGiven(result.givenTotal);
  }

  async function handleAddRoyaltyEntry() {
    setError(null);
    const amount = Number(newEntryAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Amount must be a positive number.");
      return;
    }
    startTransition(async () => {
      const fd = new FormData();
      fd.set("vendor_id", vendorId);
      fd.set("entry_type", newEntryType);
      fd.set("amount", String(amount));
      if (newEntryDescription.trim()) fd.set("description", newEntryDescription.trim());
      fd.set("passphrase", passphrase);
      const r = await addVendorRoyaltyEntryAction(fd);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setNewEntryAmount("");
      setNewEntryDescription("");
      await loadRoyalty(passphrase);
    });
  }

  async function handleCancelRoyaltyEntry(entryId: string, amount: number) {
    setError(null);
    const reason = window.prompt(
      `Cancel this entry (${amount})?\n\nOptional reason (e.g. 'duplicate', 'wrong vendor'):`,
      "",
    );
    if (reason === null) return; // cancelled the prompt
    startTransition(async () => {
      const fd = new FormData();
      fd.set("entry_id", entryId);
      fd.set("cancel_reason", reason || "");
      fd.set("passphrase", passphrase);
      const r = await cancelVendorRoyaltyEntryAction(fd);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      await loadRoyalty(passphrase);
    });
  }

  function close() {
    setMode("closed");
    setTab("notes");
    setContent("");
    setPassphrase("");
    setPassphrase2("");
    setError(null);
    setRoyaltyEntries([]);
    setRoyaltyNet(0);
    setRoyaltyReceived(0);
    setRoyaltyGiven(0);
    setNewEntryType("received");
    setNewEntryAmount("");
    setNewEntryDescription("");
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

  // ── Body-scroll lock while the modal is open ─────────────────────
  // Daksh (May 2026): on small laptop screens, scrolling inside the
  // open modal was moving the page behind it. Lock body overflow so
  // any vertical motion stays inside the modal's own scroll area.
  useEffect(() => {
    if (mode === "closed") return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mode]);

  // ── The tiny entry button. Mig 061 follow-on (Daksh): was a 🔒
  // emoji button — too visible. Now a 14px hit-area with a 6px
  // gray dot inside, so the trigger reads as "neutral marker"
  // rather than "click me". Same passphrase flow on open. */
  // stopPropagation on click + mousedown so the parent <summary>
  // element on the vendor profile page doesn't toggle <details>
  // when the user clicks the dot. Same for preventDefault.
  const triggerButton = (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        open();
      }}
      onMouseDown={(e) => e.stopPropagation()}
      title="Private notes & royalty"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 12,
        height: 12,
        border: "none",
        background: "transparent",
        borderRadius: "50%",
        cursor: "pointer",
        padding: 0,
      }}
      aria-label="Private notes & royalty"
    >
      <span
        aria-hidden
        style={{
          display: "inline-block",
          width: 3,
          height: 3,
          borderRadius: "50%",
          background: "#000",
        }}
      />
    </button>
  );

  if (mode === "closed") return triggerButton;

  // ── Modal backdrop ───────────────────────────────────────────────
  // Rendered via React Portal into document.body so click events
  // inside the modal don't bubble back up through the <summary>
  // element on the vendor profile (which would otherwise toggle the
  // <details> "Edit vendor details" panel every time the user
  // interacted with the modal).
  //
  // typeof document check guards SSR — portal can't run server-side.
  if (typeof document === "undefined") return triggerButton;

  const modalContent = (
    <>
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
          // Daksh (May 2026): grid + place-items + overflow-y:auto so
          // a too-tall modal on a small laptop screen scrolls within
          // the backdrop instead of pushing the page behind it.
          display: "grid",
          placeItems: "center",
          overflowY: "auto",
          zIndex: 1000,
          padding: 16,
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: mode === "edit" ? 880 : 560,
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
                {mode === "edit" && "Private vendor data"}
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

          {/* EDIT mode — tabbed: Notes + Royalty Points (mig 051) */}
          {mode === "edit" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {/* Tab bar */}
              <div
                style={{
                  display: "flex",
                  gap: 0,
                  borderBottom: "1px solid var(--border)",
                  marginBottom: 4,
                }}
              >
                <TabButton active={tab === "notes"} onClick={() => setTab("notes")}>
                  📝 Notes
                </TabButton>
                <TabButton active={tab === "royalty"} onClick={() => setTab("royalty")}>
                  📊 Royalty points
                </TabButton>
              </div>

              {/* NOTES TAB */}
              {tab === "notes" && (
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
                    <button type="button" onClick={handleSave} disabled={pending} style={PRIMARY_BUTTON_STYLE}>
                      {pending ? "Saving…" : "Save"}
                    </button>
                    <button
                      type="button"
                      onClick={handleClear}
                      disabled={pending || content.length === 0}
                      style={{ ...SECONDARY_BUTTON_STYLE, color: "#b91c1c", borderColor: "#b91c1c" }}
                    >
                      🗑 Clear
                    </button>
                    <button type="button" onClick={close} style={SECONDARY_BUTTON_STYLE}>
                      Close
                    </button>
                  </div>
                </div>
              )}

              {/* ROYALTY POINTS TAB — non-monetary unit tracking */}
              {tab === "royalty" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {/* Net balance summary */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr 1fr",
                      gap: 8,
                      padding: 12,
                      background: "var(--surface-alt, #f9fafb)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                    }}
                  >
                    <SummaryStat
                      label="Received (−)"
                      value={royaltyReceived}
                      color="#b91c1c"
                    />
                    <SummaryStat
                      label="Paid (+)"
                      value={royaltyGiven}
                      color="#15803d"
                    />
                    <SummaryStat
                      label="Net balance"
                      value={royaltyNet}
                      color={royaltyNet >= 0 ? "#15803d" : "#b91c1c"}
                      sign={royaltyNet >= 0 ? "+" : "−"}
                      bold
                    />
                  </div>

                  {/* Add-entry row */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "auto 130px 1fr auto",
                      gap: 8,
                      padding: 10,
                      background: "#fff",
                      border: "1px dashed var(--border)",
                      borderRadius: 8,
                      alignItems: "center",
                    }}
                  >
                    <select
                      value={newEntryType}
                      onChange={(e) => setNewEntryType(e.target.value as "received" | "given")}
                      style={{ ...INPUT_STYLE, fontFamily: "inherit", padding: "7px 10px" }}
                    >
                      <option value="received">Received (−)</option>
                      <option value="given">Paid (+)</option>
                    </select>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={newEntryAmount}
                      onChange={(e) => setNewEntryAmount(e.target.value)}
                      placeholder="Amount"
                      style={{ ...INPUT_STYLE, fontFamily: "ui-monospace, monospace", padding: "7px 10px" }}
                    />
                    <input
                      type="text"
                      value={newEntryDescription}
                      onChange={(e) => setNewEntryDescription(e.target.value.slice(0, 500))}
                      placeholder="Description (optional)"
                      style={{ ...INPUT_STYLE, fontFamily: "inherit", padding: "7px 10px" }}
                    />
                    <button
                      type="button"
                      onClick={handleAddRoyaltyEntry}
                      disabled={pending || !newEntryAmount}
                      style={{ ...PRIMARY_BUTTON_STYLE, padding: "8px 14px", fontSize: 12 }}
                    >
                      {pending ? "Adding…" : "+ Add"}
                    </button>
                  </div>

                  {error && <ErrorBox text={error} />}

                  {/* Entries list — two columns (received | given) so
                      Daksh's left/right requirement is met visually. */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 12,
                    }}
                  >
                    <RoyaltyColumn
                      title="RECEIVED  (−)"
                      color="#b91c1c"
                      bg="rgba(220, 38, 38, 0.06)"
                      border="rgba(220, 38, 38, 0.30)"
                      entries={royaltyEntries.filter((e) => e.entryType === "received")}
                      onCancel={handleCancelRoyaltyEntry}
                      canCancel={canCancelRoyalty}
                    />
                    <RoyaltyColumn
                      title="PAID  (+)"
                      color="#15803d"
                      bg="rgba(34, 197, 94, 0.06)"
                      border="rgba(34, 197, 94, 0.30)"
                      entries={royaltyEntries.filter((e) => e.entryType === "given")}
                      onCancel={handleCancelRoyaltyEntry}
                      canCancel={canCancelRoyalty}
                    />
                  </div>

                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <button type="button" onClick={close} style={SECONDARY_BUTTON_STYLE}>
                      Close
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );

  return (
    <>
      {triggerButton}
      {createPortal(modalContent, document.body)}
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

// ── Royalty tab helpers ──────────────────────────────────────────

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "8px 16px",
        fontSize: 13,
        fontWeight: 700,
        background: "transparent",
        color: active ? "var(--text)" : "var(--muted)",
        border: "none",
        borderBottom: active
          ? "2px solid var(--gold-dark)"
          : "2px solid transparent",
        cursor: "pointer",
        marginBottom: -1,
      }}
    >
      {children}
    </button>
  );
}

/** Plain numeric formatter — no rupee sign, no INR-style grouping.
 *  Decimal places kept only when present. Per Daksh's "numbers, not
 *  money" framing. */
function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return "0";
  // Don't show trailing zeros: 1000 → "1000", 1000.5 → "1000.5"
  return n.toString();
}

function SummaryStat({
  label,
  value,
  color,
  sign,
  bold,
}: {
  label: string;
  value: number;
  color: string;
  sign?: string;
  bold?: boolean;
}) {
  const abs = Math.abs(value);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: bold ? 18 : 15,
          fontWeight: 700,
          color,
          fontFamily: "ui-monospace, monospace",
        }}
      >
        {sign}
        {fmtNum(abs)}
      </span>
    </div>
  );
}

function RoyaltyColumn({
  title,
  color,
  bg,
  border,
  entries,
  onCancel,
  canCancel,
}: {
  title: string;
  color: string;
  bg: string;
  border: string;
  entries: RoyaltyEntry[];
  onCancel: (entryId: string, amount: number) => void;
  canCancel: boolean;
}) {
  const liveEntries = entries.filter((e) => !e.cancelledAt);
  const sum = liveEntries.reduce((s, e) => s + e.amount, 0);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: 10,
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 8,
        minHeight: 200,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 4,
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 800,
            color,
            letterSpacing: "0.06em",
          }}
        >
          {title}
        </span>
        <span
          style={{
            fontSize: 13,
            fontWeight: 800,
            color,
            fontFamily: "ui-monospace, monospace",
          }}
        >
          {fmtNum(sum)}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {liveEntries.length === 0 && (
          <span
            style={{
              fontSize: 11,
              color: "var(--muted)",
              fontStyle: "italic",
            }}
          >
            No entries yet.
          </span>
        )}
        {liveEntries.map((e) => (
          <div
            key={e.id}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 2,
              padding: "6px 8px",
              background: "#fff",
              border: "1px solid var(--border)",
              borderRadius: 6,
              fontSize: 12,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  fontFamily: "ui-monospace, monospace",
                  fontWeight: 700,
                  color,
                }}
              >
                {fmtNum(e.amount)}
              </span>
              {canCancel && (
                <button
                  type="button"
                  onClick={() => onCancel(e.id, e.amount)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "var(--muted)",
                    fontSize: 11,
                    cursor: "pointer",
                    padding: 2,
                  }}
                  title="Cancel this entry (logged) — developer / owner only"
                >
                  ✕
                </button>
              )}
            </div>
            {e.description && (
              <span style={{ fontSize: 11, color: "var(--text)" }}>
                {e.description}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
