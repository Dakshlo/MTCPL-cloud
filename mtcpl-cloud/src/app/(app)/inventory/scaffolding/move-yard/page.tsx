// Mig 086 — Move scaffolding stock between warehouse yards.

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { canManageInventory } from "@/lib/inventory-permissions";
import { InventoryShell } from "../../_components/inventory-shell";
import { MoveYardForm } from "../../_components/move-yard-client";
import { loadInventorySnapshotOrSetup } from "../../_components/stock";
import { InventorySetupBanner } from "../../_components/setup-banner";
import { INV_THEME } from "../../_components/theme";

export default async function MoveYardPage() {
  const { profile } = await requireAuth();
  if (!canManageInventory(profile)) {
    redirect("/inventory/scaffolding");
  }

  const h = await headers();
  const pathname = h.get("x-pathname") ?? "/inventory/scaffolding/move-yard";

  const snapshotResult = await loadInventorySnapshotOrSetup();
  if (snapshotResult.kind !== "ok") {
    return (
      <InventoryShell title="Move between yards" pathname={pathname}>
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
  const { components, plant, yards, yardStock } = snapshotResult.snapshot;

  if (!plant) {
    return (
      <InventoryShell title="Move between yards" pathname={pathname}>
        <InventorySetupBanner missing="sites (PLANT row not seeded)" />
      </InventoryShell>
    );
  }

  const yardStockLookup: Record<string, { onHand: number; pendingOut: number }> = {};
  for (const [k, v] of yardStock.entries()) yardStockLookup[k] = v;

  return (
    <InventoryShell
      title="Move between yards"
      subtitle="Shift stock from one warehouse yard to another"
      pathname={pathname}
    >
      <MoveYardForm
        components={components.filter((c) => c.is_active)}
        yards={yards}
        yardStockLookup={yardStockLookup}
      />
    </InventoryShell>
  );
}
