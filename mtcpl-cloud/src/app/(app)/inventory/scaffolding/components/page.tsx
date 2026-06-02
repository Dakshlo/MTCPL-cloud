// Migration 041 — Scaffolding component catalog management.

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { canManageScaffoldingComponents } from "@/lib/inventory-permissions";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { InventoryShell } from "../../_components/inventory-shell";
import { ComponentsClient } from "./components-client";
import { InventorySetupBanner } from "../../_components/setup-banner";
import type { ScaffoldingComponent } from "../../_components/stock";
import { INV_THEME } from "../../_components/theme";

const PG_UNDEFINED_TABLE = "42P01";

export default async function ComponentsPage() {
  const { profile } = await requireAuth();
  if (!canManageScaffoldingComponents(profile)) {
    redirect("/inventory/scaffolding");
  }

  const h = await headers();
  const pathname = h.get("x-pathname") ?? "/inventory/scaffolding/components";

  const supabase = createAdminSupabaseClient();
  const [{ data, error }, { data: typeRows }] = await Promise.all([
    supabase
      .from("scaffolding_components")
      .select("*")
      .order("component_type", { ascending: true })
      .order("display_order", { ascending: true }),
    // Mig 084 — user-defined component types feed the Add Component
    // form's Type picker. Active only; sorted by the order they
    // were created (display_order). Empty on a fresh deploy until
    // the storekeeper adds their first type.
    supabase
      .from("scaffolding_component_types")
      .select("value, label")
      .eq("is_active", true)
      .order("display_order", { ascending: true }),
  ]);

  if (error?.code === PG_UNDEFINED_TABLE) {
    return (
      <InventoryShell title="Component catalog" pathname={pathname}>
        <InventorySetupBanner missing="scaffolding_components" />
      </InventoryShell>
    );
  }

  const components = ((data ?? []) as unknown) as ScaffoldingComponent[];
  const componentTypes = ((typeRows ?? []) as Array<{
    value: string;
    label: string;
  }>);

  return (
    <InventoryShell
      title="Component catalog"
      subtitle="The parts you stock"
      pathname={pathname}
    >
      <div
        style={{
          fontSize: 12,
          color: INV_THEME.steelLight,
          marginBottom: 12,
          lineHeight: 1.5,
        }}
      >
        Every card on the inventory board is one row from this catalog. The
        icon comes from the component <strong>type</strong>; the size variant
        is free text (e.g. "2.5m" or "1.2m × 18ga"). Archive removes a part
        from new-movement pickers without losing history.
      </div>
      <ComponentsClient components={components} componentTypes={componentTypes} />
    </InventoryShell>
  );
}
