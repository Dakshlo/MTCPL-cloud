import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { PlanningWorkbench } from "@/components/planning-workbench";
import { requireAuth } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";

async function approvePlanAction(formData: FormData) {
  "use server";

  const { profile } = await requireAuth(["owner", "planner"]);
  const supabase = await createServerSupabaseClient();

  const kerfMm = Number(formData.get("kerf_mm"));
  const planJson = formData.get("plan_json");

  if (typeof planJson !== "string" || !planJson) {
    throw new Error("Plan payload is missing.");
  }

  const plan = JSON.parse(planJson) as Array<{
    blk: { id: string; stone: string; yard: number; h: number };
    placed: Array<{
      id: string;
      pw: number;
      ph: number;
      px: number;
      py: number;
      rot: boolean;
    }>;
    biggest: { l: number; w: number; h: number } | null;
  }>;

  if (!plan.length) {
    throw new Error("No placed blocks found in this plan.");
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
      approved_at: new Date().toISOString()
    })
    .select("id")
    .single();

  if (sessionError || !session) {
    throw new Error(sessionError?.message || "Unable to create cut session.");
  }

  for (const item of plan) {
    const { data: sessionBlock, error: blockError } = await supabase
      .from("cut_session_blocks")
      .insert({
        cut_session_id: session.id,
        block_id: item.blk.id,
        status: "pending_worker",
        layout: item,
        largest_remainder: item.biggest
      })
      .select("id")
      .single();

    if (blockError || !sessionBlock) {
      throw new Error(blockError?.message || "Unable to create cut session block.");
    }

    const usedBlockStatus = await supabase
      .from("blocks")
      .update({
        status: "reserved",
        updated_by: profile.id,
        updated_at: new Date().toISOString()
      })
      .eq("id", item.blk.id);

    if (usedBlockStatus.error) {
      throw new Error(usedBlockStatus.error.message);
    }

    for (const slab of item.placed) {
      const { error: slabLinkError } = await supabase.from("cut_session_slabs").insert({
        cut_session_block_id: sessionBlock.id,
        slab_requirement_id: slab.id,
        placed_width_ft: slab.pw,
        placed_height_ft: slab.ph,
        pos_x_ft: slab.px,
        pos_y_ft: slab.py,
        rotated: slab.rot
      });

      if (slabLinkError) {
        throw new Error(slabLinkError.message);
      }

      const slabUpdate = await supabase
        .from("slab_requirements")
        .update({
          status: "planned",
          source_block_id: item.blk.id,
          stone: item.blk.stone,
          updated_by: profile.id,
          updated_at: new Date().toISOString()
        })
        .eq("id", slab.id);

      if (slabUpdate.error) {
        throw new Error(slabUpdate.error.message);
      }
    }
  }

  revalidatePath("/planning");
  revalidatePath("/cutting");
  revalidatePath("/dashboard");
  revalidatePath("/blocks");
  revalidatePath("/slabs");
  redirect("/cutting");
}

export default async function PlanningPage() {
  await requireAuth(["owner", "planner"]);

  const supabase = await createServerSupabaseClient();
  const [{ data: blocks, error: blockError }, { data: slabs, error: slabError }] = await Promise.all([
    supabase
      .from("blocks")
      .select(
        "id, stone, yard, category, length_ft, width_ft, height_ft, trim_left_ft, trim_right_ft, trim_near_ft, trim_far_ft, status"
      )
      .order("created_at", { ascending: false }),
    supabase
      .from("slab_requirements")
      .select("id, label, temple, stone, length_ft, width_ft, thickness_ft, status")
      .order("created_at", { ascending: false })
  ]);

  if (blockError) {
    throw new Error(blockError.message);
  }

  if (slabError) {
    throw new Error(slabError.message);
  }

  return <PlanningWorkbench approveAction={approvePlanAction} blocks={blocks ?? []} slabs={slabs ?? []} />;
}
