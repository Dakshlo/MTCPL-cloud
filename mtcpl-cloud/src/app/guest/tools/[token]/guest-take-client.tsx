"use client";

/**
 * The wardrobe screen, in a thumb.
 *
 * Four states, one job each, and never more than one question on screen:
 *
 *   who  → Who are you?        one tap for anyone who has been here before
 *   tool → What are you taking? search + the store's common tools first
 *   qty  → How many?           − / + and one big button
 *   done → a tick, and "Take another" with the person still chosen
 *
 * Built for a phone held one-handed next to an open cupboard: dark so it
 * reads under a workshop light, targets at 56px+, the primary action
 * always at the bottom of the screen where the thumb already is, and no
 * typing at all in the common case.
 */

import { useEffect, useMemo, useRef, useState, useTransition } from "react";

export type KnownPerson = { name: string; vendorId: string; vendorName: string };
export type TakeTool = {
  id: string;
  name: string;
  spec: string | null;
  unit: string;
  stock: number;
  level: "out" | "low" | "ok";
};
type Vendor = { id: string; name: string };
type TakeResult =
  | { ok: true; left: number; toolName: string; qty: number }
  | { ok: false; error: string };

type Step = "who" | "tool" | "qty" | "done";

export function GuestTakeClient({
  token,
  label,
  tools,
  vendors,
  people,
  takeAction,
}: {
  token: string;
  label: string;
  tools: TakeTool[];
  vendors: Vendor[];
  people: KnownPerson[];
  takeAction: (fd: FormData) => Promise<TakeResult>;
}) {
  const [step, setStep] = useState<Step>("who");
  const [who, setWho] = useState<{ name: string; vendorId: string; vendorName: string } | null>(null);
  const [newMode, setNewMode] = useState(false);
  const [typedName, setTypedName] = useState("");
  const [typedVendor, setTypedVendor] = useState<string>("");
  const [tool, setTool] = useState<TakeTool | null>(null);
  const [qty, setQty] = useState(1);
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState<{ toolName: string; qty: number; left: number } | null>(null);
  // What this phone has recorded in this visit — so the person can see
  // their own list growing without the page ever reloading.
  const [tally, setTally] = useState<Array<{ toolName: string; qty: number }>>([]);
  // Local stock, decremented as they take, so the numbers on screen stay
  // honest across several takes without a round trip.
  const [taken, setTaken] = useState<Record<string, number>>({});
  const searchRef = useRef<HTMLInputElement | null>(null);

  const stockOf = (t: TakeTool) => Math.max(0, t.stock - (taken[t.id] ?? 0));

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const live = tools.filter((t) => stockOf(t) > 0);
    if (!needle) return live;
    return live.filter(
      (t) =>
        t.name.toLowerCase().includes(needle) ||
        (t.spec ?? "").toLowerCase().includes(needle),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tools, q, taken]);

  useEffect(() => {
    if (step !== "tool") return;
    // Don't pop the keyboard on arrival — it hides the very list they
    // came for. The search box is one tap away when they want it.
    setQ("");
  }, [step]);

  function chooseKnown(p: KnownPerson) {
    setWho({ name: p.name, vendorId: p.vendorId, vendorName: p.vendorName });
    setErr(null);
    setStep("tool");
  }

  function confirmNew() {
    const name = typedName.trim().replace(/\s+/g, " ");
    if (!name) return;
    const v = vendors.find((x) => x.id === typedVendor);
    if (!v) return;
    setWho({ name, vendorId: v.id, vendorName: v.name });
    setNewMode(false);
    setErr(null);
    setStep("tool");
  }

  function submit() {
    if (!who || !tool) return;
    setErr(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("token", token);
      fd.set("tool_id", tool.id);
      fd.set("vendor_id", who.vendorId);
      fd.set("taken_by", who.name);
      fd.set("qty", String(qty));
      const r = await takeAction(fd);
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      setTaken((prev) => ({ ...prev, [tool.id]: (prev[tool.id] ?? 0) + r.qty }));
      setTally((prev) => [{ toolName: r.toolName, qty: r.qty }, ...prev]);
      setDone({ toolName: r.toolName, qty: r.qty, left: r.left });
      setStep("done");
    });
  }

  function takeAnother() {
    setTool(null);
    setQty(1);
    setDone(null);
    setErr(null);
    setStep("tool");
  }

  const max = tool ? stockOf(tool) : 1;

  return (
    <main className="gt">
      <style>{CSS}</style>

      {/* ── Header: where you are, and who you are once chosen ─────── */}
      <header className="gt-head">
        <div className="gt-brand">
          <span className="gt-dot" aria-hidden />
          <span>Tool store · {label}</span>
        </div>
        {who && step !== "who" && (
          <button
            type="button"
            className="gt-whochip"
            onClick={() => {
              setStep("who");
              setTool(null);
              setDone(null);
              setErr(null);
            }}
          >
            <strong>{who.name}</strong>
            <span>{who.vendorName}</span>
            <span className="gt-swap">change</span>
          </button>
        )}
      </header>

      {err && (
        <div className="gt-err" role="alert">
          <span>{err}</span>
          <button type="button" onClick={() => setErr(null)} aria-label="Close">✕</button>
        </div>
      )}

      {/* ── 1. WHO ─────────────────────────────────────────────────── */}
      {step === "who" && (
        <section className="gt-body">
          <h1 className="gt-q">Who is taking?</h1>
          <p className="gt-sub">कौन ले रहा है?</p>

          {!newMode && (
            <>
              {people.length > 0 && (
                <div className="gt-people">
                  {people.map((p) => (
                    <button
                      key={`${p.name}-${p.vendorId}`}
                      type="button"
                      className="gt-person"
                      onClick={() => chooseKnown(p)}
                    >
                      <span className="gt-ava" aria-hidden>{initials(p.name)}</span>
                      <span className="gt-pmain">
                        <span className="gt-pname">{p.name}</span>
                        <span className="gt-pvendor">{p.vendorName}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
              <button type="button" className="gt-new" onClick={() => setNewMode(true)}>
                ＋ My name is not here
              </button>
              {people.length === 0 && (
                <p className="gt-empty">
                  Nobody has taken anything yet. Tap above to put your name in.
                </p>
              )}
            </>
          )}

          {newMode && (
            <div className="gt-newbox">
              <label className="gt-label" htmlFor="gt-name">Your name</label>
              <input
                id="gt-name"
                className="gt-input"
                value={typedName}
                onChange={(e) => setTypedName(e.target.value)}
                placeholder="Dhanaram"
                maxLength={60}
                autoFocus
                autoComplete="off"
              />

              <label className="gt-label" style={{ marginTop: 18 }}>Which company?</label>
              <div className="gt-vendors">
                {vendors.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    className={`gt-vendor${typedVendor === v.id ? " is-on" : ""}`}
                    onClick={() => setTypedVendor(v.id)}
                  >
                    {v.name}
                  </button>
                ))}
              </div>

              <div className="gt-newactions">
                <button type="button" className="gt-ghost" onClick={() => setNewMode(false)}>
                  Back
                </button>
                <button
                  type="button"
                  className="gt-primary"
                  disabled={!typedName.trim() || !typedVendor}
                  onClick={confirmNew}
                >
                  Continue
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* ── 2. TOOL ────────────────────────────────────────────────── */}
      {step === "tool" && (
        <section className="gt-body">
          <h1 className="gt-q">What are you taking?</h1>
          <p className="gt-sub">क्या ले रहे हैं?</p>

          <div className="gt-search">
            <span aria-hidden>🔍</span>
            <input
              ref={searchRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search a tool…"
              aria-label="Search tools"
              autoComplete="off"
            />
            {q && <button type="button" onClick={() => setQ("")} aria-label="Clear">✕</button>}
          </div>

          {shown.length === 0 ? (
            <p className="gt-empty">
              {q ? `Nothing matches “${q}”.` : "The store has nothing on the shelf. Tell the office."}
            </p>
          ) : (
            <div className="gt-tools">
              {shown.map((t) => {
                const s = stockOf(t);
                const lvl = s <= 0 ? "out" : t.level === "ok" && s > 0 ? levelFor(s, t) : t.level;
                return (
                  <button
                    key={t.id}
                    type="button"
                    className="gt-tool"
                    onClick={() => {
                      setTool(t);
                      setQty(1);
                      setStep("qty");
                    }}
                  >
                    <span className={`gt-stock is-${lvl}`}>{s}</span>
                    <span className="gt-tmain">
                      <span className="gt-tname">{t.name}</span>
                      <span className="gt-tmeta">
                        {t.spec ? `${t.spec} · ` : ""}
                        {lvl === "low" ? "running low" : `${t.unit} on the shelf`}
                      </span>
                    </span>
                    <span className="gt-chev" aria-hidden>›</span>
                  </button>
                );
              })}
            </div>
          )}

          {tally.length > 0 && (
            <div className="gt-tally">
              <p className="gt-tallyhead">Taken just now</p>
              {tally.map((t, i) => (
                <div key={i} className="gt-tallyrow">
                  <span className="gt-tallyqty">{t.qty}</span>
                  <span>{t.toolName}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── 3. QTY ─────────────────────────────────────────────────── */}
      {step === "qty" && tool && (
        <section className="gt-body gt-qty">
          <button type="button" className="gt-back" onClick={() => setStep("tool")}>
            ‹ Back
          </button>

          <h1 className="gt-q">How many?</h1>
          <p className="gt-sub">कितने?</p>

          <div className="gt-toolcard">
            <div className="gt-tname lg">{tool.name}</div>
            {tool.spec && <div className="gt-tmeta">{tool.spec}</div>}
            <div className="gt-tmeta">{stockOf(tool)} {tool.unit} on the shelf</div>
          </div>

          <div className="gt-stepper">
            <button
              type="button"
              onClick={() => setQty((n) => Math.max(1, n - 1))}
              disabled={qty <= 1}
              aria-label="One less"
            >
              −
            </button>
            <span className="gt-qtynum">{qty}</span>
            <button
              type="button"
              onClick={() => setQty((n) => Math.min(max, n + 1))}
              disabled={qty >= max}
              aria-label="One more"
            >
              ＋
            </button>
          </div>

          {max > 1 && (
            <div className="gt-quick">
              {[1, 2, 5, 10].filter((n) => n <= max).map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`gt-quickbtn${qty === n ? " is-on" : ""}`}
                  onClick={() => setQty(n)}
                >
                  {n}
                </button>
              ))}
            </div>
          )}

          <div className="gt-bottom">
            <button type="button" className="gt-primary gt-big" onClick={submit} disabled={pending}>
              {pending ? "Recording…" : `Take ${qty} × ${tool.name}`}
            </button>
            <p className="gt-fine">
              Recorded as <strong>{who?.name}</strong> · {who?.vendorName}
            </p>
          </div>
        </section>
      )}

      {/* ── 4. DONE ────────────────────────────────────────────────── */}
      {step === "done" && done && (
        <section className="gt-body gt-done">
          <div className="gt-tick" aria-hidden>✓</div>
          <h1 className="gt-q">Written in the register</h1>
          <p className="gt-doneline">
            <strong>{done.qty} × {done.toolName}</strong>
          </p>
          <p className="gt-sub">
            {done.left} left on the shelf · recorded as {who?.name}
          </p>

          {tally.length > 1 && (
            <div className="gt-tally">
              <p className="gt-tallyhead">Everything you took just now</p>
              {tally.map((t, i) => (
                <div key={i} className="gt-tallyrow">
                  <span className="gt-tallyqty">{t.qty}</span>
                  <span>{t.toolName}</span>
                </div>
              ))}
            </div>
          )}

          <div className="gt-bottom">
            <button type="button" className="gt-primary gt-big" onClick={takeAnother}>
              Take another
            </button>
            <button
              type="button"
              className="gt-ghost gt-wide"
              onClick={() => {
                setWho(null);
                setTool(null);
                setDone(null);
                setTally([]);
                setStep("who");
              }}
            >
              Done — next person
            </button>
          </div>
        </section>
      )}
    </main>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Local re-grade after this visit's takes, so a tool that just ran low
 *  on this phone says so without waiting for a page reload. */
function levelFor(stock: number, t: TakeTool): "out" | "low" | "ok" {
  if (stock <= 0) return "out";
  // The server's own low line is not sent down; three is the store's
  // default warn line (DEFAULT_LOW_STOCK) and is the right hint here.
  return stock <= 3 ? "low" : "ok";
}

const CSS = `
.gt {
  --bg:#0f1115; --card:#171a20; --card2:#1d2128; --line:#282d36;
  --ink:#eceef1; --muted:#9aa1ab; --gold:#e3b23c; --gold-ink:#1a1407;
  --ok:#4ade80; --low:#fbbf24; --out:#f87171;
  min-height:100dvh; background:var(--bg); color:var(--ink);
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;
  display:flex; flex-direction:column;
  padding-bottom:env(safe-area-inset-bottom,0px);
  -webkit-tap-highlight-color:transparent;
}
.gt * { box-sizing:border-box; }
.gt button { font-family:inherit; }

.gt-head {
  position:sticky; top:0; z-index:5; background:rgba(15,17,21,0.92);
  backdrop-filter:blur(8px); border-bottom:1px solid var(--line);
  padding:calc(12px + env(safe-area-inset-top,0px)) 16px 12px;
  display:flex; align-items:center; gap:10px; flex-wrap:wrap;
}
.gt-brand { display:flex; align-items:center; gap:8px; font-size:12px;
  font-weight:800; letter-spacing:.06em; text-transform:uppercase; color:var(--muted); }
.gt-dot { width:8px; height:8px; border-radius:50%; background:var(--gold);
  box-shadow:0 0 0 3px rgba(227,178,60,.18); }
.gt-whochip { margin-left:auto; display:flex; align-items:center; gap:8px;
  background:var(--card2); border:1px solid var(--line); border-radius:999px;
  padding:6px 12px; color:var(--ink); font-size:12.5px; cursor:pointer; }
.gt-whochip strong { font-weight:800; }
.gt-whochip span { color:var(--muted); }
.gt-swap { font-size:10.5px; font-weight:800; text-transform:uppercase;
  letter-spacing:.06em; color:var(--gold) !important; }

.gt-body { flex:1; padding:22px 16px 28px; display:flex; flex-direction:column; }
.gt-q { font-size:26px; font-weight:800; letter-spacing:-.02em; margin:0; }
.gt-sub { font-size:14px; color:var(--muted); margin:4px 0 20px; }

.gt-err { margin:12px 16px 0; display:flex; gap:10px; align-items:center;
  background:rgba(248,113,113,.12); border:1px solid rgba(248,113,113,.4);
  color:#fecaca; border-radius:12px; padding:12px 14px; font-size:13.5px; line-height:1.45; }
.gt-err button { margin-left:auto; background:none; border:none; color:inherit;
  font-size:16px; cursor:pointer; flex:0 0 auto; }

.gt-people { display:flex; flex-direction:column; gap:8px; }
.gt-person { display:flex; align-items:center; gap:12px; width:100%;
  background:var(--card); border:1px solid var(--line); border-radius:14px;
  padding:12px 14px; min-height:62px; cursor:pointer; text-align:left; color:var(--ink); }
.gt-person:active { background:var(--card2); }
.gt-ava { width:40px; height:40px; border-radius:50%; flex:0 0 auto;
  display:grid; place-items:center; background:rgba(227,178,60,.16);
  color:var(--gold); font-size:13px; font-weight:800; }
.gt-pmain { display:flex; flex-direction:column; min-width:0; }
.gt-pname { font-size:16px; font-weight:700; }
.gt-pvendor { font-size:12.5px; color:var(--muted); }

.gt-new { margin-top:12px; width:100%; min-height:56px; border-radius:14px;
  background:transparent; border:1.5px dashed var(--line); color:var(--muted);
  font-size:15px; font-weight:700; cursor:pointer; }
.gt-new:active { background:var(--card); }

.gt-empty { color:var(--muted); font-size:14px; line-height:1.6; margin-top:16px; }

.gt-newbox { display:flex; flex-direction:column; }
.gt-label { font-size:11px; font-weight:800; letter-spacing:.08em;
  text-transform:uppercase; color:var(--muted); margin-bottom:8px; }
.gt-input { width:100%; min-height:58px; border-radius:14px; padding:0 16px;
  font-size:17px; background:var(--card); border:1px solid var(--line);
  color:var(--ink); outline:none; }
.gt-input:focus { border-color:var(--gold); }
.gt-vendors { display:flex; flex-direction:column; gap:8px; }
.gt-vendor { min-height:56px; border-radius:14px; background:var(--card);
  border:1px solid var(--line); color:var(--ink); font-size:15.5px;
  font-weight:700; cursor:pointer; }
.gt-vendor.is-on { background:rgba(227,178,60,.14); border-color:var(--gold); color:var(--gold); }
.gt-newactions { display:flex; gap:10px; margin-top:24px; }

.gt-primary { min-height:58px; border-radius:14px; border:none;
  background:var(--gold); color:var(--gold-ink); font-size:16px; font-weight:800;
  cursor:pointer; flex:1; }
.gt-primary:disabled { background:var(--line); color:var(--muted); cursor:not-allowed; }
.gt-big { width:100%; min-height:64px; font-size:17px; }
.gt-ghost { min-height:58px; border-radius:14px; background:transparent;
  border:1px solid var(--line); color:var(--muted); font-size:15px;
  font-weight:700; cursor:pointer; padding:0 22px; }
.gt-wide { width:100%; margin-top:10px; }

.gt-search { display:flex; align-items:center; gap:10px; background:var(--card);
  border:1px solid var(--line); border-radius:14px; padding:0 14px;
  min-height:54px; margin-bottom:14px; }
.gt-search input { flex:1; background:none; border:none; outline:none;
  color:var(--ink); font-size:16px; min-width:0; }
.gt-search button { background:none; border:none; color:var(--muted);
  font-size:15px; cursor:pointer; }

.gt-tools { display:flex; flex-direction:column; gap:8px; }
.gt-tool { display:flex; align-items:center; gap:12px; width:100%;
  background:var(--card); border:1px solid var(--line); border-radius:14px;
  padding:12px 14px; min-height:68px; cursor:pointer; text-align:left; color:var(--ink); }
.gt-tool:active { background:var(--card2); }
.gt-stock { width:44px; height:44px; border-radius:12px; flex:0 0 auto;
  display:grid; place-items:center; font-size:16px; font-weight:800;
  font-variant-numeric:tabular-nums; }
.gt-stock.is-ok { background:rgba(74,222,128,.14); color:var(--ok); }
.gt-stock.is-low { background:rgba(251,191,36,.16); color:var(--low); }
.gt-stock.is-out { background:rgba(248,113,113,.16); color:var(--out); }
.gt-tmain { display:flex; flex-direction:column; min-width:0; flex:1; }
.gt-tname { font-size:16px; font-weight:700; overflow-wrap:anywhere; }
.gt-tname.lg { font-size:21px; }
.gt-tmeta { font-size:12.5px; color:var(--muted); }
.gt-chev { color:var(--muted); font-size:20px; flex:0 0 auto; }

.gt-back { align-self:flex-start; background:none; border:none; color:var(--muted);
  font-size:15px; font-weight:700; padding:0 0 10px; cursor:pointer; }
.gt-toolcard { background:var(--card); border:1px solid var(--line);
  border-radius:16px; padding:16px; margin-bottom:22px; }
.gt-stepper { display:flex; align-items:center; justify-content:center; gap:22px; }
.gt-stepper button { width:72px; height:72px; border-radius:50%;
  background:var(--card2); border:1px solid var(--line); color:var(--ink);
  font-size:30px; font-weight:700; cursor:pointer; }
.gt-stepper button:disabled { opacity:.35; cursor:not-allowed; }
.gt-qtynum { font-size:56px; font-weight:800; min-width:88px; text-align:center;
  font-variant-numeric:tabular-nums; }
.gt-quick { display:flex; gap:8px; justify-content:center; margin-top:20px; }
.gt-quickbtn { min-width:56px; min-height:44px; border-radius:12px;
  background:var(--card); border:1px solid var(--line); color:var(--muted);
  font-size:15px; font-weight:700; cursor:pointer; }
.gt-quickbtn.is-on { background:rgba(227,178,60,.14); border-color:var(--gold); color:var(--gold); }

.gt-bottom { margin-top:auto; padding-top:26px; }
.gt-fine { text-align:center; font-size:12.5px; color:var(--muted); margin:10px 0 0; }

.gt-done { align-items:center; text-align:center; }
.gt-tick { width:76px; height:76px; border-radius:50%; display:grid;
  place-items:center; font-size:38px; font-weight:800;
  background:rgba(74,222,128,.14); color:var(--ok); margin-bottom:18px; }
.gt-doneline { font-size:19px; margin:6px 0 0; }
.gt-done .gt-bottom { width:100%; }

.gt-tally { margin-top:24px; border-top:1px solid var(--line); padding-top:14px; width:100%; }
.gt-tallyhead { font-size:11px; font-weight:800; letter-spacing:.08em;
  text-transform:uppercase; color:var(--muted); margin:0 0 10px; }
.gt-tallyrow { display:flex; align-items:center; gap:12px; padding:7px 0;
  font-size:14.5px; text-align:left; }
.gt-tallyqty { min-width:30px; height:30px; border-radius:8px; display:grid;
  place-items:center; background:var(--card2); color:var(--gold);
  font-size:13px; font-weight:800; }

@media (prefers-reduced-motion: no-preference) {
  .gt-tick { animation: gt-pop .32s ease-out; }
  @keyframes gt-pop { from { transform:scale(.7); opacity:0; } to { transform:scale(1); opacity:1; } }
}
`;
