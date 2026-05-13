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
  };

  const [form, setForm] = useState(initial);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!form.name.trim()) return setError("Vendor name is required.");
    const fd = new FormData();
    if (vendorId) fd.set("id", vendorId);
    for (const [k, v] of Object.entries(form)) fd.set(k, v ?? "");
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
  children,
}: {
  label: string;
  required?: boolean;
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
    </label>
  );
}
