"use client";

/**
 * Sticker manager: create one, print it, switch it off.
 *
 * The print layout is the point — what comes out of the printer should be
 * ready to tape to a cupboard with no trimming and no explaining, so the
 * printed sheet carries the QR, the words a worker needs, and nothing
 * else from the app.
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
              {/* ── What gets printed ───────────────────────────── */}
              <div className="qr-sheet">
                <div className="qr-sheet-head">TOOL STORE · {c.label.toUpperCase()}</div>
                <div className="qr-code" dangerouslySetInnerHTML={{ __html: c.svg }} />
                <div className="qr-sheet-line1">Taking a tool? Scan this first.</div>
                <div className="qr-sheet-line2">कोई भी औज़ार ले रहे हैं? पहले इसे स्कैन करें।</div>
                <div className="qr-sheet-foot">
                  Say your name, pick the tool, done. No login needed.
                </div>
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
                  <button type="button" className="qr-print" onClick={() => window.print()}>
                    🖨 Print the sticker
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
  border-radius:16px; padding:26px 24px 22px; width:min(380px, 100%);
  text-align:center; box-shadow:0 2px 10px rgba(15,23,42,.06); }
.qr-sheet-head { font-size:11px; font-weight:800; letter-spacing:.14em;
  color:#8a6a2f; margin-bottom:16px; }
.qr-code { display:grid; place-items:center; }
.qr-code svg { width:100%; height:auto; max-width:300px; display:block; }
.qr-sheet-line1 { font-size:19px; font-weight:800; margin-top:16px; letter-spacing:-.01em; }
.qr-sheet-line2 { font-size:16px; font-weight:700; margin-top:6px; color:#333; }
.qr-sheet-foot { font-size:12.5px; color:#666; margin-top:12px; line-height:1.5; }

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

@media print {
  .no-print, nav, header.topbar, aside { display:none !important; }
  .qr-card { page-break-inside:avoid; display:block; }
  .qr-sheet { border:none; box-shadow:none; width:100%; max-width:none;
    padding:0; margin:0 auto; }
  .qr-code svg { max-width:420px; }
  .qr-sheet-line1 { font-size:26px; }
  .qr-sheet-line2 { font-size:21px; }
  .qr-sheet-foot { font-size:14px; }
}
`;
