"use client";

// Invoice creation form (Migration 038 — extended in Mig 058 with
// a party picker fed by the new invoice_parties table).
//
// Single form for customer block + dynamic line items + GST/notes.
// The items array is JSON-encoded into a hidden field and parsed by
// the server action — same pattern used by the bill-entry form for
// consistency.

import { useEffect, useMemo, useState } from "react";

export type PartyOption = {
  id: string;
  name: string;
  gstin: string | null;
  address: string | null;
  phone: string | null;
};

type Item = {
  description: string;
  quantity: string; // string while typing
  rate: string;
};

const GST_PRESETS = [0, 5, 12, 18, 28] as const;

const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  fontSize: 13,
  border: "1px solid var(--border)",
  borderRadius: 6,
  background: "var(--surface)",
  color: "var(--text)",
};

// Bolder + darker label style (matches the bill-entry form polish so
// the two flows feel consistent). Required-field asterisk is rendered
// inline via the `*` in the label string + a small "Required" pill.
const LABEL_STYLE: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 700,
  color: "var(--text)",
  letterSpacing: "-0.005em",
  marginBottom: 4,
};

// Visual chip for required-field markers. Embedded next to the label
// text via <RequiredPill /> below.
const REQUIRED_PILL_STYLE: React.CSSProperties = {
  color: "#b91c1c",
  fontWeight: 800,
  fontSize: 10,
  padding: "1px 6px",
  borderRadius: 4,
  background: "rgba(220, 38, 38, 0.08)",
  border: "1px solid rgba(220, 38, 38, 0.30)",
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  marginLeft: 6,
};

function RequiredPill() {
  return <span style={REQUIRED_PILL_STYLE}>* Required</span>;
}

