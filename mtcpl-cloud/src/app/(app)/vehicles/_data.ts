// Vehicles dept (mig 204) — shared server loader. One query per page:
// vehicles + their documents joined, public URLs resolved here so the
// client renders instantly with zero follow-up fetches.

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import type { VehicleRow } from "./vehicles-client";

export async function loadVehicles(
  kind?: "commercial" | "personal",
): Promise<{ rows: VehicleRow[]; migMissing: boolean }> {
  const admin = createAdminSupabaseClient();
  let q = admin
    .from("vehicles")
    .select("*, vehicle_documents(id, name, path, doc_type, created_at)")
    .order("name");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (kind) q = (q as any).eq("kind", kind);
  const { data, error } = await q;
  if (error) return { rows: [], migMissing: true }; // pre-mig-204 deploy

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = ((data ?? []) as any[]).map((r) => ({
    id: r.id, kind: r.kind === "personal" ? "personal" : "commercial",
    name: r.name, reg_no: r.reg_no ?? null, make_model: r.make_model ?? null,
    owner_name: r.owner_name ?? null, // mig 210; select("*") keeps this pre-mig-safe
    emi_active: r.emi_active === true,
    emi_amount: r.emi_amount != null ? Number(r.emi_amount) : null,
    emi_day: r.emi_day != null ? Number(r.emi_day) : null,
    emi_lender: r.emi_lender ?? null, emi_start: r.emi_start ?? null, emi_end: r.emi_end ?? null,
    insurance_company: r.insurance_company ?? null, insurance_policy_no: r.insurance_policy_no ?? null,
    insurance_expiry: r.insurance_expiry ?? null, puc_expiry: r.puc_expiry ?? null,
    fitness_expiry: r.fitness_expiry ?? null, notes: r.notes ?? null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    docs: ((r.vehicle_documents ?? []) as any[])
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .map((d) => ({
        id: d.id, name: d.name, doc_type: d.doc_type ?? null, created_at: d.created_at,
        url: admin.storage.from("vehicle-docs").getPublicUrl(d.path).data.publicUrl,
      })),
  })) as VehicleRow[];
  return { rows, migMissing: false };
}

/** Shared banner data helpers for the pages. */
export function toastFrom(sp: { toast?: string }): string | null {
  return sp.toast ? String(sp.toast) : null;
}
