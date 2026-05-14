// Migration 041 — Write off scaffolding (damaged / lost / scrap).

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { canManageInventory } from "@/lib/inventory-permissions";
import { InventoryShell } from "../../_components/inventory-shell";
import { MovementForm } from "../../_components/movement-form-client";
import { loadInventorySnapshot } from "../../_components/stock";
import { INV_THEME } from "../../_components/theme";

export default async function WriteoffScaffoldingPage() {
  const { profile } = await requireAuth();
  if (!canManageInventory(profile)) {
    redirect("/inventory/scaffolding");
  }

  const h = await headers();
  const pathname = h.get("x-pathname") ?? "/inventory/scaffolding/writeoff";

  const { sites, components, stock, plant } = await loadInventorySnapshot();

  if (!plant) {
    return (
      <InventoryShell title="Write-off" pathname={pathname}>
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
      title="Write-off"
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
