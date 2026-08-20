"use client";

/**
 * Carving-time search. Type a component, read what the machines actually did.
 *
 * The honest bits, deliberately visible:
 *   • the sample size sits next to every number, because n=4 and n=182 are not
 *     the same claim;
 *   • the MEDIAN leads and the average follows, and when they diverge the card
 *     says so — that gap is a lumpy sample, not a better estimate;
 *   • a component with fewer than 3 usable runs is listed as "not enough data"
 *     rather than quietly averaged.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import type { CarvingTimeSearch, CarvingTimeStat, ComponentIndexRow } from "@/lib/carving-time";

const C = {
  ink: "#0b1220",
  ink2: "#3f4a5c",
  muted: "#8892a4",
  line: "#e6eaf0",
  paper: "#ffffff",
  wash: "#f6f8fb",
  indigo: "#4f46e5",
  indigoSoft: "rgba(79,70,229,0.10)",
  green: "#0f9d58",
  amber: "#c2740a",
  amberSoft: "rgba(194,116,10,0.10)",
};

const card: React.CSSProperties = {
  background: C.paper,
  border: `1px solid ${C.line}`,
  borderRadius: 16,
  boxShadow: "0 1px 2px rgba(11,18,32,0.04), 0 8px 24px rgba(11,18,32,0.05)",
};

const eyebrow: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 800,
  letterSpacing: "0.09em",
  textTransform: "uppercase",
  color: C.muted,
};

/** Hours read badly past a day or two — say "2d 4h" like the floor does. */
function dur(h: number): string {
  if (!Number.isFinite(h) || h <= 0) return "—";
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 24) return `${Math.round(h * 10) / 10} h`;
  const d = Math.floor(h / 24);
  const r = Math.round(h - d * 24);
  return r === 0 ? `${d}d` : `${d}d ${r}h`;
}

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" }) : "—";

function StatCard({ s }: { s: CarvingTimeStat }) {
  // A mean well above the median means a few slabs sat on the bed — worth
  // saying out loud rather than letting someone quote the higher number.
  const skew = s.medianH > 0 ? (s.avgH - s.medianH) / s.medianH : 0;
  return (
    <div style={{ ...card, padding: "16px 18px 17px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 13 }}>
        <span style={{ fontSize: 17, fontWeight: 800, color: C.ink, letterSpacing: "-0.02em" }}>{s.component}</span>
        <span style={{ fontSize: 11, fontWeight: 800, color: C.indigo, background: C.indigoSoft, borderRadius: 999, padding: "3px 10px" }}>
          {s.samples} run{s.samples === 1 ? "" : "s"}
        </span>
        {s.temple && <span style={{ fontSize: 11, color: C.muted }}>at {s.temple}</span>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12 }}>
        <div style={{ border: `1px solid ${C.indigo}44`, background: C.indigoSoft, borderRadius: 12, padding: "11px 13px" }}>
          <div style={{ ...eyebrow, color: C.indigo }}>Typical (median)</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: C.ink, letterSpacing: "-0.02em", marginTop: 3 }}>{dur(s.medianH)}</div>
          <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2 }}>on the machine</div>
        </div>
        <div style={{ border: `1px solid ${C.line}`, background: C.wash, borderRadius: 12, padding: "11px 13px" }}>
          <div style={eyebrow}>Average</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: C.ink2, letterSpacing: "-0.02em", marginTop: 3 }}>{dur(s.avgH)}</div>
          <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2 }}>mean of {s.samples}</div>
        </div>
        <div style={{ border: `1px solid ${C.line}`, background: C.wash, borderRadius: 12, padding: "11px 13px" }}>
          <div style={eyebrow}>Usual range</div>
          <div style={{ fontSize: 15, fontWeight: 800, color: C.ink2, marginTop: 5 }}>{dur(s.p25H)} – {dur(s.p75H)}</div>
          <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2 }}>middle half of runs</div>
        </div>
        <div style={{ border: `1px solid ${C.line}`, background: C.wash, borderRadius: 12, padding: "11px 13px" }}>
          <div style={eyebrow}>Per unit</div>
          <div style={{ fontSize: 15, fontWeight: 800, color: C.ink2, marginTop: 5 }}>
            {s.hoursPerSft != null ? `${s.hoursPerSft} h/SFT` : s.hoursPerCft != null ? `${s.hoursPerCft} h/CFT` : "—"}
          </div>
          <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2 }}>
            {s.hoursPerSft != null && s.hoursPerCft != null ? `also ${s.hoursPerCft} h/CFT` : "scale to a new size"}
          </div>
        </div>
      </div>

      {Math.abs(skew) > 0.25 && (
        <div style={{ marginTop: 12, fontSize: 11.5, color: C.amber, background: C.amberSoft, border: "1px solid rgba(194,116,10,0.25)", borderRadius: 10, padding: "8px 12px", lineHeight: 1.6 }}>
          ⚠ The average sits {Math.round(Math.abs(skew) * 100)}% {skew > 0 ? "above" : "below"} the median — a few runs
          are pulling it. Quote the median ({dur(s.medianH)}); the longest run here was {dur(s.maxH)}.
        </div>
      )}

      {s.variants.length > 1 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ ...eyebrow, marginBottom: 7 }}>By type</div>
          <Rows rows={s.variants} />
        </div>
      )}

      {s.byTemple.length > 1 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ ...eyebrow, marginBottom: 7 }}>By temple</div>
          <Rows rows={s.byTemple} />
        </div>
      )}

      <div style={{ marginTop: 13, paddingTop: 10, borderTop: `1px solid ${C.line}`, fontSize: 10.5, color: C.muted }}>
        Runs from {fmtDate(s.firstAt)} to {fmtDate(s.lastAt)} · shortest {dur(s.minH)}, longest {dur(s.maxH)}
      </div>
    </div>
  );
}

