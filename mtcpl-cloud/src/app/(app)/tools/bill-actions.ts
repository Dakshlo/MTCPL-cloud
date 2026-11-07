"use server";

// ──────────────────────────────────────────────────────────────────
// Posting a scanned supplier bill to the shelf (mig 237)
// ──────────────────────────────────────────────────────────────────
//
// The scan route reads the paper and proposes. NOTHING it returns has
// touched the database. This is where a human's decisions become stock.
//
// ── Order of operations, and why ──────────────────────────────────
//
//   1. refuse a duplicate bill up front
//   2. insert the bill as a DRAFT
//   3. create whatever new tools were confirmed
//   4. one locked receive per line, through mig 235's RPC
//   5. write the lines, each pointing at its movement
//   6. flip the bill to POSTED
//   7. teach the alias table what the reviewer decided
//
// The draft-then-posted dance matters: the unique index that stops the
// same bill going in twice only applies to POSTED rows, so a failure
// halfway through leaves a draft that a person can see and finish,
// rather than a bill number burned by a crash.
//
// There is no transaction around steps 3–5, and that is deliberate for
// the same reason the rest of this module has no approval queue: the
// ledger is append-only and every line is individually undoable. If the
// seventh of twelve lines fails, six tools really did arrive and saying
// so is more useful than pretending none did. The result names exactly
// what went in and what did not.
//
// ── The alias table is the point ──────────────────────────────────
//
// Step 7 is what makes this get better instead of staying at 85%. Every
// line the reviewer confirmed is remembered against the supplier's own
// printed text, so the next bill from that shop is a lookup rather than
// a judgement — and the question is never asked twice.
// ──────────────────────────────────────────────────────────────────

import { randomBytes } from "node:crypto";

import { revalidatePath } from "next/cache";

import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { canScanToolBills } from "@/lib/cnc-tool-permissions";
import { moveRefusal, type MoveOutcome } from "@/lib/cnc-tool-stock";
import { normKey, normSupplier } from "@/lib/cnc-tool-bill-match";

export type BillActionResult =
  | { ok: true; message: string; billId: string; added: number; created: number; skipped: number; failed: string[] }
  | { ok: false; error: string };

/** The bucket the paper lives in (mig 237). Private, unlike tool photos. */
const BILL_BUCKET = "cnc_tool_bills";
const BILL_DOC_MIME = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf",
]);
const BILL_DOC_MAX = 10 * 1024 * 1024;

/** What the reviewer decided about one printed line. */
export type LineDecision = {
  line_no: number;
  raw_text: string;
  qty: number | null;
  unit: string | null;
  rate: number | null;
  amount: number | null;
  hsn: string | null;
  /** add = into an existing tool · create = make a new one · skip = not stock */
  action: "add" | "create" | "skip";
  tool_id: string | null;
  new_name: string | null;
  new_unit: string | null;
  /** How we arrived at the match, carried through for the record. */
  outcome: string | null;
  score: number | null;
  ai_tool_id: string | null;
  ai_reason: string | null;
  /** Remember this supplier's wording for next time. */
  learn: boolean;
};

export type BillHeader = {
  supplier_name: string | null;
  supplier_gstin: string | null;
  bill_no: string | null;
  bill_date: string | null;
  amount_subtotal: number | null;
  amount_gst: number | null;
  amount_total: number | null;
  confidence: string | null;
  note: string | null;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  raw: Record<string, unknown> | null;
};

