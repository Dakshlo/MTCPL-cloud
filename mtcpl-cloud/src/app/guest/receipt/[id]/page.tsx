/**
 * The page a tool slip's QR opens (mig 240).
 *
 * Daksh, Nov 2026: "later anything happened they will show us the QR;
 * with QR we can have all data latest. If that thing is undone that
 * scanner will be of no use."
 *
 * So this is deliberately NOT a rendering of what the slip said when it
 * was made. It reads the live row every time it is opened, which means
 * one QR answers three different questions at three different times:
 *
 *   right after the take    "yes, 4 pcs, signed by Shyam at 9:12"
 *   after he spent two      "…and he is holding 2 of them now"
 *   after it was undone      VOID, with who voided it and when
 *
 * The man with the slip cannot tell which of those he is going to get,
 * and that is the point — a screenshot of this page is worth nothing on
 * its own, because anybody can open the same url and see the truth.
 *
 * ── No login, on purpose ──────────────────────────────────────────
 *
 * It is opened by a man in a shed with a tool in his hand, or by
 * whoever he showed the slip to. Holding the url is the credential: the
 * id in it is the row's own uuid, 122 bits of randomness, and what the
 * page shows is kept to what the person holding the slip already knows
 * — this tool, this quantity, this name, this time. No other line, no
 * other company, no shelf-wide list.
 *
 * Middleware short-circuits everything under /guest before it reaches
 * Supabase Auth, so this costs one database read and nothing else.
 */

import type { Metadata } from "next";

import { loadReceipt, receiptQr, type Receipt } from "@/lib/cnc-tool-receipt";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

/**
 * What WhatsApp draws when the link is pasted into a chat.
 *
 * "Make that card look good that can be shared to WhatsApp." The card
 * itself is below; this is the part that decides whether the message
 * looks like a receipt or like a bare link, and it is also live — a
 * voided slip pasted into a chat announces itself as cancelled in the
 * preview, before anybody taps it.
 */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const r = await loadReceipt(id);
  if (!r) return { title: "Tool slip — not found", robots: { index: false, follow: false } };

  const verb = r.kind === "issue" ? "Taken" : "Handed back";
  return {
    title: r.voided
      ? `CANCELLED · ${r.qty} ${r.unit} ${r.toolName}`
      : `${verb}: ${r.qty} ${r.unit} ${r.toolName}`,
    description: r.voided
      ? `This slip was cancelled. ${r.no}`
      : `${r.takenBy}${r.company ? ` · ${r.company}` : ""} · ${istStamp(r.at)} · ${r.no}`,
    // Nothing under /guest belongs in a search index: these urls are
    // the credential.
    robots: { index: false, follow: false },
    openGraph: {
      title: r.voided
        ? `CANCELLED — ${r.qty} ${r.unit} ${r.toolName}`
        : `${verb} — ${r.qty} ${r.unit} ${r.toolName}`,
      description: r.voided
        ? `Cancelled slip ${r.no}. Nothing was taken.`
        : `${r.takenBy}${r.company ? ` · ${r.company}` : ""} · ${istStamp(r.at)}`,
      type: "website",
    },
  };
}

/** IST, written out. The shed is in Rajasthan and the browser's own
 *  timezone is not evidence of anything. */
function istStamp(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 5.5 * 3_600_000);
  const day = String(d.getUTCDate()).padStart(2, "0");
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][
    d.getUTCMonth()
  ];
  let h = d.getUTCHours();
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  const ap = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  return `${day} ${mon} ${d.getUTCFullYear()}, ${h}:${m} ${ap}`;
}

export default async function ToolReceiptPage({ params }: { params: Params }) {
  const { id } = await params;
  const r = await loadReceipt(id);

  if (!r) {
    return (
      <main className="tr">
        <style>{CSS}</style>
        <div className="tr-card tr-miss">
          <div className="tr-head">
            <span className="tr-brand">Tool store</span>
          </div>
          <h1>No such slip</h1>
          <p>
            This code does not belong to any take. It may have been typed
            wrong, or cut short by the app it was pasted into — ask for the
            picture again.
          </p>
        </div>
      </main>
    );
  }

  const verb = r.kind === "issue" ? "Taken from the store" : "Handed back to the store";
  // Drawn into the page rather than fetched from a route of its own: it
  // is two kilobytes, it cannot 404, and it is still there when the man
  // screenshots this page on a phone with no signal left.
  const qr = await receiptQr(r.url);

  return (
    <main className="tr">
      <style>{CSS}</style>

      <div className={`tr-card${r.voided ? " tr-void" : ""}`}>
        {/* ── the one thing that must be seen first ─────────────── */}
        {r.voided ? (
          <div className="tr-stamp" role="status">
            <b>CANCELLED</b>
            <em>
              Taken back {istStamp(r.voided.at)}
              {r.voided.by ? ` by ${r.voided.by}` : ""}
            </em>
          </div>
        ) : (
          <div className="tr-stamp tr-ok" role="status">
            <b>ON RECORD</b>
            <em>This slip is live. The register still holds this line.</em>
          </div>
        )}

        <div className="tr-head">
          <span className="tr-brand">Tool store</span>
          <span className="tr-no">{r.no}</span>
        </div>

        <p className="tr-verb">{verb}</p>
        <h1 className="tr-tool">{r.toolName}</h1>
        <p className="tr-qty">
          <b>{r.qty}</b> <span>{r.unit}</span>
        </p>

        <dl className="tr-rows">
          <div>
            <dt>{r.kind === "issue" ? "Taken by" : "Handed back by"}</dt>
            <dd>
              {r.takenBy}
              {r.company && <em> · {r.company}</em>}
            </dd>
          </div>
          <div>
            <dt>When</dt>
            <dd>{istStamp(r.at)}</dd>
          </div>
          {r.holdingNow !== null && (
            <div>
              <dt>In his hands now</dt>
              <dd>
                {r.holdingNow} {r.unit} of this tool
              </dd>
            </div>
          )}
          <div>
            <dt>On the shelf now</dt>
            <dd>
              {r.shelfNow} {r.unit}
            </dd>
          </div>
        </dl>

        <QrBlock r={r} qr={qr} />

        <p className="tr-foot">
          {/* Said out loud because it is the whole value of the thing. */}
          This page reads the register every time it is opened, so the
          numbers above are today&apos;s, not the day the slip was made.
        </p>
      </div>
    </main>
  );
}

