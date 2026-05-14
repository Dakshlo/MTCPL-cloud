// ──────────────────────────────────────────────────────────────────
// Migration 041 — Scaffolding board (the inventory landing page)
// ──────────────────────────────────────────────────────────────────
// What the storekeeper / owner / crosscheck lands on. Site switcher
// at the top, component-card grid below. Picking a different tag
// pivots the grid to show that site's current holdings.
//
// Cards group by component_type. Each type gets its own row header
// (Standards / Ledgers / Transoms / etc.) so the eye can find a
// part quickly. Empty types are hidden — if a fleet doesn't own
// any Ladders, the Ladders header doesn't render.
// ──────────────────────────────────────────────────────────────────

import { headers } from "next/headers";
import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { canViewInventory, canManageInventory } from "@/lib/inventory-permissions";
import { redirect } from "next/navigation";
import { InventoryShell } from "../_components/inventory-shell";
import { SiteSwitcher } from "../_components/site-switcher";
import {
  ComponentCard,
  ComponentCardGrid,
} from "../_components/component-card";
import {
  loadInventorySnapshot,
  stockKey,
  totalOutAtSites,
} from "../_components/stock";
import {
  labelForComponentType,
  type ScaffoldingComponentType,
} from "../_components/component-icon";
import { INV_THEME, primaryButton, secondaryButton } from "../_components/theme";

