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

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FinanceLoadingOverlay } from "@/components/finance-loading-overlay";
import {
  ACCOUNTS_TOKENS,
  BUTTON_STYLES,
  INPUT_STYLE,
  Money,
  VendorIdentity,
} from "../../_ui/components";
import { VendorPicker } from "./vendor-picker";
import { isBlockPurchaseCategory } from "@/lib/bill-vendor-categories";

export type BillVendorOption = {
  id: string;
  name: string;
  category: string | null;
  gstin: string | null;
  /** Mig 042 — when true, the form will surface a TDS% input
   *  pre-filled with default_tds_percent when this vendor is picked. */
  tds_applicable?: boolean | null;
  default_tds_percent?: number | null;
  tcs_applicable?: boolean | null;
  default_tcs_percent?: number | null;
};

type SubmitResult =
  | { ok: true; billId: string; token: string }
  // Mig 042 follow-on (Daksh): duplicate-bill errors are surfaced
  // as a small center-peek modal instead of the long inline banner
  // — the action tags the result with errorCode='DUPLICATE_BILL' so
  // the form can render the focused popup.
  | { ok: false; error: string; errorCode?: "DUPLICATE_BILL" };

// GST quick-picks. Each entry splits the rate into CGST + SGST
// (intra-state) by default. Users can switch to IGST (inter-state)
// via a toggle.
const GST_QUICK_PICKS = [0, 5, 12, 18, 28] as const;

// Mig 058 follow-on — visual cue for fields that are locked while
// the bill is in pending_approval (bill_date + vendor_bill_no).
// Slightly muted background + dashed border so the user reads
// "this is intentional, not broken".
const lockedInputOverlay: React.CSSProperties = {
  background: "#f1f5f9",
  borderStyle: "dashed",
  color: "#475569",
  cursor: "not-allowed",
};

