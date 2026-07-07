"use client";

/**
 * Import employees from an Excel sheet (Daksh Jul 2026).
 *
 * Upload the PF handler's existing employee sheet → we parse it server-side
 * (parseSalaryImportAction), show a preview with duplicate flags, and only on
 * "Import" write the chosen rows (importSalaryEmployeesAction). Fixed-salary +
 * optional PF for the whole batch. Nothing is written until the user confirms.
 */

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DesigChip } from "./_ui/salary-ui";
import { parseSalaryImportAction, importSalaryEmployeesAction } from "./actions";

type PreviewRow = {
  name: string; father: string; organization: string; designation: string; bank: string;
  ifsc: string; account: string; salary: number; dup: boolean; note: string;
  include: boolean;
};

const inr = (n: number) => `₹ ${(Number(n) || 0).toLocaleString("en-IN")}`;
const btnGhost: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, padding: "9px 14px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", cursor: "pointer", whiteSpace: "nowrap" };
const btnPrimary: React.CSSProperties = { fontSize: 13, fontWeight: 800, padding: "10px 18px", borderRadius: 10, border: "none", color: "#fff", background: "#0f172a", cursor: "pointer", whiteSpace: "nowrap" };

export function SalaryImportButton() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<PreviewRow[] | null>(null);
  const [sheet, setSheet] = useState("");
  const [pf, setPf] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  function reset() {
    setRows(null); setSheet(""); setErr(null); setMsg(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function onFile(file: File) {
    setBusy(true); setErr(null); setMsg(null); setRows(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await parseSalaryImportAction(fd);
      if (!res.ok) { setErr(res.error); return; }
      setSheet(res.sheet);
      // Duplicates start UNCHECKED so an accidental re-import is a no-op.
      setRows(res.rows.map((r) => ({ ...r, include: !r.dup })));
    } catch { setErr("Failed to read the file."); }
    finally { setBusy(false); }
  }

  async function doImport() {
    if (!rows) return;
    const chosen = rows.filter((r) => r.include);
    if (chosen.length === 0) { setErr("Tick at least one row to import."); return; }
    setBusy(true); setErr(null); setMsg(null);
    try {
      const res = await importSalaryEmployeesAction(
        chosen.map(({ name, father, organization, designation, bank, ifsc, account, salary }) => ({ name, father, organization, designation, bank, ifsc, account, salary })),
        pf,
      );
      if (!res.ok) { setErr(res.error); return; }
      setMsg(`Imported ${res.inserted} employee${res.inserted === 1 ? "" : "s"}${res.skipped ? ` · skipped ${res.skipped} duplicate${res.skipped === 1 ? "" : "s"}` : ""}.`);
      setRows(null);
      router.refresh();
    } catch { setErr("Import failed — check your connection."); }
    finally { setBusy(false); }
  }

  const includeCount = rows?.filter((r) => r.include).length ?? 0;
  const dupCount = rows?.filter((r) => r.dup).length ?? 0;
  const th: React.CSSProperties = { padding: "6px 8px", fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--muted)", textAlign: "left", whiteSpace: "nowrap", borderBottom: "2px solid var(--border)", background: "var(--bg)", position: "sticky", top: 0 };
  const td: React.CSSProperties = { padding: "6px 8px", fontSize: 12, borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" };

  return (
    <>
      <button type="button" onClick={() => { setOpen(true); reset(); }} style={btnGhost}>⬆ Import from Excel</button>
      {open && (
        <div onMouseDown={() => { if (!busy) { setOpen(false); reset(); } }} style={{ position: "fixed", inset: 0, zIndex: 4000, background: "rgba(15,23,42,0.55)", display: "grid", placeItems: "center", padding: 16, overflowY: "auto" }}>
          <div onMouseDown={(e) => e.stopPropagation()} style={{ width: "min(1040px, 100%)", background: "var(--surface, #fff)", borderRadius: 16, padding: "20px 24px", boxShadow: "0 26px 60px rgba(0,0,0,0.35)", maxHeight: "94vh", display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <div style={{ fontSize: 17, fontWeight: 900 }}>⬆ Import employees from Excel</div>
              <button type="button" onClick={() => { setOpen(false); reset(); }} disabled={busy} style={{ ...btnGhost, marginLeft: "auto", padding: "6px 12px" }}>✕ Close</button>
            </div>
            <p style={{ margin: "0 0 12px", fontSize: 12.5, color: "var(--muted)" }}>
              Upload your employee sheet (same layout as the PF register — columns <strong>NAME · FATHER NAME · BANK NAME · IFSC CODE · BANK A/C NO. · FIXED SALARY</strong>, with the designation in the column just left of SR.NO and the site / organization one column further left). We read name, father, site, designation, bank, IFSC, A/c number and fixed salary.
            </p>

            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
              <input ref={fileRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} style={{ fontSize: 12.5 }} />
              {busy && <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--gold-dark)" }}>Working…</span>}
              {sheet && <span style={{ fontSize: 11.5, color: "var(--muted)" }}>Sheet: {sheet}</span>}
            </div>

            {err && <div style={{ fontSize: 13, fontWeight: 700, color: "#991b1b", marginBottom: 10 }}>⚠ {err}</div>}
            {msg && <div style={{ fontSize: 13, fontWeight: 700, color: "#15803d", background: "rgba(22,163,74,0.08)", border: "1px solid rgba(22,163,74,0.3)", borderRadius: 10, padding: "9px 13px", marginBottom: 10 }}>✓ {msg}</div>}

            {rows && rows.length > 0 && (
              <>
                <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 8, fontSize: 12.5 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700 }}>
                    <input type="checkbox" checked={pf} onChange={(e) => setPf(e.target.checked)} /> Enable PF (12%) for imported
                  </label>
                  <button type="button" onClick={() => setRows((rs) => rs?.map((r) => ({ ...r, include: true })) ?? rs)} style={{ ...btnGhost, padding: "5px 10px", fontSize: 11.5 }}>Select all</button>
                  <button type="button" onClick={() => setRows((rs) => rs?.map((r) => ({ ...r, include: !r.dup })) ?? rs)} style={{ ...btnGhost, padding: "5px 10px", fontSize: 11.5 }}>Skip duplicates</button>
                  <span style={{ marginLeft: "auto", color: "var(--muted)" }}>{rows.length} rows · {dupCount} duplicate{dupCount === 1 ? "" : "s"} · <strong style={{ color: "var(--text)" }}>{includeCount} to import</strong></span>
                </div>
                <div style={{ overflow: "auto", border: "1px solid var(--border)", borderRadius: 10, flex: 1 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
                    <thead><tr>
                      <th style={{ ...th, width: 34 }}></th><th style={th}>Name</th><th style={th}>Father</th><th style={th}>Site</th><th style={th}>Designation</th><th style={th}>Bank</th><th style={th}>IFSC</th><th style={th}>A/c no.</th><th style={{ ...th, textAlign: "right" }}>Fixed salary</th><th style={th}>Note</th>
                    </tr></thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={i} style={{ background: r.dup ? "rgba(220,38,38,0.05)" : undefined, opacity: r.include ? 1 : 0.5 }}>
                          <td style={{ ...td, textAlign: "center" }}>
                            <input type="checkbox" checked={r.include} onChange={(e) => setRows((rs) => rs?.map((x, j) => j === i ? { ...x, include: e.target.checked } : x) ?? rs)} />
                          </td>
                          <td style={{ ...td, fontWeight: 700 }}>{r.name}</td>
                          <td style={td}>{r.father || "—"}</td>
                          <td style={td}>{r.organization ? <DesigChip name={r.organization} size="sm" /> : "—"}</td>
                          <td style={td}>{r.designation ? <DesigChip name={r.designation} size="sm" /> : "—"}</td>
                          <td style={td}>{r.bank || "—"}</td>
                          <td style={{ ...td, fontFamily: "ui-monospace, monospace" }}>{r.ifsc || "—"}</td>
                          <td style={{ ...td, fontFamily: "ui-monospace, monospace" }}>{r.account || "—"}</td>
                          <td style={{ ...td, textAlign: "right", fontFamily: "ui-monospace, monospace" }}>{r.salary ? inr(r.salary) : "—"}</td>
                          <td style={{ ...td, color: r.dup ? "#b91c1c" : "var(--muted)", fontWeight: r.dup ? 700 : 400 }}>{r.note || (r.account ? "" : "no A/c")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
                  <button type="button" onClick={() => { setOpen(false); reset(); }} disabled={busy} style={btnGhost}>Cancel</button>
                  <button type="button" onClick={doImport} disabled={busy || includeCount === 0} style={{ ...btnPrimary, opacity: busy || includeCount === 0 ? 0.6 : 1 }}>
                    {busy ? "Importing…" : `＋ Import ${includeCount} employee${includeCount === 1 ? "" : "s"}`}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
