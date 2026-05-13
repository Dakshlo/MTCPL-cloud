"use client";

/**
 * Bill entry form — two-column layout (Zoho Books style):
 *   • LEFT: grouped sections (Beneficiary → Bill details → Amount + GST).
 *   • RIGHT: sticky preview card with live total, vendor info, save button.
 *
 * Beneficiary is now a plain native <select> dropdown. Adding a new
 * vendor is a separate flow — the "+ Add new vendor" button lives on
 * the page header (next to "← All bills") and opens a portal-rendered
 * modal that's NOT nested inside this form. After saving, the page
 * reloads with the new vendor pre-selected via `?picked=<id>`.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ACCOUNTS_TOKENS,
  BUTTON_STYLES,
  INPUT_STYLE,
  Money,
  VendorAvatar,
  VendorIdentity,
} from "../../_ui/components";

export type BillVendorOption = {
  id: string;
  name: string;
  category: string | null;
  gstin: string | null;
};

type SubmitResult =
  | { ok: true; billId: string; token: string }
  | { ok: false; error: string };

const GST_QUICK_PICKS = [0, 5, 12, 18, 28] as const;

export function BillEntryForm({
  vendors,
  initialValues,
  submitAction,
  mode = "new",
  billId,
  preSelectedVendorId,
}: {
  vendors: BillVendorOption[];
  initialValues?: {
    bill_vendor_id?: string | null;
    vendor_bill_no?: string;
    bill_date?: string;
    description?: string;
    cost_head?: string | null;
    amount_subtotal?: number;
    gst_percent?: number;
  };
  submitAction: (formData: FormData) => Promise<SubmitResult>;
  mode?: "new" | "edit";
  billId?: string;
  /** When the user adds a vendor from the page-header button, the
   *  add-vendor flow redirects to `?picked=<id>` and we auto-select
   *  that vendor here. */
  preSelectedVendorId?: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const today = useMemo(() => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }, []);

  const [vendorId, setVendorId] = useState<string>(
    initialValues?.bill_vendor_id ?? preSelectedVendorId ?? "",
  );
  const [billDate, setBillDate] = useState(initialValues?.bill_date ?? today);
  const [vendorBillNo, setVendorBillNo] = useState(initialValues?.vendor_bill_no ?? "");
  const [description, setDescription] = useState(initialValues?.description ?? "");
  const [costHead, setCostHead] = useState(initialValues?.cost_head ?? "");
  const [subtotal, setSubtotal] = useState<string>(
    initialValues?.amount_subtotal != null ? String(initialValues.amount_subtotal) : "",
  );
  const [gstPercent, setGstPercent] = useState<string>(
    initialValues?.gst_percent != null ? String(initialValues.gst_percent) : "18",
  );

  const subtotalNum = Number(subtotal) || 0;
  const gstNum = Number(gstPercent) || 0;
  const gstAmount = Math.round(subtotalNum * gstNum) / 100;
  const totalAmount = Math.round((subtotalNum + gstAmount) * 100) / 100;

  const selectedVendor = vendors.find((v) => v.id === vendorId) ?? null;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!vendorId) return setError("Pick a beneficiary.");
    if (!vendorBillNo.trim()) return setError("Vendor's bill number is required.");
    if (!billDate) return setError("Bill date is required.");
    if (!description.trim()) return setError("Description is required.");
    if (!Number.isFinite(subtotalNum) || subtotalNum <= 0)
      return setError("Subtotal must be greater than zero.");
    if (!Number.isFinite(gstNum) || gstNum < 0 || gstNum > 100)
      return setError("GST% must be between 0 and 100.");

    const formData = new FormData();
    if (mode === "edit" && billId) formData.set("bill_id", billId);
    formData.set("bill_vendor_id", vendorId);
    formData.set("vendor_bill_no", vendorBillNo.trim());
    formData.set("bill_date", billDate);
    formData.set("description", description.trim());
    formData.set("cost_head", costHead.trim());
    formData.set("amount_subtotal", String(subtotalNum));
    formData.set("gst_percent", String(gstNum));

    startTransition(async () => {
      const result = await submitAction(formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
      router.replace(
        mode === "edit"
          ? `/accounts/bills/${billId}?saved=1`
          : `/accounts/bills/${result.billId}?saved=1`,
      );
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) 320px",
        gap: 22,
        alignItems: "flex-start",
      }}
    >
      {/* LEFT — grouped sections */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Beneficiary */}
        <FormSection
          title="Beneficiary"
          description="Who issued this bill? Pick from the vendor master."
        >
          {vendors.length === 0 ? (
            <div
              style={{
                padding: "14px 16px",
                background: ACCOUNTS_TOKENS.warningLight,
                border: `1px solid ${ACCOUNTS_TOKENS.warning}`,
                borderRadius: 10,
                fontSize: 13,
                color: ACCOUNTS_TOKENS.warning,
              }}
            >
              <strong>No bill vendors yet.</strong> Click <strong>+ Add new vendor</strong>{" "}
              up at the top of the page to add your first one. The dropdown will populate
              after you save.
            </div>
          ) : (
            <>
              <FormField label="Vendor" required>
                <select
                  value={vendorId}
                  onChange={(e) => setVendorId(e.target.value)}
                  required
                  style={{ ...INPUT_STYLE, cursor: "pointer" }}
                >
                  <option value="">— Select a vendor —</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                      {v.category ? ` · ${v.category}` : ""}
                      {v.gstin ? ` · GSTIN ${v.gstin}` : ""}
                    </option>
                  ))}
                </select>
              </FormField>
              {selectedVendor && (
                <div
                  style={{
                    marginTop: 4,
                    padding: "10px 12px",
                    background: ACCOUNTS_TOKENS.accentLight,
                    border: `1px solid ${ACCOUNTS_TOKENS.accentBorder}`,
                    borderRadius: 10,
                  }}
                >
                  <VendorIdentity
                    name={selectedVendor.name}
                    subLabel={
                      [selectedVendor.category, selectedVendor.gstin && `GSTIN ${selectedVendor.gstin}`]
                        .filter(Boolean)
                        .join(" · ") || undefined
                    }
                    size={36}
                  />
                </div>
              )}
              <p style={{ margin: 0, fontSize: 11, color: "var(--muted)" }}>
                Need a new vendor? Use the <strong>+ Add new vendor</strong> button at the
                top of the page — once you save, this dropdown picks it up.
              </p>
            </>
          )}
        </FormSection>

        {/* Bill details */}
        <FormSection title="Bill details" description="From the supplier's paper bill.">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <FormField label="Bill date" required>
              <input
                type="date"
                value={billDate}
                onChange={(e) => setBillDate(e.target.value)}
                style={INPUT_STYLE}
                required
              />
            </FormField>
            <FormField label="Vendor's bill number" required>
              <input
                type="text"
                value={vendorBillNo}
                onChange={(e) => setVendorBillNo(e.target.value)}
                placeholder="e.g. INV/2026/0042"
                style={INPUT_STYLE}
                required
              />
            </FormField>
          </div>
          <FormField label="Description (items on the bill)" required>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. 3× CNC tools (5mm cutter + 8mm cutter + 10mm router)"
              rows={3}
              style={{ ...INPUT_STYLE, resize: "vertical", fontFamily: "inherit" }}
              required
            />
          </FormField>
          <FormField
            label="Cost head"
            hint="Optional — free-text category for accountant reports later (Tools / Cement / Site overhead / Utilities …)"
          >
            <input
              type="text"
              value={costHead}
              onChange={(e) => setCostHead(e.target.value)}
              placeholder="e.g. Tools"
              style={INPUT_STYLE}
            />
          </FormField>
        </FormSection>

        {/* Amount + GST */}
        <FormSection title="Amount & GST" description="Subtotal before GST; we'll compute the total.">
          <FormField label="Subtotal (₹, before GST)" required>
            <div style={{ position: "relative" }}>
              <span
                style={{
                  position: "absolute",
                  left: 12,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "var(--muted)",
                  fontFamily: "ui-monospace, monospace",
                  fontSize: 13,
                  pointerEvents: "none",
                }}
              >
                ₹
              </span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={subtotal}
                onChange={(e) => setSubtotal(e.target.value)}
                placeholder="50000"
                style={{
                  ...INPUT_STYLE,
                  paddingLeft: 26,
                  fontFamily: "ui-monospace, monospace",
                  fontSize: 14,
                }}
                required
              />
            </div>
          </FormField>

          <FormField label="GST %">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
              {GST_QUICK_PICKS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setGstPercent(String(p))}
                  style={{
                    padding: "6px 14px",
                    fontSize: 12,
                    fontWeight: 700,
                    background: gstNum === p ? ACCOUNTS_TOKENS.accent : "#fff",
                    color: gstNum === p ? "#fff" : "var(--text)",
                    border: `1px solid ${gstNum === p ? ACCOUNTS_TOKENS.accent : ACCOUNTS_TOKENS.borderStrong}`,
                    borderRadius: 8,
                    cursor: "pointer",
                    fontFamily: "ui-monospace, monospace",
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
                style={{ ...INPUT_STYLE, width: 90, fontFamily: "ui-monospace, monospace" }}
              />
              <span style={{ fontSize: 11, color: "var(--muted)" }}>custom</span>
            </div>
          </FormField>
        </FormSection>

        {error && (
          <div
            role="alert"
            style={{
              padding: "12px 14px",
              background: ACCOUNTS_TOKENS.dangerLight,
              border: `1px solid ${ACCOUNTS_TOKENS.danger}`,
              borderRadius: 10,
              color: ACCOUNTS_TOKENS.danger,
              fontSize: 13,
            }}
          >
            <strong>Couldn't save:</strong> {error}
          </div>
        )}
      </div>

      {/* RIGHT — sticky preview rail */}
      <aside
        style={{
          position: "sticky",
          top: 16,
          background: "#fff",
          border: `1px solid ${ACCOUNTS_TOKENS.border}`,
          borderRadius: 12,
          padding: 18,
          boxShadow: ACCOUNTS_TOKENS.shadow,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: "var(--muted)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          Bill preview
        </div>

        {selectedVendor ? (
          <VendorIdentity name={selectedVendor.name} subLabel={selectedVendor.category ?? undefined} size={36} />
        ) : (
          <div style={{ fontSize: 12, color: "var(--muted)", fontStyle: "italic" }}>
            No vendor selected yet
          </div>
        )}

        {(billDate || vendorBillNo) && (
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            {billDate &&
              new Date(billDate).toLocaleDateString("en-IN", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            {billDate && vendorBillNo && " · "}
            {vendorBillNo && (
              <span style={{ fontFamily: "ui-monospace, monospace", color: "var(--text)" }}>
                {vendorBillNo}
              </span>
            )}
          </div>
        )}

        <div style={{ height: 1, background: ACCOUNTS_TOKENS.border, margin: "4px 0" }} />

        <PreviewRow label="Subtotal" value={<Money value={subtotalNum} tone="muted" />} />
        <PreviewRow label={`GST (${gstNum}%)`} value={<Money value={gstAmount} tone="muted" />} />

        <div style={{ height: 1, background: ACCOUNTS_TOKENS.border, margin: "4px 0" }} />

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            padding: "8px 0",
          }}
        >
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: "var(--text)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Total payable
          </span>
          <Money value={totalAmount} size="large" tone="accent" />
        </div>

        <button
          type="submit"
          disabled={pending}
          style={{
            ...BUTTON_STYLES.primary,
            width: "100%",
            justifyContent: "center",
            padding: "11px 18px",
            fontSize: 14,
          }}
        >
          {pending ? "Saving…" : mode === "edit" ? "Save & resubmit" : "Submit for audit"}
        </button>

        <p style={{ margin: 0, fontSize: 11, color: "var(--muted)", lineHeight: 1.5 }}>
          The bill goes to the owner's audit queue. Once approved, it
          lands in the accountant's due list.
        </p>
      </aside>
    </form>
  );
}

function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "#fff",
        border: `1px solid ${ACCOUNTS_TOKENS.border}`,
        borderRadius: 12,
        padding: 18,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        boxShadow: ACCOUNTS_TOKENS.shadow,
      }}
    >
      <div>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.005em" }}>
          {title}
        </h3>
        {description && (
          <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--muted)" }}>{description}</p>
        )}
      </div>
      {children}
    </div>
  );
}

function FormField({
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
      {hint && <span style={{ fontSize: 11, color: "var(--muted)" }}>{hint}</span>}
    </label>
  );
}

function PreviewRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
      <span style={{ fontSize: 12, color: "var(--muted)" }}>{label}</span>
      {value}
    </div>
  );
}