export function InvoiceForm({
  action,
  parties = [],
  initialPartyId = null,
  initialChallanId = null,
}: {
  action: (formData: FormData) => Promise<void> | void;
  parties?: PartyOption[];
  initialPartyId?: string | null;
  initialChallanId?: string | null;
}) {
  const today = new Date().toISOString().slice(0, 10);

  // Mig 058 — when a party is picked from the dropdown, auto-fill
  // the customer block from the party row. User can still edit any
  // field after auto-fill (the customer_* columns on the invoice
  // are the source of truth for what gets printed).
  const [partyId, setPartyId] = useState<string>(initialPartyId ?? "");
  const initialParty = initialPartyId
    ? parties.find((p) => p.id === initialPartyId) ?? null
    : null;

  const [customerName, setCustomerName] = useState(initialParty?.name ?? "");
  const [customerAddress, setCustomerAddress] = useState(initialParty?.address ?? "");
  const [customerGstin, setCustomerGstin] = useState(initialParty?.gstin ?? "");
  const [customerPhone, setCustomerPhone] = useState(initialParty?.phone ?? "");
  const [invoiceDate, setInvoiceDate] = useState(today);
  const [items, setItems] = useState<Item[]>([
    { description: "", quantity: "1", rate: "0" },
  ]);
  const [gstPercent, setGstPercent] = useState<string>("18");
  const [notes, setNotes] = useState("");

  // Whenever the party picker changes, refill the customer block.
  // We intentionally clobber existing customer_* fields — picking a
  // party is a deliberate "use this party's details" action.
  useEffect(() => {
    if (!partyId) return;
    const p = parties.find((x) => x.id === partyId);
    if (!p) return;
    setCustomerName(p.name);
    setCustomerAddress(p.address ?? "");
    setCustomerGstin(p.gstin ?? "");
    setCustomerPhone(p.phone ?? "");
  }, [partyId, parties]);

  function updateItem(idx: number, patch: Partial<Item>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  function addItem() {
    setItems((prev) => [...prev, { description: "", quantity: "1", rate: "0" }]);
  }

  function removeItem(idx: number) {
    setItems((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== idx)));
  }

  const computedSubtotal = useMemo(() => {
    return items.reduce((sum, it) => {
      const q = Number(it.quantity) || 0;
      const r = Number(it.rate) || 0;
      return sum + q * r;
    }, 0);
  }, [items]);

  const computedGst = (computedSubtotal * (Number(gstPercent) || 0)) / 100;
  const computedTotal = computedSubtotal + computedGst;

  // Build the payload the server action expects.
  const itemsJson = JSON.stringify(
    items.map((it) => ({
      description: it.description.trim(),
      quantity: Number(it.quantity) || 0,
      rate: Number(it.rate) || 0,
    })),
  );

  return (
    <form action={action} style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Customer block */}
      <Section title="Customer">
        {/* Mig 058 — party picker. Pick a saved party to auto-fill
            the rest of the customer block. Optional — leave blank
            to type customer details inline (legacy behaviour). */}
        {parties.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <label>
              <span style={LABEL_STYLE}>Party (saved customer)</span>
              <select
                value={partyId}
                onChange={(e) => setPartyId(e.target.value)}
                style={INPUT_STYLE}
              >
                <option value="">— Pick a saved party to auto-fill (optional) —</option>
                {parties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.gstin ? ` · ${p.gstin}` : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
          <label>
            <span style={LABEL_STYLE}>
              Customer name <RequiredPill />
            </span>
            <input
              name="customer_name"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              required

              style={INPUT_STYLE}
            />
          </label>
          <label>
            <span style={LABEL_STYLE}>
              Invoice date <RequiredPill />
            </span>
            <input
              type="date"
              name="invoice_date"
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
              required
              style={INPUT_STYLE}
            />
          </label>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginTop: 10 }}>
          <label style={{ gridColumn: "1 / -1" }}>
            <span style={LABEL_STYLE}>Address</span>
            <textarea
              name="customer_address"
              value={customerAddress}
              onChange={(e) => setCustomerAddress(e.target.value)}
              rows={2}
              placeholder="Street, city, state, pin"
              style={{ ...INPUT_STYLE, resize: "vertical", fontFamily: "inherit" }}
            />
          </label>
          <label>
            <span style={LABEL_STYLE}>GSTIN</span>
            <input
              name="customer_gstin"
              value={customerGstin}
              onChange={(e) => setCustomerGstin(e.target.value.toUpperCase())}
              placeholder="22AAAAA0000A1Z5"
              style={{ ...INPUT_STYLE, fontFamily: "ui-monospace, monospace" }}
            />
          </label>
          <label>
            <span style={LABEL_STYLE}>Phone</span>
            <input
              name="customer_phone"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              placeholder="+91…"
              style={INPUT_STYLE}
            />
          </label>
        </div>
      </Section>

      {/* Line items */}
      <Section title="Line items">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 80px 110px 110px 36px",
            gap: 8,
            alignItems: "center",
            marginBottom: 6,
          }}
        >
          <span style={LABEL_STYLE}>Description</span>
          <span style={{ ...LABEL_STYLE, textAlign: "right" }}>Qty</span>
          <span style={{ ...LABEL_STYLE, textAlign: "right" }}>Rate (₹)</span>
          <span style={{ ...LABEL_STYLE, textAlign: "right" }}>Amount (₹)</span>
          <span />
        </div>
        {items.map((it, idx) => {
          const q = Number(it.quantity) || 0;
          const r = Number(it.rate) || 0;
          const amt = q * r;
          return (
            <div
              key={idx}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 80px 110px 110px 36px",
                gap: 8,
                alignItems: "center",
                marginBottom: 6,
              }}
            >
              <input

                value={it.description}
                onChange={(e) => updateItem(idx, { description: e.target.value })}
                style={INPUT_STYLE}
              />
              <input
                type="number"
                step="0.001"
                min="0"
                value={it.quantity}
                onChange={(e) => updateItem(idx, { quantity: e.target.value })}
                style={{ ...INPUT_STYLE, textAlign: "right", fontFamily: "ui-monospace, monospace" }}
              />
              <input
                type="number"
                step="0.01"
                min="0"
                value={it.rate}
                onChange={(e) => updateItem(idx, { rate: e.target.value })}
                style={{ ...INPUT_STYLE, textAlign: "right", fontFamily: "ui-monospace, monospace" }}
              />
              <div
                style={{
                  textAlign: "right",
                  fontFamily: "ui-monospace, monospace",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--text)",
                  padding: "8px 10px",
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                }}
              >
                {amt.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <button
                type="button"
                onClick={() => removeItem(idx)}
                disabled={items.length === 1}
                title="Remove line"
                style={{
                  width: 32,
                  height: 32,
                  background: "transparent",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  color: items.length === 1 ? "var(--muted)" : "#b91c1c",
                  cursor: items.length === 1 ? "not-allowed" : "pointer",
                  fontWeight: 700,
                }}
              >
                ✕
              </button>
            </div>
          );
        })}
        <button
          type="button"
          onClick={addItem}
          style={{
            marginTop: 4,
            padding: "8px 14px",
            fontSize: 12,
            fontWeight: 700,
            background: "transparent",
            color: "var(--gold-dark)",
            border: "1px dashed var(--gold-dark)",
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          + Add line item
        </button>
      </Section>

      {/* Totals + GST */}
      <Section title="Totals">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 16, alignItems: "start" }}>
          <div>
            <span style={LABEL_STYLE}>GST %</span>
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
                    background: String(p) === gstPercent ? "var(--gold)" : "transparent",
                    color: String(p) === gstPercent ? "#fff" : "var(--text)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    cursor: "pointer",
                  }}
                >
                  {p}%
                </button>
              ))}
              <input
                name="gst_percent"
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={gstPercent}
                onChange={(e) => setGstPercent(e.target.value)}
                style={{ ...INPUT_STYLE, width: 80, textAlign: "right" }}
              />
            </div>
            <label style={{ display: "block", marginTop: 14 }}>
              <span style={LABEL_STYLE}>Notes (optional)</span>
              <textarea
                name="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Payment terms, delivery details, etc."
                style={{ ...INPUT_STYLE, resize: "vertical", fontFamily: "inherit" }}
              />
            </label>
          </div>

          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              padding: 14,
              fontSize: 13,
              fontFamily: "ui-monospace, monospace",
            }}
          >
            <Row label="Subtotal" value={computedSubtotal} />
            <Row label={`GST @ ${gstPercent || 0}%`} value={computedGst} />
            <div style={{ borderTop: "1px solid var(--border)", margin: "8px 0" }} />
            <Row label="Total" value={computedTotal} bold />
          </div>
        </div>
      </Section>

      <input type="hidden" name="items_json" value={itemsJson} />
      <input type="hidden" name="invoice_party_id" value={partyId} />
      <input type="hidden" name="source_challan_id" value={initialChallanId ?? ""} />

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button
          type="submit"
          style={{
            padding: "11px 22px",
            fontSize: 14,
            fontWeight: 700,
            background: "var(--gold)",
            color: "#fff",
            border: "1px solid var(--gold-dark)",
            borderRadius: 8,
            cursor: "pointer",
          }}
        >
          🧾 Generate invoice
        </button>
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: "14px 16px",
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

function Row({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "4px 0",
        fontWeight: bold ? 800 : 500,
        color: bold ? "var(--text)" : "var(--muted)",
        fontSize: bold ? 15 : 13,
      }}
    >
      <span>{label}</span>
      <span>
        ₹{" "}
        {value.toLocaleString("en-IN", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}
      </span>
    </div>
  );
}