const clampDate = (s: string | null): string | null => {
  if (!s) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

/**
 * Post a reviewed bill.
 *
 * FormData rather than a plain object because the original file comes
 * along with it: the scan route never stored it, so nothing is kept for
 * a bill somebody looked at and threw away.
 */
export async function postToolBillAction(fd: FormData): Promise<BillActionResult> {
  const { profile } = await requireAuth();
  if (!canScanToolBills(profile)) return { ok: false, error: "Not allowed." };

  let header: BillHeader;
  let decisions: LineDecision[];
  try {
    const payload = JSON.parse(String(fd.get("payload") ?? "{}")) as {
      bill?: BillHeader;
      lines?: LineDecision[];
    };
    if (!payload.bill || !Array.isArray(payload.lines)) throw new Error("missing");
    header = payload.bill;
    decisions = payload.lines;
  } catch {
    return { ok: false, error: "The review data did not arrive intact — scan the bill again." };
  }

  const postable = decisions.filter((d) => d.action !== "skip");
  if (postable.length === 0) {
    return { ok: false, error: "Nothing to post — every line is marked as not stock." };
  }

  // Quantities are checked here and not only on screen: a stale page
  // could post a line whose quantity was never read.
  for (const d of postable) {
    const q = Number(d.qty);
    if (!Number.isFinite(q) || q <= 0) {
      return { ok: false, error: `Line ${d.line_no} ("${d.raw_text}") has no quantity — fill it in or mark it not stock.` };
    }
    if (d.action === "add" && !d.tool_id) {
      return { ok: false, error: `Line ${d.line_no} has no tool chosen.` };
    }
    if (d.action === "create" && !(d.new_name || "").trim()) {
      return { ok: false, error: `Line ${d.line_no} needs a name for the new item.` };
    }
  }

  const admin = createAdminSupabaseClient();
  const supplierName = (header.supplier_name || "").trim() || null;
  const billNo = (header.bill_no || "").trim() || null;
  const supplierKey = normSupplier(supplierName ?? "");

  // ── 1. The same paper, twice ────────────────────────────────────
  if (supplierName && billNo) {
    const { data: dup } = await admin
      .from("cnc_tool_bills")
      .select("id, created_at")
      .eq("status", "posted")
      .ilike("supplier_name", supplierName)
      .ilike("bill_no", billNo)
      .limit(1);
    if (dup && dup.length > 0) {
      return {
        ok: false,
        error: `Bill ${billNo} from ${supplierName} has already been posted — that stock is on the shelf already.`,
      };
    }
  }

  // ── 2. The bill, as a draft ─────────────────────────────────────
  const { data: billRow, error: bErr } = await admin
    .from("cnc_tool_bills")
    .insert({
      supplier_name: supplierName,
      supplier_gstin: (header.supplier_gstin || "").trim() || null,
      bill_no: billNo,
      bill_date: clampDate(header.bill_date),
      amount_subtotal: header.amount_subtotal,
      amount_gst: header.amount_gst,
      amount_total: header.amount_total,
      scan_model: header.model,
      scan_confidence:
        header.confidence === "high" || header.confidence === "medium" || header.confidence === "low"
          ? header.confidence
          : null,
      scan_raw: header.raw ?? null,
      scan_input_tokens: header.input_tokens,
      scan_output_tokens: header.output_tokens,
      note: (header.note || "").trim() || null,
      status: "draft",
      created_by: profile.id,
    })
    .select("id")
    .maybeSingle();
  if (bErr) return { ok: false, error: `Could not save the bill: ${bErr.message}` };
  if (!billRow) return { ok: false, error: "Could not save the bill." };
  const billId = (billRow as { id: string }).id;

  // The paper itself. A failed upload must not cost the stock, so it is
  // best-effort and reported at the end rather than fatal.
  let docWarning: string | null = null;
  const file = fd.get("file");
  if (file instanceof File && file.size > 0) {
    const mime = (file.type || "").toLowerCase();
    if (!BILL_DOC_MIME.has(mime)) {
      docWarning = "the bill image was not a type we store";
    } else if (file.size > BILL_DOC_MAX) {
      docWarning = "the bill image was over 10 MB";
    } else {
      const ext = mime === "application/pdf" ? "pdf" : mime.split("/")[1] || "jpg";
      const path = `${billId}/${randomBytes(8).toString("hex")}.${ext}`;
      const { error: upErr } = await admin.storage
        .from(BILL_BUCKET)
        .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: mime, upsert: false });
      if (upErr) docWarning = `the bill image did not upload (${upErr.message})`;
      else {
        await admin
          .from("cnc_tool_bills")
          .update({ document_path: path, document_mime: mime, document_bytes: file.size })
          .eq("id", billId);
      }
    }
  }

  const noteFor = (): string => {
    const bits = [supplierName, billNo ? `bill ${billNo}` : null].filter(Boolean);
    return bits.length ? bits.join(" · ").slice(0, 180) : "Scanned bill";
  };
  const movementNote = noteFor();

  let added = 0;
  let created = 0;
  const failed: string[] = [];
  const learned: Array<{ toolId: string; raw: string }> = [];
  const lineRows: Array<Record<string, unknown>> = [];

  for (const d of decisions) {
    const qty = Number(d.qty);

    // Not stock. Recorded so the bill reconciles on screen — you can
    // see the freight line sitting there, left out on purpose.
    if (d.action === "skip") {
      lineRows.push({
        bill_id: billId, line_no: d.line_no, raw_text: d.raw_text,
        raw_qty: Number.isFinite(qty) ? qty : null, raw_unit: d.unit,
        rate: d.rate, amount: d.amount, hsn: d.hsn,
        tool_id: null, qty: null, outcome: "skipped",
        match_score: null, ai_tool_id: d.ai_tool_id, ai_note: d.ai_reason,
        decided_by: profile.id, decided_at: new Date().toISOString(),
      });
      continue;
    }

    // ── 3. A tool that does not exist yet ────────────────────────
    let toolId = d.tool_id;
    let madeTool = false;
    if (d.action === "create") {
      const name = (d.new_name || "").trim().slice(0, 80);
      const unit = (d.new_unit || "pcs").trim().slice(0, 16) || "pcs";
      const { data: newTool, error: cErr } = await admin
        .from("cnc_tools")
        .insert({ name, spec: null, unit, created_by: profile.id, updated_by: profile.id })
        .select("id")
        .maybeSingle();

      if (cErr) {
        // 23505 = the one-name-per-store index. Somebody added it while
        // this bill was being reviewed, or it was on the bill twice:
        // use the existing row rather than refusing the stock.
        if (cErr.code === "23505") {
          const { data: existing } = await admin
            .from("cnc_tools")
            .select("id")
            .ilike("name", name)
            .limit(1);
          if (existing && existing.length > 0) toolId = (existing[0] as { id: string }).id;
          else {
            failed.push(`${d.raw_text} — "${name}" already exists but could not be found`);
            continue;
          }
        } else {
          failed.push(`${d.raw_text} — ${cErr.message}`);
          continue;
        }
      } else if (newTool) {
        toolId = (newTool as { id: string }).id;
        madeTool = true;
        created += 1;
      } else {
        failed.push(`${d.raw_text} — could not create "${name}"`);
        continue;
      }
    }

    if (!toolId) {
      failed.push(`${d.raw_text} — no tool to add it to`);
      continue;
    }

    // ── 4. The stock, under mig 235's row lock ───────────────────
    const { data: raw, error: mErr } = await admin.rpc("cnc_tool_record_move", {
      p_tool_id: toolId,
      p_kind: "receive",
      p_delta: qty,
      p_note: movementNote,
      p_entered_by: profile.id,
    });
    if (mErr) {
      failed.push(`${d.raw_text} — ${mErr.message}`);
      continue;
    }
    const res = (raw ?? {}) as MoveOutcome;
    if (!res.ok) {
      failed.push(`${d.raw_text} — ${moveRefusal(res)}`);
      continue;
    }

    added += 1;
    if (d.learn !== false) learned.push({ toolId, raw: d.raw_text });

    lineRows.push({
      bill_id: billId, line_no: d.line_no, raw_text: d.raw_text,
      raw_qty: Number.isFinite(qty) ? qty : null, raw_unit: d.unit,
      rate: d.rate, amount: d.amount, hsn: d.hsn,
      tool_id: toolId, qty,
      outcome: madeTool ? "new" : d.outcome === "skipped" ? "manual" : (d.outcome ?? "manual"),
      match_score: d.score, ai_tool_id: d.ai_tool_id, ai_note: d.ai_reason,
      ai_suggested_name: d.action === "create" ? (d.new_name || "").trim() : null,
      created_tool: madeTool,
      movement_id: res.movement_id ?? null,
      decided_by: profile.id, decided_at: new Date().toISOString(),
    });
  }

  // ── 5. The lines ────────────────────────────────────────────────
  if (lineRows.length > 0) {
    const { error: lErr } = await admin.from("cnc_tool_bill_lines").insert(lineRows);
    // The stock is already in and undoable line by line; a lost line row
    // costs the paper trail, not the count. Say so rather than hiding it.
    if (lErr) failed.push(`the line record did not save (${lErr.message})`);
  }

  // ── 6. Posted ───────────────────────────────────────────────────
  const { error: pErr } = await admin
    .from("cnc_tool_bills")
    .update({ status: "posted", posted_at: new Date().toISOString(), posted_by: profile.id })
    .eq("id", billId);
  if (pErr) {
    failed.push(
      pErr.code === "23505"
        ? "another user posted this same bill a moment ago, so this one stayed a draft"
        : `the bill stayed a draft (${pErr.message})`,
    );
  }

  // ── 7. Teach the alias table ────────────────────────────────────
  //
  // One row per supplier + printed text. Upserted, so a second sighting
  // bumps the counter instead of failing, and a reviewer who changes
  // their mind later overwrites the old answer.
  if (supplierKey && learned.length > 0) {
    const seen = new Set<string>();
    const rows = learned
      .filter((l) => {
        const k = normKey(l.raw);
        if (!k || seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .map((l) => ({
        supplier_key: supplierKey,
        code_key: normKey(l.raw),
        tool_id: l.toolId,
        raw_sample: l.raw.slice(0, 200),
        last_seen_at: new Date().toISOString(),
        created_by: profile.id,
      }));
    if (rows.length > 0) {
      const { error: aErr } = await admin
        .from("cnc_tool_supplier_codes")
        .upsert(rows, { onConflict: "supplier_key,code_key" });
      // Purely an optimisation for next time. Never worth a failure.
      if (aErr) console.error("[tool bill] alias learn failed", aErr.message);
    }
  }

  const skipped = decisions.filter((d) => d.action === "skip").length;

  await logAudit(profile.id, "cnc_tool_bill_posted", "cnc_tool_bill", billId, {
    supplier: supplierName,
    bill_no: billNo,
    lines: decisions.length,
    added,
    created,
    skipped,
    failed: failed.length,
    model: header.model,
    confidence: header.confidence,
  });

  revalidatePath("/tools");

  const parts = [`${added} line${added === 1 ? "" : "s"} added to the shelf`];
  if (created > 0) parts.push(`${created} new item${created === 1 ? "" : "s"} created`);
  if (skipped > 0) parts.push(`${skipped} not stock`);
  if (docWarning) parts.push(docWarning);

  return {
    ok: true,
    message: parts.join(" · "),
    billId,
    added,
    created,
    skipped,
    failed,
  };
}

/**
 * A short-lived link to the paper.
 *
 * The bucket is private because these lines carry supplier rates, so
 * the file is only ever handed out as a signed URL to somebody who has
 * just passed the gate.
 */
export async function toolBillDocUrlAction(
  billId: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const { profile } = await requireAuth();
  if (!canScanToolBills(profile)) return { ok: false, error: "Not allowed." };

  const admin = createAdminSupabaseClient();
  const { data: row } = await admin
    .from("cnc_tool_bills")
    .select("document_path")
    .eq("id", billId)
    .maybeSingle();
  const path = (row as { document_path: string | null } | null)?.document_path;
  if (!path) return { ok: false, error: "No bill image was kept for this one." };

  const { data: signed, error } = await admin.storage
    .from(BILL_BUCKET)
    .createSignedUrl(path, 300);
  if (error || !signed?.signedUrl) {
    return { ok: false, error: error?.message ?? "Could not open the bill image." };
  }
  return { ok: true, url: signed.signedUrl };
}
