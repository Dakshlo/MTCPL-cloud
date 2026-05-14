// Migration 041 — Receive new scaffolding stock at the plant.
// Vendor delivers → storekeeper logs it → crosscheck/owner approves.

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { canManageInventory } from "@/lib/inventory-permissions";
import { InventoryShell } from "../../_components/inventory-shell";
import { MovementForm } from "../../_components/movement-form-client";
import { loadInventorySnapshotOrSetup } from "../../_components/stock";
import { InventorySetupBanner } from "../../_components/setup-banner";
import { INV_THEME } from "../../_components/theme";

export default async function ReceiveScaffoldingPage() {
  const { profile } = await requireAuth();
  if (!canManageInventory(profile)) {
    redirect("/inventory/scaffolding");
  }

  const h = await headers();
  const pathname = h.get("x-pathname") ?? "/inventory/scaffolding/receive";

  const snapshotResult = await loadInventorySnapshotOrSetup();
  if (snapshotResult.kind !== "ok") {
    return (
      <InventoryShell title="Buy scaffolding" pathname={pathname}>
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
      <InventoryShell title="Buy scaffolding" pathname={pathname}>
        <InventorySetupBanner missing="sites (PLANT row not seeded)" />
      </InventoryShell>
    );
  }

  const stockLookup: Record<string, { onHand: number; pendingOut: number }> = {};
  for (const [k, v] of stock.entries()) stockLookup[k] = v;

  return (
    <InventoryShell
      title="Buy scaffolding"
      subtitle="New stock from vendor → Plant"
      pathname={pathname}
    >
      <MovementForm
        mode="receive"
        sites={sites}
        components={components.filter((c) => c.is_active)}
        stockLookup={stockLookup}
        plantId={plant.id}
      />
    </InventoryShell>
  );
}
