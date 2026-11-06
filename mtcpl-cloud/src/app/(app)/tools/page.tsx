// ──────────────────────────────────────────────────────────────────
// /tools — the CNC tool store (migs 227–234)
// ──────────────────────────────────────────────────────────────────
// ONE store for the whole plant, and exactly two jobs in the module:
//
//   this screen   the keeper fills the shelf — add a tool, add stock,
//                 correct a count, read the register.
//   the QR        everyone else takes, on their own phone, signed by a
//                 code to the number on their profile.
//
// Oct 2026 — the vendor screens, the paper-register typing grid and the
// per-tool pages were all dropped (Daksh: "drop all other features").
// Each was a second way to do one of those two jobs, and the clutter was
// costing more than the features were worth.
//
// Mig 234 — the keepers are Daksh, Nikhil and Vinay (a flag on the
// profile, not a role), and the register reads company by company:
// MOHIT, and under him whichever of his men actually stood at the
// cupboard. The gate is re-checked inside every server action; this
// redirect is the courtesy, not the control.
// ──────────────────────────────────────────────────────────────────

import { redirect } from "next/navigation";

import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canManageCncToolStore, canUseCncTools } from "@/lib/cnc-tool-permissions";
import { loadStore } from "@/lib/cnc-tool-stock";
import { allActiveOperators } from "@/lib/cnc-tool-operators";

import { StoreClient } from "./store-client";

export const dynamic = "force-dynamic";

export default async function ToolStorePage() {
  const { profile } = await requireAuth();
  if (!canUseCncTools(profile)) redirect("/");

  const admin = createAdminSupabaseClient();

  const [{ tools, movements }, operators, { data: vendorRows }] = await Promise.all([
    loadStore(),
    allActiveOperators(),
    // 28 rows. Cheaper to take the lot than to work out which ids the
    // register happens to mention this time.
    admin.from("vendors").select("id, name").order("name"),
  ]);

  const vendorNames: Record<string, string> = {};
  for (const v of (vendorRows ?? []) as Array<{ id: string; name: string }>) {
    vendorNames[v.id] = v.name;
  }

  return (
    <StoreClient
      tools={tools}
      movements={movements.slice(0, 300)}
      vendorNames={vendorNames}
      operators={operators.map((o) => ({
        id: o.id,
        name: o.name,
        maskedPhone: o.maskedPhone,
        vendorId: o.vendorId,
        vendorName: o.vendorName,
      }))}
      canManage={canManageCncToolStore(profile)}
    />
  );
}
