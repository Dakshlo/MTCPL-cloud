// Migration 041 — Return scaffolding from a site back to the plant.

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { canManageInventory } from "@/lib/inventory-permissions";
import { InventoryShell } from "../../_components/inventory-shell";
import { MovementForm } from "../../_components/movement-form-client";
import { loadInventorySnapshot } from "../../_components/stock";
import { INV_THEME } from "../../_components/theme";

export default async function ReturnScaffoldingPage() {
  const { profile } = await requireAuth();
  if (!canManageInventory(profile)) {
    redirect("/inventory/scaffolding");
  }

  const h = await headers();
  const pathname = h.get("x-pathname") ?? "/inventory/scaffolding/return";

  const { sites, components, stock, plant } = await loadInventorySnapshot();

  if (!plant) {
    return (
      <InventoryShell title="Return scaffolding" pathname={pathname}>
        <div style={{ padding: 24, color: INV_THEME.steelLight }}>
          Plant site row missing — run migration 041.
        </div>
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
