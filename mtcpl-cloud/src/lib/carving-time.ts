/**
 * How long does a component take to carve? (Daksh, Aug 2026)
 *
 * Every CNC job records when the slab went ON the machine (`loaded_at`) and
 * when it came OFF (`unloaded_at`). That span IS the carving time. Group the
 * spans by the slab's component — its `label`: JALI, PILLAR, BEAM, JAGATI THAR,
 * KAMAL — and you can answer "how long does a jali take at Umiya Mataji".
 *
 * WHAT IS COUNTED, AND WHAT IS NOT
 *
 * A span is only usable between 15 minutes and 30 days. Below 15 minutes is
 * someone loading and unloading in the same breath — a data-entry artefact, not
 * machine time (208 of 1,315 spans on record). Above 30 days is a slab left
 * sitting on a machine over a shutdown. Neither describes how long the work
 * takes, and both would wreck an average.
 *
 * MEDIAN FIRST. The mean is dragged up by slabs that sat on the bed over a
 * weekend — JALI averages 84h but its median is 70h. Both are reported; the
 * median is the one to quote, and a wide gap between them is itself the signal
 * that the sample is lumpy.
 *
 * NOT ENOUGH DATA IS AN ANSWER. Under MIN_SAMPLES usable spans, the engine
 * returns `enough: false` and the caller says so. It never averages two slabs
 * and calls it a rate.
 */

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { faceSftFromSlab, cftFromSlab, isThinSlab } from "@/lib/dimensions";

/** Below this many usable spans we decline to quote a number. */
export const MIN_SAMPLES = 3;
/** Load→unload spans outside this window are not machine time. */
const MIN_HOURS = 0.25;
const MAX_HOURS = 720;

export type VariantStat = { name: string; samples: number; medianH: number; avgH: number };

export type CarvingTimeStat = {
  /** The component as stored — the slab's label, upper-cased and trimmed. */
  component: string;
  /** Temple filter in force, or null when the figure spans every temple. */
  temple: string | null;
  samples: number;
  /** False → too few spans to quote. Every other number is still filled in,
   *  but the caller must present it as indicative, not as a rate. */
  enough: boolean;
  medianH: number;
  avgH: number;
  p25H: number;
  p75H: number;
  minH: number;
  maxH: number;
  /** Machine hours per SFT of face / per CFT — lets you scale to a new size.
   *  Null when no sample of that kind carried usable dimensions. */
  hoursPerSft: number | null;
  hoursPerCft: number | null;
  /** Sub-variants (the slab's description: SIDE, PANIDHAR, D&N …). */
  variants: VariantStat[];
  byTemple: VariantStat[];
  firstAt: string | null;
  lastAt: string | null;
};

type Span = {
  component: string;
  temple: string;
  variant: string;
  hours: number;
  sft: number | null;
  cft: number | null;
  at: string;
};

