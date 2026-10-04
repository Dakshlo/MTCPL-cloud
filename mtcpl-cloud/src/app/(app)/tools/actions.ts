"use server";

// ──────────────────────────────────────────────────────────────────
// Migration 227 — CNC tool crib server actions
// ──────────────────────────────────────────────────────────────────
// Every write to cnc_tools / cnc_tool_movements goes through here.
// RLS on those tables is read-only for `authenticated`, so the admin
// client below is the only way in and these gates are the real door.
//
// THERE IS NO APPROVAL QUEUE, by design. The thing this replaces is a
// paper register: you take a bit, you write it down, you carry on. A
// pending state would make the software slower than the paper and the
// register would quietly go back to being paper. The protection is an
// append-only ledger plus a 10-minute undo, not a gate.
//
// Corrections after the undo window are RECORDED, never edited:
//   • took too many        → `return`
//   • it was never there   → `adjust`
//   • it broke             → `scrap`
// The wrong line stays visible with the right line underneath it, which
// is exactly how the paper register handles a mistake.
// ──────────────────────────────────────────────────────────────────

import { revalidatePath } from "next/cache";

import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { canManageCncToolCrib, canUseCncTools } from "@/lib/cnc-tool-permissions";
import {
  UNDO_WINDOW_MS,
  levelOf,
  lowLineOf,
  stockForTool,
  type ToolMovementKind,
} from "@/lib/cnc-tool-stock";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

const txt = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const num = (fd: FormData, k: string): number => {
  const raw = String(fd.get(k) ?? "").trim();
  if (!raw) return NaN;
  return Number(raw);
};

function refresh() {
  revalidatePath("/tools");
}

// ── Add a tool ────────────────────────────────────────────────────

/**
 * Create a catalogue entry, and optionally put stock in it in the same
 * breath.
 *
 * Daksh described two steps — "they will create that item and add stock
 * in that" — so the form does both. Making somebody create "450mm tool"
 * and then hunt for an Add-stock button to type 12 is the kind of
 * friction that sends people back to the register.
 */
export async function createToolAction(fd: FormData): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canManageCncToolCrib(profile)) return { ok: false, error: "Not allowed." };

  const vendorId = txt(fd, "vendor_id");
  const name = txt(fd, "name");
  const spec = txt(fd, "spec") || null;
  const unit = txt(fd, "unit") || "pcs";
  const lowRaw = txt(fd, "low_stock_qty");
  const opening = num(fd, "opening_qty");

  if (!vendorId) return { ok: false, error: "Pick a crib first." };
  if (!name) return { ok: false, error: "Give the tool a name." };
  if (name.length > 80) return { ok: false, error: "That name is too long." };

  let lowStock: number | null = null;
  if (lowRaw) {
    const n = Number(lowRaw);
    if (!Number.isFinite(n) || n < 0) return { ok: false, error: "The low-stock number looks wrong." };
    lowStock = n;
  }

  const admin = createAdminSupabaseClient();

  const { data: created, error } = await admin
    .from("cnc_tools")
    .insert({
      vendor_id: vendorId,
      name,
      spec,
      unit,
      low_stock_qty: lowStock,
      created_by: profile.id,
      updated_by: profile.id,
    })
    .select("id, name")
    .maybeSingle();

  // 23505 = the per-crib unique index. Worth naming the real cause: the
  // same tool existing in ANOTHER crib is fine, so "already exists" on
  // its own would read as a bug to someone who can see it isn't there.
  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: `"${name}" is already in this crib.` };
    }
    return { ok: false, error: error.message };
  }
  if (!created) return { ok: false, error: "Could not create the tool." };

  // Opening stock, if given, is a normal `receive` line — so a tool that
  // starts at 12 shows WHERE the 12 came from instead of appearing out
  // of nowhere above an empty register.
  if (Number.isFinite(opening) && opening > 0) {
    const { error: mErr } = await admin.from("cnc_tool_movements").insert({
      vendor_id: vendorId,
      tool_id: created.id,
      kind: "receive",
      delta: opening,
      note: "Opening stock",
      entered_by: profile.id,
    });
    if (mErr) {
      // The tool exists; only the stock line failed. Say so plainly
      // rather than implying nothing happened.
      return { ok: false, error: `Tool added, but the opening stock failed: ${mErr.message}` };
    }
  }

  await logAudit(profile.id, "cnc_tool_created", "cnc_tool", created.id, {
    vendor_id: vendorId,
    name,
    spec,
    opening_qty: Number.isFinite(opening) && opening > 0 ? opening : 0,
    low_stock_qty: lowStock,
  });

  refresh();
  return { ok: true, message: `${name} added.` };
}

// ── Edit / archive a tool ─────────────────────────────────────────

