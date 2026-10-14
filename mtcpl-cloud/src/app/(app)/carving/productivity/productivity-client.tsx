"use client";

/**
 * The league table.
 *
 * Deliberately not a chart. Dad reads this to decide who to telephone,
 * so it is a ranked list with the three numbers that tell him WHICH
 * question to ask:
 *
 *   few hours      → the machine sat idle. Why was there no work on it?
 *   high hrs/job   → it ran all week and was slow. Tool? Stone? Fault?
 *
 * The bar is drawn against the best machine of the same type, and the
 * notch on it is that type's median, so "below the middle of its own
 * kind" is a thing you see rather than a thing you calculate.
 */

import Link from "next/link";
import type { ProductivityReport, MachineRow, TypeGroup } from "@/lib/cnc-productivity";
import { PERIODS } from "@/lib/cnc-productivity";

const n1 = (x: number) => x.toFixed(1);
const pct = (x: number) => `${Math.round(x * 100)}%`;

const STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  carving: { label: "Carving", bg: "rgba(21,128,61,.12)", fg: "#15803d" },
  idle: { label: "Idle", bg: "rgba(100,116,139,.14)", fg: "#475569" },
  maintenance: { label: "Maintenance", bg: "rgba(185,28,28,.12)", fg: "#b91c1c" },
};

export function ProductivityView({ report }: { report: ProductivityReport }) {
  return (
    <div>
      <style>{CSS}</style>

      {/* Period picker — plain links so Back works and a view is shareable. */}
      <div className="cp-periods">
        {PERIODS.map((p) => (
          <Link
            key={p.key}
            href={`/carving/productivity?period=${p.key}`}
            className={`cp-period${report.periodKey === p.key ? " is-on" : ""}`}
          >
            {p.label}
          </Link>
        ))}
        <span className="cp-summary">
          <strong>{report.totalJobs.toLocaleString("en-IN")}</strong> pieces off{" "}
          <strong>{report.machinesCounted}</strong> machines
        </span>
      </div>

      {/* The answer to "is the same kind of machine doing less". */}
      {report.laggards.length > 0 && (
        <div className="cp-flag">
          <div className="cp-flaghead">
            ⚠ {report.laggards.length} machine{report.laggards.length === 1 ? "" : "s"} under half
            the middle of their own kind
          </div>
          <div className="cp-flagrow">
            {report.laggards.map((m) => (
              <span key={m.id} className="cp-flagchip">
                <strong>{m.code}</strong>
                <span>{m.vendorName}</span>
                <em>
                  {m.jobs} {m.jobs === 1 ? "piece" : "pieces"}
                  {m.status === "maintenance" ? " · in maintenance" : m.hoursRun < 1 ? " · never ran" : ""}
                </em>
              </span>
            ))}
          </div>
          <p className="cp-flagnote">
            Low hours means it stood idle — ask why there was no work on it. Low
            hours per piece with few pieces means the same. Many hours but few
            pieces means it ran slow — tool, stone or a fault.
          </p>
        </div>
      )}

      {report.groups.map((g) => (
        <GroupTable key={g.type ?? "none"} group={g} days={report.days} />
      ))}

      {report.groups.length === 0 && (
        <p style={{ color: "var(--muted)", fontSize: 14 }}>No active CNC machines are set up yet.</p>
      )}

      <p className="cp-foot">
        A piece counts on the day it came off the machine. <strong>Hours run</strong> is
        wall-clock time with the bed loaded — these are multi-head machines, so
        pieces running side by side count that hour once, which is why Used never
        passes 100%. <strong>At a time</strong> is how many pieces shared the bed on
        average, so two machines can run the same hours and still differ.{" "}
        <strong>Hrs / piece</strong> is the full time one piece spent on the machine.
        Hours are clipped to the period, so a job loaded before it started cannot
        stretch beyond it.
      </p>
    </div>
  );
}

