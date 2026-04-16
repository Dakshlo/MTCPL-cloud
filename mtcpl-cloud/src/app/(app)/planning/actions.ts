"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

// ── Types shared with planning-workbench ────────────────────────────────────

export type AIAssignment = {
  block_id: string;
  slab_ids: string[];
  reasoning: string;
};

export type AIplanResponse = {
  assignments: AIAssignment[];
  unassigned_slab_ids: string[];
  unassigned_reason: string;
  strategy: string;
  error?: string;
};

// ── AI Plan Generation ──────────────────────────────────────────────────────

export async function generateAIPlanAction(payload: {
  blocks: Array<{
    id: string;
    stone: string;
    yard: number;
    length_ft: number;
    width_ft: number;
    height_ft: number;
    quality: string | null;
  }>;
  slabs: Array<{
    id: string;
    label: string;
    temple: string;
    stone: string | null;
    length_ft: number;
    width_ft: number;
    thickness_ft: number;
    priority: boolean;
    quality: string | null;
  }>;
  kerfMm: number;
}): Promise<AIplanResponse> {
  await requireAuth(["developer"]);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { assignments: [], unassigned_slab_ids: [], unassigned_reason: "", strategy: "", error: "ANTHROPIC_API_KEY is not set in environment variables." };
  }

  const { blocks, slabs, kerfMm } = payload;

  const blockLines = blocks.map(b =>
    `${b.id}: ${b.stone} | ${b.length_ft}"L × ${b.width_ft}"W × ${b.height_ft}"H | quality: ${b.quality ?? "standard"}`
  ).join("\n");

  const slabLines = slabs.map(s =>
    `${s.id}${s.priority ? " ⚠PRIORITY" : ""}: ${s.temple} | ${s.stone ?? "any"} | ${s.length_ft}"L × ${s.width_ft}"W × ${s.thickness_ft}"T | ${s.label}${s.quality ? ` | quality:${s.quality}` : ""}`
  ).join("\n");

  const prompt = `You are an expert stone-cutting planner at a marble fabrication company.
Your job: assign stone slabs to blocks for CNC/manual cutting to maximise efficiency and meet deadlines.

AVAILABLE BLOCKS (${blocks.length}):
${blockLines}

SLABS TO CUT (${slabs.length}):
${slabLines}

Blade kerf: ${kerfMm}mm of stone wasted per cut line.

RULES (must follow all):
1. Same stone type only — PinkStone slabs on PinkStone blocks, etc.
2. A slab's two face dimensions must fit within some face of the block (the machine can orient the block 3 ways)
3. Multiple slabs CAN share one block (cut from different layers or placed side-by-side on the same face)
4. Each block can only appear once in assignments
5. ⚠PRIORITY slabs must be placed — never leave them in unassigned_slab_ids if a valid block exists
6. Group slabs going to the same temple on the same block where possible (reduces handling)
7. Prefer using the SMALLEST block that fits (saves larger blocks for future beam-size slabs)
8. If a slab is larger than ALL available blocks in that stone type, put it in unassigned_slab_ids

Return ONLY this JSON — no markdown, no explanation outside the JSON:
{
  "strategy": "2-3 sentences: your approach, any beam-size risks, key decisions made",
  "assignments": [
    { "block_id": "B-xxx", "slab_ids": ["SR-001", "SR-003"], "reasoning": "one sentence" }
  ],
  "unassigned_slab_ids": [],
  "unassigned_reason": ""
}`;

  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const anthropic = new Anthropic({ apiKey });

    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = message.content[0].type === "text" ? message.content[0].text.trim() : "";

    // Strip markdown code fences if Claude adds them
    const jsonText = raw.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
    const parsed = JSON.parse(jsonText) as AIplanResponse;
    return parsed;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { assignments: [], unassigned_slab_ids: [], unassigned_reason: "", strategy: "", error: `AI call failed: ${msg}` };
  }
}

function errUrl(msg: string, slabIds?: string) {
  const base = `/planning?err=${encodeURIComponent(msg)}`;
  return slabIds ? `${base}&slabs=${encodeURIComponent(slabIds)}` : base;
}

export async function approvePlanAction(formData: FormData) {
  const slabIdsParam = (formData.get("slab_ids") as string | null) ?? "";

  try {
    const { profile } = await requireAuth(["owner", "team_head"]);
    const supabase = createAdminSupabaseClient();

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

    // Audit: plan approved and sent to cutting
    await logAudit(profile.id, "plan_approved", "cut_session", session.id, {
      session_code: sessionCode,
      kerf_mm: kerfMm,
      blocks: blockIds,
      slabs: slabIds,
      block_count: blockIds.length,
      slab_count: slabIds.length,
    });

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
