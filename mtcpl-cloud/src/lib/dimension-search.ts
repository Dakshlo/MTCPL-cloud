/**
 * Order-insensitive dimension search (Daksh June 2026).
 *
 * A slab/block entered as 22×50×5 should be findable by typing the three
 * sizes in ANY order — 22x50x5, 50x22x5, 5x22x50 — plus partials (50x22).
 * We mirror the slab-search-bar approach: build every ordering of the dims
 * as an "AxBxC" string and substring-match the query against them, after
 * normalising the separators a user might type (× / X / * / spaces / ,) to
 * a plain 'x'. Use by OR-ing matchesDimSearch(query, dims) into the
 * existing id/temple/label text matches in each search bar.
 */

function permuteStrings(items: string[]): string[][] {
  if (items.length <= 1) return [items];
  const out: string[][] = [];
  for (let i = 0; i < items.length; i += 1) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const p of permuteStrings(rest)) out.push([items[i], ...p]);
  }
  return out;
}

/** Normalise a size query: lowercase, × / * / - / spaces / commas → 'x',
 *  and collapse repeated separators ("50  x  22" → "50x22"). Safe to apply
 *  even to non-size queries (codes) — this only feeds the dimension match,
 *  which is OR'd with the separate id/label/temple text matches. */
export function normalizeDimQuery(query: string): string {
  return query
    .toLowerCase()
    .replace(/[×*,\s-]+/g, "x")
    .replace(/x+/g, "x")
    .replace(/^x|x$/g, "");
}

/** Every ordering of the given dims as a lowercase "AxBxC" string. NULL /
 *  zero dims are dropped (marble blocks often have no L×W×H). */
export function dimPermutations(dims: Array<number | string | null | undefined>): string[] {
  const d = dims
    .map((x) => (x == null ? "" : String(x).trim()))
    .filter((x) => x !== "" && x !== "0");
  if (d.length === 0) return [];
  if (d.length === 1) return [d[0].toLowerCase()];
  return permuteStrings(d).map((p) => p.join("x").toLowerCase());
}

/** True when the query (in any order) matches the dims. Returns false for
 *  an empty query so callers can safely OR it with their text matches. */
export function matchesDimSearch(
  query: string,
  dims: Array<number | string | null | undefined>,
): boolean {
  const q = normalizeDimQuery(query);
  if (!q) return false;
  return dimPermutations(dims).some((p) => p.includes(q));
}
