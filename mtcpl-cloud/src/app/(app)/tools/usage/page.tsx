// ──────────────────────────────────────────────────────────────────
// /tools/usage — where the things that left the cupboard went (mig 238)
// ──────────────────────────────────────────────────────────────────
//
// Daksh, Nov 2026: "Mohit took 5 pcs of some tool, then this 5 pcs will
// show in his account. Now we have to connect this with our CNC. He will
// then do 1 pcs used in CNC no 14. This way we will have CNC wise
// consumption too."
//
// /tools answers "what is on the shelf". This screen answers the two
// questions that come after it:
//
//   IN THEIR HANDS   what each man took and has not accounted for. The
//                    pile that used to be invisible — neither in stock
//                    nor consumed.
//   USED ON MACHINES what was actually spent, machine by machine. The
//                    report he asked for.
//
// A server component on purpose: the window is a URL, so a month can be
// sent to somebody in a message and comes back the same month. No client
// state, no fetch after paint.
//
// The money is the last rate a SCANNED BILL carried for that tool (mig
// 237), and nothing else — this screen reads from the bill module and
// never from Finance, which is the line Daksh drew when the bill scan
// was built. A tool nobody has billed shows a dash, not a zero.
// ──────────────────────────────────────────────────────────────────

import Link from "next/link";
import { redirect } from "next/navigation";

import { requireAuth } from "@/lib/auth";
import { canUseCncTools } from "@/lib/cnc-tool-permissions";
import {
  USAGE_WINDOWS,
  USAGE_WINDOW_LABEL,
  USAGE_WINDOW_PHRASE,
  loadHoldings,
  loadMachineUsage,
  usageWindowRange,
  type UsageWindow,
} from "@/lib/cnc-tool-usage";

export const dynamic = "force-dynamic";

const money = (n: number) =>
  `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const qtyOf = (n: number) =>
  n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

export default async function ToolUsagePage({
  searchParams,
}: {
  searchParams: Promise<{ w?: string }>;
}) {
  const { profile } = await requireAuth();
  if (!canUseCncTools(profile)) redirect("/");

  const { w } = await searchParams;
  const win: UsageWindow = (USAGE_WINDOWS as readonly string[]).includes(w ?? "")
    ? (w as UsageWindow)
    : "month";
  const { fromIso, toIso } = usageWindowRange(win);

  const [holdings, report] = await Promise.all([
    loadHoldings(),
    loadMachineUsage(fromIso, toIso),
  ]);

  const outTotal = holdings.reduce((a, p) => a + p.total, 0);

  // Company by company, which is the grain the CNC costing page already
  // works in — so the two screens can be read side by side.
  const byVendor = new Map<string, { qty: number; value: number }>();
  for (const m of report.machines) {
    const key = m.vendorName ?? "Unassigned";
    const prev = byVendor.get(key) ?? { qty: 0, value: 0 };
    byVendor.set(key, { qty: prev.qty + m.qty, value: prev.value + m.value });
  }
  const vendors = [...byVendor].sort((a, b) => b[1].qty - a[1].qty);

  return (
    <section className="page-fluid tu-page allow-portrait">
      <style>{CSS}</style>

      <header className="tu-head">
        <div>
          <h1 className="tu-title">Out of the cupboard</h1>
          <p className="tu-sub">
            What the men are holding, and what has actually been spent on the
            machines. The shelf itself is on the <Link href="/tools">tool store</Link>.
          </p>
        </div>
        <Link href="/tools" className="tu-btn">← Tool store</Link>
      </header>

      {/* ── in their hands ──────────────────────────────────────── */}
      <h2 className="tu-h2">
        In their hands
        {outTotal > 0 && <i>{qtyOf(outTotal)} pcs with {holdings.length} {holdings.length === 1 ? "man" : "men"}</i>}
      </h2>
      <p className="tu-note">
        Taken from the shelf and not yet reported used or given back. This is
        not stock and it is not consumption — it is the pile in between, which
        is why the men are asked what happened to it.
      </p>

      {holdings.length === 0 ? (
        <div className="tu-blank">
          Nobody is holding anything. Everything taken has been accounted for.
        </div>
      ) : (
        <div className="tu-people">
          {holdings.map((p) => (
            <div key={p.key} className="tu-person">
              <div className="tu-person-head">
                <span className="tu-person-who">
                  <strong>{p.name}</strong>
                  <em>{p.company ?? "Office"}</em>
                </span>
                <span className="tu-person-n">
                  <b>{qtyOf(p.total)}</b>
                  <i>pcs</i>
                </span>
              </div>
              <ul className="tu-lines">
                {p.items.map((h) => (
                  <li key={h.toolId}>
                    <span className="tu-tool">{h.name}</span>
                    {h.spec && <span className="tu-spec">{h.spec}</span>}
                    <span className="tu-qty">{qtyOf(h.qty)} {h.unit}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {/* ── used on machines ────────────────────────────────────── */}
      <h2 className="tu-h2 tu-h2-gap">Used on machines</h2>

      <div className="tu-seg" role="group" aria-label="Which period">
        {USAGE_WINDOWS.map((k) => (
          <Link
            key={k}
            href={`/tools/usage?w=${k}`}
            className={k === win ? "on" : ""}
            // The current one is where you already are.
            aria-current={k === win ? "page" : undefined}
          >
            {USAGE_WINDOW_LABEL[k]}
          </Link>
        ))}
      </div>

      {report.machines.length === 0 ? (
        <div className="tu-blank">
          Nothing reported used {USAGE_WINDOW_PHRASE[win]}.
          {" "}The men report it at the cupboard QR, on the tool they are holding.
        </div>
      ) : (
        <>
          <div className="tu-kpis">
            <div className="tu-kpi">
              <span>Spent</span>
              <b>{qtyOf(report.totalQty)}</b>
              <i>pcs over {report.machines.length} machine{report.machines.length === 1 ? "" : "s"}</i>
            </div>
            <div className="tu-kpi">
              <span>At the last billed rate</span>
              <b>{report.totalValue > 0 ? money(report.totalValue) : "—"}</b>
              <i>
                {report.unpricedTools > 0
                  ? `${report.unpricedTools} tool${report.unpricedTools === 1 ? "" : "s"} never billed, so this is a floor`
                  : "every tool priced from a scanned bill"}
              </i>
            </div>
            {vendors.map(([name, v]) => (
              <div key={name} className="tu-kpi">
                <span>{name}</span>
                <b>{qtyOf(v.qty)}</b>
                <i>pcs{v.value > 0 ? ` · ${money(v.value)}` : ""}</i>
              </div>
            ))}
          </div>

          <div className="tu-machines">
            {report.machines.map((m) => (
              <div key={m.machineId} className="tu-machine">
                <div className="tu-machine-head">
                  <span className="tu-code">{m.code}</span>
                  <span className="tu-machine-who">
                    <strong>{m.vendorName ?? "Unassigned"}</strong>
                    <em>{m.machineType === "lathe" ? "Lathe" : m.machineType.replace(/_/g, " ")}</em>
                  </span>
                  <span className="tu-machine-n">
                    <b>{qtyOf(m.qty)}</b>
                    <i>pcs</i>
                  </span>
                  <span className="tu-machine-v">
                    {m.value > 0 ? money(m.value) : "—"}
                    {m.partlyPriced && m.value > 0 && <em>+ unpriced</em>}
                  </span>
                </div>
                <ul className="tu-lines">
                  {m.lines.map((l) => (
                    <li key={l.toolId}>
                      <span className="tu-tool">{l.name}</span>
                      {l.spec && <span className="tu-spec">{l.spec}</span>}
                      <span className="tu-qty">{qtyOf(l.qty)} {l.unit}</span>
                      <span className="tu-val">{l.value == null ? "—" : money(l.value)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {report.orphanQty > 0 && (
            <p className="tu-note">
              {qtyOf(report.orphanQty)} pcs are filed against a machine that is
              no longer listed. Tell the office — a machine row should never be
              deleted once anything has been spent on it.
            </p>
          )}
        </>
      )}
    </section>
  );
}

const CSS = `
.tu-page { padding-bottom:60px; }

