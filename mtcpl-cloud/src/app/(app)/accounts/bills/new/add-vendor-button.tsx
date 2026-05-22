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
import { FinanceLoadingOverlay } from "@/components/finance-loading-overlay";
import {
  ACCOUNTS_TOKENS,
  BUTTON_STYLES,
  INPUT_STYLE,
} from "../../_ui/components";
import { CategoryPicker } from "../../vendors/category-picker";

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
  // Mig 066 — nickname / owner handle for multi-firm vendors.
  const [nickname, setNickname] = useState("");
  const [category, setCategory] = useState("");
  const [gstin, setGstin] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  // Mig 040 — payment terms picker carried by the quick-add too.
  // Empty string = use app-level default (45). 0 = current. Otherwise
  // an integer number of days after bill_date.
  const [paymentTermsDays, setPaymentTermsDays] = useState<string>("");
  // Mig 042 follow-on — bank account no. + TDS/TCS flag in the
  // quick-add (Daksh: "add account no. and tds/tcs field in this
  // add new vendor on new bill page too"). Bank name + IFSC come
  // along for the ride since the three move together and the
  // accountant usually has all three in hand when adding a vendor.
  const [bankName, setBankName] = useState("");
  const [bankAccount, setBankAccount] = useState("");
  const [ifsc, setIfsc] = useState("");
  // Mig 047 follow-on (Daksh, May 2026): HDFC bulk-payment bene name.
  // Auto-derived from vendor name as user types (sanitised + 20 chars)
  // unless the user has manually edited it — `hdfcTouched` tracks
  // that so a manual edit isn't clobbered by subsequent name changes.
  const [hdfcBeneName, setHdfcBeneName] = useState("");
  const [hdfcTouched, setHdfcTouched] = useState(false);
  // Single-pick tri-state. Matches the vendor-edit form picker.
  const [taxFlag, setTaxFlag] = useState<"none" | "tds" | "tcs">("none");

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

  // Daksh (May 2026): on small laptop screens the modal's form was
  // taller than the viewport, so scrolling moved the *page behind*
  // the modal instead of the modal itself. Lock body scroll while
  // the modal is open — the backdrop's own overflow-y (below) is
  // what handles "form taller than viewport" by scrolling the whole
  // dialog inside the dim layer.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  function reset() {
    setName("");
    setNickname("");
    setCategory("");
    setGstin("");
    setPhone("");
    setEmail("");
    setPaymentTermsDays("");
    setBankName("");
    setBankAccount("");
    setIfsc("");
    setHdfcBeneName("");
    setHdfcTouched(false);
    setTaxFlag("none");
    setError(null);
  }

  /** Match the regex used by the bulk-default SQL + HDFC export
   *  sanitiser. Uppercases, strips characters HDFC bans, collapses
   *  whitespace, trims to 20 chars. */
  function sanitiseForHdfc(input: string): string {
    return input
      .toUpperCase()
      .replace(/[^A-Z0-9 .]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 20);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) return setError("Vendor name is required.");
    const fd = new FormData();
    fd.set("name", trimmed);
    fd.set("nickname", nickname.trim().slice(0, 100));
    fd.set("category", category.trim());
    fd.set("gstin", gstin.trim());
    fd.set("phone", phone.trim());
    fd.set("email", email.trim());
    fd.set("payment_terms_days", paymentTermsDays.trim());
    // Mig 042 follow-on — bank info + tax flag.
    fd.set("bank_name", bankName.trim());
    fd.set("bank_account", bankAccount.trim());
    fd.set("ifsc", ifsc.trim().toUpperCase());
    // Mig 047 — HDFC bene name (max 20, all caps, no specials).
    // Server action also sanitises but client sends the already-clean
    // value so what the user sees in the field is what gets stored.
    fd.set("hdfc_bene_name", sanitiseForHdfc(hdfcBeneName));
    fd.set("tds_applicable", taxFlag === "tds" ? "1" : "");
    fd.set("tcs_applicable", taxFlag === "tcs" ? "1" : "");
    fd.set("default_tds_percent", "");
    fd.set("default_tcs_percent", "");
    startTransition(async () => {
      const r = await action(fd);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      // Mig 053 follow-on (Daksh): kick off the refresh BEFORE
      // closing the modal, then hold for 700ms so the overlay
      // covers the refresh window. Without this, the modal animated
      // away before the new vendor populated the dropdown and the
      // user saw a brief "empty" state.
      router.replace(`/accounts/bills/new?picked=${r.vendorId}`);
      router.refresh();
      await new Promise<void>((resolve) => setTimeout(resolve, 700));
      setOpen(false);
      reset();
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
          // Daksh (May 2026): grid + place-items centers the form
          // when it fits, and lets the BACKDROP scroll when the form
          // is taller than the viewport. Body scroll is locked above
          // so the page behind no longer moves. Padding gives the
          // form breathing room at the very top / bottom on short
          // laptop screens.
          display: "grid",
          placeItems: "center",
          overflowY: "auto",
          padding: "20px 16px",
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
              Quick add — bank info + TDS/TCS flag in here too so the new
              bill can be paid out without a second trip to{" "}
              <strong>Bill Vendors</strong>. PAN, address, UPI etc. can
              still be filled later from the sidebar.
            </p>
          </div>

          <Field label="Vendor name" required>
            <input
              value={name}
              onChange={(e) => {
                const next = e.target.value;
                setName(next);
                // Auto-mirror into the HDFC bene field until the user
                // manually edits it — keeps "name = bene name" the
                // common case without forcing two typings.
                if (!hdfcTouched) setHdfcBeneName(sanitiseForHdfc(next));
              }}
              style={INPUT_STYLE}
              required
              autoFocus
            />
          </Field>
          {/* Mig 066 — nickname / owner handle. Optional. */}
          <Field label="Nickname / owner">
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value.slice(0, 100))}
              placeholder="e.g. owner name, common handle"
              maxLength={100}
              style={INPUT_STYLE}
            />
            <span style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.4 }}>
              Owner name or informal handle — useful when the same person
              runs multiple firms. Searchable on Due Bills.
            </span>
          </Field>
          <Field label="Category">
            {/* Mig 061 follow-on (Daksh, 2nd pass): custom CategoryPicker
                that matches the Finance form chrome. Picking a Block
                Purchase sub-type here flips on the CFT field on the
                bill form the moment this vendor is selected. */}
            <CategoryPicker value={category} onChange={setCategory} />
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

          {/* Mig 042 follow-on — bank info. Account number + IFSC are
              what the accountant actually needs to pay out, so they
              live in the primary modal flow now. Bank name comes
              along since the three move together. */}
          <Field label="Bank name">
            <input
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}

              style={INPUT_STYLE}
            />
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
            <Field label="Account number">
              <input
                value={bankAccount}
                onChange={(e) => setBankAccount(e.target.value)}

                style={{ ...INPUT_STYLE, fontFamily: "ui-monospace, monospace" }}
              />
            </Field>
            <Field label="IFSC">
              <input
                value={ifsc}
                onChange={(e) => setIfsc(e.target.value)}

                style={{ ...INPUT_STYLE, fontFamily: "ui-monospace, monospace" }}
              />
            </Field>
          </div>

          {/* Mig 047 follow-on — HDFC bulk-payment beneficiary name.
              Pre-fills from the vendor name (sanitised, ≤20 chars) as
              the user types but stays editable. Once the user types
              into THIS field, `hdfcTouched` flips and we stop
              clobbering it on subsequent vendor-name edits. HDFC's
              file format only allows A–Z, 0–9, space, and period
              (max 20 chars) — server action re-sanitises defensively. */}
          <Field label="HDFC beneficiary name">
            <input
              value={hdfcBeneName}
              onChange={(e) => {
                setHdfcBeneName(e.target.value.slice(0, 20));
                setHdfcTouched(true);
              }}
              placeholder="Auto-filled from name; edit if needed"
              maxLength={20}
              style={{ ...INPUT_STYLE, fontFamily: "ui-monospace, monospace", textTransform: "uppercase" }}
            />
            <span style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.45 }}>
              Used on HDFC bulk-payment CSV. Max 20 chars, A–Z / 0–9 /
              space / period only. Auto-copied from the vendor name —
              change here if the bank account is held under a different name.
            </span>
          </Field>

          {/* Mig 042 follow-on — TDS/TCS picker. Mutually exclusive;
              no rate stored on the vendor (entered on each bill). */}
          <Field label="Tax deductions / collections">
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
              <TaxFlagTile
                active={taxFlag === "none"}
                label="None"
                hint="No tax adjustment"
                onClick={() => setTaxFlag("none")}
              />
              <TaxFlagTile
                active={taxFlag === "tds"}
                label="TDS"
                hint="We deduct → remit to govt"
                onClick={() => setTaxFlag("tds")}
              />
              <TaxFlagTile
                active={taxFlag === "tcs"}
                label="TCS"
                hint="Vendor adds on top"
                onClick={() => setTaxFlag("tcs")}
              />
            </div>
            <span style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.45 }}>
              Pick one. The bill form will prompt for the % at entry time.
            </span>
          </Field>

          <Field label="Payment terms">
            <PaymentTermsQuickPicker
              value={paymentTermsDays}
              onChange={setPaymentTermsDays}
            />
            <span style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.45 }}>
              Days after bill date this vendor is paid. Leave on Default to
              use the app-level 45-day window.
            </span>
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
      {/* Mig 053 follow-on — HDFC-style branded overlay while the
          server action is in flight. Renders above the modal. */}
      <FinanceLoadingOverlay show={pending} label="Saving vendor…" />
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

