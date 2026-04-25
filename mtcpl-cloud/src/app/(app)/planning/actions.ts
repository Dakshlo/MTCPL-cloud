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

/**
 * Efficiency improvement suggestion from the AI: an open slab that the
 * user did NOT select for this plan but which would fit into the
 * leftover face-area + depth of an already-planned block. Surfaced
 * after each AI plan run so the operator can accept and re-plan if
 * they want a tighter fill.
 */
export type AISuggestion = {
  /** Open slab ID the user could add to the plan. */
  slab_id: string;
  /** Which already-planned block it would slot into (one of assignments[*].block_id). */
  block_id: string;
  /** One-sentence justification — fit dimensions + estimated efficiency gain. */
  reasoning: string;
};

export type AIplanResponse = {
  assignments: AIAssignment[];
  unassigned_slab_ids: string[];
  unassigned_reason: string;
  strategy: string;
  /**
   * Optional efficiency-improvement hints. Populated from the model's
   * second pass over the available (unselected) slab inventory after
   * it has finalised assignments. Empty if there's no leftover space
   * worth filling, or if the model omits the field.
   */
  suggestions?: AISuggestion[];
  error?: string;
};

/**
 * Procurement suggestion: a block dimension the AI thinks the company
 * should buy/order to unblock currently-unfittable slabs. Surfaced when
 * the algorithm marked one or more slabs as "no compatible block in
 * stock".
 */
export type AIProcurementSuggestion = {
  /** Stone type the procured block must be (PinkStone, WhiteStone, etc.). */
  stone: string;
  /** Recommended block dimensions (inches). */
  recommended: { length: number; width: number; height: number };
  /** Quality grade required (A or B); null if any. */
  quality: string | null;
  /** How many of these blocks would unblock all the currently-listed slabs. */
  quantity: number;
  /** Which currently-unfittable slabs this block size would handle. */
  unblocks_slab_ids: string[];
  /** One-sentence justification — why these dims, why this quantity. */
  reasoning: string;
};

/**
 * Response shape for the post-algorithm AI suggestions action. The
 * algorithm runs first (deterministic geometry); the AI then walks
 * its output and produces two kinds of advice on top:
 *   1. fillerSuggestions — open-pool slabs that would slot into
 *      leftover face/depth on already-planned blocks.
 *   2. procurementSuggestions — block sizes the company should
 *      order to handle the slabs the algorithm couldn't fit.
 */
