"use client";

/**
 * The grid. This screen exists to be typed into fast by one person who
 * is already good at this kind of entry, so the keyboard comes first:
 *
 *   Tab / Shift+Tab  move across and back
 *   Enter            next line (adds one if you are on the last)
 *   the date carries down from the line above, because a register page
 *   is usually one day and re-typing it 30 times is the main time cost
 *
 * The columns are in the same order as the paper register — date, who,
 * what, how many — so the typist's eye runs straight down the page
 * without re-ordering anything in their head.
 *
 * Nothing is saved until the whole page is clean. A half-entered page
 * is worse than an un-entered one, because nobody can tell which half
 * is missing.
 */

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export type GridTool = {
  id: string;
  name: string;
  spec: string | null;
  unit: string;
  stock: number;
};
export type RecentPage = {
  id: string;
  vendorName: string;
  registerDate: string;
  enteredAt: string;
  lines: number;
  undone: boolean;
};
type Vendor = { id: string; name: string };

type SaveRes =
  | { ok: true; batchId: string; lines: number }
  | { ok: false; error: string; rowErrors?: Array<{ row: number; message: string }> };
type UndoRes = { ok: true; message?: string } | { ok: false; error: string };

type Line = { date: string; person: string; toolId: string; toolText: string; qty: string };

const istToday = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const blank = (date: string): Line => ({ date, person: "", toolId: "", toolText: "", qty: "" });

