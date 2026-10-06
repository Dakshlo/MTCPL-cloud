"use server";

/**
 * The only write the wardrobe QR can make: one person took N of one tool.
 *
 * Everything is re-checked here from the token up, because the page that
 * called this is served to anyone who scans a sticker. Nothing the client
 * sends is trusted: not the link, not the vendor, not the quantity.
 */

import { revalidatePath } from "next/cache";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  GUEST_MAX_QTY,
  resolveToolStoreLink,
  takesThroughLinkToday,
} from "@/lib/cnc-tool-guest";

export type GuestTakeResult =
  | { ok: true; left: number; toolName: string; qty: number }
  | { ok: false; error: string };

export async function guestTakeToolAction(formData: FormData): Promise<GuestTakeResult> {
  const token = String(formData.get("token") || "").trim();
  const toolId = String(formData.get("tool_id") || "").trim();
  const vendorId = String(formData.get("vendor_id") || "").trim();
  const takenBy = String(formData.get("taken_by") || "").trim().replace(/\s+/g, " ");
  const qty = Number(formData.get("qty"));

  // ── 1. The sticker ───────────────────────────────────────────────
  const resolved = await resolveToolStoreLink(token);
  if ("problem" in resolved) {
    return {
      ok: false,
      error:
        resolved.problem === "revoked"
          ? "This QR has been switched off. Ask the office for the new one."
          : "This QR is not valid. Ask the office for the new one.",
    };
  }
  const link = resolved.link;

  // ── 2. What they typed ───────────────────────────────────────────
  if (!takenBy) return { ok: false, error: "Please say who is taking the tool." };
  if (takenBy.length > 60) return { ok: false, error: "That name is too long." };
  if (!toolId) return { ok: false, error: "Pick a tool first." };
  if (!vendorId) return { ok: false, error: "Pick which company you are with." };
  if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty < 1) {
    return { ok: false, error: "How many? Enter at least 1." };
  }
  if (qty > GUEST_MAX_QTY) {
    return { ok: false, error: `That is a lot — ${GUEST_MAX_QTY} is the most in one go. Ask the office.` };
  }

  const admin = createAdminSupabaseClient();

  // ── 3. The day's ceiling ─────────────────────────────────────────
  // Checked before the write, not after. A leaked sticker gets one day's
  // worth of noise at most, and the office sees the register anyway.
  const usedToday = await takesThroughLinkToday(link.id);
  if (usedToday >= link.dailyCap) {
    return {
      ok: false,
      error: "This QR has recorded a lot today and is paused until tomorrow. Tell the office.",
    };
  }

  // ── 4. The vendor must be a real CNC vendor ──────────────────────
  const { data: vendor } = await admin
    .from("vendors")
    .select("id")
    .eq("id", vendorId)
    .maybeSingle();
  if (!vendor) return { ok: false, error: "That company is not on the list any more." };

  // ── 5. The tool, and whether the shelf can cover it ──────────────
  const { data: tool } = await admin
    .from("cnc_tools")
    .select("id, name, unit, is_active")
    .eq("id", toolId)
    .maybeSingle();
  if (!tool || !(tool as { is_active: boolean }).is_active) {
    return { ok: false, error: "That tool is no longer in the store." };
  }
  const toolName = (tool as { name: string }).name;

  // Stock is the sum of the register, never a stored number — so read it
  // the same way every other screen does.
  const { data: moves } = await admin
    .from("cnc_tool_movements")
    .select("delta")
    .eq("tool_id", toolId)
    .is("undone_at", null);
  const stock = (moves ?? []).reduce(
    (s, m) => s + Number((m as { delta: number | string }).delta ?? 0),
    0,
  );
  if (stock <= 0) {
    return { ok: false, error: `${toolName} is finished. Tell the office.` };
  }
  if (qty > stock) {
    return {
      ok: false,
      error: `Only ${stock} left on the shelf. Take ${stock} or fewer.`,
    };
  }

  // ── 6. Record it ─────────────────────────────────────────────────
  // entered_by stays NULL: nobody was logged in. guest_link_id says which
  // sticker it came through, so the master register can show the source.
  const { error } = await admin.from("cnc_tool_movements").insert({
    vendor_id: vendorId,
    tool_id: toolId,
    kind: "issue",
    delta: -Math.abs(qty),
    taken_by: takenBy,
    guest_link_id: link.id,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/tools");
  revalidatePath(`/tools/v/${vendorId}`);

  return { ok: true, left: stock - qty, toolName, qty };
}
