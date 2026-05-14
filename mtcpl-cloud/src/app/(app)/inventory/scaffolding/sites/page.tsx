// ──────────────────────────────────────────────────────────────────
// Migration 041 — Sites management
// ──────────────────────────────────────────────────────────────────
// List all sites (plant + active + archived). Inline form to add a
// new site. Edit / archive / unarchive buttons. No detail page in
// v1 — every site is editable in place.
// ──────────────────────────────────────────────────────────────────

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { canManageSites } from "@/lib/inventory-permissions";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { InventoryShell } from "../../_components/inventory-shell";
import { SitesClient } from "./sites-client";
import { INV_THEME } from "../../_components/theme";

export default async function SitesPage() {
  const { profile } = await requireAuth();
  if (!canManageSites(profile)) {
    redirect("/inventory/scaffolding");
  }

  const h = await headers();
  const pathname = h.get("x-pathname") ?? "/inventory/scaffolding/sites";

  const supabase = createAdminSupabaseClient();
  const { data: sitesRaw } = await supabase
    .from("sites")
    .select("*")
    .order("is_plant", { ascending: false })
    .order("is_active", { ascending: false })
    .order("name", { ascending: true });

  type SiteRow = {
    id: string;
    code: string;
    name: string;
    address: string | null;
    manager_name: string | null;
    manager_phone: string | null;
    started_on: string | null;
    closed_on: string | null;
    is_plant: boolean;
    is_active: boolean;
    notes: string | null;
  };
  const sites = ((sitesRaw ?? []) as unknown) as SiteRow[];

  return (
    <InventoryShell
      title="Sites"
      subtitle="Where your stock can live"
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
        Every site is a place scaffolding can sit — the Plant is one row
        with the warehouse, plus one row per construction project. When a
        project wraps, archive it; the historical movements stay searchable.
      </div>
      <SitesClient sites={sites} />
    </InventoryShell>
  );
}
