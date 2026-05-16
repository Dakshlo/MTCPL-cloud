"use client";

/**
 * Migration 055 — Party detail (3-card view).
 *
 * Same Finance-department visual language throughout
 * (ACCOUNTS_TOKENS, BUTTON_STYLES, INPUT_STYLE, Money,
 * FinanceLoadingOverlay during saves). Three cards in a row on
 * wide screens, stacked on narrow:
 *   1. Invoices  — list + new-invoice form
 *   2. Received  — list + new-receipt form
 *   3. Summary   — totals + Excel export
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
} from "../../accounts/_ui/components";

export type BucketOption = { id: string; label: string };

export type InvoiceItem = {
  description: string;
  stone_type: string;
  unit: "sft" | "cft";
  quantity: number;
  rate: number;
  line_total: number;
};

export type InvoiceRow = {
  id: string;
  invoiceNo: string;
  invoiceDate: string;
  items: InvoiceItem[];
  subtotal: number;
  gstAmount: number;
  total: number;
  notes: string | null;
  createdAt: string;
};

export type ReceiptRow = {
  id: string;
  bucketId: string;
  bucketLabel: string;
  amount: number;
  receiptDate: string;
  note: string | null;
  createdAt: string;
};

type ActionResult = { ok: true } | { ok: false; error: string };

const STONE_TYPE_PRESETS = [
  "Pink Stone",
  "White Stone",
  "Marble",
  "Granite",
  "Sandstone",
  "Other",
];

function inr(n: number): string {
  if (!isFinite(n)) return "—";
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function todayKeyIst(): string {
  const t = Date.now() + 5.5 * 60 * 60 * 1000;
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

// Mig 055 follow-on (Daksh: "give B blue color and C grey color").
// Per-bucket pill / card palette. Special-cased for the default
// bucket labels Daksh actually uses; everything else falls through
// to the prior emerald tint so renamed / additional buckets stay
// readable without us having to mint a colour per label.
function bucketPalette(label: string): {
  bg: string;
  fg: string;
  bar: string;
} {
  const trimmed = label.trim().toUpperCase();
  if (trimmed === "B") {
    return { bg: "#dbeafe", fg: "#1d4ed8", bar: "#1d4ed8" }; // blue
  }
  if (trimmed === "C") {
    return { bg: "#e2e8f0", fg: "#475569", bar: "#64748b" }; // slate / grey
  }
  // Default — keep the original emerald look for any other bucket
  // (e.g. ICICI, Cash) so existing data doesn't visually break.
  return { bg: "#dcfce7", fg: "#15803d", bar: "#15803d" };
}

export function PartyDetailClient({
  partyId,
  partyName,
  buckets,
  invoices,
  receipts,
  addInvoiceAction,
  cancelInvoiceAction,
  addReceiptAction,
  cancelReceiptAction,
}: {
  partyId: string;
  partyName: string;
  buckets: BucketOption[];
  invoices: InvoiceRow[];
  receipts: ReceiptRow[];
  addInvoiceAction: (formData: FormData) => Promise<ActionResult>;
  cancelInvoiceAction: (formData: FormData) => Promise<ActionResult>;
  addReceiptAction: (formData: FormData) => Promise<ActionResult>;
  cancelReceiptAction: (formData: FormData) => Promise<ActionResult>;
}) {
  // Active card. Default: Invoices. Hash-routed so a refresh keeps
  // the card open + the URL is shareable.
  const [activeCard, setActiveCard] = useState<"invoices" | "received" | "summary">(
    "invoices",
  );

  const totals = useMemo(() => {
    const invoicedTotal = invoices.reduce((s, r) => s + r.total, 0);
    const receivedTotal = receipts.reduce((s, r) => s + r.amount, 0);
    // Per-bucket aggregation for the summary card.
    const byBucket = new Map<string, { label: string; total: number }>();
    for (const r of receipts) {
      const entry = byBucket.get(r.bucketId) ?? { label: r.bucketLabel, total: 0 };
      entry.total += r.amount;
      byBucket.set(r.bucketId, entry);
    }
    return {
      invoicedTotal,
      receivedTotal,
      outstanding: invoicedTotal - receivedTotal,
      byBucket: [...byBucket.values()].sort((a, b) => b.total - a.total),
    };
  }, [invoices, receipts]);

  const xlsxHref = `/api/personal-ledger/${partyId}/export.xlsx`;

  return (
    <section className="page-card">
      {/* PERSONAL banner */}
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
          Owner-scoped · audit-logged
        </span>
      </div>

      {/* Header */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          marginBottom: 16,
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
        <VendorAvatar name={partyName} size={42} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Party
          </div>
          <h1 style={{ margin: "2px 0 0", fontSize: 22, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.01em" }}>
            {partyName}
          </h1>
        </div>
      </header>

      {/* Three card tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        <CardTab
          icon="📄"
          label="Invoices"
          count={invoices.length}
          subline={inr(totals.invoicedTotal)}
          active={activeCard === "invoices"}
          onClick={() => setActiveCard("invoices")}
        />
        <CardTab
          icon="💵"
          label="Received"
          count={receipts.length}
          subline={inr(totals.receivedTotal)}
          active={activeCard === "received"}
          onClick={() => setActiveCard("received")}
        />
        <CardTab
          icon="📊"
          label="Summary"
          count={null}
          subline={
            totals.outstanding === 0 && totals.invoicedTotal > 0
              ? "Cleared"
              : `${inr(totals.outstanding)} due`
          }
          active={activeCard === "summary"}
          onClick={() => setActiveCard("summary")}
          tone={totals.outstanding === 0 && totals.invoicedTotal > 0 ? "success" : "warning"}
        />
      </div>

      {/* Active card */}
      {activeCard === "invoices" && (
        <InvoicesCard
          partyId={partyId}
          invoices={invoices}
          addAction={addInvoiceAction}
          cancelAction={cancelInvoiceAction}
        />
      )}
      {activeCard === "received" && (
        <ReceivedCard
          partyId={partyId}
          buckets={buckets}
          receipts={receipts}
          addAction={addReceiptAction}
          cancelAction={cancelReceiptAction}
        />
      )}
      {activeCard === "summary" && (
        <SummaryCard
          partyName={partyName}
          invoicedTotal={totals.invoicedTotal}
          receivedTotal={totals.receivedTotal}
          outstanding={totals.outstanding}
          byBucket={totals.byBucket}
          invoiceCount={invoices.length}
          receiptCount={receipts.length}
          xlsxHref={xlsxHref}
        />
      )}
    </section>
  );
}

function CardTab({
  icon,
  label,
  count,
  subline,
  active,
  onClick,
  tone = "accent",
}: {
  icon: string;
  label: string;
  count: number | null;
  subline: string;
  active: boolean;
  onClick: () => void;
  tone?: "accent" | "success" | "warning";
}) {
  const accentColor =
    tone === "success" ? ACCOUNTS_TOKENS.success : tone === "warning" ? ACCOUNTS_TOKENS.warning : ACCOUNTS_TOKENS.accent;
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: "1 1 180px",
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "12px 14px",
        background: active ? `${accentColor}11` : "#fff",
        border: `1px solid ${active ? accentColor : ACCOUNTS_TOKENS.border}`,
        borderLeft: `4px solid ${accentColor}`,
        borderRadius: 8,
        cursor: "pointer",
        textAlign: "left",
        transition: "background 0.12s ease, border 0.12s ease",
      }}
    >
      <span style={{ fontSize: 18, lineHeight: 1 }} aria-hidden>
        {icon}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          {label}
          {count != null && (
            <span style={{ marginLeft: 6, fontFamily: "ui-monospace, monospace" }}>· {count}</span>
          )}
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginTop: 2, fontFamily: "ui-monospace, monospace" }}>
          {subline}
        </div>
      </div>
    </button>
  );
}

