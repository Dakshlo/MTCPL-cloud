"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { requireAuth } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";

function errUrl(msg: string, slabIds?: string) {
  const base = `/planning?err=${encodeURIComponent(msg)}`;
  return slabIds ? `${base}&slabs=${encodeURIComponent(slabIds)}` : base;
}

export async function approvePlanAction(formData: FormData) {
  const slabIdsParam = (formData.get("slab_ids") as string | null) ?? "";

  try {
    const { profile } = await requireAuth(["owner", "team_head"]);
    const supabase = await createServerSupabaseClient();

    const kerfMm = Number(formData.get("kerf_mm"));
    const planJson = formData.get("plan_json");

    if (typeof planJson !== "string" || !planJson) {
      redirect(errUrl("Plan payload missing", slabIdsParam));
    }

    let plan: Array<{
      blk: { id: string; stone: string; yard: number; l: number; w: number; h: number };
      placed: Array<{ id: string; sw: number; sh: number; sd: number; pw: number; ph: number; px: number; py: number; rot: boolean }>;
      biggest: { l: number; w: number; h: number } | null;
    }>;

    try {
      plan = JSON.parse(planJson);
    } catch {
      redirect(errUrl("Invalid plan data", slabIdsParam));
    }

    if (!plan.length) {
      redirect(errUrl("No blocks in plan", slabIdsParam));
    }

    const blockIds = Array.from(new Set(plan.map((item) => item.blk.id)));
    const slabIds  = Array.from(new Set(plan.flatMap((item) => item.placed.map((s) => s.id))));

    const [{ data: liveBlocks, error: liveBlocksError }, { data: liveSlabs, error: liveSlabsError }] = await Promise.all([
      supabase.from("blocks").select("id, status, stone").in("id", blockIds),
      supabase.from("slab_requirements").select("id, status, stone").in("id", slabIds),
    ]);

    if (liveBlocksError) redirect(errUrl(liveBlocksError.message, slabIdsParam));
    if (liveSlabsError)  redirect(errUrl(liveSlabsError.message,  slabIdsParam));

    const blockedBlock = (liveBlocks ?? []).find((b) => b.status !== "available");
    if (blockedBlock) redirect(errUrl(`Block ${blockedBlock.id} is no longer available — refresh and regenerate.`, slabIdsParam));

    const blockedSlab = (liveSlabs ?? []).find((s) => s.status !== "open");
    if (blockedSlab) redirect(errUrl(`Slab ${blockedSlab.id} is no longer open — refresh and regenerate.`, slabIdsParam));

    const slabStoneMap  = Object.fromEntries((liveSlabs  ?? []).map((s) => [s.id, s.stone]));
    const blockStoneMap = Object.fromEntries((liveBlocks ?? []).map((b) => [b.id, b.stone]));

    for (const item of plan) {
      const blockStone = blockStoneMap[item.blk.id];
      for (const slab of item.placed) {
        const slabStone = slabStoneMap[slab.id];
        if (slabStone && blockStone && slabStone !== blockStone) {
          redirect(errUrl(`Stone mismatch: slab ${slab.id} is ${slabStone} but block ${item.blk.id} is ${blockStone}`, slabIdsParam));
        }
      }
    }

    const sessionCode = "CUT-" + new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 12);

    const { data: session, error: sessionError } = await supabase
      .from("cut_sessions")
      .insert({
        session_code: sessionCode,
        kerf_mm: Number.isFinite(kerfMm) ? kerfMm : 4,
        status: "approved",
        planned_by: profile.id,
        approved_by: profile.id,
        approved_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (sessionError || !session) {
      redirect(errUrl(sessionError?.message ?? "Unable to create cut session", slabIdsParam));
    }

    for (const item of plan) {
      const { data: sessionBlock, error: blockError } = await supabase
        .from("cut_session_blocks")
        .insert({
          cut_session_id: session.id,
          block_id: item.blk.id,
          status: "pending_worker",
          layout: item,
          largest_remainder: item.biggest,
        })
        .select("id")
        .single();

      if (blockError || !sessionBlock) {
        redirect(errUrl(blockError?.message ?? "Unable to create session block", slabIdsParam));
      }

      const usedBlock = await supabase
        .from("blocks")
        .update({ status: "reserved", updated_by: profile.id, updated_at: new Date().toISOString() })
        .eq("id", item.blk.id)
        .eq("status", "available")
        .select("id");

      if (usedBlock.error)         redirect(errUrl(usedBlock.error.message, slabIdsParam));
      if (!usedBlock.data?.length) redirect(errUrl(`Block ${item.blk.id} was already reserved — refresh and try again.`, slabIdsParam));

      for (const slab of item.placed) {
        const { error: linkErr } = await supabase.from("cut_session_slabs").insert({
          cut_session_block_id: sessionBlock.id,
          slab_requirement_id:  slab.id,
          placed_width_ft:  slab.pw,
          placed_height_ft: slab.ph,
          pos_x_ft:  slab.px,
          pos_y_ft:  slab.py,
          rotated:   slab.rot,
        });

        if (linkErr) redirect(errUrl(linkErr.message, slabIdsParam));

        const slabUpdate = await supabase
          .from("slab_requirements")
          .update({
            status: "planned",
            source_block_id: item.blk.id,
            stone: item.blk.stone,
            updated_by: profile.id,
            updated_at: new Date().toISOString(),
          })
          .eq("id", slab.id)
          .eq("status", "open")
          .select("id");

        if (slabUpdate.error)         redirect(errUrl(slabUpdate.error.message, slabIdsParam));
        if (!slabUpdate.data?.length) redirect(errUrl(`Slab ${slab.id} was already used — refresh and try again.`, slabIdsParam));
      }
    }

    revalidatePath("/planning");
    revalidatePath("/cutting");
    revalidatePath("/dashboard");
    revalidatePath("/blocks");
    revalidatePath("/slabs");
    redirect("/cutting");

  } catch (err: unknown) {
    // Let Next.js redirect / notFound signals pass through (they carry a `digest` property)
    if (err !== null && typeof err === "object" && "digest" in err) throw err;
    // Surface any unexpected error on the planning page instead of crashing
    const msg = err instanceof Error ? err.message : "Unexpected error — please try again.";
    console.error("[approvePlanAction] unhandled error:", err);
    redirect(errUrl(msg, slabIdsParam));
  }
}
