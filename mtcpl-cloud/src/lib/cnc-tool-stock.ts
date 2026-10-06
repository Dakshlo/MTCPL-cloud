/**
 * The CNC tool store — data layer (Migrations 227 + 228).
 *
 * ONE store for the whole plant. Every CNC vendor draws from the same
 * shelf, so a tool is added once and is immediately available to all of
 * them (Daksh, Oct 2026: "there is a common store for all, but they
 * take from their own account").
 *
 * Stock is DERIVED, never stored:
 *
 *     stock(tool) = SUM(delta) WHERE tool_id = tool AND undone_at IS NULL
 *
 * `vendor_id` on a movement means WHO IT WAS FOR, not where it happened:
 * set on issue/return, NULL on receive/scrap/adjust (store-level).
 *
 * TAKEN MEANS USED. Daksh: "there is no return thing, they take the
 * tool and it gets used — maybe sometimes they will take an item which
 * may need to be returned." So a vendor's screen is a LOG of what they
 * took, not a balance of what they hold, and nothing here pretends to
 * track custody. `return` exists for the occasional item that comes
 * back; it simply puts stock on the shelf and records who brought it.
 */

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/paginate";

export const TOOL_MOVEMENT_KINDS = ["receive", "issue", "return", "scrap", "adjust"] as const;
export type ToolMovementKind = (typeof TOOL_MOVEMENT_KINDS)[number];

/** Movements that belong to a vendor rather than to the store. */
export const VENDOR_KINDS: ToolMovementKind[] = ["issue", "return"];

/** How long a mistake can be taken back. Matches the Work Diary's
 *  unsend window, so "you have ten minutes" is one rule across the app. */
export const UNDO_WINDOW_MS = 10 * 60 * 1000;

/** The low-stock line for a tool whose owner has not set one. */
export const DEFAULT_LOW_STOCK = 3;

export type CncTool = {
  id: string;
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
  vendor_id: string | null;
  kind: ToolMovementKind;
  delta: number;
  taken_by: string | null;
  note: string | null;
  entered_by: string | null;
  /** Mig 229 — set when the take came through the wardrobe QR rather
   *  than someone logged in, so the register can say which door. */
  guest_link_id: string | null;
  created_at: string;
  undone_at: string | null;
};

export type StockLevel = "out" | "low" | "ok";

export type ToolRow = CncTool & {
  /** On the shelf now: SUM(delta) over live movements. */
  stock: number;
  lowLine: number;
  level: StockLevel;
  lastMovement: ToolMovement | null;
  /** Live movements in the last 30 days — drives "what this store
   *  actually touches" ordering, so the common tool is under the thumb. */
  recentCount: number;
};

export function levelOf(stock: number, lowLine: number): StockLevel {
  if (stock <= 0) return "out";
  if (stock <= lowLine) return "low";
  return "ok";
}

export function lowLineOf(t: Pick<CncTool, "low_stock_qty">): number {
  return t.low_stock_qty == null ? DEFAULT_LOW_STOCK : Number(t.low_stock_qty);
}

export function canUndo(m: Pick<ToolMovement, "created_at" | "undone_at">, now = Date.now()): boolean {
  if (m.undone_at) return false;
  return now - new Date(m.created_at).getTime() < UNDO_WINDOW_MS;
}

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
 * The whole store: the catalogue plus every movement, reduced into
 * stock per tool.
 *
 * Paginated because PostgREST silently truncates at 1000 rows — the
 * trap that once broke the monthly costing report. One pass over the
 * ledger is cheaper than a per-tool aggregate and hands back the last
 * movement and the recent-use count for free.
 */
export async function loadStore(): Promise<{ tools: ToolRow[]; movements: ToolMovement[] }> {
  const admin = createAdminSupabaseClient();

  const [{ data: toolRows }, movements] = await Promise.all([
    admin
      .from("cnc_tools")
      .select("id, name, spec, unit, low_stock_qty, low_alert_level, is_active, display_order")
      .eq("is_active", true)
      .order("display_order")
      .order("name"),
    fetchAllPaged((from, to) =>
      admin
        .from("cnc_tool_movements")
        .select("id, tool_id, vendor_id, kind, delta, taken_by, note, entered_by, guest_link_id, created_at, undone_at")
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
    if (!last.has(m.tool_id)) last.set(m.tool_id, m); // moves is newest-first
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

/** Stock for one tool, straight from the ledger. The server actions
 *  re-read this before a write: the page's copy may be a minute old and
 *  two phones can be on the same store. */
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

// ── Views ──────────────────────────────────────────────────────────

/** What one vendor has taken (and returned), newest first. This is the
 *  vendor's whole screen — a log, not a balance. */
export function takingsFor(movements: ToolMovement[], vendorId: string): ToolMovement[] {
  return movements.filter((m) => m.vendor_id === vendorId);
}

/**
 * Names that have carried something away for this vendor, most recent
 * first.
 *
 * This is what stops the register being a typing exercise. No people
 * table, no admin screen: the list builds itself from what has already
 * been written, so by the end of the first week it is one tap.
 */
export function takenByHistory(
  movements: ToolMovement[],
  vendorId: string | null,
  limit = 12,
): string[] {
  const seen = new Map<string, number>();
  for (const m of movements) {
    if (m.undone_at || !m.taken_by) continue;
    if (vendorId && m.vendor_id !== vendorId) continue;
    const name = m.taken_by.trim();
    if (!name) continue;
    const t = new Date(m.created_at).getTime();
    if (!seen.has(name) || t > (seen.get(name) as number)) seen.set(name, t);
  }
  return [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([n]) => n);
}

/** Per-vendor totals for the master view: how much each one has drawn
 *  out of the store, net of anything brought back. */
export function takenByVendor(
  movements: ToolMovement[],
): Map<string, { taken: number; returned: number; lines: number; last: string | null }> {
  const out = new Map<string, { taken: number; returned: number; lines: number; last: string | null }>();
  for (const m of movements) {
    if (m.undone_at || !m.vendor_id) continue;
    const e = out.get(m.vendor_id) ?? { taken: 0, returned: 0, lines: 0, last: null };
    if (m.kind === "issue") e.taken += Math.abs(Number(m.delta));
    if (m.kind === "return") e.returned += Number(m.delta);
    e.lines += 1;
    if (!e.last || m.created_at > e.last) e.last = m.created_at;
    out.set(m.vendor_id, e);
  }
  return out;
}

/** Tools worth showing first when taking: what the store has actually
 *  been touching, then everything else alphabetically. */
export function orderForTaking(tools: ToolRow[]): ToolRow[] {
  return [...tools].sort(
    (a, b) =>
      b.recentCount - a.recentCount ||
      a.display_order - b.display_order ||
      a.name.localeCompare(b.name),
  );
}

/** Low or out, worst first. The banner and the notification both read
 *  this, so they can never disagree about what is short. */
export function shortages(tools: ToolRow[]): ToolRow[] {
  return tools
    .filter((t) => t.level !== "ok")
    .sort((a, b) => a.stock - b.stock || a.name.localeCompare(b.name));
}
