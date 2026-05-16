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
  Money,
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

      {/* PERSONAL banner — non-dismissable, prominent red/amber so
          the surface is unmistakably NOT a company-finance page. */}
      <div
        style={{
          marginBottom: 16,
          padding: "10px 14px",
          background: "linear-gradient(135deg, #fef3c7 0%, #fce7f3 100%)",
          border: "2px solid #d97706",
          borderRadius: 10,
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontSize: 12,
          fontWeight: 700,
          color: "#7c2d12",
          letterSpacing: "0.04em",
          textTransform: "uppercase",
        }}
      >
        <span style={{ fontSize: 16 }}>📓</span>
        <span>Personal ledger · NOT company books</span>
        <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 600, textTransform: "none", color: "#92400e" }}>
          Owner-scoped · all entries audit-logged
        </span>
      </div>

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
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
            My Parties
          </div>
          <h1 style={{ margin: "2px 0 0", fontSize: 22, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.01em" }}>
            {parties.length} {parties.length === 1 ? "party" : "parties"}
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--muted)" }}>
            Invoices + receipts + balance, per party. Excel-exportable.
          </p>
        </div>
        <Link
          href="/personal-ledger/buckets"
          style={{ ...BUTTON_STYLES.secondary, textDecoration: "none" }}
        >
          ⚙ Buckets
        </Link>
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

      {/* Add-party form */}
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
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 200))}
          placeholder="New party name (e.g. Cousin Ramesh, Acme Side Project)"
          style={{ ...INPUT_STYLE, flex: 1, minWidth: 0 }}
        />
        <button type="submit" disabled={pending || !name.trim()} style={BUTTON_STYLES.primary}>
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
  return (
    <div
      style={{
        padding: "12px 14px",
        background: "#fff",
        border: `1px solid ${ACCOUNTS_TOKENS.border}`,
        borderLeft: `4px solid ${tone === "success" ? ACCOUNTS_TOKENS.success : tone === "warning" ? ACCOUNTS_TOKENS.warning : ACCOUNTS_TOKENS.accent}`,
        borderRadius: 8,
        boxShadow: ACCOUNTS_TOKENS.shadow,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </div>
      <div style={{ marginTop: 4 }}>
        <Money value={amount} size="large" tone={tone} />
      </div>
    </div>
  );
}

function PartyRow({ party }: { party: PartySummary }) {
  const cleared = party.outstanding === 0 && party.invoiced > 0;
  return (
    <Link
      href={`/personal-ledger/${party.id}`}
      style={{
        background: "#fff",
        border: `1px solid ${ACCOUNTS_TOKENS.border}`,
        borderLeft: `4px solid ${cleared ? ACCOUNTS_TOKENS.success : party.outstanding > 0 ? ACCOUNTS_TOKENS.warning : ACCOUNTS_TOKENS.border}`,
        borderRadius: 10,
        padding: "14px 16px",
        boxShadow: ACCOUNTS_TOKENS.shadow,
        display: "flex",
        alignItems: "center",
        gap: 12,
        textDecoration: "none",
        color: "var(--text)",
        transition: "transform 0.08s ease, box-shadow 0.12s ease",
      }}
    >
      <VendorAvatar name={party.name} size={42} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>
          {party.name}
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
          Invoiced{" "}
          <strong style={{ fontFamily: "ui-monospace, monospace", color: "var(--text)" }}>
            ₹{party.invoiced.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
          </strong>
          {" · Received "}
          <strong style={{ fontFamily: "ui-monospace, monospace", color: ACCOUNTS_TOKENS.success }}>
            ₹{party.received.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
          </strong>
        </div>
      </div>
      <div style={{ textAlign: "right", minWidth: 120 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          {cleared ? "Cleared" : "Outstanding"}
        </div>
        <div style={{ marginTop: 2 }}>
          {cleared ? (
            <span style={{ fontSize: 16, fontWeight: 800, color: ACCOUNTS_TOKENS.success, fontFamily: "ui-monospace, monospace" }}>
              ₹0
            </span>
          ) : (
            <Money value={party.outstanding} size="large" tone={party.outstanding > 0 ? "warning" : "muted"} />
          )}
        </div>
      </div>
      <span style={{ fontSize: 14, color: "var(--muted)", marginLeft: 4 }}>→</span>
    </Link>
  );
}
