"use client";

/**
 * Bill entry form — two-column layout (Zoho Books style):
 *   • LEFT: grouped sections (Beneficiary → Bill details → Amount + GST).
 *   • RIGHT: sticky preview card with live total, vendor info, save button.
 *
 * Quick-add vendor modal is a centred dialog (kept the same pattern as
 * before — slide-over felt heavy for a small form).
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

type AddVendorResult =
  | { ok: true; vendorId: string }
  | { ok: false; error: string };

const GST_QUICK_PICKS = [0, 5, 12, 18, 28] as const;

export function BillEntryForm({
  vendors,
  initialValues,
  submitAction,
  addVendorAction,
  mode = "new",
  billId,
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
  addVendorAction: (formData: FormData) => Promise<AddVendorResult>;
  mode?: "new" | "edit";
  billId?: string;
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

  const [vendorId, setVendorId] = useState<string>(initialValues?.bill_vendor_id ?? "");
  const [vendorSearch, setVendorSearch] = useState("");
  const [showVendorList, setShowVendorList] = useState(false);
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

  const [vendorModalOpen, setVendorModalOpen] = useState(false);
  const [newVendorName, setNewVendorName] = useState("");
  const [newVendorCategory, setNewVendorCategory] = useState("");
  const [newVendorGstin, setNewVendorGstin] = useState("");
  const [newVendorPhone, setNewVendorPhone] = useState("");
  const [vendorModalError, setVendorModalError] = useState<string | null>(null);
  const [vendorAdding, startVendorAdd] = useTransition();

  const subtotalNum = Number(subtotal) || 0;
  const gstNum = Number(gstPercent) || 0;
  const gstAmount = Math.round(subtotalNum * gstNum) / 100;
  const totalAmount = Math.round((subtotalNum + gstAmount) * 100) / 100;

  const selectedVendor = vendors.find((v) => v.id === vendorId) ?? null;

  const filteredVendors = useMemo(() => {
    const q = vendorSearch.trim().toLowerCase();
    if (!q) return vendors.slice(0, 30);
    return vendors
      .filter(
        (v) =>
          v.name.toLowerCase().includes(q) ||
          (v.category ?? "").toLowerCase().includes(q) ||
          (v.gstin ?? "").toLowerCase().includes(q),
      )
      .slice(0, 30);
  }, [vendorSearch, vendors]);

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

  function handleAddVendor(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setVendorModalError(null);
    const name = newVendorName.trim();
    if (!name) return setVendorModalError("Vendor name is required.");
    const fd = new FormData();
    fd.set("name", name);
    fd.set("category", newVendorCategory.trim());
    fd.set("gstin", newVendorGstin.trim());
    fd.set("phone", newVendorPhone.trim());
    startVendorAdd(async () => {
      const result = await addVendorAction(fd);
      if (!result.ok) {
        setVendorModalError(result.error);
        return;
      }
      vendors.push({
        id: result.vendorId,
        name,
        category: newVendorCategory.trim() || null,
        gstin: newVendorGstin.trim() || null,
      });
      setVendorId(result.vendorId);
      setVendorSearch("");
      setShowVendorList(false);
      setVendorModalOpen(false);
      setNewVendorName("");
      setNewVendorCategory("");
      setNewVendorGstin("");
      setNewVendorPhone("");
      router.refresh();
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
        <FormSection title="Beneficiary" description="Who issued this bill? Search the vendor master or add a new one.">
          <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
            <div style={{ position: "relative", flex: 1 }}>
              <input
                type="text"
                placeholder={selectedVendor ? "Change vendor…" : "Search vendor by name, category, GSTIN…"}
                value={selectedVendor && !showVendorList ? selectedVendor.name : vendorSearch}
                onChange={(e) => {
                  setVendorSearch(e.target.value);
                  setShowVendorList(true);
                  if (selectedVendor) setVendorId("");
                }}
                onFocus={() => setShowVendorList(true)}
                style={INPUT_STYLE}
              />
              {showVendorList && filteredVendors.length > 0 && (
                <div
                  style={{
                    position: "absolute",
                    top: "100%",
                    left: 0,
                    right: 0,
                    marginTop: 4,
                    background: "#fff",
                    border: `1px solid ${ACCOUNTS_TOKENS.border}`,
                    borderRadius: 10,
                    maxHeight: 280,
                    overflowY: "auto",
                    zIndex: 10,
                    boxShadow: ACCOUNTS_TOKENS.shadowLarge,
                  }}
                >
                  {filteredVendors.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => {
                        setVendorId(v.id);
                        setVendorSearch("");
                        setShowVendorList(false);
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        width: "100%",
                        padding: "8px 12px",
                        background: v.id === vendorId ? ACCOUNTS_TOKENS.accentLight : "transparent",
                        border: "none",
                        borderBottom: `1px solid ${ACCOUNTS_TOKENS.border}`,
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <VendorAvatar name={v.name} size={28} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
                          {v.name}
                        </div>
                        {(v.category || v.gstin) && (
                          <div style={{ fontSize: 11, color: "var(--muted)" }}>
                            {v.category && <span>{v.category}</span>}
                            {v.category && v.gstin && " · "}
                            {v.gstin && <span style={{ fontFamily: "ui-monospace, monospace" }}>{v.gstin}</span>}
                          </div>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setVendorModalOpen(true)}
              style={BUTTON_STYLES.secondary}
            >
              + Add new
            </button>
          </div>
          {selectedVendor && (
            <div
              style={{
                marginTop: 10,
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
            {billDate && new Date(billDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
            {billDate && vendorBillNo && " · "}
            {vendorBillNo && <span style={{ fontFamily: "ui-monospace, monospace", color: "var(--text)" }}>{vendorBillNo}</span>}
          </div>
        )}

        <div style={{ height: 1, background: ACCOUNTS_TOKENS.border, margin: "4px 0" }} />

        <PreviewRow label="Subtotal" value={<Money value={subtotalNum} tone="muted" />} />
        <PreviewRow
          label={`GST (${gstNum}%)`}
          value={<Money value={gstAmount} tone="muted" />}
        />

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
          style={{ ...BUTTON_STYLES.primary, width: "100%", justifyContent: "center", padding: "11px 18px", fontSize: 14 }}
        >
          {pending
            ? "Saving…"
            : mode === "edit"
              ? "Save & resubmit"
              : "Submit for audit"}
        </button>

        <p style={{ margin: 0, fontSize: 11, color: "var(--muted)", lineHeight: 1.5 }}>
          The bill goes to the owner's audit queue. Once approved, it
          lands in the accountant's due list.
        </p>
      </aside>

      {/* Quick-add vendor modal */}
      {vendorModalOpen && (
        <div
          onClick={() => setVendorModalOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
          }}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleAddVendor}
            style={{
              background: "#fff",
              border: `1px solid ${ACCOUNTS_TOKENS.border}`,
              borderRadius: 14,
              padding: 24,
              minWidth: 420,
              maxWidth: 500,
              width: "92%",
              display: "flex",
              flexDirection: "column",
              gap: 14,
              boxShadow: ACCOUNTS_TOKENS.shadowLarge,
            }}
          >
            <div>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800, letterSpacing: "-0.01em" }}>
                Add a bill vendor
              </h2>
              <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--muted)" }}>
                Quick add. Bank details + address can be filled later from /accounts/vendors.
              </p>
            </div>
            <FormField label="Vendor name" required>
              <input
                type="text"
                value={newVendorName}
                onChange={(e) => setNewVendorName(e.target.value)}
                placeholder="e.g. Shree Cement Ltd"
                style={INPUT_STYLE}
                required
                autoFocus
              />
            </FormField>
            <FormField label="Category">
              <input
                type="text"
                value={newVendorCategory}
                onChange={(e) => setNewVendorCategory(e.target.value)}
                placeholder="cement / steel / tools / etc"
                style={INPUT_STYLE}
              />
            </FormField>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <FormField label="GSTIN">
                <input
                  type="text"
                  value={newVendorGstin}
                  onChange={(e) => setNewVendorGstin(e.target.value)}
                  style={INPUT_STYLE}
                />
              </FormField>
              <FormField label="Phone">
                <input
                  type="text"
                  value={newVendorPhone}
                  onChange={(e) => setNewVendorPhone(e.target.value)}
                  style={INPUT_STYLE}
                />
              </FormField>
            </div>
            {vendorModalError && (
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
                {vendorModalError}
              </div>
            )}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => setVendorModalOpen(false)}
                style={BUTTON_STYLES.secondary}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={vendorAdding}
                style={BUTTON_STYLES.primary}
              >
                {vendorAdding ? "Adding…" : "Add vendor"}
              </button>
            </div>
          </form>
        </div>
      )}
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
      {hint && (
        <span style={{ fontSize: 11, color: "var(--muted)" }}>
          {hint}
        </span>
      )}
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
