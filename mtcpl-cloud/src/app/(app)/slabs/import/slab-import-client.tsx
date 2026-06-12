"use client";

/**
 * Bulk slab import — client flow (Daksh June 2026).
 *
 * Step 1: pick temple + stone → download an .xlsx template (those two
 *         columns pre-filled) → fill label/description/size/quantity →
 *         upload it back. Parsing happens here with SheetJS.
 * Step 2: review + edit every row (fix anything, set quality, drop
 *         rows) → "Send N slabs for approval" → confirm.
 *
 * Mig 122 — the commit no longer inserts slabs. It calls
 * submitSlabImportBatchAction, which stores the reviewed rows + the
 * uploaded Excel (audit copy) as a PENDING batch. Slabs are created
 * only when owner / senior incharge / carving head approves the batch
 * from their Tasks panel. The old shared import password is retired —
 * the human approval is the gate now.
 */

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { submitSlabImportBatchAction } from "../actions";
import { FinanceLoadingOverlay } from "@/components/finance-loading-overlay";

export type TempleOpt = { name: string; default_stone: string | null };

// Existing category values per temple — powers the suggestion datalists in
// the review table (type new OR pick one already used for this temple).
export type ExistingCats = Record<string, { cat1: string[]; cat2: string[]; labels: string[] }>;

type Row = {
  key: string;
  label: string;
  description: string;
  // Mig 128 — optional extra description; becomes a folder level UNDER
  // Description in Temple View (only when filled).
  additional: string;
  length: string;
  width: string;
  height: string;
  quantity: string;
  quality: string;
  priority: boolean;
  // Mig 123 — temple-component category (Category 1 / Category 2). Filled
  // from the Excel columns; editable here with suggestions from existing
  // categories. Stored UPPERCASE.
  section: string;
  element: string;
};

