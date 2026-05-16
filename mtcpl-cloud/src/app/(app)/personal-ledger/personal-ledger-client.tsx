"use client";

/**
 * Migration 055 — party list client UI.
 * Migration 056 follow-on:
 *   • Banner + "1 party" header + description removed (Daksh).
 *   • Add-party form is no longer always-visible; it's behind a
 *     "+ Add party" button that opens a center-peek modal.
 *   • Every party requires a 4-digit PIN. Legacy parties without
 *     a PIN show a "Set PIN" modal on first entry.
 *   • Per-party row amounts are blurred so the list view never
 *     leaks numbers at a glance.
 *   • Clicking a party row opens an Unlock modal (PIN prompt).
 *     Correct PIN → session cookie set + navigate to detail.
 */

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FinanceLoadingOverlay } from "@/components/finance-loading-overlay";
import {
  ACCOUNTS_TOKENS,
  BUTTON_STYLES,
  INPUT_STYLE,
  VendorAvatar,
} from "../accounts/_ui/components";
import { CenterModal } from "./_ui/center-modal";

export type PartySummary = {
  id: string;
  name: string;
  createdAt: string;
  invoiced: number;
  received: number;
  outstanding: number;
  /** True if this party already has a PIN set (Mig 056). */
  hasPin: boolean;
  /** True if the caller has an active unlock cookie for this party. */
  unlocked: boolean;
};

type ActionResult = { ok: true } | { ok: false; error: string };

export function PersonalLedgerClient({
  parties,
  addAction,
  setPinAction,
  verifyPinAction,
}: {
  parties: PartySummary[];
  addAction: (formData: FormData) => Promise<ActionResult>;
  setPinAction: (formData: FormData) => Promise<ActionResult>;
  verifyPinAction: (formData: FormData) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [quickFilter, setQuickFilter] = useState("");

  const [addOpen, setAddOpen] = useState(false);
  const [pinModal, setPinModal] = useState<{
    party: PartySummary;
  } | null>(null);

  // Mig 056 — if the user just got bounced back here by the detail
  // page's unlock gate (?unlock=<partyId>), pop the unlock modal
  // for that party automatically so they don't have to re-click.
  useEffect(() => {
    const id = searchParams.get("unlock");
    if (!id) return;
    const party = parties.find((p) => p.id === id);
    if (party) setPinModal({ party });
    // Strip the query param so refreshes don't keep popping the modal.
    router.replace("/personal-ledger");
  }, [searchParams, parties, router]);

  const totals = useMemo(() => {
    let invoiced = 0;
    let received = 0;
    for (const p of parties) {
      invoiced += p.invoiced;
      received += p.received;
    }
    return { invoiced, received, outstanding: invoiced - received };
  }, [parties]);

  const filtered = useMemo(() => {
    const q = quickFilter.trim().toLowerCase();
    if (!q) return parties;
    return parties.filter((p) => p.name.toLowerCase().includes(q));
  }, [parties, quickFilter]);

  function onPartyClick(p: PartySummary) {
    // Always prompt via modal — never deep-link. The modal handles
    // both "unlock with existing PIN" and "set first-time PIN" for
    // legacy parties.
    if (p.unlocked) {
      router.push(`/personal-ledger/${p.id}`);
      return;
    }
    setPinModal({ party: p });
  }

  return (
    <section className="page-card">
      <FinanceLoadingOverlay show={pending} label="Working…" />

      {/* Mig 056 — banner / header / description all removed per
          Daksh. Sidebar entry-point (in Settings) labels this
          surface as "Personal — not company books"; the in-page
          banner was redundant. Top KPI strip stays as the primary
          summary; per-party amounts on the row tiles are blurred. */}

      {/* Top-line totals + Add-party CTA */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 14,
          alignItems: "stretch",
          marginBottom: 18,
        }}
      >
        <div
          style={{
            flex: "1 1 540px",
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(140px, 1fr))",
            gap: 12,
          }}
        >
          <TopStat label="Total invoiced" amount={totals.invoiced} tone="accent" />
          <TopStat label="Total received" amount={totals.received} tone="success" />
          <TopStat label="Outstanding" amount={totals.outstanding} tone="warning" />
        </div>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          style={{
            ...BUTTON_STYLES.primary,
            padding: "9px 18px",
            fontSize: 13,
            alignSelf: "center",
          }}
        >
          + Add party
        </button>
      </div>

      {/* Quick filter */}
      {parties.length > 6 && (
        <input
          type="search"
          value={quickFilter}
          onChange={(e) => setQuickFilter(e.target.value)}
          placeholder="🔍 Filter parties by name…"
          style={{ ...INPUT_STYLE, marginBottom: 12 }}
        />
      )}

      {/* Parties list */}
      {parties.length === 0 ? (
        <div
          style={{
            padding: 28,
            background: ACCOUNTS_TOKENS.surfaceMuted,
            border: `1px dashed ${ACCOUNTS_TOKENS.borderStrong}`,
            borderRadius: 10,
            textAlign: "center",
            color: "var(--muted)",
          }}
        >
          No parties yet. Click <strong>+ Add party</strong> to create one.
        </div>
      ) : filtered.length === 0 ? (
        <div
          style={{
            padding: 20,
            color: "var(--muted)",
            fontSize: 13,
            fontStyle: "italic",
            textAlign: "center",
          }}
        >
          No parties match <strong>{quickFilter}</strong>.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filtered.map((p) => (
            <PartyRow key={p.id} party={p} onClick={() => onPartyClick(p)} />
          ))}
        </div>
      )}

      {/* Mig 056 follow-on (Daksh): manage-buckets shortcut removed
          from the list page. Buckets are still reachable at the
          direct URL /personal-ledger/buckets if needed. */}

      {/* Add-party modal */}
      <CenterModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add a new party"
        icon="📓"
        subtitle="Set a 4-digit PIN to lock entry. You'll need it every browser session."
      >
        <AddPartyForm
          addAction={addAction}
          onDone={() => {
            setAddOpen(false);
            router.refresh();
          }}
          pending={pending}
          startTransition={startTransition}
        />
      </CenterModal>

      {/* PIN modal — set-mode for legacy parties, unlock-mode for
          everyone else. */}
      {pinModal && (
        <CenterModal
          open={true}
          onClose={() => setPinModal(null)}
          title={pinModal.party.hasPin ? "Enter PIN" : "Set entry PIN"}
          icon={pinModal.party.hasPin ? "🔒" : "🔑"}
          subtitle={
            pinModal.party.hasPin
              ? `Unlock "${pinModal.party.name}" for this browser session.`
              : `Set a 4-digit PIN to lock "${pinModal.party.name}".`
          }
          maxWidth={420}
        >
          <PinForm
            party={pinModal.party}
            verifyAction={verifyPinAction}
            setAction={setPinAction}
            onUnlocked={() => {
              const partyId = pinModal.party.id;
              setPinModal(null);
              router.push(`/personal-ledger/${partyId}`);
            }}
            pending={pending}
            startTransition={startTransition}
          />
        </CenterModal>
      )}
    </section>
  );
}

