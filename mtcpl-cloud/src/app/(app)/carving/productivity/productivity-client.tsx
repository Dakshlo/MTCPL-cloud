"use client";

/**
 * The league table.
 *
 * Daksh, Oct 2026: "remove all unnecessary description ... more good UI,
 * maybe colourful." So the prose is gone and the meaning is carried by
 * colour instead: every machine is banded against the middle of its own
 * kind, and the band drives the bar, the row tint and the rank chip.
 *
 *   green   ahead of the middle of its kind
 *   grey    around the middle
 *   amber   behind
 *   red     under half the middle, or never ran
 *
 * Still not a chart — dad reads this to decide who to telephone, so it
 * stays a ranked list he can run a finger down.
 */

import Link from "next/link";
import type { ProductivityReport, MachineRow, TypeGroup } from "@/lib/cnc-productivity";
import { PERIODS } from "@/lib/cnc-productivity";

const n1 = (x: number) => x.toFixed(1);
const pct = (x: number) => `${Math.round(x * 100)}%`;

type Band = "ahead" | "middle" | "behind" | "poor";

const BAND: Record<Band, { bar: string; tint: string; chip: string; chipFg: string }> = {
  ahead:  { bar: "linear-gradient(90deg,#15803d,#22c55e)", tint: "rgba(34,197,94,.05)",  chip: "rgba(34,197,94,.14)",  chipFg: "#15803d" },
  middle: { bar: "linear-gradient(90deg,#64748b,#94a3b8)", tint: "transparent",          chip: "rgba(100,116,139,.14)", chipFg: "#475569" },
  behind: { bar: "linear-gradient(90deg,#b45309,#f59e0b)", tint: "rgba(245,158,11,.06)", chip: "rgba(245,158,11,.16)", chipFg: "#92400e" },
  poor:   { bar: "linear-gradient(90deg,#b91c1c,#ef4444)", tint: "rgba(239,68,68,.06)",  chip: "rgba(239,68,68,.14)",  chipFg: "#b91c1c" },
};

function bandOf(jobs: number, median: number, onBedNow = 0): Band {
  if (median <= 0) return jobs > 0 ? "middle" : "poor";
  // Mid-job on a loaded bed is not a poor performer, whatever it finished.
  if (jobs <= median / 2 && onBedNow > 0) return "middle";
  if (jobs <= median / 2) return "poor";
  if (jobs < median) return "behind";
  if (jobs > median) return "ahead";
  return "middle";
}

const STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  carving: { label: "Carving", bg: "rgba(21,128,61,.12)", fg: "#15803d" },
  idle: { label: "Idle", bg: "rgba(100,116,139,.14)", fg: "#475569" },
  maintenance: { label: "Maintenance", bg: "rgba(185,28,28,.12)", fg: "#b91c1c" },
};

export function ProductivityView({ report }: { report: ProductivityReport }) {
  return (
    <div>
      <style>{CSS}</style>

      <div className="cp-top">
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
        </div>

        <div className="cp-kpis">
          <span className="cp-kpi cp-kpi--gold">
            <b>{report.totalJobs.toLocaleString("en-IN")}</b> pieces
          </span>
          <span className="cp-kpi cp-kpi--green">
            <b>{report.machinesRunning}</b> ran
          </span>
          {report.machinesMidJob > 0 && (
            <span className="cp-kpi cp-kpi--blue" title="Finished nothing in this period, but a bed is loaded — part-way through long work">
              <b>{report.machinesMidJob}</b> mid-job
            </span>
          )}
          <span className={`cp-kpi ${report.machinesIdle > 0 ? "cp-kpi--red" : "cp-kpi--grey"}`}>
            <b>{report.machinesIdle}</b> standing still
          </span>
          {report.loggedOnly > 0 && (
            <span className="cp-kpi cp-kpi--grey" title="Loaded and unloaded within 15 minutes — register catch-up, left out of the figures">
              <b>{report.loggedOnly}</b> logged only
            </span>
          )}
        </div>
      </div>

      {report.laggards.length > 0 && (
        <div className="cp-flag">
          <span className="cp-flaghead">Under half their own kind</span>
          {report.laggards.map((m) => (
            <span key={m.id} className="cp-flagchip">
              <b>{m.code}</b>
              <span>{m.vendorName}</span>
              <em>{m.jobs === 0 ? "never ran" : `${m.jobs} ${m.jobs === 1 ? "piece" : "pieces"}`}</em>
            </span>
          ))}
        </div>
      )}

      {report.groups.map((g) => (
        <GroupTable key={g.type ?? "none"} group={g} days={report.days} />
      ))}

      {report.groups.length === 0 && (
        <p style={{ color: "var(--muted)", fontSize: 14 }}>No active CNC machines are set up yet.</p>
      )}
    </div>
  );
}

