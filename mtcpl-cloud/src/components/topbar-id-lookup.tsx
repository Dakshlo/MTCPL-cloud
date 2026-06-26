"use client";

// ──────────────────────────────────────────────────────────────────
// Topbar ID Lookup — department-aware quick search.
// ──────────────────────────────────────────────────────────────────
// Daksh originally asked for this as a "find stone on the floor"
// tool. Later (this pass): the same pill should adapt to the user's
// active department:
//
//   Production → slab / block lookup (original behaviour)
//   Finance    → bill token / vendor / payment-reference / vendor
//                bill no lookup
//   Inventory  → site / component lookup with stock breakdown
//
// Trigger pill label stays "Find ID" everywhere; only the panel's
// placeholder, search action, and result rendering swap.
//
// Visibility per department is gated at the layout level:
//   Production → developer / owner / team_head / crosscheck /
//                carving_head (unchanged)
//   Finance    → developer / owner / accountant
//   Inventory  → developer / owner only (per Daksh — only the two
//                roles that hop between departments need it here;
//                storekeeper has the in-page tools)
// ──────────────────────────────────────────────────────────────────

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { lookupId, type LookupResult } from "@/app/(app)/dashboard/lookup-action";
import {
  lookupFinance,
  type FinanceLookupResult,
} from "@/app/(app)/accounts/lookup-action";
import {
  lookupInventory,
  type InventoryLookupResult,
} from "@/app/(app)/inventory/lookup-action";

export type LookupDomain = "production" | "finance" | "inventory";

