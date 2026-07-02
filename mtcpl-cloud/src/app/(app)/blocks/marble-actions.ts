"use server";

/**
 * Server action for creating a "marble truck" entry — one row in
 * marble_truck_entries plus N sibling block rows whose per-block
 * tonnage = total_tonnes / num_blocks.
 *
 * Gated on the stone being marble-category. Roles match the
 * existing block-add flow.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { isAllowedYard } from "@/lib/yards";
import { generateNextCode } from "./utils";
import { fetchAllBlockIds } from "./block-ids";

export async function createMarbleTruckAction(formData: FormData) {
  const { profile } = await requireAuth([
    "owner",
    "team_head",
    "senior_incharge",
    "block_slab_entry",
    "block_entry",
  ]);
  const supabase = createAdminSupabaseClient();

  const stone = String(formData.get("stone") || "").trim();
  const yardRaw = Number(formData.get("yard"));
  const truckNo = String(formData.get("truck_no") || "").trim() || null;
  const vendorName = String(formData.get("vendor_name") || "").trim() || null;
  const billNo = String(formData.get("bill_no") || "").trim() || null;
  const notes = String(formData.get("notes") || "").trim() || null;
  const totalTonnes = Number(formData.get("total_tonnes"));
  const numBlocks = Number(formData.get("num_blocks"));

  // ── Validation ──────────────────────────────────────────────────────────
  if (!stone) {
    redirect(`/blocks?marble_error=${encodeURIComponent("Stone type is required")}`);
  }
  if (!Number.isFinite(yardRaw) || !isAllowedYard(yardRaw)) {
    redirect(`/blocks?marble_error=${encodeURIComponent("Valid yard is required")}`);
  }
  if (!Number.isFinite(totalTonnes) || totalTonnes <= 0) {
    redirect(`/blocks?marble_error=${encodeURIComponent("Total tonnes must be greater than 0")}`);
  }
  if (!Number.isFinite(numBlocks) || numBlocks < 1 || numBlocks > 50 || !Number.isInteger(numBlocks)) {
    redirect(`/blocks?marble_error=${encodeURIComponent("Number of blocks must be 1–50")}`);
  }
  // Logistics are mandatory for fresh stock; "Existing stock" is the escape hatch.
  const existingStock = String(formData.get("existing_stock") || "") === "1";
  if (!existingStock && !(truckNo && vendorName && billNo)) {
    redirect(`/blocks?marble_error=${encodeURIComponent("Truck No., Vendor and Bill No. are required. Turn on “Existing stock” to add without them.")}`);
  }

  // Verify the stone exists AND is marble-category.
  const { data: stoneRow } = await supabase
    .from("stone_types")
    .select("name, stone_category")
    .eq("name", stone)
    .maybeSingle();
  if (!stoneRow) {
    redirect(`/blocks?marble_error=${encodeURIComponent(`Unknown stone "${stone}"`)}`);
  }
  if ((stoneRow as { stone_category?: string }).stone_category !== "marble") {
    redirect(`/blocks?marble_error=${encodeURIComponent(`"${stone}" is not a marble stone — use the regular Add Block form for sandstone.`)}`);
  }

  // ── Create the truck entry ──────────────────────────────────────────────
  const { data: truckRow, error: truckErr } = await supabase
    .from("marble_truck_entries")
    .insert({
      stone,
      yard: yardRaw,
      truck_no: truckNo,
      vendor_name: vendorName,
      bill_no: billNo,
      total_tonnes: totalTonnes,
      num_blocks: numBlocks,
      notes,
      created_by: profile.id,
    })
    .select("id")
    .single();

  if (truckErr || !truckRow) {
    redirect(
      `/blocks?marble_error=${encodeURIComponent(`Failed to create truck: ${truckErr?.message ?? "unknown"}`)}`,
    );
  }

  // ── Generate N unique block IDs using stone-specific prefix ─────────────
  // Explicit high limit so the ID generator sees every block in the DB.
  // Supabase's .select() default caps at 1000 rows — once the blocks
  // table crosses that, the next-code picker misreads MAX and starts
  // suggesting IDs that are already taken (same pkey-collision bug that
  // hit slab_requirements).
  // Paginated — .limit(100000) does NOT override Supabase's 1000-row response
  // cap, so a truncated pool suggested already-taken codes (see fetchAllBlockIds).
  const existingIds = await fetchAllBlockIds(supabase);
  // Marble blocks share the same MT-B-XXX series as sandstone so the
  // owner sees one continuous ID sequence across the whole inventory.
  // The stone type itself (WhiteMarble / YellowMarble) already
  // distinguishes marble blocks from sandstone — a separate prefix was
  // unnecessary.

  const tonnesPerBlock = Math.round((totalTonnes / numBlocks) * 1000) / 1000; // 3 decimals

  const newRows: Array<{
    id: string;
    stone: string;
    yard: number;
    category: "Fresh";
    status: "available";
    tonnes: number;
    truck_entry_id: string;
    truck_no: string | null;
    vendor_name: string | null;
    bill_no: string | null;
    created_by: string;
    updated_by: string;
  }> = [];
  const idPool = [...existingIds];
  for (let i = 0; i < numBlocks; i++) {
    const nextId = generateNextCode(idPool);
    idPool.push(nextId);
    newRows.push({
      id: nextId,
      stone,
      yard: yardRaw,
      category: "Fresh",
      status: "available",
      tonnes: tonnesPerBlock,
      truck_entry_id: truckRow.id as string,
      truck_no: truckNo,
      vendor_name: vendorName,
      bill_no: billNo,
      created_by: profile.id,
      updated_by: profile.id,
    });
  }

  const { error: blocksErr } = await supabase.from("blocks").insert(newRows);
  if (blocksErr) {
    // Best-effort: try to clean up the truck row so we don't leave an
    // orphan truck with 0 blocks.
    await supabase.from("marble_truck_entries").delete().eq("id", truckRow.id);
    redirect(
      `/blocks?marble_error=${encodeURIComponent(`Failed to create ${numBlocks} blocks: ${blocksErr.message}. Truck entry rolled back.`)}`,
    );
  }

  await logAudit(profile.id, "marble_truck_added", "marble_truck_entry", truckRow.id as string, {
    stone,
    yard: yardRaw,
    total_tonnes: totalTonnes,
    num_blocks: numBlocks,
    tonnes_per_block: tonnesPerBlock,
    block_ids: newRows.map((r) => r.id),
    truck_no: truckNo,
    vendor_name: vendorName,
  });

  revalidatePath("/blocks");
  redirect(
    `/blocks?cat=marble&marble_toast=${encodeURIComponent(`✓ Added ${numBlocks} blocks (${tonnesPerBlock.toFixed(3)} T each) from ${stone} truck${truckNo ? ` · ${truckNo}` : ""}`)}`,
  );
}
