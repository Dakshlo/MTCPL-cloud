"use client";

/**
 * Migration 055 — Buckets admin client UI.
 *
 * Daksh asked for Finance-department UI parity, so we wear the same
 * ACCOUNTS_TOKENS palette + BUTTON_STYLES + INPUT_STYLE +
 * FinanceLoadingOverlay as the rest of /personal-ledger and the
 * actual /accounts surfaces.
 *
 * Each bucket row has:
 *   • Sort handle ("B / C / ICICI / Cash …")
 *   • Inline rename (click ✎ → input replaces label, ↵ to save)
 *   • Receipt count chip ("12 receipts")
 *   • Archive button (soft-archive, audit-logged)
 *
 * Archived buckets render below the live ones in a muted strip so
 * the user still sees the history (and any old receipt's bucket
 * label keeps resolving) without cluttering the active picker.
 */

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FinanceLoadingOverlay } from "@/components/finance-loading-overlay";
import {
  ACCOUNTS_TOKENS,
  BUTTON_STYLES,
  INPUT_STYLE,
} from "../../accounts/_ui/components";

export type BucketRow = {
  id: string;
  label: string;
  sortOrder: number;
  archivedAt: string | null;
  receiptCount: number;
};

type ActionResult = { ok: true } | { ok: false; error: string };

