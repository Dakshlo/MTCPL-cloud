"use server";

// ──────────────────────────────────────────────────────────────────
// Migrations 227 + 228 — CNC tool store server actions
// ──────────────────────────────────────────────────────────────────
// Every write to cnc_tools / cnc_tool_movements goes through here.
//
// ONE STORE. A tool belongs to the plant, not to a vendor, and every
// CNC vendor draws from the same shelf. `vendor_id` on a movement says
// WHO IT WAS FOR — required on issue/return, NULL on receive/scrap/
// adjust, and the database enforces that shape (mig 228).
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

import { randomBytes } from "node:crypto";

import { revalidatePath } from "next/cache";

import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import {
  canManageCncToolStore,
  canUseCncTools,
  takingVendorFor,
} from "@/lib/cnc-tool-permissions";
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
  if (!canManageCncToolStore(profile)) return { ok: false, error: "Not allowed." };

  const name = txt(fd, "name");
  const spec = txt(fd, "spec") || null;
  const unit = txt(fd, "unit") || "pcs";
  const lowRaw = txt(fd, "low_stock_qty");
  const opening = num(fd, "opening_qty");

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
      name,
      spec,
      unit,
      low_stock_qty: lowStock,
      created_by: profile.id,
      updated_by: profile.id,
    })
    .select("id, name")
    .maybeSingle();

  // 23505 = the one-name-per-store unique index.
  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: `"${name}" is already in the store.` };
    }
    return { ok: false, error: error.message };
  }
  if (!created) return { ok: false, error: "Could not create the tool." };

  // Opening stock, if given, is a normal `receive` line — so a tool that
  // starts at 12 shows WHERE the 12 came from instead of appearing out
  // of nowhere above an empty register.
  if (Number.isFinite(opening) && opening > 0) {
    const { error: mErr } = await admin.from("cnc_tool_movements").insert({
      vendor_id: null, // stock arriving on the shelf belongs to the store
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
  if (!canManageCncToolStore(profile)) return { ok: false, error: "Not allowed." };

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
    if (error.code === "23505") return { ok: false, error: "Another tool in the store already has that name." };
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

  const requestedVendor = txt(fd, "vendor_id") || null;
  const toolId = txt(fd, "tool_id");
  const kind = txt(fd, "kind") as ToolMovementKind;
  const takenBy = txt(fd, "taken_by");
  const note = txt(fd, "note") || null;
  const qty = num(fd, "qty");
  // `adjust` is the only one that may go either way, so it carries its
  // own direction instead of a signed quantity.
  const down = txt(fd, "direction") === "down";

  if (!toolId) return { ok: false, error: "Missing tool." };
  if (!["receive", "issue", "return", "scrap", "adjust"].includes(kind)) {
    return { ok: false, error: "Unknown movement." };
  }
  if (!Number.isFinite(qty) || qty <= 0) return { ok: false, error: "Enter how many." };

  // scrap and adjust are the two that can hide a loss, so they stay
  // behind the manage gate even though taking and returning are open.
  if ((kind === "scrap" || kind === "adjust") && !canManageCncToolStore(profile)) {
    return { ok: false, error: "Only a manager can scrap or fix the count." };
  }
  if (kind === "issue" && !takenBy) {
    return { ok: false, error: "Write who is taking it — that is the whole point of the register." };
  }

  // A take leaves the store FOR somebody, so it must name a vendor; the
  // store's own lines (stock in, scrap, count fix) must not pretend to.
  // Mig 228's CHECK enforces the same shape, so a tampered form cannot
  // slip past this.
  const needsVendor = kind === "issue" || kind === "return";
  const vendorId = needsVendor ? takingVendorFor(profile, requestedVendor) : null;
  if (needsVendor && !vendorId) {
    return { ok: false, error: "Pick which vendor is taking it." };
  }

  const delta =
    kind === "receive" || kind === "return" ? qty
      : kind === "issue" || kind === "scrap" ? -qty
        : down ? -qty : qty;

  const admin = createAdminSupabaseClient();

  // Read the tool fresh. Several phones can be on the same store, and
  // the page's copy of the stock may be a minute old.
  const { data: toolRow } = await admin
    .from("cnc_tools")
    .select("id, name, unit, low_stock_qty, low_alert_level, is_active")
    .eq("id", toolId)
    .maybeSingle();
  if (!toolRow) return { ok: false, error: "That tool is gone." };
  const tool = toolRow as {
    id: string; name: string; unit: string;
    low_stock_qty: number | null; low_alert_level: number | null; is_active: boolean;
  };
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

// ──────────────────────────────────────────────────────────────────
// The wardrobe QR (mig 229)
// ──────────────────────────────────────────────────────────────────
// A sticker that opens the take screen with no login. Creating and
// revoking one is a store-management act — the same gate as adding a
// tool — because whoever holds the sticker can write to the register.

/** Create a sticker. There is normally one (the office wardrobe), but
 *  more than one is allowed: a second shed gets its own, and the
 *  register then says which door a take came through. */
export async function createToolStoreLinkAction(fd: FormData): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canManageCncToolStore(profile)) return { ok: false, error: "Not allowed." };

  const label = txt(fd, "label").slice(0, 60) || "Office wardrobe";
  const capRaw = Number(fd.get("daily_cap"));
  const dailyCap = Number.isFinite(capRaw) && capRaw >= 10 && capRaw <= 2000 ? Math.round(capRaw) : 200;

  // 32 URL-safe characters. Long enough that guessing is pointless, short
  // enough that the QR stays coarse and scans off a printed sticker.
  const token = randomBytes(24).toString("base64url");

  const admin = createAdminSupabaseClient();
  const { error } = await admin.from("cnc_tool_store_links").insert({
    token,
    label,
    daily_cap: dailyCap,
    created_by: profile.id,
  });
  if (error) return { ok: false, error: error.message };

  await logAudit(profile.id, "cnc_tool_qr_created", "cnc_tool_store_link", token, {
    label,
    daily_cap: dailyCap,
  });
  revalidatePath("/tools/qr");
  return { ok: true, message: `“${label}” QR created.` };
}

/** Switch a sticker off. Nothing is deleted: takes already recorded
 *  through it keep pointing at it, so the register still explains where
 *  they came from. */
export async function revokeToolStoreLinkAction(fd: FormData): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canManageCncToolStore(profile)) return { ok: false, error: "Not allowed." };

  const id = txt(fd, "link_id");
  if (!id) return { ok: false, error: "Which QR?" };

  const admin = createAdminSupabaseClient();
  const { error } = await admin
    .from("cnc_tool_store_links")
    .update({ is_active: false, revoked_at: new Date().toISOString(), revoked_by: profile.id })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  await logAudit(profile.id, "cnc_tool_qr_revoked", "cnc_tool_store_link", id, {});
  revalidatePath("/tools/qr");
  return { ok: true, message: "QR switched off. Print a new one before taking the sticker down." };
}

