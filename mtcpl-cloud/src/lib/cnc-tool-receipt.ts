/**
 * The slip a man gets for taking a tool, and the QR that proves it.
 *
 * Daksh, Nov 2026: "when someone takes a tool from phone — eg I take a
 * tool, after take 1 pcs it only gives a small feedback. Instead it
 * should give a full page card that this is taken… on that card
 * everything will be mentioned — taken by Mohit, time, what taken — and
 * a QR they can save. And later anything happened, they will show us the
 * QR; with QR we can have all data latest. If that thing is undone that
 * scanner will be of no use."
 *
 * ── The QR points at the row, not at a copy of it ─────────────────
 *
 * This is the whole design and it is worth being explicit about,
 * because the obvious build is to put the details INSIDE the QR — name,
 * tool, quantity, date — and let a scanner read them off the image.
 * That would be wrong on the one requirement he cares most about: a
 * take that gets undone must make its slip worthless. A QR that carries
 * its own data cannot be withdrawn. Somebody holding yesterday's
 * screenshot would still scan "4 pcs, signed by Shyam" long after the
 * line was voided, and there would be no way to tell from the image.
 *
 * So the QR carries a URL and nothing else, and the page it opens reads
 * the live row every time. Undo the take and the same QR — the same
 * screenshot, the same paper — opens a page that says VOID across the
 * top. "With QR we can have all data latest" falls out of that for
 * free, including what the man is still holding of that tool today,
 * which is a fact that did not even exist when the slip was made.
 *
 * ── Why there is no receipts table ────────────────────────────────
 *
 * "We will also store those QR request-wise." The request IS the
 * movement row — one take, one line in cnc_tool_movements, already kept
 * for ever and already the thing every other screen counts. A receipts
 * table beside it would be a second copy of the same facts that can
 * disagree with the first, and the first is the one the shelf is
 * computed from. The slip is a VIEW of the row.
 *
 * The URL carries the row's own uuid, which is 122 bits of randomness —
 * unguessable, so no token of its own is needed; and bearer-only, so
 * what the page shows is kept to what the man holding the slip already
 * knows.
 */

import QRCode from "qrcode";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { appBaseUrl } from "@/lib/wa-diary-mention";

/** Where the QR points. Absolute: it is going into a WhatsApp message
 *  and onto a photograph of somebody's screen. */
export function receiptUrl(movementId: string): string {
  return `${appBaseUrl()}/guest/receipt/${movementId}`;
}

/**
 * The short number on the slip, for reading out over a phone.
 *
 * Derived from the id rather than counted, so it needs no sequence and
 * cannot run ahead of itself the way the invoice counter once did. It is
 * a LABEL — the url is the identity. Eight hex characters is 4.3bn, far
 * past any chance of two slips in the same conversation colliding.
 */
