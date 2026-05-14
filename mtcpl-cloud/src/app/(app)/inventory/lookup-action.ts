"use server";

// ──────────────────────────────────────────────────────────────────
// Inventory ID lookup (mig 044 follow-on / Daksh).
// ──────────────────────────────────────────────────────────────────
// Department-aware Find-ID query used by the topbar dropdown when
// the user's active department is Inventory. Tries, in order:
//   1. Site code or name (PLANT, ALPHA, fuzzy substring on name)
//   2. Component name (Standard, Ledger, Transom, Jali — fuzzy)
//
// Returns a tagged union the client switches on, with stock-by-site
// and recent-movement context.
//
// Auth: developer / owner. Storekeeper has dedicated in-page tools
// already, and Daksh asked to keep the cross-dept Find-ID for
// owner/dev only.
// ──────────────────────────────────────────────────────────────────

import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export type InventorySiteResult = {
  kind: "site";
  site: {
    id: string;
    code: string;
    name: string;
    isPlant: boolean;
    isActive: boolean;
    managerName: string | null;
    address: string | null;
    startedOn: string | null;
  };
  totalPieces: number;
  componentHoldings: Array<{
    componentName: string;
    componentType: string;
    qty: number;
  }>;
  recentBatches: Array<{
    batchId: string;
    typeLabel: string;
    status: string;
    counterpartyName: string | null;
    direction: "in" | "out";
    totalQty: number;
    proposedAt: string;
  }>;
};

export type InventoryComponentResult = {
  kind: "component";
  component: {
    id: string;
    name: string;
    type: string;
    sizeSpec: string | null;
    unit: string;
    imageDataUrl: string | null;
  };
  totals: {
    atPlant: number;
    outAtSites: number;
    totalInPipeline: number;
    pendingOut: number;
  };
  byLocation: Array<{
    siteCode: string;
    siteName: string;
    isPlant: boolean;
    qty: number;
    pendingOut: number;
  }>;
};

export type InventoryNotFoundResult = {
  kind: "not_found";
  query: string;
  suggestions: Array<{
    kind: "site" | "component";
    label: string;
    hint: string;
  }>;
};

export type InventoryLookupResult =
  | InventorySiteResult
  | InventoryComponentResult
  | InventoryNotFoundResult;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export async function lookupInventory(query: string): Promise<InventoryLookupResult> {
  await requireAuth(["developer", "owner"]);
  const admin = createAdminSupabaseClient();

  const q = query.trim();
  if (!q) return { kind: "not_found", query: "", suggestions: [] };

  const needle = norm(q);

  // 1. Site lookup — exact code or fuzzy name substring.
  const { data: siteRows } = await admin
    .from("sites")
    .select("id, code, name, is_plant, is_active, manager_name, address, started_on")
    .order("is_plant", { ascending: false })
    .order("name");
  const sites = (siteRows ?? []) as Array<{
    id: string;
    code: string;
    name: string;
    is_plant: boolean;
    is_active: boolean;
    manager_name: string | null;
    address: string | null;
    started_on: string | null;
  }>;

  const exactCode = sites.find((s) => s.code.toLowerCase() === q.toLowerCase());
  const nameMatch = sites.find((s) => norm(s.name).includes(needle));
  const siteHit = exactCode ?? nameMatch ?? null;

  if (siteHit) {
    return await loadSiteResult(admin, siteHit);
  }

  // 2. Component lookup — fuzzy on name.
  const { data: compRows } = await admin
    .from("scaffolding_components")
    .select("id, name, component_type, size_spec, unit, image_data_url, is_active, display_order")
    .order("display_order");
  const comps = (compRows ?? []) as Array<{
    id: string;
    name: string;
    component_type: string;
    size_spec: string | null;
    unit: string;
    image_data_url: string | null;
    is_active: boolean;
    display_order: number;
  }>;
  const compMatches = comps.filter((c) => norm(c.name).includes(needle) && c.is_active);

  if (compMatches.length === 1) {
    return await loadComponentResult(admin, compMatches[0], sites);
  }

  // 3. Nothing resolved → suggestions.
  const suggestions: InventoryNotFoundResult["suggestions"] = [];
  for (const s of sites.slice(0, 5)) {
    suggestions.push({
      kind: "site",
      label: `${s.code} · ${s.name}`,
      hint: s.is_plant ? "warehouse" : "project site",
    });
  }
  for (const c of compMatches.slice(0, 5)) {
    suggestions.push({
      kind: "component",
      label: c.name,
      hint: `${c.component_type}${c.size_spec ? ` · ${c.size_spec}` : ""}`,
    });
  }

  return { kind: "not_found", query: q, suggestions };
}

