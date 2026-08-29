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

import { useEffect, useRef, useState, useTransition } from "react";
import { SecretDot } from "./secret-dot";
import { SignatureCaptureButton } from "@/components/signature-pad";
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
  wipeVendorRoyaltyAction,
  recoverVendorRoyaltyWipeAction,
  getVendorRoyaltyWipeStatusAction,
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
  // Mig 068 — explicit business date the entry represents (when
  // the money / points actually changed hands). NULL on legacy
  // rows added before mig 068; the UI falls back to createdAt for
  // those so the per-vendor history stays readable.
  entryDate: string | null;
  createdAt: string;
  createdByName: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  // Mig 064 — entries added by non-owner roles land in
  // pending_approval and only count toward the net balance once
  // owner approves from the Royalty Approval queue.
  status: "pending_approval" | "approved" | "rejected";
  // Mig 175 — vendor signature (data-URL). NULL on legacy rows.
  signature: string | null;
};

/** Format an entry's date for display on the per-vendor list.
 *  Prefers entry_date (mig 068 — the business date) and falls back
 *  to created_at::date for legacy rows added before the column
 *  existed. Format is "21 May 2026" — short, locale-clear. */
function formatEntryDate(entryDate: string | null, createdAt: string): string {
  const iso = entryDate ?? createdAt.slice(0, 10);
  // Parse as IST midnight so the day never drifts because of UTC.
  const d = new Date(`${iso}T00:00:00+05:30`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Today in IST, YYYY-MM-DD. Default for the new-entry date picker
 *  so adding an entry "right now" works without manual date input. */
function todayIstYmd(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value ?? "0000";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

export function PrivateNotesModal({
  vendorId,
  canShow,
  canCancelRoyalty = false,
  canWipeRoyalty = false,
  canRecoverRoyalty = false,
  embedded = false,
  presetPassphrase = null,
  initialTab = "notes",
  onChanged,
}: {
  vendorId: string;
  canShow: boolean;
  /** Mig 061 follow-on (Daksh): adding a royalty entry stays open
   *  to anyone with private-notes access, but DELETING (cancelling)
   *  one is dev / owner only. Hides the × on each row when false. */
  canCancelRoyalty?: boolean;
  /** Mig 222 — "Clear all points" is owner / developer only. */
  canWipeRoyalty?: boolean;
  /** Mig 222 — only the developer can put a cleared ledger back, and
   *  only for 48h. The owner is never even told a wipe happened. */
  canRecoverRoyalty?: boolean;
  /** Aug 2026 — render inline instead of as a secret-dot + portal
   *  modal. Used by the Royalty Vendors browser, which supplies its
   *  own page chrome and an already-verified passphrase so the owner
   *  can switch vendor after vendor without re-entering it. Same
   *  component, so the panel is identical on both surfaces by
   *  construction rather than by two lists of styles agreeing. */
  embedded?: boolean;
  /** Passphrase the caller has already verified. When set (and
   *  `embedded`), the unlock step is skipped entirely. */
  presetPassphrase?: string | null;
  /** Which tab to land on. The browser wants Royalty, not Notes. */
  initialTab?: Tab;
  /** Fired after anything that moves this vendor's totals (add, cancel,
   *  clear-all, recover) so a host page can refresh its own summary.
   *  A stale vendor list beside a fresh ledger reads as a bug. */
  onChanged?: () => void;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(embedded ? "loading" : "closed");
  const [tab, setTab] = useState<Tab>(initialTab);
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
  // Aug 2026 — loadContent flips to "edit" and fires loadRoyalty WITHOUT
  // awaiting it, so the tab painted with an empty list and read "Nothing
  // here yet" for a beat. On a vendor with twenty entries that says the
  // opposite of the truth. Track the fetch so the columns can say
  // "loading" instead of "empty".
  const [royaltyLoading, setRoyaltyLoading] = useState(true);
  const [royaltyNet, setRoyaltyNet] = useState<number>(0);
  const [royaltyReceived, setRoyaltyReceived] = useState<number>(0);
  const [royaltyGiven, setRoyaltyGiven] = useState<number>(0);
  // New-entry form state
  const [newEntryType, setNewEntryType] = useState<"received" | "given">("received");
  const [newEntryAmount, setNewEntryAmount] = useState<string>("");
  const [newEntryDescription, setNewEntryDescription] = useState<string>("");
  // On-screen vendor signature (optional for now, mig 175). PNG data-URL.
  const [newEntrySignature, setNewEntrySignature] = useState<string | null>(null);
  // Mig 068 — date the entry represents. Pre-filled to today (IST)
  // so adding "right now" is one less click; the user can adjust if
  // they're back-filling a past day.
  const [newEntryDate, setNewEntryDate] = useState<string>(todayIstYmd);
  // Mig 222 — clear-all + its 48h undo.
  const [wipeStep, setWipeStep] = useState<0 | 1 | 2>(0);
  const [wipeBusy, setWipeBusy] = useState(false);
  // Aug 2026 — adding an entry used to be a spinner on a button and
  // nothing else: no confirmation, and the new row appeared somewhere
  // in a list of twenty identical-looking cards. `justAdded` drives a
  // success banner AND a flash on the row it created, so you can see
  // what you just did without hunting for it.
  const [justAdded, setJustAdded] = useState<
    { key: string; type: "received" | "given"; amount: number; date: string } | null
  >(null);
  const [wipeBatch, setWipeBatch] = useState<
    { batchId: string; entryCount: number; wipedAt: string; expiresAt: string; wipedByName: string | null } | null
  >(null);

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
    setRoyaltyLoading(true);
    const fd = new FormData();
    fd.set("vendor_id", vendorId);
    fd.set("passphrase", plain);
    const result = await getVendorRoyaltyEntriesAction(fd);
    if (!result.ok) {
      // Soft fail — keep current entries, surface error if user is
      // on the royalty tab.
      console.warn("[private-notes-modal] royalty load failed", result.error);
      setRoyaltyLoading(false);
      return;
    }
    setRoyaltyEntries(result.entries);
    setRoyaltyNet(result.netBalance);
    setRoyaltyReceived(result.receivedTotal);
    setRoyaltyGiven(result.givenTotal);
    setRoyaltyLoading(false);
    void loadWipeStatus();
  }

  /** Is there a cleared batch still inside its 48h window? Developer
   *  only — the server returns null for everyone else, so the owner's
   *  screen can't reveal that a wipe ever happened. */
  async function loadWipeStatus() {
    if (!canRecoverRoyalty) return;
    const fd = new FormData();
    fd.set("vendor_id", vendorId);
    const res = await getVendorRoyaltyWipeStatusAction(fd);
    if (res.ok) setWipeBatch(res.batch);
  }

  async function handleWipeRoyalty() {
    setError(null);
    setWipeBusy(true);
    try {
      const fd = new FormData();
      fd.set("vendor_id", vendorId);
      fd.set("passphrase", passphrase);
      const res = await wipeVendorRoyaltyAction(fd);
      if (!res.ok) { setError(res.error); return; }
      setWipeStep(0);
      await loadRoyalty(passphrase);
      onChanged?.();
      router.refresh();
    } finally {
      setWipeBusy(false);
    }
  }

  async function handleRecoverRoyalty() {
    if (!wipeBatch) return;
    setError(null);
    setWipeBusy(true);
    try {
      const fd = new FormData();
      fd.set("vendor_id", vendorId);
      fd.set("batch_id", wipeBatch.batchId);
      fd.set("passphrase", passphrase);
      const res = await recoverVendorRoyaltyWipeAction(fd);
      if (!res.ok) { setError(res.error); return; }
      setWipeBatch(null);
      await loadRoyalty(passphrase);
      onChanged?.();
      router.refresh();
    } finally {
      setWipeBusy(false);
    }
  }

  async function handleAddRoyaltyEntry() {
    setError(null);
    const amount = Number(newEntryAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Amount must be a positive number.");
      return;
    }
    // Mig 068 — validate the date client-side too. Same shape +
    // year-range guard as the bill-date validator (validateBillDate
    // on the server is the authoritative check; this catches typos
    // before the round-trip).
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newEntryDate)) {
      setError("Entry date must use a 4-digit year (YYYY-MM-DD).");
      return;
    }
    {
      const y = parseInt(newEntryDate.slice(0, 4), 10);
      const maxY = new Date().getFullYear() + 1;
      if (y < 2015 || y > maxY) {
        setError(`Entry date year ${y} looks wrong — use a year between 2015 and ${maxY}.`);
        return;
      }
    }
    // Jul 2026 (Daksh) — the vendor's signature is MANDATORY on every entry;
    // the owner sees it on the Royalty approvals page before approving.
    if (!newEntrySignature) {
      setError("Vendor signature is required — tap ✍️ Add vendor signature (or 📷 Photo instead) before adding.");
      return;
    }
    startTransition(async () => {
      const fd = new FormData();
      fd.set("vendor_id", vendorId);
      fd.set("entry_type", newEntryType);
      fd.set("amount", String(amount));
      fd.set("entry_date", newEntryDate);
      if (newEntryDescription.trim()) fd.set("description", newEntryDescription.trim());
      fd.set("signature_data", newEntrySignature);
      fd.set("passphrase", passphrase);
      const r = await addVendorRoyaltyEntryAction(fd);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      // Flash-key matches on type + amount + date so the reloaded list
      // can pick out the row this add created without the action
      // having to return an id.
      setJustAdded({
        key: `${newEntryType}|${amount}|${newEntryDate}`,
        type: newEntryType,
        amount,
        date: newEntryDate,
      });
      setNewEntryAmount("");
      setNewEntryDescription("");
      setNewEntrySignature(null);
      // Reset the date back to today so the next entry starts fresh.
      // (User who's back-filling many old entries can just adjust
      // the date again per row — most adds are for "today".)
      setNewEntryDate(todayIstYmd());
      await loadRoyalty(passphrase);
      onChanged?.();
    });
  }

  // Embedded mode — no secret dot, no unlock. Load this vendor with
  // the passphrase the page already holds, and re-load whenever the
  // page switches vendor. That switch is the whole point of the
  // browser: same passphrase, different vendor, no prompt.
  useEffect(() => {
    if (!embedded || !presetPassphrase) return;
    setMode("loading");
    setError(null);
    setJustAdded(null);
    setWipeBatch(null);
    setRoyaltyLoading(true);
    void loadContent(presetPassphrase);
    // loadContent is stable enough for this purpose; re-running on
    // vendor/passphrase change is exactly the intent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedded, presetPassphrase, vendorId]);

  // Clear the just-added banner + row flash after a few seconds.
  useEffect(() => {
    if (!justAdded) return;
    const t = setTimeout(() => setJustAdded(null), 4200);
    return () => clearTimeout(t);
  }, [justAdded]);

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
      onChanged?.();
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
    setNewEntryDate(todayIstYmd());
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

  // ── Tablet unlock SEQUENCE (Daksh). On the vendor profile: double-tap the
  // vendor NAME → 2 taps on the TDS value → 2 taps on the DOT → opens (then the
  // passphrase). The name/TDS elements carry data-unlock="name"/"tds"; the dot
  // reports its taps via onTap. Any wrong tap or a >4s pause resets the sequence.
  const seq = useRef<string[]>([]);
  const seqTs = useRef(0);
  const openRef = useRef(open);
  openRef.current = open;
  const bumpRef = useRef<(step: string) => void>(() => {});
  useEffect(() => {
    function bump(step: string) {
      const now = Date.now();
      if (now - seqTs.current > 4000) seq.current = [];
      seqTs.current = now;
      seq.current.push(step);
      if (seq.current.length > 6) seq.current = seq.current.slice(-6);
      if (seq.current.join(",") === "name,name,tds,tds,dot,dot") {
        seq.current = [];
        void openRef.current();
      }
    }
    bumpRef.current = bump;
    function onClick(e: MouseEvent) {
      const el = (e.target as HTMLElement | null)?.closest?.("[data-unlock]");
      const step = el?.getAttribute("data-unlock");
      if (step === "name" || step === "tds") bump(step);
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  // ── The tiny entry dot. DESKTOP: hover + type "aadesh". TABLET: the tap
  // sequence above (its last two taps land here via onTap). Never a plain click.
  const triggerButton = <SecretDot onUnlock={() => { void open(); }} onTap={() => bumpRef.current("dot")} />;

  if (!embedded && mode === "closed") return triggerButton;

  // ── Modal backdrop ───────────────────────────────────────────────
  // Rendered via React Portal into document.body so click events
  // inside the modal don't bubble back up through the <summary>
  // element on the vendor profile (which would otherwise toggle the
  // <details> "Edit vendor details" panel every time the user
  // interacted with the modal).
  //
  // typeof document check guards SSR — portal can't run server-side.
  if (!embedded && typeof document === "undefined") return triggerButton;

  // ONE panel, two surfaces: the portal modal wraps it in a backdrop,
  // the Royalty Vendors browser drops it straight on the page. Sharing
  // the node is what makes the two look the same — not two style
  // objects that have to be kept in agreement by hand.
  const panel = (
        <div
          style={{
            width: "100%",
            maxWidth: embedded ? "none" : mode === "edit" ? (tab === "royalty" ? 1040 : 880) : 560,
            background: "var(--surface, #fff)",
            border: embedded ? "none" : "1px solid var(--border)",
            borderRadius: embedded ? 0 : 14,
            boxShadow: embedded ? "none" : "0 20px 60px rgba(15, 23, 42, 0.35)",
            padding: embedded ? 0 : 20,
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

                  {/* Add-entry row.
                      Mig 068 — added a date picker so accountants
                      stop encoding the date inside the description
                      ("22/05/2026 PAID TO PINTU BHAI", "21/05/2026").
                      Defaults to today (IST); user can adjust when
                      back-filling. Sits between Amount and
                      Description so the natural left→right flow is
                      Type → Amount → Date → Description → Add. */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "auto 120px 140px 1fr auto",
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
                      type="date"
                      value={newEntryDate}
                      onChange={(e) => setNewEntryDate(e.target.value)}
                      /* Calendar-picker only — same lockdown as the
                         bill date input. Blocks every keystroke
                         except Tab/Esc/Enter so users can't type a
                         wrong year. */
                      onKeyDown={(e) => {
                        if (
                          e.key === "Tab" ||
                          e.key === "Escape" ||
                          e.key === "Enter"
                        ) {
                          return;
                        }
                        e.preventDefault();
                      }}
                      inputMode="none"
                      /* min/max guards stop the calendar picker from
                         even SCROLLING to a wrong year. */
                      min="2015-01-01"
                      max={`${new Date().getFullYear() + 1}-12-31`}
                      title="Pick the date from the calendar — typing is disabled"
                      style={{
                        ...INPUT_STYLE,
                        fontFamily: "ui-monospace, monospace",
                        padding: "7px 10px",
                        caretColor: "transparent",
                        cursor: "pointer",
                      }}
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
                      style={{
                        ...PRIMARY_BUTTON_STYLE,
                        padding: "8px 16px",
                        fontSize: 12,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 7,
                        cursor: pending ? "wait" : !newEntryAmount ? "not-allowed" : "pointer",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {pending && (
                        <span
                          aria-hidden
                          style={{
                            width: 11, height: 11, borderRadius: "50%",
                            border: "2px solid rgba(255,255,255,0.35)",
                            borderTopColor: "#fff",
                            animation: "pvd-spin 0.7s linear infinite",
                            display: "inline-block",
                          }}
                        />
                      )}
                      {pending ? "Adding…" : "+ Add"}
                    </button>
                  </div>

                  {/* On-screen vendor signature (mig 175) — MANDATORY since Jul
                      2026 (Daksh); the owner sees it when approving. Works on
                      tablet (finger/stylus) + desktop; 📷 photo-of-paper too. */}
                  {/* Aug 2026 — this band used to shout in red the whole
                      time the tab was open, so the alarm meant nothing by
                      the time it mattered. It is neutral until you start
                      an entry (an amount typed), red only then, and green
                      with a thumbnail once the vendor has signed. */}
                  {(() => {
                    const started = newEntryAmount.trim().length > 0;
                    const signed = !!newEntrySignature;
                    const tone = signed
                      ? { fg: "#15803d", bd: "solid rgba(22,101,52,0.4)", bg: "rgba(34,197,94,0.07)" }
                      : started
                        ? { fg: "#b91c1c", bd: "dashed #dc2626", bg: "rgba(220,38,38,0.05)" }
                        : { fg: "var(--muted)", bd: "dashed var(--border)", bg: "transparent" };
                    return (
                      <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "8px 11px", borderRadius: 10, border: `1.5px ${tone.bd}`, background: tone.bg, transition: "background .15s ease, border-color .15s ease" }}>
                        <span style={{ fontSize: 11.5, color: tone.fg, fontWeight: 800 }}>
                          {signed
                            ? "✓ Vendor signed"
                            : started
                              ? "Vendor signature * — required before adding"
                              : "Vendor signature * — needed on every entry"}
                        </span>
                        {signed && (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={newEntrySignature}
                            alt="Captured vendor signature"
                            style={{ height: 26, maxWidth: 120, objectFit: "contain", border: "1px solid var(--border)", borderRadius: 5, background: "#fff" }}
                          />
                        )}
                        <span style={{ marginLeft: "auto" }}>
                          <SignatureCaptureButton value={newEntrySignature} onChange={setNewEntrySignature} />
                        </span>
                      </div>
                    );
                  })()}

                  {/* Aug 2026 — say plainly what just happened. The old
                      flow gave a spinner and then silence; you had to
                      go and count the list to know it worked. */}
                  {justAdded && (
                    <div
                      role="status"
                      style={{
                        display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap",
                        padding: "9px 12px", borderRadius: 9,
                        border: `1.5px solid ${justAdded.type === "given" ? "rgba(22,101,52,0.4)" : "rgba(185,28,28,0.4)"}`,
                        background: justAdded.type === "given" ? "rgba(34,197,94,0.09)" : "rgba(220,38,38,0.07)",
                        animation: "pvd-slide-in 0.22s ease-out",
                      }}
                    >
                      <span style={{ fontSize: 14 }}>✓</span>
                      <span style={{ fontSize: 12.5, fontWeight: 800, color: justAdded.type === "given" ? "#15803d" : "#b91c1c" }}>
                        Added — {fmtNum(justAdded.amount)} {justAdded.type === "given" ? "paid" : "received"}
                      </span>
                      <span className="muted" style={{ fontSize: 11.5 }}>
                        {formatEntryDate(justAdded.date, justAdded.date)} · highlighted below
                      </span>
                      <button
                        type="button"
                        onClick={() => setJustAdded(null)}
                        aria-label="Dismiss"
                        style={{ marginLeft: "auto", background: "transparent", border: "none", color: "var(--muted)", fontSize: 13, cursor: "pointer", padding: 2 }}
                      >
                        ✕
                      </button>
                    </div>
                  )}

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
                      flashKey={justAdded?.key ?? null}
                      loading={royaltyLoading}
                      embedded={embedded}
                    />
                    <RoyaltyColumn
                      title="PAID  (+)"
                      color="#15803d"
                      bg="rgba(34, 197, 94, 0.06)"
                      border="rgba(34, 197, 94, 0.30)"
                      entries={royaltyEntries.filter((e) => e.entryType === "given")}
                      onCancel={handleCancelRoyaltyEntry}
                      canCancel={canCancelRoyalty}
                      flashKey={justAdded?.key ?? null}
                      loading={royaltyLoading}
                      embedded={embedded}
                    />
                  </div>

                  {/* Mig 222 — clear the whole ledger. Two presses, and
                      the second one spells out exactly what is about to
                      go. Deliberately the last thing in the tab and
                      styled as a danger zone: it should take effort to
                      reach and never sit next to the Add button. */}
                  {canWipeRoyalty && (
                    <div
                      style={{
                        border: `1px ${wipeStep > 0 ? "solid" : "dashed"} rgba(220,38,38,0.45)`,
                        background: wipeStep > 0 ? "rgba(220,38,38,0.07)" : "transparent",
                        borderRadius: 10,
                        padding: wipeStep > 0 ? "12px 14px" : "9px 12px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 9,
                      }}
                    >
                      {wipeStep === 0 && (
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
                            Clear this vendor&rsquo;s royalty points — received and paid together.
                          </span>
                          <button
                            type="button"
                            onClick={() => setWipeStep(1)}
                            style={{
                              marginLeft: "auto", padding: "7px 13px", fontSize: 12.5, fontWeight: 800,
                              borderRadius: 8, border: "1.5px solid #b91c1c", background: "transparent",
                              color: "#b91c1c", cursor: "pointer", whiteSpace: "nowrap",
                            }}
                          >
                            🗑 Clear all points
                          </button>
                        </div>
                      )}

                      {wipeStep === 1 && (
                        <>
                          <div style={{ fontSize: 13, fontWeight: 800, color: "#b91c1c" }}>
                            Clear all royalty points for this vendor?
                          </div>
                          <div style={{ fontSize: 12, lineHeight: 1.55 }}>
                            {royaltyEntries.length} {royaltyEntries.length === 1 ? "entry" : "entries"} will disappear
                            from this tab and the net balance will read 0. The developer can put it all back for
                            48 hours — after that they are deleted for good.
                          </div>
                          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                            <button type="button" onClick={() => setWipeStep(0)} style={SECONDARY_BUTTON_STYLE}>
                              Keep them
                            </button>
                            <button
                              type="button"
                              onClick={() => setWipeStep(2)}
                              style={{
                                padding: "8px 14px", fontSize: 12.5, fontWeight: 800, borderRadius: 8,
                                border: "1.5px solid #b91c1c", background: "transparent", color: "#b91c1c", cursor: "pointer",
                              }}
                            >
                              Yes, continue →
                            </button>
                          </div>
                        </>
                      )}

                      {wipeStep === 2 && (
                        <>
                          <div style={{ fontSize: 13, fontWeight: 800, color: "#b91c1c" }}>
                            Last check — this empties the tab for everyone.
                          </div>
                          <div style={{ fontSize: 12, lineHeight: 1.55 }}>
                            Received <strong>{royaltyReceived}</strong> · Paid <strong>{royaltyGiven}</strong> ·
                            Net <strong>{royaltyNet >= 0 ? "+" : "−"}{Math.abs(royaltyNet)}</strong> will all read 0.
                            Recoverable for 48 hours, then permanently deleted.
                          </div>
                          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                            <button type="button" onClick={() => setWipeStep(0)} disabled={wipeBusy} style={SECONDARY_BUTTON_STYLE}>
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={handleWipeRoyalty}
                              disabled={wipeBusy}
                              style={{
                                padding: "8px 16px", fontSize: 12.5, fontWeight: 800, borderRadius: 8,
                                border: "none", background: "#b91c1c", color: "#fff",
                                cursor: wipeBusy ? "wait" : "pointer",
                              }}
                            >
                              {wipeBusy ? "Clearing…" : "Clear all points"}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {/* Mig 222 — developer-only recovery. Invisible to the
                      owner, who is not told a wipe happened at all. */}
                  {canRecoverRoyalty && wipeBatch && (
                    <div
                      style={{
                        border: "1.5px solid rgba(37,99,235,0.45)",
                        background: "rgba(37,99,235,0.06)",
                        borderRadius: 10, padding: "11px 13px",
                        display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 800, color: "#1d4ed8" }}>
                          ↺ {wipeBatch.entryCount} {wipeBatch.entryCount === 1 ? "entry" : "entries"} cleared — recoverable
                        </div>
                        <div className="muted" style={{ fontSize: 11, marginTop: 1 }}>
                          Cleared {new Date(wipeBatch.wipedAt).toLocaleString("en-IN")}
                          {wipeBatch.wipedByName ? ` by ${wipeBatch.wipedByName}` : ""} · deleted for good{" "}
                          {new Date(wipeBatch.expiresAt).toLocaleString("en-IN")}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={handleRecoverRoyalty}
                        disabled={wipeBusy}
                        style={{
                          marginLeft: "auto", padding: "8px 14px", fontSize: 12.5, fontWeight: 800,
                          borderRadius: 8, border: "none", background: "#1d4ed8", color: "#fff",
                          cursor: wipeBusy ? "wait" : "pointer", whiteSpace: "nowrap",
                        }}
                      >
                        {wipeBusy ? "Restoring…" : "Bring them back"}
                      </button>
                    </div>
                  )}

                  {!embedded && (
                    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                      <button type="button" onClick={close} style={SECONDARY_BUTTON_STYLE}>
                        Close
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
  );

  // Inline: same panel, no backdrop and no portal — the page around it
  // supplies the chrome.
  if (embedded) return panel;

  const modalContent = (
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
      {panel}
    </div>
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
          fontSize: bold ? 26 : 16,
          fontWeight: bold ? 900 : 700,
          lineHeight: 1.1,
          letterSpacing: bold ? "-0.02em" : undefined,
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
  flashKey = null,
  loading = false,
  embedded = false,
}: {
  title: string;
  color: string;
  bg: string;
  border: string;
  entries: RoyaltyEntry[];
  onCancel: (entryId: string, amount: number) => void;
  canCancel: boolean;
  /** `type|amount|date` of the entry just added, so the row it created
   *  can be picked out of a list of near-identical cards. */
  flashKey?: string | null;
  /** Entries are still being fetched — show that, not "empty". */
  loading?: boolean;
  /** Inline on a page (no inner scroller) vs inside the capped modal. */
  embedded?: boolean;
}) {
  // Tap a card's signature → open it big for a proper look (mig 175).
  const [zoom, setZoom] = useState<string | null>(null);
  useEffect(() => {
    if (!zoom) return;
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") setZoom(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom]);
  // Mig 064 — live = anything not soft-cancelled. The cancelled
  // pile already excluded rejected entries (rejectRoyaltyEntryAction
  // sets both status='rejected' AND cancelled_at). Pending entries
  // ARE shown in the column (with a badge) but the column TOTAL
  // counts only `status='approved'` — matches the net-balance math
  // the server returns.
  const liveEntries = entries.filter((e) => !e.cancelledAt);
  const sum = liveEntries
    .filter((e) => e.status === "approved")
    .reduce((s, e) => s + e.amount, 0);
  const pendingCount = liveEntries.filter((e) => e.status === "pending_approval").length;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 7,
        padding: 11,
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 12,
        // Was a flat 200px floor, which left a tall empty box on the
        // side that had nothing in it. Let the column size to its
        // content and cap the scroll instead.
        minHeight: 0,
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
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          {title}
          {pendingCount > 0 && (
            <span
              title={`${pendingCount} pending approval — not counted in the total above`}
              style={{
                background: "#e5e7eb",
                color: "#4b5563",
                border: "1px solid #9ca3af",
                fontSize: 9,
                fontWeight: 800,
                padding: "1px 6px",
                borderRadius: 999,
                letterSpacing: "0.04em",
              }}
            >
              {pendingCount} PENDING
            </span>
          )}
        </span>
        <span style={{ display: "inline-flex", alignItems: "baseline", gap: 7 }}>
          <span className="muted" style={{ fontSize: 10, fontWeight: 700 }}>
            {liveEntries.length} {liveEntries.length === 1 ? "entry" : "entries"}
          </span>
          <span
            style={{
              fontSize: 14,
              fontWeight: 900,
              color,
              fontFamily: "ui-monospace, monospace",
            }}
          >
            {fmtNum(sum)}
          </span>
        </span>
      </div>
      {/* The modal is height-capped, so its lists scroll inside. On the
          Royalty-by-vendor page the panel sits in normal page flow, and
          an inner scroller there just swallows the wheel — the page
          never moved and the Clear-all row below could not be reached
          (Daksh, Aug 2026). Embedded: let it grow, let the page scroll. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: embedded ? undefined : 420, overflowY: embedded ? "visible" : "auto", paddingRight: 2 }}>
        {loading ? (
          /* Three grey bars rather than a spinner: the list keeps its
             shape while it fills, so nothing jumps when entries land. */
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }} aria-label="Loading entries">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                style={{
                  height: 58,
                  borderRadius: 9,
                  border: "1px solid var(--border)",
                  background: "linear-gradient(90deg, rgba(255,255,255,0.55) 25%, rgba(0,0,0,0.045) 50%, rgba(255,255,255,0.55) 75%)",
                  backgroundSize: "200% 100%",
                  animation: "pvd-shimmer 1.1s ease-in-out infinite",
                  opacity: 1 - i * 0.25,
                }}
              />
            ))}
          </div>
        ) : liveEntries.length === 0 ? (
          <div
            style={{
              fontSize: 11.5,
              color: "var(--muted)",
              textAlign: "center",
              padding: "18px 8px",
              border: "1px dashed var(--border)",
              borderRadius: 9,
              background: "rgba(255,255,255,0.5)",
            }}
          >
            Nothing here yet.
          </div>
        ) : null}
        {liveEntries.map((e) => {
          const isPending = e.status === "pending_approval";
          // Freshly added row — matched on type+amount+date because the
          // add action doesn't hand back an id.
          const isFlash =
            !!flashKey &&
            flashKey === `${e.entryType}|${e.amount}|${e.entryDate ?? ""}`;
          return (
            <div
              key={e.id}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 3,
                padding: "8px 10px",
                background: isPending ? "#f3f4f6" : "#fff",
                border: isFlash
                  ? `2px solid ${color}`
                  : isPending ? "1px dashed #9ca3af" : "1px solid var(--border)",
                borderLeft: isPending ? undefined : `3px solid ${color}`,
                borderRadius: 9,
                boxShadow: isFlash ? `0 0 0 3px ${color}22` : "none",
                fontSize: 12,
                transition: "box-shadow .2s ease, border-color .2s ease",
                // Mig 064 follow-on (Daksh) — pending entries render
                // grayscale so they read as "not real yet" while
                // still being visible. Filter desaturates the row's
                // text + the PENDING pill colour back to greys.
                filter: isPending ? "grayscale(1)" : undefined,
                opacity: isPending ? 0.75 : 1,
              }}
              title={
                isPending
                  ? "Pending owner approval — not counted in the total yet"
                  : undefined
              }
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    fontFamily: "ui-monospace, monospace",
                    fontWeight: 900,
                    fontSize: 15,
                    letterSpacing: "-0.02em",
                    color,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  {fmtNum(e.amount)}
                  {isFlash && (
                    <span style={{ fontSize: 9, fontWeight: 900, color: "#fff", background: color, borderRadius: 999, padding: "1px 7px", letterSpacing: "0.05em" }}>
                      NEW
                    </span>
                  )}
                  {isPending && (
                    <span
                      style={{
                        background: "#e5e7eb",
                        color: "#4b5563",
                        border: "1px solid #9ca3af",
                        fontSize: 9,
                        fontWeight: 800,
                        padding: "1px 5px",
                        borderRadius: 999,
                        letterSpacing: "0.04em",
                      }}
                    >
                      PENDING
                    </span>
                  )}
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
                <span style={{ fontSize: 11.5, color: "var(--text)", fontWeight: 600, lineHeight: 1.35 }}>
                  {e.description}
                </span>
              )}
              {/* Mig 068 — show the business date for the entry.
                  Legacy rows (entryDate NULL) fall back to the row's
                  createdAt date so they keep reading sensibly without
                  any backfill. Format is "21 May 2026" — short,
                  unambiguous. */}
              {/* Date + who added it on ONE line — they were two stacked
                  rows, which made every card two lines taller than it
                  needed to be. */}
              <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", fontSize: 10, color: "var(--muted)" }}>
                <span
                  style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700 }}
                  title={
                    e.entryDate
                      ? "Date this entry happened"
                      : "Date entry was added (legacy — no explicit business date stored)"
                  }
                >
                  {formatEntryDate(e.entryDate, e.createdAt)}
                </span>
                {e.createdByName && (
                  <>
                    <span style={{ opacity: 0.5 }}>·</span>
                    <span style={{ fontStyle: "italic" }}>{e.createdByName}</span>
                  </>
                )}
              </span>
              {/* Mig 175 — vendor signature on this entry (if any). Tap to
                  open it full-size. */}
              {e.signature && (
                <button
                  type="button"
                  onClick={() => setZoom(e.signature)}
                  title="Tap to view the vendor's signature full-size"
                  style={{ marginTop: 2, display: "inline-flex", alignItems: "center", gap: 6, padding: "2px 7px 2px 3px", border: "1px solid var(--border)", borderRadius: 7, background: "#fff", cursor: "zoom-in", alignSelf: "flex-start" }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={e.signature} alt="Vendor signature" style={{ height: 22, maxWidth: 96, objectFit: "contain", borderRadius: 4, background: "#fff" }} />
                  <span style={{ fontSize: 9, fontWeight: 800, color: "var(--muted)", letterSpacing: "0.04em" }}>SIGNED</span>
                </button>
              )}
            </div>
          );
        })}
      </div>
      {/* Full-size signature viewer — tap anywhere / ✕ / Esc closes. Portaled to
          <body> so the modal's backdrop-filter ancestor doesn't clip it. */}
      {zoom && createPortal(
        <div
          onClick={() => setZoom(null)}
          role="dialog"
          aria-modal="true"
          style={{ position: "fixed", inset: 0, zIndex: 7000, background: "rgba(15,23,42,0.72)", backdropFilter: "blur(3px)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 18, gap: 12 }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12, color: "#fff", fontWeight: 800, fontSize: 14.5 }}>
            <span>✍️ Vendor signature</span>
            <button type="button" onClick={() => setZoom(null)} style={{ fontSize: 13, fontWeight: 800, padding: "7px 14px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.4)", background: "rgba(255,255,255,0.12)", color: "#fff", cursor: "pointer" }}>✕ Close</button>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={zoom}
            alt="Vendor signature"
            onClick={(ev) => ev.stopPropagation()}
            style={{ maxWidth: "min(96vw, 900px)", maxHeight: "82vh", objectFit: "contain", background: "#fff", borderRadius: 12, boxShadow: "0 24px 70px rgba(0,0,0,0.5)", padding: 12 }}
          />
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.75)" }}>Tap anywhere to close</div>
        </div>,
        document.body,
      )}
    </div>
  );
}
