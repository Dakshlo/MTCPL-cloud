// ──────────────────────────────────────────────────────────────────
// /api/tools/bill-scan — read a tool supplier's bill (mig 237)
//
// Daksh, Nov 2026: "we will scan the bill, it will fetch item name and
// qty. If item don't exist it will create new and prompt us 'should I
// create new item'. And make the AI smart — if there is a small typo
// the AI can fix it and put stock to the relevant item."
//
// Sibling of /api/accounts/bill-scan, and deliberately NOT the same
// route. That one reads a bill for MONEY: vendor, number, GST, total,
// so the accountant can pay it. This one reads the same kind of paper
// for STOCK: what came in the box, and how many. Daksh, same day: "no,
// don't link this to finance at all, it's completely separate."
//
// ── Read-only ─────────────────────────────────────────────────────
//
// This route writes NOTHING. It returns what it read plus a proposed
// match for each line, and the review screen then posts the decisions
// through a server action. A photograph must never be able to move the
// shelf on its own.
//
// ── What the model is and is not trusted with ─────────────────────
//
// Trusted: reading. Digits off a crumpled hand-written challan is
// exactly what it is good at.
//
// Not trusted: deciding. It is handed the catalogue and asked to
// propose a match, but lib/cnc-tool-bill-match scores every proposal
// independently and throws away the ones it cannot see a reason for.
// With a catalogue of one item, "which of these is it?" has an obvious
// wrong answer that a helpful model will reach for.
//
// Env: ANTHROPIC_API_KEY (required)
//      TOOL_BILL_SCAN_MODEL (optional — defaults to claude-opus-4-8;
//      roughly ₹7–9 a bill. Set it to claude-sonnet-4-6 for about ₹2 if
//      the cheaper read turns out to be good enough on real bills; the
//      finance scanner has run on Sonnet since June. Matching across a
//      growing catalogue is the harder half of this job, which is why
//      the default here starts at the top.)
// ──────────────────────────────────────────────────────────────────

import { NextResponse, type NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canScanToolBills } from "@/lib/cnc-tool-permissions";
import {
  aliasKey,
  cleanToolName,
  cleanUnit,
  matchLine,
  normSupplier,
  type AliasMap,
  type MatchTool,
} from "@/lib/cnc-tool-bill-match";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** A hand-written challan with twenty lines and adaptive thinking is
 *  not a two-second job, and Vercel kills the default at 15s. */
export const maxDuration = 120;

const MAX_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    supplier_name: {
      type: ["string", "null"],
      description: "The party who ISSUED the bill (the seller/shop), never MTCPL itself",
    },
    supplier_gstin: { type: ["string", "null"], description: "Seller's 15-character GSTIN if printed" },
    bill_no: { type: ["string", "null"], description: "Invoice / bill / challan number as printed" },
    bill_date: { type: ["string", "null"], description: "Bill date as YYYY-MM-DD" },
    amount_subtotal: { type: ["number", "null"], description: "Taxable value BEFORE GST" },
    amount_gst: { type: ["number", "null"], description: "Total GST in rupees (all components added)" },
    amount_total: { type: ["number", "null"], description: "Grand total INCLUDING GST" },
    items: {
      type: "array",
      description: "One entry per line on the bill, in printed order, including non-stock lines",
      items: {
        type: "object",
        properties: {
          text_as_printed: {
            type: "string",
            description:
              "The item description EXACTLY as printed, character for character, including part codes, sizes, dots, slashes and brackets. Do not tidy, expand or translate it.",
          },
          qty: { type: ["number", "null"], description: "Quantity on this line" },
          unit: { type: ["string", "null"], description: "Unit as printed (PCS, NOS, SET, KG...)" },
          rate: { type: ["number", "null"], description: "Rate per unit before GST" },
          amount: { type: ["number", "null"], description: "Line amount before GST" },
          hsn: { type: ["string", "null"], description: "HSN/SAC code if printed on the line" },
          is_tool: {
            type: "boolean",
            description:
              "True only if this line is a physical tool/consumable that goes on a shelf. False for freight, packing, loading, discount, round-off, GST lines, labour and any other charge.",
          },
          match_tool_id: {
            type: ["string", "null"],
            description:
              "The id of the catalogue tool this line IS, from the supplied list, if you are confident it is the same physical item written differently. null if it is not in the list or you are unsure. NEVER pick a tool whose size or dimension numbers differ from the line.",
          },
          match_reason: {
            type: ["string", "null"],
            description: "Six words at most on why it matches, e.g. 'same code, bill omits the dot'",
          },
          suggested_name: {
            type: ["string", "null"],
            description:
              "If this is a tool that is NOT in the catalogue, a clean short name to file it under (max 70 chars), keeping the part code and size",
          },
        },
        required: [
          "text_as_printed", "qty", "unit", "rate", "amount", "hsn",
          "is_tool", "match_tool_id", "match_reason", "suggested_name",
        ],
        additionalProperties: false,
      },
    },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    note: {
      type: ["string", "null"],
      description: "Anything the reviewer should know — page cut off, a column you could not read, totals that do not add up",
    },
  },
  required: [
    "supplier_name", "supplier_gstin", "bill_no", "bill_date",
    "amount_subtotal", "amount_gst", "amount_total", "items", "confidence", "note",
  ],
  additionalProperties: false,
} as const;