// ──────────────────────────────────────────────────────────────────
// Typing the paper register in (mig 231)
// ──────────────────────────────────────────────────────────────────
// Each vendor keeps their own register, so a page belongs to one
// vendor and the typist picks that once. Every line is a take; nothing
// else can come in through this door, and the database enforces it.

export type RegisterLineInput = {
  /** The date on the register LINE (yyyy-mm-dd). */
  date: string;
  /** Who signed for it on the paper. */
  person: string;
  toolId: string;
  qty: number;
};

export type SaveRegisterResult =
  | { ok: true; batchId: string; lines: number }
  | { ok: false; error: string; rowErrors?: Array<{ row: number; message: string }> };

/** Save one page of one vendor's register as a single batch. Either
 *  every line goes in or none does — a half-entered page is worse than
 *  an un-entered one, because nobody can tell which half is missing. */
export async function saveToolRegisterPageAction(fd: FormData): Promise<SaveRegisterResult> {
  const { profile } = await requireAuth();
  if (!canUseCncTools(profile)) return { ok: false, error: "Not allowed." };

  const vendorId = takingVendorFor(profile, txt(fd, "vendor_id"));
  if (!vendorId) return { ok: false, error: "Pick whose register this is." };

  const registerDate = txt(fd, "register_date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(registerDate)) {
    return { ok: false, error: "Enter the date written on the register page." };
  }

  let lines: RegisterLineInput[] = [];
  try {
    const parsed = JSON.parse(txt(fd, "lines") || "[]");
    if (Array.isArray(parsed)) lines = parsed as RegisterLineInput[];
  } catch {
    return { ok: false, error: "Could not read the lines." };
  }
  if (lines.length === 0) return { ok: false, error: "There is nothing to save." };
  if (lines.length > 300) {
    return { ok: false, error: "That is more than 300 lines — save the page in two parts." };
  }

  const admin = createAdminSupabaseClient();

  // ── Check every line before writing anything ─────────────────────
  const { data: toolRows } = await admin
    .from("cnc_tools")
    .select("id, name, is_active")
    .eq("is_active", true);
  const tools = new Map(
    ((toolRows ?? []) as Array<{ id: string; name: string }>).map((t) => [t.id, t.name]),
  );

  // Today in IST — a register line cannot be from the future.
  const istToday = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

  const rowErrors: Array<{ row: number; message: string }> = [];
  const wanted = new Map<string, number>(); // toolId → total taken on this page

  lines.forEach((l, i) => {
    const row = i + 1;
    const date = String(l.date || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      rowErrors.push({ row, message: "Date is missing or not a real date." });
    } else if (date > istToday) {
      rowErrors.push({ row, message: "Date is in the future." });
    }
    const person = String(l.person || "").trim().replace(/\s+/g, " ");
    if (!person) rowErrors.push({ row, message: "Nobody is named for this line." });
    else if (person.length > 60) rowErrors.push({ row, message: "That name is too long." });

    if (!l.toolId || !tools.has(l.toolId)) {
      rowErrors.push({ row, message: "Pick a tool from the list." });
    }
    const qty = Number(l.qty);
    if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty < 1) {
      rowErrors.push({ row, message: "Quantity must be 1 or more." });
    } else if (qty > 500) {
      rowErrors.push({ row, message: "That quantity looks wrong." });
    } else if (l.toolId) {
      wanted.set(l.toolId, (wanted.get(l.toolId) ?? 0) + qty);
    }
  });

  // ── The shelf has to be able to cover the whole page ─────────────
  // Checked against the page TOTAL per tool, not line by line: five
  // lines of 2 against a stock of 6 is a problem even though each line
  // on its own looks fine.
  if (wanted.size > 0) {
    const { data: moves } = await admin
      .from("cnc_tool_movements")
      .select("tool_id, delta")
      .in("tool_id", [...wanted.keys()])
      .is("undone_at", null);
    const stock = new Map<string, number>();
    for (const m of (moves ?? []) as Array<{ tool_id: string; delta: number | string }>) {
      stock.set(m.tool_id, (stock.get(m.tool_id) ?? 0) + Number(m.delta ?? 0));
    }
    for (const [toolId, qty] of wanted) {
      const have = stock.get(toolId) ?? 0;
      if (qty > have) {
        rowErrors.push({
          row: 0,
          message: `${tools.get(toolId) ?? "A tool"} — the page takes ${qty} but the shelf has ${have}.`,
        });
      }
    }
  }

  if (rowErrors.length > 0) {
    return { ok: false, error: "Some lines need fixing before this page can be saved.", rowErrors };
  }

  // ── Write the page ───────────────────────────────────────────────
  const { data: batch, error: batchErr } = await admin
    .from("cnc_tool_register_batches")
    .insert({
      vendor_id: vendorId,
      register_date: registerDate,
      entered_by: profile.id,
      line_count: lines.length,
      note: txt(fd, "note").slice(0, 300) || null,
    })
    .select("id")
    .single();
  if (batchErr || !batch) {
    return { ok: false, error: batchErr?.message ?? "Could not start the page." };
  }
  const batchId = (batch as { id: string }).id;

  const { error: movesErr } = await admin.from("cnc_tool_movements").insert(
    lines.map((l) => ({
      vendor_id: vendorId,
      tool_id: l.toolId,
      kind: "issue",
      delta: -Math.abs(Number(l.qty)),
      taken_by: String(l.person).trim().replace(/\s+/g, " "),
      occurred_on: String(l.date).slice(0, 10),
      register_batch_id: batchId,
      entered_by: profile.id,
    })),
  );
  if (movesErr) {
    // Take the empty batch back out so a failed save leaves nothing behind.
    await admin.from("cnc_tool_register_batches").delete().eq("id", batchId);
    return { ok: false, error: movesErr.message };
  }

  await logAudit(profile.id, "cnc_tool_register_page_entered", "cnc_tool_register_batch", batchId, {
    vendor_id: vendorId,
    register_date: registerDate,
    lines: lines.length,
  });

  revalidatePath("/tools");
  revalidatePath("/tools/register");
  revalidatePath(`/tools/v/${vendorId}`);
  return { ok: true, batchId, lines: lines.length };
}

/** Take a whole page back out. The movements are marked undone rather
 *  than deleted, so the register still shows that the page was entered
 *  and then withdrawn, and by whom. */
export async function undoToolRegisterPageAction(fd: FormData): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canManageCncToolStore(profile)) return { ok: false, error: "Not allowed." };

  const batchId = txt(fd, "batch_id");
  if (!batchId) return { ok: false, error: "Which page?" };

  const admin = createAdminSupabaseClient();
  const now = new Date().toISOString();

  const { error: movesErr } = await admin
    .from("cnc_tool_movements")
    .update({ undone_at: now, undone_by: profile.id })
    .eq("register_batch_id", batchId)
    .is("undone_at", null);
  if (movesErr) return { ok: false, error: movesErr.message };

  const { error } = await admin
    .from("cnc_tool_register_batches")
    .update({ undone_at: now, undone_by: profile.id })
    .eq("id", batchId);
  if (error) return { ok: false, error: error.message };

  await logAudit(profile.id, "cnc_tool_register_page_undone", "cnc_tool_register_batch", batchId, {});
  revalidatePath("/tools");
  revalidatePath("/tools/register");
  return { ok: true, message: "That page has been taken back out." };
}
