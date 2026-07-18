// ──────────────────────────────────────────────────────────────────
// Pagination + chunk helpers — the antidote to PostgREST's silent
// 1000-row cap (Daksh, Jul 2026).
//
// This project's Supabase enforces a server-side max-rows of 1000: any
// `.select()` that can match more than 1000 rows silently returns only the
// first 1000, with NO error. Code that then treats the result as complete
// (a list, a picker/search source, a count, a dedup, a client filter) makes
// rows "disappear". The whole codebase already fixes this inline with
// `.range()` loops (fetchAllOpenSlabs, fetchAllReadySlabs, …); these helpers
// package the same pattern so new call sites can't get the loop subtly wrong.
//
// ⚠ The query MUST end in a TOTAL order (a unique tiebreaker such as
//   `.order("id")` after any non-unique sort key) or a tie-group straddling a
//   page boundary can drop or duplicate a row.
// ──────────────────────────────────────────────────────────────────

type PagedResult<T> = { data: T[] | null; error: { message: string } | null };

/**
 * Fetch EVERY page of a query, 1000 rows at a time, until a short page ends it.
 * `makeQuery(from, to)` must apply `.range(from, to)` to a query with a stable
 * total order. Throws on the first page error (same as the inline loops).
 *
 *   const rows = await fetchAllPaged<Row>((from, to) =>
 *     admin.from("t").select("…").eq("status","x").order("id").range(from, to));
 */
export async function fetchAllPaged<T>(
  makeQuery: (from: number, to: number) => PromiseLike<PagedResult<T>>,
  pageSize = 1000,
  cap = 100_000,
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; from < cap; from += pageSize) {
    const { data, error } = await makeQuery(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    if (page.length === 0) break;
    all.push(...page);
    if (page.length < pageSize) break;
  }
  return all;
}

/** Split ids into fixed-size groups so a `.in(col, chunk)` never exceeds the
 *  1000-row response cap (or a too-long request URL). Default 300 per chunk. */
export function chunkIds<T>(ids: readonly T[], size = 300): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size) as T[]);
  return out;
}