export function BucketsClient({
  buckets,
  addAction,
  renameAction,
  archiveAction,
}: {
  buckets: BucketRow[];
  addAction: (formData: FormData) => Promise<ActionResult>;
  renameAction: (formData: FormData) => Promise<ActionResult>;
  archiveAction: (formData: FormData) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");

  const live = buckets.filter((b) => !b.archivedAt);
  const archived = buckets.filter((b) => b.archivedAt);

  function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const trimmed = newLabel.trim();
    if (!trimmed) return setError("Enter a bucket label.");
    startTransition(async () => {
      const fd = new FormData();
      fd.set("label", trimmed);
      const r = await addAction(fd);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setNewLabel("");
      router.refresh();
    });
  }

  return (
    <section className="page-card">
      <FinanceLoadingOverlay show={pending} label="Saving bucket…" />

      {/* Mig 056 — PERSONAL banner removed per Daksh (banner pass
          across the whole personal-ledger surface). */}

      {/* Header */}
      <header
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "flex-end",
          gap: 14,
          marginBottom: 18,
          paddingBottom: 12,
          borderBottom: `1px solid ${ACCOUNTS_TOKENS.border}`,
        }}
      >
        <Link
          href="/personal-ledger"
          style={{ fontSize: 12, color: "var(--muted)", textDecoration: "none", fontWeight: 600 }}
        >
          ← All parties
        </Link>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
            Buckets
          </div>
          <h1 style={{ margin: "2px 0 0", fontSize: 22, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.01em" }}>
            {live.length} live {live.length === 1 ? "bucket" : "buckets"}
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--muted)" }}>
            Tag each receipt with the bucket it came into (e.g. ICICI, Cash, HDFC).
            Default seeded as <strong>B</strong> and <strong>C</strong> — rename freely.
          </p>
        </div>
      </header>

      {/* Add form */}
      <form
        onSubmit={handleAdd}
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          padding: 12,
          background: ACCOUNTS_TOKENS.surfaceMuted,
          border: `1px dashed ${ACCOUNTS_TOKENS.borderStrong}`,
          borderRadius: 10,
          marginBottom: 14,
        }}
      >
        <input
          type="text"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value.slice(0, 60))}
          placeholder="New bucket (e.g. ICICI, HDFC, Cash, Petty Box)"
          style={{ ...INPUT_STYLE, flex: 1, minWidth: 0 }}
        />
        <button type="submit" disabled={pending || !newLabel.trim()} style={BUTTON_STYLES.primary}>
          + Add bucket
        </button>
      </form>

      {error && (
        <div
          role="alert"
          style={{
            padding: "10px 14px",
            background: ACCOUNTS_TOKENS.dangerLight,
            border: `1px solid ${ACCOUNTS_TOKENS.danger}`,
            color: ACCOUNTS_TOKENS.danger,
            borderRadius: 8,
            marginBottom: 12,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {/* Live buckets */}
      {live.length === 0 ? (
        <div
          style={{
            padding: 28,
            background: ACCOUNTS_TOKENS.surfaceMuted,
            border: `1px dashed ${ACCOUNTS_TOKENS.borderStrong}`,
            borderRadius: 10,
            textAlign: "center",
            color: "var(--muted)",
            fontSize: 13,
          }}
        >
          No live buckets. Add one above to start tagging receipts.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {live.map((b) => (
            <BucketRowView
              key={b.id}
              bucket={b}
              renameAction={renameAction}
              archiveAction={archiveAction}
              setOuterError={setError}
            />
          ))}
        </div>
      )}

      {/* Archived */}
      {archived.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--muted)",
              textTransform: "uppercase",
              letterSpacing: "0.07em",
              marginBottom: 8,
            }}
          >
            Archived ({archived.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {archived.map((b) => (
              <div
                key={b.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 14px",
                  background: ACCOUNTS_TOKENS.surfaceMuted,
                  border: `1px dashed ${ACCOUNTS_TOKENS.border}`,
                  borderRadius: 8,
                  color: "var(--muted)",
                  fontSize: 13,
                }}
              >
                <span
                  style={{
                    fontFamily: "ui-monospace, monospace",
                    fontWeight: 700,
                    textDecoration: "line-through",
                  }}
                >
                  {b.label}
                </span>
                <span style={{ fontSize: 11, opacity: 0.75 }}>
                  {b.receiptCount} historical {b.receiptCount === 1 ? "receipt" : "receipts"}
                </span>
                <span style={{ marginLeft: "auto", fontSize: 11, opacity: 0.6 }}>
                  archived
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────
// One live-bucket row — read mode + inline rename mode + archive btn
// ────────────────────────────────────────────────────────────────────

function BucketRowView({
  bucket,
  renameAction,
  archiveAction,
  setOuterError,
}: {
  bucket: BucketRow;
  renameAction: (formData: FormData) => Promise<ActionResult>;
  archiveAction: (formData: FormData) => Promise<ActionResult>;
  setOuterError: (s: string | null) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(bucket.label);
  const [localError, setLocalError] = useState<string | null>(null);

  function commitRename() {
    setLocalError(null);
    setOuterError(null);
    const trimmed = draft.trim();
    if (!trimmed) {
      setLocalError("Label can't be empty.");
      return;
    }
    if (trimmed === bucket.label) {
      setEditing(false);
      return;
    }
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", bucket.id);
      fd.set("label", trimmed);
      const r = await renameAction(fd);
      if (!r.ok) {
        setLocalError(r.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  function handleArchive() {
    setLocalError(null);
    setOuterError(null);
    if (
      !confirm(
        `Archive bucket "${bucket.label}"?\n\nIt'll stop appearing in the receipt picker. Past receipts tagged with this bucket will keep their tag.`,
      )
    )
      return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", bucket.id);
      const r = await archiveAction(fd);
      if (!r.ok) {
        setOuterError(r.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "12px 14px",
        background: "#fff",
        border: `1px solid ${ACCOUNTS_TOKENS.border}`,
        borderLeft: `4px solid ${ACCOUNTS_TOKENS.accent}`,
        borderRadius: 10,
        boxShadow: ACCOUNTS_TOKENS.shadow,
        flexWrap: "wrap",
      }}
    >
      {editing ? (
        <>
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, 60))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitRename();
              } else if (e.key === "Escape") {
                setDraft(bucket.label);
                setEditing(false);
                setLocalError(null);
              }
            }}
            autoFocus
            style={{ ...INPUT_STYLE, flex: "0 1 280px", fontWeight: 700, fontFamily: "ui-monospace, monospace" }}
          />
          <button
            type="button"
            onClick={commitRename}
            disabled={pending || !draft.trim()}
            style={BUTTON_STYLES.primary}
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft(bucket.label);
              setEditing(false);
              setLocalError(null);
            }}
            disabled={pending}
            style={BUTTON_STYLES.secondary}
          >
            Cancel
          </button>
        </>
      ) : (
        <>
          <span
            style={{
              fontFamily: "ui-monospace, monospace",
              fontWeight: 800,
              fontSize: 15,
              color: "var(--text)",
              minWidth: 80,
            }}
          >
            {bucket.label}
          </span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: "3px 8px",
              borderRadius: 999,
              background: ACCOUNTS_TOKENS.accentLight,
              color: ACCOUNTS_TOKENS.accent,
              border: `1px solid ${ACCOUNTS_TOKENS.accentBorder}`,
            }}
          >
            {bucket.receiptCount} {bucket.receiptCount === 1 ? "receipt" : "receipts"}
          </span>
          <button
            type="button"
            onClick={() => {
              setEditing(true);
              setLocalError(null);
            }}
            style={{
              ...BUTTON_STYLES.secondary,
              padding: "6px 12px",
              fontSize: 12,
              marginLeft: "auto",
            }}
          >
            ✎ Rename
          </button>
          <button
            type="button"
            onClick={handleArchive}
            disabled={pending}
            style={{
              ...BUTTON_STYLES.danger,
              padding: "6px 12px",
              fontSize: 12,
            }}
          >
            Archive
          </button>
        </>
      )}
      {localError && (
        <div
          role="alert"
          style={{
            flex: "1 0 100%",
            marginTop: 6,
            padding: "6px 10px",
            background: ACCOUNTS_TOKENS.dangerLight,
            border: `1px solid ${ACCOUNTS_TOKENS.danger}`,
            color: ACCOUNTS_TOKENS.danger,
            borderRadius: 6,
            fontSize: 12,
          }}
        >
          {localError}
        </div>
      )}
    </div>
  );
}