const STATUS_TONE: Record<string, { fg: string; bg: string }> = {
  open:                { fg: "#0f766e", bg: "rgba(15,118,110,0.10)" },
  planned:             { fg: "#1e40af", bg: "rgba(30,64,175,0.10)" },
  cutting:             { fg: "#9a3412", bg: "rgba(154,52,18,0.10)" },
  awaiting_approval:   { fg: "#9a3412", bg: "rgba(154,52,18,0.10)" },
  cut_done:            { fg: "#15803d", bg: "rgba(21,128,61,0.10)" },
  carving_assigned:    { fg: "#7c3aed", bg: "rgba(124,58,237,0.10)" },
  carving_in_progress: { fg: "#7c3aed", bg: "rgba(124,58,237,0.10)" },
  // Synthetic status (NOT a DB value) — Find ID swaps it in when a carving
  // job is done but its review approval is still pending, so the slab reads
  // "carving approval pending" instead of "carving in progress".
  carving_approval_pending: { fg: "#b45309", bg: "rgba(217,119,6,0.14)" },
  completed:           { fg: "#15803d", bg: "rgba(21,128,61,0.10)" },
  dispatched:          { fg: "#1e40af", bg: "rgba(30,64,175,0.10)" },
  rejected:            { fg: "#b91c1c", bg: "rgba(185,28,28,0.10)" },
  available:           { fg: "#15803d", bg: "rgba(21,128,61,0.10)" },
  reserved:            { fg: "#9a3412", bg: "rgba(154,52,18,0.10)" },
  consumed:            { fg: "#525252", bg: "rgba(82,82,82,0.10)" },
  discarded:           { fg: "#525252", bg: "rgba(82,82,82,0.10)" },
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// Date + time (IST) — used where the exact moment matters, e.g. when a
// carving was completed / approved in Find ID.
function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtNum(n: number, digits = 1): string {
  return n.toLocaleString("en-IN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

type AnyLookupResult = LookupResult | FinanceLookupResult | InventoryLookupResult;

export function TopbarIdLookup({ domain }: { domain: LookupDomain }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnyLookupResult | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  // The result panel is portaled to <body> so it escapes the sticky topbar's
  // z-index:50 stacking context — on tablet the menu/backdrop/hamburger
  // (z 200-301) would otherwise paint over it. panelRef keeps the
  // outside-click handler from treating clicks INSIDE the portaled panel as
  // "outside"; `mounted` gates createPortal to the client.
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Daksh May 2026 — lifted from the keypad so the input itself can
  // react. When the touch keypad is ON we want to BLOCK the device's
  // soft keyboard from popping up (otherwise both keyboards stack).
  // The trick: inputMode="none" — desktop browsers ignore it (real
  // keyboard still types), mobile/tablet browsers suppress the
  // virtual keyboard. Auto-detect runs once on mount.
  const [keypadShown, setKeypadShown] = useState<boolean>(false);
  // Daksh June 2026 — after a search the on-screen keypad collapses so
  // the (often long) result has room; tapping the search box re-opens
  // it. Separate from keypadShown (the on/off preference) so the toggle
  // label stays correct while it's just collapsed.
  const [keypadCollapsed, setKeypadCollapsed] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem("mtcpl_findid_keypad");
      if (stored === "1") {
        setKeypadShown(true);
      } else if (stored === "0") {
        setKeypadShown(false);
      } else {
        // No stored preference — default ON for coarse-pointer
        // (touch) devices, OFF for desktop. matchMedia is the
        // standard way to ask "is this a touch-first device?".
        const isTouch =
          typeof window.matchMedia === "function" &&
          window.matchMedia("(pointer: coarse)").matches;
        setKeypadShown(isTouch);
      }
    } catch {
      /* private mode or weird sandbox — leave off */
    }
  }, []);

  function setKeypadShownPersisted(next: boolean) {
    setKeypadShown(next);
    try {
      window.localStorage.setItem(
        "mtcpl_findid_keypad",
        next ? "1" : "0",
      );
    } catch {
      /* ignore */
    }
  }

  // Domain reset — switching active department wipes the input + result.
  useEffect(() => {
    setQuery("");
    setResult(null);
    setError(null);
  }, [domain]);

  // Auto-focus the search input when the panel opens.
  useEffect(() => {
    if (open) {
      setKeypadCollapsed(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      // Reset on close so the next open is fresh.
      setQuery("");
      setResult(null);
      setError(null);
    }
  }, [open]);

  // Outside-click + Esc close (covers touch + keyboard).
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const wrapper = wrapperRef.current;
      if (!wrapper) return;
      if (e.target instanceof Node && wrapper.contains(e.target)) return;
      // The panel is portaled out of the wrapper — clicks inside it are
      // "inside", not outside.
      if (e.target instanceof Node && panelRef.current?.contains(e.target)) return;
      // Taps on the global tablet keyboard must NOT close the lookup (it drives
      // this search box now). preventDefault on the keyboard keeps focus, but
      // this document mousedown still fires, so exclude it explicitly.
      if (e.target instanceof Element && e.target.closest("[data-tablet-keyboard]")) return;
      setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  useEffect(() => {
    setMounted(true);
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  function openNow() {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setOpen(true);
  }
  // Daksh (May 2026 follow-on): bring back hover-out auto-close —
  // BUT only when the input is empty. The moment the user has typed
  // anything into the search field, the panel is "pinned open" and
  // a stray mouse-leave can't dismiss it. The pin lifts again as
  // soon as the field is empty. Outside-click + Esc still close
  // unconditionally so the panel is never trapped.
  //
  // 180ms grace lets the cursor travel from the pill into the panel
  // without triggering a close mid-flight.
  function scheduleClose() {
    if (query.trim()) return; // pinned by typed value
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 180);
  }

  async function runSearch(qRaw?: string) {
    const q = (qRaw ?? query).trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      let res: AnyLookupResult;
      if (domain === "finance") {
        res = await lookupFinance(q);
      } else if (domain === "inventory") {
        res = await lookupInventory(q);
      } else {
        res = await lookupId(q);
      }
      setResult(res);
      if (qRaw !== undefined) setQuery(q);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      // Hide the on-screen keypad so the result has room. Tapping the
      // search box brings it back (onFocus below).
      setKeypadCollapsed(true);
    }
  }

  const domainConfig = DOMAIN_CONFIG[domain];

  return (
    <div
      ref={wrapperRef}
      /* Daksh May 2026 — same touch fix as TopbarTasksBadge. Hover
       * handlers gated on pointerType === 'mouse' so a finger tap
       * doesn't race the click toggle. */
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") openNow();
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") scheduleClose();
      }}
      style={{ position: "relative", display: "inline-block" }}
    >
      {/* Trigger pill */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Look up any slab or block ID"
        aria-expanded={open}
        aria-haspopup="true"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          padding: "5px 12px 5px 10px",
          background: "var(--bg)",
          color: "var(--text)",
          border: "1px solid var(--border)",
          borderRadius: 999,
          cursor: "pointer",
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: "0.01em",
          whiteSpace: "nowrap",
          boxShadow: "0 1px 0 rgba(0,0,0,0.04)",
        }}
      >
        <span aria-hidden="true" style={{ fontSize: 14, lineHeight: 1 }}>
          🔍
        </span>
        <span>Find ID</span>
      </button>

      {open && mounted && createPortal(
        <>
          <style>{`
            @keyframes mtcpl-idlookup-bloom {
              0%   { opacity: 0; clip-path: circle(0% at calc(100% - 32px) 0%); }
              30%  { opacity: 1; }
              100% { opacity: 1; clip-path: circle(160% at calc(100% - 32px) 0%); }
            }
          `}</style>
          <div
            ref={panelRef}
            role="dialog"
            /* Daksh June 2026 — hover open/close mirrored from the pill so
               moving the cursor into the (portaled) panel keeps it open. */
            onPointerEnter={(e) => {
              if (e.pointerType === "mouse") openNow();
            }}
            onPointerLeave={(e) => {
              if (e.pointerType === "mouse") scheduleClose();
            }}
            style={{
              // Portaled to <body> + fixed so the panel clears the tablet
              // menu/backdrop/hamburger (z 200-301); anchored under the
              // 56px topbar at the right edge.
              position: "fixed",
              top: 64,
              right: 16,
              width: 440,
              maxWidth: "calc(100vw - 32px)",
              padding: 14,
              background: "rgba(255, 255, 255, 0.78)",
              backdropFilter: "blur(22px) saturate(180%)",
              WebkitBackdropFilter: "blur(22px) saturate(180%)",
              border: "1px solid rgba(255, 255, 255, 0.55)",
              borderRadius: 14,
              boxShadow:
                "0 12px 40px rgba(15, 23, 42, 0.18), 0 0 0 1px rgba(15, 23, 42, 0.04), inset 0 1px 0 rgba(255, 255, 255, 0.55)",
              zIndex: 400,
              animation:
                "mtcpl-idlookup-bloom 0.34s cubic-bezier(0.2, 0.8, 0.2, 1.05) both",
              display: "flex",
              flexDirection: "column",
              gap: 10,
              // Daksh June 2026 — keep the panel inside the viewport and
              // let IT scroll (not the page behind it) when a result is
              // long, e.g. a carving-done slab opened from the dashboard,
              // which has little page scroll of its own. overscroll
              // 'contain' stops the scroll from chaining to the page.
              maxHeight: "calc(100vh - 84px)",
              overflowY: "auto",
              overscrollBehavior: "contain",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 800,
                  color: "rgba(15, 23, 42, 0.55)",
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                }}
              >
                {domainConfig.title}
              </span>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 800,
                  color: domainConfig.accent,
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  padding: "2px 8px",
                  borderRadius: 999,
                  background: `${domainConfig.accent}1a`,
                }}
              >
                {domainConfig.deptLabel}
              </span>
            </div>

            {/* Search row */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void runSearch();
              }}
              style={{ display: "flex", gap: 8 }}
            >
              <input
                ref={inputRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                // Tapping / focusing the box re-opens the keypad after a
                // search collapsed it.
                onFocus={() => setKeypadCollapsed(false)}
                onClick={() => setKeypadCollapsed(false)}
                placeholder={domainConfig.placeholder}
                /* Daksh — IDs are uppercase here. inputMode is left to the
                   global tablet keyboard (it sets inputMode="none" on focus
                   to suppress the device soft keyboard); desktop physical
                   typing is unaffected. */
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                style={{
                  flex: 1,
                  padding: "9px 12px",
                  fontSize: 13,
                  fontWeight: 700,
                  fontFamily: "ui-monospace, SFMono-Regular, monospace",
                  background: "#fff",
                  color: "var(--text)",
                  border: "1px solid rgba(15, 23, 42, 0.12)",
                  borderRadius: 9,
                  letterSpacing: "0.02em",
                  textTransform: "uppercase",
                }}
              />
              <button
                type="submit"
                disabled={loading || !query.trim()}
                style={{
                  padding: "9px 14px",
                  fontSize: 12,
                  fontWeight: 800,
                  background: "var(--gold)",
                  color: "#fff",
                  border: "1px solid var(--gold-dark)",
                  borderRadius: 9,
                  cursor: loading ? "wait" : "pointer",
                  opacity: query.trim() ? 1 : 0.55,
                  whiteSpace: "nowrap",
                }}
              >
                {loading ? "Searching…" : "Find"}
              </button>
            </form>

            {/* Daksh (Jun 2026) — the legacy Find-ID touch keypad is RETIRED.
                The global tablet keyboard (QWERTY + dash + quick temple-code
                chips) now drives this search box like every other field, so
                two keyboards no longer stack. Gated off (not deleted) to keep
                the surrounding code stable. */}
            {false && (
              <FindIdKeypad
                value={query}
                onChange={(v) => setQuery(v)}
                onSubmit={() => void runSearch()}
                shown={keypadShown}
                expanded={!keypadCollapsed}
                onToggle={() => {
                  setKeypadShownPersisted(!keypadShown);
                  setKeypadCollapsed(false);
                }}
              />
            )}

            {/* Result */}
            {error && (
              <div
                role="alert"
                style={{
                  padding: "10px 12px",
                  background: "rgba(185, 28, 28, 0.08)",
                  color: "#b91c1c",
                  fontSize: 12,
                  fontWeight: 600,
                  border: "1px solid rgba(185, 28, 28, 0.25)",
                  borderRadius: 8,
                }}
              >
                {error}
              </div>
            )}
            {result && <ResultPanel result={result} domain={domain} onPick={runSearch} />}

            {!loading && !result && !error && (
              <p
                style={{
                  margin: 0,
                  fontSize: 11,
                  color: "rgba(15, 23, 42, 0.55)",
                  lineHeight: 1.5,
                }}
              >
                {domainConfig.helpText}
              </p>
            )}
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}

