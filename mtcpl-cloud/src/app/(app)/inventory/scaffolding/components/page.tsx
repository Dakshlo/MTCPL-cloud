// Migration 041 — Scaffolding component catalog management.

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { canManageScaffoldingComponents } from "@/lib/inventory-permissions";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { InventoryShell } from "../../_components/inventory-shell";
import { ComponentsClient } from "./components-client";
import type { ScaffoldingComponent } from "../../_components/stock";
import { INV_THEME } from "../../_components/theme";

export default async function ComponentsPage() {
  const { profile } = await requireAuth();
  if (!canManageScaffoldingComponents(profile)) {
    redirect("/inventory/scaffolding");
  }

  const h = await headers();
  const pathname = h.get("x-pathname") ?? "/inventory/scaffolding/components";

  const supabase = createAdminSupabaseClient();
  const { data } = await supabase
    .from("scaffolding_components")
    .select("*")
    .order("component_type", { ascending: true })
    .order("display_order", { ascending: true });

  const components = ((data ?? []) as unknown) as ScaffoldingComponent[];

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
      <ComponentsClient components={components} />
    </InventoryShell>
  );
}
