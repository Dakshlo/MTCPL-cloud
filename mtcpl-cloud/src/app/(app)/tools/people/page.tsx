/**
 * /tools/people — the men, side by side.
 *
 * Daksh, Nov 2026: "in register a place where we can see detail things
 * like how many tools Mohit took this week, number of tools, then his
 * machine-wise… how much tools he uses in week, month. All 3 in one
 * page so we can compare. Don't mix that with register — that will be
 * a new thing under register."
 *
 * So it is its own page, reached from the register, and the comparison
 * is the design rather than a feature of it: one column per man, the
 * same rows in the same order down every column, and the week and the
 * month shown TOGETHER rather than behind a toggle. A toggle makes you
 * remember the other number; two columns let you see it.
 *
 * Three windows, and the third is the honest one: THIS WEEK, THIS
 * MONTH and the DAILY AVERAGE across the month, because a week and a
 * month are not comparable quantities and putting them next to each
 * other invites exactly that mistake. The average is what makes
 * "is he using more than usual" answerable.
 *
 * Taken and used are kept apart everywhere. A man takes five on Monday,
 * spends two on Tuesday and is holding three — that gap is the whole
 * value of the screen, and one combined number would bury it.
 */

import Link from "next/link";
import { redirect } from "next/navigation";

import { requireAuth } from "@/lib/auth";
import { canUseCncTools } from "@/lib/cnc-tool-permissions";
import { usageWindowRange } from "@/lib/cnc-tool-usage";
import { loadPeopleUsage, type PersonUsage } from "@/lib/cnc-tool-people";

export const dynamic = "force-dynamic";

const money = (n: number) =>
  n > 0 ? "₹" + Math.round(n).toLocaleString("en-IN") : "—";

/** Days elapsed in the current IST month, for the daily average. */
function daysIntoMonth(): number {
  const ist = new Date(Date.now() + 5.5 * 3_600_000);
  return Math.max(1, ist.getUTCDate());
}

export default async function ToolPeoplePage() {
  const { profile } = await requireAuth();
  if (!canUseCncTools(profile)) redirect("/");

  const week = usageWindowRange("7d");
  const month = usageWindowRange("month");

  const [weekRows, monthRows] = await Promise.all([
    loadPeopleUsage(week.fromIso, week.toIso),
    loadPeopleUsage(month.fromIso, month.toIso),
  ]);

  const byKeyWeek = new Map(weekRows.map((p) => [p.key, p]));
  // The month is the fuller list, so it sets who appears and in what
  // order. Somebody who took nothing this week still gets a column with
  // a zero in it — an absence is a finding too.
  const people = monthRows.length > 0 ? monthRows : weekRows;
  const days = daysIntoMonth();

  const maxMonthTaken = Math.max(1, ...people.map((p) => p.takenQty));
  const maxMonthUsed = Math.max(1, ...people.map((p) => p.usedQty));
  /* Daksh, Nov 2026: "consider the number of machines under the vendor
     — Mohit has more machines and Manthan less, so Mohit taking a few
     extra is fine."

     Raw totals flatter the small fleet and damn the large one, and on
     today's figures they do worse than that: Manthan's 8 over 17
     machines is 0.47 each, Mohit's 4 over 23 is 0.17. By the headline
     Manthan took twice as much; per machine he is running at nearly
     three times the rate. The totals were pointing at the wrong man.

     So the rate gets its own scale rather than sharing the totals' —
     the two bars answer different questions and a shared axis would
     make the rate look like a smaller version of the total. */
  const perMachine = (p: PersonUsage) =>
    p.machineCount > 0 ? p.takenQty / p.machineCount : 0;
  const maxPerMachine = Math.max(0.0001, ...people.map(perMachine));

  return (
    <section className="page-fluid tp">
      <style>{CSS}</style>

      <header className="tp-head">
        <div>
          <Link href="/tools?tab=register" className="tp-back">← Back to the register</Link>
          <h1>The men, side by side</h1>
          <p>
            What each man took off the shelf and what he reported into a
            machine. This week against the month so far, with the month&apos;s
            daily average beside it — a week and a month are not the same
            size, and the average is what makes them comparable.
          </p>
        </div>
      </header>

      {people.length === 0 ? (
        <div className="tp-blank">
          Nothing taken or used this month yet.
        </div>
      ) : (
        <div className="tp-grid">
          {people.map((m) => (
            <PersonCard
              key={m.key}
              month={m}
              week={byKeyWeek.get(m.key) ?? null}
              days={days}
              maxTaken={maxMonthTaken}
              maxUsed={maxMonthUsed}
              maxPerMachine={maxPerMachine}
            />
          ))}
        </div>
      )}

      <p className="tp-foot">
        Voided lines are left out of both columns. Money is the last rate a
        scanned supplier bill carried for that tool — a tool nobody has
        billed shows a dash, not a zero, and none of it comes from Finance.
      </p>
    </section>
  );
}