export function RegisterGrid({
  vendors, tools, peopleByVendor, recent, canUndo, saveAction, undoAction,
}: {
  vendors: Vendor[];
  tools: GridTool[];
  peopleByVendor: Record<string, string[]>;
  recent: RecentPage[];
  canUndo: boolean;
  saveAction: (fd: FormData) => Promise<SaveRes>;
  undoAction: (fd: FormData) => Promise<UndoRes>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [vendorId, setVendorId] = useState(vendors[0]?.id ?? "");
  const [pageDate, setPageDate] = useState(istToday());
  const [lines, setLines] = useState<Line[]>(() =>
    Array.from({ length: 8 }, () => blank(istToday())),
  );
  const [err, setErr] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Array<{ row: number; message: string }>>([]);
  const [saved, setSaved] = useState<string | null>(null);
  const [confirmUndo, setConfirmUndo] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);

  const people = peopleByVendor[vendorId] ?? [];
  const toolById = useMemo(() => new Map(tools.map((t) => [t.id, t])), [tools]);

  // When the page date at the top changes, carry it into every line the
  // typist has not filled in yet.
  useEffect(() => {
    setLines((prev) =>
      prev.map((l) => (!l.person && !l.toolId && !l.qty ? { ...l, date: pageDate } : l)),
    );
  }, [pageDate]);

  const filled = lines.filter((l) => l.person.trim() || l.toolId || l.qty.trim());

  /** What the shelf would be left with if this page were saved — shown
   *  live so a mistake is visible before saving, not after. */
  const after = useMemo(() => {
    const takenPerTool = new Map<string, number>();
    for (const l of lines) {
      const q = Number(l.qty);
      if (!l.toolId || !Number.isFinite(q) || q <= 0) continue;
      takenPerTool.set(l.toolId, (takenPerTool.get(l.toolId) ?? 0) + q);
    }
    return [...takenPerTool.entries()].map(([id, taken]) => {
      const t = toolById.get(id);
      return { id, name: t?.name ?? "—", taken, left: (t?.stock ?? 0) - taken };
    });
  }, [lines, toolById]);

  const shortages = after.filter((a) => a.left < 0);

  function setLine(i: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
    setSaved(null);
  }

  function addRow() {
    setLines((prev) => [...prev, blank(prev[prev.length - 1]?.date || pageDate)]);
  }

  function removeRow(i: number) {
    setLines((prev) => (prev.length <= 1 ? [blank(pageDate)] : prev.filter((_, j) => j !== i)));
  }

  /** Enter goes to the same column on the next line, like a sheet. */
  function onKey(e: React.KeyboardEvent, i: number, col: string) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (i === lines.length - 1) addRow();
    window.setTimeout(() => {
      const next = gridRef.current?.querySelector<HTMLElement>(
        `[data-cell="${i + 1}-${col}"]`,
      );
      next?.focus();
    }, 0);
  }

  function save() {
    setErr(null);
    setRowErrors([]);
    setSaved(null);

    const payload = filled.map((l) => ({
      date: l.date,
      person: l.person.trim(),
      toolId: l.toolId,
      qty: Number(l.qty),
    }));
    if (payload.length === 0) {
      setErr("There is nothing on this page yet.");
      return;
    }

    startTransition(async () => {
      const fd = new FormData();
      fd.set("vendor_id", vendorId);
      fd.set("register_date", pageDate);
      fd.set("lines", JSON.stringify(payload));
      const r = await saveAction(fd);
      if (!r.ok) {
        setErr(r.error);
        setRowErrors(r.rowErrors ?? []);
        return;
      }
      setSaved(`${r.lines} line${r.lines === 1 ? "" : "s"} saved.`);
      setLines(Array.from({ length: 8 }, () => blank(pageDate)));
      router.refresh();
    });
  }

  function undo(batchId: string) {
    setConfirmUndo(null);
    setErr(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("batch_id", batchId);
      const r = await undoAction(fd);
      if (!r.ok) setErr(r.error);
      else { setSaved(r.message ?? "Page taken back out."); router.refresh(); }
    });
  }

  const generalErrors = rowErrors.filter((e) => e.row === 0);
  const perRow = new Map<number, string[]>();
  for (const e of rowErrors) {
    if (e.row === 0) continue;
    perRow.set(e.row, [...(perRow.get(e.row) ?? []), e.message]);
  }

  return (
    <div>
      <style>{CSS}</style>

      {/* ── Whose register, and which page ──────────────────────── */}
      <div className="rg-head">
        <label className="rg-field">
          <span>Whose register</span>
          {vendors.length === 1 ? (
            <div className="rg-fixed">{vendors[0].name}</div>
          ) : (
            <select value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          )}
        </label>
        <label className="rg-field">
          <span>Date on the page</span>
          <input type="date" value={pageDate} max={istToday()} onChange={(e) => setPageDate(e.target.value)} />
        </label>
        <div className="rg-count">
          <strong>{filled.length}</strong> line{filled.length === 1 ? "" : "s"} typed
        </div>
      </div>

      {saved && (
        <div className="rg-note rg-good" role="status">
          ✓ {saved}
          <button type="button" onClick={() => setSaved(null)} aria-label="Dismiss">✕</button>
        </div>
      )}
      {err && (
        <div className="rg-note rg-bad" role="alert">
          <div>
            <strong>⚠ {err}</strong>
            {generalErrors.length > 0 && (
              <ul>{generalErrors.map((e, i) => <li key={i}>{e.message}</li>)}</ul>
            )}
          </div>
          <button type="button" onClick={() => { setErr(null); setRowErrors([]); }} aria-label="Dismiss">✕</button>
        </div>
      )}

      {/* ── The grid ─────────────────────────────────────────────── */}
      <div className="rg-wrap" ref={gridRef}>
        <table className="rg">
          <thead>
            <tr>
              <th className="rg-n">#</th>
              <th style={{ width: 150 }}>Date</th>
              <th style={{ width: 200 }}>Who took it</th>
              <th>Tool</th>
              <th style={{ width: 110 }}>Qty</th>
              <th className="rg-x" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const problems = perRow.get(i + 1) ?? [];
              const tool = l.toolId ? toolById.get(l.toolId) : null;
              return (
                <tr key={i} className={problems.length ? "is-bad" : undefined}>
                  <td className="rg-n">{i + 1}</td>
                  <td>
                    <input
                      type="date" value={l.date} max={istToday()}
                      data-cell={`${i}-date`}
                      onChange={(e) => setLine(i, { date: e.target.value })}
                      onKeyDown={(e) => onKey(e, i, "date")}
                    />
                  </td>
                  <td>
                    <input
                      value={l.person} list={`rg-people-${vendorId}`}
                      placeholder="name on the register"
                      maxLength={60}
                      data-cell={`${i}-person`}
                      onChange={(e) => setLine(i, { person: e.target.value })}
                      onKeyDown={(e) => onKey(e, i, "person")}
                    />
                  </td>
                  <td>
                    <input
                      value={l.toolText} list="rg-tools"
                      placeholder="start typing the tool"
                      data-cell={`${i}-tool`}
                      onChange={(e) => {
                        const text = e.target.value;
                        const match = tools.find(
                          (t) => labelOf(t).toLowerCase() === text.trim().toLowerCase(),
                        );
                        setLine(i, { toolText: text, toolId: match?.id ?? "" });
                      }}
                      onKeyDown={(e) => onKey(e, i, "tool")}
                    />
                    {l.toolText.trim() && !l.toolId && (
                      <span className="rg-hint rg-hint-bad">not in the store</span>
                    )}
                    {tool && <span className="rg-hint">{tool.stock} on the shelf</span>}
                  </td>
                  <td>
                    <input
                      type="number" min={1} inputMode="numeric" value={l.qty}
                      data-cell={`${i}-qty`}
                      onChange={(e) => setLine(i, { qty: e.target.value })}
                      onKeyDown={(e) => onKey(e, i, "qty")}
                    />
                  </td>
                  <td className="rg-x">
                    <button type="button" onClick={() => removeRow(i)} aria-label={`Remove line ${i + 1}`}>✕</button>
                  </td>
                  {problems.length > 0 && (
                    <td className="rg-rowerr" colSpan={6}>{problems.join(" · ")}</td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <datalist id="rg-tools">
        {tools.map((t) => <option key={t.id} value={labelOf(t)} />)}
      </datalist>
      <datalist id={`rg-people-${vendorId}`}>
        {people.map((p) => <option key={p} value={p} />)}
      </datalist>

      <div className="rg-actions">
        <button type="button" className="rg-add" onClick={addRow}>＋ Add line</button>
        <button type="button" className="rg-save" onClick={save} disabled={pending || filled.length === 0}>
          {pending ? "Saving…" : `Save this page (${filled.length})`}
        </button>
      </div>

      {/* ── What the page does to the shelf ──────────────────────── */}
      {after.length > 0 && (
        <div className="rg-after">
          <p className="rg-afterhead">After this page is saved</p>
          <div className="rg-chips">
            {after.map((a) => (
              <span key={a.id} className={`rg-chip${a.left < 0 ? " is-bad" : a.left <= 3 ? " is-low" : ""}`}>
                {a.name}: <strong>{a.left}</strong> left
                <em> (taking {a.taken})</em>
              </span>
            ))}
          </div>
          {shortages.length > 0 && (
            <p className="rg-shortage">
              The shelf cannot cover this page. Check the quantities, or the stock may be
              behind — someone may need to add a receipt first.
            </p>
          )}
        </div>
      )}

      {/* ── Pages already entered ────────────────────────────────── */}
      {recent.length > 0 && (
        <div className="rg-recent">
          <p className="rg-afterhead">Pages already entered</p>
          <table className="rg-recenttable">
            <thead>
              <tr>
                <th>Register</th><th>Page date</th><th>Lines</th><th>Typed on</th><th />
              </tr>
            </thead>
            <tbody>
              {recent.map((b) => (
                <tr key={b.id} className={b.undone ? "is-undone" : undefined}>
                  <td>{b.vendorName}</td>
                  <td>{fmtDate(b.registerDate)}</td>
                  <td>{b.lines}</td>
                  <td>{fmtStamp(b.enteredAt)}</td>
                  <td style={{ textAlign: "right" }}>
                    {b.undone ? (
                      <span className="rg-undone">taken back out</span>
                    ) : canUndo ? (
                      confirmUndo === b.id ? (
                        <>
                          <button type="button" className="rg-danger" onClick={() => undo(b.id)} disabled={pending}>
                            Yes, take it out
                          </button>
                          <button type="button" className="rg-mini" onClick={() => setConfirmUndo(null)}>Cancel</button>
                        </>
                      ) : (
                        <button type="button" className="rg-mini" onClick={() => setConfirmUndo(b.id)}>Undo page</button>
                      )
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const labelOf = (t: GridTool) => (t.spec ? `${t.name} · ${t.spec}` : t.name);
const fmtDate = (d: string) =>
  new Date(`${d}T00:00:00+05:30`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const fmtStamp = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

const CSS = `
.rg-head { display:flex; gap:16px; flex-wrap:wrap; align-items:flex-end;
  background:var(--surface); border:1px solid var(--border); border-radius:14px;
  padding:14px 16px; margin-bottom:14px; }
.rg-field { display:flex; flex-direction:column; gap:6px; }
.rg-field span { font-size:10.5px; font-weight:800; letter-spacing:.07em;
  text-transform:uppercase; color:var(--muted); }
.rg-field select, .rg-field input { min-height:42px; padding:0 12px; font-size:15px;
  border-radius:10px; border:1px solid var(--border); background:var(--surface);
  color:var(--text); outline:none; }
.rg-fixed { min-height:42px; display:flex; align-items:center; padding:0 12px;
  font-size:15px; font-weight:700; border-radius:10px; background:var(--surface-alt);
  border:1px solid var(--border-light); }
.rg-count { margin-left:auto; font-size:13px; color:var(--muted); }
.rg-count strong { font-size:19px; color:var(--text); }

.rg-note { display:flex; gap:10px; align-items:flex-start; padding:11px 14px;
  border-radius:10px; font-size:13px; margin-bottom:12px; line-height:1.5; }
.rg-note button { margin-left:auto; border:none; background:none; cursor:pointer;
  color:inherit; font-size:15px; }
.rg-note ul { margin:6px 0 0; padding-left:18px; }
.rg-good { background:rgba(21,128,61,.08); border:1px solid rgba(21,128,61,.35); color:#15803d; }
.rg-bad { background:rgba(185,28,28,.07); border:1px solid rgba(185,28,28,.35); color:#b91c1c; }

.rg-wrap { overflow-x:auto; border:1px solid var(--border); border-radius:14px;
  background:var(--surface); }
table.rg { width:100%; border-collapse:collapse; min-width:720px; }
table.rg th { font-size:10.5px; font-weight:800; letter-spacing:.07em;
  text-transform:uppercase; color:var(--muted); text-align:left;
  padding:10px 10px; border-bottom:1px solid var(--border); background:var(--surface-alt); }
table.rg td { padding:5px 8px; border-bottom:1px solid var(--border-light); vertical-align:middle; }
table.rg tr.is-bad td { background:rgba(185,28,28,.05); }
table.rg input { width:100%; min-height:40px; padding:0 10px; font-size:14.5px;
  border-radius:8px; border:1px solid transparent; background:transparent;
  color:var(--text); outline:none; }
table.rg input:focus { border-color:var(--gold); background:var(--surface);
  box-shadow:0 0 0 3px rgba(166,123,40,.12); }
.rg-n { width:40px; color:var(--muted); font-size:12px; text-align:right; }
.rg-x { width:42px; text-align:center; }
.rg-x button { border:none; background:none; color:var(--muted); cursor:pointer; font-size:14px; }
.rg-hint { display:block; font-size:10.5px; color:var(--muted); padding:0 10px 2px; }
.rg-hint-bad { color:#b91c1c; font-weight:700; }
.rg-rowerr { font-size:11.5px; color:#b91c1c; padding:0 10px 7px 48px !important;
  border-bottom:1px solid var(--border-light); }

.rg-actions { display:flex; gap:10px; margin-top:14px; flex-wrap:wrap; }
.rg-add { padding:12px 18px; font-size:14px; font-weight:700; border-radius:11px;
  border:1px dashed var(--border); background:transparent; color:var(--muted); cursor:pointer; }
.rg-save { margin-left:auto; padding:13px 24px; font-size:15px; font-weight:800;
  border-radius:12px; border:none; color:#fff; cursor:pointer;
  background:linear-gradient(135deg, var(--gold) 0%, var(--gold-dark) 100%); }
.rg-save:disabled { background:var(--border); color:var(--muted); cursor:not-allowed; }

.rg-after, .rg-recent { margin-top:24px; }
.rg-afterhead { font-size:10.5px; font-weight:800; letter-spacing:.08em;
  text-transform:uppercase; color:var(--muted); margin:0 0 10px; }
.rg-chips { display:flex; gap:8px; flex-wrap:wrap; }
.rg-chip { font-size:12.5px; padding:6px 11px; border-radius:999px;
  background:var(--surface); border:1px solid var(--border); }
.rg-chip em { color:var(--muted); font-style:normal; }
.rg-chip.is-low { background:rgba(217,119,6,.10); border-color:rgba(217,119,6,.4); color:#92400e; }
.rg-chip.is-bad { background:rgba(185,28,28,.10); border-color:rgba(185,28,28,.45); color:#b91c1c; }
.rg-shortage { font-size:12.5px; color:#b91c1c; margin:10px 0 0; line-height:1.5; }

table.rg-recenttable { width:100%; border-collapse:collapse; font-size:13px; }
table.rg-recenttable th { font-size:10.5px; font-weight:800; letter-spacing:.07em;
  text-transform:uppercase; color:var(--muted); text-align:left;
  padding:8px 10px; border-bottom:1px solid var(--border); }
table.rg-recenttable td { padding:9px 10px; border-bottom:1px solid var(--border-light); }
table.rg-recenttable tr.is-undone td { opacity:.5; text-decoration:line-through; }
.rg-undone { font-size:11.5px; color:var(--muted); }
.rg-mini { padding:6px 12px; font-size:12px; font-weight:700; border-radius:8px;
  border:1px solid var(--border); background:var(--surface); color:var(--text);
  cursor:pointer; margin-left:6px; }
.rg-danger { padding:6px 12px; font-size:12px; font-weight:800; border-radius:8px;
  border:1px solid #b91c1c; background:#b91c1c; color:#fff; cursor:pointer; }
`;
