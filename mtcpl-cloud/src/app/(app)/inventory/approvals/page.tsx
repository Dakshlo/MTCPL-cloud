// ──────────────────────────────────────────────────────────────────
// Migration 041 — Inventory audit queue (Mafat + owner)
// ──────────────────────────────────────────────────────────────────
// Lists every batch in status='pending_approval'. Approve or reject
// each one with optional note. Mirrors the cutting approvals page in
// purpose — one queue, one human, fast decisions.
// ──────────────────────────────────────────────────────────────────

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { canApproveInventoryMovements } from "@/lib/inventory-permissions";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getProfilesMap } from "@/lib/profiles";
import { InventoryShell } from "../_components/inventory-shell";
import { ApprovalsClient } from "./approvals-client";
import { INV_THEME } from "../_components/theme";
import type { MovementRow, Site, ScaffoldingComponent } from "../_components/stock";

export default async function InventoryApprovalsPage() {
  const { profile } = await requireAuth();
  if (!canApproveInventoryMovements(profile)) {
    redirect("/inventory/scaffolding");
  }

  const h = await headers();
  const pathname = h.get("x-pathname") ?? "/inventory/approvals";

  const supabase = createAdminSupabaseClient();
  const [pendingRes, sitesRes, componentsRes] = await Promise.all([
    supabase
      .from("inventory_movements")
      .select("*")
      .eq("status", "pending_approval")
      .order("proposed_at", { ascending: true }),
    supabase.from("sites").select("id, code, name, is_plant"),
    supabase.from("scaffolding_components").select("*"),
  ]);

  const movements = ((pendingRes.data ?? []) as unknown) as MovementRow[];
  const sites = ((sitesRes.data ?? []) as unknown) as Pick<Site, "id" | "code" | "name" | "is_plant">[];
  const components = ((componentsRes.data ?? []) as unknown) as ScaffoldingComponent[];

  // Group movements by batch_id, preserving order.
  type Batch = {
    batch_id: string;
    rows: MovementRow[];
    proposed_at: string;
    proposed_by: string;
    movement_type: MovementRow["movement_type"];
    from_site_id: string | null;
    to_site_id: string | null;
    batch_note: string | null;
  };
  const batches: Batch[] = [];
  const byBatch = new Map<string, Batch>();
  for (const m of movements) {
    if (!byBatch.has(m.batch_id)) {
      const b: Batch = {
        batch_id: m.batch_id,
        rows: [],
        proposed_at: m.proposed_at,
        proposed_by: m.proposed_by,
        movement_type: m.movement_type,
        from_site_id: m.from_site_id,
        to_site_id: m.to_site_id,
        batch_note: m.batch_note,
      };
      byBatch.set(m.batch_id, b);
      batches.push(b);
    }
    byBatch.get(m.batch_id)!.rows.push(m);
  }

  const profilesMap = await getProfilesMap();

  return (
    <InventoryShell
      title="Inventory audit"
      subtitle={`${batches.length} batch${batches.length === 1 ? "" : "es"} awaiting your decision`}
      pathname={pathname}
    >
      {batches.length === 0 ? (
        <div
          style={{
            background: INV_THEME.paper,
            border: `1px dashed ${INV_THEME.parchment}`,
            borderRadius: 12,
            padding: 40,
            textAlign: "center",
            color: INV_THEME.steelLight,
          }}
        >
          <div style={{ fontSize: 28, marginBottom: 6 }}>✓</div>
          <div style={{ fontWeight: 700, color: INV_THEME.steel }}>
            Queue is clear.
          </div>
          <div style={{ fontSize: 12, marginTop: 6 }}>
            New batches show up here as soon as the storekeeper submits them.
          </div>
        </div>
      ) : (
        <ApprovalsClient
          batches={batches}
          sites={sites}
          components={components}
          profilesMap={profilesMap}
        />
      )}
    </InventoryShell>
  );
}
