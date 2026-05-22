"use client";

/**
 * Mig 064 — Royalty Approval queue, owner-only.
 *
 * UX:
 *  1. On mount, render a passphrase prompt ("125500" by Daksh's
 *     convention). No queue fetched until the passphrase verifies
 *     server-side, so a stray load of this URL doesn't leak the
 *     pending list.
 *  2. On verify success, render the queue:
 *       vendor name · ₹amount · received/paid · description ·
 *       added by · when · Approve / Reject buttons.
 *  3. Each Approve / Reject hits its server action (passphrase
 *     check is one-shot; the action only checks role).
 *  4. Approved entries disappear from the queue; rejected entries
 *     soft-cancel (cancel_reason='owner_rejected_pending').
 *
 * Re-prompts on every visit (no session caching) — same threat
 * model as the Private Notes modal.
 */

import { useState, useTransition } from "react";
import Link from "next/link";
import { FinanceLoadingOverlay } from "@/components/finance-loading-overlay";

type ListResult =
  | {
      ok: true;
      entries: Array<{
        id: string;
        billVendorId: string;
        vendorName: string;
        amount: number;
        entryType: "received" | "given";
        description: string | null;
        // Mig 068 — business date for the entry. NULL on legacy rows
        // (the queue UI falls back to createdAt::date for those).
        entryDate: string | null;
        createdAt: string;
        createdByName: string | null;
      }>;
    }
  | { ok: false; error: string };

type ActionResult = { ok: true } | { ok: false; error: string };

