"use client";

/**
 * Every bill that has been scanned, newest first.
 *
 * A card per bill, closed: supplier, number, date, total, and what it
 * did to the shelf. Opened: every line as printed, what we decided it
 * was, and how we decided — which is the only honest way to show the
 * output of a model that sometimes gets a line wrong.
 *
 * The RAW text is the left-hand column and never the match, because the
 * raw text is the evidence. If the two disagree the eye should land on
 * the paper's own words first.
 *
 * The paper itself is behind a button, not an <img>: the bucket is
 * private because these lines carry supplier rates, so the file is
 * fetched as a short-lived signed URL only when somebody asks for it.
 */

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";

import { toolBillDocUrlAction } from "../bill-actions";

export type BillLineRow = {
  id: string;
  lineNo: number;
  /** As printed. Never cleaned up — it is the evidence. */
  rawText: string;
  rawQty: number | null;
  rawUnit: string | null;
  rate: number | null;
  amount: number | null;
  hsn: string | null;
  /** Null when the line was not matched to anything on the shelf. */
  toolName: string | null;
  qty: number | null;
  outcome: string | null;
  createdTool: boolean;
  aiNote: string | null;
};

export type BillCard = {
  id: string;
  supplier: string | null;
  gstin: string | null;
  billNo: string | null;
  billDate: string | null;
  subtotal: number | null;
  gst: number | null;
  total: number | null;
  hasDoc: boolean;
  model: string | null;
  confidence: string | null;
  status: "draft" | "posted" | "discarded";
  note: string | null;
  /** Posted, discarded, or failing both, scanned. */
  at: string;
  scannedAt: string;
  lines: BillLineRow[];
  posted: number;
  skipped: number;
};

type Filter = "all" | "posted" | "draft" | "discarded";

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "all", label: "All" },
  { key: "posted", label: "Put in" },
  { key: "draft", label: "Not finished" },
  { key: "discarded", label: "Thrown away" },
];

const STATUS_WORD: Record<BillCard["status"], string> = {
  posted: "Put in",
  draft: "Not finished",
  discarded: "Thrown away",
};

/** How the line was matched. Spelled out, because "fuzzy" on its own
 *  tells a storekeeper nothing about whether to trust it. */
const OUTCOME_WORD: Record<string, string> = {
  alias: "their code, learned",
  exact: "name matched",
  fuzzy: "close name",
  ai: "AI read it",
  new: "new tool made",
  manual: "picked by hand",
  skipped: "not stock",
};

