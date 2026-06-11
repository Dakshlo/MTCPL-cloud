"use client";

// ──────────────────────────────────────────────────────────────────
// Multi-bill scan + review (Daksh, June 2026)
//
// Upload up to 8 bill photos/PDFs at once → each is read by the SAME
// read-only AI scan endpoint used on the single Add-Bill page
// (/api/accounts/bill-scan — never writes to the DB) → the user
// reviews every bill ONE BY ONE in an editable preview and adds the
// ones they're happy with.
//
// IMPORTANT — touches no other real data:
//   • Scanning is read-only (the scan route only reads the image).
//   • Each "Add this bill" goes through the EXISTING submitBillAction,
//     exactly like the single form — same validation, same token,
//     same audit + owner notification. No new write path is created.
//   • Nothing is saved until the user clicks Add on that specific bill.
// ──────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FinanceLoadingOverlay } from "@/components/finance-loading-overlay";
import { ACCOUNTS_TOKENS, INPUT_STYLE, BUTTON_STYLES } from "../../_ui/components";
import { VendorPicker } from "../new/vendor-picker";
import type { BillVendorOption } from "../new/bill-entry-form";

const MAX_FILES = 8;
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB — same as the scan route
const SCAN_CONCURRENCY = 3; // how many bills the AI reads at once
const ACCEPTED = ".jpg,.jpeg,.png,.webp,.gif,.pdf,application/pdf,image/*";

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

type SubmitResult =
  | { ok: true; billId: string; token: string }
  | { ok: false; error: string; errorCode?: "DUPLICATE_BILL" };

type ScanStatus = "queued" | "scanning" | "scanned" | "scan_error";
type SubmitStatus = "idle" | "submitting" | "added" | "error" | "duplicate";

type Slot = {
  uid: string;
  file: File;
  previewUrl: string;
  isPdf: boolean;
  scanStatus: ScanStatus;
  scanError: string | null;
  confidence: string | null;
  notes: string[];
  // editable fields (pre-filled by the scan, freely editable)
  vendorId: string;
  billDate: string;
  vendorBillNo: string;
  description: string;
  subtotal: string;
  gstMode: "intra" | "inter";
  cgstPercent: string;
  sgstPercent: string;
  igstPercent: string;
  // TDS/TCS are vendor-driven (the scan can't read them). "" = field hidden
  // (vendor not TDS/TCS-applicable); "0" or a number = field shown & editable.
  tdsPercent: string;
  tcsPercent: string;
  // submit state
  submitStatus: SubmitStatus;
  submitError: string | null;
  token?: string;
};

// TDS/TCS defaults for a vendor: show the field (pre-filled with the
// vendor's default, or "0") when the vendor is TDS/TCS-applicable; hide
// it ("") otherwise. Mirrors the single Add-Bill form.
function tdsForVendor(v: BillVendorOption | null | undefined): string {
  return v?.tds_applicable ? String(v.default_tds_percent ?? 0) : "";
}
function tcsForVendor(v: BillVendorOption | null | undefined): string {
  return v?.tcs_applicable ? String(v.default_tcs_percent ?? 0) : "";
}

const todayIso = () => {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
};

let uidCounter = 0;
const nextUid = () => `slot_${Date.now().toString(36)}_${uidCounter++}`;

// Vendor match: exact GSTIN first (most reliable), then a unique name hit.
function matchVendor(vendors: BillVendorOption[], d: ScanData): BillVendorOption | null {
  const normGst = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, "").toUpperCase();
  const normName = (s: string | null | undefined) => (s ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (d.vendor_gstin) {
    const g = vendors.find((v) => normGst(v.gstin) === normGst(d.vendor_gstin) && normGst(v.gstin) !== "");
    if (g) return g;
  }
  if (d.vendor_name) {
    const target = normName(d.vendor_name);
    if (target.length >= 4) {
      const hits = vendors.filter((v) => {
        const n = normName(v.name);
        return n === target || n.includes(target) || target.includes(n);
      });
      if (hits.length === 1) return hits[0];
    }
  }
  return null;
}