const inp = { padding: "8px 10px", fontSize: 13, border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg)", color: "var(--text)" } as const;
const lbl = { fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" as const, letterSpacing: "0.06em" };

// Safety rule (Daksh June 2026): every started row must have ALL fields
// filled. A row counts as "started" once any field has content; a fully
// blank row (template filler / a stray + Add a row) is ignored. fieldEmpty
// powers both the per-cell red highlight and the named-field error list.
type RowField = "label" | "description" | "length" | "width" | "height" | "quantity";
const REQUIRED_FIELDS: { key: RowField; label: string }[] = [
  { key: "label", label: "Label" },
  { key: "description", label: "Description" },
  { key: "length", label: "Length" },
  { key: "width", label: "Width" },
  { key: "height", label: "Height" },
  { key: "quantity", label: "Quantity" },
];
function rowHasContent(r: Row): boolean {
  return !!(
    r.label.trim() ||
    r.description.trim() ||
    r.additional.trim() ||
    r.length.trim() ||
    r.width.trim() ||
    r.height.trim() ||
    r.quantity.trim()
  );
}
function fieldEmpty(r: Row, field: RowField): boolean {
  if (!rowHasContent(r)) return false; // never flag a fully-blank row
  switch (field) {
    case "label":
      return !r.label.trim();
    case "description":
      return !r.description.trim();
    case "length":
      return !(Number(r.length) > 0);
    case "width":
      return !(Number(r.width) > 0);
    case "height":
      return !(Number(r.height) > 0);
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

export function SlabImportClient({ temples, stones, existingCats = {} }: { temples: TempleOpt[]; stones: string[]; existingCats?: ExistingCats }) {
  const router = useRouter();
  const [temple, setTemple] = useState("");
  const [stone, setStone] = useState("");
  const [step, setStep] = useState<1 | 2>(1);
  const [rows, setRows] = useState<Row[]>([]);
  const [fileName, setFileName] = useState("");
  // The uploaded Excel itself — sent with the batch as the audit copy.
  const [fileObj, setFileObj] = useState<File | null>(null);
  const [error, setError] = useState("");
  // Mig 122 follow-on — the import password is retired: every batch now
  // goes through human approval (owner / senior incharge / carving head),
  // which is a stronger gate than a shared password.
  const [stage, setStage] = useState<"idle" | "confirm">("idle");
  const [busy, setBusy] = useState(false);
  // Lock temple + stone once a template is downloaded / a file is uploaded,
  // so the chosen temple/stone can't drift from what the file was built for.
  const [locked, setLocked] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // Hard guard against double-submit — a ref flips synchronously, so even a
  // fast double-click can't fire two batches before React re-renders.
  const submittingRef = useRef(false);

  const ready = !!temple && !!stone;

  function clearTempleStone() {
    setLocked(false);
    setTemple("");
    setStone("");
  }

  function pickTemple(name: string) {
    setTemple(name);
    // Auto-fill stone with the temple's default if it exists + we don't
    // already have a (manually chosen) stone.
    const def = temples.find((t) => t.name === name)?.default_stone;
    if (def && !stone) setStone(def);
  }

  function downloadTemplate() {
    // The colourful template is built server-side with exceljs (see
    // /api/slabs/import-template) — reliable colours, no client bundle
    // weight, and it sidesteps the Turbopack quirk that broke the styled
    // xlsx fork in the browser. We just navigate to it; the response is an
    // attachment so the browser downloads it without leaving the page.
    const url = `/api/slabs/import-template?temple=${encodeURIComponent(temple)}&stone=${encodeURIComponent(stone)}`;
    const a = document.createElement("a");
    a.href = url;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Lock temple/stone now — the downloaded file is built for THIS pair.
    setLocked(true);
  }

  async function onFile(file: File) {
    setError("");
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      if (!ws) {
        setError("That file has no sheets.");
        return;
      }
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false }) as unknown[][];
      const parsed: Row[] = [];
      for (let i = 1; i < aoa.length; i++) {
        const r = (aoa[i] ?? []) as unknown[];
        const cell = (idx: number) => String(r[idx] ?? "").trim();
        // Column order: Sr.No(0) Temple(1) Stone(2) Category1(3) Category2(4)
        // Label(5) Description(6) AdditionalDescription(7) Length(8) Width(9)
        // Height(10) Quantity(11) Quality(12). Category 1/2 → component
        // section/element; Additional Description → optional tree sub-level.
        const section = cell(3);
        const element = cell(4);
        const label = cell(5);
        const description = cell(6);
        const additional = cell(7);
        const length = cell(8);
        const width = cell(9);
        const height = cell(10);
        const quantity = cell(11);
        // Quality: A / B / Both (blank = Both). Tolerates "Grade A" typing.
        const qRaw = cell(12).toUpperCase().replace(/GRADE/g, "").trim();
        const quality = qRaw === "A" ? "A" : qRaw === "B" ? "B" : "";
        if (!label && !description && !additional && !length && !width && !height && !quantity && !section && !element) continue; // blank row
        parsed.push({
          key: crypto.randomUUID(),
          label,
          description,
          additional,
          length,
          width,
          height,
          // No silent default — a blank quantity is flagged as a missing
          // field in the review step so nothing is added with assumed data.
          quantity,
          quality,
          priority: false,
          section,
          element,
        });
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
    setRows((prev) => [...prev, { key: crypto.randomUUID(), label: "", description: "", additional: "", length: "", width: "", height: "", quantity: "", quality: "", priority: false, section: "", element: "" }]);
  }

  // Suggestion lists for the selected temple — fed to the <datalist>s so the
  // user can type a NEW category/label or pick one already used here (keeps
  // the same place from splitting into two near-identical groups).
  const suggest = existingCats[temple] ?? { cat1: [], cat2: [], labels: [] };

  const validRows = useMemo(() => rows.filter(rowValid), [rows]);
  // Started-but-incomplete rows, with the exact empty fields named.
  const issues = useMemo(
    () => rows.map((r, i) => ({ i, probs: rowProblems(r) })).filter((x) => x.probs.length > 0),
    [rows],
  );
  const totalSlabs = useMemo(
    () => validRows.reduce((s, r) => s + Math.max(1, Math.floor(Number(r.quantity) || 1)), 0),
    [validRows],
  );
  // Block the add while any started row is missing a field.
  const canAdd = issues.length === 0 && totalSlabs > 0;

  async function doImport() {
    // Synchronous double-submit guard (the real fix for the duplicate-batch
    // bug) — returns instantly on a second click before busy re-renders.
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
    fd.set("file", fileObj);
    fd.set(
      "rows",
      JSON.stringify(
        rows.map((r) => ({
          label: r.label,
          description: r.description,
          additionalDescription: r.additional,
          length: Number(r.length) || 0,
          width: Number(r.width) || 0,
          height: Number(r.height) || 0,
          quantity: Number(r.quantity) || 1,
          quality: r.quality,
          priority: r.priority,
          componentSection: r.section,
          componentElement: r.element,
        })),
      ),
    );
    const res = await submitSlabImportBatchAction(fd);
    if (res.ok) {
      // Keep the overlay up and DON'T release the guard — we're navigating
      // away; releasing would briefly re-enable the button mid-redirect.
      router.push(
        `/slabs?toast=${encodeURIComponent(
          `Batch sent for approval — ${res.slabCount} slab${res.slabCount === 1 ? "" : "s"} will appear once approved`,
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
          <strong>Columns:</strong> Sr.No · Temple (filled) · Stone (filled) · <strong>Category 1</strong> · <strong>Category 2</strong> · Label · Description · Additional Description (optional) · Length · Width · Height · Quantity · Quality (A/B/Both — blank = Both).{" "}
          Category 1 → Category 2 → Label → Description → Additional Description organise the slabs in <strong>Temple View</strong>. In the review step you can pick from categories already used for this temple.{" "}
          Sizes are in <strong>inches</strong>. One row with quantity N becomes N slabs. After upload you can fix anything before it&apos;s added.
          {" "}In the file, <span style={{ color: "#7c2d12", fontWeight: 700 }}>gold columns</span> are pre-filled (leave them) and{" "}
          <span style={{ color: "#1d4ed8", fontWeight: 700 }}>blue columns</span> are for you to fill in.
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

      {/* Per-row validation — every field is required; name the empties. */}
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

        {(suggest.cat1.length > 0 || suggest.cat2.length > 0) && (
          <div style={{ padding: "8px 18px", fontSize: 12, color: "var(--muted)", background: "var(--surface-alt)", borderBottom: "1px solid var(--border)" }}>
            💡 Category 1 / 2 and Label show <strong>suggestions already used in {temple}</strong> as you type — pick one to keep the same place from splitting, or type a brand-new value.
          </div>
        )}

        {/* Suggestion lists — native autocomplete for Category 1/2 + Label. */}
        <datalist id="dl-cat1">{suggest.cat1.map((v) => <option key={v} value={v} />)}</datalist>
        <datalist id="dl-cat2">{suggest.cat2.map((v) => <option key={v} value={v} />)}</datalist>
        <datalist id="dl-label">{suggest.labels.map((v) => <option key={v} value={v} />)}</datalist>

        <div style={{ overflowX: "auto" }}>
          {/* Column order matches the Excel template: Category 1 · Category 2 ·
              Label · Description · Additional Description · L · W · H · Qty ·
              Quality. */}
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1340 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                <th style={{ ...th, width: 36 }}>#</th>
                <th style={{ ...th, minWidth: 140 }}>Category 1</th>
                <th style={{ ...th, minWidth: 140 }}>Category 2</th>
                <th style={{ ...th, minWidth: 150 }}>Label</th>
                <th style={{ ...th, minWidth: 180 }}>Description</th>
                <th style={{ ...th, minWidth: 170 }}>Additional Desc <span style={{ fontWeight: 600, textTransform: "none" }}>(optional)</span></th>
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
                // Red border on any required cell that's empty/invalid for a started row.
                const cell = (f: RowField) => ({ ...cellInp, borderColor: fieldEmpty(r, f) ? "#dc2626" : "var(--border)" });
                return (
                  <tr key={r.key} style={{ borderBottom: "1px solid var(--border)", background: bad ? "rgba(220,38,38,0.05)" : undefined }}>
                    <td style={{ ...td, color: "var(--muted)", fontSize: 12, fontFamily: "ui-monospace, monospace" }}>{i + 1}</td>
                    <td style={td}><input list="dl-cat1" value={r.section} onChange={(e) => patch(r.key, "section", e.target.value)} placeholder="e.g. FLOOR" style={{ ...cellInp, textTransform: "uppercase" }} /></td>
                    <td style={td}><input list="dl-cat2" value={r.element} onChange={(e) => patch(r.key, "element", e.target.value)} placeholder="e.g. CLOISTER" style={{ ...cellInp, textTransform: "uppercase" }} /></td>
                    <td style={td}><input list="dl-label" value={r.label} onChange={(e) => patch(r.key, "label", e.target.value)} placeholder="required" style={{ ...cell("label"), textTransform: "uppercase" }} /></td>
                    <td style={td}><input value={r.description} onChange={(e) => patch(r.key, "description", e.target.value)} placeholder="required" style={cell("description")} /></td>
                    <td style={td}><input value={r.additional} onChange={(e) => patch(r.key, "additional", e.target.value)} placeholder="optional" style={cellInp} /></td>
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

      {error && <div style={{ fontSize: 13, fontWeight: 700, color: "#991b1b" }}>{error}</div>}

      {/* Sticky add bar */}
      <div style={{ position: "sticky", bottom: 0, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 18px", boxShadow: "0 -2px 10px rgba(0,0,0,0.05)" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: canAdd ? "var(--text)" : "var(--muted)" }}>
          {issues.length > 0
            ? `Fix ${issues.length} incomplete row${issues.length === 1 ? "" : "s"} before sending`
            : totalSlabs > 0
              ? `Ready to send ${totalSlabs} slab${totalSlabs === 1 ? "" : "s"} for approval (${temple})`
              : "Fill in at least one row"}
        </div>
        <button type="button" disabled={!canAdd} onClick={() => { setError(""); setStage("confirm"); }} style={{ padding: "11px 24px", fontSize: 14, fontWeight: 800, color: "#fff", background: canAdd ? "var(--gold-dark)" : "var(--border)", border: "none", borderRadius: 8, cursor: canAdd ? "pointer" : "not-allowed" }}>
          Send {totalSlabs} slab{totalSlabs === 1 ? "" : "s"} for approval
        </button>
      </div>

      {/* Confirm + password overlays */}
      {stage !== "idle" && (
        <div onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) setStage("idle"); }} style={{ position: "fixed", inset: 0, left: "var(--content-left)", background: "rgba(15,12,6,0.55)", backdropFilter: "blur(2px)", zIndex: 1200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div role="dialog" aria-modal="true" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, boxShadow: "0 18px 60px rgba(0,0,0,0.45)", width: "100%", maxWidth: 440, padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ fontSize: 17, fontWeight: 800 }}>Send {totalSlabs} slab{totalSlabs === 1 ? "" : "s"} for approval?</div>
            <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
              {validRows.length} row{validRows.length === 1 ? "" : "s"} → <strong>{totalSlabs}</strong> slab{totalSlabs === 1 ? "" : "s"} into <strong>{temple}</strong> ({stone}).
              {" "}The batch goes to <strong>owner / senior incharge / carving head</strong> for approval — slabs appear at status <strong>open</strong> only after they approve.
              {" "}Your Excel file is kept on record with the batch.
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
