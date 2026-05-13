"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type UpsertResult =
  | { ok: true; vendorId: string }
  | { ok: false; error: string };

/**
 * Bill-vendor add / edit form. Opens as a modal on the list page;
 * also reused inline on the detail page for editing.
 */
export function VendorForm({
  action,
  mode,
  initialValues,
  vendorId,
  trigger,
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
}) {
  const router = useRouter();
  const [open, setOpen] = useState(mode === "edit");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
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
  });

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
        setForm({
          name: "",
          category: "",
          gstin: "",
          pan: "",
          address: "",
          phone: "",
          email: "",
          bank_name: "",
          bank_account: "",
          ifsc: "",
          upi_id: "",
          notes: "",
        });
      }
    });
  }

  if (mode === "create" && !open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="primary-button"
        style={{ fontSize: 13, fontWeight: 700, padding: "8px 18px" }}
      >
        {trigger ?? "+ Add bill vendor"}
      </button>
    );
  }

  const formBody = (
    <form
      onSubmit={handleSubmit}
      onClick={(e) => e.stopPropagation()}
      style={{
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: 22,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <h2 style={{ margin: 0, fontSize: 16 }}>
        {mode === "edit" ? "Edit vendor" : "Add a bill vendor"}
      </h2>

      <Field label="Name" required>
        <input
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          required
          style={inputStyle}
          autoFocus
        />
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Category">
          <input
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            placeholder="cement / steel / tools / etc"
            style={inputStyle}
          />
        </Field>
        <Field label="GSTIN">
          <input
            value={form.gstin}
            onChange={(e) => setForm({ ...form, gstin: e.target.value })}
            style={inputStyle}
          />
        </Field>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="PAN">
          <input
            value={form.pan}
            onChange={(e) => setForm({ ...form, pan: e.target.value })}
            style={inputStyle}
          />
        </Field>
        <Field label="Phone">
          <input
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            style={inputStyle}
          />
        </Field>
      </div>
      <Field label="Email">
        <input
          type="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          style={inputStyle}
        />
      </Field>
      <Field label="Address">
        <textarea
          value={form.address}
          onChange={(e) => setForm({ ...form, address: e.target.value })}
          rows={2}
          style={{ ...inputStyle, fontFamily: "inherit", resize: "vertical" }}
        />
      </Field>
      <details style={{ marginTop: 4 }}>
        <summary
          style={{
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 700,
            color: "var(--muted)",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            padding: "4px 0",
          }}
        >
          Bank details (optional)
        </summary>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
          <Field label="Bank name">
            <input
              value={form.bank_name}
              onChange={(e) => setForm({ ...form, bank_name: e.target.value })}
              style={inputStyle}
            />
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
            <Field label="Account number">
              <input
                value={form.bank_account}
                onChange={(e) => setForm({ ...form, bank_account: e.target.value })}
                style={inputStyle}
              />
            </Field>
            <Field label="IFSC">
              <input
                value={form.ifsc}
                onChange={(e) => setForm({ ...form, ifsc: e.target.value })}
                style={inputStyle}
              />
            </Field>
          </div>
          <Field label="UPI ID">
            <input
              value={form.upi_id}
              onChange={(e) => setForm({ ...form, upi_id: e.target.value })}
              style={inputStyle}
            />
          </Field>
        </div>
      </details>
      <Field label="Notes">
        <textarea
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          rows={2}
          style={{ ...inputStyle, fontFamily: "inherit", resize: "vertical" }}
        />
      </Field>

      {error && (
        <div
          role="alert"
          style={{
            padding: "8px 10px",
            background: "rgba(220,38,38,0.08)",
            border: "1px solid #dc2626",
            borderRadius: 6,
            color: "#7f1d1d",
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
            style={{
              fontSize: 13,
              padding: "8px 16px",
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: 6,
              cursor: pending ? "wait" : "pointer",
              color: "var(--muted)",
            }}
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={pending}
          className="primary-button"
          style={{ fontSize: 13, padding: "8px 18px", fontWeight: 700 }}
        >
          {pending ? "Saving…" : mode === "edit" ? "Save changes" : "Add vendor"}
        </button>
      </div>
    </form>
  );

  if (mode === "create") {
    return (
      <div
        onClick={() => setOpen(false)}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.4)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 50,
        }}
      >
        <div style={{ minWidth: 480, maxWidth: 560, width: "92%" }}>{formBody}</div>
      </div>
    );
  }

  return formBody;
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
          fontSize: 10,
          fontWeight: 700,
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        {label}
        {required && <span style={{ color: "#dc2626", marginLeft: 4 }}>*</span>}
      </span>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  fontSize: 13,
  border: "1px solid var(--border)",
  borderRadius: 6,
  background: "var(--bg)",
  color: "var(--text)",
};
