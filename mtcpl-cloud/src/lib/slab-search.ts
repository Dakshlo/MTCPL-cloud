/**
 * Shared slab search matcher — lets any slab list search by:
 *   • text   — id / label / temple / stone / block id / etc.
 *   • full dimension triple — "53x29x14", "53 × 29 × 14", "53*29*14"
 *     (orientation-agnostic: a 14×29×53 slab still matches)
 *   • partial dimension — "99x", "99x50" (substring against every
 *     L×W×T permutation)
 *
 * This consolidates the logic that used to live only inside the
 * carving dashboard (Daksh May 2026) so the Total Ready Sizes,
 * Ready Sizes Stock, and Plan Generator searches all behave the
 * same way.
 *
 * Separators accepted between dimensions: x, ×, * (any, mixed case).
 */

export type Dims = {
  length_ft?: number | null;
  width_ft?: number | null;
  thickness_ft?: number | null;
};

/** Parse a complete L×W×T triple query into a sorted [a,b,c] for
 *  orientation-agnostic comparison. Returns null if the query isn't
 *  a clean 3-number triple. */
export function parseDimTriple(
  queryNorm: string,
): [number, number, number] | null {
  const m = queryNorm.match(
    /^\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*$/i,
  );
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  const c = Number(m[3]);
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) {
    return null;
  }
  return [a, b, c].sort((x, y) => x - y) as [number, number, number];
}

/** Every permutation of L×W×T rendered as "LxWxT" strings, so a
 *  partial-dim substring query ("99x", "99x50") hits regardless of
 *  which way round the user typed it. Empty when any dim is missing. */
export function dimPermutations(d: Dims): string[] {
  const L = d.length_ft != null ? Number(d.length_ft) : NaN;
  const W = d.width_ft != null ? Number(d.width_ft) : NaN;
  const T = d.thickness_ft != null ? Number(d.thickness_ft) : NaN;
  if (!Number.isFinite(L) || !Number.isFinite(W) || !Number.isFinite(T)) {
    return [];
  }
  return [
    `${L}x${W}x${T}`,
    `${L}x${T}x${W}`,
    `${W}x${L}x${T}`,
    `${W}x${T}x${L}`,
    `${T}x${L}x${W}`,
    `${T}x${W}x${L}`,
  ];
}

/** Orientation-agnostic full-triple match. */
function matchesDimTriple(triple: [number, number, number], d: Dims): boolean {
  const L = Number(d.length_ft);
  const W = Number(d.width_ft);
  const T = Number(d.thickness_ft);
  if (!Number.isFinite(L) || !Number.isFinite(W) || !Number.isFinite(T)) {
    return false;
  }
  const s = [L, W, T].sort((x, y) => x - y);
  return s[0] === triple[0] && s[1] === triple[1] && s[2] === triple[2];
}

/**
 * Does a slab match the search query?
 *
 * @param rawQuery   the raw search box value
 * @param dims       the slab's L/W/T (in whatever unit they're stored —
 *                   the match is unit-agnostic, it compares numbers as-is)
 * @param textFields any other searchable strings (id, label, temple,
 *                   stone, block id, vendor, status…). Nulls/undefined
 *                   are skipped.
 *
 * Empty query → matches everything (returns true).
 */
export function slabSearchMatch(
  rawQuery: string,
  dims: Dims,
  textFields: Array<string | null | undefined>,
): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;

  // A complete triple short-circuits to the orientation-agnostic
  // numeric compare — we ONLY want dimension matches in that case.
  const triple = parseDimTriple(q);
  if (triple) return matchesDimTriple(triple, dims);

  // Otherwise: partial-dim or text. Normalise separators so "99×50",
  // "99x50", "99*50" all behave identically against the "x"-joined
  // permutation haystack.
  const qn = q.replace(/[×*]/g, "x");
  const haystack = [...textFields, ...dimPermutations(dims)]
    .filter(Boolean)
    .join(" · ")
    .toLowerCase();
  return haystack.includes(qn);
}
