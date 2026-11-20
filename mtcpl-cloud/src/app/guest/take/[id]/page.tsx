// ──────────────────────────────────────────────────────────────────
// /guest/take/[id] — where a slip's QR lands
// ──────────────────────────────────────────────────────────────────
//
// Daksh, Nov 2026: "later, anything happened, they will show us the QR;
// with the QR we can have all data. If that thing is undone that
// scanner will be of no use."
//
// Both halves of that sentence are this page. It is read fresh from the
// movement row on every scan, so a slip printed on Tuesday tells the
// truth on Friday — and the moment the take is voided, the same QR
// opens a page that says in red that it is not valid. A slip cannot
// outlive the fact it is evidence of.
//
// No login. A man standing in a shed holding a box is the person this
// is for, and making him sign in to prove what he is already holding
// would defeat it. What that costs is bounded by what the page shows:
// a tool, a quantity, a name, a time. No rate, no cost, no phone
// number. The id is a v4 uuid, so the list cannot be walked.
//
// Lives under /guest/ because middleware already lets that tree through
// without the auth round trip.
// ──────────────────────────────────────────────────────────────────

import type { Metadata } from "next";

import { loadTakeReceipt } from "@/lib/cnc-tool-receipt";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Tool slip · MTCPL",
  // A slip gets forwarded on WhatsApp. Keep it out of search results.
  robots: { index: false, follow: false },
};

const IST = 5.5 * 3_600_000;

/** The shed is in Rajasthan; the slip reads the same wherever it is
 *  opened. Shift the instant, then read its UTC parts. */
