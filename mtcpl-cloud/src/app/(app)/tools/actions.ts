"use server";

// ──────────────────────────────────────────────────────────────────
// Migrations 227 + 228 — CNC tool store server actions
// ──────────────────────────────────────────────────────────────────
// Every write to cnc_tools / cnc_tool_movements goes through here.
//
// ONE STORE. A tool belongs to the plant, not to a vendor, and every
// CNC vendor draws from the same shelf.
//
// Oct 2026 — what a logged-in person may write here is now just TWO
// things: stock in, and a count correction. Taking moved out entirely,
// to the cupboard QR, where it is signed by the person taking it (mig
// 232). A "give to vendor" button here would be the keeper guessing on
// somebody's behalf, which is the paper register with extra steps.
// RLS on those tables is read-only for `authenticated`, so the admin
// client below is the only way in and these gates are the real door.
//
// THERE IS NO APPROVAL QUEUE, by design. The thing this replaces is a
// paper register: you take a bit, you write it down, you carry on. A
// pending state would make the software slower than the paper and the
// register would quietly go back to being paper. The protection is an
// append-only ledger plus a 10-minute undo, not a gate.
//
// Corrections after the undo window are RECORDED, never edited: a
// `adjust` line puts the register back in step with the shelf and says
// why. The wrong line stays visible with the right line underneath it,
// which is exactly how the paper register handles a mistake.
// ──────────────────────────────────────────────────────────────────

import { randomBytes } from "node:crypto";

import { revalidatePath } from "next/cache";

import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { canManageCncToolStore, canUseCncTools } from "@/lib/cnc-tool-permissions";
import {
  TOOL_IMAGE_BUCKET,
  UNDO_WINDOW_MS,
  levelOf,
  lowLineOf,
  moveRefusal,
  stockForTool,
  type MoveOutcome,
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

// ── The photo on a tool (mig 233) ─────────────────────────────────
//
// Daksh: "we may also add image to its thumbnail so user can also see
// image-wise product." The men do not read "450mm tool" and picture a
// 450mm tool; they picture the thing in their hand.
//
// Public bucket, on purpose — the cupboard QR screen has no app login
// to sign a URL with, and a signed URL that expires is a broken image
// on somebody's phone an hour later.

const TOOL_IMG_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
const TOOL_IMG_MAX_BYTES = 8 * 1024 * 1024;

function imgExt(mime: string): string {
  return mime === "image/png" ? "png"
    : mime === "image/webp" ? "webp"
      : mime === "image/heic" ? "heic"
        : mime === "image/heif" ? "heif"
          : "jpg";
}

/** Put the file in the bucket and hand back its object path. Returns a
 *  readable reason instead of throwing — a bad photo must not lose the
 *  tool the person was adding. */
async function putToolPhoto(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  toolId: string,
  file: File,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const mime = (file.type || "").toLowerCase();
  if (!TOOL_IMG_MIME.has(mime)) return { ok: false, error: "The photo must be a JPG, PNG, WebP or HEIC." };
  if (file.size === 0) return { ok: false, error: "That photo is empty." };
  if (file.size > TOOL_IMG_MAX_BYTES) return { ok: false, error: "That photo is over 8 MB — take a smaller one." };

  const path = `${toolId}/${randomBytes(8).toString("hex")}.${imgExt(mime)}`;
  const { error } = await admin.storage
    .from(TOOL_IMAGE_BUCKET)
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: mime, cacheControl: "3600", upsert: false });
  if (error) return { ok: false, error: `Photo upload failed: ${error.message}` };
  return { ok: true, path };
}

/** Best-effort: a tool must never be stuck because its old photo would
 *  not delete. The row is the record; the file is a convenience. */