function buildPrompt(catalogue: MatchTool[]): string {
  const list = catalogue.length
    ? catalogue
        .map((t) => `- id=${t.id} | ${t.name}${t.spec ? ` | size/spec: ${t.spec}` : ""} | unit: ${t.unit}`)
        .join("\n")
    : "(the shelf is empty — every tool line will be a new item)";

  return `You are reading a supplier's bill for CNC tooling and hardware, delivered to a stone-carving plant in India (MATESHWARI TEMPLE CONSTRUCTION / MTCPL). The bill may be a printed tax invoice or a hand-written challan.

Extract the header and EVERY line on the bill.

THE ITEM TEXT IS EVIDENCE — COPY IT, DO NOT CLEAN IT
- text_as_printed must be the description exactly as it appears: every dot, slash, bracket, space and stray letter. "DSZ.10.4/40 160MM" stays "DSZ.10.4/40 160MM".
- This string is stored and used to recognise the same item on the supplier's next bill, so an improved version of it is worse than useless.
- Put your tidy version in suggested_name instead, when the line is a tool we do not already stock.

WHICH LINES ARE STOCK
- is_tool = true only for a physical thing that goes on a shelf: cutters, segments, bits, discs, wheels, blades, nozzles, collets, bearings, abrasives, consumables, spares.
- is_tool = false for freight, transport, packing, loading, labour, service, discount, round-off, and any tax or total line. Those must never become inventory.

MATCHING TO THE SHELF
Our catalogue, with ids:
${list}

- Set match_tool_id only when the line is the SAME PHYSICAL ITEM as a catalogue entry, written differently: different punctuation, spacing, case, a trailing MM, the brand in front, the size in brackets instead of after a dash.
- NEVER match across different numbers. A 150 is not a 160. A 10mm is not a 12mm. A 4-flute is not a 2-flute. If any size or dimension differs, match_tool_id must be null even when everything else is identical — a wrong match puts stock where nobody will find it.
- If the item is not in the list, set match_tool_id to null and give a suggested_name.
- Do not force a match because the list is short. An empty list, or a list with nothing like this line, means null.

DIGIT ACCURACY (critical — this becomes a stock count and a price record)
- Read every quantity, rate and amount DIGIT BY DIGIT, then look at the image again and re-verify each character.
- Hand-written digits are easily confused: 1 vs 4 vs 7, 0 vs 6, 5 vs 8, 3 vs 8. Judge by stroke shape; never substitute a similar-looking digit.
- Cross-check: qty × rate should equal the line amount, and the lines should add up to the subtotal. If they do not, re-read before answering.
- Quantity is the number of units received, not the pack size. If a line reads "5 BOX X 10 PCS", qty is 5 and unit is BOX.

CONFIDENCE
- "high" only for a clean printed bill read with no doubt at all.
- "medium" for any hand-written bill, however neat.
- "low" if the photo is blurry or cut off, or any digit or quantity is uncertain.
Use note to say what is wrong when it is not high.`;
}