export type AISuggestionsResponse = {
  /** Always populated, even if both lists are empty. 1–3 sentences of context. */
  strategy: string;
  fillerSuggestions: AISuggestion[];
  procurementSuggestions: AIProcurementSuggestion[];
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
  /** Slabs the user explicitly picked — must be planned. */
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
  /**
   * Open slabs the user did NOT select — pool the model can mine
   * for efficiency-improvement suggestions after producing the
   * main assignments. Optional; if omitted, no suggestions field
   * is populated.
   */
  availableSlabs?: Array<{
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

  const { blocks, slabs, availableSlabs = [], kerfMm } = payload;

  // ── Pre-compute helper fields the AI needs ──────────────────────────
  // The AI's job is just to GROUP slabs into block buckets — it does
  // NOT compute coordinates. The actual layout is computed by the same
  // geometry engine that powers the algorithmic plan (runOptimization
  // → tryPackBlock → packBlock in src/lib/planning/packing.ts). So we
  // can offload all the geometric reasoning to the engine and keep the
  // AI focused on the high-value decisions:
  //   1. Which BLOCK fits this slab (smallest sufficient one)
  //   2. Which OTHER slabs share the block (clustering)
  //   3. INVENTORY STRATEGY — preserve big blocks for future beams.

  // Block size tier — informal labels we tell the AI to use as a
  // strategic hint. Tuned to typical sandstone / marble inventory at
  // MTCPL: "small" blocks are aggressively used because they're hardest
  // to find a use for later, "beam" blocks are preserved for very long
  // (10ft+) future slabs that physically can't fit anywhere else.
  function tier(b: { length_ft: number; width_ft: number; height_ft: number }) {
    const longest = Math.max(b.length_ft, b.width_ft, b.height_ft);
    if (longest < 60) return "SMALL";
    if (longest < 90) return "MEDIUM";
    if (longest < 130) return "LARGE";
    return "BEAM";
  }

  function vol(b: { length_ft: number; width_ft: number; height_ft: number }) {
    return Math.round(b.length_ft * b.width_ft * b.height_ft);
  }

  // Sort blocks by volume ASCENDING so the AI sees them in the order
  // it should prefer to consume them (smallest first). The list is also
  // grouped by stone so the AI can scan stone-by-stone.
  const sortedBlocks = [...blocks].sort((a, b) => {
    if (a.stone !== b.stone) return a.stone.localeCompare(b.stone);
    return vol(a) - vol(b);
  });

  const blockLines = sortedBlocks
    .map((b) => {
      const longest = Math.max(b.length_ft, b.width_ft, b.height_ft);
      return `  ${b.id} [${tier(b)} · ${vol(b).toLocaleString()}cu·in · longest=${longest}"]: ${b.stone} | ${b.length_ft}"L × ${b.width_ft}"W × ${b.height_ft}"H | quality:${b.quality ?? "standard"}`;
    })
    .join("\n");

  // Sort slabs by anchor_dim DESCENDING — the longest slabs need to
  // claim "their" smallest block first, otherwise smaller slabs would
  // greedily occupy the small blocks and force long slabs onto beam
  // blocks. (This is exactly what the algorithm does too.)
  const sortedSlabs = [...slabs].sort((a, b) => {
    const am = Math.max(a.length_ft, a.width_ft);
    const bm = Math.max(b.length_ft, b.width_ft);
    if (bm !== am) return bm - am;
    if (a.priority !== b.priority) return a.priority ? -1 : 1;
    return 0;
  });

  const slabLines = sortedSlabs
    .map((s) => {
      const anchor = Math.max(s.length_ft, s.width_ft);
      return `  ${s.id}${s.priority ? " ⚠PRIORITY" : ""} [anchor=${anchor}"]: ${s.temple} | ${s.stone ?? "any-stone"} | ${s.length_ft}"L × ${s.width_ft}"W × ${s.thickness_ft}"T | ${s.label}${s.quality ? ` | quality:${s.quality}` : ""}`;
    })
    .join("\n");

  // Available (unselected) open slabs — fed to the model so it can
  // propose efficiency-improvement suggestions in a second pass.
  // Capped to keep the prompt size bounded; the cap is generous because
  // Sonnet's context can hold thousands of lines easily, but we'd rather
  // not pay for tokens describing slabs the model couldn't possibly use.
  const AVAILABLE_CAP = 200;
  const sortedAvailable = [...availableSlabs]
    .sort((a, b) => {
      const am = Math.max(a.length_ft, a.width_ft);
      const bm = Math.max(b.length_ft, b.width_ft);
      return am - bm; // smallest anchor first — easier-to-fit slabs at the top
    })
    .slice(0, AVAILABLE_CAP);
  const availableLines = sortedAvailable.length === 0
    ? "  (none — every open slab is already in the user's selection)"
    : sortedAvailable
        .map((s) => {
          const anchor = Math.max(s.length_ft, s.width_ft);
          return `  ${s.id}${s.priority ? " ⚠PRIORITY" : ""} [anchor=${anchor}"]: ${s.temple} | ${s.stone ?? "any-stone"} | ${s.length_ft}"L × ${s.width_ft}"W × ${s.thickness_ft}"T | ${s.label}${s.quality ? ` | quality:${s.quality}` : ""}`;
        })
        .join("\n");
  const availableTruncated = availableSlabs.length > AVAILABLE_CAP
    ? `\n  …${availableSlabs.length - AVAILABLE_CAP} more available slabs not shown (smallest-anchor shown first)`
    : "";

  // ── The prompt ──────────────────────────────────────────────────────
  // We teach the AI the same algorithm the engine uses, then add the
  // ONE strategic improvement we want it to make on top: prefer small
  // blocks, preserve beams. Everything else (geometric feasibility,
  // multi-layer packing, kerf math) is handled by the engine — the AI
  // only needs to produce correct GROUPINGS.

  const prompt = `You are the cut planner for MTCPL, a stone-fabrication company.

Your output is consumed by a deterministic geometry engine that:
  • takes your {block_id, slab_ids[]} groupings as ground truth
  • computes the actual 3D layout, kerf math, and orientation
  • rejects any infeasible grouping and falls back to the algorithm

So your one job is to GROUP slabs into blocks. You don't compute coordinates.
The engine will figure out if the slabs physically fit; your task is to make
SMART choices about WHICH block holds WHICH slabs.

═══════════════════════════════════════════════════════════════════
ALGORITHM YOU'RE EMULATING (then improving)
═══════════════════════════════════════════════════════════════════

The deterministic algorithm does this for each slab (longest-first):
  1. Find candidate blocks where stone matches, quality matches, and
     max(block.L, block.W, block.H) ≥ max(slab.L, slab.W). The slab's
     longest dimension is the "anchor" — every block must be at least
     that long.
  2. Sort candidates by VOLUME ASCENDING (smallest sufficient block first).
  3. Try the smallest candidate. If the slab packs onto it, commit and
     pull every other compatible slab onto the same block before moving on.

This produces decent plans but treats all blocks the same size-wise. You
will improve on it with INVENTORY STRATEGY.

═══════════════════════════════════════════════════════════════════
THE IMPROVEMENT YOU MUST MAKE — INVENTORY STRATEGY
═══════════════════════════════════════════════════════════════════

Blocks are tagged by tier in the listing below:
  • SMALL   (longest < 60"):  USE AGGRESSIVELY. Hard to find a use for
                              later — clear them out first.
  • MEDIUM  (60–89"):         Bread and butter. Use freely.
  • LARGE   (90–129"):        Use only when no SMALL/MEDIUM fits the
                              anchor (anchor ≥ 60" requires at least
                              MEDIUM, anchor ≥ 90" requires LARGE).
  • BEAM    (≥ 130"):         RESERVE. Only use when:
                              (a) the slab itself is anchor ≥ 130", OR
                              (b) every smaller block has been tried
                                  and no LARGE-tier block of matching
                                  stone is left.

Long beam orders (10ft+ railings, lintels) come in regularly; we lose
those orders if we already cut a 12ft block into 4ft slabs we could
have made on a 4ft block.

═══════════════════════════════════════════════════════════════════
PACKING MECHANICS (so you know what's feasible)
═══════════════════════════════════════════════════════════════════

Block dimensions: L × W × H inches (cut face = L × W, depth = H).
Cuts go through H, producing horizontal layers.

Slab fits a block iff at least one of these orientations works:
  • slab.L ≤ blockface.X AND slab.W ≤ blockface.Y AND slab.T ≤ depth
  • (and rotations / face permutations of the same)

Multi-layer packing: each layer of cuts produces N slabs of the SAME
THICKNESS in that layer. Layers stack; total layer depth ≤ block H.
So one block holds many slabs:
  Block 84×28×60 with 24×24×0.25"-thick slabs:
  → ≈3 slabs per layer, ~200 layers ⇒ many hundreds in theory.

Group slabs of similar thickness so layers stay clean.

═══════════════════════════════════════════════════════════════════
HARD RULES (engine rejects violations)
═══════════════════════════════════════════════════════════════════

1. STONE: slab.stone must equal block.stone. (slab.stone="any" matches anything.)
2. QUALITY:
     - Grade-A slab REQUIRES Grade-A block.
     - Grade-B slab needs Grade-A or Grade-B block (NOT standard/null).
     - Standard slab works on any block.
3. ANCHOR: max(slab.L, slab.W) ≤ max(block.L, block.W, block.H).
4. UNIQUE: every block_id at most ONCE; every slab_id at most ONCE.
5. PRIORITY (⚠PRIORITY) slabs MUST be assigned if any block fits them.

═══════════════════════════════════════════════════════════════════
INPUT
═══════════════════════════════════════════════════════════════════

Blade kerf: ${kerfMm}mm per cut.

AVAILABLE BLOCKS (${blocks.length}, sorted smallest-volume first within each stone):
${blockLines}

SLABS THE USER ASKED YOU TO PLAN (${slabs.length}, sorted longest-anchor first):
${slabLines}

OTHER OPEN SLABS NOT IN THE USER'S SELECTION (${availableSlabs.length}, sorted smallest-anchor first):
These are slabs the user did NOT pick this run — but they exist in the open
inventory. After you finalise the assignments below, you'll do a SECOND PASS
to suggest which of these would fit into LEFTOVER face-area or LEFTOVER depth
on the blocks you're already using, so the user can fill the block tighter
in one cutting session instead of starting it half-full.
${availableLines}${availableTruncated}

═══════════════════════════════════════════════════════════════════
DECISION PROCEDURE — follow exactly
═══════════════════════════════════════════════════════════════════

PHASE 1 — Plan the user's selection (the must-do work):

For each slab in the order shown (longest anchor first):
  IF already assigned: skip.
  Step 1: Determine min-tier needed by anchor:
     anchor < 60"   → start with SMALL
     anchor < 90"   → start with MEDIUM
     anchor < 130"  → start with LARGE
     anchor ≥ 130"  → start with BEAM
  Step 2: List all unassigned blocks of matching stone+quality at the
     min-tier or above. Sort by volume ASCENDING. Walk the list.
  Step 3: Take the FIRST candidate. Pull onto it any other unassigned
     compatible slabs (same stone, similar thickness preferred, same
     temple as a tiebreaker). Stop pulling when face area is ~85% full
     in 2D OR 4–8 slabs grouped (don't over-stuff — the engine will
     also reject infeasible packs).
  Step 4: If after Step 3 the chosen block has fewer than 2 slabs AND
     the next-smaller tier also has a fitting block, downgrade. (Avoid
     wasting a MEDIUM on a single small slab when SMALL was available.)
  Step 5: Commit and move to the next slab.

PHASE 2 — Suggest fillers from OTHER OPEN SLABS:

Once Phase 1 is complete, walk the blocks you've assigned. For each:
  a. Estimate the leftover face area on the cut face (block.faceL × faceW
     minus the area consumed by the selected slabs you packed onto it).
  b. Estimate the leftover depth budget (block.depth minus the layer
     depth your selected slabs already consumed, including kerf).
  c. Scan OTHER OPEN SLABS for any that:
     - share the block's stone (or have stone="any"),
     - quality compatibility holds,
     - their two face dims fit the leftover face area in some orientation,
     - their depth dim fits remaining depth budget.
  d. Pick the BEST candidates per block — at most 2 per block, at most 8
     total across the plan. Prefer slabs that:
     - share the same temple as slabs already on that block (one trip),
     - have small anchor dims (easier to fit — they slot into corners),
     - have the same thickness as one of the layers you already planned
       (no extra kerf cut needed).
  e. Skip a block entirely if leftover face area is < ~25% — not worth
     the planner's time to consider tiny scraps.

Quality of suggestions matters more than quantity. ZERO suggestions is a
valid answer if the assigned blocks are already tightly packed.

═══════════════════════════════════════════════════════════════════
OUTPUT — strict JSON, no markdown fences, no prose outside the JSON
═══════════════════════════════════════════════════════════════════

{
  "strategy": "2–4 sentences. Required content: how many blocks total, average slabs/block, how many SMALL vs MEDIUM vs LARGE vs BEAM blocks used, and which beams (if any) you preserved by escalating only when forced.",
  "assignments": [
    {
      "block_id": "MT-B-040",
      "slab_ids": ["MH-0001", "MH-0002", "MH-0003"],
      "reasoning": "One sentence. Mention the tier and why you picked this block over the next-smaller alternative (e.g. 'MEDIUM 78\\" was smallest fitting the 72\\" anchor; SMALL all under 60\\".')."
    }
  ],
  "unassigned_slab_ids": [],
  "unassigned_reason": "Empty string if all slabs assigned. Otherwise list each unassigned slab and the specific reason (no compatible stone block available, anchor too long, etc.).",
  "suggestions": [
    {
      "slab_id": "MH-0099",
      "block_id": "MT-B-040",
      "reasoning": "One sentence. Cite leftover space on the block and why this slab fills it (e.g. 'leaves ~28×16\\" of free face after MH-0001/2/3; this slab is 24×14×0.5\\" and shares the same 0.5\\" thickness layer — fills without an extra cut.')."
    }
  ]
}

(suggestions[] may be an empty array. If you cannot identify any worthwhile
filler, return suggestions: [] — do NOT invent low-quality suggestions to
hit a count.)`;

  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const anthropic = new Anthropic({ apiKey });

    const message = await anthropic.messages.create({
      // Sonnet — much smarter than Haiku for the multi-step strategic
      // reasoning required (tier preservation, anchor matching, kerf-
      // aware grouping). Cost is higher per call but the AI button is
      // pressed maybe 5–20 times a day, so total spend is negligible
      // compared to the value of a better cut plan.
      model: "claude-sonnet-4-5",
      // Slightly higher cap to leave room for the Phase-2 suggestions
      // pass on top of the main assignments.
      max_tokens: 12288,
      // Low temperature — we want the model to follow the procedure,
      // not get creative. Slight non-zero so it can still make
      // reasonable judgement calls on ties.
      temperature: 0.2,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = message.content[0].type === "text" ? message.content[0].text.trim() : "";

    // Strip markdown code fences if model adds them
    let jsonText = raw.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();

    // If there's text before the JSON object, extract just the JSON
    const jsonStart = jsonText.indexOf("{");
    const jsonEnd = jsonText.lastIndexOf("}");
    if (jsonStart !== -1 && jsonEnd !== -1) {
      jsonText = jsonText.slice(jsonStart, jsonEnd + 1);
    }

    const parsed = JSON.parse(jsonText) as AIplanResponse;
    return parsed;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { assignments: [], unassigned_slab_ids: [], unassigned_reason: "", strategy: "", error: `AI call failed: ${msg}` };
  }
}

/**
 * Post-algorithm AI suggestions. Developer-only.
 *
 * Run AFTER the algorithmic planner has produced its plan. The AI is
 * NOT asked to plan — it walks the algorithm's output and produces
 * two kinds of advice:
 *
 *   1. fillerSuggestions  — open-pool slabs that would fit into
 *                            leftover face area / depth budget on
 *                            already-planned blocks. Lets the operator
 *                            pack the cutting session tighter without
 *                            having to think about geometry.
 *
 *   2. procurementSuggestions — block dimensions the company should
 *                            order to handle slabs the algorithm
 *                            couldn't fit anywhere ("unfittable"
 *                            list). Grouped per stone with min-size
 *                            recommendations.
 *
 * If the plan placed everything cleanly AND there's no leftover space
 * worth mentioning, both lists come back empty — that's a valid
 * answer ("nothing to suggest, plan is already optimal").
 */
export async function aiSuggestionsAction(payload: {
  /** Algorithm-produced plan: each entry is one block + the slabs placed on it. */
  plan: Array<{
    block: {
      id: string;
      stone: string;
      length_ft: number;
      width_ft: number;
      height_ft: number;
      quality: string | null;
    };
    /** Slabs already on this block, with the dims as cut. */
    placed: Array<{
      id: string;
      label: string;
      temple: string;
      length_ft: number;
      width_ft: number;
      thickness_ft: number;
    }>;
    /** Largest leftover space the engine reported, if any. */
    biggest_leftover: { length: number; width: number; height: number } | null;
    /** Computed "% volume used" — 0–99. */
    efficiency_pct: number;
  }>;
  /** Slabs the algorithm reported as not fittable — drives procurement. */
  unfittableSlabs: Array<{
    id: string;
    label: string;
    temple: string;
    stone: string | null;
    length_ft: number;
    width_ft: number;
    thickness_ft: number;
    quality: string | null;
    priority: boolean;
  }>;
  /** Open slabs not in the plan — pool for filler suggestions. */
  availableSlabs: Array<{
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
}): Promise<AISuggestionsResponse> {
  await requireAuth(["developer"]);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      strategy: "",
      fillerSuggestions: [],
      procurementSuggestions: [],
      error: "ANTHROPIC_API_KEY is not set in environment variables.",
    };
  }

  const { plan, unfittableSlabs, availableSlabs, kerfMm } = payload;

  // Empty plan AND no unfittable slabs = nothing to suggest about. Save
  // a round-trip and return clean empties.
  if (plan.length === 0 && unfittableSlabs.length === 0) {
    return {
      strategy: "Nothing to suggest — no planned blocks and no unfittable slabs.",
      fillerSuggestions: [],
      procurementSuggestions: [],
    };
  }

  // ── Cap available pool size for prompt budget ────────────────────────
  const AVAILABLE_CAP = 200;
  const sortedAvailable = [...availableSlabs]
    .sort((a, b) => {
      const am = Math.max(a.length_ft, a.width_ft);
      const bm = Math.max(b.length_ft, b.width_ft);
      return am - bm; // smallest-anchor first — easiest to fit slot in corners
    })
    .slice(0, AVAILABLE_CAP);

  // ── Render plan blocks with their leftover space ──────────────────────
  const planLines = plan.length === 0
    ? "  (no planned blocks — every selected slab was unfittable)"
    : plan
        .map((p) => {
          const placedSummary = p.placed
            .map((s) => `${s.id} (${s.length_ft}×${s.width_ft}×${s.thickness_ft}″)`)
            .join(", ");
          const left = p.biggest_leftover
            ? `${p.biggest_leftover.length}×${p.biggest_leftover.width}×${p.biggest_leftover.height}″`
            : "≈0";
          return `  ${p.block.id} [${p.block.stone}, ${p.block.length_ft}×${p.block.width_ft}×${p.block.height_ft}″, quality:${p.block.quality ?? "standard"}, ${p.efficiency_pct}% used]
    placed:   ${placedSummary || "(none)"}
    leftover: ${left}`;
        })
        .join("\n");

  const unfittableLines = unfittableSlabs.length === 0
    ? "  (none — every selected slab was placed)"
    : unfittableSlabs
        .map((s) => {
          const anchor = Math.max(s.length_ft, s.width_ft);
          return `  ${s.id}${s.priority ? " ⚠PRIORITY" : ""} [anchor=${anchor}″]: ${s.temple} | ${s.stone ?? "any-stone"} | ${s.length_ft}×${s.width_ft}×${s.thickness_ft}″ | ${s.label}${s.quality ? ` | quality:${s.quality}` : ""}`;
        })
        .join("\n");

  const availableLines = sortedAvailable.length === 0
    ? "  (no other open slabs in inventory — nothing to fill leftover space with)"
    : sortedAvailable
        .map((s) => {
          const anchor = Math.max(s.length_ft, s.width_ft);
          return `  ${s.id}${s.priority ? " ⚠PRIORITY" : ""} [anchor=${anchor}″]: ${s.temple} | ${s.stone ?? "any-stone"} | ${s.length_ft}×${s.width_ft}×${s.thickness_ft}″ | ${s.label}${s.quality ? ` | quality:${s.quality}` : ""}`;
        })
        .join("\n");
  const availableTrunc = availableSlabs.length > AVAILABLE_CAP
    ? `\n  …${availableSlabs.length - AVAILABLE_CAP} more available slabs not shown (smallest-anchor first)`
    : "";

  const prompt = `You are an inventory advisor for MTCPL, a stone-fabrication company.

The deterministic cut-planning algorithm has just produced a plan from
the user's selection. Your role is NOT to re-plan — it's to look at the
output and give two kinds of actionable advice on top:

  1. FILLER SUGGESTIONS — slabs from the open inventory the user did
     NOT select but which would slot into the leftover face area /
     depth budget on the already-planned blocks. Goal: stop the
     operator starting a cutting session with a half-empty block.

  2. PROCUREMENT SUGGESTIONS — block dimensions the company should
     order or source to unblock slabs the algorithm flagged as
     UNFITTABLE (no block in current stock fits them). Goal: feed
     these into the procurement queue so the company isn't stuck with
     unfillable orders.

═══════════════════════════════════════════════════════════════════
INPUT
═══════════════════════════════════════════════════════════════════

Blade kerf: ${kerfMm}mm per cut.

PLANNED BLOCKS (${plan.length}) — each line shows the block, slabs
already cut from it, and the largest leftover space the engine measured:
${planLines}

UNFITTABLE SLABS (${unfittableSlabs.length}) — slabs the algorithm
could NOT place anywhere in current stock (no compatible block long enough):
${unfittableLines}

OTHER OPEN SLABS (${availableSlabs.length}, capped at ${AVAILABLE_CAP},
smallest-anchor first) — the pool you can mine for fillers:
${availableLines}${availableTrunc}

═══════════════════════════════════════════════════════════════════
PHASE 1 — FILLER SUGGESTIONS
═══════════════════════════════════════════════════════════════════

⚠ HARD RULE — STONE MUST MATCH ⚠
Never suggest a slab on a block of a DIFFERENT stone. PinkStone slabs
go ONLY on PinkStone blocks. WhiteStone slabs go ONLY on WhiteStone
blocks. Same for every other stone. The downstream client filter
will silently drop any cross-stone suggestion, so cross-stone entries
are wasted output. (Exception: a slab whose stone is literally
"any-stone" can go on any block.)

For each PLANNED BLOCK above:
  a. Read the leftover space (last value on each block's line). If the
     leftover is empty/tiny (<25% of block face area), skip — not
     worth filling.
  b. From the OTHER OPEN SLABS list, find slabs that:
     • have the SAME stone as the block (this is the hard rule above —
       e.g. block stone = "PinkStone" ⇒ only consider slabs marked
       "PinkStone" or "any-stone"),
     • quality compatibility holds (Grade A slab needs Grade A block;
       Grade B slab needs A or B; standard works on any),
     • their two face dims fit the leftover space in some orientation,
     • their depth dim fits the leftover depth budget.
  c. Prefer slabs that:
     • share the same TEMPLE as slabs already on this block (one trip),
     • have small anchor dims (slot into corners),
     • have the same THICKNESS as slabs already on this block — same
       cut layer means no extra kerf wasted.
  d. Cap: at most 2 per block, 8 total. ZERO is a valid answer.

═══════════════════════════════════════════════════════════════════
PHASE 2 — PROCUREMENT SUGGESTIONS
═══════════════════════════════════════════════════════════════════

⚠ HARD RULE — STONE MUST MATCH ⚠
Each procurement entry MUST have a "stone" field that matches the
stone of the slabs it claims to unblock. Never put a PinkStone slab in
the unblocks_slab_ids of a WhiteStone procurement entry. Mixed-stone
entries will be silently dropped by the client filter.

If the UNFITTABLE list is empty, return procurementSuggestions: [].
Otherwise:

For each STONE that has unfittable slabs:
  a. Find the largest unfittable slab of that stone (by anchor dim).
  b. Recommend a block size:
     • length ≥ slab.anchor + 4″ (safety margin for kerf + clamp),
     • width  ≥ second slab dim + 2″,
     • height ≥ slab.thickness × (number of unfittable slabs of similar
       size, capped at 8 layers; min 4″).
  c. Quantity: ceil(total unfittable area of this stone / face area
     of one recommended block). Never less than 1.
  d. List which unfittable slab IDs this would unblock.
  e. If different unfittable slabs of the same stone are wildly
     different in size (e.g. 145″ + 70″), output TWO procurement
     entries — one tall one for the 145″, one shorter one for the 70″.

═══════════════════════════════════════════════════════════════════
OUTPUT — strict JSON, no markdown fences, no prose outside the JSON
═══════════════════════════════════════════════════════════════════

{
  "strategy": "1–3 sentences. Required: number of fillers proposed, number of procurement entries, total slabs unblocked by procurement (if any).",
  "fillerSuggestions": [
    {
      "slab_id": "MH-0099",
      "block_id": "MT-B-040",
      "reasoning": "One sentence. Cite leftover dims and matching thickness/temple."
    }
  ],
  "procurementSuggestions": [
    {
      "stone": "PinkStone",
      "recommended": { "length": 150, "width": 30, "height": 24 },
      "quality": "A",
      "quantity": 1,
      "unblocks_slab_ids": ["MH-0142"],
      "reasoning": "One sentence. Cite the largest unfittable slab and why these dims."
    }
  ]
}

Both arrays may be []. Quality of reasoning matters more than quantity —
DO NOT invent low-quality entries to hit a count.`;

  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const anthropic = new Anthropic({ apiKey });

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 8192,
      temperature: 0.2,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = message.content[0].type === "text" ? message.content[0].text.trim() : "";

    // Strip markdown fences + prose around the JSON
    let jsonText = raw.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
    const jsonStart = jsonText.indexOf("{");
    const jsonEnd = jsonText.lastIndexOf("}");
    if (jsonStart !== -1 && jsonEnd !== -1) {
      jsonText = jsonText.slice(jsonStart, jsonEnd + 1);
    }

    const parsed = JSON.parse(jsonText) as Partial<AISuggestionsResponse>;
    return {
      strategy: parsed.strategy ?? "",
      fillerSuggestions: Array.isArray(parsed.fillerSuggestions) ? parsed.fillerSuggestions : [],
      procurementSuggestions: Array.isArray(parsed.procurementSuggestions) ? parsed.procurementSuggestions : [],
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return {
      strategy: "",
      fillerSuggestions: [],
      procurementSuggestions: [],
      error: `AI call failed: ${msg}`,
    };
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