// Map a scan result onto a slot's editable fields + warning notes.
// Mirrors applyScan() in bill-entry-form.tsx so both flows behave the same.
function applyScanToSlot(slot: Slot, d: ScanData, vendors: BillVendorOption[]): Slot {
  const notes: string[] = [];
  const matched = matchVendor(vendors, d);
  if (matched) {
    notes.push(`Vendor matched: ${matched.name}`);
  } else {
    notes.push(
      d.vendor_name
        ? `Vendor "${d.vendor_name}" not found — pick it manually.`
        : "Couldn't read the vendor — pick it manually.",
    );
  }

  const igst = Number(d.igst_percent ?? 0);
  const cgst = Number(d.cgst_percent ?? 0);
  const sgst = Number(d.sgst_percent ?? 0);
  let gstMode: "intra" | "inter" = "intra";
  let cgstP = "0";
  let sgstP = "0";
  let igstP = "0";
  if (igst > 0) {
    gstMode = "inter";
    igstP = String(igst);
  } else if (cgst > 0 || sgst > 0) {
    gstMode = "intra";
    cgstP = String(cgst > 0 ? cgst : sgst);
    sgstP = String(sgst > 0 ? sgst : cgst);
  }

  // Math check: subtotal + read GST should equal the printed total.
  if (d.subtotal != null && d.total != null && d.subtotal > 0 && d.total > 0) {
    const rate = igst > 0 ? igst : cgst + sgst;
    const expected = d.subtotal * (1 + rate / 100);
    if (Math.abs(expected - d.total) > 1.5) {
      notes.push(
        `⚠ Check amounts — subtotal + GST (₹${Math.round(expected).toLocaleString("en-IN")}) ≠ printed total (₹${Math.round(d.total).toLocaleString("en-IN")}).`,
      );
    }
  }
  if (d.confidence === "low") {
    notes.push("⚠ Hard to read — double-check every field.");
  } else if (d.confidence === "medium") {
    notes.push("⚠ Handwritten / medium confidence — verify the bill number and amounts digit by digit.");
  }

  if (matched && (matched.tds_applicable || matched.tcs_applicable)) {
    notes.push("TDS/TCS field shown for this vendor — verify the % before adding.");
  }

  return {
    ...slot,
    scanStatus: "scanned",
    scanError: null,
    confidence: d.confidence ?? null,
    notes,
    vendorId: matched?.id ?? "",
    tdsPercent: tdsForVendor(matched),
    tcsPercent: tcsForVendor(matched),
    billDate: d.bill_date && /^\d{4}-\d{2}-\d{2}$/.test(d.bill_date) ? d.bill_date : slot.billDate,
    vendorBillNo: d.bill_no ? String(d.bill_no) : "",
    description: d.description ? String(d.description) : "",
    subtotal: d.subtotal != null && d.subtotal > 0 ? String(d.subtotal) : "",
    gstMode,
    cgstPercent: cgstP,
    sgstPercent: sgstP,
    igstPercent: igstP,
  };
}