const money = (n: number | null) =>
  n === null ? "—" : `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const qtyOf = (n: number | null) =>
  n === null ? "—" : n.toLocaleString("en-IN", { maximumFractionDigits: 3 });

function dayOf(iso: string | null): string {
  if (!iso) return "no date";
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return "no date";
  return d.toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
}

export function BillsClient({ bills }: { bills: BillCard[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [find, setFind] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const counts = useMemo(() => {
    const c = { all: bills.length, posted: 0, draft: 0, discarded: 0 };
    for (const b of bills) c[b.status] += 1;
    return c;
  }, [bills]);

  const shown = useMemo(() => {
    const needle = find.trim().toLowerCase();
    return bills.filter((b) => {
      if (filter !== "all" && b.status !== filter) return false;
      if (!needle) return true;
      return (
        (b.supplier ?? "").toLowerCase().includes(needle) ||
        (b.billNo ?? "").toLowerCase().includes(needle) ||
        (b.gstin ?? "").toLowerCase().includes(needle) ||
        // The lines matter as much as the header: "which bill did that
        // 450mm wheel come in on" is the question people actually have.
        b.lines.some(
          (l) =>
            l.rawText.toLowerCase().includes(needle) ||
            (l.toolName ?? "").toLowerCase().includes(needle),
        )
      );
    });
  }, [bills, filter, find]);

  /** Only over what is on screen, and only over bills that actually
   *  went in — a draft's total is a number the AI read off a photo and
   *  nobody has agreed to yet. */
  const spend = useMemo(
    () => shown.reduce((s, b) => (b.status === "posted" ? s + (b.total ?? 0) : s), 0),
    [shown],
  );

  function openDoc(billId: string) {
    setErr(null);
    setOpening(billId);
    startTransition(async () => {
      const r = await toolBillDocUrlAction(billId);
      setOpening(null);
      if (!r.ok) { setErr(r.error); return; }
      window.open(r.url, "_blank", "noopener,noreferrer");
    });
  }

  return (
    <section className="page-fluid tb-page allow-portrait">
      <style>{CSS}</style>

      <header className="tb-head">
        <div>
          <h1 className="tb-title">Scanned bills</h1>
          <p className="tb-sub">
            Every supplier bill read into the store, what it put on the shelf,
            and what we paid. The shelf itself is on the{" "}
            <Link href="/tools">tool store</Link>.
          </p>
        </div>
        <Link href="/tools" className="tb-back">← Tool store</Link>
      </header>

      {err && <div className="tb-err">{err}</div>}

      <div className="tb-bar">
        <div className="tb-tabs" role="group" aria-label="Which bills">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              data-on={filter === f.key ? "1" : undefined}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
              <i>{counts[f.key]}</i>
            </button>
          ))}
        </div>
        <input
          className="tb-find"
          value={find}
          onChange={(e) => setFind(e.target.value)}
          placeholder="Supplier, bill number, or a tool on it…"
          aria-label="Find a bill"
        />
      </div>

      {spend > 0 && (
        <p className="tb-spend">
          <b>{money(spend)}</b> across {shown.filter((b) => b.status === "posted").length} bills
          that went in.
        </p>
      )}

      {shown.length === 0 ? (
        <div className="tb-blank">
          {bills.length === 0
            ? "No bill has been scanned yet. Scan one from the tool store."
            : "No bill matches that."}
        </div>
      ) : (
        <div className="tb-list">
          {shown.map((b) => {
            const isOpen = open === b.id;
            return (
              <article key={b.id} className="tb-card" data-status={b.status}>
                <button
                  type="button"
                  className="tb-card-head"
                  onClick={() => setOpen(isOpen ? null : b.id)}
                  aria-expanded={isOpen}
                >
                  <span className="tb-who">
                    <strong>{b.supplier ?? "Supplier not read"}</strong>
                    <em>
                      {b.billNo ? `Bill ${b.billNo}` : "no bill number"} · {dayOf(b.billDate)}
                    </em>
                  </span>

                  <span className="tb-facts">
                    <span className="tb-state" data-status={b.status}>
                      {STATUS_WORD[b.status]}
                    </span>
                    {b.posted > 0 && (
                      <span className="tb-n">
                        <b>{b.posted}</b> {b.posted === 1 ? "line" : "lines"} in
                      </span>
                    )}
                    {b.skipped > 0 && <span className="tb-n tb-n-skip">{b.skipped} skipped</span>}
                    <span className="tb-total">{money(b.total)}</span>
                    <span className="tb-caret" aria-hidden>{isOpen ? "▾" : "▸"}</span>
                  </span>
                </button>

                {isOpen && (
                  <div className="tb-open">
                    <div className="tb-meta">
                      {b.gstin && <span>GSTIN {b.gstin}</span>}
                      <span>Scanned {dayOf(b.scannedAt)}</span>
                      {b.confidence && (
                        <span className="tb-conf" data-c={b.confidence}>
                          read {b.confidence}
                        </span>
                      )}
                      {b.model && <span className="tb-model">{b.model}</span>}
                      {b.subtotal !== null && <span>Goods {money(b.subtotal)}</span>}
                      {b.gst !== null && <span>GST {money(b.gst)}</span>}
                      {b.hasDoc ? (
                        <button
                          type="button"
                          className="tb-doc"
                          onClick={() => openDoc(b.id)}
                          disabled={opening === b.id}
                        >
                          {opening === b.id ? "Opening…" : "📄 Open the bill"}
                        </button>
                      ) : (
                        <span className="tb-nodoc">no image kept</span>
                      )}
                    </div>

                    {b.note && <p className="tb-note">{b.note}</p>}

                    {b.lines.length === 0 ? (
                      <div className="tb-blank tb-blank-sm">
                        No lines were kept for this one.
                      </div>
                    ) : (
                      <div className="tb-lines">
                        <div className="tb-lrow tb-lhead">
                          <span>As printed</span>
                          <span>Qty</span>
                          <span>Rate</span>
                          <span>Amount</span>
                          <span>Went in as</span>
                        </div>
                        {b.lines.map((l) => (
                          <div
                            key={l.id}
                            className="tb-lrow"
                            data-skip={l.outcome === "skipped" ? "1" : undefined}
                          >
                            <span className="tb-raw">
                              {l.rawText}
                              {l.hsn && <i className="tb-hsn">HSN {l.hsn}</i>}
                            </span>
                            <span className="tb-num">
                              {qtyOf(l.rawQty)}
                              {l.rawUnit && <i> {l.rawUnit}</i>}
                            </span>
                            <span className="tb-num">{money(l.rate)}</span>
                            <span className="tb-num">{money(l.amount)}</span>
                            <span className="tb-match">
                              {l.toolName ? (
                                <>
                                  <b>{l.toolName}</b>
                                  {l.qty !== null && <i> · {qtyOf(l.qty)} pcs</i>}
                                </>
                              ) : (
                                <em>{l.outcome === "skipped" ? "not stock" : "no match"}</em>
                              )}
                              {l.outcome && (
                                <span className="tb-how" data-o={l.outcome}>
                                  {OUTCOME_WORD[l.outcome] ?? l.outcome}
                                  {l.createdTool && " · new"}
                                </span>
                              )}
                              {l.aiNote && <span className="tb-ai">{l.aiNote}</span>}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

const CSS = `
.tb-page { display:flex; flex-direction:column; gap:0; }