export default async function ScaffoldingBoardPage({
  searchParams,
}: {
  searchParams: Promise<{ site?: string }>;
}) {
  const { profile } = await requireAuth();
  if (!canViewInventory(profile)) {
    redirect("/dashboard");
  }

  const h = await headers();
  const pathname = h.get("x-pathname") ?? "/inventory/scaffolding";
  const { site: siteParam } = await searchParams;

  const snapshot = await loadInventorySnapshot();
  const { sites, components, stock, plant } = snapshot;

  if (!plant) {
    return (
      <InventoryShell title="Scaffolding" pathname={pathname}>
        <div
          style={{
            background: INV_THEME.paper,
            border: `1px solid ${INV_THEME.parchment}`,
            borderRadius: 12,
            padding: 32,
            textAlign: "center",
            color: INV_THEME.steelLight,
          }}
        >
          Plant site row missing — run migration 041.
        </div>
      </InventoryShell>
    );
  }

  // Pick which site to display. Default to plant.
  const activeSite = sites.find((s) => s.id === siteParam) ?? plant;
  const showPlant = activeSite.is_plant;

  // Filter components to active ones; group by type for the grid.
  const activeComponents = components.filter((c) => c.is_active);
  const types: ScaffoldingComponentType[] = [];
  const byType = new Map<ScaffoldingComponentType, typeof activeComponents>();
  for (const c of activeComponents) {
    if (!byType.has(c.component_type)) {
      byType.set(c.component_type, []);
      types.push(c.component_type);
    }
    byType.get(c.component_type)!.push(c);
  }

  // Quick totals for the header KPIs (plant only).
  let totalAtPlant = 0;
  let totalOutSomewhere = 0;
  let typesInPlay = 0;
  for (const c of activeComponents) {
    const onPlant = stock.get(stockKey(c.id, plant.id))?.onHand ?? 0;
    const out = totalOutAtSites(c.id, sites, stock);
    totalAtPlant += onPlant;
    totalOutSomewhere += out;
    if (onPlant > 0 || out > 0) typesInPlay++;
  }

  const canPropose = canManageInventory(profile);

  return (
    <InventoryShell
      title="Scaffolding"
      subtitle={
        showPlant
          ? "Stock at the plant warehouse"
          : `${activeSite.name} · ${activeSite.code}`
      }
      pathname={pathname}
      actions={
        canPropose ? (
          <>
            <Link href="/inventory/scaffolding/issue" style={primaryButton}>
              → Issue to site
            </Link>
            <Link href="/inventory/scaffolding/receive" style={secondaryButton}>
              ⤓ Receive
            </Link>
          </>
        ) : null
      }
    >
      {/* KPI strip — only on the plant view because per-site has its
          own simpler subtitle. */}
      {showPlant && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 10,
            marginBottom: 16,
          }}
        >
          <KpiCard label="At plant" value={totalAtPlant} unit="pcs total" />
          <KpiCard label="Out at sites" value={totalOutSomewhere} unit="pcs deployed" />
          <KpiCard label="Active components" value={typesInPlay} unit={`of ${activeComponents.length}`} />
          <KpiCard
            label="Live sites"
            value={sites.filter((s) => s.is_active && !s.is_plant).length}
            unit="receiving stock"
          />
        </div>
      )}

      {/* Site switcher */}
      <SiteSwitcher
        sites={sites}
        components={activeComponents}
        stock={stock}
        activeSiteId={activeSite.id}
        hrefBase="/inventory/scaffolding"
      />

      {/* Component grid grouped by type */}
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {types.map((t) => {
          const list = byType.get(t)!;
          // Hide type groups with zero qty AND zero pending AT this site
          // (keeps Plant view full but trims project-site views to what's
          // actually there).
          if (!showPlant) {
            const anyQty = list.some((c) => {
              const e = stock.get(stockKey(c.id, activeSite.id));
              return e && (e.onHand > 0 || e.pendingOut > 0);
            });
            if (!anyQty) return null;
          }
          return (
            <section key={t} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 10,
                  paddingBottom: 6,
                  borderBottom: `1px solid ${INV_THEME.parchment}`,
                }}
              >
                <h3
                  style={{
                    margin: 0,
                    fontSize: 12,
                    fontWeight: 800,
                    color: INV_THEME.steel,
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                  }}
                >
                  {labelForComponentType(t)}
                </h3>
                <span
                  style={{
                    fontSize: 10,
                    color: INV_THEME.steelLight,
                    letterSpacing: "0.04em",
                  }}
                >
                  {list.length} variant{list.length === 1 ? "" : "s"}
                </span>
              </div>
              <ComponentCardGrid>
                {list.map((c) => {
                  const entry = stock.get(stockKey(c.id, activeSite.id));
                  const qty = entry?.onHand ?? 0;
                  const pending = entry?.pendingOut ?? 0;
                  const outAtSites = showPlant
                    ? totalOutAtSites(c.id, sites, stock)
                    : 0;
                  return (
                    <ComponentCard
                      key={c.id}
                      name={c.name}
                      componentType={c.component_type}
                      sizeSpec={c.size_spec}
                      unit={c.unit}
                      qty={qty}
                      pendingOut={pending}
                      secondaryLine={
                        showPlant && outAtSites > 0
                          ? `+${outAtSites.toLocaleString("en-IN")} out at sites`
                          : null
                      }
                    />
                  );
                })}
              </ComponentCardGrid>
            </section>
          );
        })}
      </div>

      {/* Empty-fleet hint */}
      {activeComponents.length === 0 && (
        <div
          style={{
            background: INV_THEME.paper,
            border: `1px dashed ${INV_THEME.parchment}`,
            borderRadius: 12,
            padding: 32,
            textAlign: "center",
            color: INV_THEME.steelLight,
            marginTop: 16,
          }}
        >
          <div style={{ fontSize: 24, marginBottom: 6 }}>📦</div>
          <div style={{ fontWeight: 700, color: INV_THEME.steel }}>
            No scaffolding components in the catalog yet.
          </div>
          <div style={{ fontSize: 12, marginTop: 6 }}>
            {canPropose ? (
              <>
                Open{" "}
                <Link
                  href="/inventory/scaffolding/components"
                  style={{ color: INV_THEME.copper, fontWeight: 700 }}
                >
                  Catalog
                </Link>{" "}
                to add the parts you stock.
              </>
            ) : (
              "Ask the storekeeper to seed the catalog."
            )}
          </div>
        </div>
      )}
    </InventoryShell>
  );
}

function KpiCard({
  label,
  value,
  unit,
}: {
  label: string;
  value: number;
  unit: string;
}) {
  return (
    <div
      style={{
        background: INV_THEME.paper,
        border: `1px solid ${INV_THEME.parchment}`,
        borderRadius: 10,
        padding: "10px 14px",
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: INV_THEME.steelLight,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 800,
          color: INV_THEME.steel,
          letterSpacing: "-0.01em",
          fontFeatureSettings: '"tnum"',
          marginTop: 2,
        }}
      >
        {value.toLocaleString("en-IN")}
      </div>
      <div style={{ fontSize: 10, color: INV_THEME.steelLight }}>{unit}</div>
    </div>
  );
}
