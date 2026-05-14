// Migration 041 — Issue scaffolding to a site.
// Storekeeper picks destination + cart of components, submits for
// crosscheck/owner approval.

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { canManageInventory } from "@/lib/inventory-permissions";
import { InventoryShell } from "../../_components/inventory-shell";
import { MovementForm } from "../../_components/movement-form-client";
import { loadInventorySnapshotOrSetup, stockKey } from "../../_components/stock";
import { InventorySetupBanner } from "../../_components/setup-banner";
import { INV_THEME } from "../../_components/theme";

export default async function IssueScaffoldingPage() {
  const { profile } = await requireAuth();
  if (!canManageInventory(profile)) {
    redirect("/inventory/scaffolding");
  }

  const h = await headers();
  const pathname = h.get("x-pathname") ?? "/inventory/scaffolding/issue";

  const snapshotResult = await loadInventorySnapshotOrSetup();
  if (snapshotResult.kind !== "ok") {
    return (
      <InventoryShell title="Issue scaffolding" pathname={pathname}>
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
      <InventoryShell title="Issue scaffolding" pathname={pathname}>
        <InventorySetupBanner missing="sites (PLANT row not seeded)" />
      </InventoryShell>
    );
  }

  // Flatten stock map into a plain object for the client.
  const stockLookup: Record<string, { onHand: number; pendingOut: number }> = {};
  for (const [k, v] of stock.entries()) stockLookup[k] = v;
  // Make sure plant entries exist for every component (zero baseline).
  for (const c of components) {
    const k = stockKey(c.id, plant.id);
    if (!stockLookup[k]) stockLookup[k] = { onHand: 0, pendingOut: 0 };
  }

  return (
    <InventoryShell
      title="Issue scaffolding"
      subtitle="From Plant → to a project site"
      pathname={pathname}
    >
      <MovementForm
        mode="issue"
        sites={sites}
        components={components.filter((c) => c.is_active)}
        stockLookup={stockLookup}
        plantId={plant.id}
      />
    </InventoryShell>
  );
}