// ── Touch keypad (Daksh May 2026) ─────────────────────────────────
//
// On a tablet's soft keyboard, typing "MT-B-090" means flipping
// between letters → symbols → numbers → letters again — slow and
// error-prone. This component renders an always-uppercase pad with
// 0-9 + A-Z + dash + backspace all on one screen. The user can
// toggle it on (sticky in localStorage) so dev/desktop users with a
// real keyboard aren't bothered.
//
// Internals are stateless beyond the toggle: every press mutates the
// parent's query state via onChange. Submit button shortcuts the
// usual Find flow.
function FindIdKeypad({
  value,
  onChange,
  onSubmit,
  shown,
  expanded,
  onToggle,
}: {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  /** Lifted state (parent owns it). The parent also flips the
   *  input's inputMode based on the same flag so the device's soft
   *  keyboard can't stack on top of this one. */
  shown: boolean;
  /** Daksh June 2026 — whether the key grid is currently expanded.
   *  The keypad stays "on" (shown) but collapses after a search to
   *  free room for the result; tapping the search box re-expands it. */
  expanded: boolean;
  onToggle: () => void;
}) {
  function append(ch: string) {
    onChange((value + ch).toUpperCase());
  }
  function backspace() {
    onChange(value.slice(0, -1));
  }
  function clear() {
    onChange("");
  }

  const digits = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];
  // Letters laid out QWERTY-ish so the eye lands on common ID
  // prefixes (WF, MT, AGROHA …) without hunting around an alphabet
  // grid. Row 1 = top QWERTY, Row 2 = home, Row 3 = bottom.
  const lettersRows = [
    ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
    ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
    ["Z", "X", "C", "V", "B", "N", "M"],
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          gap: 8,
        }}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={shown}
          title="Show / hide the touch keypad. On tablet, leaving this on also blocks the device's soft keyboard from popping over the top."
          style={{
            fontSize: 10,
            fontWeight: 700,
            padding: "3px 9px",
            border: "1px solid rgba(15, 23, 42, 0.18)",
            background: shown ? "rgba(180,115,51,0.15)" : "rgba(255,255,255,0.4)",
            color: shown ? "var(--gold-dark)" : "rgba(15,23,42,0.65)",
            borderRadius: 999,
            cursor: "pointer",
            letterSpacing: "0.05em",
            textTransform: "uppercase",
          }}
        >
          ⌨ Touch keypad {shown ? "on" : "off"}
        </button>
      </div>

      {/* Collapsed-after-search hint — keypad is still ON, just hidden
          to give the result room. */}
      {shown && !expanded && (
        <div
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: "rgba(15,23,42,0.5)",
            textAlign: "right",
          }}
        >
          Keypad hidden — tap the search box to type again
        </div>
      )}

      {shown && expanded && (
        <div
          style={{
            padding: 8,
            background: "rgba(15, 23, 42, 0.05)",
            border: "1px solid rgba(15, 23, 42, 0.1)",
            borderRadius: 10,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {/* Digits row */}
          <KeypadRow keys={digits} onPress={append} />
          {/* Letter rows */}
          {lettersRows.map((row, i) => (
            <KeypadRow key={i} keys={row} onPress={append} />
          ))}
          {/* Symbol + action row. `.` for decimal dimensions
              (26.5x18.5x14), `-` for ID dashes, X is on the letters
              row but doubles as the dim separator (regex also accepts
              × and *). */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1.2fr 1.2fr 1.8fr",
              gap: 4,
            }}
          >
            <KeypadKey label="-" onPress={() => append("-")} />
            <KeypadKey label="." onPress={() => append(".")} />
            <KeypadKey label="⌫" onPress={backspace} tone="warn" />
            <KeypadKey label="Clear" onPress={clear} tone="warn" />
            <KeypadKey
              label="🔍 Find"
              onPress={onSubmit}
              tone="primary"
              disabled={!value.trim()}
            />
          </div>
          <div
            style={{
              fontSize: 10,
              color: "rgba(15,23,42,0.5)",
              textAlign: "center",
              marginTop: 2,
            }}
          >
            Auto-uppercase · zero-pad guessed · use X for dimensions
            (53X29X14)
          </div>
        </div>
      )}
    </div>
  );
}