export async function updateToolAction(fd: FormData): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canManageCncToolCrib(profile)) return { ok: false, error: "Not allowed." };

  const toolId = txt(fd, "tool_id");
  if (!toolId) return { ok: false, error: "Missing tool." };

  const patch: Record<string, unknown> = { updated_by: profile.id };
  if (fd.has("name")) {
    const name = txt(fd, "name");
    if (!name) return { ok: false, error: "Give the tool a name." };
    patch.name = name;
  }
  if (fd.has("spec")) patch.spec = txt(fd, "spec") || null;
  if (fd.has("unit")) patch.unit = txt(fd, "unit") || "pcs";
  if (fd.has("low_stock_qty")) {
    const raw = txt(fd, "low_stock_qty");
    if (!raw) patch.low_stock_qty = null;
    else {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) return { ok: false, error: "The low-stock number looks wrong." };
      patch.low_stock_qty = n;
      // A new line means the old milestone is meaningless — clear it so
      // the next warning fires against the number actually in force.
      patch.low_alert_level = null;
    }
  }
  if (fd.has("is_active")) patch.is_active = txt(fd, "is_active") === "1";

  const admin = createAdminSupabaseClient();
  const { error } = await admin.from("cnc_tools").update(patch).eq("id", toolId);
  if (error) {
    if (error.code === "23505") return { ok: false, error: "Another tool in this crib already has that name." };
    return { ok: false, error: error.message };
  }

  await logAudit(profile.id, "cnc_tool_updated", "cnc_tool", toolId, patch);
  refresh();
  return { ok: true, message: "Saved." };
}

// ── Record a movement ─────────────────────────────────────────────

/**
 * The action behind every button on the crib: take out, return, add
 * stock, scrap, fix the count.
 *
 * `qty` is always entered POSITIVE — nobody types a minus sign on a
 * workshop phone. The sign comes from the kind, and mig 227's CHECK
 * constraint refuses the row if the two disagree, so a bug here cannot
 * silently add stock on a "take out".
 */
export async function recordMovementAction(fd: FormData): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canUseCncTools(profile)) return { ok: false, error: "Not allowed." };

  const vendorId = txt(fd, "vendor_id");
  const toolId = txt(fd, "tool_id");
  const kind = txt(fd, "kind") as ToolMovementKind;
  const takenBy = txt(fd, "taken_by");
  const note = txt(fd, "note") || null;
  const qty = num(fd, "qty");
  // `adjust` is the only one that may go either way, so it carries its
  // own direction instead of a signed quantity.
  const down = txt(fd, "direction") === "down";

  if (!vendorId || !toolId) return { ok: false, error: "Missing tool." };
  if (!["receive", "issue", "return", "scrap", "adjust"].includes(kind)) {
    return { ok: false, error: "Unknown movement." };
  }
  if (!Number.isFinite(qty) || qty <= 0) return { ok: false, error: "Enter how many." };

  // scrap and adjust are the two that can hide a loss, so they stay
  // behind the manage gate even though taking and returning are open.
  if ((kind === "scrap" || kind === "adjust") && !canManageCncToolCrib(profile)) {
    return { ok: false, error: "Only a manager can scrap or fix the count." };
  }
  if (kind === "issue" && !takenBy) {
    return { ok: false, error: "Write who is taking it — that is the whole point of the register." };
  }

  const delta =
    kind === "receive" || kind === "return" ? qty
      : kind === "issue" || kind === "scrap" ? -qty
        : down ? -qty : qty;

  const admin = createAdminSupabaseClient();

  // Read the tool fresh. Two phones can be on the same crib, and the
  // page's copy of the stock may be a minute old.
  const { data: toolRow } = await admin
    .from("cnc_tools")
    .select("id, vendor_id, name, unit, low_stock_qty, low_alert_level, is_active")
    .eq("id", toolId)
    .maybeSingle();
  if (!toolRow) return { ok: false, error: "That tool is gone." };
  const tool = toolRow as {
    id: string; vendor_id: string; name: string; unit: string;
    low_stock_qty: number | null; low_alert_level: number | null; is_active: boolean;
  };
  if (tool.vendor_id !== vendorId) return { ok: false, error: "That tool belongs to another crib." };
  if (!tool.is_active) return { ok: false, error: "That tool has been archived." };

  const before = await stockForTool(toolId);

  // Going negative means the register and the shelf already disagree.
  // Refusing is the honest answer: "fix the count" exists for exactly
  // this, and it leaves a line explaining the correction.
  if (delta < 0 && before + delta < 0) {
    return {
      ok: false,
      error:
        `Only ${before} ${tool.unit} of ${tool.name} are on the books. ` +
        `Use Fix count if the shelf says different.`,
    };
  }

  const { data: inserted, error } = await admin
    .from("cnc_tool_movements")
    .insert({
      vendor_id: vendorId,
      tool_id: toolId,
      kind,
      delta,
      taken_by: kind === "issue" || kind === "return" ? takenBy || null : null,
      note,
      entered_by: profile.id,
    })
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };

  const after = before + delta;

  await logAudit(profile.id, `cnc_tool_${kind}`, "cnc_tool", toolId, {
    vendor_id: vendorId,
    tool: tool.name,
    qty,
    delta,
    taken_by: takenBy || null,
    stock_before: before,
    stock_after: after,
    movement_id: inserted?.id ?? null,
  });

  await maybeWarnLowStock(tool, before, after, profile.id);

  refresh();

  const lowLine = lowLineOf(tool);
  const level = levelOf(after, lowLine);
  const tail =
    level === "out" ? ` — ${tool.name} is now EMPTY.`
      : level === "low" ? ` — only ${after} ${tool.unit} left.`
        : "";
  return { ok: true, message: `${after} ${tool.unit} left${tail ? tail.replace(` — `, ` · `) : ""}` };
}

