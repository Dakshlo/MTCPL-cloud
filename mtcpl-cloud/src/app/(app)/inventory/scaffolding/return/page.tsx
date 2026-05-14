// Migration 041 — Return scaffolding from a site back to the plant.

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { canManageInventory } from "@/lib/inventory-permissions";
import { InventoryShell } from "../../_components/inventory-shell";
import { MovementForm } from "../../_components/movement-form-client";
import { loadInventorySnapshotOrSetup } from "../../_components/stock";
import { InventorySetupBanner } from "../../_components/setup-banner";
import { INV_THEME } from "../../_components/theme";

export default async function ReturnScaffoldingPage() {
  const { profile } = await requireAuth();
  if (!canManageInventory(profile)) {
    redirect("/inventory/scaffolding");
  }

  const h = await headers();
  const pathname = h.get("x-pathname") ?? "/inventory/scaffolding/return";

  const snapshotResult = await loadInventorySnapshotOrSetup();
  if (snapshotResult.kind !== "ok") {
    return (
      <InventoryShell title="Return scaffolding" pathname={pathname}>
        {snapshotResult.kind === "needs_migration" ? (
          <InventorySetupBanner missing={snapshotResult.missing} />
        ) : (
          <div style={{ padding: 24, color: INV_THEME.stockOut }}>
            {snapshotResult.message}
          </div>
        )}
      </InventoryShell>
    );
  }
  const { sites, components, stock, plant } = snapshotResult.snapshot;

  if (!plant) {
    return (
      <InventoryShell title="Return scaffolding" pathname={pathname}>
        <InventorySetupBanner missing="sites (PLANT row not seeded)" />
      </InventoryShell>
    );
  }

  const stockLookup: Record<string, { onHand: number; pendingOut: number }> = {};
  for (const [k, v] of stock.entries()) stockLookup[k] = v;

  return (
    <InventoryShell
      title="Return scaffolding"
      subtitle="From a project site → back to Plant"
      pathname={pathname}
    >
      <MovementForm
        mode="return"
        sites={sites}
        components={components.filter((c) => c.is_active)}
        stockLookup={stockLookup}
        plantId={plant.id}
      />
    </InventoryShell>
  );
}
