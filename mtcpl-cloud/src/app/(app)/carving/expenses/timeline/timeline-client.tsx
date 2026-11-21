"use client";

/**
 * The grid itself. Twelve months across, one lane per row.
 *
 * Four states, and they are told apart by SHAPE before colour, because
 * the one thing this page exists to do is be read in two seconds from
 * across a desk:
 *
 *   ●  filled      money was entered        (hover for the amount)
 *   ◎  ringed      MISSED — see the page note for what earns this
 *   ·  faint dot   nothing, and nothing expected
 *   ◌  dashed      the month is still running
 *
 * Every cell is a link to that month's entry form. Seeing the hole and
 * then hunting for the month in a dropdown is most of the work; this
 * way the hole IS the way in.
 */

import Link from "next/link";
import { useMemo } from "react";

export type LaneKey = "tools" | "maintenance" | "labor";

export type TimelineVendor = {
  id: string;
  name: string;
  machines: number;
  lanes: {
    key: LaneKey;
    label: string;
    everFilled: boolean;
    months: { month: number; amount: number; missed: boolean }[];
  }[];
};

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const fmt = (n: number) =>
  "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

export function ExpenseTimelineClient({
  year,
  currentYear,
  currentMonth,
  vendors,
  plantElectricity,
  hiddenWithSpend,
}: {
  year: number;
  currentYear: number;
  currentMonth: number;
  vendors: TimelineVendor[];
  plantElectricity: { month: number; amount: number }[];
  hiddenWithSpend: string[];
}) {
  const totalMissed = useMemo(
    () =>
      vendors.reduce(
        (n, v) => n + v.lanes.reduce((m, l) => m + l.months.filter((x) => x.missed).length, 0),
        0,
      ),
    [vendors],
  );

  const isLive = (m: number) => year === currentYear && m === currentMonth;
  const isFuture = (m: number) => year > currentYear || (year === currentYear && m > currentMonth);

  return (
    <div className="page-content">
      <style>{CSS}</style>

      <div className="xt-head">
        <div className="xt-head-left">
          <Link href={`/carving/expenses?year=${year}&month=${currentMonth}`} className="xt-back">
            ← Back to entry
          </Link>
          <h1>Expense timeline</h1>
          <p>
            Every month of {year}, vendor by vendor. A ring is a month somebody
            filled in for that vendor and left this line out.
          </p>
        </div>

        <div className="xt-head-right">
          <div className="xt-years">
            <Link href={`?year=${year - 1}`} aria-label="Previous year">‹</Link>
            <strong>{year}</strong>
            <Link
              href={`?year=${year + 1}`}
              aria-label="Next year"
              aria-disabled={year >= currentYear}
              className={year >= currentYear ? "off" : ""}
            >
              ›
            </Link>
          </div>
          <div className={`xt-score${totalMissed > 0 ? " bad" : ""}`}>
            <b>{totalMissed}</b>
            <span>{totalMissed === 1 ? "month missed" : "months missed"}</span>
          </div>
        </div>
      </div>

      <div className="xt-legend">
        <span><i className="d in" /> entered</span>
        <span><i className="d miss" /> missed</span>
        <span><i className="d none" /> nothing</span>
        <span><i className="d live" /> still running</span>
        <em>Click any month to open its entry form.</em>
      </div>

      <div className="xt-scroll">
        <table className="xt">
          <thead>
            <tr>
              <th className="xt-lane-h" />
              {MON.map((m, i) => (
                <th key={m} className={isLive(i + 1) ? "now" : undefined}>
                  {m}
                </th>
              ))}
              <th className="xt-tot-h">Year</th>
            </tr>
          </thead>
          <tbody>
            {/* Plant electricity — one bill a month for the whole shed,
                and the easiest of the lot to forget because it belongs
                to nobody in particular. */}
            <tr className="xt-vendor-row">
              <td colSpan={14}>
                <span className="xt-vendor">⚡ Plant electricity</span>
                <span className="xt-sub">one bill a month, plant-wide</span>
              </td>
            </tr>
            <tr>
              <td className="xt-lane">Bill</td>
              {plantElectricity.map((c) => {
                const state = c.amount > 0 ? "in" : isLive(c.month) ? "live" : isFuture(c.month) ? "future" : "none";
                return (
                  <Cell
                    key={c.month}
                    year={year}
                    month={c.month}
                    state={state}
                    amount={c.amount}
                    label="Plant electricity"
                  />
                );
              })}
              <td className="xt-tot">
                {(() => {
                  const t = plantElectricity.reduce((s, c) => s + c.amount, 0);
                  return t > 0 ? fmt(t) : "—";
                })()}
              </td>
            </tr>

            {vendors.map((v) => (
              <FragmentRows
                key={v.id}
                v={v}
                year={year}
                isLive={isLive}
                isFuture={isFuture}
              />
            ))}
          </tbody>
        </table>
      </div>

      {hiddenWithSpend.length > 0 && (
        <p className="xt-hidden">
          Not shown: <strong>{hiddenWithSpend.join(", ")}</strong> — no CNC machines
          assigned, so no row in the costing breakdown either. There is spend
          recorded against {hiddenWithSpend.length === 1 ? "that name" : "those names"},
          so it is named here rather than quietly dropped.
        </p>
      )}

      {vendors.length === 0 && (
        <p className="xt-hidden">
          No CNC vendor has a machine assigned, so there is nothing to watch yet.
        </p>
      )}
    </div>
  );
}

