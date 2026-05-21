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