.tu-head {
  display:flex; align-items:flex-start; justify-content:space-between;
  gap:16px; flex-wrap:wrap; margin-bottom:18px;
  padding-bottom:14px; border-bottom:1px solid var(--border);
}
.tu-title { font-size:20px; font-weight:700; letter-spacing:-.01em; margin:0; color:var(--text); }
.tu-sub { font-size:13px; color:var(--muted); margin:4px 0 0; line-height:1.55; max-width:62ch; }
.tu-sub a { color:var(--gold-dark); text-decoration:underline; text-underline-offset:2px; }
.tu-btn {
  display:inline-flex; align-items:center; gap:7px; padding:8px 14px; font-size:13px;
  font-weight:600; border-radius:var(--radius); text-decoration:none; white-space:nowrap;
  border:1px solid var(--border); background:var(--surface); color:var(--text);
}
.tu-btn:hover { background:var(--surface-alt); border-color:var(--muted-light); }

.tu-h2 {
  display:flex; align-items:baseline; gap:10px; flex-wrap:wrap;
  font-size:15px; font-weight:700; color:var(--text); margin:0 0 6px;
}
.tu-h2-gap { margin-top:30px; padding-top:22px; border-top:1px solid var(--border); }
.tu-h2 i {
  font-style:normal; font-size:12px; font-weight:600; color:var(--muted);
  font-variant-numeric:tabular-nums;
}
.tu-note { font-size:12.5px; color:var(--muted); line-height:1.55; margin:0 0 14px; max-width:70ch; }

.tu-blank {
  padding:22px 16px; border-radius:var(--radius); text-align:center;
  background:var(--surface-alt); border:1px dashed var(--border);
  color:var(--muted); font-size:13px; line-height:1.6;
}