type RawItem = {
  text_as_printed?: unknown;
  qty?: unknown;
  unit?: unknown;
  rate?: unknown;
  amount?: unknown;
  hsn?: unknown;
  is_tool?: unknown;
  match_tool_id?: unknown;
  match_reason?: unknown;
  suggested_name?: unknown;
};

const str = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s : null;
};
const nr = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

export async function POST(req: NextRequest) {
  try {
    return await handleScan(req);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[/api/tools/bill-scan] crashed", e);
    return NextResponse.json({ ok: false, error: `Scan failed: ${msg}` }, { status: 500 });
  }
}

async function handleScan(req: NextRequest) {
  const { profile } = await requireAuth();
  if (!canScanToolBills(profile)) {
    return NextResponse.json({ ok: false, error: "Not allowed." }, { status: 403 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { ok: false, error: "Bill scanning isn't configured — add ANTHROPIC_API_KEY in Vercel and redeploy." },
      { status: 503 },
    );
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ ok: false, error: "Attach a photo or PDF of the bill." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: "That file is over 10 MB — take a smaller photo." }, { status: 400 });
  }
  const mime = (file.type || "application/octet-stream").toLowerCase();
  const isPdf = mime === "application/pdf";
  if (!isPdf && !IMAGE_TYPES.has(mime)) {
    return NextResponse.json(
      { ok: false, error: "Use a JPG/PNG photo or a PDF." },
      { status: 400 },
    );
  }

  const admin = createAdminSupabaseClient();

  // The live shelf, for the model to match against and for us to score
  // its answers with. Archived tools are left out deliberately: putting
  // stock back into a tool somebody retired would quietly un-retire it.
  const { data: toolRows, error: tErr } = await admin
    .from("cnc_tools")
    .select("id, name, spec, unit")
    .eq("is_active", true)
    .order("display_order");
  if (tErr) return NextResponse.json({ ok: false, error: tErr.message }, { status: 500 });
  const catalogue = (toolRows ?? []) as MatchTool[];

  const data = Buffer.from(await file.arrayBuffer()).toString("base64");
  const fileBlock = isPdf
    ? ({ type: "document", source: { type: "base64", media_type: "application/pdf", data } } as const)
    : ({
        type: "image",
        source: {
          type: "base64",
          media_type: mime as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
          data,
        },
      } as const);

  const client = new Anthropic();
  const model = process.env.TOOL_BILL_SCAN_MODEL || "claude-opus-4-8";

  const response = await client.messages.create({
    model,
    max_tokens: 16000,
    // Adaptive thinking: the work here is re-reading a hand-written
    // column and then deciding whether two part numbers are the same
    // tool, and both get visibly better when it can think first.
    thinking: { type: "adaptive" },
    output_config: { format: { type: "json_schema", schema: EXTRACT_SCHEMA } },
    messages: [{ role: "user", content: [fileBlock, { type: "text", text: buildPrompt(catalogue) }] }],
  });

  if (response.stop_reason === "refusal") {
    return NextResponse.json(
      { ok: false, error: "The AI declined to read this document. Add the stock by hand." },
      { status: 422 },
    );
  }

  const text = response.content.find((b) => b.type === "text")?.text ?? "";
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Couldn't read the bill clearly — try a sharper, straighter photo." },
      { status: 422 },
    );
  }

  return finish(admin, catalogue, parsed, model, {
    input_tokens: response.usage?.input_tokens ?? null,
    output_tokens: response.usage?.output_tokens ?? null,
  });
}

/**
 * Turn a model reply into the reviewed-bill payload.
 *
 * Split out from handleScan because the matching, the alias lookup
 * and the duplicate check are the interesting half of this route and
 * have nothing to do with how the JSON was obtained.
 */
