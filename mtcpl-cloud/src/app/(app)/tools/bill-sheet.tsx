"use client";

/**
 * Scan a supplier's bill, and check what it read before it lands.
 *
 * Daksh, Nov 2026: "we will scan the bill, it will fetch item name and
 * qty. If item don't exist it will create new and prompt us 'should I
 * create new item'."
 *
 * ── The screen is the safety ──────────────────────────────────────
 *
 * Nothing on the shelf moves until Post is pressed. Every line arrives
 * with a decision already made, so the common case is read-and-post,
 * but each one can be changed and the two that need a human are
 * impossible to miss:
 *
 *   NEW      amber. A tool that is not on the shelf. The name is
 *            pre-filled, and the tick is OFF until you say so — this is
 *            the "should I create new item?" prompt, asked per line.
 *   CHECK    amber. The model proposed a match our own scoring could
 *            only partly agree with. Pre-selected, and it needs a tick
 *            of its own before Post will go.
 *
 * Both of those block Post until ticked, and the second one matters
 * more than it looks. A wrong new item is a duplicate somebody spots.
 * A wrong match is stock filed into the wrong row, which nobody spots
 * until they go looking for forty of something and find twelve. So
 * keeping a flagged guess is an action, not the default.
 *
 * Matched lines say HOW they matched, because "it just knew" is not
 * something you can audit:
 *
 *   LEARNED  this supplier has printed this exact text before and
 *            somebody already said what it was. No guess involved.
 *   EXACT    the same name once punctuation is ignored.
 *   CLOSE    same numbers, different punctuation.
 *
 * ── The printed text is shown, always ─────────────────────────────
 *
 * In mono, unaltered, as the first thing on every row. It is the
 * evidence for the match, and the only way to see that a line reading
 * "160" has been pointed at a tool reading "150" is to have both in
 * front of you.
 *
 * Row renderers live at MODULE scope, not inside this component. A
 * sub-component defined in a component body is a new type on every
 * render, so React remounts it — and an input that remounts loses focus
 * after one keystroke. That bit this codebase before; the quantity and
 * name fields here are exactly where it would hurt.
 */

import { useEffect, useRef, useState } from "react";

import { prettyBytes, shrinkImage } from "@/lib/compress-image";
import type { ScannedBill, ScannedLine } from "@/lib/cnc-tool-bill-types";
import type { ToolRow } from "@/lib/cnc-tool-stock";

import { Sheet } from "./sheet";
import type { LineDecision } from "./bill-actions";

/** One row's editable state, seeded from what the scan proposed. */
type Draft = {
  action: "add" | "create" | "skip";
  toolId: string | null;
  qty: string;
  newName: string;
  newUnit: string;
  /**
   * The reviewer's explicit yes, for the lines that need one.
   *
   * Two kinds of line need it, and the second is the dangerous one:
   *   creating a new item, and
   *   KEEPING an uncertain match the AI proposed.
   * A wrong new item is a duplicate somebody notices. A wrong match is
   * stock in the wrong row, which nobody notices until they go looking
   * for 40 of something and find 12.
   *
   * Picking a different tool by hand IS the confirmation, so that
   * clears the tick instead of asking again.
   */
  confirm: boolean;
};

/**
 * Does this row still need a human to say yes?
 *
 * Module scope so the footer and the row agree by construction rather
 * than by two copies of the same condition.
 */
function needsTick(line: ScannedLine, d: Draft): boolean {
  if (d.action === "skip") return false;
  if (d.action === "create") return true;
  // An uncertain suggestion, still sitting where the scan put it.
  return line.needs_confirm && d.toolId === line.tool_id;
}

function seedDraft(l: ScannedLine): Draft {
  return {
    action: l.outcome === "skipped" ? "skip" : l.tool_id ? "add" : "create",
    toolId: l.tool_id,
    qty: l.qty == null ? "" : String(l.qty),
    newName: l.suggested_name ?? l.raw_text,
    newUnit: l.suggested_unit || "pcs",
    confirm: false,
  };
}