.tb-head { display:flex; align-items:flex-start; justify-content:space-between;
  gap:16px; flex-wrap:wrap; margin-bottom:18px; }
.tb-title { font-size:20px; font-weight:700; letter-spacing:-.01em; color:var(--text); }
.tb-sub { font-size:13px; color:var(--muted); margin-top:4px; max-width:60ch;
  line-height:1.55; }
.tb-sub a { color:var(--gold-dark); font-weight:600; }
.tb-back { flex:0 0 auto; padding:8px 14px; border-radius:999px; font-size:12.5px;
  font-weight:700; color:var(--text); background:var(--surface);
  border:1px solid var(--border); text-decoration:none; }
.tb-back:hover { border-color:var(--gold); color:var(--gold-dark); }

.tb-err { padding:11px 15px; margin-bottom:14px; border-radius:var(--radius);
  font-size:13px; font-weight:600; background:var(--danger-bg); color:var(--danger);
  border:1px solid var(--danger); }

.tb-bar { display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:12px; }
.tb-tabs { display:inline-flex; padding:3px; gap:2px; border-radius:999px;
  background:var(--surface-alt); border:1px solid var(--border); }
.tb-tabs button { display:inline-flex; align-items:center; gap:7px; padding:7px 14px;
  border-radius:999px; border:none; cursor:pointer; font:inherit; font-size:12.5px;
  font-weight:700; color:var(--muted); background:transparent; white-space:nowrap; }
.tb-tabs button i { font-style:normal; font-size:11px; font-variant-numeric:tabular-nums;
  opacity:.75; }
.tb-tabs button:hover { color:var(--text); }
.tb-tabs button[data-on] { background:var(--surface); color:var(--text);
  box-shadow:0 1px 2px rgba(45,36,16,.14); }
.tb-find { flex:1; min-width:220px; padding:9px 15px; border-radius:999px;
  border:1px solid var(--border); background:var(--surface); font:inherit;
  font-size:13px; color:var(--text); }
.tb-find:focus { outline:none; border-color:var(--gold);
  box-shadow:0 0 0 3px var(--gold-subtle); }
.tb-find::placeholder { color:var(--muted-light); }

.tb-spend { font-size:12.5px; color:var(--muted); margin-bottom:14px; }
.tb-spend b { font-size:16px; color:var(--text); font-variant-numeric:tabular-nums; }

.tb-blank { padding:34px 18px; text-align:center; font-size:13.5px; color:var(--muted);
  border:1px dashed var(--border); border-radius:var(--radius); }
.tb-blank-sm { padding:18px; font-size:12.5px; margin-top:10px; }

.tb-list { display:flex; flex-direction:column; gap:9px; }
.tb-card { border:1px solid var(--border); border-radius:var(--radius);
  background:var(--surface); overflow:hidden; }
.tb-card[data-status="discarded"] { opacity:.62; }

.tb-card-head { width:100%; display:flex; align-items:center; justify-content:space-between;
  gap:16px; flex-wrap:wrap; padding:13px 16px; cursor:pointer; font:inherit;
  text-align:left; background:none; border:none; }