async function finish(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  catalogue: MatchTool[],
  parsed: Record<string, unknown>,
  model: string,
  usage: { input_tokens: number | null; output_tokens: number | null },
) {
  const supplierName = str(parsed.supplier_name);
  const supplierKey = normSupplier(supplierName ?? "");

  // What this supplier has been seen to call our tools before. Scoped to
  // the supplier: two shops using the same code for different things is
  // normal, and a global alias table would cross-contaminate them.
  const aliases: AliasMap = {};
  if (supplierKey) {
    const { data: codeRows } = await admin
      .from("cnc_tool_supplier_codes")
      .select("supplier_key, code_key, tool_id")
      .eq("supplier_key", supplierKey);
    for (const r of (codeRows ?? []) as Array<{ supplier_key: string; code_key: string; tool_id: string }>) {
      aliases[`${r.supplier_key}|${r.code_key}`] = r.tool_id;
    }
  }

  const rawItems = Array.isArray(parsed.items) ? (parsed.items as RawItem[]) : [];
  const lines = rawItems.map((it, i) => {
    const raw = str(it.text_as_printed) ?? "";
    const isTool = it.is_tool === true;
    const aiToolId = str(it.match_tool_id);

    // Non-stock lines are carried through so the bill reconciles on
    // screen — you can see the freight line and see that it was left
    // out — but they are never matched or posted.
    if (!isTool || !raw) {
      return {
        line_no: i + 1,
        raw_text: raw || "(blank line)",
        qty: nr(it.qty),
        unit: str(it.unit),
        rate: nr(it.rate),
        amount: nr(it.amount),
        hsn: str(it.hsn),
        is_tool: false,
        outcome: "skipped" as const,
        tool_id: null,
        score: 0,
        needs_confirm: false,
        alternatives: [] as Array<{ toolId: string; score: number }>,
        ai_tool_id: aiToolId,
        ai_reason: str(it.match_reason),
        suggested_name: null,
        suggested_unit: cleanUnit(str(it.unit)),
      };
    }

    const m = matchLine({ raw, tools: catalogue, aliases, supplierKey, aiToolId });

    return {
      line_no: i + 1,
      raw_text: raw,
      qty: nr(it.qty),
      unit: str(it.unit),
      rate: nr(it.rate),
      amount: nr(it.amount),
      hsn: str(it.hsn),
      is_tool: true,
      outcome: m.outcome,
      tool_id: m.toolId,
      score: Number(m.score.toFixed(4)),
      needs_confirm: m.needsConfirm,
      alternatives: m.alternatives,
      ai_tool_id: aiToolId,
      ai_reason: str(it.match_reason),
      // Only meaningful when nothing matched, but computed either way so
      // the reviewer can switch a line to "new" without a round trip.
      suggested_name: cleanToolName(raw, str(it.suggested_name)),
      suggested_unit: cleanUnit(str(it.unit)),
    };
  });

  // Has this exact bill already been posted? Cheaper to say so now than
  // to let the unique index refuse it after the reviewer has worked
  // through twenty lines.
  let duplicateOf: string | null = null;
  const billNo = str(parsed.bill_no);
  if (supplierName && billNo) {
    const { data: dup } = await admin
      .from("cnc_tool_bills")
      .select("id, created_at")
      .eq("status", "posted")
      .ilike("supplier_name", supplierName)
      .ilike("bill_no", billNo)
      .limit(1);
    if (dup && dup.length > 0) duplicateOf = (dup[0] as { id: string }).id;
  }

  return NextResponse.json({
    ok: true,
    data: {
      supplier_name: supplierName,
      supplier_gstin: str(parsed.supplier_gstin),
      bill_no: billNo,
      bill_date: str(parsed.bill_date),
      amount_subtotal: nr(parsed.amount_subtotal),
      amount_gst: nr(parsed.amount_gst),
      amount_total: nr(parsed.amount_total),
      confidence: str(parsed.confidence) ?? "low",
      note: str(parsed.note),
      lines,
      duplicate_of: duplicateOf,
      model,
      usage,
      // Kept verbatim and handed back so the post action can store it
      // without paying for a second read.
      raw: parsed,
    },
  });
}
