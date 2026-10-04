/**
 * CNC tool crib — the data layer (Migration 227).
 *
 * Stock is DERIVED, never stored:
 *
 *     stock(tool) = SUM(delta) WHERE tool_id = tool AND undone_at IS NULL
 *
 * There is no quantity column anywhere to drift out of step, and every
 * number on screen can be traced back to the lines that made it. Same
 * principle the scaffolding inventory proved (lib is separate on
 * purpose — see mig 227's header).
 */

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/paginate";

export const TOOL_MOVEMENT_KINDS = ["receive", "issue", "return", "scrap", "adjust"] as const;
export type ToolMovementKind = (typeof TOOL_MOVEMENT_KINDS)[number];

/** How long a mistake can be taken back. Matches the Work Diary's
 *  unsend window, so "you have ten minutes" is one rule across the app
 *  rather than a different number per screen. */
export const UNDO_WINDOW_MS = 10 * 60 * 1000;

/** The fallback low-stock line for a tool whose owner has not set one.
 *  Deliberately generous — a tool added in a hurry should still warn
 *  before it hits zero. */
export const DEFAULT_LOW_STOCK = 3;

export type CncTool = {
  id: string;
  vendor_id: string;
  name: string;
  spec: string | null;
  unit: string;
  low_stock_qty: number | null;
  low_alert_level: number | null;
  is_active: boolean;
  display_order: number;
};

export type ToolMovement = {
  id: string;
  tool_id: string;
  kind: ToolMovementKind;
  delta: number;
  taken_by: string | null;
  note: string | null;
  entered_by: string | null;
  created_at: string;
  undone_at: string | null;
};

export type ToolRow = CncTool & {
  /** SUM(delta) over live movements. */
  stock: number;
  /** The line this tool is judged against — its own, or the fallback. */
  lowLine: number;
  level: StockLevel;
  /** Newest live movement, for "last taken by X, 2 days ago". */
  lastMovement: ToolMovement | null;
  /** Live movements in the last 30 days — drives "recent" ordering so
   *  the bit they use every day sits at the top without being searched. */
  recentCount: number;
};

export type StockLevel = "out" | "low" | "ok";

/** One tool's standing against its own line.
 *
 *  `lowLine` is the tool's `low_stock_qty` when set, otherwise
 *  DEFAULT_LOW_STOCK — so every tool has an opinion, and a tool added
 *  without one still turns amber before it runs out. */
export function levelOf(stock: number, lowLine: number): StockLevel {
  if (stock <= 0) return "out";
  if (stock <= lowLine) return "low";
  return "ok";
}

export function lowLineOf(t: Pick<CncTool, "low_stock_qty">): number {
  return t.low_stock_qty == null ? DEFAULT_LOW_STOCK : Number(t.low_stock_qty);
}

/** Within the undo window AND not already undone. The server re-checks
 *  this before voiding — the UI hiding the button is not a control. */
export function canUndo(m: Pick<ToolMovement, "created_at" | "undone_at">, now = Date.now()): boolean {
  if (m.undone_at) return false;
  return now - new Date(m.created_at).getTime() < UNDO_WINDOW_MS;
}

export function msLeftToUndo(m: Pick<ToolMovement, "created_at">, now = Date.now()): number {
  return Math.max(0, UNDO_WINDOW_MS - (now - new Date(m.created_at).getTime()));
}

/** Human label for a movement kind, in the words the floor uses. */
export const KIND_LABEL: Record<ToolMovementKind, string> = {
  receive: "Stock added",
  issue: "Taken",
  return: "Returned",
  scrap: "Scrapped",
  adjust: "Count fixed",
};

export const KIND_VERB: Record<ToolMovementKind, string> = {
  receive: "Add stock",
  issue: "Take out",
  return: "Return",
  scrap: "Scrap",
  adjust: "Fix count",
};

// ── Loaders ────────────────────────────────────────────────────────

/** Every crib the module knows about (the active CNC vendors). */
export async function listToolVendors(): Promise<Array<{ id: string; name: string }>> {
  const admin = createAdminSupabaseClient();
  const { data } = await admin
    .from("vendors")
    .select("id, name")
    .eq("vendor_type", "CNC")
    .eq("is_active", true)
    .order("name");
  return (data ?? []) as Array<{ id: string; name: string }>;
}