function GroupTable({ group, days }: { group: TypeGroup; days: number }) {
  const best = group.machines[0]?.jobs ?? 0;
  return (
    <section className="cp-group">
      <div className="cp-grouphead">
        <h2>{group.typeLabel}</h2>
        <span>
          {group.machines.length} machines · {group.totalJobs} pieces in {days} days · middle
          machine did <strong>{group.medianJobs}</strong>
          {group.medianHoursPerJob != null && <> · typically {n1(group.medianHoursPerJob)} h a piece</>}
        </span>
      </div>

      <div className="cp-scroll">
        <table className="cp">
          <thead>
            <tr>
              <th className="cp-rank">#</th>
              <th>Machine</th>
              <th>Vendor</th>
              <th className="cp-num">Pieces</th>
              <th className="cp-bar-h">vs the best of this kind</th>
              <th className="cp-num">Hours run</th>
              <th className="cp-num">Used</th>
              <th className="cp-num">At a time</th>
              <th className="cp-num">Hrs / piece</th>
              <th>Now</th>
            </tr>
          </thead>
          <tbody>
            {group.machines.map((m, i) => (
              <MachineLine
                key={m.id}
                m={m}
                rank={i + 1}
                best={best}
                medianJobs={group.medianJobs}
                medianHoursPerJob={group.medianHoursPerJob}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function MachineLine({
  m, rank, best, medianJobs, medianHoursPerJob,
}: {
  m: MachineRow; rank: number; best: number;
  medianJobs: number; medianHoursPerJob: number | null;
}) {
  const width = best > 0 ? Math.max(m.jobs / best, 0) * 100 : 0;
  const notch = best > 0 ? (medianJobs / best) * 100 : 0;
  const below = medianJobs > 0 && m.jobs < medianJobs;
  const slow =
    medianHoursPerJob != null && m.hoursPerJob != null && m.hoursPerJob > medianHoursPerJob * 1.5;
  const st = STATUS[m.status] ?? { label: m.status, bg: "rgba(100,116,139,.14)", fg: "#475569" };

  return (
    <tr className={below ? "is-below" : undefined}>
      <td className="cp-rank">{rank}</td>
      <td>
        <span className="cp-code">{m.code}</span>
        {m.axes != null && <span className="cp-axes">{m.axes}-axis</span>}
      </td>
      <td className="cp-vendor">{m.vendorName}</td>
      <td className="cp-num cp-jobs">{m.jobs}</td>
      <td className="cp-bar-h">
        <span className="cp-bar">
          <span className="cp-barfill" style={{ width: `${width}%` }} />
          {notch > 0 && notch < 100 && (
            <span className="cp-notch" style={{ left: `${notch}%` }} title={`middle of this kind: ${medianJobs}`} />
          )}
        </span>
      </td>
      <td className="cp-num">{m.hoursRun < 0.05 ? "—" : n1(m.hoursRun)}</td>
      <td className="cp-num">{m.hoursRun < 0.05 ? "—" : pct(m.utilisation)}</td>
      <td className="cp-num cp-soft">
        {m.piecesAtATime == null ? "—" : `${n1(m.piecesAtATime)}×`}
      </td>
      <td className={`cp-num${slow ? " cp-slow" : ""}`}>
        {m.hoursPerJob == null ? "—" : n1(m.hoursPerJob)}
      </td>
      <td>
        <span className="cp-status" style={{ background: st.bg, color: st.fg }}>{st.label}</span>
      </td>
    </tr>
  );
}

const CSS = `
.cp-periods { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-bottom:16px; }
.cp-period { padding:9px 16px; font-size:13.5px; font-weight:700; border-radius:10px;
  text-decoration:none; border:1px solid var(--border); background:var(--surface);
  color:var(--text); }
.cp-period.is-on { background:var(--gold-subtle); border-color:var(--gold); color:var(--gold-dark); }
.cp-summary { margin-left:auto; font-size:13px; color:var(--muted); }
.cp-summary strong { color:var(--text); font-variant-numeric:tabular-nums; }

.cp-flag { background:rgba(180,83,9,.06); border:1px solid rgba(180,83,9,.3);
  border-radius:12px; padding:14px 16px; margin-bottom:20px; }
.cp-flaghead { font-size:14px; font-weight:800; color:#92400e; margin-bottom:11px; }
.cp-flagrow { display:flex; gap:8px; flex-wrap:wrap; }
.cp-flagchip { display:inline-flex; align-items:baseline; gap:7px; background:var(--surface);
  border:1px solid var(--border); border-radius:999px; padding:5px 12px; font-size:12.5px; }
.cp-flagchip strong { font-weight:800; }
.cp-flagchip span { color:var(--muted); }
.cp-flagchip em { font-style:normal; color:#b45309; font-weight:700; }
.cp-flagnote { font-size:12.5px; color:var(--muted); line-height:1.55; margin:11px 0 0; max-width:80ch; }

.cp-group { margin-bottom:26px; }
.cp-grouphead { display:flex; align-items:baseline; gap:12px; flex-wrap:wrap; margin-bottom:10px; }
.cp-grouphead h2 { font-size:17px; font-weight:800; margin:0; letter-spacing:-.01em; }
.cp-grouphead span { font-size:12.5px; color:var(--muted); }
.cp-grouphead strong { color:var(--text); }

.cp-scroll { overflow-x:auto; border:1px solid var(--border); border-radius:12px;
  background:var(--surface); }
table.cp { width:100%; border-collapse:collapse; font-size:13.5px; min-width:860px; }
table.cp th { font-size:10.5px; font-weight:800; letter-spacing:.07em; text-transform:uppercase;
  color:var(--muted); text-align:left; padding:10px 12px; border-bottom:1px solid var(--border);
  background:var(--surface-alt); white-space:nowrap; }
table.cp td { padding:10px 12px; border-bottom:1px solid var(--border-light); white-space:nowrap; }
table.cp tbody tr:last-child td { border-bottom:0; }
table.cp tbody tr.is-below td { background:rgba(180,83,9,.045); }
.cp-rank { width:42px; color:var(--muted); font-variant-numeric:tabular-nums; }
.cp-num { text-align:right; font-variant-numeric:tabular-nums; }
.cp-jobs { font-size:16px; font-weight:800; }
.cp-code { font-weight:800; font-size:15px; }
.cp-axes { margin-left:7px; font-size:10.5px; font-weight:700; color:var(--muted);
  border:1px solid var(--border); border-radius:5px; padding:1px 5px; }
.cp-vendor { color:var(--muted); }
.cp-slow { color:#b45309; font-weight:800; }
.cp-soft { color:var(--muted); }
.cp-status { font-size:10.5px; font-weight:800; padding:3px 9px; border-radius:999px;
  text-transform:uppercase; letter-spacing:.04em; }

.cp-bar-h { width:34%; min-width:150px; }
.cp-bar { position:relative; display:block; height:11px; border-radius:6px;
  background:var(--border-light); overflow:visible; }
.cp-barfill { position:absolute; left:0; top:0; bottom:0; border-radius:6px;
  background:linear-gradient(90deg, var(--gold) 0%, var(--gold-dark) 100%); }
.cp-notch { position:absolute; top:-3px; bottom:-3px; width:2px; background:var(--text);
  opacity:.45; }

.cp-foot { font-size:12px; color:var(--muted); line-height:1.6; margin-top:6px; max-width:86ch; }

@media (max-width: 700px) {
  .cp-summary { margin-left:0; width:100%; }
}
`;
