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

const TEMPLATE_ROWS = 30;
const inp = { padding: "8px 10px", fontSize: 13, border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg)", color: "var(--text)" } as const;
const lbl = { fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" as const, letterSpacing: "0.06em" };

function rowValid(r: Row): boolean {
  return Number(r.length) > 0 && Number(r.width) > 0 && Number(r.height) > 0;
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
    const header = ["Sr.No.", "Temple", "Stone", "Label", "Description", "Length (in)", "Width (in)", "Height (in)", "Quantity"];
    const body = Array.from({ length: TEMPLATE_ROWS }, (_, i) => [i + 1, temple, stone, "", "", "", "", "", ""]);
    const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
    ws["!cols"] = [{ wch: 7 }, { wch: 26 }, { wch: 14 }, { wch: 18 }, { wch: 28 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 10 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Slabs");
    const safe = `${temple}-${stone}`.replace(/[^a-z0-9]+/gi, "_");
    XLSX.writeFile(wb, `slab-import-${safe}.xlsx`);
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
          quantity: quantity || "1",
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
    setRows((prev) => [...prev, { key: crypto.randomUUID(), label: "", description: "", length: "", width: "", height: "", quantity: "1", quality: "", priority: false }]);
  }

  const validRows = useMemo(() => rows.filter(rowValid), [rows]);
  const invalidCount = rows.length - validRows.length;
  const totalSlabs = useMemo(() => validRows.reduce((s, r) => s + Math.max(1, Math.floor(Number(r.quantity) || 1)), 0), [validRows]);

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
      <section style={{ ...card, padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800 }}>Review — {temple} · {stone}</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
              {fileName ? `${fileName} · ` : ""}{validRows.length} valid row{validRows.length === 1 ? "" : "s"} → <strong>{totalSlabs} slab{totalSlabs === 1 ? "" : "s"}</strong>
              {invalidCount > 0 && <span style={{ color: "#b45309", fontWeight: 700 }}> · {invalidCount} need a size (highlighted)</span>}
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
                const bad = !rowValid(r);
                return (
                  <tr key={r.key} style={{ borderBottom: "1px solid var(--border)", background: bad ? "rgba(217,119,6,0.06)" : undefined }}>
                    <td style={{ ...td, color: "var(--muted)", fontSize: 12, fontFamily: "ui-monospace, monospace" }}>{i + 1}</td>
                    <td style={td}><input value={r.label} onChange={(e) => patch(r.key, "label", e.target.value)} placeholder="(temple name)" style={cellInp} /></td>
                    <td style={td}><input value={r.description} onChange={(e) => patch(r.key, "description", e.target.value)} style={cellInp} /></td>
                    <td style={td}><input value={r.length} onChange={(e) => patch(r.key, "length", e.target.value)} inputMode="decimal" style={{ ...cellInp, borderColor: bad && !(Number(r.length) > 0) ? "#d97706" : "var(--border)" }} /></td>
                    <td style={td}><input value={r.width} onChange={(e) => patch(r.key, "width", e.target.value)} inputMode="decimal" style={{ ...cellInp, borderColor: bad && !(Number(r.width) > 0) ? "#d97706" : "var(--border)" }} /></td>
                    <td style={td}><input value={r.height} onChange={(e) => patch(r.key, "height", e.target.value)} inputMode="decimal" style={{ ...cellInp, borderColor: bad && !(Number(r.height) > 0) ? "#d97706" : "var(--border)" }} /></td>
                    <td style={td}><input value={r.quantity} onChange={(e) => patch(r.key, "quantity", e.target.value)} inputMode="numeric" style={cellInp} /></td>
                    <td style={td}><input value={r.quality} onChange={(e) => patch(r.key, "quality", e.target.value)} placeholder="—" style={cellInp} /></td>
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
        <div style={{ fontSize: 13, fontWeight: 700, color: totalSlabs ? "var(--text)" : "var(--muted)" }}>
          {totalSlabs > 0 ? `Ready to add ${totalSlabs} slab${totalSlabs === 1 ? "" : "s"} to ${temple}` : "Fill in size on at least one row"}
        </div>
        <button type="button" disabled={totalSlabs === 0} onClick={() => { setError(""); setStage("confirm"); }} style={{ padding: "11px 24px", fontSize: 14, fontWeight: 800, color: "#fff", background: totalSlabs ? "var(--gold-dark)" : "var(--border)", border: "none", borderRadius: 8, cursor: totalSlabs ? "pointer" : "not-allowed" }}>
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
                  {invalidCount > 0 && <> {invalidCount} row{invalidCount === 1 ? "" : "s"} without a size will be skipped.</>}
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