// Compact pill-only payment terms picker used inside the quick-add
// vendor modal. Full-form variant lives in vendor-form.tsx — same
// preset set, kept in sync deliberately.
const QUICK_PRESETS = [0, 10, 20, 30, 45, 60, 90] as const;

function PaymentTermsQuickPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const numeric = value === "" ? null : Number(value);
  const isPreset =
    numeric !== null && (QUICK_PRESETS as readonly number[]).includes(numeric);
  const showCustom = numeric !== null && !isPreset;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        <PillBtn active={value === ""} onClick={() => onChange("")}>
          Default
        </PillBtn>
        {QUICK_PRESETS.map((n) => (
          <PillBtn
            key={n}
            active={numeric === n}
            onClick={() => onChange(String(n))}
          >
            {n === 0 ? "Current" : `${n}d`}
          </PillBtn>
        ))}
        <PillBtn
          active={showCustom}
          onClick={() => onChange(showCustom ? value : "120")}
        >
          Custom
        </PillBtn>
      </div>
      {showCustom && (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="number"
            min={0}
            max={365}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            style={{ ...INPUT_STYLE, width: 110, fontFamily: "ui-monospace, monospace", textAlign: "right" }}
          />
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            days after bill date
          </span>
        </div>
      )}
    </div>
  );
}

/** Mig 042 follow-on — single-pick tile for the TDS/TCS picker in
 *  the quick-add modal. Mirrors the TaxFlagOption helper in
 *  vendor-form.tsx so the two pickers look identical. */
function TaxFlagTile({
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

function PillBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "5px 12px",
        fontSize: 12,
        fontWeight: 700,
        background: active ? ACCOUNTS_TOKENS.accent : "transparent",
        color: active ? "#fff" : "var(--text)",
        border: `1px solid ${active ? ACCOUNTS_TOKENS.accent : ACCOUNTS_TOKENS.border}`,
        borderRadius: 999,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}
