"use client";

/**
 * "+ Add vendor" trigger button + modal. Rendered at the top of the
 * new-bill page (alongside "← All bills") so the modal lives OUTSIDE
 * the bill-entry form — nested HTML <form>s are invalid and were
 * routing the modal's submit into the outer form instead of firing
 * upsertBillVendorAction. createPortal escapes the parent DOM
 * subtree entirely so the inner form is a clean sibling.
 */

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  ACCOUNTS_TOKENS,
  BUTTON_STYLES,
  INPUT_STYLE,
} from "../../_ui/components";

type UpsertResult =
  | { ok: true; vendorId: string }
  | { ok: false; error: string };

export function AddVendorButton({
  action,
}: {
  action: (formData: FormData) => Promise<UpsertResult>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [gstin, setGstin] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  useEffect(() => setMounted(true), []);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function reset() {
    setName("");
    setCategory("");
    setGstin("");
    setPhone("");
    setEmail("");
    setError(null);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) return setError("Vendor name is required.");
    const fd = new FormData();
    fd.set("name", trimmed);
    fd.set("category", category.trim());
    fd.set("gstin", gstin.trim());
    fd.set("phone", phone.trim());
    fd.set("email", email.trim());
    startTransition(async () => {
      const r = await action(fd);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setOpen(false);
      reset();
      // Refresh the server component so the new vendor lands in the
      // dropdown. We also pass the id via URL so the form can auto-
      // select it.
      router.replace(`/accounts/bills/new?picked=${r.vendorId}`);
      router.refresh();
    });
  }

  const modal = open && mounted ? (
    createPortal(
      <div
        onClick={() => !pending && setOpen(false)}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(15, 23, 42, 0.45)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 200,
          animation: "fadeIn 0.15s",
        }}
      >
        <form
          onClick={(e) => e.stopPropagation()}
          onSubmit={handleSubmit}
          style={{
            background: "#fff",
            border: `1px solid ${ACCOUNTS_TOKENS.border}`,
            borderRadius: 14,
            padding: 24,
            minWidth: 440,
            maxWidth: 520,
            width: "92%",
            display: "flex",
            flexDirection: "column",
            gap: 14,
            boxShadow: ACCOUNTS_TOKENS.shadowLarge,
            animation: "scaleIn 0.15s ease-out",
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, letterSpacing: "-0.01em" }}>
              Add a bill vendor
            </h2>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--muted)" }}>
              Quick add. Bank details, address, and the rest can be filled
              later from <strong>Bill Vendors</strong> in the sidebar.
            </p>
          </div>

          <Field label="Vendor name" required>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Shree Cement Ltd"
              style={INPUT_STYLE}
              required
              autoFocus
            />
          </Field>
          <Field label="Category">
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="cement / steel / tools / etc"
              style={INPUT_STYLE}
            />
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="GSTIN">
              <input
                value={gstin}
                onChange={(e) => setGstin(e.target.value)}
                style={{ ...INPUT_STYLE, fontFamily: "ui-monospace, monospace" }}
              />
            </Field>
            <Field label="Phone">
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                style={INPUT_STYLE}
              />
            </Field>
          </div>
          <Field label="Email">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={INPUT_STYLE}
            />
          </Field>

          {error && (
            <div
              role="alert"
              style={{
                padding: "10px 12px",
                background: ACCOUNTS_TOKENS.dangerLight,
                border: `1px solid ${ACCOUNTS_TOKENS.danger}`,
                borderRadius: 8,
                color: ACCOUNTS_TOKENS.danger,
                fontSize: 13,
              }}
            >
              <strong>Couldn't add:</strong> {error}
            </div>
          )}

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={() => {
                if (pending) return;
                setOpen(false);
                reset();
              }}
              disabled={pending}
              style={BUTTON_STYLES.secondary}
            >
              Cancel
            </button>
            <button type="submit" disabled={pending} style={BUTTON_STYLES.primary}>
              {pending ? "Adding…" : "Add vendor"}
            </button>
          </div>
        </form>

        <style>{`
          @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
          @keyframes scaleIn {
            from { opacity: 0; transform: scale(0.96) }
            to   { opacity: 1; transform: scale(1) }
          }
        `}</style>
      </div>,
      document.body,
    )
  ) : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={BUTTON_STYLES.primary}
      >
        + Add new vendor
      </button>
      {modal}
    </>
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
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
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
