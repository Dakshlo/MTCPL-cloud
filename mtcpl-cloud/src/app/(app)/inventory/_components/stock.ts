// ──────────────────────────────────────────────────────────────────
// Migration 041 — Stock computation helpers
// ──────────────────────────────────────────────────────────────────
// Stock-on-hand is derived from `inventory_movements` (no
// materialised table). This file owns the SELECT + JS reduce that
// produces the (component × site → qty) lookup the board and per-
// site pages render from.
//
// Approximate cost: one query that pulls every 'approved' and every
// 'pending_approval' row plus a sweep. At the current scale (≤ a
// few thousand movements lifetime) that's still tens of milliseconds
// on Supabase. If it grows past that, materialise the qty into a
// trigger-maintained table.
// ──────────────────────────────────────────────────────────────────

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import type { ScaffoldingComponentType } from "./component-icon";

export type Site = {
  id: string;
  code: string;
  name: string;
  is_plant: boolean;
  is_active: boolean;
  address: string | null;
  manager_name: string | null;
  manager_phone: string | null;
  started_on: string | null;
  closed_on: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type ScaffoldingComponent = {
  id: string;
  name: string;
  component_type: ScaffoldingComponentType;
  size_spec: string | null;
  unit: string;
  description: string | null;
  display_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type MovementRow = {
  id: string;
  batch_id: string;
  movement_type: "issue" | "return" | "receive" | "writeoff" | "transfer" | "adjust";
  status: "pending_approval" | "approved" | "rejected" | "cancelled";
  from_site_id: string | null;
  to_site_id: string | null;
  component_id: string;
  qty: number;
  proposed_by: string;
  proposed_at: string;
  proposed_note: string | null;
  batch_note: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  rejection_note: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type StockKey = `${string}::${string}`; // `${componentId}::${siteId}`

export type StockMap = Map<StockKey, { onHand: number; pendingOut: number }>;

export function stockKey(componentId: string, siteId: string): StockKey {
  return `${componentId}::${siteId}`;
}

/** Build the (component × site) stock lookup from the full movement
 *  set. Pending-out is netted but separate from on-hand so the UI
 *  can show "X available (Y on hand, Z pending issue)". */
export function buildStockMap(movements: MovementRow[]): StockMap {
  const map: StockMap = new Map();
  for (const m of movements) {
    const qty = Number(m.qty ?? 0);
    if (m.status === "approved") {
      if (m.to_site_id) {
        const key = stockKey(m.component_id, m.to_site_id);
        const prev = map.get(key) ?? { onHand: 0, pendingOut: 0 };
        map.set(key, { ...prev, onHand: prev.onHand + qty });
      }
      if (m.from_site_id) {
        const key = stockKey(m.component_id, m.from_site_id);
        const prev = map.get(key) ?? { onHand: 0, pendingOut: 0 };
        map.set(key, { ...prev, onHand: prev.onHand - qty });
      }
    } else if (m.status === "pending_approval") {
      if (m.from_site_id) {
        const key = stockKey(m.component_id, m.from_site_id);
        const prev = map.get(key) ?? { onHand: 0, pendingOut: 0 };
        map.set(key, { ...prev, pendingOut: prev.pendingOut + qty });
      }
    }
    // rejected / cancelled rows don't affect stock
  }
  return map;
}

/** Postgres "relation does not exist" — fired when the migration
 *  hasn't been run yet on this environment. Surfaced as a tagged
 *  result by `loadInventorySnapshotOrSetup` so callers can render a
 *  helpful "run migration 041" panel instead of dumping the user
 *  into the generic error boundary. */
const PG_UNDEFINED_TABLE = "42P01";

export type InventorySnapshot = {
  sites: Site[];
  components: ScaffoldingComponent[];
  movements: MovementRow[];
  stock: StockMap;
  plant: Site | null;
};

export type InventorySnapshotResult =
  | { kind: "ok"; snapshot: InventorySnapshot }
  | { kind: "needs_migration"; missing: string }
  | { kind: "error"; message: string };

/** Soft-failing version of the snapshot loader. Used by every
 *  inventory page so a missing migration shows a setup banner
 *  rather than crashing into error.tsx. */
export async function loadInventorySnapshotOrSetup(): Promise<InventorySnapshotResult> {
  const supabase = createAdminSupabaseClient();
  const [sitesRes, componentsRes, movementsRes] = await Promise.all([
    supabase
      .from("sites")
      .select("*")
      .order("is_plant", { ascending: false })
      .order("is_active", { ascending: false })
      .order("name", { ascending: true }),
    supabase
      .from("scaffolding_components")
      .select("*")
      .order("component_type", { ascending: true })
      .order("display_order", { ascending: true }),
    supabase
      .from("inventory_movements")
      .select("*")
      .in("status", ["approved", "pending_approval"]),
  ]);

  // Check each query individually so we can name the missing table.
  for (const [name, res] of [
    ["sites", sitesRes],
    ["scaffolding_components", componentsRes],
    ["inventory_movements", movementsRes],
  ] as const) {
    if (res.error) {
      if (res.error.code === PG_UNDEFINED_TABLE) {
        return { kind: "needs_migration", missing: name };
      }
      return {
        kind: "error",
        message: `${name} query failed: ${res.error.message}`,
      };
    }
  }

  const sites = ((sitesRes.data ?? []) as unknown) as Site[];
  const components = ((componentsRes.data ?? []) as unknown) as ScaffoldingComponent[];
  const movements = ((movementsRes.data ?? []) as unknown) as MovementRow[];
  const stock = buildStockMap(movements);
  const plant = sites.find((s) => s.is_plant) ?? null;

  return {
    kind: "ok",
    snapshot: { sites, components, movements, stock, plant },
  };
}

/** Legacy throwing variant — kept for places that prefer a try/catch
 *  shape (none today; preserved in case a future caller wants it).
 *  Prefer `loadInventorySnapshotOrSetup`. */
export async function loadInventorySnapshot(): Promise<InventorySnapshot> {
  const r = await loadInventorySnapshotOrSetup();
  if (r.kind === "ok") return r.snapshot;
  if (r.kind === "needs_migration") {
    throw new Error(
      `Inventory tables missing (${r.missing}) — run migration 041_inventory_scaffolding.sql.`,
    );
  }
  throw new Error(r.message);
}

/** Stock-level dot summary: ●●● healthy / ●●○ low / ●○○ out.
 *  Thresholds are hardcoded for v1 (no per-component reorder
 *  threshold column yet). The numbers chosen err on the side of
 *  "always show three dots" — adjust later when there's real
 *  signal on what counts as 'low' for each part. */
export function stockLevel(qty: number): "healthy" | "low" | "out" {
  if (qty <= 0) return "out";
  if (qty < 10) return "low";
  return "healthy";
}

/** Aggregate "out at sites" total for a component, i.e. the qty
 *  currently sitting somewhere that isn't the plant. Useful for the
 *  plant-view card subtitle: "124 at plant · 312 out at sites". */
export function totalOutAtSites(
  componentId: string,
  sites: Site[],
  stock: StockMap,
): number {
  let total = 0;
  for (const s of sites) {
    if (s.is_plant) continue;
    const e = stock.get(stockKey(componentId, s.id));
    if (e) total += e.onHand;
  }
  return total;
}