async function loadSiteResult(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  site: {
    id: string;
    code: string;
    name: string;
    is_plant: boolean;
    is_active: boolean;
    manager_name: string | null;
    address: string | null;
    started_on: string | null;
  },
): Promise<InventorySiteResult> {
  // Pull every approved movement touching this site to compute current
  // holdings + recent batch summary.
  const [{ data: movements }, { data: comps }] = await Promise.all([
    admin
      .from("inventory_movements")
      .select(
        "id, batch_id, movement_type, status, from_site_id, to_site_id, component_id, qty, proposed_at",
      )
      .or(`from_site_id.eq.${site.id},to_site_id.eq.${site.id}`)
      .eq("status", "approved")
      .order("proposed_at", { ascending: false }),
    admin
      .from("scaffolding_components")
      .select("id, name, component_type")
      .eq("is_active", true),
  ]);

  type Mov = {
    id: string;
    batch_id: string;
    movement_type: string;
    status: string;
    from_site_id: string | null;
    to_site_id: string | null;
    component_id: string;
    qty: number;
    proposed_at: string;
  };
  type Comp = { id: string; name: string; component_type: string };
  const movs = (movements ?? []) as unknown as Mov[];
  const compMap = new Map<string, Comp>();
  for (const c of (comps ?? []) as Comp[]) compMap.set(c.id, c);

  // Per-component qty at this site
  const byComp = new Map<string, number>();
  for (const m of movs) {
    const qty = Number(m.qty);
    if (m.to_site_id === site.id) byComp.set(m.component_id, (byComp.get(m.component_id) ?? 0) + qty);
    if (m.from_site_id === site.id) byComp.set(m.component_id, (byComp.get(m.component_id) ?? 0) - qty);
  }
  const componentHoldings = Array.from(byComp.entries())
    .filter(([, qty]) => qty > 0)
    .map(([compId, qty]) => {
      const c = compMap.get(compId);
      return {
        componentName: c?.name ?? "Unknown",
        componentType: c?.component_type ?? "other",
        qty,
      };
    })
    .sort((a, b) => b.qty - a.qty);

  const totalPieces = componentHoldings.reduce((s, c) => s + c.qty, 0);

  // Recent batches touching this site (5 most recent, grouped by batch_id).
  type Batch = {
    batchId: string;
    type: string;
    status: string;
    direction: "in" | "out";
    counterpartySiteId: string | null;
    totalQty: number;
    proposedAt: string;
  };
  const batches = new Map<string, Batch>();
  for (const m of movs) {
    const existing = batches.get(m.batch_id);
    const direction: "in" | "out" = m.to_site_id === site.id ? "in" : "out";
    const counterparty = direction === "in" ? m.from_site_id : m.to_site_id;
    if (existing) {
      existing.totalQty += Number(m.qty);
    } else {
      batches.set(m.batch_id, {
        batchId: m.batch_id,
        type: m.movement_type,
        status: m.status,
        direction,
        counterpartySiteId: counterparty,
        totalQty: Number(m.qty),
        proposedAt: m.proposed_at,
      });
    }
  }

  // Resolve counterparty site names
  const counterpartyIds = new Set<string>();
  for (const b of batches.values()) {
    if (b.counterpartySiteId) counterpartyIds.add(b.counterpartySiteId);
  }
  const counterpartyMap = new Map<string, string>();
  if (counterpartyIds.size > 0) {
    const { data: csites } = await admin
      .from("sites")
      .select("id, name")
      .in("id", Array.from(counterpartyIds));
    for (const s of csites ?? []) {
      counterpartyMap.set((s as { id: string }).id, (s as { name: string }).name);
    }
  }

  function userLabel(t: string) {
    if (t === "receive") return "Buy";
    if (t === "writeoff") return "Destroyed";
    if (t === "issue") return "Issue";
    if (t === "return") return "Return";
    return t;
  }

  const recentBatches = Array.from(batches.values())
    .sort((a, b) => new Date(b.proposedAt).getTime() - new Date(a.proposedAt).getTime())
    .slice(0, 5)
    .map((b) => ({
      batchId: b.batchId,
      typeLabel: userLabel(b.type),
      status: b.status,
      counterpartyName: b.counterpartySiteId
        ? counterpartyMap.get(b.counterpartySiteId) ?? null
        : null,
      direction: b.direction,
      totalQty: b.totalQty,
      proposedAt: b.proposedAt,
    }));

  return {
    kind: "site",
    site: {
      id: site.id,
      code: site.code,
      name: site.name,
      isPlant: site.is_plant,
      isActive: site.is_active,
      managerName: site.manager_name,
      address: site.address,
      startedOn: site.started_on,
    },
    totalPieces,
    componentHoldings,
    recentBatches,
  };
}