function GroupTable({ group, days }: { group: TypeGroup; days: number }) {
  const best = group.machines[0]?.jobs ?? 0;
  return (
    <section className="cp-group">
      <div className="cp-grouphead">
        <h2>{group.typeLabel}</h2>
        <span className="cp-groupmeta">
          {group.machines.length} machines · {group.totalJobs} pieces in {days}d · middle{" "}
          <b>{group.medianJobs}</b>
          {group.medianHoursPerJob != null && <> · typically <b>{n1(group.medianHoursPerJob)}h</b> a piece</>}
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
              <th className="cp-bar-h">Against the best of this kind</th>
              <th className="cp-num">Hours</th>
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
  const band = bandOf(m.jobs, medianJobs, m.onBedNow);
  const c = BAND[band];
  const width = best > 0 ? (m.jobs / best) * 100 : 0;
  const notch = best > 0 ? (medianJobs / best) * 100 : 0;
  const slow =
    medianHoursPerJob != null && m.hoursPerJob != null && m.hoursPerJob > medianHoursPerJob * 1.5;
  const st = STATUS[m.status] ?? { label: m.status, bg: "rgba(100,116,139,.14)", fg: "#475569" };

  return (
    <tr style={{ background: c.tint }}>
      <td className="cp-rank">
        <span className="cp-rankchip" style={{ background: c.chip, color: c.chipFg }}>{rank}</span>
      </td>
      <td>
        <span className="cp-code">{m.code}</span>
        {m.axes != null && <span className="cp-axes">{m.axes}-axis</span>}
        {m.jobs === 0 && m.onBedNow > 0 && (
          <span className="cp-onbed" title="Still on the bed — part-way through long work, not idle">
            {m.onBedNow} on bed
          </span>
        )}
        {m.loggedOnly > 0 && (
          <span className="cp-logged" title={`${m.loggedOnly} loaded and unloaded within 15 minutes — left out`}>
            +{m.loggedOnly} logged
          </span>
        )}
      </td>
      <td className="cp-vendor">{m.vendorName}</td>
      <td className="cp-num cp-jobs" style={{ color: c.chipFg }}>{m.jobs}</td>
      <td className="cp-bar-h">
        <span className="cp-bar">
          <span className="cp-barfill" style={{ width: `${width}%`, background: c.bar }} />
          {notch > 0 && notch < 100 && <span className="cp-notch" style={{ left: `${notch}%` }} />}
        </span>
      </td>
      <td className="cp-num">{m.hoursRun < 0.05 ? "—" : n1(m.hoursRun)}</td>
      <td className="cp-num">{m.hoursRun < 0.05 ? "—" : pct(m.utilisation)}</td>
      <td className="cp-num cp-soft">{m.piecesAtATime == null ? "—" : `${n1(m.piecesAtATime)}×`}</td>
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
.cp-top { display:flex; gap:14px; flex-wrap:wrap; align-items:center; margin-bottom:18px; }
.cp-periods { display:flex; gap:7px; flex-wrap:wrap; }
.cp-period { padding:9px 16px; font-size:13.5px; font-weight:700; border-radius:10px;
  text-decoration:none; border:1px solid var(--border); background:var(--surface); color:var(--text); }
.cp-period.is-on { background:linear-gradient(135deg,var(--gold),var(--gold-dark));
  border-color:transparent; color:#fff; box-shadow:0 3px 10px rgba(166,123,40,.28); }

.cp-kpis { margin-left:auto; display:flex; gap:7px; flex-wrap:wrap; }
.cp-kpi { font-size:12.5px; font-weight:600; padding:7px 13px; border-radius:999px;
  border:1px solid transparent; white-space:nowrap; }
.cp-kpi b { font-size:15px; font-weight:800; font-variant-numeric:tabular-nums; margin-right:3px; }
.cp-kpi--gold  { background:rgba(166,123,40,.12);  border-color:rgba(166,123,40,.3);  color:#8a6a2f; }
.cp-kpi--green { background:rgba(34,197,94,.12);   border-color:rgba(34,197,94,.32);  color:#15803d; }
.cp-kpi--red   { background:rgba(239,68,68,.11);   border-color:rgba(239,68,68,.32);  color:#b91c1c; }
.cp-kpi--grey  { background:rgba(100,116,139,.11); border-color:rgba(100,116,139,.28); color:#475569; }
.cp-kpi--blue  { background:rgba(37,99,235,.11);   border-color:rgba(37,99,235,.3);   color:#1d4ed8; }

.cp-flag { display:flex; gap:8px; flex-wrap:wrap; align-items:center;
  background:rgba(239,68,68,.05); border:1px solid rgba(239,68,68,.26);
  border-radius:12px; padding:12px 14px; margin-bottom:22px; }
.cp-flaghead { font-size:11px; font-weight:800; letter-spacing:.07em; text-transform:uppercase;
  color:#b91c1c; margin-right:4px; }
.cp-flagchip { display:inline-flex; align-items:baseline; gap:6px; background:var(--surface);
  border:1px solid var(--border); border-radius:999px; padding:5px 12px; font-size:12.5px; }
.cp-flagchip b { font-weight:800; }
.cp-flagchip span { color:var(--muted); }
.cp-flagchip em { font-style:normal; color:#b91c1c; font-weight:700; }

.cp-group { margin-bottom:26px; }
.cp-grouphead { display:flex; align-items:baseline; gap:12px; flex-wrap:wrap; margin-bottom:10px; }
.cp-grouphead h2 { font-size:18px; font-weight:800; margin:0; letter-spacing:-.015em; }
.cp-groupmeta { font-size:12.5px; color:var(--muted); }
.cp-groupmeta b { color:var(--text); font-variant-numeric:tabular-nums; }

.cp-scroll { overflow-x:auto; border:1px solid var(--border); border-radius:14px;
  background:var(--surface); box-shadow:0 1px 2px rgba(16,24,40,.04); }
table.cp { width:100%; border-collapse:collapse; font-size:13.5px; min-width:900px; }
table.cp th { font-size:10.5px; font-weight:800; letter-spacing:.07em; text-transform:uppercase;
  color:var(--muted); text-align:left; padding:11px 12px; border-bottom:1px solid var(--border);
  background:var(--surface-alt); white-space:nowrap; }
table.cp td { padding:10px 12px; border-bottom:1px solid var(--border-light); white-space:nowrap; }
table.cp tbody tr:last-child td { border-bottom:0; }

.cp-rank { width:50px; }
.cp-rankchip { display:inline-grid; place-items:center; width:26px; height:26px;
  border-radius:8px; font-size:12px; font-weight:800; font-variant-numeric:tabular-nums; }
.cp-num { text-align:right; font-variant-numeric:tabular-nums; }
.cp-jobs { font-size:17px; font-weight:800; }
.cp-code { font-weight:800; font-size:15.5px; }
.cp-axes { margin-left:7px; font-size:10.5px; font-weight:700; color:var(--muted);
  border:1px solid var(--border); border-radius:5px; padding:1px 5px; }
.cp-logged { margin-left:7px; font-size:10px; font-weight:700; color:#475569;
  background:rgba(100,116,139,.12); border-radius:5px; padding:1px 6px; }
.cp-onbed { margin-left:7px; font-size:10px; font-weight:700; color:#1d4ed8;
  background:rgba(37,99,235,.12); border-radius:5px; padding:1px 6px; }
.cp-vendor { color:var(--muted); }
.cp-soft { color:var(--muted); }
.cp-slow { color:#b45309; font-weight:800; }
.cp-status { font-size:10.5px; font-weight:800; padding:3px 9px; border-radius:999px;
  text-transform:uppercase; letter-spacing:.04em; }

.cp-bar-h { width:30%; min-width:140px; }
.cp-bar { position:relative; display:block; height:12px; border-radius:7px;
  background:var(--border-light); }
.cp-barfill { position:absolute; left:0; top:0; bottom:0; border-radius:7px; }
.cp-notch { position:absolute; top:-3px; bottom:-3px; width:2px; background:var(--text); opacity:.4; }

@media (max-width: 760px) {
  .cp-kpis { margin-left:0; width:100%; }
}
`;