const num = (v: unknown) => Number(v) || 0;
const clean = (v: unknown) => String(v ?? "").trim().toUpperCase();

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** PostgREST silently truncates an uncapped select at 1000 rows — page it. */
async function pageAll<T>(
  make: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let off = 0; off < 100_000; off += 1000) {
    const { data, error } = await make(off, off + 999);
    if (error) break;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

/** Every usable load→unload span, joined to its slab. Cached per request by
 *  the caller if it needs more than one cut of the data. */
export async function loadCarvingSpans(): Promise<Span[]> {
  const admin = createAdminSupabaseClient();

  type ItemRow = { slab_requirement_id: string; loaded_at: string | null; unloaded_at: string | null };
  const items = await pageAll<ItemRow>((from, to) =>
    admin
      .from("carving_items")
      .select("slab_requirement_id, loaded_at, unloaded_at")
      .not("loaded_at", "is", null)
      .not("unloaded_at", "is", null)
      .order("unloaded_at", { ascending: false })
      .range(from, to),
  );

  const usable = items.filter((i) => {
    if (!i.loaded_at || !i.unloaded_at) return false;
    const h = (Date.parse(i.unloaded_at) - Date.parse(i.loaded_at)) / 3_600_000;
    return Number.isFinite(h) && h >= MIN_HOURS && h <= MAX_HOURS;
  });
  if (usable.length === 0) return [];

  type SlabRow = {
    id: string; label: string | null; description: string | null; temple: string | null;
    length_ft: number | string | null; width_ft: number | string | null; thickness_ft: number | string | null;
  };
  const slabs = await pageAll<SlabRow>((from, to) =>
    admin
      .from("slab_requirements")
      .select("id, label, description, temple, length_ft, width_ft, thickness_ft")
      .order("id")
      .range(from, to),
  );
  const byId = new Map(slabs.map((s) => [s.id, s]));

  const spans: Span[] = [];
  for (const it of usable) {
    const s = byId.get(it.slab_requirement_id);
    if (!s) continue;
    const component = clean(s.label);
    if (!component) continue; // an unlabelled slab tells us nothing about a component
    const l = num(s.length_ft), w = num(s.width_ft), t = num(s.thickness_ft);
    const sized = l > 0 && w > 0 && t > 0;
    // Same rule as everywhere else: the thickness is the smallest dim, and a
    // thin slab is measured by face area, a thick one by volume.
    const thin = sized && isThinSlab(l, w, t);
    spans.push({
      component,
      temple: (s.temple ?? "").trim(),
      variant: clean(s.description) || "—",
      hours: (Date.parse(it.unloaded_at!) - Date.parse(it.loaded_at!)) / 3_600_000,
      sft: sized && thin ? faceSftFromSlab(l, w, t) : null,
      cft: sized && !thin ? cftFromSlab(l, w, t) : null,
      at: it.unloaded_at!,
    });
  }
  return spans;
}

function statOf(name: string, rows: Span[]): VariantStat {
  const hs = rows.map((r) => r.hours).sort((a, b) => a - b);
  return {
    name,
    samples: rows.length,
    medianH: round1(quantile(hs, 0.5)),
    avgH: round1(hs.reduce((a, b) => a + b, 0) / (hs.length || 1)),
  };
}

/** Roll a set of spans into one component's figure. */
function summarise(component: string, temple: string | null, rows: Span[]): CarvingTimeStat {
  const hs = rows.map((r) => r.hours).sort((a, b) => a - b);
  const sum = hs.reduce((a, b) => a + b, 0);

  // Per-unit rates use only the samples that carried usable dimensions, and
  // divide TOTAL hours by TOTAL size — an average of per-slab ratios would let
  // one tiny slab with a long run dominate.
  const sftRows = rows.filter((r) => r.sft != null && r.sft > 0);
  const cftRows = rows.filter((r) => r.cft != null && r.cft > 0);
  const sftTotal = sftRows.reduce((a, r) => a + (r.sft ?? 0), 0);
  const cftTotal = cftRows.reduce((a, r) => a + (r.cft ?? 0), 0);

  const group = (key: (r: Span) => string) => {
    const m = new Map<string, Span[]>();
    for (const r of rows) {
      const k = key(r) || "—";
      const arr = m.get(k) ?? [];
      arr.push(r);
      m.set(k, arr);
    }
    return [...m.entries()]
      .map(([k, v]) => statOf(k, v))
      .sort((a, b) => b.samples - a.samples);
  };

  const times = rows.map((r) => r.at).sort();
  return {
    component,
    temple,
    samples: rows.length,
    enough: rows.length >= MIN_SAMPLES,
    medianH: round1(quantile(hs, 0.5)),
    avgH: round1(sum / (hs.length || 1)),
    p25H: round1(quantile(hs, 0.25)),
    p75H: round1(quantile(hs, 0.75)),
    minH: round1(hs[0] ?? 0),
    maxH: round1(hs[hs.length - 1] ?? 0),
    hoursPerSft: sftTotal > 0 ? round1(sftRows.reduce((a, r) => a + r.hours, 0) / sftTotal) : null,
    hoursPerCft: cftTotal > 0 ? round1(cftRows.reduce((a, r) => a + r.hours, 0) / cftTotal) : null,
    variants: group((r) => r.variant).slice(0, 12),
    byTemple: group((r) => r.temple).slice(0, 12),
    firstAt: times[0] ?? null,
    lastAt: times[times.length - 1] ?? null,
  };
}

export type ComponentIndexRow = { component: string; samples: number; medianH: number; temples: number };

/** Everything we can quote on, biggest sample first — the page's browse list. */
export function indexComponents(spans: Span[], temple?: string | null): ComponentIndexRow[] {
  const scoped = temple ? spans.filter((s) => s.temple === temple) : spans;
  const m = new Map<string, Span[]>();
  for (const s of scoped) {
    const arr = m.get(s.component) ?? [];
    arr.push(s);
    m.set(s.component, arr);
  }
  return [...m.entries()]
    .map(([component, rows]) => ({
      component,
      samples: rows.length,
      medianH: round1(quantile(rows.map((r) => r.hours).sort((a, b) => a - b), 0.5)),
      temples: new Set(rows.map((r) => r.temple)).size,
    }))
    .sort((a, b) => b.samples - a.samples || a.component.localeCompare(b.component));
}

export type CarvingTimeSearch = {
  query: string;
  temple: string | null;
  /** Every component whose name contains the query. Empty = nothing matched. */
  matches: CarvingTimeStat[];
  /** Components that matched but have too few spans to quote. */
  thin: Array<{ component: string; samples: number }>;
  totalSpans: number;
};

/** Answer "how long does <component> take", optionally at one temple.
 *  Matching is a case-insensitive substring, so "jali" also finds JALI SMALL,
 *  JALI BIG and CL-4 JALI — they are different components and stay separate. */
export function searchCarvingTime(spans: Span[], query: string, temple?: string | null): CarvingTimeSearch {
  const q = query.trim().toUpperCase();
  const scoped = temple ? spans.filter((s) => s.temple === temple) : spans;

  const m = new Map<string, Span[]>();
  for (const s of scoped) {
    if (q && !s.component.includes(q)) continue;
    const arr = m.get(s.component) ?? [];
    arr.push(s);
    m.set(s.component, arr);
  }

  const all = [...m.entries()].map(([c, rows]) => summarise(c, temple ?? null, rows));
  return {
    query,
    temple: temple ?? null,
    matches: all.filter((s) => s.enough).sort((a, b) => b.samples - a.samples),
    thin: all
      .filter((s) => !s.enough)
      .map((s) => ({ component: s.component, samples: s.samples }))
      .sort((a, b) => b.samples - a.samples),
    totalSpans: scoped.length,
  };
}

/** The temples that have any usable span — the page's filter list. */
export function templesWithData(spans: Span[]): string[] {
  return [...new Set(spans.map((s) => s.temple).filter(Boolean))].sort();
}

/** One-shot helper for the AI tool: load, scope, answer. */
export async function answerCarvingTime(component: string, temple?: string | null) {
  const spans = await loadCarvingSpans();
  const res = searchCarvingTime(spans, component, temple ?? null);
  return { ...res, available: indexComponents(spans, temple ?? null).slice(0, 25) };
}
