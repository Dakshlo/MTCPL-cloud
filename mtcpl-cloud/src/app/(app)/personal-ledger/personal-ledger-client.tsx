"use client";

/**
 * Migration 055 — party list client UI.
 *
 * Same Finance-department visual language as the rest of the app
 * (ACCOUNTS_TOKENS palette, BUTTON_STYLES, INPUT_STYLE,
 * FinanceLoadingOverlay) — Daksh asked for UI parity with Accounts.
 *
 * The page-wide "PERSONAL — NOT COMPANY BOOKS" banner is the only
 * thing that visually separates this from a real Finance page. The
 * banner is intentionally non-dismissable so the surface is never
 * confused mid-session.
 */

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FinanceLoadingOverlay } from "@/components/finance-loading-overlay";
import {
  ACCOUNTS_TOKENS,
  BUTTON_STYLES,
  INPUT_STYLE,
  VendorAvatar,
} from "../accounts/_ui/components";

export type PartySummary = {
  id: string;
  name: string;
  createdAt: string;
  invoiced: number;
  received: number;
  outstanding: number;
};

type ActionResult = { ok: true } | { ok: false; error: string };

export function PersonalLedgerClient({
  parties,
  addAction,
}: {
  parties: PartySummary[];
  addAction: (formData: FormData) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [quickFilter, setQuickFilter] = useState("");

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

  function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) return setError("Enter a party name.");
    startTransition(async () => {
      const fd = new FormData();
      fd.set("name", trimmed);
      const r = await addAction(fd);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setName("");
      router.refresh();
    });
  }

  return (
    <section className="page-card">
      <FinanceLoadingOverlay show={pending} label="Saving party…" />

      {/* PERSONAL banner — non-dismissable, prominent amber so the
          surface is unmistakably NOT a company-finance page. Daksh
          (Mig 055 follow-on): bumped weight + size for more
          presence on first scan. */}
      <div
        style={{
          marginBottom: 18,
          padding: "14px 18px",
          background: "linear-gradient(135deg, #fef3c7 0%, #fce7f3 100%)",
          border: "2px solid #d97706",
          borderRadius: 12,
          display: "flex",
          alignItems: "center",
          gap: 12,
          fontSize: 13,
          fontWeight: 800,
          color: "#7c2d12",
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          boxShadow: "0 2px 8px rgba(217, 119, 6, 0.12)",
        }}
      >
        <span style={{ fontSize: 22, lineHeight: 1 }}>📓</span>
        <span>Personal ledger · NOT company books</span>
        <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, textTransform: "none", color: "#92400e" }}>
          Owner-scoped · all entries audit-logged
        </span>
      </div>

      <header
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "flex-end",
          gap: 14,
          marginBottom: 22,
          paddingBottom: 16,
          borderBottom: `1px solid ${ACCOUNTS_TOKENS.border}`,
        }}
      >
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
            My Parties
          </div>
          <h1
            style={{
              margin: "4px 0 0",
              fontSize: 32,
              fontWeight: 900,
              color: "var(--text)",
              letterSpacing: "-0.02em",
              lineHeight: 1.1,
            }}
          >
            {parties.length}{" "}
            <span style={{ fontSize: 18, fontWeight: 700, color: "var(--muted)", letterSpacing: "-0.01em" }}>
              {parties.length === 1 ? "party" : "parties"}
            </span>
          </h1>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--muted)", fontWeight: 500 }}>
            Invoices + receipts + balance, per party. Excel-exportable.
          </p>
        </div>
      </header>

      {/* Top-line totals */}
      {parties.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(180px, 1fr))",
            gap: 12,
            marginBottom: 18,
          }}
        >
          <TopStat label="Total invoiced" amount={totals.invoiced} tone="accent" />
          <TopStat label="Total received" amount={totals.received} tone="success" />
          <TopStat label="Outstanding" amount={totals.outstanding} tone="warning" />
        </div>
      )}

      {/* Add-party form — bumped to match the new KPI-tile weight
          above. Solid surface, thicker border, taller input. */}
      <form
        onSubmit={handleAdd}
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          padding: 14,
          background: "#fff",
          border: `1.5px solid ${ACCOUNTS_TOKENS.borderStrong}`,
          borderRadius: 12,
          marginBottom: 16,
          boxShadow: ACCOUNTS_TOKENS.shadow,
        }}
      >
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 200))}
          placeholder="New party name (e.g. Cousin Ramesh, Acme Side Project)"
          style={{
            ...INPUT_STYLE,
            flex: 1,
            minWidth: 0,
            padding: "11px 14px",
            fontSize: 14,
            fontWeight: 600,
          }}
        />
        <button
          type="submit"
          disabled={pending || !name.trim()}
          style={{
            ...BUTTON_STYLES.primary,
            padding: "11px 22px",
            fontSize: 14,
          }}
        >
          + Add party
        </button>
      </form>

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
          No parties yet. Add one above to start tracking invoices and receipts.
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
            <PartyRow key={p.id} party={p} />
          ))}
        </div>
      )}
    </section>
  );
}

function TopStat({
  label,
  amount,
  tone,
}: {
  label: string;
  amount: number;
  tone: "accent" | "success" | "warning";
}) {
  // Mig 055 follow-on (Daksh: "more bold and all") — these are the
  // page's hero numbers; they should read like real KPI tiles, not
  // muted strip-cards. Tinted background, beefier left bar, big
  // number, and a thin top-of-card colour line.
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
        position: "relative",
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

function PartyRow({ party }: { party: PartySummary }) {
  // Mig 055 follow-on (Daksh: "more bold and all") — row tiles
  // upgraded: 52px avatar, bigger name, three-line info hierarchy
  // (name → invoiced/received → outstanding), heavier left status
  // bar, larger arrow.
  const cleared = party.outstanding === 0 && party.invoiced > 0;
  const statusColor = cleared
    ? ACCOUNTS_TOKENS.success
    : party.outstanding > 0
    ? ACCOUNTS_TOKENS.warning
    : ACCOUNTS_TOKENS.neutral;
  return (
    <Link
      href={`/personal-ledger/${party.id}`}
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
        transition: "transform 0.1s ease, box-shadow 0.15s ease, border-color 0.15s ease",
      }}
    >
      <VendorAvatar name={party.name} size={52} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 17,
            fontWeight: 800,
            color: "var(--text)",
            letterSpacing: "-0.01em",
            lineHeight: 1.2,
          }}
        >
          {party.name}
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
                fontFamily: "ui-monospace, monospace",
                color: ACCOUNTS_TOKENS.accent,
                fontWeight: 800,
                fontSize: 13,
              }}
            >
              ₹{party.invoiced.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
            </strong>
          </span>
          <span style={{ color: "var(--muted)", fontWeight: 600 }}>
            Received{" "}
            <strong
              style={{
                fontFamily: "ui-monospace, monospace",
                color: ACCOUNTS_TOKENS.success,
                fontWeight: 800,
                fontSize: 13,
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
    </Link>
  );
}
