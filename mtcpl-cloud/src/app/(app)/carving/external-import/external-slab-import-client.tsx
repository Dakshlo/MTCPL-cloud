"use client";

/**
 * External cut-slab import — client flow (Mig 155, Daksh June 2026).
 *
 * Mirrors the Required Sizes import (download template → fill → upload →
 * review/edit → send for approval) but for slabs cut OUTSIDE our pipeline.
 * Differences:
 *   • A mandatory Stock Location per row (where the slab physically sits).
 *   • A "Send straight to dispatch" toggle — when on, the approver pushes
 *     the slabs onto Dispatch → Make Dispatch (ready-to-dispatch) instead
 *     of into carving's Unassigned tab.
 *
 * Slabs are NOT created here. submitExternalSlabImportBatchAction stores
 * the reviewed rows + the uploaded Excel as a PENDING batch; the slabs
 * appear only after owner / senior incharge / carving head approves it
 * from Slab Import Approvals (shown there as "External slab add").
 */

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { submitExternalSlabImportBatchAction } from "../../slabs/actions";
import { FinanceLoadingOverlay } from "@/components/finance-loading-overlay";

export type TempleOpt = { name: string; default_stone: string | null };

type Row = {
  key: string;
  label: string;
  description: string;
  stockLocation: string;
  length: string;
  width: string;
  height: string;
  quantity: string;
  quality: string;
  priority: boolean;
};