// ════════════════════════════════════════════════════════════════
// Invoices card
// ════════════════════════════════════════════════════════════════

function InvoicesCard({
  partyId,
  invoices,
  addAction,
  cancelAction,
}: {
  partyId: string;
  invoices: InvoiceRow[];
  addAction: (formData: FormData) => Promise<ActionResult>;
  cancelAction: (formData: FormData) => Promise<ActionResult>;
}) {
  const [showForm, setShowForm] = useState(false);
  return (
    <div
      style={{
        background: "#fff",
        border: `1px solid ${ACCOUNTS_TOKENS.border}`,
        borderRadius: 12,
        padding: 16,
        boxShadow: ACCOUNTS_TOKENS.shadow,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "var(--text)" }}>
          📄 Invoices
        </h2>
        <span style={{ marginLeft: 10, fontSize: 12, color: "var(--muted)" }}>
          {invoices.length} live · total{" "}
          <strong style={{ fontFamily: "ui-monospace, monospace", color: "var(--text)" }}>
            {inr(invoices.reduce((s, r) => s + r.total, 0))}
          </strong>
        </span>
        <button
          type="button"
          onClick={() => setShowForm((s) => !s)}
          style={{ ...BUTTON_STYLES.primary, marginLeft: "auto" }}
        >
          {showForm ? "Close" : "+ New invoice"}
        </button>
      </div>

      {showForm && (
        <NewInvoiceForm
          partyId={partyId}
          addAction={addAction}
          onClose={() => setShowForm(false)}
        />
      )}

      {invoices.length === 0 ? (
        <div
          style={{
            padding: 24,
            background: ACCOUNTS_TOKENS.surfaceMuted,
            border: `1px dashed ${ACCOUNTS_TOKENS.borderStrong}`,
            borderRadius: 8,
            textAlign: "center",
            color: "var(--muted)",
            fontSize: 13,
          }}
        >
          No invoices yet. Click <strong>+ New invoice</strong> to create one.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
          {invoices.map((inv) => (
            <InvoiceRowView key={inv.id} invoice={inv} cancelAction={cancelAction} />
          ))}
        </div>
      )}
    </div>
  );
}

