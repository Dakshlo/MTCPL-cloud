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

  const blockIds = Array.from(new Set(plan.map((item) => item.blk.id)));
  const slabIds = Array.from(new Set(plan.flatMap((item) => item.placed.map((slab) => slab.id))));

  const [{ data: liveBlocks, error: liveBlocksError }, { data: liveSlabs, error: liveSlabsError }] = await Promise.all([
    supabase.from("blocks").select("id, status").in("id", blockIds),
    supabase.from("slab_requirements").select("id, status").in("id", slabIds)
  ]);

  if (liveBlocksError) {
    throw new Error(liveBlocksError.message);
  }

  if (liveSlabsError) {
    throw new Error(liveSlabsError.message);
  }

  const blockedBlock = (liveBlocks ?? []).find((item) => item.status !== "available");
  if (blockedBlock) {
    throw new Error(`Block ${blockedBlock.id} was already changed by another user. Refresh planning and generate again.`);
  }

  const blockedSlab = (liveSlabs ?? []).find((item) => item.status !== "open");
  if (blockedSlab) {
    throw new Error(`Slab ${blockedSlab.id} was already changed by another user. Refresh planning and generate again.`);
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
      .eq("id", item.blk.id)
      .eq("status", "available")
      .select("id");

    if (usedBlockStatus.error) {
      throw new Error(usedBlockStatus.error.message);
    }

    if (!usedBlockStatus.data?.length) {
      throw new Error(`Block ${item.blk.id} was already reserved by another user. Refresh planning and try again.`);
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
        .eq("id", slab.id)
        .eq("status", "open")
        .select("id");

      if (slabUpdate.error) {
        throw new Error(slabUpdate.error.message);
      }

      if (!slabUpdate.data?.length) {
        throw new Error(`Slab ${slab.id} was already used by another user. Refresh planning and try again.`);
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

export default async function PlanningPage({
  searchParams,
}: {
  searchParams: Promise<{ slabs?: string }>;
}) {
  await requireAuth(["owner", "planner"]);

  const supabase = await createServerSupabaseClient();
  const params = await searchParams;

  // slabs param: comma-separated IDs sent from Slab View page
  const selectedSlabIds = params.slabs
    ? params.slabs.split(",").map(s => s.trim()).filter(Boolean)
    : null;

  let slabQuery = supabase
    .from("slab_requirements")
    .select("id, label, temple, stone, quality, length_ft, width_ft, thickness_ft, status")
    .eq("status", "open")
    .order("created_at", { ascending: false });

  // If specific slabs were selected from the Slab View, only load those
  if (selectedSlabIds && selectedSlabIds.length > 0) {
    slabQuery = slabQuery.in("id", selectedSlabIds);
  }

  const [{ data: blocks, error: blockError }, { data: slabs, error: slabError }] = await Promise.all([
    supabase
      .from("blocks")
      .select("id, stone, yard, category, quality, length_ft, width_ft, height_ft, status")
      .eq("status", "available")
      .order("created_at", { ascending: false }),
    slabQuery,
  ]);

  if (blockError) throw new Error(blockError.message);
  if (slabError) throw new Error(slabError.message);

  // No slabs param = user navigated directly, not from Slab View
  if (!selectedSlabIds) {
    return (
      <div className="page-content" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "60vh", textAlign: "center", gap: 16 }}>
        <div style={{ fontSize: 56, lineHeight: 1 }}>⌘</div>
        <h2 style={{ margin: 0 }}>No Slabs Selected</h2>
        <p className="muted" style={{ maxWidth: 400 }}>
          Go to Slab View, select the slabs you want to cut today, then click &ldquo;Send to Plan Generator&rdquo;.
        </p>
        <a href="/slabs/view" className="primary-button" style={{ textDecoration: "none", marginTop: 8 }}>
          Go to Slab View →
        </a>
      </div>
    );
  }

  return <PlanningWorkbench approveAction={approvePlanAction} blocks={blocks ?? []} slabs={slabs ?? []} />;
}