function FragmentRows({
  v, year, isLive, isFuture,
}: {
  v: TimelineVendor;
  year: number;
  isLive: (m: number) => boolean;
  isFuture: (m: number) => boolean;
}) {
  const missed = v.lanes.reduce((n, l) => n + l.months.filter((m) => m.missed).length, 0);
  return (
    <>
      <tr className="xt-vendor-row">
        <td colSpan={14}>
          <span className="xt-vendor">{v.name}</span>
          <span className="xt-sub">{v.machines} machines</span>
          {missed > 0 && <span className="xt-flag">{missed} missed</span>}
        </td>
      </tr>
      {v.lanes.map((lane) => (
        <tr key={lane.key}>
          <td className="xt-lane">
            {lane.label}
            {/* Said once, on the lane, rather than on four identical
                empty cells: this is a line he has simply never kept. */}
            {!lane.everFilled && <i className="xt-never">never entered</i>}
          </td>
          {lane.months.map((c) => {
            const state = c.amount > 0
              ? "in"
              : c.missed
                ? "miss"
                : isLive(c.month)
                  ? "live"
                  : isFuture(c.month)
                    ? "future"
                    : "none";
            return (
              <Cell
                key={c.month}
                year={year}
                month={c.month}
                state={state}
                amount={c.amount}
                label={`${v.name} · ${lane.label}`}
              />
            );
          })}
          <td className="xt-tot">
            {(() => {
              const t = lane.months.reduce((s, c) => s + c.amount, 0);
              return t > 0 ? fmt(t) : "—";
            })()}
          </td>
        </tr>
      ))}
    </>
  );
}

function Cell({
  year, month, state, amount, label,
}: {
  year: number;
  month: number;
  state: "in" | "miss" | "none" | "live" | "future";
  amount: number;
  label: string;
}) {
  const title =
    state === "in"
      ? `${label} · ${MON[month - 1]} ${year} · ${fmt(amount)}`
      : state === "miss"
        ? `${label} · ${MON[month - 1]} ${year} · nothing entered, though this vendor's other lines were filled that month`
        : state === "live"
          ? `${MON[month - 1]} ${year} is still running`
          : state === "future"
            ? `${MON[month - 1]} ${year} has not happened yet`
            : `${label} · ${MON[month - 1]} ${year} · nothing entered`;

  // A future month is not a door into anything — there is nothing to
  // enter against it yet, and a link would invite somebody to try.
  if (state === "future") {
    return (
      <td className="xt-c">
        <span className="d future" title={title} />
      </td>
    );
  }

  return (
    <td className="xt-c">
      <Link
        href={`/carving/expenses?year=${year}&month=${month}`}
        title={title}
        aria-label={title}
      >
        <span className={`d ${state}`} />
      </Link>
    </td>
  );
}

