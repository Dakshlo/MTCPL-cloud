"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

async function refreshPaths() {
  revalidatePath("/cutting");
  revalidatePath("/blocks");
  revalidatePath("/slabs");
  revalidatePath("/dashboard");
}

async function syncSessionStatus(sessionId: string) {
  const supabase = createAdminSupabaseClient();
  const { data: blocks } = await supabase
    .from("cut_session_blocks")
    .select("status")
    .eq("cut_session_id", sessionId);

  const statuses = (blocks ?? []).map((b) => b.status);
  const allClosed =
    statuses.length > 0 &&
    statuses.every((s) => s === "done" || s === "rejected");

  await supabase
    .from("cut_sessions")
    .update({ status: allClosed ? "closed" : "in_progress" })
    .eq("id", sessionId);
}

export async function approveBlockAction(formData: FormData) {
  await requireAuth(["owner", "team_head", "cutting_operator"]);
  const supabase = createAdminSupabaseClient();
  const sessionBlockId = String(formData.get("session_block_id") || "");
  const sessionId = String(formData.get("session_id") || "");

  const { error } = await supabase
    .from("cut_session_blocks")
    .update({ status: "cutting" })
    .eq("id", sessionBlockId);
  if (error) throw new Error(error.message);

  await supabase
    .from("cut_sessions")
    .update({ status: "in_progress" })
    .eq("id", sessionId);

  await refreshPaths();
}

export async function rejectBlockAction(formData: FormData) {
  const { profile } = await requireAuth(["owner", "team_head", "cutting_operator"]);
  const supabase = createAdminSupabaseClient();
  const sessionBlockId = String(formData.get("session_block_id") || "");
  const sessionId = String(formData.get("session_id") || "");
  const blockId = String(formData.get("block_id") || "");
  const slabIds = JSON.parse(String(formData.get("slab_ids") || "[]")) as string[];

  await supabase
    .from("blocks")
    .update({ status: "available", updated_by: profile.id, updated_at: new Date().toISOString() })
    .eq("id", blockId);

  if (slabIds.length) {
    await supabase
      .from("slab_requirements")
      .update({ status: "open", source_block_id: null, updated_by: profile.id, updated_at: new Date().toISOString() })
      .in("id", slabIds);
  }

  await supabase
    .from("cut_session_blocks")
    .update({ status: "rejected" })
    .eq("id", sessionBlockId);

  await syncSessionStatus(sessionId);
  await refreshPaths();
}

export async function finishBlockAction(formData: FormData) {
  const { profile } = await requireAuth(["owner", "team_head", "cutting_operator"]);
  const supabase = createAdminSupabaseClient();

  const sessionBlockId = String(formData.get("session_block_id") || "");
  const sessionId = String(formData.get("session_id") || "");
  const blockId = String(formData.get("block_id") || "");
  const stone = String(formData.get("stone") || "PinkStone");
  const yard = Number(formData.get("yard") || 1);
  const cutSlabIds = JSON.parse(String(formData.get("cut_slab_ids") || "[]")) as string[];
  const allSlabIds = JSON.parse(String(formData.get("all_slab_ids") || "[]")) as string[];
  const notCutSlabIds = allSlabIds.filter((id) => !cutSlabIds.includes(id));
  const restock = String(formData.get("restock") || "") === "yes";
  const remainders = JSON.parse(
    String(formData.get("remainders_json") || "[]")
  ) as Array<{ id: string; l: number; w: number; h: number }>;

  const restockedIds: string[] = [];

  if (restock && remainders.length > 0) {
    for (const piece of remainders) {
      if (piece.l > 0 && piece.w > 0 && piece.h > 0) {
        const { error } = await supabase.from("blocks").insert({
          id: piece.id,
          stone,
          yard,
          category: "Reused",
          length_ft: piece.l,
          width_ft: piece.w,
          height_ft: piece.h,
          status: "available",
          created_by: profile.id,
          updated_by: profile.id,
        });
        if (error) throw new Error(`Failed to create block ${piece.id}: ${error.message}`);
        restockedIds.push(piece.id);
      }
    }
  }

  const restockedBlockId = restockedIds.length > 0 ? restockedIds.join(",") : null;

  await supabase
    .from("blocks")
    .update({ status: "consumed", updated_by: profile.id, updated_at: new Date().toISOString() })
    .eq("id", blockId);

  if (cutSlabIds.length) {
    await supabase
      .from("slab_requirements")
      .update({ status: "cut_done", updated_by: profile.id, updated_at: new Date().toISOString() })
      .in("id", cutSlabIds);
  }

  if (notCutSlabIds.length) {
    await supabase
      .from("slab_requirements")
      .update({ status: "open", source_block_id: null, updated_by: profile.id, updated_at: new Date().toISOString() })
      .in("id", notCutSlabIds);
  }

  await supabase
    .from("cut_session_blocks")
    .update({ status: "done", restocked_block_id: restockedBlockId })
    .eq("id", sessionBlockId);

  await syncSessionStatus(sessionId);
  await refreshPaths();
  redirect("/cutting?tab=done");
}

export async function undoDoneAction(formData: FormData) {
  const { profile } = await requireAuth(["owner"]);
  const supabase = createAdminSupabaseClient();
  const sessionBlockId = String(formData.get("session_block_id") || "");
  const blockId = String(formData.get("block_id") || "");
  const slabIds = JSON.parse(String(formData.get("slab_ids") || "[]")) as string[];
  const restockedBlockId = String(formData.get("restocked_block_id") || "");
  const sessionId = String(formData.get("session_id") || "");

  await supabase
    .from("blocks")
    .update({ status: "reserved", updated_by: profile.id, updated_at: new Date().toISOString() })
    .eq("id", blockId);

  if (restockedBlockId) {
    const ids = restockedBlockId.split(",").map((s) => s.trim()).filter(Boolean);
    if (ids.length > 0) await supabase.from("blocks").delete().in("id", ids);
  }

  if (slabIds.length) {
    await supabase
      .from("slab_requirements")
      .update({ status: "planned", updated_by: profile.id, updated_at: new Date().toISOString() })
      .in("id", slabIds);
  }

  await supabase
    .from("cut_session_blocks")
    .update({ status: "cutting", restocked_block_id: null })
    .eq("id", sessionBlockId);

  await supabase
    .from("cut_sessions")
    .update({ status: "in_progress" })
    .eq("id", sessionId);

  await refreshPaths();
  redirect(`/cutting/${sessionBlockId}`);
}