function istStamp(iso: string): string {
  const d = new Date(new Date(iso).getTime() + IST);
  const date = d.toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
  const h = d.getUTCHours();
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${date}, ${h12}:${m} ${h >= 12 ? "pm" : "am"}`;
}

export default async function TakeSlipPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const slip = await loadTakeReceipt(id);

  if (!slip) {
    return (
      <main className="ts">
        <style>{CSS}</style>
        <div className="ts-card" data-state="gone">
          <div className="ts-mark" aria-hidden>?</div>
          <h1>No slip here</h1>
          <p>
            This code does not match anything in the tool store. It may be from
            another system, or it may have been typed in wrong.
          </p>
        </div>
      </main>
    );
  }

  const dead = !!slip.undoneAt;
  // Anything that is not a take reached this page by its id. Say what
  // it actually is rather than calling a scrap a take.
  const isTake = slip.kind === "issue";
  /** A delivery carries no name. "Unsigned" is the right word in the
   *  TAKEN BY row, where it is an answer, and the wrong word inside a
   *  sentence, where it reads as somebody's name. */
  const named = slip.takenBy !== "Unsigned";

  return (
    <main className="ts">
      <style>{CSS}</style>

      <div className="ts-card" data-state={dead ? "dead" : "live"}>
        <header className="ts-top">
          <span className="ts-logo" aria-hidden>🧰</span>
          <span className="ts-org">
            <strong>MTCPL tool store</strong>
            <em>{isTake ? "Taken from the cupboard" : "Store record"}</em>
          </span>
        </header>

        {dead ? (
          <div className="ts-dead">
            <strong>This slip is no longer valid.</strong>
            <span>
              {/* Not every row here is a take, and not every row has a
                  name on it — a delivery is signed by nobody. Saying
                  "the take was cancelled... against Unsigned" in that
                  case reads like a fault in the page. */}
              {isTake ? "The take was cancelled on " : "This record was cancelled on "}
              {istStamp(slip.undoneAt!)}. Nothing is recorded against{" "}
              {named ? slip.takenBy : "anybody"} for it.
            </span>
          </div>
        ) : (
          <div className="ts-ok" aria-hidden>✓</div>
        )}

        <div className="ts-what">
          {/* The photograph, where the tool has one. The man scanning
              this is often holding the bit and checking it is the one
              the slip is about — a part code does not settle that and
              a picture does. */}
          {slip.toolImageUrl && (
            <span className="ts-pic">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={slip.toolImageUrl} alt="" />
            </span>
          )}
          <b>{slip.qty}</b>
          <span>
            <strong>{slip.toolName}</strong>
            {slip.toolSpec && <em>{slip.toolSpec}</em>}
          </span>
        </div>

        <dl className="ts-rows">
          <div>
            <dt>Taken by</dt>
            <dd>
              {slip.takenBy}
              {slip.company && slip.company !== slip.takenBy && (
                <i> · {slip.company}</i>
              )}
            </dd>
          </div>
          <div>
            <dt>When</dt>
            <dd>{istStamp(slip.at)}</dd>
          </div>
          <div>
            <dt>How many</dt>
            <dd>{slip.qty} {slip.unit}</dd>
          </div>
          <div>
            <dt>Slip no.</dt>
            <dd className="ts-id">{slip.id}</dd>
          </div>
        </dl>

        <p className="ts-foot">
          Read from the tool store just now — not from the code itself. If the
          take is ever cancelled, this page says so.
        </p>
      </div>
    </main>
  );
}

// Its own palette, like the rest of /guest: this tree is opened by men
// who are not logged in, so it must not depend on anything the app
// layout provides.
const CSS = `
.ts { min-height:100dvh; display:grid; place-items:center; padding:22px 16px;
  background:#F4F1EC; color:#2D2410;
  font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; }

.ts-card { width:100%; max-width:390px; background:#fff; border-radius:18px;
  padding:22px 20px 18px; border:1px solid #E4DDD2;
  box-shadow:0 10px 30px rgba(45,36,16,.10); }
.ts-card[data-state="dead"] { border-color:#f0c0c0; }
.ts-card[data-state="gone"] { text-align:center; }
.ts-card[data-state="gone"] h1 { font-size:19px; font-weight:800; margin:10px 0 7px; }
.ts-card[data-state="gone"] p { font-size:14px; line-height:1.6; color:#7A6A52; }
.ts-mark { font-size:40px; }

.ts-top { display:flex; align-items:center; gap:11px; padding-bottom:15px;
  border-bottom:1px solid #EDE8E0; }
.ts-logo { font-size:26px; }
.ts-org { display:flex; flex-direction:column; gap:1px; }
.ts-org strong { font-size:14px; font-weight:800; letter-spacing:-.01em; }
.ts-org em { font-style:normal; font-size:11.5px; color:#7A6A52; }

.ts-ok { width:46px; height:46px; margin:18px auto 4px; border-radius:999px;
  display:grid; place-items:center; font-size:23px; font-weight:800;
  background:rgba(22,163,74,.12); color:#16A34A; }

.ts-dead { margin:16px 0 4px; padding:13px 14px; border-radius:11px;
  background:rgba(220,38,38,.08); border:1px solid rgba(220,38,38,.28);
  display:flex; flex-direction:column; gap:5px; }
.ts-dead strong { font-size:14.5px; font-weight:800; color:#DC2626; }
.ts-dead span { font-size:12.5px; line-height:1.55; color:#8a5a52; }

.ts-what { display:flex; align-items:center; gap:14px; padding:18px 0 16px;
  justify-content:center; text-align:left; }
.ts-pic { flex:0 0 auto; width:62px; height:62px; border-radius:12px; overflow:hidden;
  border:1px solid #EDE8E0; background:#fff; display:block; }
.ts-pic img { width:100%; height:100%; object-fit:cover; display:block; }
.ts-card[data-state="dead"] .ts-pic { filter:grayscale(1); }
.ts-what b { font-size:42px; font-weight:800; letter-spacing:-.03em; line-height:1;
  font-variant-numeric:tabular-nums; }
.ts-what span { display:flex; flex-direction:column; gap:2px; min-width:0; }
.ts-what strong { font-size:16px; font-weight:800; line-height:1.25;
  overflow-wrap:anywhere; }
.ts-what em { font-style:normal; font-size:12px; color:#7A6A52; }
.ts-card[data-state="dead"] .ts-what { opacity:.55; }
.ts-card[data-state="dead"] .ts-what strong { text-decoration:line-through; }

.ts-rows { display:flex; flex-direction:column; border-top:1px solid #EDE8E0; }
.ts-rows > div { display:flex; align-items:baseline; justify-content:space-between;
  gap:14px; padding:10px 0; border-bottom:1px solid #EDE8E0; }
.ts-rows dt { font-size:11px; font-weight:700; letter-spacing:.06em;
  text-transform:uppercase; color:#A89A84; flex:0 0 auto; }
.ts-rows dd { font-size:13.5px; font-weight:700; text-align:right; min-width:0;
  overflow-wrap:anywhere; }
.ts-rows dd i { font-style:normal; font-weight:600; color:#7A6A52; }
/* The uuid does not fit beside its label on a 375px phone and wrapping
   it mid-word looked like a fault. It gets its own line under the
   label, left to right, the way a reference number is read out. */
.ts-rows > div:last-child { flex-direction:column; align-items:stretch; gap:3px; }
.ts-rows > div:last-child dd { text-align:left; }
.ts-id { font-family:ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size:10.5px; font-weight:600; color:#A89A84; letter-spacing:-.01em; }

.ts-foot { margin-top:14px; font-size:11px; line-height:1.55; color:#A89A84;
  text-align:center; }
`;