const inp = { padding: "8px 10px", fontSize: 13, border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg)", color: "var(--text)" } as const;
const lbl = { fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" as const, letterSpacing: "0.06em" };

type RowField = "label" | "description" | "stockLocation" | "length" | "width" | "height" | "quantity";
const REQUIRED_FIELDS: { key: RowField; label: string }[] = [
  { key: "label", label: "Label" },
  { key: "description", label: "Description" },
  { key: "stockLocation", label: "Stock Location" },
  { key: "length", label: "Length" },
  { key: "width", label: "Width" },
  { key: "height", label: "Height" },
  { key: "quantity", label: "Quantity" },
];
function rowHasContent(r: Row): boolean {
  return !!(
    r.label.trim() || r.description.trim() || r.stockLocation.trim() ||
    r.length.trim() || r.width.trim() || r.height.trim() || r.quantity.trim()
  );
}
function fieldEmpty(r: Row, field: RowField): boolean {
  if (!rowHasContent(r)) return false;
  switch (field) {
    case "label": return !r.label.trim();
    case "description": return !r.description.trim();
    case "stockLocation": return !r.stockLocation.trim();
    case "length": return !(Number(r.length) > 0);
    case "width": return !(Number(r.width) > 0);
    case "height": return !(Number(r.height) > 0);
    case "quantity": {
      const n = Number(r.quantity);
      return !r.quantity.trim() || !(n >= 1) || !Number.isInteger(n);
    }
  }
}
function rowProblems(r: Row): string[] {
  if (!rowHasContent(r)) return [];
  return REQUIRED_FIELDS.filter((f) => fieldEmpty(r, f.key)).map((f) => f.label);
}
function rowValid(r: Row): boolean {
  return rowHasContent(r) && rowProblems(r).length === 0;
}

export function ExternalSlabImportClient({ temples, stones }: { temples: TempleOpt[]; stones: string[] }) {
  const router = useRouter();
  const [temple, setTemple] = useState("");
  const [stone, setStone] = useState("");
  const [step, setStep] = useState<1 | 2>(1);
  const [rows, setRows] = useState<Row[]>([]);
  const [fileName, setFileName] = useState("");
  const [fileObj, setFileObj] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [stage, setStage] = useState<"idle" | "confirm">("idle");
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);
  // Mig 155 — when ON the approver sends these slabs straight to dispatch.
  const [toDispatch, setToDispatch] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);

  const ready = !!temple && !!stone;

  function clearTempleStone() {
    setLocked(false);
    setTemple("");
    setStone("");
  }
  function pickTemple(name: string) {
    setTemple(name);
    const def = temples.find((t) => t.name === name)?.default_stone;
    if (def && !stone) setStone(def);
  }

  // Plain template built client-side with SheetJS — temple + stone
  // pre-filled, the rest blank for the user to fill.
  function downloadTemplate() {
    const header = ["Sr.No", "Temple", "Stone", "Label", "Description", "Stock Location", "Length (in)", "Width (in)", "Height (in)", "Quantity", "Quality (A/B/Both)"];
    const sample = ["1", temple, stone, "", "", "", "", "", "", "", ""];
    const ws = XLSX.utils.aoa_to_sheet([header, sample]);
    ws["!cols"] = [{ wch: 6 }, { wch: 22 }, { wch: 14 }, { wch: 18 }, { wch: 26 }, { wch: 18 }, { wch: 11 }, { wch: 11 }, { wch: 11 }, { wch: 9 }, { wch: 16 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "External Slabs");
    XLSX.writeFile(wb, `external-slabs-${temple || "template"}.xlsx`);
    setLocked(true);
  }

  async function onFile(file: File) {
    setError("");
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      if (!ws) { setError("That file has no sheets."); return; }
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false }) as unknown[][];
      const parsed: Row[] = [];
      for (let i = 1; i < aoa.length; i++) {
        const r = (aoa[i] ?? []) as unknown[];
        const cell = (idx: number) => String(r[idx] ?? "").trim();
        // Columns: Sr.No(0) Temple(1) Stone(2) Label(3) Description(4)
        // StockLocation(5) Length(6) Width(7) Height(8) Quantity(9) Quality(10).
        const label = cell(3);
        const description = cell(4);
        const stockLocation = cell(5);
        const length = cell(6);
        const width = cell(7);
        const height = cell(8);
        const quantity = cell(9);
        const qRaw = cell(10).toUpperCase().replace(/GRADE/g, "").trim();
        const quality = qRaw === "A" ? "A" : qRaw === "B" ? "B" : "";
        if (!label && !description && !stockLocation && !length && !width && !height && !quantity) continue;
        parsed.push({ key: crypto.randomUUID(), label, description, stockLocation, length, width, height, quantity, quality, priority: false });
      }
      if (parsed.length === 0) {
        setError("No filled rows found — add at least one row with size + quantity, then re-upload.");
        return;
      }
      setRows(parsed);
      setFileName(file.name);
      setFileObj(file);
      setLocked(true);
      setStep(2);
    } catch {
      setError("Couldn't read that file. Make sure it's the .xlsx template you downloaded.");
    }
  }

  function patch(key: string, field: keyof Row, value: string | boolean) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  }
  function removeRow(key: string) {
    setRows((prev) => prev.filter((r) => r.key !== key));
  }
  function addRow() {
    setRows((prev) => [...prev, { key: crypto.randomUUID(), label: "", description: "", stockLocation: "", length: "", width: "", height: "", quantity: "", quality: "", priority: false }]);
  }

  const validRows = useMemo(() => rows.filter(rowValid), [rows]);
  const issues = useMemo(
    () => rows.map((r, i) => ({ i, probs: rowProblems(r) })).filter((x) => x.probs.length > 0),
    [rows],
  );
  const totalSlabs = useMemo(
    () => validRows.reduce((s, r) => s + Math.max(1, Math.floor(Number(r.quantity) || 1)), 0),
    [validRows],
  );
  const canAdd = issues.length === 0 && totalSlabs > 0;

  async function doImport() {
    if (submittingRef.current) return;
    if (!fileObj) {
      setError("The Excel file is missing — go back and re-upload it.");
      setStage("idle");
      return;
    }
    submittingRef.current = true;
    setBusy(true);
    setError("");
    const fd = new FormData();
    fd.set("temple", temple);
    fd.set("stone", stone);
    fd.set("to_dispatch", toDispatch ? "true" : "false");
    fd.set("file", fileObj);
    fd.set(
      "rows",
      JSON.stringify(
        rows.map((r) => ({
          label: r.label,
          description: r.description,
          stockLocation: r.stockLocation,
          length: Number(r.length) || 0,
          width: Number(r.width) || 0,
          height: Number(r.height) || 0,
          quantity: Number(r.quantity) || 1,
          quality: r.quality,
          priority: r.priority,
        })),
      ),
    );
    const res = await submitExternalSlabImportBatchAction(fd);
    if (res.ok) {
      router.push(
        `/carving?toast=${encodeURIComponent(
          `External slab batch sent for approval — ${res.slabCount} slab${res.slabCount === 1 ? "" : "s"} will appear once approved`,
        )}`,
      );
    } else {
      submittingRef.current = false;
      setBusy(false);
      setError(res.error);
      setStage("idle");
    }
  }

  const card = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 18 } as const;

  // ── Step 1 — temple + stone + template + upload ──
  if (step === 1) {
    return (
      <section style={{ ...card, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={lbl}>1. Temple {locked && "🔒"}</span>
            <select value={temple} disabled={locked} onChange={(e) => pickTemple(e.target.value)} style={{ ...inp, fontWeight: 700, ...(locked ? { background: "var(--surface-alt)", color: "var(--muted)", cursor: "not-allowed" } : {}) }}>
              <option value="">Select temple…</option>
              {temples.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={lbl}>2. Stone (applies to all) {locked && "🔒"}</span>
            <select value={stone} disabled={locked} onChange={(e) => setStone(e.target.value)} style={{ ...inp, fontWeight: 700, ...(locked ? { background: "var(--surface-alt)", color: "var(--muted)", cursor: "not-allowed" } : {}) }}>
              <option value="">Select stone…</option>
              {stones.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </div>

        {locked && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5, color: "var(--muted)", flexWrap: "wrap" }}>
            🔒 Temple &amp; stone are locked to match your downloaded file.
            <button type="button" onClick={clearTempleStone} style={{ fontSize: 12.5, fontWeight: 800, color: "#991b1b", background: "rgba(220,38,38,0.07)", border: "1px solid rgba(220,38,38,0.3)", borderRadius: 8, padding: "5px 12px", cursor: "pointer" }}>
              ✕ Clear &amp; change
            </button>
          </div>
        )}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <button type="button" disabled={!ready} onClick={downloadTemplate} style={{ padding: "11px 18px", fontSize: 14, fontWeight: 800, color: "#fff", background: ready ? "var(--gold-dark)" : "var(--border)", border: "none", borderRadius: 8, cursor: ready ? "pointer" : "not-allowed" }}>
            ⬇ Download Excel template
          </button>
          <button type="button" disabled={!ready} onClick={() => fileRef.current?.click()} style={{ padding: "11px 18px", fontSize: 14, fontWeight: 800, color: ready ? "var(--gold-dark)" : "var(--muted)", background: "transparent", border: `1.5px solid ${ready ? "var(--gold-dark)" : "var(--border)"}`, borderRadius: 8, cursor: ready ? "pointer" : "not-allowed" }}>
            ⬆ Upload filled file
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
        </div>

        {!ready && <div style={{ fontSize: 12, color: "var(--muted)" }}>Pick a temple and stone first — the template comes with both pre-filled.</div>}
        <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.6, background: "var(--surface-alt)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 14px" }}>
          <strong>Columns:</strong> Sr.No · Temple (filled) · Stone (filled) · Label · Description · <strong>Stock Location</strong> · Length · Width · Height · Quantity · Quality (A/B/Both — blank = Both).{" "}
          These are slabs cut <strong>outside</strong> our pipeline. Sizes are in <strong>inches</strong>; one row with quantity N becomes N slabs.{" "}
          After approval they land in <strong>Unassigned</strong> (ready to assign to CNC / outsource / direct dispatch) — or, if you tick <strong>Send straight to dispatch</strong> in the review step, straight onto Dispatch.
        </div>
        {error && <div style={{ fontSize: 13, fontWeight: 700, color: "#991b1b" }}>{error}</div>}
      </section>
    );
  }

  // ── Step 2 — review + edit ──
  const th = { fontSize: 10, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: "0.05em", color: "var(--muted)", textAlign: "left" as const, padding: "6px 8px", whiteSpace: "nowrap" as const };
  const td = { padding: "4px 6px", verticalAlign: "top" as const };
  const cellInp = { ...inp, width: "100%", padding: "6px 8px", fontSize: 12.5 } as const;

  return (
    <>
      <FinanceLoadingOverlay show={busy} label="Sending for approval…" />

      {issues.length > 0 && (
        <div style={{ background: "rgba(220,38,38,0.06)", border: "1px solid rgba(220,38,38,0.35)", borderRadius: 12, padding: "12px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#991b1b" }}>
            ⚠ {issues.length} row{issues.length === 1 ? "" : "s"} {issues.length === 1 ? "is" : "are"} incomplete — every field is required. Fix to continue:
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: "#7f1d1d", lineHeight: 1.6 }}>
            {issues.slice(0, 25).map((x) => (
              <li key={x.i}><strong>Row {x.i + 1}</strong>: {x.probs.join(", ")} {x.probs.length === 1 ? "is" : "are"} empty/invalid</li>
            ))}
          </ul>
          {issues.length > 25 && <div style={{ fontSize: 12, color: "#7f1d1d" }}>…and {issues.length - 25} more.</div>}
        </div>
      )}

      <section style={{ ...card, padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800 }}>Review — {temple} · {stone}</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
              {fileName ? `${fileName} · ` : ""}{validRows.length} ready row{validRows.length === 1 ? "" : "s"} → <strong>{totalSlabs} slab{totalSlabs === 1 ? "" : "s"}</strong>
              {issues.length > 0 && <span style={{ color: "#991b1b", fontWeight: 700 }}> · {issues.length} incomplete (see above)</span>}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" onClick={() => { setStep(1); setRows([]); setError(""); }} style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", background: "none", border: "1px solid var(--border)", borderRadius: 8, padding: "7px 12px", cursor: "pointer" }}>← Upload a different file</button>
          </div>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1100 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                <th style={{ ...th, width: 36 }}>#</th>
                <th style={{ ...th, minWidth: 150 }}>Label</th>
                <th style={{ ...th, minWidth: 190 }}>Description</th>
                <th style={{ ...th, minWidth: 160 }}>Stock Location</th>
                <th style={{ ...th, width: 80 }}>Len (in)</th>
                <th style={{ ...th, width: 80 }}>Wid (in)</th>
                <th style={{ ...th, width: 80 }}>Hgt (in)</th>
                <th style={{ ...th, width: 64 }}>Qty</th>
                <th style={{ ...th, minWidth: 120 }}>Quality</th>
                <th style={{ ...th, width: 60 }}>⚡</th>
                <th style={{ ...th, width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const bad = rowHasContent(r) && !rowValid(r);
                const cell = (f: RowField) => ({ ...cellInp, borderColor: fieldEmpty(r, f) ? "#dc2626" : "var(--border)" });
                return (
                  <tr key={r.key} style={{ borderBottom: "1px solid var(--border)", background: bad ? "rgba(220,38,38,0.05)" : undefined }}>
                    <td style={{ ...td, color: "var(--muted)", fontSize: 12, fontFamily: "ui-monospace, monospace" }}>{i + 1}</td>
                    <td style={td}><input value={r.label} onChange={(e) => patch(r.key, "label", e.target.value)} placeholder="required" style={{ ...cell("label"), textTransform: "uppercase" }} /></td>
                    <td style={td}><input value={r.description} onChange={(e) => patch(r.key, "description", e.target.value)} placeholder="required" style={cell("description")} /></td>
                    <td style={td}><input value={r.stockLocation} onChange={(e) => patch(r.key, "stockLocation", e.target.value)} placeholder="required" style={cell("stockLocation")} /></td>
                    <td style={td}><input value={r.length} onChange={(e) => patch(r.key, "length", e.target.value)} inputMode="decimal" placeholder="req" style={cell("length")} /></td>
                    <td style={td}><input value={r.width} onChange={(e) => patch(r.key, "width", e.target.value)} inputMode="decimal" placeholder="req" style={cell("width")} /></td>
                    <td style={td}><input value={r.height} onChange={(e) => patch(r.key, "height", e.target.value)} inputMode="decimal" placeholder="req" style={cell("height")} /></td>
                    <td style={td}><input value={r.quantity} onChange={(e) => patch(r.key, "quantity", e.target.value)} inputMode="numeric" placeholder="req" style={cell("quantity")} /></td>
                    <td style={td}>
                      <select value={r.quality} onChange={(e) => patch(r.key, "quality", e.target.value)} style={cellInp}>
                        <option value="">Both</option>
                        <option value="A">Grade A</option>
                        <option value="B">Grade B</option>
                      </select>
                    </td>
                    <td style={{ ...td, textAlign: "center" }}><input type="checkbox" checked={r.priority} onChange={(e) => patch(r.key, "priority", e.target.checked)} style={{ cursor: "pointer", width: 16, height: 16 }} /></td>
                    <td style={{ ...td, textAlign: "center" }}><button type="button" onClick={() => removeRow(r.key)} title="Remove row" style={{ fontSize: 14, color: "#991b1b", background: "none", border: "none", cursor: "pointer" }}>✕</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={{ padding: "10px 18px", borderTop: "1px solid var(--border)" }}>
          <button type="button" onClick={addRow} style={{ fontSize: 12, fontWeight: 700, color: "var(--gold-dark)", background: "none", border: "none", cursor: "pointer" }}>+ Add a row</button>
        </div>
      </section>

      {/* Direct-to-dispatch toggle */}
      <label style={{ display: "flex", alignItems: "flex-start", gap: 10, background: toDispatch ? "rgba(22,163,74,0.08)" : "var(--surface)", border: `1.5px solid ${toDispatch ? "rgba(22,163,74,0.45)" : "var(--border)"}`, borderRadius: 12, padding: "12px 16px", cursor: "pointer" }}>
        <input type="checkbox" checked={toDispatch} onChange={(e) => setToDispatch(e.target.checked)} style={{ width: 18, height: 18, marginTop: 1, cursor: "pointer" }} />
        <span style={{ fontSize: 13, lineHeight: 1.5 }}>
          <strong>🚚 Send straight to dispatch</strong> on approval — skip carving entirely. The slabs go directly to <strong>Dispatch → Make Dispatch</strong> (ready to load), so the dispatch incharge can pick them right away.
          <span style={{ display: "block", color: "var(--muted)", marginTop: 2 }}>Leave off to drop them into carving&apos;s <strong>Unassigned</strong> tab (assign to CNC / outsource / direct dispatch later).</span>
        </span>
      </label>

      {error && <div style={{ fontSize: 13, fontWeight: 700, color: "#991b1b" }}>{error}</div>}

      <div style={{ position: "sticky", bottom: 0, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 18px", boxShadow: "0 -2px 10px rgba(0,0,0,0.05)" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: canAdd ? "var(--text)" : "var(--muted)" }}>
          {issues.length > 0
            ? `Fix ${issues.length} incomplete row${issues.length === 1 ? "" : "s"} before sending`
            : totalSlabs > 0
              ? `Ready to send ${totalSlabs} external slab${totalSlabs === 1 ? "" : "s"} for approval (${temple})`
              : "Fill in at least one row"}
        </div>
        <button type="button" disabled={!canAdd} onClick={() => { setError(""); setStage("confirm"); }} style={{ padding: "11px 24px", fontSize: 14, fontWeight: 800, color: "#fff", background: canAdd ? "var(--gold-dark)" : "var(--border)", border: "none", borderRadius: 8, cursor: canAdd ? "pointer" : "not-allowed" }}>
          Send {totalSlabs} slab{totalSlabs === 1 ? "" : "s"} for approval
        </button>
      </div>

      {stage !== "idle" && (
        <div onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) setStage("idle"); }} style={{ position: "fixed", inset: 0, left: "var(--content-left)", background: "rgba(15,12,6,0.55)", backdropFilter: "blur(2px)", zIndex: 1200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div role="dialog" aria-modal="true" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, boxShadow: "0 18px 60px rgba(0,0,0,0.45)", width: "100%", maxWidth: 460, padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ fontSize: 17, fontWeight: 800 }}>Send {totalSlabs} external slab{totalSlabs === 1 ? "" : "s"} for approval?</div>
            <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
              {validRows.length} row{validRows.length === 1 ? "" : "s"} → <strong>{totalSlabs}</strong> slab{totalSlabs === 1 ? "" : "s"} into <strong>{temple}</strong> ({stone}).
              {" "}The batch goes to <strong>owner / senior incharge / carving head</strong> for approval (shown as <strong>External slab add</strong>).
              {" "}On approval they land {toDispatch ? <strong>straight on Dispatch → Make Dispatch</strong> : <>in carving&apos;s <strong>Unassigned</strong> tab</>}.
              {" "}Your Excel file is kept on record.
            </div>
            {error && <div style={{ fontSize: 13, fontWeight: 700, color: "#991b1b" }}>{error}</div>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" disabled={busy} onClick={() => setStage("idle")} className="ghost-button">Cancel</button>
              <button type="button" disabled={busy} onClick={doImport} style={{ padding: "9px 18px", fontSize: 14, fontWeight: 800, color: "#fff", background: busy ? "var(--border)" : "#15803d", border: "none", borderRadius: 8, cursor: busy ? "not-allowed" : "pointer" }}>{busy ? "Sending…" : `✓ Send ${totalSlabs} for approval`}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
