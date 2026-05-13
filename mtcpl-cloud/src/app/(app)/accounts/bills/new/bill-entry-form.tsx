"use client";

/**
 * Bill entry form — biller + owner + dev.
 *
 * Fields:
 *   - Beneficiary (combobox over active bill_vendors + inline "+ Add")
 *   - Bill date
 *   - Vendor's bill number
 *   - Description (textarea)
 *   - Cost head (free-text — accountant uses this for reports later)
 *   - Subtotal amount (₹) + GST% (quick-pick chips)
 *   - Live total preview (subtotal + GST = total)
 *
 * Submit fires submitBillAction. Returns `{ ok: true, billId, token }`
 * on success — we toast + redirect to the bill detail page. Mirrors
 * the FinishBlockForm submit + redirect pattern.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

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
  // When editing an existing bill, `mode='edit'` switches the button
  // copy + redirect target so the form doubles as both "new bill" and
  // "rejected-bill resubmit".
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

  // Pre-fill from initialValues (edit mode) or sensible defaults.
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
    if (!q) return vendors.slice(0, 20);
    return vendors
      .filter(
        (v) =>
          v.name.toLowerCase().includes(q) ||
          (v.category ?? "").toLowerCase().includes(q) ||
          (v.gstin ?? "").toLowerCase().includes(q),
      )
      .slice(0, 20);
  }, [vendorSearch, vendors]);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!vendorId) return setError("Pick a beneficiary.");
    if (!vendorBillNo.trim()) return setError("Vendor's bill number is required.");
    if (!billDate) return setError("Bill date is required.");
    if (!description.trim()) return setError("Description is required.");
    if (!Number.isFinite(subtotalNum) || subtotalNum <= 0) {
      return setError("Subtotal must be greater than zero.");
    }
    if (!Number.isFinite(gstNum) || gstNum < 0 || gstNum > 100) {
      return setError("GST% must be between 0 and 100.");
    }

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
      // Toast surfaced via the route + page refresh.
      router.refresh();
      if (mode === "edit") {
        router.replace(`/accounts/bills/${billId}?saved=1`);
      } else {
        router.replace(`/accounts/bills/${result.billId}?saved=1`);
      }
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
      // Optimistically add to the list and select it.
      const newVendor: BillVendorOption = {
        id: result.vendorId,
        name,
        category: newVendorCategory.trim() || null,
        gstin: newVendorGstin.trim() || null,
      };
      vendors.push(newVendor);
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
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Beneficiary */}
      <Field label="Beneficiary (bill vendor)" required>
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
              style={inputStyle}
            />
            {showVendorList && filteredVendors.length > 0 && (
              <div
                style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  right: 0,
                  marginTop: 4,
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  maxHeight: 260,
                  overflowY: "auto",
                  zIndex: 10,
                  boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
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
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "8px 12px",
                      background: v.id === vendorId ? "rgba(232,197,114,0.12)" : "transparent",
                      border: "none",
                      borderBottom: "1px solid var(--border-light, var(--border))",
                      cursor: "pointer",
                      fontSize: 13,
                      color: "var(--text)",
                    }}
                  >
                    <strong>{v.name}</strong>
                    {(v.category || v.gstin) && (
                      <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>
                        {v.category ? v.category : ""}
                        {v.category && v.gstin ? " · " : ""}
                        {v.gstin ? `GSTIN ${v.gstin}` : ""}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setVendorModalOpen(true)}
            style={{
              padding: "8px 14px",
              fontSize: 13,
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              fontWeight: 600,
              cursor: "pointer",
              color: "var(--text)",
              whiteSpace: "nowrap",
            }}
          >
            + Add new
          </button>
        </div>
        {selectedVendor && (
          <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            Selected: <strong style={{ color: "var(--text)" }}>{selectedVendor.name}</strong>
            {selectedVendor.gstin ? ` · GSTIN ${selectedVendor.gstin}` : ""}
          </p>
        )}
      </Field>

      {/* Bill date + vendor's bill no */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Field label="Bill date" required>
          <input
            type="date"
            value={billDate}
            onChange={(e) => setBillDate(e.target.value)}
            style={inputStyle}
            required
          />
        </Field>
        <Field label="Vendor's bill number" required>
          <input
            type="text"
            value={vendorBillNo}
            onChange={(e) => setVendorBillNo(e.target.value)}
            placeholder="e.g. INV/2026/0042"
            style={inputStyle}
            required
          />
        </Field>
      </div>

      {/* Description + cost head */}
      <Field label="Description (items on the bill)" required>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. 3× CNC tools (5mm cutter + 8mm cutter + 10mm router)"
          rows={3}
          style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
          required
        />
      </Field>
      <Field label="Cost head (optional)" hint="Free-text category for accountant reports later — e.g. Tools, Cement, Site overhead, Utilities">
        <input
          type="text"
          value={costHead}
          onChange={(e) => setCostHead(e.target.value)}
          placeholder="e.g. Tools"
          style={inputStyle}
        />
      </Field>

      {/* Amount + GST */}
      <Field label="Subtotal (₹, before GST)" required>
        <input
          type="number"
          step="0.01"
          min="0"
          value={subtotal}
          onChange={(e) => setSubtotal(e.target.value)}
          placeholder="50000"
          style={{ ...inputStyle, fontFamily: "ui-monospace, monospace" }}
          required
        />
      </Field>

      <Field label="GST %">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          {GST_QUICK_PICKS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setGstPercent(String(p))}
              style={{
                padding: "5px 12px",
                fontSize: 12,
                background: gstNum === p ? "var(--gold)" : "var(--bg)",
                color: gstNum === p ? "#fff" : "var(--text)",
                border: `1px solid ${gstNum === p ? "var(--gold-dark)" : "var(--border)"}`,
                borderRadius: 6,
                fontWeight: 700,
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
            style={{ ...inputStyle, width: 90, fontFamily: "ui-monospace, monospace" }}
          />
          <span className="muted" style={{ fontSize: 11 }}>custom</span>
        </div>
      </Field>

      {/* Live total preview */}
      <div
        style={{
          padding: "12px 14px",
          background: "var(--surface)",
          border: "1.5px solid var(--gold)",
          borderRadius: 8,
          display: "flex",
          flexDirection: "column",
          gap: 4,
          fontFamily: "ui-monospace, monospace",
        }}
      >
        <Row label="Subtotal" value={`₹${subtotalNum.toLocaleString("en-IN")}`} />
        <Row label={`GST (${gstNum}%)`} value={`₹${gstAmount.toLocaleString("en-IN")}`} />
        <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />
        <Row
          label="Total"
          value={`₹${totalAmount.toLocaleString("en-IN")}`}
          highlight
        />
      </div>

      {error && (
        <div
          role="alert"
          style={{
            padding: "10px 12px",
            background: "rgba(220,38,38,0.08)",
            border: "1.5px solid #dc2626",
            borderRadius: 6,
            color: "#7f1d1d",
            fontSize: 13,
          }}
        >
          <strong>Couldn't save:</strong> {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button
          type="submit"
          className="primary-button"
          disabled={pending}
          style={{ padding: "10px 22px", fontSize: 14, fontWeight: 700 }}
        >
          {pending
            ? "Saving…"
            : mode === "edit"
              ? "Save changes & resubmit"
              : "Submit for approval"}
        </button>
      </div>

      {/* Quick-add vendor modal */}
      {vendorModalOpen && (
        <div
          onClick={() => setVendorModalOpen(false)}
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
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleAddVendor}
            style={{
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              padding: 22,
              minWidth: 380,
              maxWidth: 480,
              width: "92%",
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
          >
            <h2 style={{ margin: 0, fontSize: 17 }}>Add a bill vendor</h2>
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>
              Quick add. You can fill the rest (bank details, address) later from /accounts/vendors.
            </p>
            <Field label="Vendor name" required>
              <input
                type="text"
                value={newVendorName}
                onChange={(e) => setNewVendorName(e.target.value)}
                placeholder="e.g. Shree Cement Ltd"
                style={inputStyle}
                required
                autoFocus
              />
            </Field>
            <Field label="Category">
              <input
                type="text"
                value={newVendorCategory}
                onChange={(e) => setNewVendorCategory(e.target.value)}
                placeholder="cement / steel / tools / etc"
                style={inputStyle}
              />
            </Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="GSTIN">
                <input
                  type="text"
                  value={newVendorGstin}
                  onChange={(e) => setNewVendorGstin(e.target.value)}
                  style={inputStyle}
                />
              </Field>
              <Field label="Phone">
                <input
                  type="text"
                  value={newVendorPhone}
                  onChange={(e) => setNewVendorPhone(e.target.value)}
                  style={inputStyle}
                />
              </Field>
            </div>
            {vendorModalError && (
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
                {vendorModalError}
              </div>
            )}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => setVendorModalOpen(false)}
                style={{
                  padding: "8px 16px",
                  fontSize: 13,
                  background: "transparent",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  cursor: "pointer",
                  color: "var(--muted)",
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="primary-button"
                disabled={vendorAdding}
                style={{ padding: "8px 18px", fontSize: 13 }}
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

// ── Small visual helpers ────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 12px",
  fontSize: 13,
  border: "1px solid var(--border)",
  borderRadius: 6,
  background: "var(--bg)",
  color: "var(--text)",
};

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
        {required && <span style={{ color: "#dc2626", marginLeft: 4 }}>*</span>}
      </span>
      {children}
      {hint && (
        <span className="muted" style={{ fontSize: 11 }}>
          {hint}
        </span>
      )}
    </label>
  );
}

function Row({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
      <span
        style={{
          fontSize: highlight ? 13 : 12,
          fontWeight: highlight ? 700 : 500,
          color: highlight ? "var(--text)" : "var(--muted)",
        }}
      >
        {label}
      </span>
      <strong
        style={{
          fontSize: highlight ? 18 : 13,
          fontWeight: 700,
          color: highlight ? "var(--gold-dark)" : "var(--text)",
        }}
      >
        {value}
      </strong>
    </div>
  );
}
