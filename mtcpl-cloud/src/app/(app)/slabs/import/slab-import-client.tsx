"use client";

/**
 * Bulk slab import — client flow (Daksh June 2026).
 *
 * Step 1: pick temple + stone → download an .xlsx template (those two
 *         columns pre-filled) → fill label/description/size/quantity →
 *         upload it back. Parsing happens here with SheetJS.
 * Step 2: review + edit every row (fix anything, set quality, drop
 *         rows) → "Add N slabs" → confirm → password → commit.
 *
 * The commit calls importSlabsAction (server) which re-validates,
 * verifies the password server-side, generates ids with the normal
 * scheme and inserts at status='open' under one batch_id (group).
 */

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { importSlabsAction } from "../actions";
import { FinanceLoadingOverlay } from "@/components/finance-loading-overlay";

export type TempleOpt = { name: string; default_stone: string | null };

type Row = {
  key: string;
  label: string;
  description: string;
  length: string;
  width: string;
  height: string;
  quantity: string;
  quality: string;
  priority: boolean;
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

export function SlabImportClient({ temples, stones }: { temples: TempleOpt[]; stones: string[] }) {
  const router = useRouter();
  const [temple, setTemple] = useState("");
  const [stone, setStone] = useState("");
  const [step, setStep] = useState<1 | 2>(1);
  const [rows, setRows] = useState<Row[]>([]);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [stage, setStage] = useState<"idle" | "confirm" | "password">("idle");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const ready = !!temple && !!stone;

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
        const label = cell(3);
        const description = cell(4);
        const length = cell(5);
        const width = cell(6);
        const height = cell(7);
        const quantity = cell(8);
        if (!label && !description && !length && !width && !height && !quantity) continue; // blank row
        parsed.push({
          key: crypto.randomUUID(),
          label,
          description,
          length,
          width,
          height,
          // No silent default — a blank quantity is flagged as a missing
          // field in the review step so nothing is added with assumed data.
          quantity,
          quality: "",
          priority: false,
        });
      }
      if (parsed.length === 0) {
        setError("No filled rows found — add at least one row with size + quantity, then re-upload.");
        return;
      }
      setRows(parsed);
      setFileName(file.name);
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
    setRows((prev) => [...prev, { key: crypto.randomUUID(), label: "", description: "", length: "", width: "", height: "", quantity: "", quality: "", priority: false }]);
  }

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
    setBusy(true);
    setError("");
    const res = await importSlabsAction({
      temple,
      stone,
      password,
      rows: rows.map((r) => ({
        label: r.label,
        description: r.description,
        length: Number(r.length) || 0,
        width: Number(r.width) || 0,
        height: Number(r.height) || 0,
        quantity: Number(r.quantity) || 1,
        quality: r.quality,
        priority: r.priority,
      })),
    });
    setBusy(false);
    if (res.ok) {
      router.push(`/slabs?toast=${encodeURIComponent(`${res.count} slab${res.count === 1 ? "" : "s"} imported`)}`);
    } else {
      setError(res.error);
      // Wrong password → keep them on the password prompt to retry;
      // any other error → drop back to the table to fix.
      if (res.error !== "Wrong password") setStage("idle");
    }
  }

  const card = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 18 } as const;

  // ── Step 1 — temple + stone + template + upload ──
  if (step === 1) {
    return (
      <section style={{ ...card, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={lbl}>1. Temple</span>
            <select value={temple} onChange={(e) => pickTemple(e.target.value)} style={{ ...inp, fontWeight: 700 }}>
              <option value="">Select temple…</option>
              {temples.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={lbl}>2. Stone (applies to all)</span>
            <select value={stone} onChange={(e) => setStone(e.target.value)} style={{ ...inp, fontWeight: 700 }}>
              <option value="">Select stone…</option>
              {stones.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </div>

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
          <strong>Columns:</strong> Sr.No · Temple (filled) · Stone (filled) · Label · Description · Length · Width · Height · Quantity.{" "}
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
      <FinanceLoadingOverlay show={busy} label="Adding slabs…" />

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
          <button type="button" onClick={() => { setStep(1); setRows([]); setError(""); }} style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", background: "none", border: "1px solid var(--border)", borderRadius: 8, padding: "7px 12px", cursor: "pointer" }}>← Upload a different file</button>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 920 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                <th style={{ ...th, width: 36 }}>#</th>
                <th style={{ ...th, minWidth: 150 }}>Label</th>
                <th style={{ ...th, minWidth: 180 }}>Description</th>
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
                    <td style={td}><input value={r.label} onChange={(e) => patch(r.key, "label", e.target.value)} placeholder="required" style={cell("label")} /></td>
                    <td style={td}><input value={r.description} onChange={(e) => patch(r.key, "description", e.target.value)} placeholder="required" style={cell("description")} /></td>
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
            ? `Fix ${issues.length} incomplete row${issues.length === 1 ? "" : "s"} before adding`
            : totalSlabs > 0
              ? `Ready to add ${totalSlabs} slab${totalSlabs === 1 ? "" : "s"} to ${temple}`
              : "Fill in at least one row"}
        </div>
        <button type="button" disabled={!canAdd} onClick={() => { setError(""); setStage("confirm"); }} style={{ padding: "11px 24px", fontSize: 14, fontWeight: 800, color: "#fff", background: canAdd ? "var(--gold-dark)" : "var(--border)", border: "none", borderRadius: 8, cursor: canAdd ? "pointer" : "not-allowed" }}>
          Add {totalSlabs} slab{totalSlabs === 1 ? "" : "s"}
        </button>
      </div>

      {/* Confirm + password overlays */}
      {stage !== "idle" && (
        <div onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) setStage("idle"); }} style={{ position: "fixed", inset: 0, left: "var(--content-left)", background: "rgba(15,12,6,0.55)", backdropFilter: "blur(2px)", zIndex: 1200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div role="dialog" aria-modal="true" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, boxShadow: "0 18px 60px rgba(0,0,0,0.45)", width: "100%", maxWidth: 440, padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
            {stage === "confirm" ? (
              <>
                <div style={{ fontSize: 17, fontWeight: 800 }}>Add {totalSlabs} slab{totalSlabs === 1 ? "" : "s"}?</div>
                <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
                  {validRows.length} row{validRows.length === 1 ? "" : "s"} → <strong>{totalSlabs}</strong> slab{totalSlabs === 1 ? "" : "s"} into <strong>{temple}</strong> ({stone}), status <strong>open</strong>.
                  {" "}They&apos;ll be one group you can delete together later.
                </div>
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button type="button" onClick={() => setStage("idle")} className="ghost-button">Cancel</button>
                  <button type="button" onClick={() => { setStage("password"); }} style={{ padding: "9px 18px", fontSize: 14, fontWeight: 800, color: "#fff", background: "var(--gold-dark)", border: "none", borderRadius: 8, cursor: "pointer" }}>Yes, continue →</button>
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 17, fontWeight: 800 }}>🔒 Enter import password</div>
                <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>Required to commit the bulk add. Owner / developer / senior incharge can change it in Settings.</div>
                <input type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && password && !busy) doImport(); }} placeholder="Password" style={{ ...inp, fontSize: 15, padding: "11px 14px" }} />
                {error && <div style={{ fontSize: 13, fontWeight: 700, color: "#991b1b" }}>{error}</div>}
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button type="button" disabled={busy} onClick={() => { setStage("idle"); setPassword(""); setError(""); }} className="ghost-button">Cancel</button>
                  <button type="button" disabled={!password || busy} onClick={doImport} style={{ padding: "9px 18px", fontSize: 14, fontWeight: 800, color: "#fff", background: !password || busy ? "var(--border)" : "#15803d", border: "none", borderRadius: 8, cursor: !password || busy ? "not-allowed" : "pointer" }}>{busy ? "Adding…" : `✓ Add ${totalSlabs}`}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
