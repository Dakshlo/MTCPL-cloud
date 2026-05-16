"use client";

/**
 * Mig 058 — Convert-challan-to-invoice client form.
 *
 * Items pre-filled from the challan (description + qty + unit,
 * read-only). User adds:
 *   • rate per item
 *   • invoice date (defaults to today)
 *   • GST %
 *   • optional notes (defaults to challan notes)
 *
 * Live preview of subtotal + GST + total on the right.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FinanceLoadingOverlay } from "@/components/finance-loading-overlay";
import {
  ACCOUNTS_TOKENS,
  BUTTON_STYLES,
  INPUT_STYLE,
} from "../../../../accounts/_ui/components";

export type ChallanItemPrefill = {
  id: string;
  description: string;
  quantity: number;
  unit: string | null;
};

type ActionResult = { ok: true } | { ok: false; error: string };

const GST_PRESETS = [0, 5, 12, 18, 28] as const;

export function ConvertChallanForm({
  action,
  challanId,
  challanNumber,
  partyName,
  challanNotes,
  items,
}: {
  action: (formData: FormData) => Promise<ActionResult>;
  challanId: string;
  challanNumber: string;
  partyName: string;
  challanNotes: string;
  items: ChallanItemPrefill[];
}) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [pending, startTransition] = useTransition();

  const [invoiceDate, setInvoiceDate] = useState(today);
  const [gstPercent, setGstPercent] = useState("18");
  const [notes, setNotes] = useState(challanNotes);
  const [rates, setRates] = useState<string[]>(items.map(() => "0"));
  const [error, setError] = useState<string | null>(null);

  function updateRate(idx: number, value: string) {
    setRates((prev) => prev.map((r, i) => (i === idx ? value : r)));
  }

  const subtotal = useMemo(
    () =>
      items.reduce(
        (s, it, idx) => s + Number(it.quantity) * (Number(rates[idx]) || 0),
        0,
      ),
    [items, rates],
  );
  const gstNumeric = Number(gstPercent) || 0;
  const gstAmount = (subtotal * gstNumeric) / 100;
  const total = subtotal + gstAmount;

  const ratesJson = useMemo(
    () => JSON.stringify(rates.map((r) => ({ rate: Number(r) || 0 }))),
    [rates],
  );

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (items.length === 0) return setError("Challan has no items to convert.");
    if (rates.some((r) => Number(r) < 0 || !Number.isFinite(Number(r))))
      return setError("Every rate must be a number ≥ 0.");
    startTransition(async () => {
      const fd = new FormData();
      fd.set("challan_id", challanId);
      fd.set("invoice_date", invoiceDate);
      fd.set("gst_percent", String(gstNumeric));
      fd.set("notes", notes.trim());
      fd.set("rates_json", ratesJson);
      const r = await action(fd);
      if (!r.ok) return setError(r.error);
      router.push("/invoicing/invoices");
    });
  }

  return (
    <form
      onSubmit={submit}
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) 320px",
        gap: 18,
        alignItems: "start",
      }}
    >
      <FinanceLoadingOverlay show={pending} label="Creating invoice…" />

      {/* Left column */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Section title="Source challan">
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontSize: 13 }}>
            <div>
              <div style={labelStyle()}>Challan #</div>
              <div style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700 }}>
                {challanNumber}
              </div>
            </div>
            <div>
              <div style={labelStyle()}>Party</div>
              <div style={{ fontWeight: 600 }}>{partyName}</div>
            </div>
          </div>
        </Section>

        <Section title="Invoice header">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Invoice date *">
              <input
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
                required
                style={{ ...INPUT_STYLE, fontFamily: "ui-monospace, monospace" }}
              />
            </Field>
            <Field label="GST %">
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {GST_PRESETS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setGstPercent(String(p))}
                    style={{
                      padding: "6px 12px",
                      fontSize: 12,
                      fontWeight: 700,
                      background:
                        String(p) === gstPercent ? ACCOUNTS_TOKENS.accent : "transparent",
                      color: String(p) === gstPercent ? "#fff" : "var(--text)",
                      border: `1px solid ${ACCOUNTS_TOKENS.borderStrong}`,
                      borderRadius: 6,
                      cursor: "pointer",
                    }}
                  >
                    {p}%
                  </button>
                ))}
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={gstPercent}
                  onChange={(e) => setGstPercent(e.target.value)}
                  style={{ ...INPUT_STYLE, width: 80, textAlign: "right" }}
                />
              </div>
            </Field>
          </div>
          <Field label="Notes">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              style={{ ...INPUT_STYLE, marginTop: 10, resize: "vertical", fontFamily: "inherit" }}
            />
          </Field>
        </Section>

        <Section title="Items + rates">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 90px 70px 110px 110px",
              gap: 8,
              alignItems: "center",
              marginBottom: 6,
              fontSize: 11,
              fontWeight: 700,
              color: "var(--muted)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            <span>Description</span>
            <span style={{ textAlign: "right" }}>Qty</span>
            <span style={{ textAlign: "center" }}>Unit</span>
            <span style={{ textAlign: "right" }}>Rate (₹) *</span>
            <span style={{ textAlign: "right" }}>Line total</span>
          </div>
          {items.map((it, idx) => {
            const lineTotal = Number(it.quantity) * (Number(rates[idx]) || 0);
            return (
              <div
                key={it.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 90px 70px 110px 110px",
                  gap: 8,
                  alignItems: "center",
                  marginBottom: 6,
                  padding: "6px 0",
                  borderBottom: `1px solid ${ACCOUNTS_TOKENS.border}`,
                }}
              >
                <span style={{ fontSize: 13, color: "var(--text)" }}>{it.description}</span>
                <span
                  style={{
                    textAlign: "right",
                    fontFamily: "ui-monospace, monospace",
                    fontSize: 13,
                  }}
                >
                  {Number(it.quantity).toLocaleString("en-IN", { maximumFractionDigits: 3 })}
                </span>
                <span style={{ textAlign: "center", fontSize: 12, fontWeight: 600 }}>
                  {it.unit ? it.unit.toUpperCase() : "—"}
                </span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={rates[idx]}
                  onChange={(e) => updateRate(idx, e.target.value)}
                  required
                  style={{ ...INPUT_STYLE, textAlign: "right", fontFamily: "ui-monospace, monospace" }}
                />
                <span
                  style={{
                    textAlign: "right",
                    fontFamily: "ui-monospace, monospace",
                    fontWeight: 600,
                    color: "var(--text)",
                    padding: "6px 4px",
                    background: ACCOUNTS_TOKENS.surfaceMuted,
                    borderRadius: 6,
                    fontSize: 13,
                  }}
                >
                  ₹
                  {lineTotal.toLocaleString("en-IN", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              </div>
            );
          })}
        </Section>

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

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            type="submit"
            disabled={pending || items.length === 0}
            style={{ ...BUTTON_STYLES.primary, padding: "11px 22px", fontSize: 14 }}
          >
            🧾 Create invoice
          </button>
        </div>
      </div>

      {/* Right column — preview */}
      <div style={{ position: "sticky", top: 16 }}>
        <div
          style={{
            padding: 14,
            background: "var(--surface, #fff)",
            border: `1px solid ${ACCOUNTS_TOKENS.border}`,
            borderRadius: 12,
            boxShadow: ACCOUNTS_TOKENS.shadow,
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 800,
              color: ACCOUNTS_TOKENS.success,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: 8,
            }}
          >
            Invoice preview
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>
            {partyName}
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 12 }}>
            Date · {invoiceDate} · From {challanNumber}
          </div>
          <PreviewRow label="Subtotal" value={subtotal} />
          <PreviewRow label={`GST @ ${gstNumeric}%`} value={gstAmount} />
          <div style={{ borderTop: `1.5px solid ${ACCOUNTS_TOKENS.borderStrong}`, margin: "6px 0" }} />
          <PreviewRow label="Total" value={total} bold />
        </div>
        <p style={{ marginTop: 10, fontSize: 11, color: "var(--muted)", lineHeight: 1.5 }}>
          The invoice gets a fresh number (INV-YYYY-N). The challan stays in the system, marked
          “Converted to {`<this invoice>`}”.
        </p>
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--surface, #fff)",
        border: `1px solid ${ACCOUNTS_TOKENS.border}`,
        borderRadius: 10,
        padding: "14px 16px",
        boxShadow: ACCOUNTS_TOKENS.shadow,
      }}
    >
      <h3
        style={{
          margin: "0 0 12px",
          fontSize: 12,
          fontWeight: 800,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "var(--muted)",
        }}
      >
        {title}
      </h3>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <span style={labelStyle()}>{label}</span>
      {children}
    </label>
  );
}

function labelStyle(): React.CSSProperties {
  return {
    display: "block",
    fontSize: 11,
    fontWeight: 700,
    color: "var(--muted)",
    textTransform: "uppercase",
    letterSpacing: "0.07em",
    marginBottom: 5,
  };
}

function PreviewRow({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        padding: "3px 0",
        fontWeight: bold ? 800 : 500,
        fontSize: bold ? 15 : 13,
        color: bold ? "var(--text)" : "var(--muted)",
        fontFamily: "ui-monospace, monospace",
      }}
    >
      <span>{label}</span>
      <span>
        ₹
        {value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
    </div>
  );
}