export function BillEntryForm({
  vendors,
  initialValues,
  submitAction,
  mode = "new",
  billId,
  preSelectedVendorId,
  lockedFields,
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
    cgst_percent?: number;
    sgst_percent?: number;
    igst_percent?: number;
    tds_percent?: number;
    tcs_percent?: number;
    /** Mig 062 — block volume in CFT. Only relevant when the
     *  selected vendor's category lies in Block Purchase. */
    block_cft?: number | null;
  };
  submitAction: (formData: FormData) => Promise<SubmitResult>;
  mode?: "new" | "edit";
  billId?: string;
  /** Mig 058 follow-on (Daksh): on a pending-approval edit, the
   *  bill_date + vendor_bill_no fields are locked because they feed
   *  the token (T-YYYY-N) and the natural-key unique constraint.
   *  Pass a list of field names to render those inputs disabled
   *  + show a callout explaining "cancel + recreate" is the way
   *  to change them. */
  lockedFields?: Array<"bill_date" | "vendor_bill_no">;
  /** When the user adds a vendor from the page-header button, the
   *  add-vendor flow redirects to `?picked=<id>` and we auto-select
   *  that vendor here. */
  preSelectedVendorId?: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const locked = new Set(lockedFields ?? []);
  const billDateLocked = locked.has("bill_date");
  const vendorBillNoLocked = locked.has("vendor_bill_no");
  const anyTokenFieldLocked = billDateLocked || vendorBillNoLocked;
  // Mig 042 follow-on (Daksh) — duplicate-bill errors get their own
  // small centered modal. Captures the conflicting bill no + vendor
  // name + financial year so the popup can show "Invoice X with
  // VENDOR in FY 2026" directly.
  const [duplicateInfo, setDuplicateInfo] = useState<{
    vendorName: string;
    vendorBillNo: string;
    financialYear: number;
  } | null>(null);

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
  // Mig 099 — optional scanned bill document (photo / PDF), attached at
  // creation. Owners can add/replace it later from the bill detail page.
  const [billDoc, setBillDoc] = useState<File | null>(null);
  const [costHead, setCostHead] = useState(initialValues?.cost_head ?? "");
  const [subtotal, setSubtotal] = useState<string>(
    initialValues?.amount_subtotal != null ? String(initialValues.amount_subtotal) : "",
  );
  // Mig 062 — block CFT input value. Persisted as numeric on the bill
  // when the selected vendor is in the Block Purchase category group.
  const [blockCft, setBlockCft] = useState<string>(
    initialValues?.block_cft != null ? String(initialValues.block_cft) : "",
  );

  // Mig 042 — GST is now split across CGST / SGST / IGST. We store
  // the three percents independently; gst_percent is derived as their
  // sum and sent to the server alongside, so the existing generated
  // amount_gst / amount_total columns keep working.
  //
  // Intra-state mode = CGST + SGST (typically half of the total
  // each, e.g. 18% GST = 9% CGST + 9% SGST).
  // Inter-state mode = IGST only.
  //
  // The form maintains a `gstMode` toggle ('intra' | 'inter') so the
  // quick-pick buttons fill the right columns; users in edit mode
  // pick the mode automatically from whichever columns are non-zero.
  const initialIgst = Number(initialValues?.igst_percent ?? 0);
  const initialCgst = Number(initialValues?.cgst_percent ?? 0);
  const initialSgst = Number(initialValues?.sgst_percent ?? 0);
  const initialGst =
    initialValues?.gst_percent != null
      ? Number(initialValues.gst_percent)
      : initialCgst + initialSgst + initialIgst;
  const inferredMode: "intra" | "inter" =
    initialIgst > 0 ? "inter" : "intra";

  const [gstMode, setGstMode] = useState<"intra" | "inter">(inferredMode);
  const [cgstPercent, setCgstPercent] = useState<string>(
    initialCgst > 0 ? String(initialCgst) : initialGst > 0 && inferredMode === "intra" ? String(initialGst / 2) : "9",
  );
  const [sgstPercent, setSgstPercent] = useState<string>(
    initialSgst > 0 ? String(initialSgst) : initialGst > 0 && inferredMode === "intra" ? String(initialGst / 2) : "9",
  );
  const [igstPercent, setIgstPercent] = useState<string>(
    initialIgst > 0 ? String(initialIgst) : "18",
  );

  const [tdsPercent, setTdsPercent] = useState<string>(
    initialValues?.tds_percent != null && initialValues.tds_percent > 0
      ? String(initialValues.tds_percent)
      : "",
  );
  const [tcsPercent, setTcsPercent] = useState<string>(
    initialValues?.tcs_percent != null && initialValues.tcs_percent > 0
      ? String(initialValues.tcs_percent)
      : "",
  );

  const subtotalNum = Number(subtotal) || 0;
  const cgstNum = gstMode === "intra" ? Number(cgstPercent) || 0 : 0;
  const sgstNum = gstMode === "intra" ? Number(sgstPercent) || 0 : 0;
  const igstNum = gstMode === "inter" ? Number(igstPercent) || 0 : 0;
  const gstNum = cgstNum + sgstNum + igstNum;
  const tdsNum = Number(tdsPercent) || 0;
  const tcsNum = Number(tcsPercent) || 0;

  const cgstAmount = Math.round(subtotalNum * cgstNum) / 100;
  const sgstAmount = Math.round(subtotalNum * sgstNum) / 100;
  const igstAmount = Math.round(subtotalNum * igstNum) / 100;
  const gstAmount = cgstAmount + sgstAmount + igstAmount;
  const totalAmount = Math.round((subtotalNum + gstAmount) * 100) / 100;
  // Mig 049 — TDS is on the NET subtotal (per CBDT Circular 23/2017),
  // not on subtotal + GST. TCS stays on the GROSS total per Section
  // 206C(1H). These are the two formulas the DB's generated columns
  // also use, so the form preview matches the saved values.
  const tdsAmount = Math.round(subtotalNum * tdsNum) / 100;
  const tcsAmount = Math.round(totalAmount * tcsNum) / 100;
  const payableToVendor =
    Math.round((totalAmount - tdsAmount + tcsAmount) * 100) / 100;

  const selectedVendor = vendors.find((v) => v.id === vendorId) ?? null;
  const showTds = selectedVendor?.tds_applicable === true;
  const showTcs = selectedVendor?.tcs_applicable === true;
  // Mig 062 — show the CFT input when this vendor sells raw stone
  // blocks (any of the Block Purchase sub-types). Hidden otherwise.
  const showBlockCft = isBlockPurchaseCategory(selectedVendor?.category);

  // Gating: every other field stays disabled until a vendor is
  // picked. Daksh's employees were submitting bills with the vendor
  // dropdown left blank — gating makes the order explicit.
  const fieldsDisabled = !vendorId;

  // When the vendor changes, pre-fill TDS / TCS rates from the
  // vendor's defaults so the accountant doesn't re-type them. Doesn't
  // override values already set in edit mode.
  function handleVendorChange(nextId: string) {
    setVendorId(nextId);
    const v = vendors.find((vv) => vv.id === nextId);
    if (!v) return;
    if (v.tds_applicable && v.default_tds_percent != null && !tdsPercent) {
      setTdsPercent(String(v.default_tds_percent));
    }
    if (!v.tds_applicable) setTdsPercent("");
    if (v.tcs_applicable && v.default_tcs_percent != null && !tcsPercent) {
      setTcsPercent(String(v.default_tcs_percent));
    }
    if (!v.tcs_applicable) setTcsPercent("");
  }

  // ── AI bill scan (June 2026) — OPTIONAL pre-fill. Uploads the photo/
  // PDF to /api/accounts/bill-scan (read-only — no DB writes), maps the
  // extracted fields into the form state, and attaches the file as the
  // bill document. The accountant reviews everything and saves through
  // the normal submit — manual entry is completely unchanged.
  const scanInputRef = useRef<HTMLInputElement>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanNotes, setScanNotes] = useState<string[]>([]);

  type ScanData = {
    vendor_name?: string | null;
    vendor_gstin?: string | null;
    bill_no?: string | null;
    bill_date?: string | null;
    description?: string | null;
    subtotal?: number | null;
    cgst_percent?: number | null;
    sgst_percent?: number | null;
    igst_percent?: number | null;
    total?: number | null;
    confidence?: string;
  };

  function applyScan(d: ScanData, file: File) {
    const notes: string[] = [];

    // Vendor match: exact GSTIN first (most reliable), then name.
    const normGst = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, "").toUpperCase();
    const normName = (s: string | null | undefined) => (s ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase();
    let matched: BillVendorOption | null = null;
    if (d.vendor_gstin) {
      matched = vendors.find((v) => normGst(v.gstin) === normGst(d.vendor_gstin) && normGst(v.gstin) !== "") ?? null;
    }
    if (!matched && d.vendor_name) {
      const target = normName(d.vendor_name);
      if (target.length >= 4) {
        const hits = vendors.filter((v) => {
          const n = normName(v.name);
          return n === target || n.includes(target) || target.includes(n);
        });
        if (hits.length === 1) matched = hits[0];
      }
    }
    if (matched) {
      handleVendorChange(matched.id);
      notes.push(`Vendor matched: ${matched.name}`);
    } else {
      notes.push(
        d.vendor_name
          ? `Vendor "${d.vendor_name}" not found in your list — pick it manually.`
          : "Couldn't read the vendor name — pick it manually.",
      );
    }

    if (d.bill_date && /^\d{4}-\d{2}-\d{2}$/.test(d.bill_date) && !billDateLocked) setBillDate(d.bill_date);
    if (d.bill_no && !vendorBillNoLocked) setVendorBillNo(String(d.bill_no));
    if (d.description) setDescription(String(d.description));
    if (d.subtotal != null && d.subtotal > 0) setSubtotal(String(d.subtotal));

    const igst = Number(d.igst_percent ?? 0);
    const cgst = Number(d.cgst_percent ?? 0);
    const sgst = Number(d.sgst_percent ?? 0);
    if (igst > 0) {
      setGstMode("inter");
      setIgstPercent(String(igst));
    } else if (cgst > 0 || sgst > 0) {
      // Bills sometimes print only one of the pair — mirror it.
      setGstMode("intra");
      setCgstPercent(String(cgst > 0 ? cgst : sgst));
      setSgstPercent(String(sgst > 0 ? sgst : cgst));
    } else {
      setGstMode("intra");
      setCgstPercent("0");
      setSgstPercent("0");
    }

    // Math check: does subtotal + read GST = the printed total? A
    // mismatch usually means the AI misread a digit — flag it loudly.
    if (d.subtotal != null && d.total != null && d.subtotal > 0 && d.total > 0) {
      const rate = igst > 0 ? igst : (cgst > 0 || sgst > 0 ? (cgst > 0 ? cgst : sgst) + (sgst > 0 ? sgst : cgst) : 0);
      const expected = d.subtotal * (1 + rate / 100);
      if (Math.abs(expected - d.total) > 1.5) {
        notes.push(
          `⚠ Check amounts — subtotal + GST (₹${Math.round(expected).toLocaleString("en-IN")}) doesn't match the printed total (₹${Math.round(d.total).toLocaleString("en-IN")}).`,
        );
      }
    }
    if (d.confidence === "low") {
      notes.push("⚠ The photo was hard to read — double-check every field.");
    }

    // Attach the scan as the bill's proof document (new bills only).
    if (mode !== "edit") {
      setBillDoc(file);
      notes.push("Scan attached as the bill document.");
    }
    setScanNotes(notes);
  }

  async function handleScanFile(file: File | null) {
    if (!file || scanning) return;
    setScanning(true);
    setScanError(null);
    setScanNotes([]);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await fetch("/api/accounts/bill-scan", { method: "POST", body: fd });
      const json = (await res.json()) as { ok: boolean; data?: ScanData; error?: string };
      if (!json.ok || !json.data) {
        setScanError(json.error ?? "Scan failed — enter the bill manually.");
        return;
      }
      applyScan(json.data, file);
    } catch {
      setScanError("Scan failed — check your connection, or enter the bill manually.");
    } finally {
      setScanning(false);
      if (scanInputRef.current) scanInputRef.current.value = "";
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!vendorId) return setError("Pick a beneficiary.");
    if (!vendorBillNo.trim()) return setError("Vendor's bill number is required.");
    if (!billDate) return setError("Bill date is required.");
    // Daksh May 2026 — mirror the server's validateBillDate guard
    // for instant feedback. <input type=date> on Chrome/iOS will
    // sometimes accept a 6-digit year typed manually; this catches
    // it before the action round-trip.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(billDate)) {
      return setError("Bill date must use a 4-digit year (YYYY-MM-DD).");
    }
    {
      const y = parseInt(billDate.slice(0, 4), 10);
      const maxY = new Date().getFullYear() + 1;
      if (y < 2015 || y > maxY) {
        return setError(
          `Bill date year ${y} looks wrong — use a year between 2015 and ${maxY}.`,
        );
      }
    }
    if (!description.trim()) return setError("Description is required.");
    if (!Number.isFinite(subtotalNum) || subtotalNum <= 0)
      return setError("Subtotal must be greater than zero.");
    if (gstNum < 0 || gstNum > 100)
      return setError("Total GST (CGST + SGST + IGST) must be between 0 and 100.");
    if (showTds && (!Number.isFinite(tdsNum) || tdsNum < 0 || tdsNum > 100))
      return setError("TDS% must be between 0 and 100.");
    if (showTcs && (!Number.isFinite(tcsNum) || tcsNum < 0 || tcsNum > 100))
      return setError("TCS% must be between 0 and 100.");

    const formData = new FormData();
    if (mode === "edit" && billId) formData.set("bill_id", billId);
    formData.set("bill_vendor_id", vendorId);
    formData.set("vendor_bill_no", vendorBillNo.trim());
    formData.set("bill_date", billDate);
    formData.set("description", description.trim());
    formData.set("cost_head", costHead.trim());
    formData.set("amount_subtotal", String(subtotalNum));
    formData.set("cgst_percent", String(cgstNum));
    formData.set("sgst_percent", String(sgstNum));
    formData.set("igst_percent", String(igstNum));
    formData.set("gst_percent", String(gstNum));
    formData.set("tds_percent", String(showTds ? tdsNum : 0));
    formData.set("tcs_percent", String(showTcs ? tcsNum : 0));
    // Mig 062 — only attach block_cft when the selected vendor is a
    // block-purchase one. Otherwise leave the form key absent so the
    // action sets the column to NULL (or keeps existing NULL on edit).
    if (showBlockCft) {
      formData.set("block_cft", blockCft.trim());
    } else {
      formData.set("block_cft", "");
    }
    // Mig 099 — attach the scanned bill document on creation (optional).
    // Edits don't carry it (owners replace it from the detail page).
    if (mode !== "edit" && billDoc) formData.set("bill_document", billDoc);

    startTransition(async () => {
      const result = await submitAction(formData);
      if (!result.ok) {
        // Mig 042 follow-on — duplicate-bill error goes into a
        // center-peek modal instead of the bottom error banner.
        // Other errors keep the inline banner.
        if (
          (result as { errorCode?: "DUPLICATE_BILL" }).errorCode ===
          "DUPLICATE_BILL"
        ) {
          // Financial year follows the Indian FY rule used in mig 039:
          // April–March. A bill_date of 15 May 2026 → FY 2026; a
          // 15 Feb 2026 → FY 2025.
          const d = new Date(billDate);
          const month = d.getMonth(); // 0-indexed
          const fy = month >= 3 ? d.getFullYear() : d.getFullYear() - 1;
          setDuplicateInfo({
            vendorName: selectedVendor?.name ?? "this vendor",
            vendorBillNo: vendorBillNo.trim(),
            financialYear: fy,
          });
          return;
        }
        setError(result.error);
        return;
      }
      router.refresh();
      // Migration 042: on a FRESH submit (not an edit), the detail
      // page renders a big blinking banner with the token so the
      // biller knows to write it on the physical bill. The
      // `?just_submitted=1` flag toggles that banner; `?saved=1` (the
      // existing edit-flow flag) shows a milder "Saved" toast.
      router.replace(
        mode === "edit"
          ? `/accounts/bills/${billId}?saved=1`
          : `/accounts/bills/${result.billId}?just_submitted=1`,
      );
    });
  }

  return (
    <>
    {/* Mig 053 follow-on — branded overlay while Submit for audit
        runs. Bill creation does a few DB writes + a notification fan-
        out, so the user benefits from a clear "the system is working"
        signal. */}
    <FinanceLoadingOverlay
      show={pending}
      label={mode === "edit" ? "Saving bill…" : "Submitting for audit…"}
    />
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
        {/* ── AI bill scan (optional) — pre-fills the form from a photo/
            PDF of the bill. Manual entry below works exactly as before. */}
        {mode === "new" && (
          <div
            style={{
              padding: "12px 14px",
              background: ACCOUNTS_TOKENS.accentLight,
              border: `1.5px dashed ${ACCOUNTS_TOKENS.accentBorder}`,
              borderRadius: 10,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <input
                ref={scanInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                style={{ display: "none" }}
                onChange={(e) => handleScanFile(e.target.files?.[0] ?? null)}
              />
              <button
                type="button"
                disabled={scanning}
                onClick={() => scanInputRef.current?.click()}
                style={{
                  ...BUTTON_STYLES.primary,
                  opacity: scanning ? 0.7 : 1,
                  cursor: scanning ? "wait" : "pointer",
                }}
              >
                {scanning ? "⏳ Reading the bill…" : "📷 Scan bill (AI)"}
              </button>
              <span style={{ fontSize: 12, color: "var(--muted)", flex: 1, minWidth: 200 }}>
                Optional — upload a photo or PDF and the form pre-fills automatically.
                <strong> Verify every field before submitting.</strong> Manual entry works as always.
              </span>
            </div>
            {scanError && (
              <div style={{ fontSize: 12.5, fontWeight: 600, color: ACCOUNTS_TOKENS.danger }}>⚠ {scanError}</div>
            )}
            {scanNotes.length > 0 && (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: "var(--text)", display: "flex", flexDirection: "column", gap: 2 }}>
                {scanNotes.map((n, i) => (
                  <li key={i} style={n.startsWith("⚠") ? { color: "#92400e", fontWeight: 700 } : undefined}>{n}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Mig 058 follow-on (Daksh) — callout when bill_date +
            vendor_bill_no are locked (pending-approval edit). */}
        {anyTokenFieldLocked && (
          <div
            role="note"
            style={{
              padding: "12px 14px",
              background: ACCOUNTS_TOKENS.warningLight,
              border: `1.5px solid ${ACCOUNTS_TOKENS.warning}`,
              borderRadius: 10,
              display: "flex",
              alignItems: "flex-start",
              gap: 12,
              fontSize: 13,
              color: "#7c2d12",
            }}
          >
            <span style={{ fontSize: 18, lineHeight: 1 }} aria-hidden>
              🔒
            </span>
            <div>
              <div style={{ fontWeight: 800, marginBottom: 3 }}>
                {billDateLocked && vendorBillNoLocked
                  ? "Bill date and vendor invoice number are locked"
                  : billDateLocked
                  ? "Bill date is locked"
                  : "Vendor invoice number is locked"}
              </div>
              <div style={{ color: "#92400e", fontSize: 12, lineHeight: 1.55 }}>
                Both feed the token (T-YYYY-N) and the bill's unique
                identity. They can&apos;t be edited once the bill is in
                audit. To use a different date or vendor invoice number,
                <strong> cancel this bill from the detail page and create
                a new one</strong> — the new bill gets a fresh token.
              </div>
            </div>
          </div>
        )}

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
              up at the top of the page to add your first one. The picker will populate
              after you save.
            </div>
          ) : (
            <>
              <FormField label="Vendor" required>
                <VendorPicker
                  vendors={vendors}
                  selectedId={vendorId}
                  onChange={handleVendorChange}
                />
              </FormField>
              <p style={{ margin: 0, fontSize: 11, color: "var(--muted)" }}>
                Click the field above to search and pick a vendor. Need a new one? Use the{" "}
                <strong>+ Add new vendor</strong> button at the top of the page — once
                you save, the picker auto-selects it.
              </p>
              {/* Gating hint — drives the employee to pick a vendor
                  FIRST before the rest of the form unlocks. */}
              {fieldsDisabled && (
                <div
                  style={{
                    padding: "10px 12px",
                    background: ACCOUNTS_TOKENS.warningLight,
                    border: `1px dashed ${ACCOUNTS_TOKENS.warning}`,
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 600,
                    color: ACCOUNTS_TOKENS.warning,
                    marginTop: 8,
                  }}
                >
                  ⓘ Pick a vendor first. The rest of the form unlocks once a
                  vendor is selected so we don't accidentally save a bill
                  against the wrong supplier.
                </div>
              )}
            </>
          )}
        </FormSection>

        {/* Bill details — disabled until a vendor is picked */}
        <FormSection
          title="Bill details"
          description="From the supplier's paper bill."
          disabled={fieldsDisabled}
        >
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <FormField
              label="Bill date"
              required
              hint={billDateLocked ? "Locked — part of the token. Cancel + recreate to change." : undefined}
            >
              <input
                type="date"
                value={billDate}
                onChange={(e) => setBillDate(e.target.value)}
                /* Daksh May 2026 — calendar picker only, NO keyboard
                 * typing. Earlier guard rails caught "year 102025"
                 * etc., but an accountant still typed "206" as a
                 * year and the row landed at year 0206 (token
                 * T-0206-410). Blocking every keydown except
                 * Tab/Esc/Enter forces the user to use the calendar
                 * picker — which only ever produces a real date. */
                onKeyDown={(e) => {
                  if (
                    e.key === "Tab" ||
                    e.key === "Escape" ||
                    e.key === "Enter"
                  ) {
                    return; // allow form navigation keys
                  }
                  e.preventDefault();
                }}
                /* min/max keep the calendar picker itself ranged so
                 * the user can't even SCROLL to a wrong year via
                 * the picker. Floor 2015 covers historic back-dated
                 * bills; ceiling = end of next year so a Dec 31
                 * entry for early January still works. */
                min="2015-01-01"
                max={`${new Date().getFullYear() + 1}-12-31`}
                /* Mobile hint: skip the alphanumeric keyboard
                 * (we're blocking typing anyway). */
                inputMode="none"
                style={{
                  ...INPUT_STYLE,
                  ...(billDateLocked ? lockedInputOverlay : {}),
                  /* Tell the user this isn't a text input — calendar
                   * cursor (default arrow + small calendar icon
                   * comes from the date input itself). */
                  caretColor: "transparent",
                  cursor: billDateLocked ? "not-allowed" : "pointer",
                }}
                required
                disabled={fieldsDisabled || billDateLocked}
                readOnly={billDateLocked}
                title="Pick the bill date from the calendar — typing is disabled to avoid typos in the year"
              />
            </FormField>
            <FormField
              label="Vendor's bill number"
              required
              hint={vendorBillNoLocked ? "Locked — part of the bill's identity. Cancel + recreate to change." : undefined}
            >
              <input
                type="text"
                value={vendorBillNo}
                onChange={(e) => setVendorBillNo(e.target.value)}

                style={{
                  ...INPUT_STYLE,
                  ...(vendorBillNoLocked ? lockedInputOverlay : {}),
                }}
                required
                disabled={fieldsDisabled || vendorBillNoLocked}
                readOnly={vendorBillNoLocked}
              />
            </FormField>
          </div>
          <FormField label="Description (items on the bill)" required>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}

              rows={3}
              style={{ ...INPUT_STYLE, resize: "vertical", fontFamily: "inherit" }}
              required
              disabled={fieldsDisabled}
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

              style={INPUT_STYLE}
              disabled={fieldsDisabled}
            />
          </FormField>
          {/* Mig 099 — scanned bill document (photo / PDF). Optional, create
              mode only; owners add/replace later from the bill detail. */}
          {mode !== "edit" && (
            <FormField
              label="Bill document (photo / PDF)"
              hint="Optional — attach a scan or photo of the supplier's bill. JPG, PNG, WebP, HEIC or PDF, up to 10 MB."
            >
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
                onChange={(e) => setBillDoc(e.target.files?.[0] ?? null)}
                style={INPUT_STYLE}
                disabled={fieldsDisabled}
              />
              {billDoc && (
                <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--muted)" }}>
                  📎 {billDoc.name} ({(billDoc.size / 1024 / 1024).toFixed(2)} MB)
                </p>
              )}
            </FormField>
          )}
        </FormSection>

        {/* Amount + Taxes — disabled until a vendor is picked */}
        <FormSection
          title="Amount & taxes"
          description="Subtotal before tax. Pick intra-state (CGST + SGST) or inter-state (IGST). Total + payable update live."
          disabled={fieldsDisabled}
        >
          <FormField label="Subtotal (₹, before tax)" required>
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
                // No placeholder here — Daksh's dad mistook the previous
                // "50000" hint for a pre-filled value and tried to
                // submit without entering anything. Keep the field
                // visually empty so it's obvious it needs input.
                placeholder=""
                aria-label="Subtotal in rupees, required"
                style={{
                  ...INPUT_STYLE,
                  paddingLeft: 26,
                  fontFamily: "ui-monospace, monospace",
                  fontSize: 14,
                }}
                required
                disabled={fieldsDisabled}
              />
            </div>
            {/* INR-formatted preview. Type "150000" → see "= ₹1,50,000".
                Number inputs can't show comma separators directly, so
                we render the formatted value next to the field as a
                live mirror. Hidden when the field is empty. */}
            {subtotalNum > 0 && (
              <span
                style={{
                  fontSize: 12,
                  color: ACCOUNTS_TOKENS.accent,
                  fontFamily: "ui-monospace, monospace",
                  fontWeight: 600,
                }}
              >
                = ₹{subtotalNum.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                {subtotalNum >= 100000 && (
                  <span style={{ color: "var(--muted)", fontWeight: 400, marginLeft: 6 }}>
                    ({inrWords(subtotalNum)})
                  </span>
                )}
              </span>
            )}
          </FormField>

          {/* Mig 062 — CFT input for block-purchase bills only. Shows
              when the selected vendor's category is one of the Block
              Purchase sub-types (Pink Stone / Marble / Yellow Marble
              / Red Stone / Other-Block). Lets the accountant capture
              the stone volume on the bill so the team can later roll
              up ₹ per CFT per stone type. */}
          {showBlockCft && (
            <FormField
              label="Block CFT (cubic feet of stone)"
              hint="Total volume across all blocks billed. Used for future ₹/CFT cost analysis."
            >
              <input
                type="number"
                step="0.001"
                min="0"
                value={blockCft}
                onChange={(e) => setBlockCft(e.target.value)}
                placeholder="e.g. 125.5"
                aria-label="Block CFT in cubic feet"
                style={{
                  ...INPUT_STYLE,
                  fontFamily: "ui-monospace, monospace",
                  fontSize: 14,
                }}
                disabled={fieldsDisabled}
              />
              {Number(blockCft) > 0 && subtotalNum > 0 && (
                <span
                  style={{
                    fontSize: 12,
                    color: ACCOUNTS_TOKENS.accent,
                    fontFamily: "ui-monospace, monospace",
                    fontWeight: 600,
                  }}
                >
                  = ₹{(subtotalNum / Number(blockCft)).toLocaleString("en-IN", {
                    maximumFractionDigits: 2,
                  })}{" "}
                  <span style={{ color: "var(--muted)", fontWeight: 400 }}>per CFT (subtotal basis)</span>
                </span>
              )}
            </FormField>
          )}


          {/* GST mode toggle (intra-state vs inter-state) */}
          <FormField
            label="GST"
            hint={
              gstMode === "intra"
                ? "Intra-state: CGST + SGST share the rate (half each for standard rates)."
                : "Inter-state: a single IGST rate."
            }
          >
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <ModeToggle
                active={gstMode === "intra"}
                label="Intra-state (CGST + SGST)"
                onClick={() => setGstMode("intra")}
                disabled={fieldsDisabled}
              />
              <ModeToggle
                active={gstMode === "inter"}
                label="Inter-state (IGST)"
                onClick={() => setGstMode("inter")}
                disabled={fieldsDisabled}
              />
            </div>

            {/* GST quick-picks split the rate into the active mode's
                columns. 18% intra → CGST 9% + SGST 9%. 18% inter → IGST 18%. */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                alignItems: "center",
                marginTop: 10,
              }}
            >
              {GST_QUICK_PICKS.map((p) => {
                const active = Math.abs(gstNum - p) < 0.001;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => {
                      if (gstMode === "intra") {
                        const half = p / 2;
                        setCgstPercent(String(half));
                        setSgstPercent(String(half));
                      } else {
                        setIgstPercent(String(p));
                      }
                    }}
                    disabled={fieldsDisabled}
                    style={{
                      padding: "6px 14px",
                      fontSize: 12,
                      fontWeight: 700,
                      background: active ? ACCOUNTS_TOKENS.accent : "#fff",
                      color: active ? "#fff" : "var(--text)",
                      border: `1px solid ${active ? ACCOUNTS_TOKENS.accent : ACCOUNTS_TOKENS.borderStrong}`,
                      borderRadius: 8,
                      cursor: fieldsDisabled ? "not-allowed" : "pointer",
                      fontFamily: "ui-monospace, monospace",
                      opacity: fieldsDisabled ? 0.5 : 1,
                    }}
                  >
                    {p}%
                  </button>
                );
              })}
            </div>

            {/* Per-component inputs */}
            {gstMode === "intra" ? (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 10,
                  marginTop: 10,
                }}
              >
                <TaxInput
                  label="CGST %"
                  value={cgstPercent}
                  onChange={setCgstPercent}
                  disabled={fieldsDisabled}
                />
                <TaxInput
                  label="SGST %"
                  value={sgstPercent}
                  onChange={setSgstPercent}
                  disabled={fieldsDisabled}
                />
              </div>
            ) : (
              <div style={{ marginTop: 10, maxWidth: 200 }}>
                <TaxInput
                  label="IGST %"
                  value={igstPercent}
                  onChange={setIgstPercent}
                  disabled={fieldsDisabled}
                />
              </div>
            )}
          </FormField>

          {/* TDS / TCS — only shown when the vendor is flagged */}
          {(showTds || showTcs) && (
            <FormField
              label="Tax deduction / collection"
              hint={
                showTds && showTcs
                  ? "This vendor is flagged for both TDS and TCS. Override the defaults if today's bill carries a different rate."
                  : showTds
                    ? "This vendor is flagged for TDS — we deduct from payment and remit to the govt."
                    : "This vendor is flagged for TCS — they add it on top of GST and we pay them inclusive."
              }
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: showTds && showTcs ? "1fr 1fr" : "1fr",
                  gap: 10,
                  maxWidth: 320,
                }}
              >
                {showTds && (
                  <TaxInput
                    label="TDS %"
                    value={tdsPercent}
                    onChange={setTdsPercent}
                    disabled={fieldsDisabled}
                  />
                )}
                {showTcs && (
                  <TaxInput
                    label="TCS %"
                    value={tcsPercent}
                    onChange={setTcsPercent}
                    disabled={fieldsDisabled}
                  />
                )}
              </div>
            </FormField>
          )}
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
              new Date(billDate).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata",
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
        {gstMode === "intra" ? (
          <>
            {cgstNum > 0 && (
              <PreviewRow
                label={`CGST (${cgstNum}%)`}
                value={<Money value={cgstAmount} tone="muted" />}
              />
            )}
            {sgstNum > 0 && (
              <PreviewRow
                label={`SGST (${sgstNum}%)`}
                value={<Money value={sgstAmount} tone="muted" />}
              />
            )}
          </>
        ) : (
          igstNum > 0 && (
            <PreviewRow
              label={`IGST (${igstNum}%)`}
              value={<Money value={igstAmount} tone="muted" />}
            />
          )
        )}

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
            Bill total
          </span>
          <Money value={totalAmount} size="large" tone="accent" />
        </div>

        {(showTds && tdsNum > 0) || (showTcs && tcsNum > 0) ? (
          <>
            <div style={{ height: 1, background: ACCOUNTS_TOKENS.border, margin: "4px 0" }} />
            {showTds && tdsNum > 0 && (
              <PreviewRow
                label={`− TDS (${tdsNum}%)`}
                value={<Money value={tdsAmount} tone="warning" />}
              />
            )}
            {showTcs && tcsNum > 0 && (
              <PreviewRow
                label={`+ TCS (${tcsNum}%)`}
                value={<Money value={tcsAmount} tone="muted" />}
              />
            )}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                background: ACCOUNTS_TOKENS.successLight,
                margin: "4px -10px -6px",
                padding: "8px 10px",
                borderRadius: 6,
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  color: ACCOUNTS_TOKENS.success,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Pay to vendor
              </span>
              <Money value={payableToVendor} size="large" tone="success" />
            </div>
          </>
        ) : null}

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

    {/* Mig 042 follow-on (Daksh): centered duplicate-bill peek
        instead of the long red banner at the bottom of the form.
        Renders only when the server tagged the error with
        errorCode='DUPLICATE_BILL'. Direct, three short lines of info,
        single Close button. */}
    {duplicateInfo && (
      <DuplicateBillPeek
        info={duplicateInfo}
        onClose={() => setDuplicateInfo(null)}
      />
    )}
    </>
  );
}