export function receiptNo(movementId: string): string {
  return `T-${movementId.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

/**
 * The QR as a data URL, drawn here on the server.
 *
 * Never an external image service: the whole point of the code is that
 * it is the proof, and a proof that depends on a third party being up
 * is not one. Sized and quiet-zoned to survive being screenshotted and
 * then photographed off somebody else's screen, which is how these will
 * actually be read.
 *
 * Returns null rather than throwing. A slip with no picture on it still
 * carries the number and the link; a take that failed to render a PNG
 * must not look like a take that failed.
 */
export async function receiptQr(url: string): Promise<string | null> {
  try {
    return await QRCode.toDataURL(url, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 420,
      color: { dark: "#2D2410", light: "#FFFFFF" },
    });
  } catch {
    return null;
  }
}

export type Receipt = {
  id: string;
  no: string;
  url: string;
  /** 'issue' — he took it. 'return' — he handed it back. */
  kind: "issue" | "return";
  toolName: string;
  unit: string;
  qty: number;
  /** The readable name on the line. */
  takenBy: string;
  company: string | null;
  at: string;
  /** Set when the line has been voided. The slip is then worthless and
   *  says so, which is the requirement. */
  voided: { at: string; by: string | null } | null;
  /** What this man is holding of this tool RIGHT NOW — not what the
   *  slip was for. The live half of "with QR we can have all data
   *  latest". Null when the line names nobody. */
  holdingNow: number | null;
  /** Live shelf count for the tool, for the same reason. */
  shelfNow: number;
};

type MovementRow = {
  id: string;
  tool_id: string;
  kind: string;
  delta: number | string;
  taken_by: string | null;
  taken_by_profile_id: string | null;
  taken_by_operator_id: string | null;
  vendor_id: string | null;
  created_at: string;
  undone_at: string | null;
  undone_by: string | null;
  undone_by_operator_id: string | null;
};

/**
 * Read a slip by the id in its URL.
 *
 * Returns null for anything that is not a take or a hand-back — a
 * delivery and a count correction are the store's business and have no
 * slip, so their ids open nothing even though they live in the same
 * table.
 */
export async function loadReceipt(id: string): Promise<Receipt | null> {
  // A bad id must be a miss, not a 500: these urls get retyped off
  // photographs and truncated by chat apps.
  if (!/^[0-9a-fA-F-]{32,36}$/.test(id)) return null;

  const admin = createAdminSupabaseClient();

  const { data, error } = await admin
    .from("cnc_tool_movements")
    .select(
      "id, tool_id, kind, delta, taken_by, taken_by_profile_id, taken_by_operator_id, vendor_id, created_at, undone_at, undone_by, undone_by_operator_id",
    )
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;

  const m = data as MovementRow;
  if (m.kind !== "issue" && m.kind !== "return") return null;

  const [{ data: tool }, { data: vendor }] = await Promise.all([
    admin.from("cnc_tools").select("name, unit").eq("id", m.tool_id).maybeSingle(),
    m.vendor_id
      ? admin.from("vendors").select("name").eq("id", m.vendor_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  // Who voided it, if anybody. Two tables because an undoer is either
  // somebody with an app login or a man at the cupboard (mig 240).
  let voidedBy: string | null = null;
  if (m.undone_at) {
    if (m.undone_by) {
      const { data: p } = await admin
        .from("profiles")
        .select("full_name")
        .eq("id", m.undone_by)
        .maybeSingle();
      voidedBy = ((p as { full_name: string | null } | null)?.full_name ?? "").trim() || null;
    } else if (m.undone_by_operator_id) {
      const { data: o } = await admin
        .from("cnc_tool_operators")
        .select("name")
        .eq("id", m.undone_by_operator_id)
        .maybeSingle();
      voidedBy = ((o as { name: string | null } | null)?.name ?? "").trim() || null;
    }
  }

  // The live numbers. Both are read now, every time the slip is opened.
  const holdQ = admin
    .from("cnc_tool_holdings")
    .select("qty")
    .eq("tool_id", m.tool_id);
  const scoped = m.taken_by_profile_id
    ? holdQ.eq("profile_id", m.taken_by_profile_id).is("operator_id", null)
    : m.taken_by_operator_id
      ? holdQ.eq("operator_id", m.taken_by_operator_id).is("profile_id", null)
      : null;

  const [held, shelf] = await Promise.all([
    scoped ? scoped : Promise.resolve({ data: null }),
    admin
      .from("cnc_tool_movements")
      .select("delta")
      .eq("tool_id", m.tool_id)
      .is("undone_at", null),
  ]);

  const holdingNow = scoped
    ? ((held.data ?? []) as Array<{ qty: number | string }>).reduce(
        (s, r) => s + Number(r.qty),
        0,
      )
    : null;

  const shelfNow = ((shelf.data ?? []) as Array<{ delta: number | string }>).reduce(
    (s, r) => s + Number(r.delta),
    0,
  );

  const t = tool as { name: string; unit: string } | null;

  return {
    id: m.id,
    no: receiptNo(m.id),
    url: receiptUrl(m.id),
    kind: m.kind,
    toolName: t?.name ?? "a tool that is no longer in the store",
    unit: t?.unit ?? "pcs",
    qty: Math.abs(Number(m.delta)),
    takenBy: (m.taken_by || "").trim() || "Unsigned",
    company: ((vendor as { name: string } | null)?.name ?? null) || null,
    at: m.created_at,
    voided: m.undone_at ? { at: m.undone_at, by: voidedBy } : null,
    holdingNow,
    shelfNow,
  };
}
