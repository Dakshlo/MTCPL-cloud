"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ACCOUNTS_TOKENS,
  BUTTON_STYLES,
  INPUT_STYLE,
  SidePanel,
} from "../_ui/components";

type UpsertResult =
  | { ok: true; vendorId: string }
  | { ok: false; error: string };

/**
 * Bill-vendor add / edit form. Uses the SidePanel slide-over for
 * "create" mode (kept compact and finance-app-feeling). For "edit"
 * mode on the vendor detail page, the form renders inline.
 */
export function VendorForm({
  action,
  mode,
  initialValues,
  vendorId,
  trigger,
  nameLocked = false,
}: {
  action: (formData: FormData) => Promise<UpsertResult>;
  mode: "create" | "edit";
  initialValues?: {
    name?: string;
    category?: string | null;
    gstin?: string | null;
    pan?: string | null;
    address?: string | null;
    phone?: string | null;
    email?: string | null;
    bank_name?: string | null;
    bank_account?: string | null;
    ifsc?: string | null;
    upi_id?: string | null;
    notes?: string | null;
    /** Mig 040 — days after bill_date this vendor is paid. null =
     *  use the app-level default (45). 0 = pay on receipt. */
    payment_terms_days?: number | null;
    /** Mig 042 — when on, the bill-entry form surfaces a TDS% input
     *  when this vendor is picked. We deduct TDS from the
     *  amount-payable-to-vendor at payment time. */
    tds_applicable?: boolean | null;
    default_tds_percent?: number | null;
    /** Mig 042 — when on, the bill-entry form surfaces a TCS% input
     *  for this vendor. TCS is added on top of GST and we pay it
     *  to the vendor (they remit to govt). */
    tcs_applicable?: boolean | null;
    default_tcs_percent?: number | null;
  };
  vendorId?: string;
  trigger?: React.ReactNode;
  /** When true, the Name field renders as read-only with a lock
   *  indicator + hint. Only owner / developer can rename a vendor
   *  (canRenameBillVendor). The server also enforces this — even
   *  if the form's submitted name differs, the action drops it. */
  nameLocked?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const initial = {
    name: initialValues?.name ?? "",
    category: initialValues?.category ?? "",
    gstin: initialValues?.gstin ?? "",
    pan: initialValues?.pan ?? "",
    address: initialValues?.address ?? "",
    phone: initialValues?.phone ?? "",
    email: initialValues?.email ?? "",
    bank_name: initialValues?.bank_name ?? "",
    bank_account: initialValues?.bank_account ?? "",
    ifsc: initialValues?.ifsc ?? "",
    upi_id: initialValues?.upi_id ?? "",
    notes: initialValues?.notes ?? "",
    // Payment terms — stored separately so we can roundtrip it as
    // either a preset preset (0/10/20/30/45/60/90) or a custom int.
    // Empty string = no value, falls back to app default.
    payment_terms_days:
      initialValues?.payment_terms_days != null
        ? String(initialValues.payment_terms_days)
        : "",
    tds_applicable: initialValues?.tds_applicable === true,
    default_tds_percent:
      initialValues?.default_tds_percent != null
        ? String(initialValues.default_tds_percent)
        : "",
    tcs_applicable: initialValues?.tcs_applicable === true,
    default_tcs_percent:
      initialValues?.default_tcs_percent != null
        ? String(initialValues.default_tcs_percent)
        : "",
  };

  const [form, setForm] = useState(initial);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!form.name.trim()) return setError("Vendor name is required.");
    const fd = new FormData();
    if (vendorId) fd.set("id", vendorId);
    for (const [k, v] of Object.entries(form)) {
      // Booleans need to serialise to "1" / "" so the server can read
      // them off FormData (which only carries strings).
      if (typeof v === "boolean") {
        fd.set(k, v ? "1" : "");
      } else {
        fd.set(k, v ?? "");
      }
    }
    startTransition(async () => {
      const r = await action(fd);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.refresh();
      if (mode === "create") {
        setOpen(false);
        setForm(initial);
      }
    });
  }

  // Form body — used both inline (edit) and inside slide-over (create).
  const formBody = (
    <form
      onSubmit={handleSubmit}
      style={{ display: "flex", flexDirection: "column", gap: 14 }}
    >
      <Field label={nameLocked ? "Vendor name 🔒" : "Vendor name"} required={!nameLocked}>
        <input
          value={form.name}
          onChange={(e) => {
            if (nameLocked) return;
            setForm({ ...form, name: e.target.value });
          }}
          required={!nameLocked}
          readOnly={nameLocked}
          disabled={nameLocked}
          style={{
            ...INPUT_STYLE,
            background: nameLocked ? ACCOUNTS_TOKENS.surfaceMuted : "#fff",
            color: nameLocked ? "var(--muted)" : "var(--text)",
            cursor: nameLocked ? "not-allowed" : "text",
          }}
          autoFocus={mode === "create"}
          title={nameLocked ? "Only owner or developer can rename a vendor" : undefined}
        />
        {nameLocked && (
          <span
            style={{
              fontSize: 11,
              color: "var(--muted)",
              marginTop: 4,
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            🔒 Name is locked. Only the owner or developer can rename a vendor.
            Edit phone, GSTIN, bank, address, etc. freely below.
          </span>
        )}
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Category">
          <input
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            placeholder="cement / steel / tools / etc"
            style={INPUT_STYLE}
          />
        </Field>
        <Field label="GSTIN">
          <input
            value={form.gstin}
            onChange={(e) => setForm({ ...form, gstin: e.target.value })}
            style={{ ...INPUT_STYLE, fontFamily: "ui-monospace, monospace" }}
          />
        </Field>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="PAN">
          <input
            value={form.pan}
            onChange={(e) => setForm({ ...form, pan: e.target.value })}
            style={{ ...INPUT_STYLE, fontFamily: "ui-monospace, monospace" }}
          />
        </Field>
        <Field label="Phone">
          <input
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            style={INPUT_STYLE}
          />
        </Field>
      </div>
      <Field label="Email">
        <input
          type="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          style={INPUT_STYLE}
        />
      </Field>
      <Field label="Address">
        <textarea
          value={form.address}
          onChange={(e) => setForm({ ...form, address: e.target.value })}
          rows={2}
          style={{ ...INPUT_STYLE, fontFamily: "inherit", resize: "vertical" }}
        />
      </Field>

      <Field
        label="Payment terms (days after bill date)"
        hint="When does this vendor expect to be paid? Drives the premature-payment warning in Due Bills + Pay Today."
      >
        <PaymentTermsPicker
          value={form.payment_terms_days}
          onChange={(v) => setForm({ ...form, payment_terms_days: v })}
        />
      </Field>

      {/* Mig 042 — TDS / TCS applicability. Two independent toggles.
          When a flag is on, the bill-entry form for this vendor will
          surface the matching tax input (pre-filled with the default
          rate). The accountant can still override per bill. */}
      <Field
        label="Tax deductions / collections"
        hint="If this vendor needs TDS deducted from your payment, or charges TCS on top of GST, flag it here. The bill form will then prompt for the rate."
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            background: ACCOUNTS_TOKENS.surfaceMuted,
            border: `1px solid ${ACCOUNTS_TOKENS.border}`,
            borderRadius: 8,
            padding: "10px 12px",
          }}
        >
          {/* TDS row */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "auto 1fr auto",
              gap: 10,
              alignItems: "center",
            }}
          >
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 700,
                color: "var(--text)",
              }}
            >
              <input
                type="checkbox"
                checked={form.tds_applicable}
                onChange={(e) =>
                  setForm({ ...form, tds_applicable: e.target.checked })
                }
              />
              TDS applicable
            </label>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>
              We deduct from payment → remit to govt
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <input
                type="number"
                step="0.01"
                min={0}
                max={100}
                value={form.default_tds_percent}
                onChange={(e) =>
                  setForm({ ...form, default_tds_percent: e.target.value })
                }
                disabled={!form.tds_applicable}
                placeholder="0"
                style={{
                  ...INPUT_STYLE,
                  width: 70,
                  fontFamily: "ui-monospace, monospace",
                  textAlign: "right",
                  opacity: form.tds_applicable ? 1 : 0.4,
                }}
                aria-label="Default TDS percent"
              />
              <span style={{ fontSize: 11, color: "var(--muted)" }}>%</span>
            </div>
          </div>
          {/* TCS row */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "auto 1fr auto",
              gap: 10,
              alignItems: "center",
            }}
          >
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 700,
                color: "var(--text)",
              }}
            >
              <input
                type="checkbox"
                checked={form.tcs_applicable}
                onChange={(e) =>
                  setForm({ ...form, tcs_applicable: e.target.checked })
                }
              />
              TCS applicable
            </label>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>
              Vendor adds on top → we pay vendor inclusive
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <input
                type="number"
                step="0.01"
                min={0}
                max={100}
                value={form.default_tcs_percent}
                onChange={(e) =>
                  setForm({ ...form, default_tcs_percent: e.target.value })
                }
                disabled={!form.tcs_applicable}
                placeholder="0"
                style={{
                  ...INPUT_STYLE,
                  width: 70,
                  fontFamily: "ui-monospace, monospace",
                  textAlign: "right",
                  opacity: form.tcs_applicable ? 1 : 0.4,
                }}
                aria-label="Default TCS percent"
              />
              <span style={{ fontSize: 11, color: "var(--muted)" }}>%</span>
            </div>
          </div>
        </div>
      </Field>

      <details style={{ marginTop: 4 }}>
        <summary
          style={{
            cursor: "pointer",
            fontSize: 11,
            fontWeight: 700,
            color: ACCOUNTS_TOKENS.accent,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            padding: "6px 0",
          }}
        >
          + Bank details (optional)
        </summary>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
          <Field label="Bank name">
            <input
              value={form.bank_name}
              onChange={(e) => setForm({ ...form, bank_name: e.target.value })}
              style={INPUT_STYLE}
            />
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
            <Field label="Account number">
              <input
                value={form.bank_account}
                onChange={(e) => setForm({ ...form, bank_account: e.target.value })}
                style={{ ...INPUT_STYLE, fontFamily: "ui-monospace, monospace" }}
              />
            </Field>
            <Field label="IFSC">
              <input
                value={form.ifsc}
                onChange={(e) => setForm({ ...form, ifsc: e.target.value })}
                style={{ ...INPUT_STYLE, fontFamily: "ui-monospace, monospace" }}
              />
            </Field>
          </div>
          <Field label="UPI ID">
            <input
              value={form.upi_id}
              onChange={(e) => setForm({ ...form, upi_id: e.target.value })}
              style={{ ...INPUT_STYLE, fontFamily: "ui-monospace, monospace" }}
            />
          </Field>
        </div>
      </details>

      <Field label="Notes">
        <textarea
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          rows={2}
          style={{ ...INPUT_STYLE, fontFamily: "inherit", resize: "vertical" }}
        />
      </Field>

      {error && (
        <div
          role="alert"
          style={{
            padding: "8px 10px",
            background: ACCOUNTS_TOKENS.dangerLight,
            border: `1px solid ${ACCOUNTS_TOKENS.danger}`,
            borderRadius: 8,
            color: ACCOUNTS_TOKENS.danger,
            fontSize: 12,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        {mode === "create" && (
          <button
            type="button"
            onClick={() => setOpen(false)}
            disabled={pending}
            style={BUTTON_STYLES.secondary}
          >
            Cancel
          </button>
        )}
        <button type="submit" disabled={pending} style={BUTTON_STYLES.primary}>
          {pending ? "Saving…" : mode === "edit" ? "Save changes" : "Add vendor"}
        </button>
      </div>
    </form>
  );

  if (mode === "create") {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={BUTTON_STYLES.primary}
        >
          {trigger ?? "+ Add bill vendor"}
        </button>
        <SidePanel
          open={open}
          onClose={() => setOpen(false)}
          title="Add a bill vendor"
          description="Bank details + address can be filled later. Only name is required to get started."
        >
          {formBody}
        </SidePanel>
      </>
    );
  }

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
      <h3 style={{ margin: "0 0 14px", fontSize: 14, fontWeight: 700 }}>Vendor details</h3>
      {formBody}
    </div>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        {label}
        {required && <span style={{ color: ACCOUNTS_TOKENS.danger, marginLeft: 4 }}>*</span>}
      </span>
      {children}
      {hint && (
        <span
          style={{
            fontSize: 11,
            color: "var(--muted)",
            lineHeight: 1.45,
          }}
        >
          {hint}
        </span>
      )}
    </label>
  );
}