const inr = (n: number | null | undefined) =>
  n == null ? "—" : `₹${Math.round(n).toLocaleString("en-IN")}`;

const BADGE: Record<string, { text: string; tone: string; why: string }> = {
  alias: { text: "LEARNED", tone: "blue", why: "This supplier has printed this exact text before and somebody told us what it was." },
  exact: { text: "EXACT", tone: "green", why: "The same name as a tool on the shelf, once punctuation and case are ignored." },
  fuzzy: { text: "CLOSE", tone: "green", why: "Same numbers, different punctuation — the usual way a supplier writes our tool." },
  ai: { text: "CHECK", tone: "amber", why: "The AI proposed this match and our own scoring only partly agreed. Worth a look." },
  new: { text: "NEW", tone: "amber", why: "Nothing on the shelf looks like this. Create it, or point it at an existing tool." },
  skipped: { text: "NOT STOCK", tone: "grey", why: "Freight, packing, discount or tax — never goes on a shelf." },
};

export function BillSheet({
  open,
  tools,
  busy,
  onClose,
  onPost,
}: {
  open: boolean;
  tools: ToolRow[];
  busy: boolean;
  onClose: () => void;
  onPost: (fd: FormData) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [fileNote, setFileNote] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bill, setBill] = useState<ScannedBill | null>(null);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [why, setWhy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) return;
    // Closing throws the whole review away on purpose: a half-checked
    // bill left lying around is how the wrong quantity gets posted
    // tomorrow by somebody who thinks it was finished.
    setFile(null); setFileNote(null); setScanning(false);
    setError(null); setBill(null); setDrafts({}); setWhy(null);
    if (fileRef.current) fileRef.current.value = "";
  }, [open]);

  async function pick(f: File | null) {
    setError(null);
    if (!f) { setFile(null); setFileNote(null); return; }
    if (f.type === "application/pdf") {
      setFile(f);
      setFileNote(`PDF · ${prettyBytes(f.size)}`);
      return;
    }
    // A 9 MB phone photo of a bill is mostly paper texture. Shrink it
    // before it goes anywhere — the model reads 1280px fine, and the
    // upload happens over shed wifi.
    const shrunk = await shrinkImage(f);
    setFile(shrunk.file);
    setFileNote(
      shrunk.changed
        ? `${prettyBytes(shrunk.beforeBytes)} → ${prettyBytes(shrunk.afterBytes)}`
        : prettyBytes(shrunk.afterBytes),
    );
  }

  async function scan() {
    if (!file) return;
    setScanning(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await fetch("/api/tools/bill-scan", { method: "POST", body: fd });
      const json = (await res.json()) as { ok: boolean; error?: string; data?: ScannedBill };
      if (!json.ok || !json.data) {
        setError(json.error ?? "The scan failed.");
        return;
      }
      setBill(json.data);
      const seeded: Record<number, Draft> = {};
      for (const l of json.data.lines) seeded[l.line_no] = seedDraft(l);
      setDrafts(seeded);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The scan failed.");
    } finally {
      setScanning(false);
    }
  }

  const set = (lineNo: number, patch: Partial<Draft>) =>
    setDrafts((d) => ({ ...d, [lineNo]: { ...d[lineNo], ...patch } }));

  // ── What is blocking Post ───────────────────────────────────────
  const lines = bill?.lines ?? [];
  const live = lines.filter((l) => (drafts[l.line_no]?.action ?? "skip") !== "skip");
  const unticked = live.filter((l) => {
    const d = drafts[l.line_no];
    return d ? needsTick(l, d) && !d.confirm : false;
  });
  const badQty = live.filter((l) => {
    const q = Number(drafts[l.line_no]?.qty);
    return !Number.isFinite(q) || q <= 0;
  });
  const namelessNew = live.filter((l) => {
    const d = drafts[l.line_no];
    return d?.action === "create" && !d.newName.trim();
  });
  const blocked = live.length === 0 || unticked.length > 0 || badQty.length > 0 || namelessNew.length > 0;

  function post() {
    if (!bill || !file || blocked) return;
    const payload = {
      bill: {
        supplier_name: bill.supplier_name,
        supplier_gstin: bill.supplier_gstin,
        bill_no: bill.bill_no,
        bill_date: bill.bill_date,
        amount_subtotal: bill.amount_subtotal,
        amount_gst: bill.amount_gst,
        amount_total: bill.amount_total,
        confidence: bill.confidence,
        note: bill.note,
        model: bill.model,
        input_tokens: bill.usage?.input_tokens ?? null,
        output_tokens: bill.usage?.output_tokens ?? null,
        raw: bill.raw,
      },
      lines: lines.map<LineDecision>((l) => {
        const d = drafts[l.line_no] ?? seedDraft(l);
        return {
          line_no: l.line_no,
          raw_text: l.raw_text,
          qty: d.action === "skip" ? l.qty : Number(d.qty),
          unit: l.unit,
          rate: l.rate,
          amount: l.amount,
          hsn: l.hsn,
          action: d.action,
          tool_id: d.action === "add" ? d.toolId : null,
          new_name: d.action === "create" ? d.newName.trim() : null,
          new_unit: d.action === "create" ? d.newUnit.trim() || "pcs" : null,
          // A hand-picked target is recorded as such rather than
          // inheriting the AI's badge, so the register does not claim
          // the model got something right that a person fixed.
          outcome: d.action === "create" ? "new"
            : d.toolId !== l.tool_id ? "manual"
              : l.outcome,
          score: d.toolId === l.tool_id ? l.score : null,
          ai_tool_id: l.ai_tool_id,
          ai_reason: l.ai_reason,
          learn: true,
        };
      }),
    };
    const fd = new FormData();
    fd.set("payload", JSON.stringify(payload));
    fd.set("file", file);
    onPost(fd);
  }

  const conf = bill?.confidence ?? "";

  return (
    <Sheet
      open={open}
      onClose={onClose}
      wide={!!bill}
      title={bill ? "Check the bill" : "Scan a bill"}
      subtitle={
        bill
          ? "Nothing moves until you press Post. Amber rows need you."
          : "A photo or PDF of the supplier's bill. The shelf is filled from what it says."
      }
      footer={
        bill ? (
          <div style={{ display: "grid", gap: 8 }}>
            {blocked && (
              <p className="tb-block">
                {live.length === 0
                  ? "Every line is marked not stock — there is nothing to post."
                  : unticked.length > 0
                    ? `${unticked.length} line${unticked.length === 1 ? "" : "s"} waiting for your tick — amber needs a yes.`
                    : namelessNew.length > 0
                      ? "A new item still needs a name."
                      : `${badQty.length} line${badQty.length === 1 ? "" : "s"} have no quantity.`}
              </p>
            )}
            <button type="button" className="tc-sheet-go" disabled={busy || blocked} onClick={post}>
              {busy ? "Posting…" : `Post ${live.length} line${live.length === 1 ? "" : "s"} to the shelf`}
            </button>
          </div>
        ) : (
          <button type="button" className="tc-sheet-go" disabled={!file || scanning} onClick={scan}>
            {scanning ? "Reading the bill…" : "Read this bill"}
          </button>
        )
      }
    >
      <style>{BILL_CSS}</style>

      {error && <p className="tb-err">{error}</p>}

      {/* ── Step one: the paper ─────────────────────────────────── */}
      {!bill && (
        <div style={{ display: "grid", gap: 14 }}>
          <label className="tb-drop">
            <input
              ref={fileRef}
              type="file"
              accept="image/*,application/pdf"
              capture="environment"
              onChange={(e) => void pick(e.target.files?.[0] ?? null)}
              style={{ display: "none" }}
            />
            <span className="tb-drop-icon" aria-hidden>🧾</span>
            <span className="tb-drop-main">{file ? file.name : "Take a photo, or choose a file"}</span>
            <span className="tb-drop-sub">{fileNote ?? "JPG, PNG or PDF · up to 10 MB"}</span>
          </label>

          {scanning && (
            <div className="tb-working">
              <span className="tb-spin" aria-hidden />
              <div>
                <b>Reading it now</b>
                <p>Every line, every quantity, and which of them we already stock. Ten to thirty seconds.</p>
              </div>
            </div>
          )}

          <ul className="tb-fine">
            <li>Lay the bill flat and get all four corners in — a cut-off column is read as a missing one.</li>
            <li>Freight, packing and discount lines are recognised and left out of the stock.</li>
            <li>Anything it is unsure about is held back for you, never guessed onto the shelf.</li>
          </ul>
        </div>
      )}

      {/* ── Step two: the review ────────────────────────────────── */}
      {bill && (
        <div style={{ display: "grid", gap: 14 }}>
          {bill.duplicate_of && (
            <p className="tb-warn">
              <b>This bill has already been posted.</b> {bill.supplier_name} bill {bill.bill_no} is
              on the record, so posting it again would double the stock. Close this unless you are sure.
            </p>
          )}

          <div className="tb-head">
            <div className="tb-head-id">
              <b>{bill.supplier_name ?? "Supplier not read"}</b>
              <span>
                {bill.bill_no ? `Bill ${bill.bill_no}` : "no bill number"}
                {bill.bill_date ? ` · ${bill.bill_date}` : ""}
                {bill.supplier_gstin ? ` · ${bill.supplier_gstin}` : ""}
              </span>
            </div>
            <div className="tb-head-money">
              <span data-k>Taxable</span><span>{inr(bill.amount_subtotal)}</span>
              <span data-k>GST</span><span>{inr(bill.amount_gst)}</span>
              <span data-k>Total</span><b>{inr(bill.amount_total)}</b>
            </div>
          </div>

          <div className="tb-conf" data-tone={conf === "high" ? "green" : conf === "medium" ? "amber" : "red"}>
            <b>{conf === "high" ? "Read cleanly" : conf === "medium" ? "Check the numbers" : "Low confidence"}</b>
            <span>
              {conf === "high"
                ? "A clean printed bill. Still worth a glance at the quantities."
                : conf === "medium"
                  ? "Hand-written, or not perfectly sharp. Check every quantity against the paper."
                  : "Blurred, cut off, or a digit it could not settle. Check every line."}
            </span>
            {bill.note && <em>{bill.note}</em>}
          </div>

          <div className="tb-rows">
            {lines.map((l) => {
              const d = drafts[l.line_no] ?? seedDraft(l);
              return (
                <BillRow
                  key={l.line_no}
                  line={l}
                  draft={d}
                  tools={tools}
                  onChange={(patch) => set(l.line_no, patch)}
                  onWhy={(text) => setWhy(text)}
                />
              );
            })}
          </div>

          {why && (
            <p className="tb-why" role="status">
              {why}{" "}
              <button type="button" onClick={() => setWhy(null)}>close</button>
            </p>
          )}

          <p className="tb-fine-one">
            Read by {bill.model}
            {bill.usage?.input_tokens != null &&
              ` · ${bill.usage.input_tokens} in / ${bill.usage.output_tokens ?? 0} out`}
            . The bill image and every line, matched or not, are kept against this record.
          </p>
        </div>
      )}
    </Sheet>
  );
}