function PersonCard({
  month, week, days, maxTaken, maxUsed, maxPerMachine,
}: {
  month: PersonUsage;
  week: PersonUsage | null;
  days: number;
  maxTaken: number;
  maxUsed: number;
  maxPerMachine: number;
}) {
  const rate = month.machineCount > 0 ? month.takenQty / month.machineCount : null;
  const perDay = month.takenQty / days;
  const weekTaken = week?.takenQty ?? 0;
  const weekUsed = week?.usedQty ?? 0;
  /** Still in his hands, by this window's arithmetic. Not the live
   *  holding — that is on /tools/usage — but the gap this month opened. */
  const gap = month.takenQty - month.usedQty;

  return (
    <article className="tp-card">
      <header className="tp-card-head">
        <span className="tp-who">{month.name}</span>
        {month.company && month.company !== month.name && (
          <span className="tp-co">{month.company}</span>
        )}
      </header>

      {/* ── the two windows, together ───────────────────────────── */}
      <div className="tp-cols">
        <div className="tp-col">
          <span className="tp-col-h">This week</span>
          <b>{weekTaken}</b>
          <em>taken</em>
          <span className="tp-sub">{weekUsed} used</span>
        </div>
        <div className="tp-col tp-col-lead">
          <span className="tp-col-h">This month</span>
          <b>{month.takenQty}</b>
          <em>taken</em>
          <span className="tp-sub">{month.usedQty} used</span>
        </div>
        <div className="tp-col">
          <span className="tp-col-h">Per day</span>
          <b>{perDay.toFixed(1)}</b>
          <em>average</em>
          <span className="tp-sub">over {days} days</span>
        </div>
        {/* The fleet-aware one. Without it this card rewards a small
            shed for being small. */}
        <div className="tp-col tp-col-rate">
          <span className="tp-col-h">Per machine</span>
          <b>{rate === null ? "—" : rate.toFixed(2)}</b>
          <em>this month</em>
          <span className="tp-sub">
            {month.machineCount > 0
              ? `${month.machineCount} machines in his firm`
              : "no machines on his firm"}
          </span>
        </div>
      </div>

      {/* Bars are the comparison. Same scale on every card, so a short
          bar is short against the other men and not against itself. */}
      <div className="tp-bars">
        <div className="tp-bar-row">
          <span>Taken</span>
          <div className="tp-bar"><i style={{ width: `${(month.takenQty / maxTaken) * 100}%` }} /></div>
          <b>{month.takenQty}</b>
        </div>
        <div className="tp-bar-row tp-bar-used">
          <span>Used</span>
          <div className="tp-bar"><i style={{ width: `${(month.usedQty / maxUsed) * 100}%` }} /></div>
          <b>{month.usedQty}</b>
        </div>
        <div className="tp-bar-row tp-bar-rate">
          <span>Per mach.</span>
          <div className="tp-bar">
            <i style={{ width: `${rate === null ? 0 : (rate / maxPerMachine) * 100}%` }} />
          </div>
          <b>{rate === null ? "—" : rate.toFixed(2)}</b>
        </div>
      </div>

      <div className={`tp-gap${gap > 0 ? " open" : ""}`}>
        {gap > 0
          ? `${gap} pcs taken this month and not yet reported into a machine`
          : gap < 0
            ? `${Math.abs(gap)} pcs reported from stock taken earlier`
            : "Everything taken this month has been accounted for"}
        {month.usedValue > 0 && <b>{money(month.usedValue)} used</b>}
      </div>

      <div className="tp-sect">
        <strong>Machines</strong>
        <em>{month.machines.length || "none"}</em>
      </div>
      {month.machines.length === 0 ? (
        <p className="tp-none">Nothing reported into a machine this month.</p>
      ) : (
        <ul className="tp-list">
          {month.machines.slice(0, 8).map((m) => (
            <li key={m.machineCode}>
              <span className="tp-mc">CNC {m.machineCode}</span>
              <span className="tp-qty">{m.qty}</span>
              <span className="tp-val">{money(m.value)}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="tp-sect">
        <strong>Tools taken</strong>
        <em>{month.takenKinds} kinds</em>
      </div>
      {month.tools.length === 0 ? (
        <p className="tp-none">Nothing taken this month.</p>
      ) : (
        <ul className="tp-list">
          {month.tools.slice(0, 8).map((t) => (
            <li key={t.toolId}>
              <span className="tp-tool">{t.name}</span>
              <span className="tp-qty">{t.qty}</span>
              <span className="tp-val">{t.unit}</span>
            </li>
          ))}
          {month.tools.length > 8 && (
            <li className="tp-more">+{month.tools.length - 8} more kinds</li>
          )}
        </ul>
      )}
    </article>
  );
}

const CSS = `
.tp { padding-bottom: 36px; }
.tp-head { margin-bottom: 18px; }
.tp-back { font-size:12.5px; font-weight:700; color:var(--gold-dark); text-decoration:none; }
.tp-back:hover { text-decoration:underline; }
.tp-head h1 { margin:7px 0 5px; font-size:22px; font-weight:800; color:var(--text); letter-spacing:-.3px; }
.tp-head p { margin:0; max-width:74ch; font-size:12.5px; line-height:1.6; color:var(--muted); }

.tp-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(330px, 1fr)); gap:16px; }

.tp-card {
  background:var(--surface); border:1px solid var(--border); border-radius:14px;
  padding:16px 18px 18px; display:flex; flex-direction:column;
}
.tp-card-head { display:flex; align-items:baseline; gap:9px; margin-bottom:14px;
  padding-bottom:12px; border-bottom:1px solid var(--border); }
.tp-who { font-size:17px; font-weight:800; color:var(--text); letter-spacing:-.2px; }
.tp-co { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.07em;
  color:var(--muted); }

.tp-cols { display:grid; grid-template-columns:repeat(4, 1fr); gap:7px; margin-bottom:14px; }
@media (max-width: 1500px) { .tp-cols { grid-template-columns:repeat(2, 1fr); } }
.tp-col { display:flex; flex-direction:column; gap:1px; padding:10px 11px; border-radius:10px;
  background:var(--surface-alt); border:1px solid transparent; }
.tp-col-lead { background:var(--gold-subtle); border-color:var(--gold-border); }
.tp-col-h { font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:.07em;
  color:var(--muted); }
.tp-col b { font-size:25px; font-weight:800; line-height:1.1; color:var(--text);
  font-variant-numeric:tabular-nums; }
.tp-col-lead b { color:var(--gold-dark); }
.tp-col em { font-style:normal; font-size:11px; color:var(--muted); }
.tp-sub { font-size:10.5px; color:var(--muted-light); margin-top:2px; }

.tp-bars { display:flex; flex-direction:column; gap:7px; margin-bottom:12px; }
.tp-bar-row { display:grid; grid-template-columns:48px 1fr 40px; align-items:center; gap:9px;
  font-size:11px; color:var(--muted); }
.tp-bar-row b { text-align:right; font-size:12px; font-weight:700; color:var(--text);
  font-variant-numeric:tabular-nums; }
.tp-bar { height:8px; border-radius:999px; background:var(--surface-alt); overflow:hidden; }
.tp-bar i { display:block; height:100%; background:var(--gold); border-radius:999px; }
.tp-bar-used .tp-bar i { background:#0ea5e9; }
.tp-bar-rate .tp-bar i { background:#7c3aed; }
.tp-col-rate { background:#f5f3ff; border-color:#ddd6fe; }
.tp-col-rate b { color:#6d28d9; }

.tp-gap { display:flex; align-items:baseline; justify-content:space-between; gap:10px;
  font-size:11.5px; line-height:1.5; color:var(--muted); padding:9px 11px; border-radius:9px;
  background:var(--surface-alt); margin-bottom:14px; }
.tp-gap.open { background:var(--gold-subtle); color:var(--gold-dark); font-weight:600; }
.tp-gap b { white-space:nowrap; font-size:12px; color:var(--text); }

.tp-sect { display:flex; align-items:baseline; gap:8px; margin:4px 0 7px;
  padding-bottom:6px; border-bottom:1px solid var(--border); }
.tp-sect strong { font-size:11px; font-weight:800; text-transform:uppercase;
  letter-spacing:.07em; color:var(--muted); }
.tp-sect em { margin-left:auto; font-style:normal; font-size:11px; color:var(--muted-light); }

.tp-list { list-style:none; margin:0 0 12px; padding:0; display:flex; flex-direction:column; }
.tp-list li { display:grid; grid-template-columns:minmax(0,1fr) auto 56px; align-items:baseline;
  gap:10px; padding:5px 0; font-size:12.5px; }
.tp-list li + li { border-top:1px solid var(--border-light, var(--border)); }
.tp-mc { font-weight:700; color:var(--text); }
.tp-tool { font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:11.5px;
  color:var(--text); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.tp-qty { font-weight:800; color:var(--text); font-variant-numeric:tabular-nums; }
.tp-val { text-align:right; font-size:11px; color:var(--muted); }
.tp-more { color:var(--muted); font-size:11px; }
.tp-none { margin:0 0 12px; font-size:11.5px; color:var(--muted); }

.tp-blank { padding:40px; text-align:center; color:var(--muted); background:var(--surface);
  border:1px dashed var(--border); border-radius:12px; }
.tp-foot { margin:18px 2px 0; font-size:11px; line-height:1.6; color:var(--muted); max-width:90ch; }
`;