// Mig 064 follow-on (Daksh) — royalty entries aren't money, they're
// abstract "royalty points" tallied between us and the vendor. Drop
// the ₹ prefix so the queue page doesn't imply rupee amounts.
function fmtPoints(n: number): string {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Mig 068 — render the business date for an entry. Prefers
 *  `entryDate` (an ISO YYYY-MM-DD string from the DB DATE column);
 *  falls back to `createdAt::date` for legacy rows that pre-date the
 *  column. Format: "21 May 2026" — short and unambiguous. */
function fmtEntryDate(entryDate: string | null, createdAt: string): string {
  const iso = entryDate ?? createdAt.slice(0, 10);
  const d = new Date(`${iso}T00:00:00+05:30`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function RoyaltyApprovalsClient({
  listAction,
  approveAction,
  rejectAction,
}: {
  listAction: (fd: FormData) => Promise<ListResult>;
  approveAction: (fd: FormData) => Promise<ActionResult>;
  rejectAction: (fd: FormData) => Promise<ActionResult>;
}) {
  const [passphrase, setPassphrase] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [entries, setEntries] = useState<
    Extract<ListResult, { ok: true }>["entries"]
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleUnlock(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("passphrase", passphrase);
      const r = await listAction(fd);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setUnlocked(true);
      setEntries(r.entries);
    });
  }

  function refresh() {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("passphrase", passphrase);
      const r = await listAction(fd);
      if (r.ok) setEntries(r.entries);
      else setError(r.error);
    });
  }

  function handleApprove(entryId: string) {
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("entry_id", entryId);
      const r = await approveAction(fd);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      // Optimistically drop from list, then refresh in case other
      // entries landed since the page loaded.
      setEntries((prev) => prev.filter((e) => e.id !== entryId));
      refresh();
    });
  }

  function handleReject(entryId: string) {
    if (
      !confirm(
        "Reject this royalty entry? It will be soft-deleted and removed from the queue.",
      )
    )
      return;
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("entry_id", entryId);
      const r = await rejectAction(fd);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setEntries((prev) => prev.filter((e) => e.id !== entryId));
      refresh();
    });
  }

  return (
    <section className="page-card" style={{ maxWidth: 920, margin: "0 auto" }}>
      <FinanceLoadingOverlay
        show={pending}
        label={unlocked ? "Updating queue…" : "Unlocking…"}
      />
      <header style={{ marginBottom: 18 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "var(--muted)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          Owner Task
        </div>
        <h1 style={{ margin: "2px 0", fontSize: 24, fontWeight: 800 }}>
          🏷️ Royalty Approval
        </h1>
        <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
          Royalty entries added by accountant / accountant_star / crosscheck
          land here for approval before counting toward each vendor's net
          balance. Approve to lock in. Reject to soft-delete.
        </p>
      </header>

      {!unlocked ? (
        <form
          onSubmit={handleUnlock}
          style={{
            background: "#fffbeb",
            border: "1px dashed #d97706",
            borderRadius: 12,
            padding: 24,
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#92400e", marginBottom: 4 }}>
              🔒 Enter approval passphrase
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              The queue is locked behind a separate passphrase. Owner uses
              the same number every time.
            </div>
          </div>
          <input
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder="Passphrase"
            autoFocus
            inputMode="numeric"
            style={{
              padding: "10px 14px",
              fontSize: 16,
              fontFamily: "ui-monospace, monospace",
              background: "#fff",
              border: "1px solid #cbd5e1",
              borderRadius: 8,
              letterSpacing: "0.2em",
            }}
          />
          {error && (
            <div
              role="alert"
              style={{
                padding: "8px 12px",
                background: "#fee2e2",
                border: "1px solid #b91c1c",
                color: "#b91c1c",
                borderRadius: 8,
                fontSize: 12,
              }}
            >
              {error}
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <Link
              href="/accounts"
              style={{ fontSize: 12, color: "var(--muted)" }}
            >
              ← Back to Accounts
            </Link>
            <button
              type="submit"
              disabled={pending || !passphrase}
              className="primary-button"
              style={{
                padding: "9px 18px",
                fontWeight: 700,
                fontSize: 14,
                opacity: !passphrase ? 0.6 : 1,
              }}
            >
              {pending ? "Unlocking…" : "Unlock queue"}
            </button>
          </div>
        </form>
      ) : (
        <div>
          {error && (
            <div
              role="alert"
              style={{
                marginBottom: 12,
                padding: "8px 12px",
                background: "#fee2e2",
                border: "1px solid #b91c1c",
                color: "#b91c1c",
                borderRadius: 8,
                fontSize: 12,
              }}
            >
              {error}
            </div>
          )}
          {/* Daksh May 2026 — pending-queue totals tile.
              Renders a compact summary above the list so dad can see
              "₹X received from vendors, ₹Y given to vendors, net Z"
              at a glance before scrolling each entry. Tells him in
              one number whether this batch tilts heavily one way
              before he starts approving. Hidden when the queue is
              empty. */}
          {entries.length > 0 && <RoyaltyTotalsTile entries={entries} />}
          {entries.length === 0 ? (
            <div
              style={{
                padding: 48,
                textAlign: "center",
                color: "var(--muted)",
                background: "var(--surface)",
                border: "1px dashed var(--border)",
                borderRadius: 12,
              }}
            >
              🎉 All caught up — no pending royalty entries.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {entries.map((e) => {
                const isReceived = e.entryType === "received";
                return (
                  <div
                    key={e.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr auto",
                      gap: 14,
                      padding: "14px 18px",
                      background: "#fff",
                      border: "1px solid var(--border)",
                      borderLeft: `4px solid ${isReceived ? "#b91c1c" : "#15803d"}`,
                      borderRadius: 12,
                      boxShadow:
                        "0 1px 2px rgba(15,23,42,0.04), 0 1px 3px rgba(15,23,42,0.06)",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
                        <Link
                          href={`/accounts/vendors/${e.billVendorId}`}
                          style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", textDecoration: "none" }}
                        >
                          {e.vendorName}
                        </Link>
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 800,
                            letterSpacing: "0.06em",
                            padding: "2px 8px",
                            borderRadius: 999,
                            background: isReceived ? "rgba(220,38,38,0.10)" : "rgba(34,197,94,0.10)",
                            color: isReceived ? "#b91c1c" : "#15803d",
                          }}
                        >
                          {isReceived ? "RECEIVED (−)" : "PAID (+)"}
                        </span>
                      </div>
                      <div
                        style={{
                          fontFamily: "ui-monospace, monospace",
                          fontSize: 22,
                          fontWeight: 800,
                          color: isReceived ? "#b91c1c" : "#15803d",
                          marginBottom: 4,
                        }}
                      >
                        {fmtPoints(e.amount)}
                      </div>
                      {e.description && (
                        <div style={{ fontSize: 12, color: "var(--text)", marginBottom: 4 }}>
                          {e.description}
                        </div>
                      )}
                      {/* Mig 068 — show the business date prominently
                          so the owner can see WHEN this entry
                          actually happened (vs. when it was logged
                          into the system). For legacy entries the
                          helper falls back to createdAt::date so the
                          line still reads sensibly. */}
                      <div
                        style={{
                          fontSize: 12,
                          color: "var(--text)",
                          fontWeight: 600,
                          fontFamily: "ui-monospace, monospace",
                          marginBottom: 4,
                        }}
                        title={e.entryDate ? "Date this entry happened" : "Legacy entry — date is when it was added"}
                      >
                        📅 {fmtEntryDate(e.entryDate, e.createdAt)}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--muted)" }}>
                        Added by <strong>{e.createdByName ?? "Unknown"}</strong>
                        {" · "}
                        {fmtWhen(e.createdAt)}
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, alignSelf: "center" }}>
                      <button
                        type="button"
                        onClick={() => handleApprove(e.id)}
                        disabled={pending}
                        style={{
                          padding: "8px 16px",
                          fontSize: 13,
                          fontWeight: 700,
                          background: "#15803d",
                          color: "#fff",
                          border: "1px solid #166534",
                          borderRadius: 8,
                          cursor: pending ? "wait" : "pointer",
                          whiteSpace: "nowrap",
                        }}
                      >
                        ✓ Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => handleReject(e.id)}
                        disabled={pending}
                        style={{
                          padding: "8px 16px",
                          fontSize: 13,
                          fontWeight: 700,
                          background: "#fff",
                          color: "#b91c1c",
                          border: "1px solid #b91c1c",
                          borderRadius: 8,
                          cursor: pending ? "wait" : "pointer",
                          whiteSpace: "nowrap",
                        }}
                      >
                        ✕ Reject
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div style={{ marginTop: 18, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Link
              href="/accounts"
              style={{ fontSize: 12, color: "var(--muted)" }}
            >
              ← Back to Accounts
            </Link>
            <button
              type="button"
              onClick={refresh}
              disabled={pending}
              className="ghost-button"
              style={{ fontSize: 12, padding: "6px 14px" }}
            >
              {pending ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// ── Pending-queue totals tile (Daksh, May 2026) ──────────────────
//
// One band above the entry list with the three numbers dad cares
// about while scanning the queue:
//   • RECEIVED — sum of `received` entries (vendor → us flow).
//   • GIVEN    — sum of `given` entries (us → vendor flow).
//   • NET      — received minus given. Tinted green/amber/red so a
//                lopsided batch jumps out: green when we're net
//                receivers, red when net givers.
//
// "Royalty points" not rupees — see fmtPoints comment up top.
// Stays in a single horizontal band on tablet (3-col grid), wraps
// to one-per-row on phones via `auto-fit` + minmax.
function RoyaltyTotalsTile({
  entries,
}: {
  entries: Array<{ amount: number; entryType: "received" | "given" }>;
}) {
  let receivedTotal = 0;
  let givenTotal = 0;
  let receivedCount = 0;
  let givenCount = 0;
  for (const e of entries) {
    if (e.entryType === "received") {
      receivedTotal += e.amount;
      receivedCount += 1;
    } else {
      givenTotal += e.amount;
      givenCount += 1;
    }
  }
  const net = receivedTotal - givenTotal;
  // Pick a tint for the Net tile based on which side dominates.
  // Threshold 0.5 to avoid flicker around exact zero. Green when we
  // net receivers (positive), red when net givers (negative), grey
  // when even.
  const netTone =
    net > 0.5
      ? { bg: "#dcfce7", border: "#16a34a", fg: "#15803d", icon: "↗" }
      : net < -0.5
        ? { bg: "#fee2e2", border: "#dc2626", fg: "#b91c1c", icon: "↘" }
        : { bg: "#f1f5f9", border: "#cbd5e1", fg: "#475569", icon: "·" };
  return (
    <div
      style={{
        marginBottom: 14,
        padding: "14px 16px",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        boxShadow: "0 1px 0 rgba(15,23,42,0.04)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 10,
          marginBottom: 10,
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 800,
            color: "var(--muted)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          Queue totals
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)" }}>
          {entries.length} pending entr{entries.length === 1 ? "y" : "ies"}
        </div>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: 10,
        }}
      >
        {/* Received side — green tint matches the "received" entry
            cards below so the colour vocab is consistent. */}
        <TotalTile
          label="Received from vendors"
          count={receivedCount}
          value={fmtPoints(receivedTotal)}
          tone={{ bg: "#dcfce7", border: "#16a34a", fg: "#15803d" }}
          prefix="+"
        />
        {/* Given side — amber tint, mirrors the per-row chip below. */}
        <TotalTile
          label="Given to vendors"
          count={givenCount}
          value={fmtPoints(givenTotal)}
          tone={{ bg: "#fef3c7", border: "#d97706", fg: "#b45309" }}
          prefix="−"
        />
        {/* Net — most important number. Bigger value, dynamic tint
            based on sign so dad reads the direction in colour first,
            magnitude second. */}
        <div
          style={{
            padding: "12px 14px",
            background: netTone.bg,
            border: `1.5px solid ${netTone.border}`,
            borderRadius: 10,
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 800,
              color: netTone.fg,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            Net (received − given)
          </div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 800,
              color: netTone.fg,
              marginTop: 3,
              fontFamily: "ui-monospace, monospace",
              fontFeatureSettings: '"tnum"',
              letterSpacing: "-0.01em",
            }}
          >
            {netTone.icon} {fmtPoints(Math.abs(net))}
          </div>
          <div style={{ fontSize: 10, color: netTone.fg, marginTop: 2, fontWeight: 600 }}>
            {net > 0.5
              ? "Vendors are paying us net"
              : net < -0.5
                ? "We're paying vendors net"
                : "Even — no net direction"}
          </div>
        </div>
      </div>
    </div>
  );
}

function TotalTile({
  label,
  count,
  value,
  tone,
  prefix,
}: {
  label: string;
  count: number;
  value: string;
  tone: { bg: string; border: string; fg: string };
  prefix?: string;
}) {
  return (
    <div
      style={{
        padding: "12px 14px",
        background: tone.bg,
        border: `1px solid ${tone.border}`,
        borderRadius: 10,
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 800,
          color: tone.fg,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 20,
          fontWeight: 800,
          color: tone.fg,
          marginTop: 3,
          fontFamily: "ui-monospace, monospace",
          fontFeatureSettings: '"tnum"',
          letterSpacing: "-0.01em",
        }}
      >
        {prefix ?? ""}
        {value}
      </div>
      <div style={{ fontSize: 10, color: tone.fg, marginTop: 2, fontWeight: 600 }}>
        {count} entr{count === 1 ? "y" : "ies"}
      </div>
    </div>
  );
}
