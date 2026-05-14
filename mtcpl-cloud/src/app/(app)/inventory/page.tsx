// Migration 041 — Inventory department landing.
//
// The placeholder page from migration 036 has been replaced with a
// pass-through to the Scaffolding board, which is the only inventory
// vertical in v1. Later modules (CNC tools, cement, motors) will
// each get their own sub-route — at that point this page becomes a
// proper landing that picks a section.

import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";

export default async function InventoryLandingPage() {
  await requireAuth();
  redirect("/inventory/scaffolding");
}
