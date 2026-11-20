// ──────────────────────────────────────────────────────────────────
// /tools/bills — every bill that has been scanned (mig 237)
// ──────────────────────────────────────────────────────────────────
//
// Daksh, Nov 2026: "we need a place so we can see all scanned bills."
//
// Until now a bill existed for about ninety seconds. You scanned it,
// checked the lines, pressed the yes, and it was gone — the stock was
// on the shelf and the paper was in a private bucket that nothing
// linked to. Everything was kept (mig 237 keeps the file, the model's
// whole reply, the rate on every line and how each line was matched);
// there was simply no screen that would show you any of it.
//
// That matters for three questions that get asked for real:
//
//   was this bill already put in?   — the posted list answers it in
//                                     one look, which is cheaper than
//                                     finding out by the unique index
//                                     refusing a duplicate
//   what did we pay for this last   — the rate is on the line, and
//   time?                             /tools/usage already costs
//                                     consumption from it
//   why did it think that was that  — outcome + score + what the AI
//   tool?                             said, kept per line
//
// Drafts and discards are here too, deliberately. A scan that was
// started and abandoned is the most likely thing to be scanned twice,
// and a bill somebody threw away for a reason should be findable when
// the same paper turns up again.
//
// Gated on canScanToolBills, same as the scan itself: these lines carry
// supplier rates, which is also why the paper is in a private bucket
// and only ever handed out as a short-lived signed URL.
// ──────────────────────────────────────────────────────────────────

import { redirect } from "next/navigation";

import { requireAuth } from "@/lib/auth";
import { canScanToolBills } from "@/lib/cnc-tool-permissions";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

import { BillsClient, type BillCard, type BillLineRow } from "./bills-client";

export const dynamic = "force-dynamic";

/** How many bills the screen carries. A busy year is a few hundred, so
 *  this is years of paper and still one query. */
const MAX_BILLS = 400;

type BillRow = {
  id: string;
  supplier_name: string | null;
  supplier_gstin: string | null;
  bill_no: string | null;
  bill_date: string | null;
  amount_subtotal: number | string | null;
  amount_gst: number | string | null;
  amount_total: number | string | null;
  document_path: string | null;
  scan_model: string | null;
  scan_confidence: string | null;
  status: string;
  note: string | null;
  posted_at: string | null;
  discarded_at: string | null;
  created_at: string;
};

type LineRow = {
  id: string;
  bill_id: string;
  line_no: number;
  raw_text: string;
  raw_qty: number | string | null;
  raw_unit: string | null;
  rate: number | string | null;
  amount: number | string | null;
  hsn: string | null;
  tool_id: string | null;
  qty: number | string | null;
  outcome: string | null;
  created_tool: boolean;
  ai_note: string | null;
};

const num = (v: number | string | null): number | null =>
  v === null || v === "" ? null : Number(v);

export default async function ToolBillsPage() {
  const { profile } = await requireAuth();
  if (!canScanToolBills(profile)) redirect("/tools");

  const admin = createAdminSupabaseClient();

  const { data: billRows } = await admin
    .from("cnc_tool_bills")
    .select(
      "id, supplier_name, supplier_gstin, bill_no, bill_date, amount_subtotal, amount_gst, amount_total, document_path, scan_model, scan_confidence, status, note, posted_at, discarded_at, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(MAX_BILLS);

  const bills = (billRows ?? []) as BillRow[];

  // The lines for exactly the bills on screen. Fetched in one go rather
  // than per card: a bill opening should not cost a round trip when the
  // whole set is a few hundred rows.
  const { data: lineRows } = bills.length
    ? await admin
        .from("cnc_tool_bill_lines")
        .select(
          "id, bill_id, line_no, raw_text, raw_qty, raw_unit, rate, amount, hsn, tool_id, qty, outcome, created_tool, ai_note",
        )
        .in("bill_id", bills.map((b) => b.id))
        .order("bill_id")
        .order("line_no")
    : { data: [] };

  const lines = (lineRows ?? []) as LineRow[];

  // Tool names for the matched lines. A tool archived since the bill
  // was posted still has a row, so this keeps naming it rather than
  // leaving the line looking unmatched.
  const toolIds = [...new Set(lines.map((l) => l.tool_id).filter(Boolean))] as string[];
  const toolName = new Map<string, string>();
  if (toolIds.length > 0) {
    const { data: toolRows } = await admin
      .from("cnc_tools")
      .select("id, name")
      .in("id", toolIds);
    for (const t of (toolRows ?? []) as Array<{ id: string; name: string }>) {
      toolName.set(t.id, t.name);
    }
  }

  const byBill = new Map<string, BillLineRow[]>();
  for (const l of lines) {
    const list = byBill.get(l.bill_id) ?? [];
    list.push({
      id: l.id,
      lineNo: l.line_no,
      rawText: l.raw_text,
      rawQty: num(l.raw_qty),
      rawUnit: l.raw_unit,
      rate: num(l.rate),
      amount: num(l.amount),
      hsn: l.hsn,
      toolName: l.tool_id ? toolName.get(l.tool_id) ?? "a tool since removed" : null,
      qty: num(l.qty),
      outcome: l.outcome,
      createdTool: l.created_tool,
      aiNote: l.ai_note,
    });
    byBill.set(l.bill_id, list);
  }

  const cards: BillCard[] = bills.map((b) => {
    const ls = byBill.get(b.id) ?? [];
    return {
      id: b.id,
      supplier: b.supplier_name,
      gstin: b.supplier_gstin,
      billNo: b.bill_no,
      billDate: b.bill_date,
      subtotal: num(b.amount_subtotal),
      gst: num(b.amount_gst),
      total: num(b.amount_total),
      hasDoc: !!b.document_path,
      model: b.scan_model,
      confidence: b.scan_confidence,
      status: b.status === "posted" || b.status === "discarded" ? b.status : "draft",
      note: b.note,
      at: b.posted_at ?? b.discarded_at ?? b.created_at,
      scannedAt: b.created_at,
      lines: ls,
      // Counted here, on the server, so the card head and the opened
      // list can never disagree about how many went in.
      posted: ls.filter((l) => l.toolName && l.outcome !== "skipped").length,
      skipped: ls.filter((l) => l.outcome === "skipped").length,
    };
  });

  return <BillsClient bills={cards} />;
}
