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
import { marbleBlockPrefix, nextBlockIdWithPrefix } from "@/lib/stone-categories";

export async function createMarbleTruckAction(formData: FormData) {
  const { profile } = await requireAuth([
    "owner",
    "team_head",
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
  const { data: existingBlocks } = await supabase.from("blocks").select("id");
  const existingIds = (existingBlocks ?? []).map((r) => r.id as string);
  const prefix = marbleBlockPrefix(stone);

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
    const nextId = nextBlockIdWithPrefix(idPool, prefix);
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