/* ── who is holding what ───────────────────────────────────────── */
.tu-people { display:grid; grid-template-columns:repeat(auto-fill, minmax(290px, 1fr)); gap:12px; }
.tu-person {
  background:var(--surface); border:1px solid var(--border); border-radius:var(--radius);
  border-left:3px solid var(--gold); overflow:hidden;
}
.tu-person-head {
  display:flex; align-items:center; gap:12px;
  padding:10px 13px; border-bottom:1px solid var(--border); background:var(--surface-alt);
}
.tu-person-who { min-width:0; display:flex; flex-direction:column; gap:1px; }
.tu-person-who strong { font-size:13.5px; font-weight:700; color:var(--text); }
.tu-person-who em {
  font-style:normal; font-size:11px; color:var(--muted);
  text-transform:uppercase; letter-spacing:.05em; font-weight:600;
}
.tu-person-n {
  margin-left:auto; flex:none; display:flex; align-items:baseline; gap:3px;
  font-variant-numeric:tabular-nums;
}
.tu-person-n b { font-size:18px; font-weight:800; color:var(--text); }
.tu-person-n i { font-style:normal; font-size:10.5px; color:var(--muted); }

/* ── the tool lines, shared by both halves ─────────────────────── */
.tu-lines { list-style:none; margin:0; padding:0; }
.tu-lines li {
  display:flex; align-items:baseline; gap:9px; padding:8px 13px;
  border-top:1px solid var(--border); font-size:12.5px;
}
.tu-lines li:first-child { border-top:none; }
.tu-tool {
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  font-weight:600; color:var(--text); font-variant-numeric:tabular-nums;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0;
}
.tu-spec { font-size:11px; color:var(--muted); white-space:nowrap; }
.tu-qty {
  margin-left:auto; flex:none; font-weight:700; color:var(--text);
  font-variant-numeric:tabular-nums; white-space:nowrap;
}
.tu-val {
  flex:none; min-width:76px; text-align:right; color:var(--gold-dark);
  font-weight:600; font-variant-numeric:tabular-nums;
}

/* ── the numbers above the machines ────────────────────────────── */
.tu-seg {
  display:inline-flex; gap:2px; padding:3px; border-radius:var(--radius);
  background:var(--surface-alt); border:1px solid var(--border); margin-bottom:16px;
  flex-wrap:wrap;
}
.tu-seg a {
  padding:7px 14px; font-size:12.5px; font-weight:600; border-radius:var(--radius-sm);
  color:var(--muted); text-decoration:none; white-space:nowrap;
}
.tu-seg a:hover { color:var(--text); }
.tu-seg a.on { background:var(--surface); color:var(--text); box-shadow:0 1px 2px rgba(45,36,16,.09); }

.tu-kpis { display:grid; grid-template-columns:repeat(auto-fill, minmax(190px, 1fr)); gap:10px; margin-bottom:16px; }
.tu-kpi {
  padding:11px 13px; border-radius:var(--radius);
  background:var(--surface); border:1px solid var(--border);
  display:flex; flex-direction:column; gap:2px;
}
.tu-kpi > span {
  font-size:10.5px; font-weight:700; letter-spacing:.06em; text-transform:uppercase;
  color:var(--muted);
}
.tu-kpi > b { font-size:21px; font-weight:800; color:var(--text); font-variant-numeric:tabular-nums; line-height:1.15; }
.tu-kpi > i { font-style:normal; font-size:11px; color:var(--muted); line-height:1.45; }

/* ── machine by machine ────────────────────────────────────────── */
.tu-machines { display:flex; flex-direction:column; gap:10px; }
.tu-machine { background:var(--surface); border:1px solid var(--border); border-radius:var(--radius); overflow:hidden; }
.tu-machine-head {
  display:flex; align-items:center; gap:12px; flex-wrap:wrap;
  padding:10px 13px; border-bottom:1px solid var(--border); background:var(--surface-alt);
}
/* The machine NUMBER leads, because that is how the shed says it —
   "cnc no 14", never "the MANTHAN multi-head". */
.tu-code {
  flex:none; min-width:46px; padding:5px 9px; border-radius:var(--radius-sm);
  background:var(--text); color:#fff; text-align:center;
  font-size:15px; font-weight:800; font-variant-numeric:tabular-nums;
}
.tu-machine-who { min-width:0; display:flex; flex-direction:column; gap:1px; }
.tu-machine-who strong { font-size:13px; font-weight:700; color:var(--text); }
.tu-machine-who em {
  font-style:normal; font-size:10.5px; color:var(--muted);
  text-transform:capitalize;
}
.tu-machine-n {
  margin-left:auto; flex:none; display:flex; align-items:baseline; gap:3px;
  font-variant-numeric:tabular-nums;
}
.tu-machine-n b { font-size:17px; font-weight:800; color:var(--text); }
.tu-machine-n i { font-style:normal; font-size:10.5px; color:var(--muted); }
.tu-machine-v {
  flex:none; min-width:92px; text-align:right; display:flex; flex-direction:column;
  font-size:14px; font-weight:700; color:var(--gold-dark); font-variant-numeric:tabular-nums;
}
.tu-machine-v em { font-style:normal; font-size:10px; font-weight:600; color:var(--muted); }

@media (max-width: 620px) {
  .tu-people { grid-template-columns:1fr; }
  .tu-val { min-width:62px; }
  .tu-machine-v { min-width:72px; }
  .tu-spec { display:none; }
}
`;