function Rows({ rows }: { rows: Array<{ name: string; samples: number; medianH: number; avgH: number }> }) {
  const max = Math.max(...rows.map((r) => r.medianH), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {rows.map((r) => (
        <div key={r.name} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 90px 62px", alignItems: "center", gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.ink2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div>
            <div style={{ height: 4, borderRadius: 999, background: C.wash, marginTop: 3, overflow: "hidden" }}>
              <div style={{ width: `${(r.medianH / max) * 100}%`, height: "100%", background: C.indigo, borderRadius: 999 }} />
            </div>
          </div>
          <span style={{ fontSize: 12, fontWeight: 800, color: C.ink, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{dur(r.medianH)}</span>
          <span style={{ fontSize: 10.5, color: C.muted, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
            {r.samples} run{r.samples === 1 ? "" : "s"}
          </span>
        </div>
      ))}
    </div>
  );
}

export function CarvingTimeClient({
  result, index, temples, query, temple,
}: {
  result: CarvingTimeSearch;
  index: ComponentIndexRow[];
  temples: string[];
  query: string;
  temple: string | null;
}) {
  const [q, setQ] = useState(query);
  const [t, setT] = useState(temple ?? "");

  const href = useMemo(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    if (t) p.set("temple", t);
    const s = p.toString();
    return `/carving/time${s ? `?${s}` : ""}`;
  }, [q, t]);

  const nothingMatched = query.trim() !== "" && result.matches.length === 0 && result.thin.length === 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Search */}
      <form action="/carving/time" style={{ ...card, padding: "14px 16px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <input
          name="q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Component — jali, pillar, jagati thar, kamal…"
          style={{ flex: "1 1 260px", minWidth: 200, border: `1px solid ${C.line}`, borderRadius: 10, padding: "10px 13px", fontSize: 14, fontWeight: 600, color: C.ink, outline: "none", background: C.paper }}
        />
        <select
          name="temple"
          value={t}
          onChange={(e) => setT(e.target.value)}
          style={{ border: `1px solid ${C.line}`, borderRadius: 10, padding: "10px 11px", fontSize: 12.5, fontWeight: 700, color: C.ink2, background: C.wash, outline: "none", cursor: "pointer", maxWidth: 280 }}
        >
          <option value="">Every temple</option>
          {temples.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <button type="submit" style={{ border: "none", background: C.indigo, color: "#fff", fontSize: 13, fontWeight: 800, borderRadius: 10, padding: "10px 20px", cursor: "pointer" }}>
          Search
        </button>
        {(query || temple) && (
          <Link href="/carving/time" style={{ fontSize: 12, fontWeight: 700, color: C.muted, textDecoration: "none" }}>Clear</Link>
        )}
        <span style={{ display: "none" }}>{href}</span>
      </form>

      {/* Nothing matched at all */}
      {nothingMatched && (
        <div style={{ ...card, padding: "22px 20px", textAlign: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: C.ink }}>No component matches “{query}”</div>
          <div style={{ fontSize: 12.5, color: C.muted, marginTop: 6, lineHeight: 1.7 }}>
            {temple
              ? <>Nothing with that name has been carved at <strong>{temple}</strong>. Try “Every temple”.</>
              : <>Nothing carved so far carries that label. The components we do have are listed below.</>}
          </div>
        </div>
      )}

      {/* Matches */}
      {result.matches.map((s) => <StatCard key={s.component} s={s} />)}

      {/* Matched, but too thin to quote — said plainly rather than averaged. */}
      {result.thin.length > 0 && (
        <div style={{ ...card, padding: "15px 18px", borderColor: "rgba(194,116,10,0.35)", background: "rgba(194,116,10,0.04)" }}>
          <div style={{ ...eyebrow, color: C.amber, marginBottom: 8 }}>Not enough data to give a time</div>
          <div style={{ fontSize: 12.5, color: C.ink2, lineHeight: 1.7, marginBottom: 9 }}>
            These matched your search but have fewer than 3 completed machine runs
            {temple ? <> at <strong>{temple}</strong></> : null}. An average of one or two slabs
            is not a rate, so we are not quoting one.
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
            {result.thin.map((x) => (
              <span key={x.component} style={{ fontSize: 11.5, fontWeight: 700, color: C.ink2, background: C.paper, border: `1px solid ${C.line}`, borderRadius: 999, padding: "5px 11px" }}>
                {x.component} <span style={{ color: C.muted }}>· {x.samples} run{x.samples === 1 ? "" : "s"}</span>
              </span>
            ))}
          </div>
          {temple && (
            <Link href={`/carving/time?q=${encodeURIComponent(query)}`} style={{ display: "inline-block", marginTop: 11, fontSize: 12, fontWeight: 800, color: C.indigo, textDecoration: "none" }}>
              Try across every temple →
            </Link>
          )}
        </div>
      )}

      {/* Browse — what we can answer for */}
      <div style={{ ...card, padding: "15px 18px 17px" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 11, flexWrap: "wrap" }}>
          <span style={eyebrow}>{query ? "Every component on record" : "Components we can time"}</span>
          <span style={{ fontSize: 11, color: C.muted }}>
            {index.length} on record{temple ? ` at ${temple}` : ""} · click one to open it
          </span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
          {index.map((row) => {
            const thin = row.samples < 3;
            return (
              <Link
                key={row.component}
                href={`/carving/time?q=${encodeURIComponent(row.component)}${temple ? `&temple=${encodeURIComponent(temple)}` : ""}`}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 7, textDecoration: "none",
                  border: `1px solid ${C.line}`, background: thin ? C.wash : C.paper,
                  borderRadius: 999, padding: "6px 12px",
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 800, color: thin ? C.muted : C.ink }}>{row.component}</span>
                <span style={{ fontSize: 11, color: thin ? C.muted : C.indigo, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                  {thin ? `${row.samples} run${row.samples === 1 ? "" : "s"}` : dur(row.medianH)}
                </span>
              </Link>
            );
          })}
          {index.length === 0 && (
            <span style={{ fontSize: 12.5, color: C.muted }}>
              No completed machine runs yet{temple ? ` at ${temple}` : ""} — a component gets a time once slabs
              have been loaded onto and unloaded from a CNC.
            </span>
          )}
        </div>
      </div>

      {/* How the number is made — so nobody has to guess. */}
      <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.8, padding: "0 4px" }}>
        Time is measured from when a slab goes <strong>on</strong> the CNC to when it comes <strong>off</strong>
        {" "}(loaded → unloaded), grouped by the slab&rsquo;s label. Runs shorter than 15 minutes are excluded — those are
        load and unload recorded in the same breath, not machine time — as are runs over 30 days, where a slab sat
        through a shutdown. A component needs at least 3 usable runs before a time is quoted.
      </div>
    </div>
  );
}