/** The code again, so the slip can be re-photographed or forwarded from
 *  here rather than from whichever phone it started on. */
function QrBlock({ r, qr }: { r: Receipt; qr: string | null }) {
  if (!qr) {
    return (
      <div className="tr-qr">
        <span>{r.no}</span>
      </div>
    );
  }
  return (
    <div className="tr-qr">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={qr} alt={`QR code for slip ${r.no}`} width={200} height={200} />
      <span>{r.no}</span>
    </div>
  );
}

const CSS = `
.tr {
  --ink:#2D2410; --dim:#7A6A52; --line:#E6E1D6; --paper:#F4F1EC;
  --gold:#C9973A; --ok:#059669; --void:#DC2626;
  min-height:100dvh; margin:0; padding:18px 16px 40px;
  background:var(--paper); color:var(--ink);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  display:flex; align-items:flex-start; justify-content:center;
}
.tr-card {
  width:100%; max-width:420px; background:#fff; border:1px solid var(--line);
  border-radius:14px; padding:0 18px 18px; overflow:hidden;
  box-shadow:0 1px 2px rgba(45,36,16,.06), 0 8px 24px rgba(45,36,16,.06);
}

/* The stamp spans the card and sets its tone. A cancelled slip must be
   obvious from across a room, in sunlight, on a cracked screen. */
.tr-stamp {
  margin:0 -18px 14px; padding:14px 18px; background:var(--void); color:#fff;
  display:flex; flex-direction:column; gap:2px;
}
.tr-stamp b { font-size:19px; font-weight:800; letter-spacing:.14em; }
.tr-stamp em { font-style:normal; font-size:12px; opacity:.92; line-height:1.45; }
.tr-stamp.tr-ok { background:var(--ok); }
.tr-void .tr-tool, .tr-void .tr-qty b { text-decoration:line-through; text-decoration-thickness:2px; }
.tr-void .tr-qr img { opacity:.35; filter:grayscale(1); }

.tr-head {
  display:flex; align-items:baseline; justify-content:space-between; gap:10px;
  padding-bottom:10px; border-bottom:1px solid var(--line); margin-bottom:14px;
}
.tr-brand { font-size:11px; font-weight:700; letter-spacing:.12em;
  text-transform:uppercase; color:var(--gold); }
.tr-no { font-size:12px; font-weight:700; color:var(--dim);
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }

.tr-verb { margin:0 0 2px; font-size:11.5px; font-weight:600; color:var(--dim);
  text-transform:uppercase; letter-spacing:.08em; }
.tr-tool { margin:0; font-size:21px; font-weight:700; line-height:1.25;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace; word-break:break-word; }
.tr-qty { margin:8px 0 16px; }
.tr-qty b { font-size:34px; font-weight:800; line-height:1; }
.tr-qty span { font-size:14px; color:var(--dim); margin-left:4px; }

.tr-rows { margin:0; display:flex; flex-direction:column; }
.tr-rows > div {
  display:flex; align-items:baseline; justify-content:space-between; gap:14px;
  padding:9px 0; border-top:1px solid var(--line);
}
.tr-rows dt { font-size:12px; color:var(--dim); flex:0 0 auto; }
.tr-rows dd { margin:0; font-size:13.5px; font-weight:600; text-align:right; }
.tr-rows dd em { font-style:normal; font-weight:500; color:var(--dim); }

.tr-qr {
  margin:16px 0 0; padding:14px; border:1px solid var(--line); border-radius:10px;
  display:flex; flex-direction:column; align-items:center; gap:8px; background:#fff;
}
.tr-qr img { display:block; width:200px; height:200px; image-rendering:pixelated; }
.tr-qr span { font-size:11.5px; font-weight:700; letter-spacing:.1em; color:var(--dim);
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }

.tr-foot { margin:14px 0 0; font-size:11.5px; line-height:1.5; color:var(--dim); }

.tr-miss { padding-top:18px; }
.tr-miss h1 { margin:6px 0 8px; font-size:19px; font-weight:700; }
.tr-miss p { margin:0; font-size:13px; line-height:1.6; color:var(--dim); }
`;