function DuplicateBillPeek({
  info,
  onClose,
}: {
  info: { vendorName: string; vendorBillNo: string; financialYear: number };
  onClose: () => void;
}) {
  return (
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="duplicate-bill-title"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 250,
        animation: "fadeIn 0.15s",
      }}
    >
      <style>{`
        @keyframes mtcpl-dupe-pop {
          from { opacity: 0; transform: scale(0.94); }
          to   { opacity: 1; transform: scale(1); }
        }
      `}</style>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: 14,
          padding: "22px 24px 18px",
          minWidth: 320,
          maxWidth: 420,
          width: "92%",
          boxShadow: "0 20px 60px rgba(15, 23, 42, 0.25)",
          display: "flex",
          flexDirection: "column",
          gap: 14,
          animation: "mtcpl-dupe-pop 0.15s ease-out",
          borderTop: `4px solid ${ACCOUNTS_TOKENS.danger}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 22 }} aria-hidden>⚠️</span>
          <h2
            id="duplicate-bill-title"
            style={{
              margin: 0,
              fontSize: 16,
              fontWeight: 800,
              color: ACCOUNTS_TOKENS.danger,
              letterSpacing: "-0.01em",
            }}
          >
            Duplicate bill
          </h2>
        </div>
        <dl
          style={{
            margin: 0,
            display: "grid",
            gridTemplateColumns: "auto 1fr",
            rowGap: 6,
            columnGap: 14,
            fontSize: 13,
          }}
        >
          <dt style={{ color: "var(--muted)", fontWeight: 600 }}>Invoice no.</dt>
          <dd
            style={{
              margin: 0,
              fontFamily: "ui-monospace, monospace",
              fontWeight: 700,
              color: "var(--text)",
            }}
          >
            {info.vendorBillNo}
          </dd>
          <dt style={{ color: "var(--muted)", fontWeight: 600 }}>Vendor</dt>
          <dd style={{ margin: 0, fontWeight: 700, color: "var(--text)" }}>
            {info.vendorName}
          </dd>
          <dt style={{ color: "var(--muted)", fontWeight: 600 }}>FY</dt>
          <dd
            style={{
              margin: 0,
              fontFamily: "ui-monospace, monospace",
              fontWeight: 700,
              color: "var(--text)",
            }}
          >
            {info.financialYear} – {info.financialYear + 1}
          </dd>
        </dl>
        <p style={{ margin: 0, fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
          A bill with this number already exists for this vendor in this
          financial year. Leading zeros are ignored — <strong>1, 01, 001,
          00001</strong> all match the same number. Same bill no. is
          allowed in a different FY.
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onClose}
            autoFocus
            style={{
              padding: "8px 16px",
              fontSize: 13,
              fontWeight: 700,
              background: ACCOUNTS_TOKENS.danger,
              color: "#fff",
              border: "none",
              borderRadius: 8,
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function FormSection({
  title,
  description,
  children,
  disabled,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  /** Visually + functionally locks the section. The inputs inside
   *  each still need their own `disabled` prop (HTML can't disable
   *  a whole sub-tree), but the wrapper dims to telegraph the gate. */
  disabled?: boolean;
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
        opacity: disabled ? 0.55 : 1,
        position: "relative",
        transition: "opacity 0.15s ease",
      }}
      aria-disabled={disabled || undefined}
    >
      <div>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.005em" }}>
          {title}
          {disabled && (
            <span
              style={{
                marginLeft: 8,
                fontSize: 10,
                fontWeight: 800,
                color: "var(--muted)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              🔒 locked — pick vendor first
            </span>
          )}
        </h3>
        {description && (
          <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--muted)" }}>{description}</p>
        )}
      </div>
      {children}
    </div>
  );
}

function ModeToggle({
  active,
  label,
  onClick,
  disabled,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "7px 14px",
        fontSize: 12,
        fontWeight: 700,
        background: active ? ACCOUNTS_TOKENS.accent : "#fff",
        color: active ? "#fff" : "var(--text)",
        border: `1px solid ${active ? ACCOUNTS_TOKENS.accent : ACCOUNTS_TOKENS.borderStrong}`,
        borderRadius: 999,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        letterSpacing: "0.02em",
      }}
    >
      {label}
    </button>
  );
}

function TaxInput({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span
        style={{
          fontSize: 10,
          fontWeight: 800,
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        {label}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input
          type="number"
          step="0.01"
          min={0}
          max={100}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          style={{
            ...INPUT_STYLE,
            fontFamily: "ui-monospace, monospace",
            textAlign: "right",
            opacity: disabled ? 0.55 : 1,
          }}
        />
        <span style={{ fontSize: 12, color: "var(--muted)" }}>%</span>
      </div>
    </label>
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
      {/* Bolder + darker labels so required fields are obvious at a
          glance — Daksh's dad missed the subtotal because the old
          muted/uppercase style read more like a hint than a prompt. */}
      <span
        style={{
          fontSize: 13,
          fontWeight: 700,
          color: "var(--text)",
          letterSpacing: "-0.005em",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        {label}
        {required && (
          <span
            title="Required"
            style={{
              color: ACCOUNTS_TOKENS.danger,
              fontWeight: 800,
              fontSize: 12,
              padding: "1px 6px",
              borderRadius: 4,
              background: "rgba(220, 38, 38, 0.08)",
              border: "1px solid rgba(220, 38, 38, 0.30)",
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            * Required
          </span>
        )}
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

/** Spoken-form Indian numeric annotation — "1 lakh", "12.5 lakh",
 *  "1.5 crore", etc. Only kicks in for ≥ 1 lakh (where it's actually
 *  useful — below that, the digits are short enough to read). */
function inrWords(n: number): string {
  if (n < 100_000) return "";
  if (n < 10_000_000) {
    const lakh = n / 100_000;
    return `${lakh % 1 === 0 ? lakh.toFixed(0) : lakh.toFixed(2)} lakh`;
  }
  const cr = n / 10_000_000;
  return `${cr % 1 === 0 ? cr.toFixed(0) : cr.toFixed(2)} crore`;
}
