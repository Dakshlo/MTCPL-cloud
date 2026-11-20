/**
 * The slip a man gets when he takes something off the shelf.
 *
 * Daksh, Nov 2026: "when someone takes a tool from phone, after take 1
 * pcs it only gives a small feedback. Instead it should give a full
 * page card that this is taken... on that card everything will be
 * mentioned — taken by Mohit, time, what taken — and a QR they can
 * save. Later, anything happened, they will show us the QR; with the QR
 * we can have all data. If that thing is undone that scanner will be of
 * no use. And we will also store those QR request-wise."
 *
 * THE RECORD IS THE MOVEMENT ROW. There is no receipts table and no
 * migration, because there is nothing a receipt would store that the
 * take has not already stored: who, what, how many, when, under which
 * sticker, and whether it was taken back. "Request-wise" falls out of
 * that for free — one take is one row is one QR, and two men taking the
 * same tool in the same minute get different slips because they are
 * different rows.
 *
 * So the QR carries nothing but the movement id, in a URL. Not the
 * details themselves: a QR that spells out "DAKSH took 4" can be
 * reprinted to say anything, and it would still read correctly weeks
 * after the take was voided. Pointing at the row means the slip is
 * re-read from the database every time anybody scans it, which is what
 * makes the last sentence of the ask work — undo it, and the scanner is
 * of no use, because the page it lands on says so.
 *
 * The id is a v4 uuid. It is not a secret, but it is not guessable
 * either, and the page it opens shows a tool and a name and no money at
 * all — the rates on this module live behind the office gate and stay
 * there.
 */

import QRCode from "qrcode";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { TOOL_IMAGE_BUCKET } from "@/lib/cnc-tool-stock";
import { appBaseUrl } from "@/lib/wa-diary-mention";

/** Where a slip's QR points. One place, so the writer and the reader
 *  cannot disagree about the shape of the link. */
export function takeReceiptUrl(movementId: string): string {
  return `${appBaseUrl()}/guest/take/${movementId}`;
}

/**
 * The QR itself, as inline SVG.
 *
 * Drawn on the server and handed down with the result rather than drawn
 * in the browser: the phone at the cupboard is usually a cheap one on a
 * shed connection, and this way the card paints in one go with no
 * second request and no client-side library.
 *
 * Error correction M, not L — this gets photographed off a phone screen
 * at an angle, in a shed, by another phone.
 */
export async function takeReceiptQr(url: string): Promise<string> {
  return QRCode.toString(url, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 0,
    width: 260,
  });
}

/**
 * The same QR as a PNG data URL.
 *
 * The card on the phone uses the SVG above, which is sharper and
 * smaller. This one exists for the shareable image: that is drawn by
 * Satori (next/og), which rasterises <img> but does not reliably render
 * an inline SVG, so the picture that goes to WhatsApp needs a bitmap.
 */
export async function takeReceiptQrPng(url: string): Promise<string> {
  return QRCode.toDataURL(url, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 320,
    color: { dark: "#2D2410", light: "#FFFFFF" },
  });
}

/** The tool's photograph, or null. Public bucket (mig 233), so the URL
 *  works on a phone with no login and inside the image renderer, which
 *  fetches it as an anonymous stranger would. */
export function toolPhotoUrl(imagePath: string | null): string | null {
  if (!imagePath) return null;
  const admin = createAdminSupabaseClient();
  return admin.storage.from(TOOL_IMAGE_BUCKET).getPublicUrl(imagePath).data.publicUrl;
}

/** What the public slip shows. No rate, no cost, no phone number. */
export type TakeReceipt = {
  id: string;
  /** "issue" is a take. Anything else reached this page by its id and
   *  is shown honestly rather than dressed up as one. */
  kind: string;
  qty: number;
  toolName: string;
  toolSpec: string | null;
  /** Daksh, Nov 2026: "if there is item image then card should also
   *  show item image." A part code tells a storeman which bit it is; a
   *  photograph tells the man holding it. */
  toolImageUrl: string | null;
  unit: string;
  takenBy: string;
  company: string | null;
  at: string;
  /** Set when it was taken back. The slip is dead from that moment. */
  undoneAt: string | null;
};

/**
 * Read one slip by its movement id.
 *
 * Runs as the admin client because the man scanning it is not logged
 * in — that is the whole point of a slip. The columns chosen are the
 * ceiling on what a scan can ever reveal.
 */
export async function loadTakeReceipt(id: string): Promise<TakeReceipt | null> {
  // A bad id must not reach Postgres as a malformed uuid: that comes
  // back as an error rather than an empty row, and the page would show
  // a crash where it should show "not a slip we know".
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return null;
  }

  const admin = createAdminSupabaseClient();
  const { data } = await admin
    .from("cnc_tool_movements")
    .select(
      "id, kind, delta, taken_by, created_at, undone_at, vendor_id, cnc_tools(name, spec, unit, image_path), vendors(name)",
    )
    .eq("id", id)
    .maybeSingle();

  const row = data as
    | {
        id: string;
        kind: string;
        delta: number | string;
        taken_by: string | null;
        created_at: string;
        undone_at: string | null;
        vendor_id: string | null;
        cnc_tools:
          | { name: string; spec: string | null; unit: string; image_path: string | null }
          | { name: string; spec: string | null; unit: string; image_path: string | null }[]
          | null;
        vendors: { name: string } | { name: string }[] | null;
      }
    | null;
  if (!row) return null;

  const one = <T,>(v: T | T[] | null): T | null =>
    Array.isArray(v) ? v[0] ?? null : v;
  const tool = one(row.cnc_tools);

  return {
    id: row.id,
    kind: row.kind,
    // The row stores a take as a negative. The slip is read by a man
    // holding four things, so it says four.
    qty: Math.abs(Number(row.delta)),
    toolName: tool?.name ?? "a tool that has since been removed",
    toolSpec: tool?.spec ?? null,
    toolImageUrl: toolPhotoUrl(tool?.image_path ?? null),
    unit: tool?.unit ?? "pcs",
    takenBy: (row.taken_by ?? "").trim() || "Unsigned",
    company: one(row.vendors)?.name ?? null,
    at: row.created_at,
    undoneAt: row.undone_at,
  };
}