const CSS = `
.xt-head { display:flex; align-items:flex-start; justify-content:space-between;
  gap:20px; flex-wrap:wrap; margin-bottom:14px; }
.xt-back { font-size:12.5px; font-weight:700; color:var(--gold-dark);
  text-decoration:none; }
.xt-back:hover { text-decoration:underline; }
.xt-head-left h1 { margin:6px 0 4px; font-size:21px; font-weight:800; color:var(--text); }
.xt-head-left p { margin:0; font-size:12.5px; color:var(--muted); line-height:1.55;
  max-width:60ch; }
.xt-head-right { display:flex; align-items:center; gap:12px; }

.xt-years { display:flex; align-items:center; gap:4px; background:var(--surface);
  border:1px solid var(--border); border-radius:var(--radius); padding:4px; }
.xt-years a { width:28px; height:28px; display:grid; place-items:center;
  border-radius:var(--radius-sm); color:var(--muted); text-decoration:none;
  font-size:16px; font-weight:700; }
.xt-years a:hover { background:var(--surface-alt); color:var(--text); }
.xt-years a.off { opacity:.3; pointer-events:none; }
.xt-years strong { min-width:52px; text-align:center; font-size:14px; font-weight:800; }

.xt-score { display:flex; flex-direction:column; align-items:center; padding:6px 14px;
  border-radius:var(--radius); background:var(--surface); border:1px solid var(--border); }
.xt-score b { font-size:20px; font-weight:800; line-height:1.1; color:var(--success); }
.xt-score span { font-size:10.5px; font-weight:700; text-transform:uppercase;
  letter-spacing:.06em; color:var(--muted); }
.xt-score.bad { background:var(--danger-bg); border-color:rgba(220,38,38,.25); }
.xt-score.bad b { color:var(--danger); }

.xt-legend { display:flex; align-items:center; gap:16px; flex-wrap:wrap;
  padding:9px 12px; margin-bottom:12px; border-radius:var(--radius);
  background:var(--surface); border:1px solid var(--border); font-size:11.5px;
  color:var(--muted); }
.xt-legend span { display:inline-flex; align-items:center; gap:6px; }
.xt-legend em { font-style:normal; margin-left:auto; color:var(--muted-light); }

.xt-scroll { overflow-x:auto; border:1px solid var(--border); border-radius:var(--radius);
  background:var(--surface); }
table.xt { width:100%; border-collapse:collapse; }
table.xt th { font-size:10.5px; font-weight:800; text-transform:uppercase;
  letter-spacing:.06em; color:var(--muted); padding:10px 0; text-align:center;
  border-bottom:1px solid var(--border); }
table.xt th.now { color:var(--gold-dark); }
.xt-lane-h { width:190px; }
.xt-tot-h { width:104px; text-align:right !important; padding-right:14px !important; }

.xt-vendor-row td { padding:12px 14px 7px; border-bottom:1px solid var(--border); }
.xt-vendor { font-size:13px; font-weight:800; color:var(--text); letter-spacing:.01em; }
.xt-sub { margin-left:9px; font-size:11px; color:var(--muted); }
.xt-flag { margin-left:10px; padding:2px 8px; border-radius:999px; font-size:10.5px;
  font-weight:800; background:var(--danger-bg); color:var(--danger); }

.xt-lane { padding:7px 14px; font-size:12.5px; color:var(--text); white-space:nowrap; }
.xt-never { display:block; font-style:normal; font-size:10.5px; color:var(--muted-light); }
.xt-c { text-align:center; padding:6px 0; }
.xt-c a { display:grid; place-items:center; height:26px; border-radius:var(--radius-sm); }
.xt-c a:hover { background:var(--surface-alt); }
.xt-tot { text-align:right; padding:7px 14px; font-size:12px; font-weight:700;
  font-family:ui-monospace, SFMono-Regular, Menlo, monospace; color:var(--text);
  white-space:nowrap; }

/* Shape first, colour second — this is read at a glance and about a
   fifth of men are colour-blind. */
.d { display:inline-block; width:13px; height:13px; border-radius:50%; }
.d.in { background:var(--gold); }
.d.miss { background:transparent; border:2.5px solid var(--danger); }
.d.none { width:5px; height:5px; background:var(--muted-light); opacity:.5; }
.d.live { background:transparent; border:2px dashed var(--muted); }
.d.future { width:5px; height:5px; background:var(--border); }

.xt-hidden { margin:12px 2px 0; font-size:11.5px; line-height:1.6; color:var(--muted); }
`;