// ── Undo ──────────────────────────────────────────────────────────

/**
 * Take back a line within ten minutes.
 *
 * It is a SOFT void: `undone_at` is stamped, the row stays in the
 * register struck through, and it stops counting. A register you can
 * silently erase is worth less than the paper one.
 *
 * The window is checked HERE, not just in the UI — a stale page could
 * still be showing the button an hour later.
 */
export async function undoMovementAction(fd: FormData): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canUseCncTools(profile)) return { ok: false, error: "Not allowed." };

  const id = txt(fd, "movement_id");
  if (!id) return { ok: false, error: "Missing entry." };

  const admin = createAdminSupabaseClient();
  const { data: row } = await admin
    .from("cnc_tool_movements")
    .select("id, tool_id, kind, delta, taken_by, created_at, undone_at, entered_by")
    .eq("id", id)
    .maybeSingle();
  if (!row) return { ok: false, error: "That entry is gone." };
  const m = row as {
    id: string; tool_id: string; kind: string; delta: number;
    taken_by: string | null; created_at: string; undone_at: string | null; entered_by: string | null;
  };

  if (m.undone_at) return { ok: false, error: "That entry was already undone." };
  const age = Date.now() - new Date(m.created_at).getTime();
  if (age > UNDO_WINDOW_MS) {
    return {
      ok: false,
      error: "The 10-minute undo window has passed. Record a Return or Fix count instead.",
    };
  }

  const { error } = await admin
    .from("cnc_tool_movements")
    .update({ undone_at: new Date().toISOString(), undone_by: profile.id })
    .eq("id", id)
    .is("undone_at", null); // race guard: two taps, one undo
  if (error) return { ok: false, error: error.message };

  await logAudit(profile.id, "cnc_tool_movement_undone", "cnc_tool", m.tool_id, {
    movement_id: id,
    kind: m.kind,
    delta: m.delta,
    taken_by: m.taken_by,
    age_seconds: Math.round(age / 1000),
  });

  refresh();
  return { ok: true, message: "Undone." };
}

// ── Low-stock warning ─────────────────────────────────────────────

/**
 * Notify once when a tool crosses its line, then again on each further
 * step down — never on every issue.
 *
 * Same milestone shape as the carving-backlog alert. Without it, a crib
 * sitting one below its line would fire a notification every single
 * time somebody took anything, and people stop reading notifications
 * that cry wolf. `low_alert_level` stores the stock at the last warning;
 * climbing back above the line clears it so the next fall warns again.
 *
 * Never throws: a failed notification must not fail the movement the
 * operator just recorded.
 */
async function maybeWarnLowStock(
  tool: { id: string; name: string; unit: string; low_stock_qty: number | null; low_alert_level: number | null },
  before: number,
  after: number,
  actorId: string,
): Promise<void> {
  try {
    const admin = createAdminSupabaseClient();
    const line = lowLineOf(tool);
    const last = tool.low_alert_level == null ? null : Number(tool.low_alert_level);

    // Back above the line — forget the last warning so the next fall is
    // treated as fresh news.
    if (after > line) {
      if (last != null) {
        await admin.from("cnc_tools").update({ low_alert_level: null }).eq("id", tool.id);
      }
      return;
    }

    // At or below the line. Warn on the first crossing, and thereafter
    // only when it has actually fallen further than when we last spoke.
    const firstCrossing = last == null;
    const fellFurther = last != null && after < last;
    if (!firstCrossing && !fellFurther) return;

    await admin.from("cnc_tools").update({ low_alert_level: after }).eq("id", tool.id);

    const outNow = after <= 0;
    await notify(
      outNow ? "cnc_tool_out_of_stock" : "cnc_tool_low_stock",
      outNow ? `${tool.name} is finished` : `${tool.name} is running low`,
      {
        message: outNow
          ? `No ${tool.name} left in the crib.`
          : `${after} ${tool.unit} left (warn at ${line}). Was ${before}.`,
        entityType: "cnc_tool",
        entityId: tool.id,
        actorId,
        targetRoles: ["developer"], // v1 is developer-only; widens with the module
      },
    );
  } catch {
    // A warning that fails must never cost the operator their entry.
  }
}