.tb-card-head:hover { background:var(--surface-alt); }
.tb-who { display:flex; flex-direction:column; gap:3px; min-width:0; flex:1; }
.tb-who strong { font-size:14.5px; font-weight:700; color:var(--text);
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.tb-who em { font-style:normal; font-size:11.5px; color:var(--muted); }

.tb-facts { display:flex; align-items:center; gap:11px; flex-wrap:wrap; flex:0 0 auto; }
.tb-state { font-size:9.5px; font-weight:700; letter-spacing:.06em; text-transform:uppercase;
  padding:4px 9px; border-radius:999px; }
.tb-state[data-status="posted"]    { background:var(--success-bg); color:var(--success); }
.tb-state[data-status="draft"]     { background:var(--warning-bg); color:var(--warning); }
.tb-state[data-status="discarded"] { background:var(--surface-alt); color:var(--muted); }
.tb-n { font-size:11.5px; font-weight:700; color:var(--muted); }
.tb-n b { font-size:13.5px; color:var(--text); font-variant-numeric:tabular-nums; }
.tb-n-skip { color:var(--muted-light); }
.tb-total { font-size:15px; font-weight:700; color:var(--text);
  font-variant-numeric:tabular-nums; min-width:92px; text-align:right; }
.tb-caret { font-size:11px; color:var(--muted); }

.tb-open { padding:0 16px 15px; border-top:1px solid var(--border-light); }
.tb-meta { display:flex; align-items:center; gap:8px 15px; flex-wrap:wrap;
  padding:12px 0; font-size:11.5px; color:var(--muted); }
.tb-conf[data-c="high"]   { color:var(--success); font-weight:700; }
.tb-conf[data-c="medium"] { color:var(--warning); font-weight:700; }
.tb-conf[data-c="low"]    { color:var(--danger);  font-weight:700; }
.tb-model { font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:10.5px;
  color:var(--muted-light); }
.tb-nodoc { font-style:italic; color:var(--muted-light); }
.tb-doc { padding:6px 13px; border-radius:999px; cursor:pointer; font:inherit;
  font-size:12px; font-weight:700; color:var(--text); background:var(--surface);
  border:1px solid var(--border); }
.tb-doc:hover:not(:disabled) { border-color:var(--gold); color:var(--gold-dark); }
.tb-doc:disabled { opacity:.6; cursor:default; }
.tb-note { font-size:12.5px; color:var(--text); font-style:italic; margin-bottom:10px; }

.tb-lines { display:flex; flex-direction:column; border:1px solid var(--border);
  border-radius:var(--radius); overflow:hidden; }
.tb-lrow { display:grid; grid-template-columns:minmax(0,2.4fr) 84px 96px 104px minmax(0,2fr);
  gap:12px; padding:9px 13px; align-items:start; font-size:12.5px; }
.tb-lrow + .tb-lrow { border-top:1px solid var(--border-light); }
.tb-lhead { background:var(--surface-alt); font-size:9.5px; font-weight:700;
  letter-spacing:.07em; text-transform:uppercase; color:var(--muted); }
.tb-lhead span:nth-child(n+2):nth-child(-n+4) { text-align:right; }
.tb-lrow[data-skip] { background:var(--surface-alt); color:var(--muted); }
.tb-raw { font-weight:600; color:var(--text); overflow-wrap:anywhere; }
.tb-lrow[data-skip] .tb-raw { font-weight:500; color:var(--muted); }
.tb-hsn { display:block; font-style:normal; font-size:10px; font-weight:600;
  color:var(--muted-light); margin-top:2px; }
.tb-num { text-align:right; font-variant-numeric:tabular-nums; color:var(--text);
  white-space:nowrap; }
.tb-num i { font-style:normal; font-size:10.5px; color:var(--muted); }
.tb-lrow[data-skip] .tb-num { color:var(--muted); }
.tb-match { display:flex; flex-direction:column; gap:3px; min-width:0; }
.tb-match b { font-weight:700; color:var(--text); overflow-wrap:anywhere; }
.tb-match i { font-style:normal; font-size:11px; color:var(--muted); }
.tb-match em { font-style:italic; color:var(--muted); }
.tb-how { font-size:9.5px; font-weight:700; letter-spacing:.05em; text-transform:uppercase;
  color:var(--muted); }
/* The two that are a guess rather than a fact get the warning colour —
   a storekeeper checking a bill should know which lines to look at. */
.tb-how[data-o="fuzzy"], .tb-how[data-o="ai"] { color:var(--warning); }
.tb-how[data-o="new"] { color:var(--info); }
.tb-ai { font-size:10.5px; color:var(--muted-light); font-style:italic;
  overflow-wrap:anywhere; }

@media (max-width: 860px) {
  .tb-lrow { grid-template-columns:minmax(0,1fr) 70px 84px; }
  /* Amount drops before Rate: the rate is the number anybody is
     actually checking a bill for. */
  .tb-lrow > :nth-child(4) { display:none; }
  .tb-lrow > :nth-child(5) { grid-column:1 / -1; padding-top:4px;
    border-top:1px dashed var(--border-light); }
  .tb-lhead > :nth-child(5) { display:none; }
  .tb-total { min-width:0; }
}
`;
