// Migration 041 — Inventory department front door.
//
// A pass-through, never a screen. It used to hard-redirect to the
// scaffolding board, which was true when scaffolding was the only
// thing in the department. It is not any more: the CNC tool store is
// the live screen and scaffolding has not moved a part since June
// 2026, so sending a keeper to the yard board was sending him past
// the room he came for.
//
// departmentLandingFor is the single answer to "where does Inventory
// open for this person" — the switcher, the app-reopen path and this
// route all ask it, so all three agree.

import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { departmentLandingFor } from "@/lib/departments";

export default async function InventoryLandingPage() {
  const { profile } = await requireAuth();
  redirect(departmentLandingFor("inventory", profile));
}
