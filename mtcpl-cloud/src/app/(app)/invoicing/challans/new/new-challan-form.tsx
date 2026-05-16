"use client";

/**
 * Mig 058 — Create-a-challan client form.
 *
 * Two-section layout (mirrors accounts/bills/new pattern):
 *   • Header section: party picker + date + notes
 *   • Items section: dynamic table (description / qty / unit)
 *
 * NO money fields — challans are delivery notes. Money enters the
 * picture only when converting to an invoice.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FinanceLoadingOverlay } from "@/components/finance-loading-overlay";
import {
  ACCOUNTS_TOKENS,
  BUTTON_STYLES,
  INPUT_STYLE,
} from "../../../accounts/_ui/components";

export type PartyOption = { id: string; name: string };
type ActionResult = { ok: true } | { ok: false; error: string };

type Item = {
  description: string;
  quantity: string;
  unit: "" | "sft" | "cft" | "pcs";
};

const UNIT_OPTIONS: Array<{ value: Item["unit"]; label: string }> = [
  { value: "", label: "—" },
  { value: "sft", label: "SFT" },
  { value: "cft", label: "CFT" },
  { value: "pcs", label: "PCS" },
];

export function NewChallanForm({
  action,
  parties,
  initialPartyId,
}: {
  action: (formData: FormData) => Promise<ActionResult>;
  parties: PartyOption[];
  initialPartyId: string | null;
}) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [pending, startTransition] = useTransition();

  const [partyId, setPartyId] = useState(initialPartyId ?? "");
  const [challanDate, setChallanDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<Item[]>([
    { description: "", quantity: "1", unit: "" },
  ]);
  const [error, setError] = useState<string | null>(null);

  function updateItem(idx: number, patch: Partial<Item>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }
  function addItem() {
    setItems((prev) => [...prev, { description: "", quantity: "1", unit: "" }]);
  }
  function removeItem(idx: number) {
    setItems((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== idx)));
  }

  const itemsJson = useMemo(
    () =>
      JSON.stringify(
        items.map((it) => ({
          description: it.description.trim(),
          quantity: Number(it.quantity) || 0,
          unit: it.unit || null,
        })),
      ),
    [items],
  );

  const previewItems = useMemo(() => items.filter((it) => it.description.trim()), [items]);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!partyId) return setError("Pick a party first.");
    const cleaned = items.filter((it) => it.description.trim() && Number(it.quantity) > 0);
    if (cleaned.length === 0) return setError("Add at least one line item with a quantity > 0.");
    startTransition(async () => {
      const fd = new FormData();
      fd.set("invoice_party_id", partyId);
      fd.set("challan_date", challanDate);
      fd.set("notes", notes.trim());
      fd.set("items_json", itemsJson);
      const r = await action(fd);
      if (!r.ok) return setError(r.error);
      // Land on the challans list — the new one is at the top.
      router.push("/invoicing/challans");
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
      <FinanceLoadingOverlay show={pending} label="Saving challan…" />

      {/* Left column — form sections */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Section title="Header">
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
            <Field label="Party *">
              <select
                value={partyId}
                onChange={(e) => setPartyId(e.target.value)}
                style={INPUT_STYLE}
                required
              >
                <option value="">— Pick a party —</option>
                {parties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Challan date *">
              <input
                type="date"
                value={challanDate}
                onChange={(e) => setChallanDate(e.target.value)}
                required
                style={{ ...INPUT_STYLE, fontFamily: "ui-monospace, monospace" }}
              />
            </Field>
          </div>
          <Field label="Notes">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Vehicle no., transporter, etc."
              style={{ ...INPUT_STYLE, marginTop: 10, resize: "vertical", fontFamily: "inherit" }}
            />
          </Field>
        </Section>

        <Section title="Items (no money — qty only)">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 90px 90px 36px",
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
            <span />
          </div>
          {items.map((it, idx) => (
            <div
              key={idx}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 90px 90px 36px",
                gap: 8,
                alignItems: "center",
                marginBottom: 6,
              }}
            >
              <input
                value={it.description}
                onChange={(e) => updateItem(idx, { description: e.target.value })}
                placeholder="e.g. White marble slab 6x4"
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
              <select
                value={it.unit}
                onChange={(e) => updateItem(idx, { unit: e.target.value as Item["unit"] })}
                style={{ ...INPUT_STYLE, textAlign: "center" }}
              >
                {UNIT_OPTIONS.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => removeItem(idx)}
                disabled={items.length === 1}
                title="Remove line"
                style={{
                  width: 32,
                  height: 32,
                  background: "transparent",
                  border: `1px solid ${ACCOUNTS_TOKENS.border}`,
                  borderRadius: 6,
                  color: items.length === 1 ? "var(--muted)" : ACCOUNTS_TOKENS.danger,
                  cursor: items.length === 1 ? "not-allowed" : "pointer",
                  fontWeight: 700,
                }}
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addItem}
            style={{ ...BUTTON_STYLES.ghost, marginTop: 4 }}
          >
            + Add line item
          </button>
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
            disabled={pending || !partyId}
            style={{ ...BUTTON_STYLES.primary, padding: "11px 22px", fontSize: 14 }}
          >
            📋 Create challan
          </button>
        </div>
      </div>

      {/* Right column — sticky preview card */}
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
              color: ACCOUNTS_TOKENS.accent,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: 6,
            }}
          >
            Preview
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>
            {partyId
              ? parties.find((p) => p.id === partyId)?.name ?? "Party"
              : "Pick a party"}
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 10 }}>
            Date · {challanDate}
          </div>
          {previewItems.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--muted)", fontStyle: "italic" }}>
              No items yet.
            </div>
          ) : (
            <ul style={{ margin: 0, padding: "0 0 0 18px", fontSize: 12, color: "var(--text)" }}>
              {previewItems.map((it, idx) => (
                <li key={idx} style={{ marginBottom: 4 }}>
                  {it.description}{" "}
                  <strong style={{ fontFamily: "ui-monospace, monospace" }}>
                    × {Number(it.quantity) || 0}
                    {it.unit ? ` ${it.unit.toUpperCase()}` : ""}
                  </strong>
                </li>
              ))}
            </ul>
          )}
        </div>
        <p style={{ marginTop: 10, fontSize: 11, color: "var(--muted)", lineHeight: 1.5 }}>
          Challan number is auto-assigned as <strong>CH-YYYY-N</strong> when you save. Convert to an invoice from the challan detail page when ready.
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
      <span
        style={{
          display: "block",
          fontSize: 11,
          fontWeight: 700,
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.07em",
          marginBottom: 5,
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}
