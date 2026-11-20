/**
 * The slip as a picture.
 *
 * Daksh, Nov 2026: "when we share it should not send link, it should
 * send card image. Eg I share on WhatsApp — then instead of link, if
 * possible it should send the image of that card."
 *
 * ── Why this is one file doing two jobs ───────────────────────────
 *
 * Next renders `opengraph-image` into a real GET route at
 * /guest/take/<id>/opengraph-image. That means the same drawing is:
 *
 *   · what WhatsApp fetches to draw the link preview, with no work
 *     from us beyond existing, and
 *   · a URL the phone can fetch as a blob and hand to the share sheet
 *     as an actual file attachment.
 *
 * Writing it twice — an OG image and a separate "card.png" — would be
 * two renderers drifting apart within a month, and the one nobody
 * looked at would be the one WhatsApp used.
 *
 * ── Why the link still goes with it ───────────────────────────────
 *
 * The share now carries the picture AND the link, not one instead of
 * the other, and that is deliberate. The picture is what he asked for
 * and what a man actually looks at in a chat. The link is what keeps
 * the slip honest: a photograph says "4 taken" for ever, while the page
 * it points at says CANCELLED the moment the take is voided. Sending
 * only the image would make a voided slip look valid in every chat it
 * was ever forwarded to — which is the exact failure the QR was
 * designed around in the first place.
 *
 * So: the image is drawn FROM the live row at the moment of sharing,
 * and if the take is already void the picture says so across its face.
 *
 * ── Drawing constraints ───────────────────────────────────────────
 *
 * This is Satori, not a browser. It lays out a small subset of flexbox
 * and rasterises <img>; it does not run scripts, load stylesheets, or
 * render inline SVG dependably — which is why the QR is fetched as a
 * PNG data URL here while the card on the phone keeps the sharper SVG.
 * Every element with more than one child says display:flex explicitly,
 * because Satori does not default to it the way a browser does.
 */

import { ImageResponse } from "next/og";

import { loadTakeReceipt, takeReceiptQrPng, takeReceiptUrl } from "@/lib/cnc-tool-receipt";

/** The admin client and `qrcode` are both Node, not Edge. */
export const runtime = "nodejs";

/** Always drawn from the live row — a cached picture of a slip that has
 *  since been cancelled is the one thing this must never serve. */
export const dynamic = "force-dynamic";

export const alt = "Tool slip";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#2D2410";
const GOLD = "#C9973A";
const PAPER = "#F4F1EC";
const MUTED = "#7A6A52";
const VOID = "#DC2626";

/** IST, spelled out. The slip may be read in another week on another
 *  phone, so it never says "2 hours ago". */
function istStamp(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 5.5 * 3_600_000);
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
               "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  let h = d.getUTCHours();
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  const ap = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  return `${String(d.getUTCDate()).padStart(2, "0")} ${mon} ${d.getUTCFullYear()} · ${h}:${m} ${ap}`;
}

export default async function SlipCard({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await loadTakeReceipt(id);

  // A slip nobody can find still has to answer with a picture: an OG
  // route that 404s makes WhatsApp draw a bare grey link.
  if (!r) {
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%", height: "100%", display: "flex",
            alignItems: "center", justifyContent: "center",
            background: PAPER, color: MUTED, fontSize: 44, fontWeight: 600,
          }}
        >
          No such tool slip
        </div>
      ),
      size,
    );
  }

  const dead = !!r.undoneAt;
  const qr = await takeReceiptQrPng(takeReceiptUrl(r.id));

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%", display: "flex", flexDirection: "column",
          background: PAPER, fontFamily: "sans-serif",
        }}
      >
        {/* The band across the top carries the verdict. A cancelled slip
            has to be obvious from a chat thumbnail, before anybody taps
            it — that is most of the value of sending a picture at all. */}
        <div
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            background: dead ? VOID : INK, color: "#fff", padding: "26px 44px",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{ display: "flex", fontSize: 22, fontWeight: 700, letterSpacing: 4, color: GOLD }}
            >
              MTCPL TOOL STORE
            </div>
            <div style={{ display: "flex", fontSize: 40, fontWeight: 800, marginTop: 6 }}>
              {dead ? "CANCELLED — nothing was taken" : "Taken from the store"}
            </div>
          </div>
          <div style={{ display: "flex", fontSize: 24, fontWeight: 700, opacity: 0.75 }}>
            {istStamp(r.at)}
          </div>
        </div>

        <div style={{ display: "flex", flex: 1, padding: "34px 44px", alignItems: "center" }}>
          {/* The photograph. Daksh: "if there is item image then card
              should also show item image." Where there is none, the
              space goes to the text rather than to an empty frame with
              a letter in it. */}
          {r.toolImageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={r.toolImageUrl}
              alt=""
              width={232}
              height={232}
              style={{
                width: 232, height: 232, objectFit: "cover", borderRadius: 20,
                border: `3px solid ${dead ? "#e5e0d6" : GOLD}`, marginRight: 36,
                opacity: dead ? 0.4 : 1,
              }}
            />
          )}

          <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "baseline" }}>
              <div
                style={{
                  display: "flex",
                  fontSize: 92, fontWeight: 800, color: dead ? MUTED : INK, lineHeight: 1,
                  textDecoration: dead ? "line-through" : "none",
                }}
              >
                {String(r.qty)}
              </div>
              <div style={{ display: "flex", fontSize: 34, color: MUTED, marginLeft: 12 }}>
                {r.unit}
              </div>
            </div>

            <div
              style={{
                display: "flex", fontSize: 44, fontWeight: 700, color: INK,
                marginTop: 8, maxWidth: 620, overflow: "hidden",
              }}
            >
              {r.toolName}
            </div>
            {r.toolSpec && (
              <div style={{ display: "flex", fontSize: 26, color: MUTED, marginTop: 6 }}>
                {r.toolSpec}
              </div>
            )}

            <div
              style={{
                display: "flex", fontSize: 30, color: INK, marginTop: 22,
                fontWeight: 600,
              }}
            >
              {r.company && r.company !== r.takenBy
                ? `${r.takenBy} · ${r.company}`
                : r.takenBy}
            </div>
          </div>

          {/* The code, still the thing that makes the slip worth
              keeping: it re-reads the row, so it tells the truth long
              after this picture stops being able to. */}
          <div
            style={{
              display: "flex", flexDirection: "column", alignItems: "center",
              marginLeft: 28,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qr}
              alt=""
              width={212}
              height={212}
              style={{ width: 212, height: 212, opacity: dead ? 0.25 : 1 }}
            />
            <div style={{ display: "flex", fontSize: 19, color: MUTED, marginTop: 10 }}>
              {dead ? "this slip is dead" : "scan for the latest"}
            </div>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
