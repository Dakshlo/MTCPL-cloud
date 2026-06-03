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
import type { ReactNode } from "react";
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
  loadInventorySnapshotOrSetup,
  stockKey,
  yardStockKey,
  totalOutAtSites,
} from "../_components/stock";
import { InventorySetupBanner } from "../_components/setup-banner";
import {
  labelForComponentType,
  type ScaffoldingComponentType,
} from "../_components/component-icon";
import { INV_THEME, primaryButton, secondaryButton } from "../_components/theme";

// Daksh (June 2026) — soft background tints so every card of the same
// component type shares one colour and reads as a group. Assigned by
// the order types appear, so adjacent groups always differ; the
// palette cycles for fleets with many types. Kept very light so the
// dark card text stays readable.
const TYPE_TINTS = [
  "#eaf2fb", // blue
  "#eaf6ec", // green
  "#fcf3e3", // amber
  "#f3ecfb", // violet
  "#fbecec", // rose
  "#e8f5f3", // teal
  "#f6efe5", // tan
  "#fdeef6", // pink
];

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

  const snapshotResult = await loadInventorySnapshotOrSetup();
  if (snapshotResult.kind === "needs_migration") {
    return (
      <InventoryShell title="Scaffolding" pathname={pathname}>
        <InventorySetupBanner missing={snapshotResult.missing} />
      </InventoryShell>
    );
  }
  if (snapshotResult.kind === "error") {
    return (
      <InventoryShell title="Scaffolding" pathname={pathname}>
        <div
          style={{
            background: INV_THEME.paper,
            border: `1px solid ${INV_THEME.parchment}`,
            borderRadius: 12,
            padding: 32,
            textAlign: "center",
            color: INV_THEME.stockOut,
          }}
        >
          {snapshotResult.message}
        </div>
      </InventoryShell>
    );
  }
  const { sites, components, stock, plant, yards, yardStock } =
    snapshotResult.snapshot;

  if (!plant) {
    return (
      <InventoryShell title="Scaffolding" pathname={pathname}>
        <InventorySetupBanner missing="sites (PLANT row not seeded)" />
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

  // One shared tint per component type (by appearance order).
  const typeTint = new Map<ScaffoldingComponentType, string>();
  types.forEach((t, i) => typeTint.set(t, TYPE_TINTS[i % TYPE_TINTS.length]));

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
            {yards.length >= 2 && (
              <Link href="/inventory/scaffolding/move-yard" style={secondaryButton}>
                ⇄ Move yard
              </Link>
            )}
          </>
        ) : null
      }
    >
      {/* KPI strip — only on the plant view because per-site has its
          own simpler subtitle. Daksh May 2026 polish: each card gets
          a leading icon, a subtle parchment-to-paper gradient, and a
          coloured left rail so the four KPIs read as a row of indices
          rather than a row of identical boxes. */}
      {showPlant && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 10,
            marginBottom: 16,
          }}
        >
          <KpiCard
            icon="🏭"
            label="At plant"
            value={totalAtPlant}
            unit="pcs total"
            accent={INV_THEME.steel}
          />
          <KpiCard
            icon="🚚"
            label="Out at sites"
            value={totalOutSomewhere}
            unit="pcs deployed"
            accent={INV_THEME.copper}
          />
          <KpiCard
            icon="📦"
            label="Active components"
            value={typesInPlay}
            unit={`of ${activeComponents.length}`}
            accent={INV_THEME.stockHealthy}
          />
          <KpiCard
            icon="🏗"
            label="Live sites"
            value={sites.filter((s) => s.is_active && !s.is_plant).length}
            unit="receiving stock"
            accent={INV_THEME.stockLow}
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

      {/* Component groups — one coloured PANEL per component type
       *  (Daksh, June 2026: "all of a group on one shared background
       *  so they look grouped"). Each type is a tinted panel with a
       *  header + count; the cards inside are plain white so they read
       *  as one block sitting on the group's colour. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {types.map((t) => {
          const list = byType.get(t)!;
          // Plant view shows every component; a project-site view only
          // shows what's actually present there.
          const visible = showPlant
            ? list
            : list.filter((c) => {
                const e = stock.get(stockKey(c.id, activeSite.id));
                return e && (e.onHand > 0 || e.pendingOut > 0);
              });
          if (visible.length === 0) return null;
          return (
            <TypeGroupPanel
              key={t}
              label={labelForComponentType(t)}
              tint={typeTint.get(t)}
              count={visible.length}
            >
              <ComponentCardGrid>
                {visible.map((c) => {
                  const entry = stock.get(stockKey(c.id, activeSite.id));
                  const qty = entry?.onHand ?? 0;
                  const pending = entry?.pendingOut ?? 0;
                  const outAtSites = showPlant
                    ? totalOutAtSites(c.id, sites, stock)
                    : 0;
                  const yardBreakdown =
                    showPlant && yards.length > 0
                      ? yards.map((y) => ({
                          label: y.name,
                          qty:
                            yardStock.get(yardStockKey(c.id, y.id))?.onHand ?? 0,
                        }))
                      : undefined;
                  const siteBreakdown = showPlant
                    ? sites
                        .filter((s) => !s.is_plant)
                        .map((s) => ({
                          name: s.name,
                          qty: stock.get(stockKey(c.id, s.id))?.onHand ?? 0,
                        }))
                        .filter((s) => s.qty > 0)
                    : undefined;
                  return (
                    <ComponentCard
                      key={c.id}
                      name={c.name}
                      componentType={c.component_type}
                      sizeSpec={c.size_spec}
                      unit={c.unit}
                      qty={qty}
                      pendingOut={pending}
                      imageDataUrl={c.image_data_url}
                      yardBreakdown={yardBreakdown}
                      siteBreakdown={siteBreakdown}
                      outAtSitesTotal={outAtSites}
                      interactive={showPlant}
                      secondaryLine={
                        showPlant && outAtSites > 0
                          ? `+${outAtSites.toLocaleString("en-IN")} out at sites`
                          : null
                      }
                    />
                  );
                })}
              </ComponentCardGrid>
            </TypeGroupPanel>
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

// Daksh (June 2026) — coloured group panel: one shared background per
// component type, holding all that type's (white) cards so the group
// reads as a single block.
function TypeGroupPanel({
  label,
  tint,
  count,
  children,
}: {
  label: string;
  tint?: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <section
      style={{
        background: tint ?? INV_THEME.paper,
        border: `1px solid ${INV_THEME.parchment}`,
        borderRadius: 14,
        padding: "12px 14px 14px",
        boxShadow: "0 1px 0 rgba(28, 52, 69, 0.04)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          margin: "0 2px 10px",
        }}
      >
        <span
          style={{
            fontSize: 12.5,
            fontWeight: 800,
            color: INV_THEME.steel,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: INV_THEME.steelLight,
            background: INV_THEME.paper,
            border: `1px solid ${INV_THEME.parchment}`,
            borderRadius: 999,
            padding: "1px 8px",
          }}
        >
          {count}
        </span>
      </div>
      {children}
    </section>
  );
}

function KpiCard({
  icon,
  label,
  value,
  unit,
  accent,
}: {
  icon: string;
  label: string;
  value: number;
  unit: string;
  /** Left-rail tint so a row of KPIs distinguishes itself at a
   *  glance — plant grey, deployed copper, active green, sites
   *  amber. Purely visual; numbers carry the meaning. */
  accent: string;
}) {
  return (
    <div
      style={{
        position: "relative",
        background: `linear-gradient(180deg, ${INV_THEME.paper} 0%, ${INV_THEME.cream} 100%)`,
        border: `1px solid ${INV_THEME.parchment}`,
        borderRadius: 10,
        padding: "12px 14px 12px 18px",
        boxShadow: "0 1px 0 rgba(28, 52, 69, 0.04), inset 0 1px 0 rgba(255,255,255,0.7)",
        overflow: "hidden",
      }}
    >
      {/* Left rail — coloured strip pinned to the card edge for at-
          a-glance differentiation across the row. */}
      <span
        aria-hidden
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 4,
          background: accent,
        }}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 10,
          fontWeight: 800,
          color: INV_THEME.steelLight,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
        }}
      >
        <span aria-hidden style={{ fontSize: 13, lineHeight: 1 }}>
          {icon}
        </span>
        <span>{label}</span>
      </div>
      <div
        style={{
          fontSize: 24,
          fontWeight: 800,
          color: INV_THEME.steel,
          letterSpacing: "-0.01em",
          fontFeatureSettings: '"tnum"',
          marginTop: 4,
          lineHeight: 1.1,
        }}
      >
        {value.toLocaleString("en-IN")}
      </div>
      <div style={{ fontSize: 10, color: INV_THEME.steelLight, marginTop: 2 }}>{unit}</div>
    </div>
  );
}
