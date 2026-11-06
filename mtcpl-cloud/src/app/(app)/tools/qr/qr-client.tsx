"use client";

/**
 * Sticker manager: create one, print it, switch it off.
 *
 * What comes out of the printer is one QR square and nothing else —
 * Daksh Nov 2026, "when we print the qr it should only print qr, remove
 * all fonts and irrelevant info." See printQr() for how that is kept
 * true no matter what the page around it grows into.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export type LinkCard = {
  id: string;
  label: string;
  url: string;
  /** Inline SVG, drawn on the server. Null once the sticker is revoked. */
  svg: string | null;
  active: boolean;
  dailyCap: number;
  usedToday: number;
  createdAt: string;
  revokedAt: string | null;
};

type Result = { ok: true; message?: string } | { ok: false; error: string };

export function QrManager({
  cards,
  createAction,
  revokeAction,
}: {
  cards: LinkCard[];
  createAction: (fd: FormData) => Promise<Result>;
  revokeAction: (fd: FormData) => Promise<Result>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [label, setLabel] = useState("Office wardrobe");
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const live = cards.filter((c) => c.active);

  function create() {
    setErr(null); setMsg(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("label", label.trim() || "Office wardrobe");
      const r = await createAction(fd);
      if (!r.ok) setErr(r.error);
      else { setMsg(r.message ?? "Created."); router.refresh(); }
    });
  }

  function revoke(id: string) {
    setErr(null); setMsg(null); setConfirmRevoke(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("link_id", id);
      const r = await revokeAction(fd);
      if (!r.ok) setErr(r.error);
      else { setMsg(r.message ?? "Switched off."); router.refresh(); }
    });
  }

  /**
   * Send one QR to the printer, and only the QR.
   *
   * window.print() prints the page it is called from — the heading, the
   * prose, the link, every other sticker on the screen — and holding that
   * back with print stylesheets means chasing every wrapper the app
   * layout ever grows. So the square is handed to a blank throwaway frame
   * of its own, and that is what the printer sees: one QR, one page.
   */
  function printQr(svg: string) {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.setAttribute("tabindex", "-1");
    frame.style.cssText =
      "position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;";
    document.body.appendChild(frame);

    const doc = frame.contentDocument;
    if (!doc) {
      frame.remove();
      setErr("Could not open the printer — use the browser's own Print instead.");
      return;
    }

    // The QR is drawn on the server by the qrcode package; it is our own
    // markup, not anything a user typed.
    doc.open();
    // Empty <title> on purpose: if the browser's own "Headers and
    // footers" box is ticked, the title is what it prints across the top.
    //
    // One line under the square and nothing else — Daksh, Nov 2026:
    // "under that print qr could you write something like tools keliye
    // scan kre." In Devanagari rather than romanised: the men reading
    // it off a cupboard door read that faster.
    doc.write(
      '<!doctype html><html><head><meta charset="utf-8"><title></title><style>' +
        "@page{margin:12mm}" +
        "html,body{margin:0;padding:0;background:#fff;color:#000}" +
        "svg{display:block;margin:0 auto;width:100%;height:auto;max-width:150mm}" +
        "body{font-family:system-ui,-apple-system,'Segoe UI',Arial,sans-serif;" +
        "text-align:center}" +
        ".a{margin:4mm 0 0;font-size:34pt;line-height:1;font-weight:400}" +
        ".t{margin:1mm 0 0;font-size:24pt;font-weight:700;letter-spacing:-.01em}" +
        "</style></head><body>" + svg +
        '<p class="a">' + SCAN_ARROW + "</p>" +
        '<p class="t">' + SCAN_LINE + "</p></body></html>",
    );
    doc.close();

    let gone = false;
    const drop = () => {
      if (gone) return;
      gone = true;
      frame.remove();
    };
    // Chrome blocks inside print(); Safari returns straight away, so the
    // frame has to outlive the dialog — afterprint takes it down, and the
    // timer is only there in case that event never arrives.
    frame.contentWindow?.addEventListener("afterprint", () => window.setTimeout(drop, 400));
    window.setTimeout(drop, 60_000);

    frame.contentWindow?.focus();
    frame.contentWindow?.print();
  }

  async function copy(url: string, id: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(id);
      window.setTimeout(() => setCopied(null), 1800);
    } catch {
      setErr("Could not copy — select the link and copy it by hand.");
    }
  }

  return (
    <div>
      <style>{CSS}</style>

      {err && <div className="qr-note qr-bad" role="alert">⚠ {err}</div>}
      {msg && <div className="qr-note qr-good" role="status">✓ {msg}</div>}

      {live.length === 0 && (
        <div className="qr-make no-print">
          <h2>Make the wardrobe sticker</h2>
          <p>
            One sticker per door. Name it after the place it will be taped,
            because the register shows that name next to every take recorded
            through it.
          </p>
          <div className="qr-makerow">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Office wardrobe"
              maxLength={60}
              aria-label="Where this sticker will be taped"
            />
            <button type="button" onClick={create} disabled={pending}>
              {pending ? "Making…" : "Make QR"}
            </button>
          </div>
        </div>
      )}

      {cards.map((c) => (
        <article key={c.id} className={`qr-card${c.active ? "" : " is-dead"}`}>
          {c.active && c.svg ? (
            <>
              {/* ── The sticker. The heading names the door so two
                   cards can be told apart on screen; the printer gets
                   the square and the one line under it. ──────────── */}
              <div className="qr-sheet">
                <div className="qr-sheet-head">TOOL STORE · {c.label.toUpperCase()}</div>
                <div className="qr-code" dangerouslySetInnerHTML={{ __html: c.svg }} />
                <div className="qr-sheet-arrow" aria-hidden>{SCAN_ARROW}</div>
                <div className="qr-sheet-scan">{SCAN_LINE}</div>
              </div>

              {/* ── Office-side detail, never printed ───────────── */}
              <div className="qr-meta no-print">
                <div className="qr-metarow">
                  <span className="qr-k">Link</span>
                  <code className="qr-url">{c.url}</code>
                  <button type="button" className="qr-mini" onClick={() => copy(c.url, c.id)}>
                    {copied === c.id ? "Copied" : "Copy"}
                  </button>
                </div>
                <div className="qr-metarow">
                  <span className="qr-k">Today</span>
                  <span className="qr-v">
                    {c.usedToday} take{c.usedToday === 1 ? "" : "s"} recorded
                    <span className="qr-cap"> · pauses at {c.dailyCap}/day</span>
                  </span>
                </div>
                <div className="qr-actions">
                  <button
                    type="button"
                    className="qr-print"
                    onClick={() => c.svg && printQr(c.svg)}
                  >
                    🖨 Print the QR
                  </button>
                  {confirmRevoke === c.id ? (
                    <>
                      <span className="qr-warn">
                        Switch it off? The sticker on the door stops working at once.
                      </span>
                      <button type="button" className="qr-danger" onClick={() => revoke(c.id)} disabled={pending}>
                        Yes, switch off
                      </button>
                      <button type="button" className="qr-mini" onClick={() => setConfirmRevoke(null)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button type="button" className="qr-ghost" onClick={() => setConfirmRevoke(c.id)}>
                      Switch off
                    </button>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="qr-dead no-print">
              <strong>{c.label}</strong>
              <span>
                switched off{c.revokedAt ? ` on ${new Date(c.revokedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}` : ""}.
                Takes already recorded through it are still in the register.
              </span>
            </div>
          )}
        </article>
      ))}

      {live.length > 0 && (
        <div className="qr-make no-print" style={{ marginTop: 18 }}>
          <h2>Another door?</h2>
          <p>A second cupboard or shed gets its own sticker, so the register says which door a tool left by.</p>
          <div className="qr-makerow">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Shed B cupboard"
              maxLength={60}
              aria-label="Where this sticker will be taped"
            />
            <button type="button" onClick={create} disabled={pending}>
              {pending ? "Making…" : "Make another"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** What goes under the printed square, and an arrow pointing back up
 *  at it so there is no doubt what to scan. Kept here so the preview
 *  on screen and the paper can never say different things.
 *
 *  Hinglish, not Devanagari — Daksh, Nov 2026: "instead use tool ke
 *  liya scan kare, and use hinglish." His men read the roman spelling
 *  faster than the script, and "tool" is the word they actually say. */
const SCAN_ARROW = "↑";
const SCAN_LINE = "Tool ke liye scan kare";

const CSS = `
.qr-note { padding:11px 14px; border-radius:10px; font-size:13px; font-weight:600;
  margin-bottom:14px; display:flex; gap:8px; align-items:center; }
.qr-bad { background:rgba(185,28,28,.08); border:1px solid rgba(185,28,28,.35); color:#b91c1c; }
.qr-good { background:rgba(21,128,61,.08); border:1px solid rgba(21,128,61,.35); color:#15803d; }

.qr-make { background:var(--surface); border:1px solid var(--border);
  border-radius:14px; padding:18px 20px; max-width:620px; }
.qr-make h2 { font-size:16px; font-weight:800; margin:0 0 6px; }
.qr-make p { font-size:13px; color:var(--muted); margin:0 0 14px; line-height:1.55; }
.qr-makerow { display:flex; gap:10px; flex-wrap:wrap; }
.qr-makerow input { flex:1 1 220px; min-width:0; padding:12px 14px; font-size:15px;
  border-radius:11px; border:1px solid var(--border); background:var(--surface);
  color:var(--text); outline:none; }
.qr-makerow button { padding:12px 20px; font-size:14px; font-weight:800;
  border-radius:11px; border:none; color:#fff; cursor:pointer;
  background:linear-gradient(135deg, var(--gold) 0%, var(--gold-dark) 100%); }
.qr-makerow button:disabled { background:var(--border); color:var(--muted); cursor:not-allowed; }

.qr-card { margin:18px 0; display:flex; gap:22px; flex-wrap:wrap; align-items:flex-start; }
.qr-card.is-dead { opacity:.75; }

.qr-sheet { background:#fff; color:#111; border:1px solid var(--border);
  border-radius:16px; padding:22px 24px; width:min(380px, 100%);
  text-align:center; box-shadow:0 2px 10px rgba(15,23,42,.06); }
.qr-sheet-head { font-size:11px; font-weight:800; letter-spacing:.14em;
  color:#8a6a2f; margin-bottom:16px; }
.qr-code { display:grid; place-items:center; }
.qr-code svg { width:100%; height:auto; max-width:300px; display:block; }
.qr-sheet-arrow { margin-top:8px; font-size:30px; line-height:1; color:#111; }
.qr-sheet-scan { margin-top:2px; font-size:19px; font-weight:700; color:#111; }

.qr-meta { flex:1 1 300px; min-width:0; display:flex; flex-direction:column; gap:12px; }
.qr-metarow { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
.qr-k { font-size:10.5px; font-weight:800; letter-spacing:.08em;
  text-transform:uppercase; color:var(--muted); min-width:48px; }
.qr-url { font-size:12px; font-family:ui-monospace,monospace; background:var(--surface-alt);
  border:1px solid var(--border-light); border-radius:7px; padding:5px 9px;
  overflow-wrap:anywhere; min-width:0; }
.qr-v { font-size:13px; font-weight:700; }
.qr-cap { font-weight:500; color:var(--muted); }
.qr-actions { display:flex; gap:9px; flex-wrap:wrap; align-items:center; margin-top:4px; }
.qr-print { padding:10px 16px; font-size:13px; font-weight:800; border-radius:10px;
  border:1px solid var(--border); background:var(--surface); color:var(--text); cursor:pointer; }
.qr-ghost { padding:10px 16px; font-size:13px; font-weight:700; border-radius:10px;
  border:1px solid var(--border); background:transparent; color:var(--muted); cursor:pointer; }
.qr-danger { padding:10px 16px; font-size:13px; font-weight:800; border-radius:10px;
  border:1px solid #b91c1c; background:#b91c1c; color:#fff; cursor:pointer; }
.qr-mini { padding:7px 12px; font-size:12px; font-weight:700; border-radius:9px;
  border:1px solid var(--border); background:var(--surface); color:var(--text); cursor:pointer; }
.qr-warn { font-size:12.5px; color:#b91c1c; font-weight:600; flex:1 1 100%; }
.qr-dead { display:flex; flex-direction:column; gap:4px; padding:14px 16px;
  background:var(--surface-alt); border:1px solid var(--border-light);
  border-radius:12px; font-size:13px; }
.qr-dead span { color:var(--muted); line-height:1.5; }

/* The button prints through a frame of its own (printQr), so this block
   only has to keep a stray Ctrl+P honest: the squares, nothing else. */
@media print {
  .no-print, nav, header.topbar, aside,
  .tc-page > header, .qr-sheet-head { display:none !important; }
  .qr-sheet-arrow { font-size:34pt; margin-top:4mm; }
  .qr-sheet-scan { font-size:24pt; margin-top:1mm; }
  .qr-card { page-break-inside:avoid; display:block; }
  .qr-sheet { border:none; box-shadow:none; width:100%; max-width:none;
    padding:0; margin:0 auto; }
  .qr-code svg { width:100%; height:auto; max-width:150mm; }
}
`;
