// ──────────────────────────────────────────────────────────────────
// The shape of a scanned tool bill (mig 237).
//
// Lives apart from /api/tools/bill-scan because a Next route module is
// only allowed to export its handlers and a few config fields, and
// because three places need these types: the route that produces them,
// the sheet that reviews them, and the action that posts them.
// ──────────────────────────────────────────────────────────────────

/** The shape the review sheet and the post action both work from. */
export type ScannedLine = {
  line_no: number;
  raw_text: string;
  qty: number | null;
  unit: string | null;
  rate: number | null;
  amount: number | null;
  hsn: string | null;
  is_tool: boolean;
  outcome: "alias" | "exact" | "fuzzy" | "ai" | "new" | "skipped";
  tool_id: string | null;
  score: number;
  needs_confirm: boolean;
  alternatives: Array<{ toolId: string; score: number }>;
  ai_tool_id: string | null;
  ai_reason: string | null;
  suggested_name: string | null;
  suggested_unit: string;
};

export type ScannedBill = {
  supplier_name: string | null;
  supplier_gstin: string | null;
  bill_no: string | null;
  bill_date: string | null;
  amount_subtotal: number | null;
  amount_gst: number | null;
  amount_total: number | null;
  confidence: string;
  note: string | null;
  lines: ScannedLine[];
  duplicate_of: string | null;
  model: string;
  usage: { input_tokens: number | null; output_tokens: number | null };
  raw: Record<string, unknown>;
};