async function dropToolPhoto(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  path: string | null | undefined,
) {
  if (!path) return;
  try {
    await admin.storage.from(TOOL_IMAGE_BUCKET).remove([path]);
  } catch {
    /* orphaned file — harmless */
  }
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

  // The photo goes up AFTER the row, so it can be filed under the tool's
  // own id and a failed upload costs a picture, never the tool.
  const photo = fd.get("photo");
  if (photo instanceof File && photo.size > 0) {
    const put = await putToolPhoto(admin, created.id, photo);
    if (put.ok) await admin.from("cnc_tools").update({ image_path: put.path }).eq("id", created.id);
    else {
      refresh();
      return { ok: false, error: `${name} was added, but the photo did not: ${put.error}` };
    }
  }

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

  // Photo: a new one replaces whatever was there, and an explicit
  // "remove" clears it. Doing nothing leaves it alone, so an edit that
  // only renames a tool cannot lose its picture.
  const { data: beforeRow } = await admin
    .from("cnc_tools").select("image_path").eq("id", toolId).maybeSingle();
  const oldPath = (beforeRow as { image_path: string | null } | null)?.image_path ?? null;

  const photo = fd.get("photo");
  if (photo instanceof File && photo.size > 0) {
    const put = await putToolPhoto(admin, toolId, photo);
    if (!put.ok) return { ok: false, error: put.error };
    patch.image_path = put.path;
  } else if (txt(fd, "remove_photo") === "1") {
    patch.image_path = null;
  }

  const { error } = await admin.from("cnc_tools").update(patch).eq("id", toolId);
  if (error) {
    if (error.code === "23505") return { ok: false, error: "Another tool in the store already has that name." };
    return { ok: false, error: error.message };
  }
  // Only once the row is safely updated — otherwise a failed update
  // would leave the tool pointing at a file that no longer exists.
  if ("image_path" in patch && oldPath && patch.image_path !== oldPath) {
    await dropToolPhoto(admin, oldPath);
  }

  await logAudit(profile.id, "cnc_tool_updated", "cnc_tool", toolId, patch);
  refresh();
  return { ok: true, message: "Saved." };
}

// ── Delete a tool ─────────────────────────────────────────────────

/**
 * Take a tool out of the store for good.
 *
 * Daksh, Nov 2026: "make it this way we can delete whole product / item
 * if there is 0 in stock."
 *
 * The zero is the whole safety rule, and it is a good one: a tool with
 * stock against it is a thing sitting in a cupboard, and software
 * should not be able to make it disappear. So the count is re-read from
 * the ledger here — never trusted from the page, which may be a minute
 * old while somebody else is taking the last one at the QR.
 *
 * ── What "delete" means depends on the register ───────────────────
 *
 * A tool nobody ever touched is removed outright: the row goes, the
 * photo goes, and the store looks as though the typo never happened.
 *
 * A tool with history is RETIRED instead — the row stays, flagged
 * inactive, and disappears from the shelf and the QR. The register is
 * the reason: a hard delete would have to take every line that mentions
 * it with it, and "who took the 450mm bits in September" is exactly the
 * question this module exists to answer. The database agrees — the
 * movement rows point at the tool with ON DELETE RESTRICT, so a hard
 * delete of a used tool would be refused anyway.
 *
 * The message says which of the two happened, in those words, so nobody
 * is left wondering why a name they deleted still shows in the history.
 */
export async function deleteToolAction(fd: FormData): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canManageCncToolStore(profile)) return { ok: false, error: "Not allowed." };

  const toolId = txt(fd, "tool_id");
  if (!toolId) return { ok: false, error: "Which tool?" };

  const admin = createAdminSupabaseClient();

  const { data: row } = await admin
    .from("cnc_tools")
    .select("id, name, image_path, is_active")
    .eq("id", toolId)
    .maybeSingle();
  const tool = row as { id: string; name: string; image_path: string | null; is_active: boolean } | null;
  if (!tool) return { ok: false, error: "That tool is not in the store." };

  // The gate, from the ledger and not from the screen.
  const stock = await stockForTool(toolId);
  if (stock > 0) {
    return {
      ok: false,
      error: `${tool.name} still has ${stock} on the shelf. Empty it first — scrap or fix the count — then delete it.`,
    };
  }
  if (stock < 0) {
    return {
      ok: false,
      error: `${tool.name} is at ${stock}, which should not be possible. Fix the count first.`,
    };
  }

  // Has it any history at all? One row is enough to make this a retire.
  const { count } = await admin
    .from("cnc_tool_movements")
    .select("id", { count: "exact", head: true })
    .eq("tool_id", toolId);
  const touched = (count ?? 0) > 0;

  if (!touched) {
    const { error } = await admin.from("cnc_tools").delete().eq("id", toolId);
    if (error) return { ok: false, error: error.message };
    await dropToolPhoto(admin, tool.image_path);
    await logAudit(profile.id, "cnc_tool_deleted", "cnc_tool", toolId, {
      name: tool.name,
      hard: true,
    });
    refresh();
    return { ok: true, message: `${tool.name} deleted.` };
  }

  const { error } = await admin
    .from("cnc_tools")
    .update({ is_active: false, updated_by: profile.id })
    .eq("id", toolId);
  if (error) return { ok: false, error: error.message };

  await logAudit(profile.id, "cnc_tool_deleted", "cnc_tool", toolId, {
    name: tool.name,
    hard: false,
    movements: count ?? 0,
  });
  refresh();
  return {
    ok: true,
    message: `${tool.name} removed from the store. Its old register lines stay, so you can still see who took what.`,
  };
}

