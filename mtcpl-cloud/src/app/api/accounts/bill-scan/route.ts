// ──────────────────────────────────────────────────────────────────
// /api/accounts/bill-scan — AI bill extraction (Daksh, June 2026)
//
// The accountant photographs / uploads a vendor bill on the Add Bill
// page; this route sends it to Claude (vision) and returns the fields
// as structured JSON so the form can PRE-FILL. Strictly read-only:
// it never writes to the database — the accountant reviews the
// pre-filled form and saves through the existing submit flow, exactly
// as with manual entry. Manual entry is untouched; this is optional.
//
// Auth: same audience as bill creation (canSubmitBills).
// Env: ANTHROPIC_API_KEY (required), BILL_SCAN_MODEL (optional —
//      defaults to claude-sonnet-4-6 per the cost plan Daksh approved;
//      ~₹1.3 per scan).
// ──────────────────────────────────────────────────────────────────

import { NextResponse, type NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { requireAuth } from "@/lib/auth";
import { canSubmitBills } from "@/lib/accounts-permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

// What we ask Claude to read off the bill. The schema keeps the reply
// machine-parseable; every field is nullable so a partial read still
// pre-fills what it could see.
const EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    vendor_name: { type: ["string", "null"], description: "The party who ISSUED the bill (the seller), not the buyer" },
    vendor_gstin: { type: ["string", "null"], description: "Seller's 15-character GSTIN, if printed" },
    bill_no: { type: ["string", "null"], description: "Invoice / bill number as printed" },
    bill_date: { type: ["string", "null"], description: "Bill date in YYYY-MM-DD" },
    description: { type: ["string", "null"], description: "Description of the goods/services billed — capture as fully as the bill shows. If there are multiple line items, list them (comma or newline separated). Aim to include everything printed in the item/particulars section; up to ~60 words." },
    subtotal: { type: ["number", "null"], description: "Taxable value BEFORE GST" },
    cgst_percent: { type: ["number", "null"], description: "CGST rate percent (e.g. 9), null if not a CGST/SGST bill" },
    sgst_percent: { type: ["number", "null"], description: "SGST rate percent (e.g. 9), null if not a CGST/SGST bill" },
    igst_percent: { type: ["number", "null"], description: "IGST rate percent (e.g. 18), null if not an IGST bill" },
    total: { type: ["number", "null"], description: "Grand total / invoice value INCLUDING GST" },
    confidence: { type: "string", enum: ["high", "medium", "low"], description: "Your overall confidence in the extraction" },
  },
  required: [
    "vendor_name", "vendor_gstin", "bill_no", "bill_date", "description",
    "subtotal", "cgst_percent", "sgst_percent", "igst_percent", "total", "confidence",
  ],
  additionalProperties: false,
} as const;

const PROMPT = `Read this Indian vendor bill / tax invoice and extract the fields.

Rules:
- vendor_name is the SELLER (who issued the bill to MATESHWARI TEMPLE CONSTRUCTION / MTCPL), never MTCPL itself.
- Amounts are numbers without currency symbols or thousands separators.
- subtotal is the taxable value BEFORE GST; total is the final amount INCLUDING GST.
- GST: report the printed RATES (percent), not the rupee amounts. A bill has either CGST+SGST (intra-state) or IGST (inter-state), not both.
- If the bill shows multiple line items, subtotal/total are the bill-level figures; description should capture the item/particulars text as fully as printed (list every line item — do not over-shorten to just a few words).
- Use null for anything you cannot read confidently. Do not guess digits.

DIGIT ACCURACY (critical — this feeds accounting records):
- Read the bill number and every amount DIGIT BY DIGIT, then look at the image a second time and re-verify each character before answering.
- Handwritten digits are easily confused: 1 vs 4 vs 7 (a 4 has a closed/angled top, a 1 is a single stroke), 0 vs 6, 5 vs 8, 3 vs 8. Zoom into stroke shapes; never substitute a similar-looking digit.
- Cross-check the amounts against each other: subtotal + GST must equal total. If your readings don't add up, one digit is wrong — re-read all three before answering.
- If ANY character of bill_no or any amount is still uncertain after re-checking, keep your best reading but set confidence to "low".

Confidence:
- "high" only for clean printed bills you read with zero doubt.
- "medium" for any handwritten bill, even a neat one.
- "low" if the photo is blurry, cut off, or any digit is uncertain.`;

export async function POST(req: NextRequest) {
  try {
    return await handleScan(req);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[/api/accounts/bill-scan] crashed", e);
    return NextResponse.json({ ok: false, error: `Scan failed: ${msg}` }, { status: 500 });
  }
}

async function handleScan(req: NextRequest) {
  const { profile } = await requireAuth();
  if (!canSubmitBills(profile)) {
    return NextResponse.json({ ok: false, error: "Not allowed." }, { status: 403 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { ok: false, error: "AI scan isn't configured yet — add ANTHROPIC_API_KEY in Vercel and redeploy." },
      { status: 503 },
    );
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ ok: false, error: "Attach a photo or PDF of the bill." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: "File too large — max 10 MB." }, { status: 400 });
  }
  const mime = file.type || "application/octet-stream";
  const isPdf = mime === "application/pdf";
  if (!isPdf && !IMAGE_TYPES.has(mime)) {
    return NextResponse.json(
      { ok: false, error: "Unsupported file type — use a JPG/PNG photo or a PDF." },
      { status: 400 },
    );
  }

  const data = Buffer.from(await file.arrayBuffer()).toString("base64");
  const fileBlock = isPdf
    ? ({ type: "document", source: { type: "base64", media_type: "application/pdf", data } } as const)
    : ({
        type: "image",
        source: { type: "base64", media_type: mime as "image/jpeg" | "image/png" | "image/webp" | "image/gif", data },
      } as const);

  const client = new Anthropic();
  const model = process.env.BILL_SCAN_MODEL || "claude-sonnet-4-6";

  const response = await client.messages.create({
    model,
    max_tokens: 8000,
    // Adaptive thinking — lets the model reason carefully over handwritten
    // digits (the 4-vs-1 class of misreads) before committing to an answer.
    thinking: { type: "adaptive" },
    output_config: { format: { type: "json_schema", schema: EXTRACT_SCHEMA } },
    messages: [
      {
        role: "user",
        content: [fileBlock, { type: "text", text: PROMPT }],
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    return NextResponse.json(
      { ok: false, error: "The AI couldn't process this document. Enter the bill manually." },
      { status: 422 },
    );
  }

  const text = response.content.find((b) => b.type === "text")?.text ?? "";
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Couldn't read the bill clearly — try a sharper photo, or enter it manually." },
      { status: 422 },
    );
  }

  return NextResponse.json({ ok: true, data: parsed });
}