/**
 * One printed line, and what we propose to do with it.
 *
 * Module scope, deliberately — see the note at the top of the file.
 */
function BillRow({
  line,
  draft,
  tools,
  onChange,
  onWhy,
}: {
  line: ScannedLine;
  draft: Draft;
  tools: ToolRow[];
  onChange: (patch: Partial<Draft>) => void;
  onWhy: (text: string) => void;
}) {
  const skip = draft.action === "skip";
  const tick = needsTick(line, draft);
  const badge = BADGE[skip ? "skipped" : draft.action === "create" ? "new"
    : draft.toolId !== line.tool_id ? "exact" : line.outcome] ?? BADGE.new;
  const tone = skip ? "grey" : tick ? (draft.confirm ? "green" : "amber") : "green";

  const qtyBad = !skip && !(Number(draft.qty) > 0);

  return (
    <div className="tb-row" data-tone={tone} data-skip={skip ? "1" : undefined}>
      {/* The evidence, first and unaltered. */}
      <div className="tb-row-raw">
        <code>{line.raw_text}</code>
        <span className="tb-row-meta">
          {line.qty != null && `${line.qty}${line.unit ? ` ${line.unit}` : ""}`}
          {line.rate != null && ` · ${inr(line.rate)}/unit`}
          {line.amount != null && ` · ${inr(line.amount)}`}
          {line.hsn && ` · HSN ${line.hsn}`}
        </span>
      </div>

      {/* What we think it is. */}
      <div className="tb-row-decide">
        <button
          type="button"
          className="tb-badge"
          data-tone={tone}
          onClick={() => onWhy(badge.why)}
          title="What does this mean?"
        >
          {badge.text}
        </button>

        {skip ? (
          <span className="tb-row-skip">left out of the stock</span>
        ) : draft.action === "create" ? (
          <div className="tb-new">
            <input
              className="tb-in tb-in-name"
              value={draft.newName}
              maxLength={80}
              placeholder="Name for the new item"
              onChange={(e) => onChange({ newName: e.target.value })}
              aria-label={`Name for line ${line.line_no}`}
            />
            <input
              className="tb-in tb-in-unit"
              value={draft.newUnit}
              maxLength={12}
              onChange={(e) => onChange({ newUnit: e.target.value })}
              aria-label={`Unit for line ${line.line_no}`}
            />
            <label className="tb-tick">
              <input
                type="checkbox"
                checked={draft.confirm}
                onChange={(e) => onChange({ confirm: e.target.checked })}
              />
              <span>Create this new item</span>
            </label>
          </div>
        ) : (
          <select
            className="tb-in tb-in-tool"
            value={draft.toolId ?? ""}
            // Choosing by hand IS the confirmation, so the tick goes
            // away rather than asking a second time.
            onChange={(e) => onChange({ toolId: e.target.value || null, confirm: false })}
            aria-label={`Tool for line ${line.line_no}`}
          >
            {tools.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}{t.spec ? ` · ${t.spec}` : ""}
              </option>
            ))}
          </select>
        )}

        {/* The AI's guess, kept as-is, needs a yes of its own. */}
        {!skip && draft.action === "add" && tick && (
          <label className="tb-tick">
            <input
              type="checkbox"
              checked={draft.confirm}
              onChange={(e) => onChange({ confirm: e.target.checked })}
            />
            <span>Yes, this is the one</span>
          </label>
        )}
      </div>

      {/* How many, and whether it counts at all. */}
      <div className="tb-row-qty">
        {!skip && (
          <input
            className="tb-in tb-in-qty"
            data-bad={qtyBad ? "1" : undefined}
            inputMode="decimal"
            value={draft.qty}
            onChange={(e) => onChange({ qty: e.target.value.replace(/[^\d.]/g, "") })}
            aria-label={`Quantity for line ${line.line_no}`}
          />
        )}
        <div className="tb-row-switch">
          {!skip && draft.action === "create" && (
            <button
              type="button"
              onClick={() => onChange({ action: "add", toolId: tools[0]?.id ?? null, confirm: false })}
              disabled={tools.length === 0}
              title={tools.length === 0 ? "The shelf is empty — there is nothing to point at yet" : undefined}
            >
              use existing
            </button>
          )}
          {!skip && draft.action === "add" && (
            <button
              type="button"
              onClick={() => onChange({ action: "create", confirm: false })}
            >
              make new
            </button>
          )}
          <button
            type="button"
            onClick={() => onChange({ action: skip ? (line.tool_id ? "add" : "create") : "skip", confirm: false })}
          >
            {skip ? "count it" : "not stock"}
          </button>
        </div>
      </div>
    </div>
  );
}

