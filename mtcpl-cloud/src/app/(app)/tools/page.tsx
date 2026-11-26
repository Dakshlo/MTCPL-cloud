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
import {
  canManageCncToolStore,
  canScanToolBills,
  canUseCncTools,
} from "@/lib/cnc-tool-permissions";
import { loadStore, stockSignature } from "@/lib/cnc-tool-stock";
import { getToolStockOrder } from "@/lib/wa-tool-stock";
import { loadHoldings, usageLinesSince } from "@/lib/cnc-tool-usage";

import { StoreClient } from "./store-client";

export const dynamic = "force-dynamic";

export default async function ToolStorePage() {
  const { profile } = await requireAuth();
  if (!canUseCncTools(profile)) redirect("/");

  const admin = createAdminSupabaseClient();

  const [
    { tools, movements },
    { data: vendorRows },
    holdings,
    usage,
    stockOrder,
    { data: userRows },
  ] = await Promise.all([
    loadStore(),
    // 28 rows. Cheaper to take the lot than to work out which ids the
    // register happens to mention this time.
    admin.from("vendors").select("id, name").order("name"),
    // Mig 238 — just the badge number for the "Out of the cupboard"
    // link. The screen behind it loads the detail itself.
    loadHoldings(),
    // The other half of the register. No vendorId, so this is the
    // office read: everybody's lines, the way the phone gives a vendor
    // only his own. Six months is longer than any argument about a
    // missing box and still one quick query.
    usageLinesSince(
      new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString(),
      { profileId: profile.id, operatorId: null },
      2000,
    ),
    // Nov 2026 — who a "send more of this" WhatsApp goes to. One row of
    // app_settings, fired with everything else rather than after it.
    getToolStockOrder(),
    // Nineteen people. The recipient picker offers them by name so the
    // keeper does not have to know Nikhil's number by heart, and a
    // plain <select> is the whole of it at this size.
    admin
      .from("profiles")
      .select("id, full_name, phone")
      .eq("is_active", true)
      .not("phone", "is", null)
      .order("full_name"),
  ]);

  const vendorNames: Record<string, string> = {};
  for (const v of (vendorRows ?? []) as Array<{ id: string; name: string }>) {
    vendorNames[v.id] = v.name;
  }

  return (
    <StoreClient
      tools={tools}
      // The register can be opened on "Everything", so it needs more
      // than the last page of lines. 2000 is roughly three years of a
      // busy cupboard; past that the oldest are dropped and the screen
      // says so rather than quietly reporting a short period.
      movements={movements.slice(0, 2000)}
      movementsTruncated={movements.length > 2000}
      stockSig={stockSignature(tools)}
      vendorNames={vendorNames}
      usage={usage.map((u) => ({
        id: u.id,
        at: u.createdAt,
        toolId: u.toolId,
        toolName: u.toolName,
        machineCode: u.machineCode,
        qty: u.qty,
        usedBy: u.usedBy,
        vendorId: u.vendorId,
        company: u.company,
        undone: !!u.undoneAt,
      }))}
      canManage={canManageCncToolStore(profile)}
      heldOut={holdings.reduce((a, p) => a + p.total, 0)}
      // Mig 237. Developer only for now, while the matcher learns what
      // the suppliers actually print on their bills.
      canScanBills={canScanToolBills(profile)}
      stockOrder={stockOrder}
      orderUsers={((userRows ?? []) as Array<{ id: string; full_name: string | null; phone: string | null }>)
        .map((u) => ({ id: u.id, name: u.full_name || "Unnamed", phone: u.phone || "" }))
        .filter((u) => u.phone.replace(/\D/g, "").length >= 10)}
      // The server knows whether the approved template is configured;
      // the browser cannot read env, so it is told. Without this the
      // sheet would look ready and fail at the last step.
      stockOrderReady={!!(process.env.MSG91_WA_TOOL_STOCK_TEMPLATE ?? "").trim()}
    />
  );
}
