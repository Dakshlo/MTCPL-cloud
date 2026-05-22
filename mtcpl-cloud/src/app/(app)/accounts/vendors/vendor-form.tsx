"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ACCOUNTS_TOKENS,
  BUTTON_STYLES,
  INPUT_STYLE,
  SidePanel,
} from "../_ui/components";
import { CategoryPicker } from "./category-picker";

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
    /** Mig 066 — short human-friendly handle (usually the owner's
     *  name) so multi-firm vendors are easy to match across rows. */
    nickname?: string | null;
    category?: string | null;
    gstin?: string | null;
    pan?: string | null;
    address?: string | null;
    phone?: string | null;
    email?: string | null;
    bank_name?: string | null;
    bank_account?: string | null;
    ifsc?: string | null;
    /** Mig 047 — exact bene name as registered on HDFC's portal.
     *  Required for the HDFC bulk-payment file export. Max 20 chars
     *  per HDFC's spec (column E hard limit). */
    hdfc_bene_name?: string | null;
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
    nickname: initialValues?.nickname ?? "",
    category: initialValues?.category ?? "",
    gstin: initialValues?.gstin ?? "",
    pan: initialValues?.pan ?? "",
    address: initialValues?.address ?? "",
    phone: initialValues?.phone ?? "",
    email: initialValues?.email ?? "",
    bank_name: initialValues?.bank_name ?? "",
    bank_account: initialValues?.bank_account ?? "",
    ifsc: initialValues?.ifsc ?? "",
    hdfc_bene_name: initialValues?.hdfc_bene_name ?? "",
    upi_id: initialValues?.upi_id ?? "",
    notes: initialValues?.notes ?? "",
    // Payment terms — stored separately so we can roundtrip it as
    // either a preset preset (0/10/20/30/45/60/90) or a custom int.
    // Empty string = no value, falls back to app default.
    payment_terms_days:
      initialValues?.payment_terms_days != null
        ? String(initialValues.payment_terms_days)
        : "",
    // Mig 042 follow-on — TDS / TCS are mutually exclusive per
    // vendor (Daksh: "only one can be selected per vendor"). We
    // collapse the two booleans into a single tri-state radio in
    // the form, and split it back to the two booleans on submit so
    // the wire format / DB columns don't change.
    tax_flag:
      initialValues?.tds_applicable === true
        ? ("tds" as const)
        : initialValues?.tcs_applicable === true
          ? ("tcs" as const)
          : ("none" as const),
  };

  const [form, setForm] = useState(initial);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!form.name.trim()) return setError("Vendor name is required.");
    const fd = new FormData();
    if (vendorId) fd.set("id", vendorId);
    for (const [k, v] of Object.entries(form)) {
      // Skip the synthetic tax_flag — we split it into the two
      // server-side booleans separately below.
      if (k === "tax_flag") continue;
      if (typeof v === "boolean") {
        fd.set(k, v ? "1" : "");
      } else {
        fd.set(k, v ?? "");
      }
    }
    // Mig 042 follow-on — single-pick TDS/TCS. Percent defaults are
    // intentionally cleared; the accountant enters the rate on the
    // bill form each time.
    fd.set("tds_applicable", form.tax_flag === "tds" ? "1" : "");
    fd.set("tcs_applicable", form.tax_flag === "tcs" ? "1" : "");
    fd.set("default_tds_percent", "");
    fd.set("default_tcs_percent", "");
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
      {/* Mig 066 — nickname / owner handle. Optional. Shown next to
          the vendor name on lists and bill rows so multi-firm
          vendors are easy to identify. Searchable in Due Bills. */}
      <Field label="Nickname / owner">
        <input
          value={form.nickname}
          onChange={(e) => setForm({ ...form, nickname: e.target.value.slice(0, 100) })}
          placeholder="e.g. owner name, common handle"
          maxLength={100}
          style={INPUT_STYLE}
        />
        <span style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
          Useful when the same owner runs multiple firms — write the
          owner&apos;s name here and the bill team can match across them.
        </span>
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Category">
          {/* Mig 061 follow-on (Daksh, 2nd pass): swapped the native
              <select> for the custom CategoryPicker — matches the
              rest of the Finance form chrome (rounded, accent-
              focus, card-style popover with pill previews). */}
          <CategoryPicker
            value={form.category}
            onChange={(next) => setForm({ ...form, category: next })}
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

      {/* Mig 042 follow-on (Daksh) — bank info promoted under
          Category / GSTIN. PAN / phone / email / address / UPI live
          inside the collapsible "Additional details" section below. */}
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

      {/* Mig 058 follow-on (Daksh) — email promoted out of the
          collapsed "Additional details" section. It's how the
          payment-voucher email reaches the vendor; needs to be
          a primary field, not buried. */}
      <Field
        label="Email"
        hint="Where the payment voucher is emailed after a bill is paid. Leave blank to skip emails for this vendor."
      >
        <input
          type="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          placeholder="vendor@example.com"
          style={INPUT_STYLE}
        />
      </Field>

      {/* Mig 047 — HDFC's bulk payment file (.001) requires the bene
          name to EXACTLY MATCH what HDFC has on record. The internal
          vendor name above can differ — this field carries the
          HDFC-side label. Max 20 chars (HDFC's hard cap), all caps,
          no special characters. The export auto-uppercases + strips
          specials at file-gen time, but matching what HDFC has on
          record means the upload doesn't reject. */}
      <Field
        label="HDFC Beneficiary Name"
        hint="Exact name HDFC has registered for this vendor — max 20 chars, will be sent as-is on the bulk payment file. Leave blank if you don't use HDFC bulk upload for this vendor."
      >
        <input
          value={form.hdfc_bene_name}
          onChange={(e) =>
            setForm({
              ...form,
              // Soft-trim to 20 chars while typing so the user doesn't
              // overshoot. HDFC will reject the row at the bank if it's
              // longer; we surface that constraint up-front.
              hdfc_bene_name: e.target.value.slice(0, 20),
            })
          }
          maxLength={20}
          placeholder="e.g. PARESH KMR ENT"
          style={{
            ...INPUT_STYLE,
            fontFamily: "ui-monospace, monospace",
            textTransform: "uppercase",
          }}
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

      {/* Mig 042 follow-on — TDS / TCS are MUTUALLY EXCLUSIVE per
          vendor. Single tri-state picker; no default rate stored on
          the vendor. The accountant enters the actual rate on each
          bill at entry time. */}
      <Field
        label="Tax deductions / collections"
        hint="Pick one. The bill form for this vendor will prompt for the % at entry time — no default rate is stored here."
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 6,
            background: ACCOUNTS_TOKENS.surfaceMuted,
            border: `1px solid ${ACCOUNTS_TOKENS.border}`,
            borderRadius: 8,
            padding: 6,
          }}
        >
          <TaxFlagOption
            active={form.tax_flag === "none"}
            label="None"
            hint="No tax adjustment"
            onClick={() => setForm({ ...form, tax_flag: "none" })}
          />
          <TaxFlagOption
            active={form.tax_flag === "tds"}
            label="TDS"
            hint="We deduct → remit to govt"
            onClick={() => setForm({ ...form, tax_flag: "tds" })}
          />
          <TaxFlagOption
            active={form.tax_flag === "tcs"}
            label="TCS"
            hint="Vendor adds on top"
            onClick={() => setForm({ ...form, tax_flag: "tcs" })}
          />
        </div>
      </Field>

      {/* Less-important contact + identity fields. Hidden by default;
          most of them rarely change after vendor creation. */}
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
          + Additional details (PAN · phone · address · UPI)
        </summary>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
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
          <Field label="Address">
            <textarea
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              rows={2}
              style={{ ...INPUT_STYLE, fontFamily: "inherit", resize: "vertical" }}
            />
          </Field>
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

/** Mig 042 follow-on — single-pick tile for the TDS/TCS picker.
 *  Three of these in a row replace the previous two checkbox+input
 *  rows. No percent stored on the vendor; the rate is entered on
 *  each bill. */
function TaxFlagOption({
  active,
  label,
  hint,
  onClick,
}: {
  active: boolean;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "8px 10px",
        background: active ? ACCOUNTS_TOKENS.accent : "#fff",
        color: active ? "#fff" : "var(--text)",
        border: `1px solid ${active ? ACCOUNTS_TOKENS.accent : ACCOUNTS_TOKENS.border}`,
        borderRadius: 6,
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: 2,
        alignItems: "flex-start",
        textAlign: "left",
      }}
    >
      <span
        style={{
          fontSize: 12,
          fontWeight: 800,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 10,
          color: active ? "rgba(255,255,255,0.85)" : "var(--muted)",
          lineHeight: 1.4,
        }}
      >
        {hint}
      </span>
    </button>
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
