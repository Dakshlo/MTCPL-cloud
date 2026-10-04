// ──────────────────────────────────────────────────────────────────
// /tools/v/[vendorId] — one vendor's screen (Migrations 227 + 228)
// ──────────────────────────────────────────────────────────────────
// Daksh: "these CNC vendors' main point is NOT to see what is in stock
// — they will just take from the store. They will see all their recent
// items taken, and at the end an option to see stock."
//
// So this is deliberately NOT the master board filtered down. It is a
// different screen with a different job: one big Take button, then what
// this vendor has taken lately, and the store's shelf one tap further
// on for when somebody does want to check.
//
// DEVELOPER ONLY in v1. A vendor reaching their own screen is the v2
// change; the route and the shape are already right for it.
// ──────────────────────────────────────────────────────────────────

import { notFound, redirect } from "next/navigation";

import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  canSeeCncToolMaster,
  canUseCncTools,
  takingVendorFor,
} from "@/lib/cnc-tool-permissions";
import { loadStore, takenByHistory, takingsFor } from "@/lib/cnc-tool-stock";

import { VendorClient } from "./vendor-client";

export const dynamic = "force-dynamic";

export default async function VendorToolPage({
  params,
}: {
  params: Promise<{ vendorId: string }>;
}) {
  const { profile } = await requireAuth();
  if (!canUseCncTools(profile)) redirect("/");

  const { vendorId } = await params;

  // A vendor may only ever open their own screen. Checked here AND in
  // the server action, which re-derives the vendor from the profile
  // rather than trusting the form.
  const allowed = canSeeCncToolMaster(profile) || takingVendorFor(profile, vendorId) === vendorId;
  if (!allowed) redirect("/tools");

  const admin = createAdminSupabaseClient();
  const { data: vendorRow } = await admin
    .from("vendors")
    .select("id, name, vendor_type, is_active")
    .eq("id", vendorId)
    .maybeSingle();
  if (!vendorRow) notFound();
  const vendor = vendorRow as { id: string; name: string; vendor_type: string; is_active: boolean };

  const { tools, movements } = await loadStore();

  return (
    <VendorClient
      vendor={{ id: vendor.id, name: vendor.name }}
      tools={tools}
      takings={takingsFor(movements, vendorId).slice(0, 120)}
      people={takenByHistory(movements, vendorId)}
      isMaster={canSeeCncToolMaster(profile)}
    />
  );
}