/**
 * The whole crib in one shot: the catalogue plus every live movement,
 * reduced client-side into stock per tool.
 *
 * Paginated because PostgREST silently truncates at 1000 rows and a
 * busy crib will pass that inside a year — the same trap that broke the
 * monthly costing report. A crib is small enough that one pass over its
 * ledger is cheaper than a per-tool aggregate query, and it gives us the
 * last movement and the recent-use count for free.
 */
export async function loadCrib(vendorId: string): Promise<{
  tools: ToolRow[];
  movements: ToolMovement[];
}> {
  const admin = createAdminSupabaseClient();

  const [{ data: toolRows }, movements] = await Promise.all([
    admin
      .from("cnc_tools")
      .select("id, vendor_id, name, spec, unit, low_stock_qty, low_alert_level, is_active, display_order")
      .eq("vendor_id", vendorId)
      .eq("is_active", true)
      .order("display_order")
      .order("name"),
    fetchAllPaged((from, to) =>
      admin
        .from("cnc_tool_movements")
        .select("id, tool_id, kind, delta, taken_by, note, entered_by, created_at, undone_at")
        .eq("vendor_id", vendorId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to),
    ),
  ]);

  const tools = (toolRows ?? []) as CncTool[];
  const moves = (movements ?? []) as ToolMovement[];

  const stock = new Map<string, number>();
  const last = new Map<string, ToolMovement>();
  const recent = new Map<string, number>();
  const monthAgo = Date.now() - 30 * 86_400_000;

  for (const m of moves) {
    if (m.undone_at) continue; // voided — counts for nothing
    stock.set(m.tool_id, (stock.get(m.tool_id) ?? 0) + Number(m.delta));
    // moves is newest-first, so the first one we see is the latest.
    if (!last.has(m.tool_id)) last.set(m.tool_id, m);
    if (new Date(m.created_at).getTime() >= monthAgo) {
      recent.set(m.tool_id, (recent.get(m.tool_id) ?? 0) + 1);
    }
  }

  const rows: ToolRow[] = tools.map((t) => {
    const s = stock.get(t.id) ?? 0;
    const lowLine = lowLineOf(t);
    return {
      ...t,
      low_stock_qty: t.low_stock_qty == null ? null : Number(t.low_stock_qty),
      low_alert_level: t.low_alert_level == null ? null : Number(t.low_alert_level),
      stock: s,
      lowLine,
      level: levelOf(s, lowLine),
      lastMovement: last.get(t.id) ?? null,
      recentCount: recent.get(t.id) ?? 0,
    };
  });

  return { tools: rows, movements: moves };
}

/** Stock for one tool, straight from the ledger. Used by the server
 *  actions to re-check before a write — the page's copy may be seconds
 *  stale and two phones can be on the same crib. */
export async function stockForTool(toolId: string): Promise<number> {
  const admin = createAdminSupabaseClient();
  const rows = await fetchAllPaged((from, to) =>
    admin
      .from("cnc_tool_movements")
      .select("delta")
      .eq("tool_id", toolId)
      .is("undone_at", null)
      .range(from, to),
  );
  return (rows ?? []).reduce((a, r) => a + Number((r as { delta: number }).delta), 0);
}

/**
 * Names that have taken something from this crib, most recent first.
 *
 * This is what stops the register being a typing exercise. There is no
 * people table to maintain and no admin screen: the list builds itself
 * out of what has already been written, so by the end of the first week
 * logging a tool is one tap.
 */
export function takenByHistory(movements: ToolMovement[], limit = 12): string[] {
  const seen = new Map<string, number>();
  for (const m of movements) {
    if (m.undone_at || !m.taken_by) continue;
    const name = m.taken_by.trim();
    if (!name) continue;
    const t = new Date(m.created_at).getTime();
    if (!seen.has(name) || t > (seen.get(name) as number)) seen.set(name, t);
  }
  return [...seen.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name]) => name);
}

/** Tools worth showing first on the take-out screen: what this crib has
 *  actually been touching, then everything else alphabetically. */
export function orderForTaking(tools: ToolRow[]): ToolRow[] {
  return [...tools].sort(
    (a, b) =>
      b.recentCount - a.recentCount ||
      a.display_order - b.display_order ||
      a.name.localeCompare(b.name),
  );
}

/** Low or out, worst first — the banner and the notification both read
 *  this so they can never disagree about what is short. */
export function shortages(tools: ToolRow[]): ToolRow[] {
  return tools
    .filter((t) => t.level !== "ok")
    .sort((a, b) => a.stock - b.stock || a.name.localeCompare(b.name));
}