async function loadComponentResult(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  comp: {
    id: string;
    name: string;
    component_type: string;
    size_spec: string | null;
    unit: string;
    image_data_url: string | null;
  },
  sites: Array<{
    id: string;
    code: string;
    name: string;
    is_plant: boolean;
    is_active: boolean;
  }>,
): Promise<InventoryComponentResult> {
  const { data: movements } = await admin
    .from("inventory_movements")
    .select("qty, status, from_site_id, to_site_id")
    .eq("component_id", comp.id)
    .in("status", ["approved", "pending_approval"]);

  type Mov = {
    qty: number;
    status: string;
    from_site_id: string | null;
    to_site_id: string | null;
  };
  const movs = (movements ?? []) as unknown as Mov[];

  // Per-site qty (only sum approved). Pending-out is netted separately.
  const onHand = new Map<string, number>();
  const pendingOut = new Map<string, number>();
  for (const m of movs) {
    const qty = Number(m.qty);
    if (m.status === "approved") {
      if (m.to_site_id) onHand.set(m.to_site_id, (onHand.get(m.to_site_id) ?? 0) + qty);
      if (m.from_site_id) onHand.set(m.from_site_id, (onHand.get(m.from_site_id) ?? 0) - qty);
    } else if (m.status === "pending_approval") {
      if (m.from_site_id) pendingOut.set(m.from_site_id, (pendingOut.get(m.from_site_id) ?? 0) + qty);
    }
  }

  const byLocation = sites
    .filter((s) => s.is_plant || s.is_active)
    .map((s) => ({
      siteCode: s.code,
      siteName: s.name,
      isPlant: s.is_plant,
      qty: onHand.get(s.id) ?? 0,
      pendingOut: pendingOut.get(s.id) ?? 0,
    }))
    .sort((a, b) => {
      // Plant first, then by qty descending
      if (a.isPlant !== b.isPlant) return a.isPlant ? -1 : 1;
      return b.qty - a.qty;
    });

  const plantQty = byLocation.find((l) => l.isPlant)?.qty ?? 0;
  const plantPendingOut = byLocation.find((l) => l.isPlant)?.pendingOut ?? 0;
  const outAtSites = byLocation
    .filter((l) => !l.isPlant)
    .reduce((s, l) => s + l.qty, 0);

  return {
    kind: "component",
    component: {
      id: comp.id,
      name: comp.name,
      type: comp.component_type,
      sizeSpec: comp.size_spec,
      unit: comp.unit,
      imageDataUrl: comp.image_data_url,
    },
    totals: {
      atPlant: plantQty,
      outAtSites,
      totalInPipeline: plantQty + outAtSites,
      pendingOut: plantPendingOut,
    },
    byLocation,
  };
}