const BILL_CSS = `
.tb-err, .tb-warn, .tb-block {
  margin:0; padding:11px 13px; border-radius:12px; font-size:12.5px; line-height:1.55;
}
.tb-err { background:#fef2f2; border:1px solid #fecaca; color:#991b1b; }
.tb-warn { background:#fffbeb; border:1px solid #fde68a; color:#92400e; }
.tb-block { background:var(--bg); border:1px solid var(--border); color:var(--muted); text-align:center; }

/* ── the drop target ─────────────────────────────────────────── */
.tb-drop {
  display:grid; gap:5px; justify-items:center; text-align:center; cursor:pointer;
  padding:30px 20px; border-radius:16px; border:2px dashed var(--border);
  background:var(--bg); transition:border-color .15s, background .15s;
}
.tb-drop:hover { border-color:var(--gold); background:var(--surface-alt); }
.tb-drop-icon { font-size:30px; line-height:1; }
.tb-drop-main { font-size:14px; font-weight:700; color:var(--text); word-break:break-all; }
.tb-drop-sub { font-size:11.5px; color:var(--muted); }

.tb-working { display:flex; gap:12px; align-items:flex-start; padding:13px;
  border-radius:12px; background:var(--surface-alt); border:1px solid var(--border-light); }
.tb-working b { font-size:13px; }
.tb-working p { margin:3px 0 0; font-size:12px; color:var(--muted); line-height:1.5; }
.tb-spin { width:16px; height:16px; flex:0 0 auto; margin-top:2px; border-radius:50%;
  border:2px solid var(--border); border-top-color:var(--gold); animation:tb-spin .7s linear infinite; }
@keyframes tb-spin { to { transform:rotate(360deg); } }

.tb-fine { margin:0; padding-left:18px; display:grid; gap:5px;
  font-size:11.5px; color:var(--muted); line-height:1.5; }
.tb-fine-one { margin:0; font-size:11px; color:var(--muted); line-height:1.5; }

/* ── the bill header ─────────────────────────────────────────── */
.tb-head {
  display:flex; flex-wrap:wrap; gap:12px; justify-content:space-between; align-items:flex-start;
  padding:13px 14px; border-radius:13px; background:var(--surface-alt); border:1px solid var(--border-light);
}
.tb-head-id { min-width:0; display:grid; gap:3px; }
.tb-head-id b { font-size:14.5px; letter-spacing:-0.01em; }
.tb-head-id span { font-size:11.5px; color:var(--muted); }
.tb-head-money { display:grid; grid-template-columns:auto auto; gap:2px 10px;
  font-size:12px; font-variant-numeric:tabular-nums; }
.tb-head-money [data-k] { color:var(--muted); }
.tb-head-money span:nth-child(even), .tb-head-money b { text-align:right; }

.tb-conf { display:grid; gap:3px; padding:10px 13px; border-radius:12px; font-size:12px; line-height:1.5; }
.tb-conf b { font-size:12.5px; }
.tb-conf em { font-style:normal; opacity:.85; }
.tb-conf[data-tone="green"] { background:#f0fdf4; border:1px solid #bbf7d0; color:#166534; }
.tb-conf[data-tone="amber"] { background:#fffbeb; border:1px solid #fde68a; color:#92400e; }
.tb-conf[data-tone="red"]   { background:#fef2f2; border:1px solid #fecaca; color:#991b1b; }

/* ── the lines ───────────────────────────────────────────────── */
.tb-rows { display:grid; gap:7px; }
.tb-row {
  display:grid; gap:9px; padding:11px 12px; border-radius:12px;
  background:var(--surface); border:1px solid var(--border);
  border-left:3px solid var(--border);
}
.tb-row[data-tone="green"] { border-left-color:#22c55e; }
.tb-row[data-tone="amber"] { border-left-color:#f59e0b; background:#fffdf5; }
.tb-row[data-tone="grey"]  { border-left-color:var(--border); }
.tb-row[data-skip] { opacity:.6; }

.tb-row-raw { min-width:0; display:grid; gap:3px; }
.tb-row-raw code {
  font-family:ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size:12.5px; color:var(--text); word-break:break-word; line-height:1.4;
}
.tb-row-meta { font-size:11px; color:var(--muted); font-variant-numeric:tabular-nums; }

.tb-row-decide { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
.tb-badge {
  flex:0 0 auto; border:none; cursor:pointer; font:inherit; padding:3px 8px; border-radius:999px;
  font-size:9.5px; font-weight:800; letter-spacing:.08em;
}
.tb-badge[data-tone="green"] { background:#dcfce7; color:#166534; }
.tb-badge[data-tone="amber"] { background:#fef3c7; color:#92400e; }
.tb-badge[data-tone="grey"]  { background:var(--bg); color:var(--muted); }

.tb-in {
  font:inherit; font-size:13px; padding:7px 9px; border-radius:9px;
  border:1px solid var(--border); background:var(--surface); color:var(--text);
}
.tb-in:focus { outline:2px solid var(--gold); outline-offset:-1px; }
.tb-in-tool { flex:1 1 200px; min-width:0; }
.tb-in-name { flex:1 1 180px; min-width:0; }
.tb-in-unit { width:72px; flex:0 0 auto; }
.tb-in-qty { width:84px; text-align:right; font-variant-numeric:tabular-nums; font-weight:700; }
.tb-in-qty[data-bad] { border-color:#f87171; background:#fef2f2; }

.tb-new { display:flex; flex-wrap:wrap; gap:7px; align-items:center; flex:1 1 auto; min-width:0; }
.tb-tick { display:inline-flex; align-items:center; gap:6px; font-size:12px;
  font-weight:700; color:#92400e; cursor:pointer; white-space:nowrap; }
.tb-tick input { width:17px; height:17px; accent-color:#f59e0b; cursor:pointer; }
.tb-row[data-tone="green"] .tb-tick { color:#166534; }

.tb-row-skip { font-size:12px; color:var(--muted); }
.tb-row-qty { display:flex; gap:8px; align-items:center; justify-content:space-between; flex-wrap:wrap; }
.tb-row-switch { display:flex; gap:6px; flex-wrap:wrap; }
.tb-row-switch button {
  border:1px solid var(--border); background:var(--bg); color:var(--muted);
  font:inherit; font-size:11px; padding:5px 9px; border-radius:8px; cursor:pointer;
}
.tb-row-switch button:hover:not(:disabled) { border-color:var(--gold); color:var(--text); }
.tb-row-switch button:disabled { opacity:.45; cursor:not-allowed; }

.tb-why { margin:0; padding:10px 13px; border-radius:11px; font-size:12px; line-height:1.55;
  background:var(--surface-alt); border:1px solid var(--border-light); color:var(--text); }
.tb-why button { border:none; background:none; color:var(--gold); font:inherit;
  font-size:12px; text-decoration:underline; cursor:pointer; padding:0; }

/* On a wide screen a line reads across in one go: evidence, decision,
   quantity. On a phone it stacks, because three columns at 360px is
   three unreadable columns. */
@media (min-width: 720px) {
  .tb-row { grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr) auto; align-items:center; gap:12px; }
  .tb-row-qty { justify-content:flex-end; flex-wrap:nowrap; }
}
`;