// Preset payment-term pills + a custom input. Stored as the
// string representation of an INT (or "" for "no term set"). 0
// renders as "Current" (pay on receipt). NULL/"" means "use default".
const PAYMENT_TERM_PRESETS = [0, 10, 20, 30, 45, 60, 90] as const;

function PaymentTermsPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const numeric = value === "" ? null : Number(value);
  const isPreset =
    numeric !== null && (PAYMENT_TERM_PRESETS as readonly number[]).includes(numeric);
  const showCustomInput = numeric !== null && !isPreset;

  function presetLabel(n: number): string {
    return n === 0 ? "Current" : `${n}d`;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        <button
          type="button"
          onClick={() => onChange("")}
          style={pillStyle(value === "")}
          title="Fall back to the app-level default (45 days)"
        >
          Default
        </button>
        {PAYMENT_TERM_PRESETS.map((n) => {
          const isActive = numeric === n;
          return (
            <button
              key={n}
              type="button"
              onClick={() => onChange(String(n))}
              style={pillStyle(isActive)}
              title={
                n === 0
                  ? "Pay this vendor on receipt of bill — never triggers the premature warning"
                  : `Pay this vendor ${n} days after bill_date`
              }
            >
              {presetLabel(n)}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => onChange(showCustomInput ? value : "120")}
          style={pillStyle(showCustomInput)}
        >
          Custom
        </button>
      </div>
      {showCustomInput && (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="number"
            min={0}
            max={365}
            step={1}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            style={{
              ...INPUT_STYLE,
              width: 110,
              fontFamily: "ui-monospace, monospace",
              textAlign: "right",
            }}
          />
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            days after bill date
          </span>
        </div>
      )}
    </div>
  );
}

function pillStyle(active: boolean): React.CSSProperties {
  return {
    padding: "5px 12px",
    fontSize: 12,
    fontWeight: 700,
    background: active ? ACCOUNTS_TOKENS.accent : "transparent",
    color: active ? "#fff" : "var(--text)",
    border: `1px solid ${active ? ACCOUNTS_TOKENS.accent : ACCOUNTS_TOKENS.border}`,
    borderRadius: 999,
    cursor: "pointer",
    letterSpacing: "0.02em",
  };
}