export function MultiBillScanner({
  vendors,
  submitAction,
}: {
  vendors: BillVendorOption[];
  submitAction: (formData: FormData) => Promise<SubmitResult>;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<"upload" | "review">("upload");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [current, setCurrent] = useState(0);
  const [pickError, setPickError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Revoke object URLs on unmount to avoid leaks.
  const slotsRef = useRef<Slot[]>([]);
  slotsRef.current = slots;
  useEffect(() => {
    return () => {
      for (const s of slotsRef.current) {
        if (s.previewUrl) URL.revokeObjectURL(s.previewUrl);
      }
    };
  }, []);

  function updateSlot(uid: string, patch: Partial<Slot>) {
    setSlots((prev) => prev.map((s) => (s.uid === uid ? { ...s, ...patch } : s)));
  }

  // Changing the vendor re-applies that vendor's TDS/TCS defaults so the
  // field appears (set to the vendor rate, or 0) even when the scan
  // couldn't read it.
  function setSlotVendor(uid: string, vendorId: string) {
    const v = vendors.find((x) => x.id === vendorId) ?? null;
    updateSlot(uid, { vendorId, tdsPercent: tdsForVendor(v), tcsPercent: tcsForVendor(v) });
  }

  function handleFiles(fileList: FileList | null) {
    setPickError(null);
    if (!fileList || fileList.length === 0) return;
    const picked = Array.from(fileList);
    if (picked.length > MAX_FILES) {
      setPickError(`You can upload up to ${MAX_FILES} bills at once. The first ${MAX_FILES} were taken.`);
    }
    const accepted: Slot[] = [];
    for (const file of picked.slice(0, MAX_FILES)) {
      const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
      const isImage = file.type.startsWith("image/") || /\.(jpe?g|png|webp|gif)$/i.test(file.name);
      if (!isPdf && !isImage) continue;
      if (file.size === 0 || file.size > MAX_BYTES) continue;
      accepted.push({
        uid: nextUid(),
        file,
        previewUrl: URL.createObjectURL(file),
        isPdf,
        scanStatus: "queued",
        scanError: null,
        confidence: null,
        notes: [],
        vendorId: "",
        billDate: todayIso(),
        vendorBillNo: "",
        description: "",
        subtotal: "",
        gstMode: "intra",
        cgstPercent: "0",
        sgstPercent: "0",
        igstPercent: "0",
        tdsPercent: "",
        tcsPercent: "",
        submitStatus: "idle",
        submitError: null,
      });
    }
    if (accepted.length === 0) {
      setPickError("No usable files — upload JPG/PNG photos or PDFs, each under 10 MB.");
      return;
    }
    setSlots(accepted);
  }

  // ── Scan all uploaded bills (read-only), limited concurrency ──
  async function startAnalysis() {
    setPhase("review");
    setCurrent(0);
    const queue = [...slots];
    let i = 0;
    async function worker() {
      while (i < queue.length) {
        const slot = queue[i++];
        updateSlot(slot.uid, { scanStatus: "scanning", scanError: null });
        try {
          const fd = new FormData();
          fd.set("file", slot.file);
          const res = await fetch("/api/accounts/bill-scan", { method: "POST", body: fd });
          const json = (await res.json()) as { ok: boolean; data?: ScanData; error?: string };
          if (!json.ok || !json.data) {
            updateSlot(slot.uid, {
              scanStatus: "scan_error",
              scanError: json.error ?? "Couldn't read this bill — fill it in manually.",
            });
          } else {
            setSlots((prev) =>
              prev.map((s) => (s.uid === slot.uid ? applyScanToSlot(s, json.data!, vendors) : s)),
            );
          }
        } catch {
          updateSlot(slot.uid, {
            scanStatus: "scan_error",
            scanError: "Scan failed — check your connection, or fill it in manually.",
          });
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(SCAN_CONCURRENCY, queue.length) }, worker));
  }

  function validateSlot(s: Slot): string | null {
    if (!s.vendorId) return "Pick a beneficiary.";
    if (!s.vendorBillNo.trim()) return "Vendor's bill number is required.";
    if (!s.billDate) return "Bill date is required.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.billDate)) return "Bill date must use a 4-digit year (YYYY-MM-DD).";
    const y = parseInt(s.billDate.slice(0, 4), 10);
    const maxY = new Date().getFullYear() + 1;
    if (y < 2015 || y > maxY) return `Bill date year ${y} looks wrong — use 2015–${maxY}.`;
    if (!s.description.trim()) return "Description is required.";
    const sub = Number(s.subtotal) || 0;
    if (!Number.isFinite(sub) || sub <= 0) return "Subtotal must be greater than zero.";
    const cgst = s.gstMode === "intra" ? Number(s.cgstPercent) || 0 : 0;
    const sgst = s.gstMode === "intra" ? Number(s.sgstPercent) || 0 : 0;
    const igst = s.gstMode === "inter" ? Number(s.igstPercent) || 0 : 0;
    const gst = cgst + sgst + igst;
    if (gst < 0 || gst > 100) return "Total GST must be between 0 and 100.";
    return null;
  }

  async function addSlot(s: Slot) {
    const err = validateSlot(s);
    if (err) {
      updateSlot(s.uid, { submitStatus: "error", submitError: err });
      return;
    }
    updateSlot(s.uid, { submitStatus: "submitting", submitError: null });

    const vendor = vendors.find((v) => v.id === s.vendorId) ?? null;
    const cgst = s.gstMode === "intra" ? Number(s.cgstPercent) || 0 : 0;
    const sgst = s.gstMode === "intra" ? Number(s.sgstPercent) || 0 : 0;
    const igst = s.gstMode === "inter" ? Number(s.igstPercent) || 0 : 0;
    // TDS/TCS come from the (editable) field when the vendor is
    // TDS/TCS-applicable; otherwise 0. The field defaults to the vendor's
    // rate even when the scan couldn't read it, so it's never silently skipped.
    const tds = vendor?.tds_applicable ? Number(s.tdsPercent) || 0 : 0;
    const tcs = vendor?.tcs_applicable ? Number(s.tcsPercent) || 0 : 0;

    const fd = new FormData();
    fd.set("bill_vendor_id", s.vendorId);
    fd.set("vendor_bill_no", s.vendorBillNo.trim());
    fd.set("bill_date", s.billDate);
    fd.set("description", s.description.trim());
    fd.set("cost_head", "");
    fd.set("amount_subtotal", String(Number(s.subtotal) || 0));
    fd.set("cgst_percent", String(cgst));
    fd.set("sgst_percent", String(sgst));
    fd.set("igst_percent", String(igst));
    fd.set("gst_percent", String(cgst + sgst + igst));
    fd.set("tds_percent", String(tds));
    fd.set("tcs_percent", String(tcs));
    fd.set("block_cft", "");
    fd.set("bill_document", s.file);

    try {
      const result = await submitAction(fd);
      if (result.ok) {
        // Stay on this bill and show the blinking token — the user notes it
        // on the physical bill, then moves to the next one themselves.
        updateSlot(s.uid, { submitStatus: "added", submitError: null, token: result.token });
      } else if (result.errorCode === "DUPLICATE_BILL") {
        updateSlot(s.uid, {
          submitStatus: "duplicate",
          submitError: "This vendor + bill number already exists for this financial year.",
        });
      } else {
        updateSlot(s.uid, { submitStatus: "error", submitError: result.error });
      }
    } catch {
      updateSlot(s.uid, { submitStatus: "error", submitError: "Something went wrong saving this bill." });
    }
  }

  function goToNextPending(fromUid: string) {
    const list = slotsRef.current;
    const fromIdx = list.findIndex((s) => s.uid === fromUid);
    const isPending = (s: Slot) => s.submitStatus === "idle" || s.submitStatus === "error" || s.submitStatus === "duplicate";
    for (let k = fromIdx + 1; k < list.length; k++) {
      if (isPending(list[k])) {
        setCurrent(k);
        return;
      }
    }
    for (let k = 0; k < list.length; k++) {
      if (isPending(list[k])) {
        setCurrent(k);
        return;
      }
    }
    // none left — stay on the last; the summary banner will show.
  }

  function reset() {
    for (const s of slots) if (s.previewUrl) URL.revokeObjectURL(s.previewUrl);
    setSlots([]);
    setCurrent(0);
    setPhase("upload");
    setPickError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // ── UPLOAD PHASE ──
  if (phase === "upload") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 720 }}>
        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            handleFiles(e.dataTransfer.files);
          }}
          style={{
            border: `2px dashed ${ACCOUNTS_TOKENS.accentBorder}`,
            background: ACCOUNTS_TOKENS.accentLight,
            borderRadius: 14,
            padding: "32px 24px",
            textAlign: "center",
            cursor: "pointer",
          }}
        >
          <div style={{ fontSize: 34, marginBottom: 6 }}>📑</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: ACCOUNTS_TOKENS.accent }}>
            Upload up to {MAX_FILES} bills
          </div>
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 4 }}>
            Click to choose, or drag & drop photos / PDFs here. Each under 10 MB.
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED}
            multiple
            style={{ display: "none" }}
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>

        {pickError && (
          <div style={{ fontSize: 12.5, color: "#b45309", fontWeight: 600 }}>⚠ {pickError}</div>
        )}

        {slots.length > 0 && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
              {slots.map((s, i) => (
                <div
                  key={s.uid}
                  style={{
                    border: `1px solid ${ACCOUNTS_TOKENS.border}`,
                    borderRadius: 10,
                    overflow: "hidden",
                    background: "var(--surface)",
                  }}
                >
                  <div style={{ height: 90, background: "#0f172a", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {s.isPdf ? (
                      <span style={{ fontSize: 30 }}>📄</span>
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={s.previewUrl} alt="" style={{ maxHeight: "100%", maxWidth: "100%", objectFit: "contain" }} />
                    )}
                  </div>
                  <div style={{ padding: "6px 8px", fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {i + 1}. {s.file.name}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button type="button" onClick={startAnalysis} style={{ ...BUTTON_STYLES.primary, fontSize: 14 }}>
                🔍 Analyse {slots.length} bill{slots.length > 1 ? "s" : ""}
              </button>
              <button type="button" onClick={reset} style={BUTTON_STYLES.secondary}>
                Clear
              </button>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>
                Reading the bills costs a little — nothing is saved until you review and add each one.
              </span>
            </div>
          </>
        )}
      </div>
    );
  }

  // ── REVIEW PHASE ──
  const addedCount = slots.filter((s) => s.submitStatus === "added").length;
  const allDecided = slots.every((s) => s.submitStatus === "added");
  const slot = slots[current];

  const hasNextPending = slots.some((s, i) => i !== current && (s.submitStatus === "idle" || s.submitStatus === "error" || s.submitStatus === "duplicate"));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Branded MTCPL overlay while this bill submits — same as single Add Bill. */}
      <FinanceLoadingOverlay show={slot?.submitStatus === "submitting"} label="Submitting for audit…" />

      {/* progress strip */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {slots.map((s, i) => {
          const active = i === current;
          const { bg, fg, icon } = chipStyle(s);
          return (
            <button
              key={s.uid}
              type="button"
              onClick={() => setCurrent(i)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "5px 11px",
                borderRadius: 999,
                border: active ? `2px solid ${ACCOUNTS_TOKENS.accent}` : `1px solid ${ACCOUNTS_TOKENS.border}`,
                background: bg,
                color: fg,
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {icon} Bill {i + 1}
            </button>
          );
        })}
        <span style={{ marginLeft: "auto", fontSize: 12.5, color: "var(--muted)", fontWeight: 600 }}>
          {addedCount} of {slots.length} added
        </span>
      </div>

      {allDecided && (
        <div
          style={{
            background: "#ecfdf5",
            border: "1px solid #a7f3d0",
            borderRadius: 12,
            padding: "14px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 700, color: "#047857" }}>
            ✅ All {slots.length} bills added. Each went through the normal audit flow.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Link href="/accounts/bills" style={BUTTON_STYLES.primary}>
              View all bills
            </Link>
            <button type="button" onClick={reset} style={BUTTON_STYLES.secondary}>
              Scan more
            </button>
          </div>
        </div>
      )}

      {slot && (
        <BillReviewCard
          key={slot.uid}
          slot={slot}
          index={current}
          total={slots.length}
          vendors={vendors}
          onPatch={(patch) => updateSlot(slot.uid, patch)}
          onVendorChange={(id) => setSlotVendor(slot.uid, id)}
          onAdd={() => addSlot(slot)}
          onPrev={current > 0 ? () => setCurrent(current - 1) : undefined}
          onNext={current < slots.length - 1 ? () => setCurrent(current + 1) : undefined}
          onAdvance={hasNextPending ? () => goToNextPending(slot.uid) : undefined}
        />
      )}

      <div>
        <button type="button" onClick={reset} style={{ ...BUTTON_STYLES.secondary, fontSize: 12.5 }}>
          ← Start over
        </button>
      </div>
    </div>
  );
}

function chipStyle(s: Slot): { bg: string; fg: string; icon: string } {
  if (s.submitStatus === "added") return { bg: "#dcfce7", fg: "#166534", icon: "✅" };
  if (s.submitStatus === "duplicate") return { bg: "#fef9c3", fg: "#854d0e", icon: "⧉" };
  if (s.submitStatus === "error") return { bg: "#fee2e2", fg: "#991b1b", icon: "⚠" };
  if (s.scanStatus === "scanning") return { bg: "#eef2ff", fg: "#3730a3", icon: "⏳" };
  if (s.scanStatus === "scan_error") return { bg: "#fee2e2", fg: "#991b1b", icon: "⚠" };
  if (s.scanStatus === "queued") return { bg: "#f1f5f9", fg: "#475569", icon: "…" };
  return { bg: "var(--surface)", fg: "var(--text)", icon: "📄" };
}

// ── Per-bill editable preview ──
function BillReviewCard({
  slot,
  index,
  total,
  vendors,
  onPatch,
  onVendorChange,
  onAdd,
  onPrev,
  onNext,
  onAdvance,
}: {
  slot: Slot;
  index: number;
  total: number;
  vendors: BillVendorOption[];
  onPatch: (patch: Partial<Slot>) => void;
  onVendorChange: (id: string) => void;
  onAdd: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onAdvance?: () => void;
}) {
  const sub = Number(slot.subtotal) || 0;
  const cgst = slot.gstMode === "intra" ? Number(slot.cgstPercent) || 0 : 0;
  const sgst = slot.gstMode === "intra" ? Number(slot.sgstPercent) || 0 : 0;
  const igst = slot.gstMode === "inter" ? Number(slot.igstPercent) || 0 : 0;
  const gstAmt = Math.round(sub * (cgst + sgst + igst)) / 100;
  const total$ = Math.round((sub + gstAmt) * 100) / 100;
  const scanning = slot.scanStatus === "scanning" || slot.scanStatus === "queued";
  const added = slot.submitStatus === "added";
  const busy = slot.submitStatus === "submitting";

  // TDS/TCS fields show when the selected vendor is TDS/TCS-applicable —
  // even if the scan couldn't read them (then they default to the vendor
  // rate, or 0, and stay editable).
  const selectedVendor = vendors.find((v) => v.id === slot.vendorId) ?? null;
  const showTds = !!selectedVendor?.tds_applicable;
  const showTcs = !!selectedVendor?.tcs_applicable;

  const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

  return (
    <div
      style={{
        border: `1px solid ${ACCOUNTS_TOKENS.border}`,
        borderRadius: 14,
        background: "var(--surface)",
        boxShadow: ACCOUNTS_TOKENS.shadow,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "10px 16px",
          borderBottom: `1px solid ${ACCOUNTS_TOKENS.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <div style={{ fontWeight: 800, fontSize: 15 }}>
          Bill {index + 1} of {total}
          {slot.confidence && (
            <span
              style={{
                marginLeft: 10,
                fontSize: 11,
                fontWeight: 700,
                padding: "2px 8px",
                borderRadius: 999,
                color: slot.confidence === "high" ? "#166534" : slot.confidence === "low" ? "#991b1b" : "#854d0e",
                background: slot.confidence === "high" ? "#dcfce7" : slot.confidence === "low" ? "#fee2e2" : "#fef9c3",
              }}
            >
              {slot.confidence} confidence
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" onClick={onPrev} disabled={!onPrev} style={navBtn(!onPrev)}>← Prev</button>
          <button type="button" onClick={onNext} disabled={!onNext} style={navBtn(!onNext)}>Next →</button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 300px) minmax(0, 1fr)", gap: 0 }}>
        {/* LEFT — scan preview */}
        <div style={{ borderRight: `1px solid ${ACCOUNTS_TOKENS.border}`, background: "#0f172a", minHeight: 340, display: "flex", alignItems: "center", justifyContent: "center", padding: 8 }}>
          {slot.isPdf ? (
            <iframe src={slot.previewUrl} title={`bill-${index + 1}`} style={{ width: "100%", height: 360, border: 0, background: "#fff", borderRadius: 6 }} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={slot.previewUrl} alt={`bill ${index + 1}`} style={{ maxWidth: "100%", maxHeight: 420, objectFit: "contain", borderRadius: 6 }} />
          )}
        </div>

        {/* RIGHT — editable fields */}
        <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
          {scanning ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10, color: ACCOUNTS_TOKENS.accent, fontWeight: 700, padding: "20px 0" }}>
              <span className="spin" style={{ fontSize: 18 }}>⏳</span> Reading this bill…
            </div>
          ) : (
            <>
              {slot.scanStatus === "scan_error" && (
                <div style={{ fontSize: 12.5, color: "#b45309", fontWeight: 600 }}>
                  ⚠ {slot.scanError} You can still type the details below.
                </div>
              )}
              {slot.notes.length > 0 && (
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "var(--muted)", display: "flex", flexDirection: "column", gap: 2 }}>
                  {slot.notes.map((n, i) => (
                    <li key={i} style={{ color: n.startsWith("⚠") ? "#b45309" : "var(--muted)", fontWeight: n.startsWith("⚠") ? 600 : 400 }}>{n}</li>
                  ))}
                </ul>
              )}

              <Field label="Beneficiary (vendor)">
                <VendorPicker vendors={vendors} selectedId={slot.vendorId} onChange={onVendorChange} />
              </Field>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Field label="Vendor's bill no.">
                  <input style={INPUT_STYLE} value={slot.vendorBillNo} onChange={(e) => onPatch({ vendorBillNo: e.target.value })} placeholder="e.g. 5114" />
                </Field>
                <Field label="Bill date">
                  <input type="date" style={INPUT_STYLE} value={slot.billDate} onChange={(e) => onPatch({ billDate: e.target.value })} />
                </Field>
              </div>

              <Field label="Description">
                <input style={INPUT_STYLE} value={slot.description} onChange={(e) => onPatch({ description: e.target.value })} placeholder="What was billed" />
              </Field>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Field label="Subtotal (before GST)">
                  <input type="number" inputMode="decimal" style={INPUT_STYLE} value={slot.subtotal} onChange={(e) => onPatch({ subtotal: e.target.value })} placeholder="0" />
                </Field>
                <Field label="GST type">
                  <div style={{ display: "flex", gap: 6 }}>
                    <ModeBtn active={slot.gstMode === "intra"} onClick={() => onPatch({ gstMode: "intra" })}>CGST+SGST</ModeBtn>
                    <ModeBtn active={slot.gstMode === "inter"} onClick={() => onPatch({ gstMode: "inter" })}>IGST</ModeBtn>
                  </div>
                </Field>
              </div>

              {slot.gstMode === "intra" ? (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <Field label="CGST %">
                    <input type="number" inputMode="decimal" style={INPUT_STYLE} value={slot.cgstPercent} onChange={(e) => onPatch({ cgstPercent: e.target.value })} />
                  </Field>
                  <Field label="SGST %">
                    <input type="number" inputMode="decimal" style={INPUT_STYLE} value={slot.sgstPercent} onChange={(e) => onPatch({ sgstPercent: e.target.value })} />
                  </Field>
                </div>
              ) : (
                <Field label="IGST %">
                  <input type="number" inputMode="decimal" style={INPUT_STYLE} value={slot.igstPercent} onChange={(e) => onPatch({ igstPercent: e.target.value })} />
                </Field>
              )}

              {/* TDS / TCS — shown whenever the vendor is TDS/TCS-applicable,
                  pre-filled with the vendor rate (or 0) even if the scan
                  couldn't read it, so it's never silently skipped. */}
              {(showTds || showTcs) && (
                <div style={{ display: "grid", gridTemplateColumns: showTds && showTcs ? "1fr 1fr" : "1fr", gap: 10 }}>
                  {showTds && (
                    <Field label="TDS %">
                      <input type="number" inputMode="decimal" style={INPUT_STYLE} value={slot.tdsPercent} onChange={(e) => onPatch({ tdsPercent: e.target.value })} placeholder="0" />
                    </Field>
                  )}
                  {showTcs && (
                    <Field label="TCS %">
                      <input type="number" inputMode="decimal" style={INPUT_STYLE} value={slot.tcsPercent} onChange={(e) => onPatch({ tcsPercent: e.target.value })} placeholder="0" />
                    </Field>
                  )}
                </div>
              )}

              <div style={{ fontSize: 13, color: "var(--text)", background: ACCOUNTS_TOKENS.accentLight, borderRadius: 8, padding: "8px 12px" }}>
                Subtotal <b>{inr(sub)}</b> + GST <b>{inr(gstAmt)}</b> = Total <b>{inr(total$)}</b>
              </div>

              {slot.submitError && (
                <div style={{ fontSize: 12.5, color: "#991b1b", fontWeight: 600 }}>⚠ {slot.submitError}</div>
              )}

              {added ? (
                // Stay on this bill and show the token, bold + blinking, so it
                // gets written on the physical bill before moving on.
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div
                    style={{
                      border: "2px solid #16a34a",
                      background: "#ecfdf5",
                      borderRadius: 10,
                      padding: "12px 14px",
                      textAlign: "center",
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#166534" }}>✅ Added — write this token on the bill</div>
                    <div className="token-blink" style={{ fontSize: 26, fontWeight: 900, color: "#15803d", letterSpacing: "0.04em", marginTop: 2 }}>
                      {slot.token ?? "—"}
                    </div>
                  </div>
                  {onAdvance && (
                    <button type="button" onClick={onAdvance} style={{ ...BUTTON_STYLES.primary, fontSize: 14 }}>
                      Go to next bill →
                    </button>
                  )}
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <button
                    type="button"
                    onClick={onAdd}
                    disabled={busy}
                    style={{ ...BUTTON_STYLES.primary, fontSize: 14, opacity: busy ? 0.7 : 1, cursor: busy ? "wait" : "pointer" }}
                  >
                    {busy ? "Adding…" : "✓ Add this bill"}
                  </button>
                  {onNext && (
                    <button type="button" onClick={onNext} style={{ ...BUTTON_STYLES.secondary, fontSize: 13 }}>
                      Skip for now →
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
      <style>{`.spin{display:inline-block;animation:spin 1.1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}.token-blink{animation:tokenBlink 1s steps(1,end) infinite}@keyframes tokenBlink{50%{opacity:0.25}}`}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.03em" }}>{label}</span>
      {children}
    </label>
  );
}

function ModeBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1,
        padding: "8px 6px",
        fontSize: 12,
        fontWeight: 700,
        borderRadius: 8,
        cursor: "pointer",
        border: `1px solid ${active ? ACCOUNTS_TOKENS.accent : ACCOUNTS_TOKENS.border}`,
        background: active ? ACCOUNTS_TOKENS.accent : "var(--surface)",
        color: active ? "#fff" : "var(--text)",
      }}
    >
      {children}
    </button>
  );
}

function navBtn(disabled: boolean): React.CSSProperties {
  return {
    padding: "5px 12px",
    fontSize: 12.5,
    fontWeight: 700,
    borderRadius: 8,
    border: `1px solid ${ACCOUNTS_TOKENS.border}`,
    background: "var(--surface)",
    color: disabled ? "var(--muted)" : "var(--text)",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
  };
}
