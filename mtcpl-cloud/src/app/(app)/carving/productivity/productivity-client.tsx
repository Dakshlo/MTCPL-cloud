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

        <div className="cp-rankby">
          <span>Rank by</span>
          <Link href={`/carving/productivity?period=${report.periodKey}`}
            className={`cp-rb${report.rankBy === "pieces" ? " is-on" : ""}`}>Pieces</Link>
          <Link href={`/carving/productivity?period=${report.periodKey}&rank=cft`}
            className={`cp-rb${report.rankBy === "cft" ? " is-on" : ""}`}>CFT</Link>
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
        <GroupTable key={g.type ?? "none"} group={g} days={report.days} rankBy={report.rankBy} />
      ))}

      {report.groups.length === 0 && (
        <p style={{ color: "var(--muted)", fontSize: 14 }}>No active CNC machines are set up yet.</p>
      )}
    </div>
  );
}

function GroupTable({ group, days, rankBy }: { group: TypeGroup; days: number; rankBy: "pieces" | "cft" }) {
  // The bar has to measure whatever the board is ranked on, or the
  // longest bar is not the top row.
  const byCft = rankBy === "cft";
  const best = byCft ? (group.machines[0]?.cft ?? 0) : (group.machines[0]?.jobs ?? 0);
  const mid = byCft ? group.medianCft : group.medianJobs;
  return (
    <section className="cp-group">
      <div className="cp-grouphead">
        <h2>{group.typeLabel}</h2>
        <span className="cp-groupmeta">
          {group.machines.length} machines · {group.totalJobs} pieces in {days}d · middle{" "}
          <b>{group.medianJobs}</b>
          {" "}· <b>{n1(group.totalCft)}</b> CFT
          {group.medianHoursPerCft != null && <> · typically <b>{n1(group.medianHoursPerCft)}h</b> a CFT</>}
        </span>
      </div>

      <div className="cp-scroll">
        <table className="cp">
          <thead>
            <tr>
              <th className="cp-rank">#</th>
              <Th label="Machine" en="The machine's own number, and how many axes it has." hi="मशीन का नंबर और उसके ऐक्सिस।" />
              <Th label="Vendor" en="Whose shed the machine stands in." hi="मशीन किस ठेकेदार के शेड में है।" />
              <Th
                label="Pieces" num
                en="Pieces taken off this machine in the chosen period. This is what the ranking uses."
                hi="चुनी हुई अवधि में इस मशीन से उतारे गए टुकड़े। क्रम इसी से बनता है।"
              />
              <Th
                label="CFT" num
                en="Volume of stone carved — the pieces' own size added up. Four big pieces can be far more work than ten small ones."
                hi="कितना पत्थर तराशा गया — टुकड़ों का अपना आकार जोड़कर। चार बड़े टुकड़े दस छोटे टुकड़ों से कहीं ज़्यादा काम हो सकते हैं।"
              />
              <Th
                label="Against the best of this kind" wide
                en="The bar compares this machine with the best machine of the same type. The dark line is the middle machine of that type."
                hi="पट्टी इसी प्रकार की सबसे अच्छी मशीन से तुलना करती है। गहरी लकीर इस प्रकार की बीच वाली मशीन है।"
              />
              <Th
                label="Hours" num
                en="Hours the bed actually had work on it. Pieces running side by side count that hour once, not twice."
                hi="मशीन पर सचमुच काम चलने के घंटे। साथ-साथ चल रहे टुकड़ों का वही घंटा एक ही बार गिना जाता है।"
              />
              <Th
                label="Used" num
                en="Those hours as a share of the whole period. 100% means it never stood empty."
                hi="पूरी अवधि में से कितने प्रतिशत समय मशीन चली। 100% मतलब कभी खाली नहीं रही।"
              />
              <Th
                label="At a time" num
                en="How many pieces shared the bed on average. Two machines can run the same hours and still differ here."
                hi="औसतन कितने टुकड़े एक साथ मशीन पर थे। एक जैसे घंटे चलने पर भी यह अलग हो सकता है।"
              />
              <Th
                label="Hrs / CFT" num
                en="Hours spent per cubic foot of stone — this is whether a machine is actually slow. Hours per piece punishes whoever is given the biggest stone. Red means much slower than others of its kind: tool, stone or a fault."
                hi="एक घन फुट पत्थर पर लगने वाले घंटे — मशीन सचमुच धीमी है या नहीं, यह इसी से पता चलता है। प्रति टुकड़ा घंटे उस मशीन को गलत ठहराते हैं जिसे सबसे बड़ा पत्थर मिला हो। लाल मतलब अपने प्रकार से काफी धीमा — टूल, पत्थर या कोई खराबी।"
              />
              <Th label="Now" en="What the machine is doing at this moment." hi="मशीन इस समय क्या कर रही है।" />
            </tr>
          </thead>
          <tbody>
            {group.machines.map((m, i) => (
              <MachineLine
                key={m.id}
                m={m}
                rank={i + 1}
                best={best}
                value={byCft ? m.cft : m.jobs}
                mid={mid}
                medianHoursPerCft={group.medianHoursPerCft}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * A column heading with an ⓘ that explains it in English and Hindi.
 *
 * Daksh: "on all column give a info thing so my dad can know what it is,
 * in Hindi too." It opens on hover AND on focus, so a tap works on the
 * tablet — `title` alone would never show there. The bubble drops DOWNWARD
 * into the table because the scroll container clips anything above it.
 */
function Th({
  label, en, hi, num, wide,
}: { label: string; en: string; hi: string; num?: boolean; wide?: boolean }) {
  return (
    <th className={`${num ? "cp-num " : ""}${wide ? "cp-bar-h " : ""}cp-th`}>
      <span className="cp-thwrap">
        <span>{label}</span>
        <button type="button" className="cp-info" aria-label={`What is ${label}? — ${en}`}>
          i
        </button>
        <span className="cp-tip" role="tooltip">
          <span className="cp-tip-en">{en}</span>
          <span className="cp-tip-hi">{hi}</span>
        </span>
      </span>
    </th>
  );
}

function MachineLine({
  m, rank, best, value, mid, medianHoursPerCft,
}: {
  m: MachineRow; rank: number; best: number;
  /** Whatever the board is ranked on for this machine. */
  value: number;
  /** The middle machine of this type, on the same basis. */
  mid: number;
  medianHoursPerCft: number | null;
}) {
  const band = bandOf(value, mid, m.onBedNow);
  const c = BAND[band];
  const width = best > 0 ? (value / best) * 100 : 0;
  const notch = best > 0 ? (mid / best) * 100 : 0;
  // Slowness is judged per cubic foot. Per PIECE it flagged machine 3 —
  // which was carving the heaviest stone in the shed and was in fact the
  // second fastest per cubic foot — while machine 6 cut ten small pieces
  // at five times the hours per cubic foot and was never flagged.
  const slow =
    medianHoursPerCft != null && m.hoursPerCft != null && m.hoursPerCft > medianHoursPerCft * 1.5;
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
      <td className="cp-num cp-cft">{m.cft < 0.01 ? "—" : n1(m.cft)}</td>
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
        {m.hoursPerCft == null ? "—" : n1(m.hoursPerCft)}
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


.cp-rankby { margin-left:auto; display:flex; align-items:center; gap:6px; }
.cp-rankby > span { font-size:10.5px; font-weight:800; letter-spacing:.07em;
  text-transform:uppercase; color:var(--muted); margin-right:2px; }
.cp-rb { padding:7px 14px; font-size:12.5px; font-weight:700; border-radius:9px;
  text-decoration:none; border:1px solid var(--border); background:var(--surface); color:var(--muted); }
.cp-rb.is-on { background:var(--gold-subtle); border-color:var(--gold); color:var(--gold-dark); }

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
/* The bubble opens downward INTO the table precisely because this
   container scrolls — anything above the heading row would be cut off. */
table.cp { width:100%; border-collapse:collapse; font-size:13.5px; min-width:900px; }
table.cp th { font-size:10.5px; font-weight:800; letter-spacing:.07em; text-transform:uppercase;
  color:var(--muted); text-align:left; padding:11px 12px; border-bottom:1px solid var(--border);
  background:var(--surface-alt); white-space:nowrap; }
/* A number column's heading has to sit over its own figures. The general
   rule above is more specific than .cp-num, so without this the heading
   stayed hard left while every value sat hard right — which is exactly
   what made the table look out of line. */
table.cp th.cp-num { text-align:right; }
table.cp th.cp-num .cp-thwrap { justify-content:flex-end; }

/* Heading + its ⓘ, with the bubble hung underneath. */
.cp-thwrap { position:relative; display:inline-flex; align-items:center; gap:5px; }
.cp-info { width:14px; height:14px; flex:0 0 auto; border-radius:50%; border:none;
  background:var(--border); color:var(--muted); font-family:inherit; font-size:9.5px;
  font-weight:800; line-height:1; cursor:help; padding:0; display:grid; place-items:center; }
.cp-info:hover, .cp-info:focus-visible { background:var(--gold); color:#fff; outline:none; }
.cp-tip { position:absolute; top:calc(100% + 8px); left:0; z-index:30; width:260px;
  display:none; flex-direction:column; gap:5px; padding:10px 12px; border-radius:10px;
  background:#1f2430; color:#eef1f6; font-size:11.5px; font-weight:500; line-height:1.5;
  letter-spacing:0; text-transform:none; text-align:left; white-space:normal;
  box-shadow:0 8px 24px rgba(10,15,30,.3); }
table.cp th.cp-num .cp-tip { left:auto; right:0; }
.cp-thwrap:hover .cp-tip, .cp-thwrap:focus-within .cp-tip { display:flex; }
.cp-tip-hi { color:#c9d2e3; border-top:1px solid rgba(255,255,255,.14); padding-top:5px; }
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
.cp-cft { font-weight:700; color:var(--text); }
.cp-status { font-size:10.5px; font-weight:800; padding:3px 9px; border-radius:999px;
  text-transform:uppercase; letter-spacing:.04em; }

.cp-bar-h { width:30%; min-width:140px; }
.cp-bar { position:relative; display:block; height:12px; border-radius:7px;
  background:var(--border-light); }
.cp-barfill { position:absolute; left:0; top:0; bottom:0; border-radius:7px; }
.cp-notch { position:absolute; top:-3px; bottom:-3px; width:2px; background:var(--text); opacity:.4; }

@media (max-width: 760px) {
  }
`;