// ── Take one of a vendor's men off the list (mig 234) ─────────────

/**
 * The office's copy of the button a vendor has on his own phone.
 *
 * A vendor enrols his own men and normally removes them himself. This
 * exists for the case he will not: somebody leaves the firm, nobody
 * tells him, and the man can still walk up to the cupboard. The office
 * must not have to ask permission to close that.
 */
export async function removeToolOperatorAction(fd: FormData): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canManageCncToolStore(profile)) return { ok: false, error: "Not allowed." };

  const operatorId = txt(fd, "operator_id");
  if (!operatorId) return { ok: false, error: "Which man?" };

  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("cnc_tool_operators")
    .update({
      is_active: false,
      removed_at: new Date().toISOString(),
      removed_by: profile.id,
    })
    .eq("id", operatorId)
    .eq("is_active", true)
    .select("name, vendor_id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "He is already off the list." };

  const gone = data as { name: string; vendor_id: string };
  await logAudit(profile.id, "cnc_tool_operator_removed", "cnc_tool_operator", operatorId, {
    name: gone.name,
    vendor_id: gone.vendor_id,
  });
  refresh();
  return { ok: true, message: `${gone.name} can no longer take anything from the cupboard.` };
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

  const toolId = txt(fd, "tool_id");
  const kind = txt(fd, "kind") as ToolMovementKind;
  const note = txt(fd, "note") || null;
  const qty = num(fd, "qty");
  // `adjust` is the only one that may go either way, so it carries its
  // own direction instead of a signed quantity.
  const down = txt(fd, "direction") === "down";

  if (!toolId) return { ok: false, error: "Missing tool." };
  // Only the keeper's two. A take has to be signed by the person taking
  // it, and the only door that can do that is the cupboard QR, so it is
  // refused here however the form is posted.
  if (kind !== "receive" && kind !== "adjust") {
    return { ok: false, error: "Taking is done at the cupboard QR, signed by the person taking it." };
  }
  if (!Number.isFinite(qty) || qty <= 0) return { ok: false, error: "Enter how many." };

  // A count fix can hide a loss, so it stays behind the manage gate.
  if (kind === "adjust" && !canManageCncToolStore(profile)) {
    return { ok: false, error: "Only a manager can fix the count." };
  }

  const admin = createAdminSupabaseClient();

  // The warn line and the photo still come off the row; the STOCK does
  // not, because anything read out here is already out of date by the
  // time it is used. Mig 235 re-reads it under a lock.
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

  // ── Add stock is a delta; fix count is an absolute ──────────────
  //
  // "The register says 10 — what does the shelf say?" is a statement
  // about a NUMBER, not a nudge. So the sheet sends the figure the man
  // was looking at, and the target is that figure plus his correction.
  // Mig 235 then works out whatever delta reaches that target from the
  // stock that is true inside the lock. If a take landed while he was
  // counting, his count still wins and the take is still on the record
  // underneath it.
  const isAdjust = kind === "adjust";
  const seen = num(fd, "seen_stock");
  const target = isAdjust && Number.isFinite(seen) ? seen + (down ? -qty : qty) : null;
  if (isAdjust && target != null && target < 0) {
    return { ok: false, error: "A shelf cannot hold less than nothing." };
  }
  const delta = isAdjust ? (down ? -qty : qty) : qty;

  const { data: raw, error } = await admin.rpc("cnc_tool_record_move", {
    p_tool_id: toolId,
    p_kind: kind,
    // Store-level by definition: neither of these belongs to a company.
    p_delta: target == null ? delta : null,
    p_target: target,
    p_note: note,
    p_entered_by: profile.id,
  });
  if (error) return { ok: false, error: error.message };

  const res = (raw ?? {}) as MoveOutcome;
  if (!res.ok) return { ok: false, error: moveRefusal(res) };

  const before = Number(res.stock_before ?? 0);
  const after = Number(res.stock_after ?? before);

  if (res.noop) {
    return {
      ok: true,
      message: `Already ${after} ${tool.unit} — the register was put right by somebody else first.`,
    };
  }

  await logAudit(profile.id, `cnc_tool_${kind}`, "cnc_tool", toolId, {
    tool: tool.name,
    qty,
    delta: res.delta ?? delta,
    note,
    stock_before: before,
    stock_after: after,
    movement_id: res.movement_id ?? null,
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
