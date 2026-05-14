// Migration 041 — Write off scaffolding (damaged / lost / scrap).

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { canManageInventory } from "@/lib/inventory-permissions";
import { InventoryShell } from "../../_components/inventory-shell";
import { MovementForm } from "../../_components/movement-form-client";
import { loadInventorySnapshotOrSetup } from "../../_components/stock";
import { InventorySetupBanner } from "../../_components/setup-banner";
import { INV_THEME } from "../../_components/theme";

export default async function WriteoffScaffoldingPage() {
  const { profile } = await requireAuth();
  if (!canManageInventory(profile)) {
    redirect("/inventory/scaffolding");
  }

  const h = await headers();
  const pathname = h.get("x-pathname") ?? "/inventory/scaffolding/writeoff";

  const snapshotResult = await loadInventorySnapshotOrSetup();
  if (snapshotResult.kind !== "ok") {
    return (
      <InventoryShell title="Destroyed" pathname={pathname}>
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
      <InventoryShell title="Destroyed" pathname={pathname}>
        <InventorySetupBanner missing="sites (PLANT row not seeded)" />
      </InventoryShell>
    );
  }

  const stockLookup: Record<string, { onHand: number; pendingOut: number }> = {};
  for (const [k, v] of stock.entries()) stockLookup[k] = v;

  return (
    <InventoryShell
      title="Destroyed"
      subtitle="Mark stock as damaged / lost — needs owner sign-off"
      pathname={pathname}
    >
      <MovementForm
        mode="writeoff"
        sites={sites}
        components={components.filter((c) => c.is_active)}
        stockLookup={stockLookup}
        plantId={plant.id}
      />
    </InventoryShell>
  );
}