function NewInvoiceForm({
  partyId,
  addAction,
  onClose,
}: {
  partyId: string;
  addAction: (formData: FormData) => Promise<ActionResult>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(todayKeyIst());
  const [gstAmount, setGstAmount] = useState("0");
  const [notes, setNotes] = useState("");

  type Draft = {
    description: string;
    stone_type: string;
    unit: "sft" | "cft";
    quantity: string;
    rate: string;
  };
  const [items, setItems] = useState<Draft[]>([
    { description: "", stone_type: STONE_TYPE_PRESETS[0], unit: "sft", quantity: "", rate: "" },
  ]);

  function patchItem(i: number, patch: Partial<Draft>) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }
  function addRow() {
    setItems((prev) => [
      ...prev,
      { description: "", stone_type: STONE_TYPE_PRESETS[0], unit: "sft", quantity: "", rate: "" },
    ]);
  }
  function removeRow(i: number) {
    setItems((prev) => (prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i)));
  }

  const itemTotals = items.map((it) => {
    const q = Number(it.quantity);
    const r = Number(it.rate);
    if (!Number.isFinite(q) || !Number.isFinite(r)) return 0;
    return Number((q * r).toFixed(2));
  });
  const subtotal = itemTotals.reduce((s, n) => s + n, 0);
  const gst = Number(gstAmount) || 0;
  const total = subtotal + gst;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!invoiceNo.trim()) return setError("Invoice number required.");
    if (!invoiceDate) return setError("Invoice date required.");

    const cleaned: InvoiceItem[] = [];
    for (const it of items) {
      if (!it.description.trim()) continue; // skip empties
      const q = Number(it.quantity);
      const r = Number(it.rate);
      if (!Number.isFinite(q) || q <= 0) return setError("Each item needs a positive quantity.");
      if (!Number.isFinite(r) || r < 0) return setError("Each item needs a rate ≥ 0.");
      cleaned.push({
        description: it.description.trim(),
        stone_type: it.stone_type.trim(),
        unit: it.unit,
        quantity: q,
        rate: r,
        line_total: Number((q * r).toFixed(2)),
      });
    }
    if (cleaned.length === 0) return setError("Add at least one item.");

    startTransition(async () => {
      const fd = new FormData();
      fd.set("party_id", partyId);
      fd.set("invoice_no", invoiceNo.trim());
      fd.set("invoice_date", invoiceDate);
      fd.set("gst_amount", String(gst));
      fd.set("notes", notes.trim());
      fd.set("items_json", JSON.stringify(cleaned));
      const r = await addAction(fd);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      onClose();
      router.refresh();
    });
  }

  return (
    <>
      <FinanceLoadingOverlay show={pending} label="Saving invoice…" />
      <form
        onSubmit={handleSubmit}
        style={{
          padding: 14,
          background: ACCOUNTS_TOKENS.surfaceMuted,
          border: `1px dashed ${ACCOUNTS_TOKENS.borderStrong}`,
          borderRadius: 10,
          marginBottom: 14,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "1fr 160px", gap: 10 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={fieldLabelStyle()}>Invoice number</span>
            <input
              type="text"
              value={invoiceNo}
              onChange={(e) => setInvoiceNo(e.target.value.slice(0, 60))}
              placeholder="e.g. PL-001"
              style={INPUT_STYLE}
              required
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={fieldLabelStyle()}>Invoice date</span>
            <input
              type="date"
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
              style={{ ...INPUT_STYLE, fontFamily: "ui-monospace, monospace" }}
              required
            />
          </label>
        </div>

        {/* Items table */}
        <div>
          <div style={{ ...fieldLabelStyle(), marginBottom: 6 }}>Items</div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1.6fr 1.1fr 70px 90px 110px 100px 28px",
              gap: 6,
              padding: "6px 10px",
              background: "#fff",
              border: `1px solid ${ACCOUNTS_TOKENS.border}`,
              borderRadius: 6,
              fontSize: 10,
              fontWeight: 700,
              color: "var(--muted)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              marginBottom: 4,
            }}
          >
            <div>Description</div>
            <div>Stone type</div>
            <div>Unit</div>
            <div style={{ textAlign: "right" }}>Qty</div>
            <div style={{ textAlign: "right" }}>Rate ₹</div>
            <div style={{ textAlign: "right" }}>Line ₹</div>
            <div></div>
          </div>
          {items.map((it, i) => (
            <div
              key={i}
              style={{
                display: "grid",
                gridTemplateColumns: "1.6fr 1.1fr 70px 90px 110px 100px 28px",
                gap: 6,
                padding: 4,
                alignItems: "center",
              }}
            >
              <input
                type="text"
                value={it.description}
                onChange={(e) => patchItem(i, { description: e.target.value.slice(0, 200) })}
                placeholder="Item description"
                style={INPUT_STYLE}
              />
              <select
                value={it.stone_type}
                onChange={(e) => patchItem(i, { stone_type: e.target.value })}
                style={INPUT_STYLE}
              >
                {STONE_TYPE_PRESETS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <select
                value={it.unit}
                onChange={(e) => patchItem(i, { unit: e.target.value as "sft" | "cft" })}
                style={INPUT_STYLE}
              >
                <option value="sft">SFT</option>
                <option value="cft">CFT</option>
              </select>
              <input
                type="number"
                step="0.01"
                min="0"
                value={it.quantity}
                onChange={(e) => patchItem(i, { quantity: e.target.value })}
                placeholder="0"
                style={{ ...INPUT_STYLE, fontFamily: "ui-monospace, monospace", textAlign: "right" }}
              />
              <input
                type="number"
                step="0.01"
                min="0"
                value={it.rate}
                onChange={(e) => patchItem(i, { rate: e.target.value })}
                placeholder="0"
                style={{ ...INPUT_STYLE, fontFamily: "ui-monospace, monospace", textAlign: "right" }}
              />
              <div style={{ textAlign: "right", fontFamily: "ui-monospace, monospace", fontWeight: 700, fontSize: 13, padding: "0 4px" }}>
                {itemTotals[i] > 0 ? inr(itemTotals[i]) : "—"}
              </div>
              <button
                type="button"
                onClick={() => removeRow(i)}
                disabled={items.length === 1}
                title="Remove row"
                style={{
                  padding: "4px 6px",
                  fontSize: 12,
                  background: "transparent",
                  color: items.length === 1 ? "var(--muted)" : ACCOUNTS_TOKENS.danger,
                  border: `1px solid ${items.length === 1 ? ACCOUNTS_TOKENS.border : ACCOUNTS_TOKENS.danger}`,
                  borderRadius: 4,
                  cursor: items.length === 1 ? "not-allowed" : "pointer",
                }}
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addRow}
            style={{
              marginTop: 6,
              padding: "6px 12px",
              fontSize: 12,
              fontWeight: 700,
              background: "transparent",
              color: ACCOUNTS_TOKENS.accent,
              border: `1px dashed ${ACCOUNTS_TOKENS.accent}`,
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            + Add item row
          </button>
        </div>

        {/* Totals + GST + notes */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 14, alignItems: "start" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={fieldLabelStyle()}>Notes (optional)</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value.slice(0, 1000))}
              rows={3}
              style={{ ...INPUT_STYLE, fontFamily: "inherit", resize: "vertical" }}
            />
          </label>
          <div
            style={{
              padding: 12,
              background: "#fff",
              border: `1px solid ${ACCOUNTS_TOKENS.border}`,
              borderRadius: 8,
              display: "flex",
              flexDirection: "column",
              gap: 6,
              fontSize: 12,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--muted)" }}>Subtotal</span>
              <strong style={{ fontFamily: "ui-monospace, monospace" }}>{inr(subtotal)}</strong>
            </div>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={fieldLabelStyle()}>GST (manual ₹ amount, not %)</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={gstAmount}
                onChange={(e) => setGstAmount(e.target.value)}
                style={{ ...INPUT_STYLE, fontFamily: "ui-monospace, monospace", textAlign: "right" }}
              />
            </label>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                paddingTop: 6,
                borderTop: `1px solid ${ACCOUNTS_TOKENS.border}`,
                fontSize: 14,
                fontWeight: 800,
                color: ACCOUNTS_TOKENS.accent,
              }}
            >
              <span>Total</span>
              <span style={{ fontFamily: "ui-monospace, monospace" }}>{inr(total)}</span>
            </div>
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
              borderRadius: 7,
              fontSize: 12,
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" onClick={onClose} style={BUTTON_STYLES.secondary} disabled={pending}>
            Cancel
          </button>
          <button type="submit" style={BUTTON_STYLES.primary} disabled={pending}>
            {pending ? "Saving…" : "✓ Save invoice"}
          </button>
        </div>
      </form>
    </>
  );
}

function InvoiceRowView({
  invoice,
  cancelAction,
}: {
  invoice: InvoiceRow;
  cancelAction: (formData: FormData) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  function runCancel() {
    if (!window.confirm(`Cancel invoice ${invoice.invoiceNo} (₹${invoice.total.toLocaleString("en-IN")})?\n\nThis is a soft-delete — the row stays in audit history.`)) return;
    const reason = window.prompt("Reason (optional)") ?? "";
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", invoice.id);
      fd.set("reason", reason.trim());
      const r = await cancelAction(fd);
      if (!r.ok) {
        alert(r.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <>
      <FinanceLoadingOverlay show={pending} label="Cancelling invoice…" />
      <div
        style={{
          background: "#fff",
          border: `1px solid ${ACCOUNTS_TOKENS.border}`,
          borderRadius: 8,
          padding: "10px 14px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <code
            style={{
              fontFamily: "ui-monospace, monospace",
              fontWeight: 700,
              fontSize: 12,
              padding: "2px 8px",
              background: ACCOUNTS_TOKENS.accentLight,
              color: ACCOUNTS_TOKENS.accent,
              borderRadius: 4,
            }}
          >
            {invoice.invoiceNo}
          </code>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            {invoice.invoiceDate}
          </span>
          <span style={{ marginLeft: "auto", fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 14 }}>
            {inr(invoice.total)}
          </span>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            style={{
              padding: "4px 8px",
              fontSize: 11,
              background: "transparent",
              color: "var(--muted)",
              border: `1px solid ${ACCOUNTS_TOKENS.border}`,
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            {open ? "Hide" : "Details"}
          </button>
          <button
            type="button"
            onClick={runCancel}
            disabled={pending}
            title="Soft-cancel"
            style={{
              padding: "4px 8px",
              fontSize: 11,
              background: "transparent",
              color: ACCOUNTS_TOKENS.danger,
              border: `1px solid ${ACCOUNTS_TOKENS.danger}`,
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        </div>
        {open && (
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px dashed ${ACCOUNTS_TOKENS.border}`, fontSize: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {invoice.items.map((it, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 60px 80px 100px 100px", gap: 6 }}>
                  <span>{it.description}</span>
                  <span style={{ color: "var(--muted)" }}>{it.stone_type}</span>
                  <span style={{ color: "var(--muted)", textTransform: "uppercase" }}>{it.unit}</span>
                  <span style={{ fontFamily: "ui-monospace, monospace", textAlign: "right" }}>{it.quantity}</span>
                  <span style={{ fontFamily: "ui-monospace, monospace", textAlign: "right", color: "var(--muted)" }}>{inr(it.rate)}</span>
                  <span style={{ fontFamily: "ui-monospace, monospace", textAlign: "right", fontWeight: 700 }}>{inr(it.line_total)}</span>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, paddingTop: 4, borderTop: `1px solid ${ACCOUNTS_TOKENS.border}`, fontSize: 11 }}>
                <span style={{ color: "var(--muted)" }}>Subtotal</span>
                <strong style={{ fontFamily: "ui-monospace, monospace" }}>{inr(invoice.subtotal)}</strong>
              </div>
              {invoice.gstAmount > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                  <span style={{ color: "var(--muted)" }}>GST</span>
                  <strong style={{ fontFamily: "ui-monospace, monospace" }}>{inr(invoice.gstAmount)}</strong>
                </div>
              )}
              {invoice.notes && (
                <div style={{ marginTop: 4, fontSize: 11, color: "var(--muted)" }}>
                  <strong>Note:</strong> {invoice.notes}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ════════════════════════════════════════════════════════════════
// Received card
// ════════════════════════════════════════════════════════════════

function ReceivedCard({
  partyId,
  buckets,
  receipts,
  addAction,
  cancelAction,
}: {
  partyId: string;
  buckets: BucketOption[];
  receipts: ReceiptRow[];
  addAction: (formData: FormData) => Promise<ActionResult>;
  cancelAction: (formData: FormData) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [bucketId, setBucketId] = useState(buckets[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [receiptDate, setReceiptDate] = useState(todayKeyIst());
  const [note, setNote] = useState("");

  function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const amt = Number(amount);
    if (!buckets.length) return setError("Add a bucket first — go to ⚙ Buckets.");
    if (!bucketId) return setError("Pick a bucket.");
    if (!Number.isFinite(amt) || amt <= 0) return setError("Amount must be > 0.");
    if (!receiptDate) return setError("Date required.");
    startTransition(async () => {
      const fd = new FormData();
      fd.set("party_id", partyId);
      fd.set("bucket_id", bucketId);
      fd.set("amount", String(amt));
      fd.set("receipt_date", receiptDate);
      fd.set("note", note.trim());
      const r = await addAction(fd);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setAmount("");
      setNote("");
      router.refresh();
    });
  }

  function runCancel(r: ReceiptRow) {
    if (!window.confirm(`Cancel receipt of ₹${r.amount.toLocaleString("en-IN")} (${r.bucketLabel}, ${r.receiptDate})?\n\nSoft-delete — stays in audit history.`)) return;
    const reason = window.prompt("Reason (optional)") ?? "";
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", r.id);
      fd.set("reason", reason.trim());
      const result = await cancelAction(fd);
      if (!result.ok) {
        alert(result.error);
        return;
      }
      router.refresh();
    });
  }

  const total = receipts.reduce((s, r) => s + r.amount, 0);

  return (
    <>
      <FinanceLoadingOverlay show={pending} label="Saving receipt…" />
      <div
        style={{
          background: "#fff",
          border: `1px solid ${ACCOUNTS_TOKENS.border}`,
          borderRadius: 12,
          padding: 16,
          boxShadow: ACCOUNTS_TOKENS.shadow,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "var(--text)" }}>
            💵 Received
          </h2>
          <span style={{ marginLeft: 10, fontSize: 12, color: "var(--muted)" }}>
            {receipts.length} entries · total{" "}
            <strong style={{ fontFamily: "ui-monospace, monospace", color: ACCOUNTS_TOKENS.success }}>
              {inr(total)}
            </strong>
          </span>
          <Link
            href="/personal-ledger/buckets"
            style={{ ...BUTTON_STYLES.ghost, marginLeft: "auto", textDecoration: "none", fontSize: 12 }}
          >
            ⚙ Buckets
          </Link>
        </div>

        {/* Inline add form */}
        <form
          onSubmit={handleAdd}
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(140px, 1fr) minmax(120px, 130px) minmax(140px, 150px) 1fr auto",
            gap: 8,
            padding: 10,
            background: ACCOUNTS_TOKENS.surfaceMuted,
            border: `1px dashed ${ACCOUNTS_TOKENS.borderStrong}`,
            borderRadius: 8,
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          <select
            value={bucketId}
            onChange={(e) => setBucketId(e.target.value)}
            style={INPUT_STYLE}
          >
            {buckets.length === 0 ? (
              <option value="">(add a bucket first)</option>
            ) : (
              buckets.map((b) => (
                <option key={b.id} value={b.id}>{b.label}</option>
              ))
            )}
          </select>
          <input
            type="number"
            step="0.01"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Amount ₹"
            style={{ ...INPUT_STYLE, fontFamily: "ui-monospace, monospace", textAlign: "right" }}
          />
          <input
            type="date"
            value={receiptDate}
            onChange={(e) => setReceiptDate(e.target.value)}
            style={{ ...INPUT_STYLE, fontFamily: "ui-monospace, monospace" }}
          />
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 500))}
            placeholder="Note (optional)"
            style={INPUT_STYLE}
          />
          <button
            type="submit"
            disabled={pending || !buckets.length || !amount}
            style={BUTTON_STYLES.primary}
          >
            + Add
          </button>
        </form>

        {error && (
          <div
            role="alert"
            style={{
              padding: "8px 12px",
              background: ACCOUNTS_TOKENS.dangerLight,
              border: `1px solid ${ACCOUNTS_TOKENS.danger}`,
              color: ACCOUNTS_TOKENS.danger,
              borderRadius: 7,
              fontSize: 12,
              marginBottom: 10,
            }}
          >
            {error}
          </div>
        )}

        {receipts.length === 0 ? (
          <div
            style={{
              padding: 24,
              background: ACCOUNTS_TOKENS.surfaceMuted,
              border: `1px dashed ${ACCOUNTS_TOKENS.borderStrong}`,
              borderRadius: 8,
              textAlign: "center",
              color: "var(--muted)",
              fontSize: 13,
            }}
          >
            No receipts yet. Use the form above to log incoming payments.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {receipts.map((r) => (
              <div
                key={r.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "100px 140px 120px 1fr auto",
                  gap: 8,
                  padding: "8px 12px",
                  background: "#fff",
                  border: `1px solid ${ACCOUNTS_TOKENS.border}`,
                  borderRadius: 7,
                  alignItems: "center",
                }}
              >
                {(() => {
                  const pal = bucketPalette(r.bucketLabel);
                  return (
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 800,
                        padding: "3px 10px",
                        background: pal.bg,
                        color: pal.fg,
                        borderRadius: 999,
                        textAlign: "center",
                        fontFamily: "ui-monospace, monospace",
                        letterSpacing: "0.02em",
                      }}
                    >
                      {r.bucketLabel}
                    </span>
                  );
                })()}
                <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 14, color: ACCOUNTS_TOKENS.success }}>
                  {inr(r.amount)}
                </span>
                <span style={{ fontSize: 12, color: "var(--muted)", fontFamily: "ui-monospace, monospace" }}>
                  {r.receiptDate}
                </span>
                <span style={{ fontSize: 12, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.note ?? "—"}
                </span>
                <button
                  type="button"
                  onClick={() => runCancel(r)}
                  disabled={pending}
                  title="Soft-cancel"
                  style={{
                    padding: "4px 8px",
                    fontSize: 11,
                    background: "transparent",
                    color: ACCOUNTS_TOKENS.danger,
                    border: `1px solid ${ACCOUNTS_TOKENS.danger}`,
                    borderRadius: 6,
                    cursor: "pointer",
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// ════════════════════════════════════════════════════════════════
// Summary card
// ════════════════════════════════════════════════════════════════

function SummaryCard({
  partyName,
  invoicedTotal,
  receivedTotal,
  outstanding,
  byBucket,
  invoiceCount,
  receiptCount,
  xlsxHref,
}: {
  partyName: string;
  invoicedTotal: number;
  receivedTotal: number;
  outstanding: number;
  byBucket: Array<{ label: string; total: number }>;
  invoiceCount: number;
  receiptCount: number;
  xlsxHref: string;
}) {
  const cleared = outstanding === 0 && invoicedTotal > 0;
  return (
    <div
      style={{
        background: "#fff",
        border: `1px solid ${ACCOUNTS_TOKENS.border}`,
        borderRadius: 12,
        padding: 18,
        boxShadow: ACCOUNTS_TOKENS.shadow,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "var(--text)" }}>
          📊 Summary · {partyName}
        </h2>
        <Link
          href={xlsxHref}
          style={{ ...BUTTON_STYLES.primary, marginLeft: "auto", textDecoration: "none" }}
        >
          ⬇ Download Excel
        </Link>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 14 }}>
        <SummaryStat label="Total invoiced" amount={invoicedTotal} sublabel={`${invoiceCount} invoice${invoiceCount === 1 ? "" : "s"}`} tone="accent" />
        <SummaryStat label="Total received" amount={receivedTotal} sublabel={`${receiptCount} entr${receiptCount === 1 ? "y" : "ies"}`} tone="success" />
        <SummaryStat
          label={cleared ? "Status" : "Outstanding"}
          amount={cleared ? 0 : outstanding}
          sublabel={cleared ? "✅ Cleared" : "still due"}
          tone={cleared ? "success" : outstanding > 0 ? "warning" : "muted"}
        />
      </div>

      {byBucket.length > 0 && (
        <div
          style={{
            padding: 14,
            background: ACCOUNTS_TOKENS.surfaceMuted,
            border: `1px solid ${ACCOUNTS_TOKENS.border}`,
            borderRadius: 8,
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
            Received · split by bucket
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {byBucket.map((b) => {
              const pal = bucketPalette(b.label);
              return (
                <div
                  key={b.label}
                  style={{
                    padding: "10px 14px",
                    background: "#fff",
                    border: `1px solid ${ACCOUNTS_TOKENS.border}`,
                    borderLeft: `4px solid ${pal.bar}`,
                    borderRadius: 7,
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                    minWidth: 140,
                  }}
                >
                  <span
                    style={{
                      alignSelf: "flex-start",
                      fontSize: 10,
                      fontWeight: 800,
                      padding: "2px 8px",
                      background: pal.bg,
                      color: pal.fg,
                      borderRadius: 999,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      fontFamily: "ui-monospace, monospace",
                    }}
                  >
                    {b.label}
                  </span>
                  <span style={{ fontSize: 16, fontWeight: 800, color: pal.fg, fontFamily: "ui-monospace, monospace" }}>
                    {inr(b.total)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <p style={{ margin: "12px 0 0", fontSize: 11, color: "var(--muted)", lineHeight: 1.5 }}>
        Outstanding = Total invoiced − Total received (across all buckets combined). Every entry is audit-logged. Cancelled entries are excluded from these numbers but kept in the audit trail.
      </p>
    </div>
  );
}

function SummaryStat({
  label,
  amount,
  sublabel,
  tone,
}: {
  label: string;
  amount: number;
  sublabel: string;
  tone: "accent" | "success" | "warning" | "muted";
}) {
  const accent =
    tone === "success" ? ACCOUNTS_TOKENS.success
    : tone === "warning" ? ACCOUNTS_TOKENS.warning
    : tone === "muted" ? ACCOUNTS_TOKENS.border
    : ACCOUNTS_TOKENS.accent;
  return (
    <div
      style={{
        padding: "14px 16px",
        background: "#fff",
        border: `1px solid ${ACCOUNTS_TOKENS.border}`,
        borderLeft: `4px solid ${accent}`,
        borderRadius: 8,
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </div>
      <div style={{ marginTop: 4 }}>
        <Money value={amount} size="hero" tone={tone === "muted" ? "muted" : tone} />
      </div>
      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
        {sublabel}
      </div>
    </div>
  );
}

function fieldLabelStyle(): React.CSSProperties {
  return {
    fontSize: 10,
    fontWeight: 700,
    color: "var(--muted)",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  };
}