function KeypadRow({
  keys,
  onPress,
}: {
  keys: string[];
  onPress: (k: string) => void;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${keys.length}, minmax(0, 1fr))`,
        gap: 4,
      }}
    >
      {keys.map((k) => (
        <KeypadKey key={k} label={k} onPress={() => onPress(k)} />
      ))}
    </div>
  );
}

function KeypadKey({
  label,
  onPress,
  tone = "default",
  disabled,
}: {
  label: string;
  onPress: () => void;
  tone?: "default" | "primary" | "warn";
  disabled?: boolean;
}) {
  const palette =
    tone === "primary"
      ? {
          bg: "var(--gold)",
          fg: "#fff",
          border: "var(--gold-dark)",
        }
      : tone === "warn"
        ? {
            bg: "rgba(180, 115, 51, 0.12)",
            fg: "#92400e",
            border: "rgba(180, 115, 51, 0.35)",
          }
        : {
            bg: "#fff",
            fg: "var(--text)",
            border: "rgba(15, 23, 42, 0.18)",
          };
  return (
    <button
      type="button"
      onClick={onPress}
      disabled={disabled}
      style={{
        padding: "10px 0",
        fontSize: 14,
        fontWeight: 800,
        fontFamily: "ui-monospace, SFMono-Regular, monospace",
        background: palette.bg,
        color: palette.fg,
        border: `1px solid ${palette.border}`,
        borderRadius: 7,
        cursor: disabled ? "not-allowed" : "pointer",
        touchAction: "manipulation",
        userSelect: "none",
        opacity: disabled ? 0.5 : 1,
        minHeight: 36,
      }}
    >
      {label}
    </button>
  );
}

// ── Domain config ─────────────────────────────────────────────────

const DOMAIN_CONFIG: Record<
  LookupDomain,
  {
    title: string;
    deptLabel: string;
    accent: string;
    placeholder: string;
    helpText: React.ReactNode;
  }
> = {
  production: {
    title: "Look up a slab, block, or dimensions",
    deptLabel: "Production",
    accent: "#c9a14a",
    placeholder: "MT-B-245 · WF-0001 · 53x29x14",
    helpText: (
      <>
        Type any slab/block ID (case-insensitive, zero-pad guessed —
        <code> mt-b-90 </code> finds <code>MT-B-090</code>) or
        dimensions like <code>53x29x14</code>. If more than one slab
        matches, you&apos;ll pick from a short list.
      </>
    ),
  },
  finance: {
    title: "Look up a bill, vendor, or payment",
    deptLabel: "Finance",
    accent: "#5e8c4e",
    placeholder: "T-2026-15 · Shree Cement · UTR1234567890",
    helpText: (
      <>
        Type a bill <strong>token</strong> (T-YYYY-N), a{" "}
        <strong>vendor name</strong>, or a <strong>payment reference</strong>{" "}
        (UTR / cheque no). Partial matches work.
      </>
    ),
  },
  inventory: {
    title: "Look up a site or scaffolding component",
    deptLabel: "Inventory",
    accent: "#c87850",
    placeholder: "PLANT · Whitefield Apts · Standard · Jali",
    helpText: (
      <>
        Type a <strong>site code or name</strong> (PLANT, ALPHA…) or a{" "}
        <strong>component name</strong> (Standard, Ledger, Transom, Jali).
      </>
    ),
  },
};

// ── Result panel ──────────────────────────────────────────────────

function ResultPanel({
  result,
  domain,
  onPick,
}: {
  result: LookupResult | FinanceLookupResult | InventoryLookupResult;
  domain: LookupDomain;
  onPick: (q: string) => void;
}) {
  // Finance results
  if (result.kind === "bill") return <FinanceBillPanel result={result} />;
  if (result.kind === "vendor") return <FinanceVendorPanel result={result} />;
  if (result.kind === "payment_reference")
    return <FinancePaymentPanel result={result} />;
  // Inventory results
  if (result.kind === "site") return <InventorySitePanel result={result} />;
  if (result.kind === "component") return <InventoryComponentPanel result={result} />;
  // Production results (slab / block) handled below alongside not_found
  if (result.kind === "not_found") {
    return (
      <div
        style={{
          padding: "14px 12px",
          background: "rgba(15, 23, 42, 0.04)",
          borderRadius: 10,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
          No match for{" "}
          <code style={{ fontFamily: "ui-monospace, monospace" }}>{result.query}</code>
        </div>
        {result.suggestions.length > 0 && (
          <>
            <div
              style={{
                fontSize: 10,
                fontWeight: 800,
                color: "rgba(15,23,42,0.55)",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
              }}
            >
              Did you mean…
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {result.suggestions.map((s, i) => {
                // Production suggestions carry `id`; finance/inventory
                // suggestions carry `label`. Normalise to whichever's
                // present, then feed that string back to onPick when
                // the user clicks (so the same query lands and
                // resolves to a hit on retry).
                const display =
                  "label" in s
                    ? (s as { label: string }).label
                    : (s as { id: string }).id;
                return (
                  <button
                    key={`${s.kind}-${display}-${i}`}
                    type="button"
                    onClick={() => onPick(display)}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "8px 10px",
                      background: "#fff",
                      border: "1px solid rgba(15,23,42,0.08)",
                      borderRadius: 8,
                      cursor: "pointer",
                      textAlign: "left",
                      fontSize: 12,
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "ui-monospace, monospace",
                        fontWeight: 800,
                        color: "var(--text)",
                      }}
                    >
                      {display}
                    </span>
                    <span style={{ color: "rgba(15,23,42,0.55)", fontSize: 11 }}>
                      {s.hint}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    );
  }

  // Production fall-through. The `domain` prop is read mostly via the
  // earlier branches; here we just exhaust the union.
  void domain;
  if (result.kind === "slab") return <SlabResultPanel result={result} />;
  if (result.kind === "block")
    return <BlockResultPanel result={result} onPick={onPick} />;
  if (result.kind === "multiple")
    return <MultipleResultPanel result={result} onPick={onPick} />;
  return null;
}

/** Daksh May 2026 — list panel for searches that match >1 row
 *  (dimension queries, ID prefixes hitting multiple variants).
 *  Each row tap re-runs the search with that exact ID so the user
 *  drills straight into the full single-result detail card. */
function MultipleResultPanel({
  result,
  onPick,
}: {
  result: Extract<LookupResult, { kind: "multiple" }>;
  onPick: (q: string) => void;
}) {
  return (
    <div
      style={{
        padding: 12,
        background: "rgba(15, 23, 42, 0.04)",
        borderRadius: 10,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 800,
          color: "rgba(15,23,42,0.7)",
          letterSpacing: "0.04em",
        }}
      >
        {result.reason}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {result.items.map((it) => {
          const tone = STATUS_TONE[it.status] ?? {
            fg: "#525252",
            bg: "rgba(82,82,82,0.10)",
          };
          return (
            <button
              key={`${it.kind}-${it.id}`}
              type="button"
              onClick={() => onPick(it.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 12px",
                background: "#fff",
                border: "1px solid rgba(15,23,42,0.10)",
                borderRadius: 8,
                cursor: "pointer",
                textAlign: "left",
                minHeight: 44,
                touchAction: "manipulation",
              }}
            >
              <span
                aria-hidden
                style={{
                  fontSize: 10,
                  fontWeight: 800,
                  padding: "2px 7px",
                  borderRadius: 999,
                  background:
                    it.kind === "slab"
                      ? "rgba(124,58,237,0.12)"
                      : "rgba(180,115,51,0.15)",
                  color: it.kind === "slab" ? "#7c3aed" : "#92400e",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                {it.kind}
              </span>
              <span
                style={{
                  fontFamily: "ui-monospace, monospace",
                  fontWeight: 800,
                  fontSize: 12.5,
                  color: "var(--text)",
                  minWidth: 110,
                }}
              >
                {it.id}
              </span>
              <span
                style={{
                  flex: 1,
                  fontSize: 11.5,
                  color: "rgba(15,23,42,0.65)",
                  fontWeight: 600,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {it.summary}
              </span>
              {it.status && (
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 800,
                    padding: "2px 7px",
                    background: tone.bg,
                    color: tone.fg,
                    borderRadius: 999,
                    fontFamily: "ui-monospace, monospace",
                    letterSpacing: "0.04em",
                    whiteSpace: "nowrap",
                  }}
                >
                  {it.status.replace(/_/g, " ")}
                </span>
              )}
              <span
                style={{ fontSize: 14, color: "rgba(15,23,42,0.4)" }}
              >
                ›
              </span>
            </button>
          );
        })}
      </div>
      <div
        style={{
          fontSize: 10,
          color: "rgba(15,23,42,0.5)",
          marginTop: 2,
        }}
      >
        Tap any row to see its full detail.
      </div>
    </div>
  );
}

function StagePill({ status }: { status: string }) {
  const tone = STATUS_TONE[status] ?? { fg: "#525252", bg: "rgba(82,82,82,0.10)" };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 12px",
        borderRadius: 999,
        background: tone.bg,
        color: tone.fg,
        fontSize: 12,
        fontWeight: 800,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        fontFamily: "ui-monospace, monospace",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: tone.fg,
          boxShadow: `0 0 0 3px ${tone.bg}`,
        }}
      />
      {status.replace(/_/g, " ")}
    </span>
  );
}

function Field({ k, v, mono }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
        padding: "4px 0",
        fontSize: 12,
      }}
    >
      <span style={{ color: "rgba(15,23,42,0.55)", fontWeight: 600 }}>{k}</span>
      <span
        style={{
          color: "var(--text)",
          fontWeight: 700,
          fontFamily: mono ? "ui-monospace, monospace" : undefined,
          textAlign: "right",
        }}
      >
        {v}
      </span>
    </div>
  );
}

function SlabResultPanel({ result }: { result: Extract<LookupResult, { kind: "slab" }> }) {
  const s = result.slab;

  // Daksh May 2026 — the server now composes the "where is it now"
  // sentence (status + carving + dispatch + stock_location) into a
  // single current_location string. Render that as the headline and
  // surface stock_location as its own field below in the basics
  // section so the user can see the literal stencilled rack code.
  const stageContext: string = result.current_location;

  // Daksh June 2026 — a carving job that's been marked complete but not
  // yet review-approved leaves the slab at status 'carving_in_progress'
  // (the approval-pending state lives on carving_items: completed_at set,
  // review_approved_at null). Find ID was therefore reading "carving in
  // progress" for those slabs. Swap in a synthetic 'carving_approval_pending'
  // status so the pill reads "carving approval pending" instead.
  const carvingApprovalPending =
    s.status === "carving_in_progress" &&
    result.carving != null &&
    result.carving.completed_at != null &&
    result.carving.review_approved_at == null;
  const displayStatus = carvingApprovalPending
    ? "carving_approval_pending"
    : s.status;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        background: "rgba(15, 23, 42, 0.04)",
        borderRadius: 10,
        padding: 12,
      }}
    >
      {/* WHERE IT IS — biggest line. Stage pill + free-text context. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div
          style={{
            fontSize: 10,
            fontWeight: 800,
            color: "rgba(15,23,42,0.55)",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
          }}
        >
          Where it is now
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <StagePill status={displayStatus} />
          {s.priority && (
            <span
              style={{
                padding: "3px 8px",
                fontSize: 10,
                fontWeight: 800,
                background: "rgba(220, 38, 38, 0.12)",
                color: "#b91c1c",
                borderRadius: 999,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              🚨 priority
            </span>
          )}
        </div>
        {stageContext && (
          <div
            style={{
              fontSize: 13,
              color: "var(--text)",
              fontWeight: 700,
              lineHeight: 1.35,
            }}
          >
            {stageContext}
          </div>
        )}
      </div>

      <div style={{ height: 1, background: "rgba(15,23,42,0.08)" }} />

      {/* SLAB IDENTITY — label + description shown prominently
          (Daksh May 2026 round 4: they were tucked into the section
          header as a tiny suffix, easy to miss. Now full-width lines
          right below the "where is it" headline). */}
      {(s.label || s.description || s.additional_description) && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            padding: "8px 10px",
            background: "rgba(201,151,58,0.08)",
            border: "1px solid rgba(201,151,58,0.25)",
            borderRadius: 8,
          }}
        >
          {s.label && (
            <div
              style={{
                fontSize: 16,
                fontWeight: 800,
                color: "var(--text)",
                lineHeight: 1.25,
                wordBreak: "break-word",
              }}
              title="Slab label (set at cut time)"
            >
              🏷 {s.label}
            </div>
          )}
          {s.description && (
            <div
              style={{
                fontSize: 13,
                fontStyle: "italic",
                color: "var(--text)",
                lineHeight: 1.4,
                wordBreak: "break-word",
              }}
              title="Free-text per-slab note"
            >
              “{s.description}”
            </div>
          )}
          {s.additional_description && (
            <div
              style={{
                fontSize: 12,
                color: "var(--muted)",
                lineHeight: 1.4,
                wordBreak: "break-word",
              }}
              title="Additional description"
            >
              + {s.additional_description}
            </div>
          )}
        </div>
      )}

      {/* SLAB BASICS */}
      <div>
        <div
          style={{
            fontSize: 10,
            fontWeight: 800,
            color: "rgba(15,23,42,0.55)",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            marginBottom: 4,
          }}
        >
          Slab {s.id}
        </div>
        <Field k="Temple" v={s.temple} />
        {s.stone && <Field k="Stone" v={s.stone} />}
        {s.component_section && <Field k="Category 1" v={s.component_section} />}
        {s.component_element && <Field k="Category 2" v={s.component_element} />}
        <Field
          k="Dimensions"
          v={
            <>
              {fmtNum(s.length_in)}″ × {fmtNum(s.width_in)}″ ×{" "}
              {fmtNum(s.thickness_in)}″
            </>
          }
          mono
        />
        <Field k="CFT" v={fmtNum(s.cft, 2)} mono />
        {s.source_block_id && (
          <Field
            k="Source block"
            v={
              <Link
                href={`/blocks?q=${encodeURIComponent(s.source_block_id)}`}
                style={{ color: "var(--gold-dark)", textDecoration: "none" }}
              >
                {s.source_block_id}
              </Link>
            }
            mono
          />
        )}
        {/* Daksh May 2026 — surface the literal stencilled rack/location
            so production / vendor can walk straight to it. Mig 020. */}
        {s.stock_location && (
          <Field k="Stock location" v={s.stock_location} mono />
        )}
        {s.yard != null && <Field k="Yard (source block)" v={String(s.yard)} mono />}
        {s.deadline && <Field k="Deadline" v={fmtDate(s.deadline)} />}
      </div>

      {/* CUT INFO */}
      {result.cut && (
        <>
          <div style={{ height: 1, background: "rgba(15,23,42,0.08)" }} />
          <div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 800,
                color: "rgba(15,23,42,0.55)",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                marginBottom: 4,
              }}
            >
              Cut
            </div>
            <Field k="Session" v={result.cut.session_code} mono />
            {result.cut.planner_name && (
              <Field k="Planner" v={result.cut.planner_name} />
            )}
            {/* Mig follow-on (Daksh) — operator (cutter) name */}
            {result.cut.cutter_name && (
              <Field k="Cutter" v={result.cut.cutter_name} />
            )}
            {result.cut.cut_at && (
              <Field k="Cut at" v={fmtDate(result.cut.cut_at)} />
            )}
            {result.cut.is_filler && (
              <Field
                k="Type"
                v={
                  <span style={{ color: "#c2410c", fontWeight: 700 }}>
                    fit-to-fill
                  </span>
                }
              />
            )}
          </div>
        </>
      )}

      {/* CARVING INFO */}
      {result.carving && (
        <>
          <div style={{ height: 1, background: "rgba(15,23,42,0.08)" }} />
          <div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 800,
                color: "rgba(15,23,42,0.55)",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                marginBottom: 4,
              }}
            >
              Carving
            </div>
            <Field k="Vendor" v={result.carving.vendor_name} />
            <Field k="Vendor type" v={result.carving.vendor_type} />
            <Field
              k="Status"
              v={
                carvingApprovalPending
                  ? "approval pending"
                  : result.carving.status
              }
              mono
            />
            {result.carving.location && (
              <Field k="Location" v={result.carving.location} />
            )}
            {result.carving.due_at && (
              <Field k="Due" v={fmtDate(result.carving.due_at)} />
            )}
            {/* Daksh June 2026 — for a carving-done slab, show which CNC
                carved it, when it was completed/approved, and by whom. */}
            {result.carving.machine_code && (
              <Field k="Carved on" v={result.carving.machine_code} mono />
            )}
            {result.carving.completed_at && (
              <Field
                k="Completed (unloaded)"
                v={fmtDateTime(result.carving.completed_at)}
              />
            )}
            {result.carving.review_approved_at && (
              <Field
                k="Approved"
                v={fmtDateTime(result.carving.review_approved_at)}
              />
            )}
            {result.carving.approved_by_name && (
              <Field k="Approved by" v={result.carving.approved_by_name} />
            )}
            {result.carving.ready_to_dispatch_at && (
              <Field
                k="Ready to dispatch"
                v={fmtDate(result.carving.ready_to_dispatch_at)}
              />
            )}
          </div>
        </>
      )}

      {/* DISPATCH INFO */}
      {result.dispatch && (
        <>
          <div style={{ height: 1, background: "rgba(15,23,42,0.08)" }} />
          <div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 800,
                color: "rgba(15,23,42,0.55)",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                marginBottom: 4,
              }}
            >
              Dispatch
            </div>
            {result.dispatch.challan_number != null && (
              <Field k="Challan" v={`#${result.dispatch.challan_number}`} mono />
            )}
            {result.dispatch.vehicle_no && (
              <Field k="Vehicle" v={result.dispatch.vehicle_no} mono />
            )}
            {result.dispatch.dispatched_at && (
              <Field k="Dispatched" v={fmtDate(result.dispatch.dispatched_at)} />
            )}
            {result.dispatch.delivered_at && (
              <Field k="Delivered" v={fmtDate(result.dispatch.delivered_at)} />
            )}
            {result.dispatch.receiver_name && (
              <Field k="Received by" v={result.dispatch.receiver_name} />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function BlockResultPanel({
  result,
  onPick,
}: {
  result: Extract<LookupResult, { kind: "block" }>;
  /** Mig follow-on (Daksh) — clicking a slab chip in the cut-from
   *  list re-runs Find ID with that slab's code. */
  onPick: (q: string) => void;
}) {
  const b = result.block;

  // Block stage context — what's happening with cutting + how many
  // slabs have come out.
  // Daksh May 2026 — use the server-composed current_location string
  // for the headline. The block also gets created-by + cut-by + cut-at
  // surfaced below.
  const stageContext: string = result.current_location;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        background: "rgba(15, 23, 42, 0.04)",
        borderRadius: 10,
        padding: 12,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div
          style={{
            fontSize: 10,
            fontWeight: 800,
            color: "rgba(15,23,42,0.55)",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
          }}
        >
          Where it is now
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <StagePill status={b.status} />
          <span
            style={{
              padding: "3px 8px",
              fontSize: 10,
              fontWeight: 800,
              background: "rgba(15,23,42,0.08)",
              color: "rgba(15,23,42,0.65)",
              borderRadius: 999,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            {b.category}
          </span>
          {result.cutting?.needs_reprint && (
            <span
              style={{
                padding: "3px 8px",
                fontSize: 10,
                fontWeight: 800,
                background: "rgba(220, 38, 38, 0.12)",
                color: "#b91c1c",
                borderRadius: 999,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              needs reprint
            </span>
          )}
        </div>
        {stageContext && (
          <div
            style={{
              fontSize: 13,
              color: "var(--text)",
              fontWeight: 700,
              lineHeight: 1.35,
            }}
          >
            {stageContext}
          </div>
        )}
      </div>

      <div style={{ height: 1, background: "rgba(15,23,42,0.08)" }} />

      <div>
        <div
          style={{
            fontSize: 10,
            fontWeight: 800,
            color: "rgba(15,23,42,0.55)",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            marginBottom: 4,
          }}
        >
          Block {b.id}
        </div>
        <Field k="Yard" v={b.yard} />
        <Field k="Stone" v={b.stone} />
        <Field
          k="Dimensions"
          v={
            <>
              {fmtNum(b.length_in)}″ × {fmtNum(b.width_in)}″ ×{" "}
              {fmtNum(b.height_in)}″
            </>
          }
          mono
        />
        <Field k="CFT" v={fmtNum(b.cft, 2)} mono />
        {b.quality && <Field k="Quality" v={b.quality} />}
        <Field k="Added on" v={fmtDate(b.created_at)} />
        {b.created_by_name && (
          <Field k="Added by" v={b.created_by_name} />
        )}
      </div>

      {result.cutting && (
        <>
          <div style={{ height: 1, background: "rgba(15,23,42,0.08)" }} />
          <div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 800,
                color: "rgba(15,23,42,0.55)",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                marginBottom: 4,
              }}
            >
              Cut session
            </div>
            <Field k="Session" v={result.cutting.session_code} mono />
            <Field k="Status" v={result.cutting.session_block_status} mono />
            {result.cutting.cut_at && (
              <Field k="Cut completed" v={fmtDate(result.cutting.cut_at)} />
            )}
            {result.cutting.planner_name && (
              <Field k="Planner" v={result.cutting.planner_name} />
            )}
            {/* Mig follow-on (Daksh) — operator (cutter) name */}
            {result.cutting.cutter_name && (
              <Field k="Cutter" v={result.cutting.cutter_name} />
            )}
            {result.cutting.largest_remainder_cft != null && (
              <Field
                k="Largest remainder"
                v={`${fmtNum(result.cutting.largest_remainder_cft, 2)} CFT`}
                mono
              />
            )}
          </div>
        </>
      )}

      {result.slabs_from_block.total > 0 && (
        <>
          <div style={{ height: 1, background: "rgba(15,23,42,0.08)" }} />
          <div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 800,
                color: "rgba(15,23,42,0.55)",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                marginBottom: 6,
              }}
            >
              Slabs cut from this block · {result.slabs_from_block.total} total
            </div>

            {/* Status breakdown chips */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
              {Object.entries(result.slabs_from_block.by_status).map(([st, n]) => {
                const tone = STATUS_TONE[st] ?? {
                  fg: "#525252",
                  bg: "rgba(82,82,82,0.10)",
                };
                return (
                  <span
                    key={st}
                    style={{
                      padding: "3px 9px",
                      fontSize: 10,
                      fontWeight: 800,
                      background: tone.bg,
                      color: tone.fg,
                      borderRadius: 999,
                      fontFamily: "ui-monospace, monospace",
                      letterSpacing: "0.04em",
                    }}
                  >
                    {st.replace(/_/g, " ")} · {n}
                  </span>
                );
              })}
            </div>

            {/* Mig follow-on (Daksh) — full clickable slab list.
                Tap any code → re-run Find ID on that slab. Sorted
                by id (auto-incremented, so chronological-ish). */}
            {result.slabs_from_block.list.length > 0 && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  maxHeight: 260,
                  overflowY: "auto",
                  paddingRight: 2,
                }}
              >
                {result.slabs_from_block.list.map((sl) => {
                  const tone = STATUS_TONE[sl.status] ?? {
                    fg: "#525252",
                    bg: "rgba(82,82,82,0.10)",
                  };
                  return (
                    <button
                      key={sl.id}
                      type="button"
                      onClick={() => onPick(sl.id)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "7px 10px",
                        background: "rgba(15,23,42,0.03)",
                        border: "1px solid rgba(15,23,42,0.10)",
                        borderRadius: 7,
                        cursor: "pointer",
                        textAlign: "left",
                        fontFamily: "inherit",
                        color: "var(--text)",
                        transition: "background 0.08s, border-color 0.08s",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = "rgba(201,151,58,0.10)";
                        e.currentTarget.style.borderColor = "rgba(201,151,58,0.35)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "rgba(15,23,42,0.03)";
                        e.currentTarget.style.borderColor = "rgba(15,23,42,0.10)";
                      }}
                      title="Click to search this slab in Find ID"
                    >
                      <span
                        style={{
                          fontFamily: "ui-monospace, monospace",
                          fontSize: 12,
                          fontWeight: 700,
                          color: "var(--gold-dark)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {sl.id}
                      </span>
                      <span
                        style={{
                          fontFamily: "ui-monospace, monospace",
                          fontSize: 11,
                          color: "rgba(15,23,42,0.55)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {fmtNum(sl.length_in)}×{fmtNum(sl.width_in)}×{fmtNum(sl.thickness_in)}"
                      </span>
                      <span
                        style={{
                          flex: 1,
                          minWidth: 0,
                          fontSize: 11,
                          color: "rgba(15,23,42,0.65)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {sl.temple}
                        {sl.label && (
                          <span
                            style={{
                              color: "rgba(15,23,42,0.45)",
                              marginLeft: 6,
                            }}
                          >
                            · {sl.label}
                          </span>
                        )}
                      </span>
                      <span
                        style={{
                          padding: "2px 7px",
                          fontSize: 9,
                          fontWeight: 800,
                          background: tone.bg,
                          color: tone.fg,
                          borderRadius: 999,
                          textTransform: "uppercase",
                          letterSpacing: "0.04em",
                          whiteSpace: "nowrap",
                          flexShrink: 0,
                        }}
                      >
                        {sl.status.replace(/_/g, " ")}
                      </span>
                      <span
                        aria-hidden
                        style={{
                          fontSize: 11,
                          color: "rgba(15,23,42,0.35)",
                          fontWeight: 600,
                          flexShrink: 0,
                        }}
                      >
                        →
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Finance result panels
// ════════════════════════════════════════════════════════════════════════════

function inr(n: number): string {
  return `₹${(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function FinanceBillPanel({ result }: { result: Extract<FinanceLookupResult, { kind: "bill" }> }) {
  const { bill, amounts, payments } = result;
  const a = amounts;

  // "Where it is now" line for the bill: status + a context sentence.
  let context: string | null = null;
  if (bill.status === "fully_paid") context = "Fully paid";
  else if (bill.status === "approved") {
    if (a.paidInr > 0) context = `Partially paid — ${inr(a.outstandingInr)} still owed`;
    else context = `Due — pay ${inr(a.payableToVendorInr)} to vendor`;
  } else if (bill.status === "pending_approval") context = "Awaiting crosscheck / owner sign-off";
  else if (bill.status === "rejected") context = bill.rejectionNote ?? "Rejected";
  else if (bill.status === "cancelled") context = "Cancelled";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        background: "rgba(15, 23, 42, 0.04)",
        borderRadius: 10,
        padding: 12,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div
          style={{
            fontSize: 10,
            fontWeight: 800,
            color: "rgba(15,23,42,0.55)",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
          }}
        >
          Where it is now
        </div>
        <StagePill status={bill.status} />
        {context && (
          <div style={{ fontSize: 12, color: "var(--text)", fontWeight: 600 }}>
            {context}
          </div>
        )}
      </div>

      <div style={{ height: 1, background: "rgba(15,23,42,0.08)" }} />

      <div>
        <div
          style={{
            fontSize: 10,
            fontWeight: 800,
            color: "rgba(15,23,42,0.55)",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            marginBottom: 4,
          }}
        >
          Bill {bill.token}
        </div>
        <Field k="Vendor" v={bill.vendorName} />
        <Field k="Vendor bill no" v={bill.vendorBillNo} mono />
        <Field k="Bill date" v={fmtDate(bill.billDate)} />
        {bill.description && (
          <Field k="Description" v={bill.description.slice(0, 80) + (bill.description.length > 80 ? "…" : "")} />
        )}
      </div>

      <div style={{ height: 1, background: "rgba(15,23,42,0.08)" }} />

      <div>
        <div
          style={{
            fontSize: 10,
            fontWeight: 800,
            color: "rgba(15,23,42,0.55)",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            marginBottom: 4,
          }}
        >
          Amounts
        </div>
        <Field k="Subtotal" v={inr(a.subtotalInr)} mono />
        {a.cgstPercent > 0 && <Field k={`CGST ${a.cgstPercent}%`} v={inr(a.cgstInr)} mono />}
        {a.sgstPercent > 0 && <Field k={`SGST ${a.sgstPercent}%`} v={inr(a.sgstInr)} mono />}
        {a.igstPercent > 0 && <Field k={`IGST ${a.igstPercent}%`} v={inr(a.igstInr)} mono />}
        {a.tdsPercent > 0 && (
          <Field
            k={`− TDS ${a.tdsPercent}%`}
            v={<span style={{ color: "#b91c1c" }}>{inr(a.tdsInr)}</span>}
            mono
          />
        )}
        {a.tcsPercent > 0 && (
          <Field k={`+ TCS ${a.tcsPercent}%`} v={inr(a.tcsInr)} mono />
        )}
        <Field k="Total" v={<strong>{inr(a.totalInr)}</strong>} mono />
        {(a.tdsPercent > 0 || a.tcsPercent > 0) && (
          <Field
            k="Pay vendor"
            v={
              <span style={{ color: "#15803d", fontWeight: 800 }}>
                {inr(a.payableToVendorInr)}
              </span>
            }
            mono
          />
        )}
        {a.paidInr > 0 && (
          <Field
            k="Paid"
            v={<span style={{ color: "#15803d" }}>{inr(a.paidInr)}</span>}
            mono
          />
        )}
        {a.outstandingInr > 0 && (
          <Field
            k="Outstanding"
            v={<span style={{ color: "#b45309", fontWeight: 800 }}>{inr(a.outstandingInr)}</span>}
            mono
          />
        )}
      </div>

      {payments.length > 0 && (
        <>
          <div style={{ height: 1, background: "rgba(15,23,42,0.08)" }} />
          <div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 800,
                color: "rgba(15,23,42,0.55)",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                marginBottom: 4,
              }}
            >
              Payments · {payments.length}
            </div>
            {payments.map((p, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 11,
                  padding: "3px 0",
                  borderBottom:
                    i < payments.length - 1 ? "1px dashed rgba(15,23,42,0.06)" : undefined,
                }}
              >
                <span style={{ color: "rgba(15,23,42,0.65)" }}>
                  {p.status.toUpperCase()} ·{" "}
                  {p.paymentMethod ? p.paymentMethod.toUpperCase() : "—"}
                  {p.paymentReference && (
                    <>
                      {" · "}
                      <code style={{ fontFamily: "ui-monospace, monospace" }}>
                        {p.paymentReference}
                      </code>
                    </>
                  )}
                </span>
                <span
                  style={{
                    fontFamily: "ui-monospace, monospace",
                    fontWeight: 700,
                    color: "var(--text)",
                  }}
                >
                  {inr(p.paidAmountInr ?? p.proposedAmountInr)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <Link
        href={`/accounts/bills/${bill.id}`}
        style={{
          padding: "7px 10px",
          fontSize: 11,
          fontWeight: 700,
          background: "var(--gold)",
          color: "#fff",
          border: "1px solid var(--gold-dark)",
          borderRadius: 7,
          textDecoration: "none",
          textAlign: "center",
        }}
      >
        Open full bill →
      </Link>
    </div>
  );
}

function FinanceVendorPanel({ result }: { result: Extract<FinanceLookupResult, { kind: "vendor" }> }) {
  const { vendor, lifetime, recentBills } = result;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        background: "rgba(15, 23, 42, 0.04)",
        borderRadius: 10,
        padding: 12,
      }}
    >
      <div>
        <div
          style={{
            fontSize: 10,
            fontWeight: 800,
            color: "rgba(15,23,42,0.55)",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
          }}
        >
          Vendor
        </div>
        <div
          style={{
            fontSize: 16,
            fontWeight: 800,
            color: "var(--text)",
            letterSpacing: "-0.01em",
            marginTop: 2,
          }}
        >
          {vendor.name}
        </div>
        <div style={{ fontSize: 11, color: "rgba(15,23,42,0.55)", marginTop: 3 }}>
          {vendor.category ?? "—"}
          {vendor.gstin && <> · GSTIN <code style={{ fontFamily: "ui-monospace, monospace" }}>{vendor.gstin}</code></>}
          {vendor.phone && <> · {vendor.phone}</>}
        </div>
      </div>

      <div style={{ height: 1, background: "rgba(15,23,42,0.08)" }} />

      <div>
        <div
          style={{
            fontSize: 10,
            fontWeight: 800,
            color: "rgba(15,23,42,0.55)",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            marginBottom: 4,
          }}
        >
          Lifetime · {lifetime.billsCount} bills
        </div>
        <Field k="Billed" v={inr(lifetime.billedInr)} mono />
        <Field k="Paid" v={<span style={{ color: "#15803d" }}>{inr(lifetime.paidInr)}</span>} mono />
        {lifetime.outstandingInr > 0 && (
          <Field
            k="Outstanding"
            v={<span style={{ color: "#b45309", fontWeight: 800 }}>{inr(lifetime.outstandingInr)}</span>}
            mono
          />
        )}
        {vendor.tdsApplicable && (
          <Field
            k="TDS deducted"
            v={<span style={{ color: "#b91c1c" }}>{inr(lifetime.tdsDeductedInr)}</span>}
            mono
          />
        )}
        {vendor.tcsApplicable && (
          <Field k="TCS collected" v={inr(lifetime.tcsCollectedInr)} mono />
        )}
      </div>

      {(vendor.bankName || vendor.bankAccount) && (
        <>
          <div style={{ height: 1, background: "rgba(15,23,42,0.08)" }} />
          <div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 800,
                color: "rgba(15,23,42,0.55)",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                marginBottom: 4,
              }}
            >
              Bank
            </div>
            {vendor.bankName && <Field k="Bank" v={vendor.bankName} />}
            {vendor.bankAccount && <Field k="A/c no" v={vendor.bankAccount} mono />}
            {vendor.ifsc && <Field k="IFSC" v={vendor.ifsc} mono />}
          </div>
        </>
      )}

      {recentBills.length > 0 && (
        <>
          <div style={{ height: 1, background: "rgba(15,23,42,0.08)" }} />
          <div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 800,
                color: "rgba(15,23,42,0.55)",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                marginBottom: 4,
              }}
            >
              Recent bills
            </div>
            {recentBills.map((b) => (
              <Link
                key={b.token}
                href={`/accounts/bills?token=${encodeURIComponent(b.token)}`}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "4px 0",
                  fontSize: 11,
                  textDecoration: "none",
                  color: "var(--text)",
                }}
              >
                <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700 }}>
                  {b.token}
                </span>
                <span style={{ color: "rgba(15,23,42,0.55)" }}>
                  {fmtDate(b.billDate)} · {b.status}
                </span>
                <span style={{ fontFamily: "ui-monospace, monospace" }}>
                  {inr(b.amountTotalInr)}
                </span>
              </Link>
            ))}
          </div>
        </>
      )}

      <Link
        href={`/accounts/vendors/${vendor.id}`}
        style={{
          padding: "7px 10px",
          fontSize: 11,
          fontWeight: 700,
          background: "var(--gold)",
          color: "#fff",
          border: "1px solid var(--gold-dark)",
          borderRadius: 7,
          textDecoration: "none",
          textAlign: "center",
        }}
      >
        Open vendor account →
      </Link>
    </div>
  );
}

function FinancePaymentPanel({ result }: { result: Extract<FinanceLookupResult, { kind: "payment_reference" }> }) {
  const p = result.payment;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        background: "rgba(15, 23, 42, 0.04)",
        borderRadius: 10,
        padding: 12,
      }}
    >
      <div>
        <div
          style={{
            fontSize: 10,
            fontWeight: 800,
            color: "rgba(15,23,42,0.55)",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
          }}
        >
          Payment matched
        </div>
        <div style={{ fontSize: 14, fontWeight: 800, color: "#15803d", marginTop: 4 }}>
          {inr(p.paidAmountInr)} paid to {p.vendorName}
        </div>
      </div>
      <Field k="Method" v={p.paymentMethod ? p.paymentMethod.toUpperCase() : "—"} mono />
      <Field k="Reference" v={p.paymentReference} mono />
      <Field k="Paid on" v={fmtDate(p.paidAt)} />
      <Field k="Bill" v={p.billToken} mono />
      <div style={{ display: "flex", gap: 8 }}>
        {p.billId && (
          <Link
            href={`/accounts/bills/${p.billId}`}
            style={{
              flex: 1,
              padding: "7px 10px",
              fontSize: 11,
              fontWeight: 700,
              background: "var(--bg)",
              color: "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: 7,
              textDecoration: "none",
              textAlign: "center",
            }}
          >
            Open bill
          </Link>
        )}
        <Link
          href={`/accounts/payments/${p.id}/voucher`}
          style={{
            flex: 1,
            padding: "7px 10px",
            fontSize: 11,
            fontWeight: 700,
            background: "var(--gold)",
            color: "#fff",
            border: "1px solid var(--gold-dark)",
            borderRadius: 7,
            textDecoration: "none",
            textAlign: "center",
          }}
        >
          🖨 Voucher →
        </Link>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Inventory result panels
// ════════════════════════════════════════════════════════════════════════════

function InventorySitePanel({ result }: { result: Extract<InventoryLookupResult, { kind: "site" }> }) {
  const { site, totalPieces, componentHoldings, recentBatches } = result;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        background: "rgba(15, 23, 42, 0.04)",
        borderRadius: 10,
        padding: 12,
      }}
    >
      <div>
        <div
          style={{
            fontSize: 10,
            fontWeight: 800,
            color: "rgba(15,23,42,0.55)",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
          }}
        >
          {site.isPlant ? "Plant / warehouse" : "Project site"}
        </div>
        <div
          style={{
            fontSize: 16,
            fontWeight: 800,
            color: "var(--text)",
            marginTop: 2,
            letterSpacing: "-0.01em",
          }}
        >
          {site.name}{" "}
          <code
            style={{
              fontFamily: "ui-monospace, monospace",
              fontSize: 11,
              fontWeight: 700,
              color: "rgba(15,23,42,0.55)",
              marginLeft: 4,
            }}
          >
            {site.code}
          </code>
        </div>
        {site.managerName && (
          <div style={{ fontSize: 11, color: "rgba(15,23,42,0.55)", marginTop: 2 }}>
            👤 {site.managerName}
          </div>
        )}
      </div>

      <div style={{ height: 1, background: "rgba(15,23,42,0.08)" }} />

      <div>
        <div
          style={{
            fontSize: 10,
            fontWeight: 800,
            color: "rgba(15,23,42,0.55)",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            marginBottom: 4,
          }}
        >
          Current stock · {totalPieces} pcs total
        </div>
        {componentHoldings.length === 0 ? (
          <div style={{ fontSize: 12, color: "rgba(15,23,42,0.55)" }}>
            Nothing here right now.
          </div>
        ) : (
          componentHoldings.map((c) => (
            <Field
              key={c.componentName}
              k={c.componentName}
              v={`${c.qty.toLocaleString("en-IN")} pcs`}
              mono
            />
          ))
        )}
      </div>

      {recentBatches.length > 0 && (
        <>
          <div style={{ height: 1, background: "rgba(15,23,42,0.08)" }} />
          <div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 800,
                color: "rgba(15,23,42,0.55)",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                marginBottom: 4,
              }}
            >
              Recent movements
            </div>
            {recentBatches.map((b) => (
              <div
                key={b.batchId}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 11,
                  padding: "3px 0",
                }}
              >
                <span>
                  {b.direction === "in" ? "↓" : "↑"} {b.typeLabel}
                  {b.counterpartyName && <> · {b.counterpartyName}</>}
                </span>
                <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700 }}>
                  {b.totalQty} pcs
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <Link
        href={`/inventory/scaffolding?site=${site.id}`}
        style={{
          padding: "7px 10px",
          fontSize: 11,
          fontWeight: 700,
          background: "var(--gold)",
          color: "#fff",
          border: "1px solid var(--gold-dark)",
          borderRadius: 7,
          textDecoration: "none",
          textAlign: "center",
        }}
      >
        Open on board →
      </Link>
    </div>
  );
}

function InventoryComponentPanel({ result }: { result: Extract<InventoryLookupResult, { kind: "component" }> }) {
  const { component, totals, byLocation } = result;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        background: "rgba(15, 23, 42, 0.04)",
        borderRadius: 10,
        padding: 12,
      }}
    >
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        {component.imageDataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={component.imageDataUrl}
            alt={component.name}
            width={56}
            height={56}
            style={{ objectFit: "contain", flexShrink: 0 }}
          />
        ) : (
          <div
            style={{
              width: 56,
              height: 56,
              flexShrink: 0,
              background: "rgba(15, 23, 42, 0.08)",
              borderRadius: 10,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 11,
              fontWeight: 800,
              color: "rgba(15,23,42,0.45)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            {component.type.slice(0, 4)}
          </div>
        )}
        <div>
          <div
            style={{
              fontSize: 10,
              fontWeight: 800,
              color: "rgba(15,23,42,0.55)",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
            }}
          >
            Component
          </div>
          <div
            style={{
              fontSize: 16,
              fontWeight: 800,
              color: "var(--text)",
              letterSpacing: "-0.01em",
              marginTop: 2,
            }}
          >
            {component.name}
          </div>
          <div style={{ fontSize: 11, color: "rgba(15,23,42,0.55)", marginTop: 2 }}>
            {component.type}
            {component.sizeSpec && <> · {component.sizeSpec}</>} · {component.unit}
          </div>
        </div>
      </div>

      <div style={{ height: 1, background: "rgba(15,23,42,0.08)" }} />

      <div>
        <div
          style={{
            fontSize: 10,
            fontWeight: 800,
            color: "rgba(15,23,42,0.55)",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            marginBottom: 4,
          }}
        >
          Totals
        </div>
        <Field k="At plant" v={`${totals.atPlant.toLocaleString("en-IN")} pcs`} mono />
        <Field k="Out at sites" v={`${totals.outAtSites.toLocaleString("en-IN")} pcs`} mono />
        <Field
          k="Total in fleet"
          v={
            <strong>
              {totals.totalInPipeline.toLocaleString("en-IN")} pcs
            </strong>
          }
          mono
        />
        {totals.pendingOut > 0 && (
          <Field
            k="Pending issue"
            v={
              <span style={{ color: "#b45309" }}>
                {totals.pendingOut.toLocaleString("en-IN")} pcs awaiting audit
              </span>
            }
            mono
          />
        )}
      </div>

      {byLocation.length > 0 && (
        <>
          <div style={{ height: 1, background: "rgba(15,23,42,0.08)" }} />
          <div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 800,
                color: "rgba(15,23,42,0.55)",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                marginBottom: 4,
              }}
            >
              By location
            </div>
            {byLocation
              .filter((l) => l.qty > 0 || l.pendingOut > 0)
              .map((l) => (
                <Field
                  key={l.siteCode}
                  k={l.isPlant ? `🏭 ${l.siteName}` : `🏗 ${l.siteName}`}
                  v={
                    <>
                      {l.qty.toLocaleString("en-IN")} pcs
                      {l.pendingOut > 0 && (
                        <span style={{ color: "#b45309", marginLeft: 6 }}>
                          (−{l.pendingOut} pending)
                        </span>
                      )}
                    </>
                  }
                  mono
                />
              ))}
          </div>
        </>
      )}

      <Link
        href="/inventory/scaffolding"
        style={{
          padding: "7px 10px",
          fontSize: 11,
          fontWeight: 700,
          background: "var(--gold)",
          color: "#fff",
          border: "1px solid var(--gold-dark)",
          borderRadius: 7,
          textDecoration: "none",
          textAlign: "center",
        }}
      >
        Open scaffolding board →
      </Link>
    </div>
  );
}