// ────────────────────────────────────────────────────────────────
// Add-party form (lives inside the modal)
// ────────────────────────────────────────────────────────────────

function AddPartyForm({
  addAction,
  onDone,
  pending,
  startTransition,
}: {
  addAction: (formData: FormData) => Promise<ActionResult>;
  onDone: () => void;
  pending: boolean;
  startTransition: React.TransitionStartFunction;
}) {
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) return setError("Enter a party name.");
    if (!/^\d{4}$/.test(pin)) return setError("PIN must be exactly 4 digits.");
    if (pin !== pinConfirm) return setError("PINs don't match.");
    startTransition(async () => {
      const fd = new FormData();
      fd.set("name", trimmed);
      fd.set("pin", pin);
      const r = await addAction(fd);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      onDone();
    });
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <label style={fieldLabelStyle()}>Party name</label>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value.slice(0, 200))}
        placeholder="e.g. Cousin Ramesh, Acme Side Project"
        autoFocus
        style={{ ...INPUT_STYLE, fontWeight: 600 }}
      />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <label style={fieldLabelStyle()}>4-digit PIN</label>
          <input
            type="password"
            inputMode="numeric"
            pattern="\d{4}"
            maxLength={4}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
            placeholder="••••"
            style={{
              ...INPUT_STYLE,
              fontFamily: "ui-monospace, monospace",
              fontSize: 18,
              fontWeight: 800,
              letterSpacing: "0.4em",
              textAlign: "center",
            }}
          />
        </div>
        <div>
          <label style={fieldLabelStyle()}>Confirm PIN</label>
          <input
            type="password"
            inputMode="numeric"
            pattern="\d{4}"
            maxLength={4}
            value={pinConfirm}
            onChange={(e) =>
              setPinConfirm(e.target.value.replace(/\D/g, "").slice(0, 4))
            }
            placeholder="••••"
            style={{
              ...INPUT_STYLE,
              fontFamily: "ui-monospace, monospace",
              fontSize: 18,
              fontWeight: 800,
              letterSpacing: "0.4em",
              textAlign: "center",
            }}
          />
        </div>
      </div>

      {error && (
        <div
          role="alert"
          style={{
            padding: "8px 12px",
            background: ACCOUNTS_TOKENS.dangerLight,
            border: `1px solid ${ACCOUNTS_TOKENS.danger}`,
            color: ACCOUNTS_TOKENS.danger,
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={pending || !name.trim() || !pin || !pinConfirm}
        style={{ ...BUTTON_STYLES.primary, padding: "12px 22px", fontSize: 14 }}
      >
        + Add party
      </button>
      <p style={{ margin: 0, fontSize: 11, color: "var(--muted)", lineHeight: 1.5 }}>
        Forgot a PIN? There's no recovery — you'd need a dev to reset it in the
        database. Pick one you'll remember.
      </p>
    </form>
  );
}

// ────────────────────────────────────────────────────────────────
// Unlock / Set-PIN form (lives inside the modal)
// ────────────────────────────────────────────────────────────────

function PinForm({
  party,
  verifyAction,
  setAction,
  onUnlocked,
  pending,
  startTransition,
}: {
  party: PartySummary;
  verifyAction: (formData: FormData) => Promise<ActionResult>;
  setAction: (formData: FormData) => Promise<ActionResult>;
  onUnlocked: () => void;
  pending: boolean;
  startTransition: React.TransitionStartFunction;
}) {
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const setMode = !party.hasPin;

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!/^\d{4}$/.test(pin)) return setError("PIN must be exactly 4 digits.");
    if (setMode && pin !== pinConfirm) return setError("PINs don't match.");
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", party.id);
      fd.set("pin", pin);
      const r = setMode ? await setAction(fd) : await verifyAction(fd);
      if (!r.ok) {
        setError(r.error);
        setPin("");
        if (setMode) setPinConfirm("");
        return;
      }
      onUnlocked();
    });
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <label style={fieldLabelStyle()}>
          {setMode ? "Choose 4-digit PIN" : "PIN"}
        </label>
        <input
          type="password"
          inputMode="numeric"
          pattern="\d{4}"
          maxLength={4}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
          placeholder="••••"
          autoFocus
          style={{
            ...INPUT_STYLE,
            fontFamily: "ui-monospace, monospace",
            fontSize: 26,
            fontWeight: 800,
            letterSpacing: "0.5em",
            textAlign: "center",
            padding: "14px 14px",
          }}
        />
      </div>
      {setMode && (
        <div>
          <label style={fieldLabelStyle()}>Confirm PIN</label>
          <input
            type="password"
            inputMode="numeric"
            pattern="\d{4}"
            maxLength={4}
            value={pinConfirm}
            onChange={(e) =>
              setPinConfirm(e.target.value.replace(/\D/g, "").slice(0, 4))
            }
            placeholder="••••"
            style={{
              ...INPUT_STYLE,
              fontFamily: "ui-monospace, monospace",
              fontSize: 26,
              fontWeight: 800,
              letterSpacing: "0.5em",
              textAlign: "center",
              padding: "14px 14px",
            }}
          />
        </div>
      )}

      {error && (
        <div
          role="alert"
          style={{
            padding: "8px 12px",
            background: ACCOUNTS_TOKENS.dangerLight,
            border: `1px solid ${ACCOUNTS_TOKENS.danger}`,
            color: ACCOUNTS_TOKENS.danger,
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={pending || !pin || (setMode && !pinConfirm)}
        style={{ ...BUTTON_STYLES.primary, padding: "12px 22px", fontSize: 14 }}
      >
        {setMode ? "Set PIN & enter" : "Unlock"}
      </button>
    </form>
  );
}

function fieldLabelStyle(): React.CSSProperties {
  return {
    display: "block",
    fontSize: 11,
    fontWeight: 800,
    color: "var(--muted)",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    marginBottom: 6,
  };
}

// ────────────────────────────────────────────────────────────────
// Top KPI tile
// ────────────────────────────────────────────────────────────────

function TopStat({
  label,
  amount,
  tone,
}: {
  label: string;
  amount: number;
  tone: "accent" | "success" | "warning";
}) {
  const accentColor =
    tone === "success"
      ? ACCOUNTS_TOKENS.success
      : tone === "warning"
      ? ACCOUNTS_TOKENS.warning
      : ACCOUNTS_TOKENS.accent;
  const tintBg =
    tone === "success"
      ? ACCOUNTS_TOKENS.successLight
      : tone === "warning"
      ? ACCOUNTS_TOKENS.warningLight
      : ACCOUNTS_TOKENS.accentLight;
  return (
    <div
      style={{
        padding: "18px 20px 16px",
        background: `linear-gradient(180deg, ${tintBg} 0%, #fff 100%)`,
        border: `1.5px solid ${accentColor}33`,
        borderLeft: `5px solid ${accentColor}`,
        borderRadius: 12,
        boxShadow: ACCOUNTS_TOKENS.shadowLarge,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 800,
          color: accentColor,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
        }}
      >
        {label}
      </div>
      <div style={{ marginTop: 8 }}>
        <span
          style={{
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 26,
            fontWeight: 900,
            color: accentColor,
            letterSpacing: "-0.02em",
          }}
        >
          ₹{amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
        </span>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Party row tile — amounts blurred until unlocked + clicked-through
// ────────────────────────────────────────────────────────────────

function PartyRow({
  party,
  onClick,
}: {
  party: PartySummary;
  onClick: () => void;
}) {
  const cleared = party.outstanding === 0 && party.invoiced > 0;
  const statusColor = cleared
    ? ACCOUNTS_TOKENS.success
    : party.outstanding > 0
    ? ACCOUNTS_TOKENS.warning
    : ACCOUNTS_TOKENS.neutral;
  // Mig 056 — blur EVERY party row amount unconditionally. The
  // list view shouldn't reveal balances at a glance, even for an
  // already-unlocked party (user can still see the real numbers
  // inside the detail page).
  const blurStyle: React.CSSProperties = {
    filter: "blur(7px)",
    userSelect: "none",
  };

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: "#fff",
        border: `1.5px solid ${ACCOUNTS_TOKENS.border}`,
        borderLeft: `6px solid ${statusColor}`,
        borderRadius: 12,
        padding: "16px 18px",
        boxShadow: ACCOUNTS_TOKENS.shadowLarge,
        display: "flex",
        alignItems: "center",
        gap: 14,
        textDecoration: "none",
        color: "var(--text)",
        transition:
          "transform 0.1s ease, box-shadow 0.15s ease, border-color 0.15s ease",
        width: "100%",
        textAlign: "left",
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      <VendorAvatar name={party.name} size={52} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 17,
            fontWeight: 800,
            color: "var(--text)",
            letterSpacing: "-0.01em",
            lineHeight: 1.2,
          }}
        >
          <span>{party.name}</span>
          {/* Lock indicator — small chip to the right of the name */}
          <span
            style={{
              fontSize: 10,
              fontWeight: 800,
              padding: "2px 8px",
              background: party.hasPin
                ? ACCOUNTS_TOKENS.accentLight
                : ACCOUNTS_TOKENS.warningLight,
              color: party.hasPin
                ? ACCOUNTS_TOKENS.accent
                : ACCOUNTS_TOKENS.warning,
              borderRadius: 999,
              border: `1px solid ${
                party.hasPin
                  ? ACCOUNTS_TOKENS.accentBorder
                  : ACCOUNTS_TOKENS.warning + "55"
              }`,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            {party.hasPin ? "🔒 Locked" : "⚠ Set PIN"}
          </span>
        </div>
        <div
          style={{
            display: "flex",
            gap: 14,
            flexWrap: "wrap",
            marginTop: 6,
            fontSize: 12,
          }}
        >
          <span style={{ color: "var(--muted)", fontWeight: 600 }}>
            Invoiced{" "}
            <strong
              style={{
                ...blurStyle,
                display: "inline-block",
                fontFamily: "ui-monospace, monospace",
                color: ACCOUNTS_TOKENS.accent,
                fontWeight: 800,
                fontSize: 13,
                verticalAlign: "middle",
              }}
            >
              ₹{party.invoiced.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
            </strong>
          </span>
          <span style={{ color: "var(--muted)", fontWeight: 600 }}>
            Received{" "}
            <strong
              style={{
                ...blurStyle,
                display: "inline-block",
                fontFamily: "ui-monospace, monospace",
                color: ACCOUNTS_TOKENS.success,
                fontWeight: 800,
                fontSize: 13,
                verticalAlign: "middle",
              }}
            >
              ₹{party.received.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
            </strong>
          </span>
        </div>
      </div>
      <div style={{ textAlign: "right", minWidth: 140 }}>
        <div
          style={{
            fontSize: 10,
            fontWeight: 800,
            color: statusColor,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
          }}
        >
          {cleared ? "✓ Cleared" : "Outstanding"}
        </div>
        <div style={{ marginTop: 4 }}>
          <span
            style={{
              ...blurStyle,
              display: "inline-block",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: 22,
              fontWeight: 900,
              color: statusColor,
              letterSpacing: "-0.02em",
            }}
          >
            ₹
            {(cleared ? 0 : party.outstanding).toLocaleString("en-IN", {
              maximumFractionDigits: 2,
            })}
          </span>
        </div>
      </div>
      <span
        style={{
          fontSize: 22,
          color: statusColor,
          marginLeft: 4,
          fontWeight: 800,
          opacity: 0.75,
        }}
      >
        →
      </span>
    </button>
  );
}
