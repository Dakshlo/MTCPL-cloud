"use client";

/**
 * The wardrobe screen, in a thumb. Light, because the cupboard is in a
 * bright office and this gets read at arm's length.
 *
 * Signing in (migs 230):
 *   name → a 4-digit code to that person's own phone → in for the shift
 *
 * Then, one question per screen:
 *   tool → what are you taking?   search + the store's common tools first
 *   qty  → how many?              big − / + , never more than the shelf
 *   done → a tick, and "Take another" with the person still signed in
 *
 * Everything here is take-only. Adding stock, scrap and fix-count are
 * not in this file because they are not reachable from this door.
 */

import { useEffect, useMemo, useRef, useState, useTransition } from "react";

export type TakeTool = {
  id: string;
  name: string;
  spec: string | null;
  unit: string;
  stock: number;
  level: "out" | "low" | "ok";
};
export type RosterPerson = {
  id: string;
  name: string;
  vendorId: string | null;
  vendorName: string | null;
  maskedPhone: string;
};
type Vendor = { id: string; name: string };
type Session = { name: string; vendorId: string | null; vendorName: string | null };

type SendRes = { ok: true; sentTo: string } | { ok: false; error: string };
type VerifyRes =
  | { ok: true; name: string; vendorId: string | null; vendorName: string | null; needsVendor: boolean }
  | { ok: false; error: string; attemptsLeft?: number };
type TakeRes =
  | { ok: true; left: number; toolName: string; qty: number }
  | { ok: false; error: string; signedOut?: boolean };

type Step = "who" | "code" | "company" | "tool" | "qty" | "done";

const DIGITS = 4;

export function GuestTakeClient({
  token, label, tools, roster, vendors, session,
  sendCodeAction, verifyCodeAction, setVendorAction, signOutAction, takeAction,
}: {
  token: string;
  label: string;
  tools: TakeTool[];
  roster: RosterPerson[];
  vendors: Vendor[];
  session: Session | null;
  sendCodeAction: (fd: FormData) => Promise<SendRes>;
  verifyCodeAction: (fd: FormData) => Promise<VerifyRes>;
  setVendorAction: (fd: FormData) => Promise<{ ok: boolean; error?: string }>;
  signOutAction: (fd: FormData) => Promise<{ ok: boolean }>;
  takeAction: (fd: FormData) => Promise<TakeRes>;
}) {
  const [who, setWho] = useState<Session | null>(session);
  const [step, setStep] = useState<Step>(
    session ? (session.vendorId ? "tool" : "company") : "who",
  );
  const [picked, setPicked] = useState<RosterPerson | null>(null);
  const [sentTo, setSentTo] = useState("");
  const [code, setCode] = useState("");
  const [tool, setTool] = useState<TakeTool | null>(null);
  const [qty, setQty] = useState(1);
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState<{ toolName: string; qty: number; left: number } | null>(null);
  const [tally, setTally] = useState<Array<{ toolName: string; qty: number }>>([]);
  const [taken, setTaken] = useState<Record<string, number>>({});
  const [cooldown, setCooldown] = useState(0);
  const codeRef = useRef<HTMLInputElement | null>(null);

  const stockOf = (t: TakeTool) => Math.max(0, t.stock - (taken[t.id] ?? 0));

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const live = tools.filter((t) => stockOf(t) > 0);
    if (!needle) return live;
    return live.filter(
      (t) => t.name.toLowerCase().includes(needle) || (t.spec ?? "").toLowerCase().includes(needle),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tools, q, taken]);

  // "Send again" is deliberately slow to come back — every tap is a real
  // SMS to somebody's phone.
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = window.setTimeout(() => setCooldown((n) => n - 1), 1000);
    return () => window.clearTimeout(id);
  }, [cooldown]);

  useEffect(() => {
    if (step === "code") {
      const id = window.setTimeout(() => codeRef.current?.focus(), 120);
      return () => window.clearTimeout(id);
    }
  }, [step]);

  function sendCode(p: RosterPerson) {
    setPicked(p);
    setErr(null);
    setCode("");
    startTransition(async () => {
      const fd = new FormData();
      fd.set("token", token);
      fd.set("profile_id", p.id);
      const r = await sendCodeAction(fd);
      if (!r.ok) { setErr(r.error); return; }
      setSentTo(r.sentTo);
      setCooldown(30);
      setStep("code");
    });
  }

  function verify(typed: string) {
    if (!picked || typed.length !== DIGITS) return;
    setErr(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("token", token);
      fd.set("profile_id", picked.id);
      fd.set("code", typed);
      const r = await verifyCodeAction(fd);
      if (!r.ok) {
        setErr(r.attemptsLeft != null ? `${r.error} ${r.attemptsLeft} ${r.attemptsLeft === 1 ? "try" : "tries"} left.` : r.error);
        setCode("");
        codeRef.current?.focus();
        return;
      }
      setWho({ name: r.name, vendorId: r.vendorId, vendorName: r.vendorName });
      setStep(r.needsVendor ? "company" : "tool");
    });
  }

  function chooseCompany(v: Vendor) {
    setErr(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("token", token);
      fd.set("vendor_id", v.id);
      const r = await setVendorAction(fd);
      if (!r.ok) { setErr(r.error ?? "Could not set the company."); return; }
      setWho((w) => (w ? { ...w, vendorId: v.id, vendorName: v.name } : w));
      setStep("tool");
    });
  }

  function submit() {
    if (!tool) return;
    setErr(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("token", token);
      fd.set("tool_id", tool.id);
      fd.set("qty", String(qty));
      const r = await takeAction(fd);
      if (!r.ok) {
        setErr(r.error);
        if (r.signedOut) { setWho(null); setPicked(null); setStep("who"); }
        return;
      }
      setTaken((p) => ({ ...p, [tool.id]: (p[tool.id] ?? 0) + r.qty }));
      setTally((p) => [{ toolName: r.toolName, qty: r.qty }, ...p]);
      setDone({ toolName: r.toolName, qty: r.qty, left: r.left });
      setStep("done");
    });
  }

  function signOut() {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("token", token);
      await signOutAction(fd);
      setWho(null); setPicked(null); setTally([]); setTaken({});
      setTool(null); setDone(null); setCode(""); setErr(null);
      setStep("who");
    });
  }

  const max = tool ? stockOf(tool) : 1;

  return (
    <main className="gt">
      <style>{CSS}</style>

      <header className="gt-head">
        <div className="gt-brand">
          <span className="gt-dot" aria-hidden />
          <span>Tool store · {label}</span>
        </div>
        {who && (
          <button type="button" className="gt-whochip" onClick={signOut} disabled={pending}>
            <span className="gt-ava sm" aria-hidden>{initials(who.name)}</span>
            <span className="gt-whotext">
              <strong>{who.name}</strong>
              {who.vendorName && <span>{who.vendorName}</span>}
            </span>
            <span className="gt-out">Sign out</span>
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
          <p className="gt-sub">कौन ले रहा है? · एक कोड आपके फ़ोन पर आएगा</p>

          {roster.length === 0 ? (
            <p className="gt-empty">
              Nobody is set up to take tools yet. The office has to add people first.
            </p>
          ) : (
            <div className="gt-people">
              {roster.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="gt-person"
                  onClick={() => sendCode(p)}
                  disabled={pending}
                >
                  <span className="gt-ava" aria-hidden>{initials(p.name)}</span>
                  <span className="gt-pmain">
                    <span className="gt-pname">{p.name}</span>
                    <span className="gt-pvendor">
                      {p.vendorName ?? "Office"} · code to {p.maskedPhone}
                    </span>
                  </span>
                  <span className="gt-chev" aria-hidden>›</span>
                </button>
              ))}
            </div>
          )}
          <p className="gt-fineprint">
            Only these people can take from the store. The code goes to the
            number already saved for them — nothing can be typed in here.
          </p>
        </section>
      )}

      {/* ── 2. CODE ────────────────────────────────────────────────── */}
      {step === "code" && picked && (
        <section className="gt-body">
          <button type="button" className="gt-back" onClick={() => { setStep("who"); setErr(null); }}>
            ‹ Not you?
          </button>
          <h1 className="gt-q">Enter the code</h1>
          <p className="gt-sub">
            Sent to {sentTo} · {picked.name}
          </p>

          <div className="gt-otpwrap">
            <input
              ref={codeRef}
              className="gt-otp"
              value={code}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, "").slice(0, DIGITS);
                setCode(v);
                if (v.length === DIGITS) verify(v);
              }}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={DIGITS}
              placeholder="····"
              aria-label={`${DIGITS} digit code`}
              disabled={pending}
            />
            <div className="gt-otpdots" aria-hidden>
              {Array.from({ length: DIGITS }).map((_, i) => (
                <span key={i} className={`gt-otpdot${i < code.length ? " is-on" : ""}`} />
              ))}
            </div>
          </div>

          {pending && <p className="gt-checking">Checking…</p>}

          <button
            type="button"
            className="gt-resend"
            disabled={cooldown > 0 || pending}
            onClick={() => picked && sendCode(picked)}
          >
            {cooldown > 0 ? `Send again in ${cooldown}s` : "Send the code again"}
          </button>
          <p className="gt-fineprint">
            The code lasts 10 minutes. Three wrong tries and it stops working —
            ask for a new one.
          </p>
        </section>
      )}

      {/* ── 2b. COMPANY (developer only) ───────────────────────────── */}
      {step === "company" && (
        <section className="gt-body">
          <h1 className="gt-q">Taking for which company?</h1>
          <p className="gt-sub">किस कंपनी के लिए?</p>
          <div className="gt-people">
            {vendors.map((v) => (
              <button
                key={v.id}
                type="button"
                className="gt-person"
                onClick={() => chooseCompany(v)}
                disabled={pending}
              >
                <span className="gt-ava" aria-hidden>{initials(v.name)}</span>
                <span className="gt-pmain"><span className="gt-pname">{v.name}</span></span>
                <span className="gt-chev" aria-hidden>›</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ── 3. TOOL ────────────────────────────────────────────────── */}
      {step === "tool" && (
        <section className="gt-body">
          <h1 className="gt-q">What are you taking?</h1>
          <p className="gt-sub">क्या ले रहे हैं?</p>

          <div className="gt-search">
            <span aria-hidden>🔍</span>
            <input
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
                const lvl = s <= 0 ? "out" : s <= 3 ? "low" : "ok";
                return (
                  <button
                    key={t.id}
                    type="button"
                    className="gt-tool"
                    onClick={() => { setTool(t); setQty(1); setStep("qty"); }}
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

      {/* ── 4. QTY ─────────────────────────────────────────────────── */}
      {step === "qty" && tool && (
        <section className="gt-body gt-qtystep">
          <button type="button" className="gt-back" onClick={() => setStep("tool")}>‹ Back</button>
          <h1 className="gt-q">How many?</h1>
          <p className="gt-sub">कितने?</p>

          <div className="gt-toolcard">
            <div className="gt-tname lg">{tool.name}</div>
            {tool.spec && <div className="gt-tmeta">{tool.spec}</div>}
            <div className="gt-tmeta">{stockOf(tool)} {tool.unit} on the shelf</div>
          </div>

          <div className="gt-stepper">
            <button type="button" onClick={() => setQty((n) => Math.max(1, n - 1))} disabled={qty <= 1} aria-label="One less">−</button>
            <span className="gt-qtynum">{qty}</span>
            <button type="button" onClick={() => setQty((n) => Math.min(max, n + 1))} disabled={qty >= max} aria-label="One more">＋</button>
          </div>

          {max > 1 && (
            <div className="gt-quick">
              {[1, 2, 5, 10].filter((n) => n <= max).map((n) => (
                <button key={n} type="button" className={`gt-quickbtn${qty === n ? " is-on" : ""}`} onClick={() => setQty(n)}>
                  {n}
                </button>
              ))}
            </div>
          )}

          <div className="gt-bottom">
            <button type="button" className="gt-primary gt-big" onClick={submit} disabled={pending}>
              {pending ? "Recording…" : `Take ${qty} × ${tool.name}`}
            </button>
            <p className="gt-fine">Signed by <strong>{who?.name}</strong> · {who?.vendorName}</p>
          </div>
        </section>
      )}

      {/* ── 5. DONE ────────────────────────────────────────────────── */}
      {step === "done" && done && (
        <section className="gt-body gt-done">
          <div className="gt-tick" aria-hidden>✓</div>
          <h1 className="gt-q">Written in the register</h1>
          <p className="gt-doneline"><strong>{done.qty} × {done.toolName}</strong></p>
          <p className="gt-sub">{done.left} left on the shelf · signed by {who?.name}</p>

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
            <button
              type="button"
              className="gt-primary gt-big"
              onClick={() => { setTool(null); setQty(1); setDone(null); setStep("tool"); }}
            >
              Take another
            </button>
            <button type="button" className="gt-ghost gt-wide" onClick={signOut} disabled={pending}>
              Done — sign out
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

const CSS = `
.gt {
  --bg:#f4f5f7; --card:#ffffff; --line:#e3e6ea; --line2:#eef0f3;
  --ink:#171a1f; --muted:#5f6773;
  --gold:#a67b28; --gold-bg:#fbf4e4; --gold-line:#e7d2a2;
  --ok:#157f4a; --ok-bg:#e7f6ed; --low:#9a6400; --low-bg:#fdf3e0;
  --out:#b3261e; --out-bg:#fdecea;
  min-height:100dvh; background:var(--bg); color:var(--ink);
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;
  display:flex; flex-direction:column;
  padding-bottom:env(safe-area-inset-bottom,0px);
  -webkit-tap-highlight-color:transparent;
}
.gt * { box-sizing:border-box; }
.gt button { font-family:inherit; }

.gt-head { position:sticky; top:0; z-index:5; background:rgba(244,245,247,.94);
  backdrop-filter:blur(8px); border-bottom:1px solid var(--line);
  padding:calc(12px + env(safe-area-inset-top,0px)) 16px 12px;
  display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.gt-brand { display:flex; align-items:center; gap:8px; font-size:11.5px;
  font-weight:800; letter-spacing:.07em; text-transform:uppercase; color:var(--muted); }
.gt-dot { width:8px; height:8px; border-radius:50%; background:var(--gold);
  box-shadow:0 0 0 3px rgba(166,123,40,.16); }
.gt-whochip { margin-left:auto; display:flex; align-items:center; gap:9px;
  background:var(--card); border:1px solid var(--line); border-radius:999px;
  padding:5px 7px 5px 5px; color:var(--ink); cursor:pointer; }
.gt-whotext { display:flex; flex-direction:column; line-height:1.2; text-align:left; }
.gt-whotext strong { font-size:12.5px; font-weight:800; }
.gt-whotext span { font-size:10.5px; color:var(--muted); }
.gt-out { font-size:10.5px; font-weight:800; text-transform:uppercase;
  letter-spacing:.05em; color:var(--gold); padding-left:4px; }

.gt-body { flex:1; padding:24px 16px 28px; display:flex; flex-direction:column; }
.gt-q { font-size:27px; font-weight:800; letter-spacing:-.025em; margin:0; line-height:1.15; }
.gt-sub { font-size:14px; color:var(--muted); margin:6px 0 22px; line-height:1.45; }

.gt-err { margin:12px 16px 0; display:flex; gap:10px; align-items:flex-start;
  background:var(--out-bg); border:1px solid rgba(179,38,30,.3);
  color:#8c1d18; border-radius:12px; padding:12px 14px; font-size:13.5px; line-height:1.45; }
.gt-err button { margin-left:auto; background:none; border:none; color:inherit;
  font-size:16px; cursor:pointer; flex:0 0 auto; }

.gt-people { display:flex; flex-direction:column; gap:10px; }
.gt-person { display:flex; align-items:center; gap:13px; width:100%;
  background:var(--card); border:1px solid var(--line); border-radius:16px;
  padding:13px 14px; min-height:72px; cursor:pointer; text-align:left; color:var(--ink);
  box-shadow:0 1px 2px rgba(16,24,40,.04); }
.gt-person:active { background:#fafbfc; }
.gt-person:disabled { opacity:.55; }
.gt-ava { width:44px; height:44px; border-radius:14px; flex:0 0 auto;
  display:grid; place-items:center; background:var(--gold-bg);
  color:var(--gold); font-size:14px; font-weight:800; border:1px solid var(--gold-line); }
.gt-ava.sm { width:28px; height:28px; border-radius:9px; font-size:10.5px; }
.gt-pmain { display:flex; flex-direction:column; min-width:0; flex:1; }
.gt-pname { font-size:17px; font-weight:750; }
.gt-pvendor { font-size:12.5px; color:var(--muted); margin-top:2px; }

.gt-empty { color:var(--muted); font-size:14.5px; line-height:1.6; margin-top:14px; }
.gt-fineprint { margin-top:auto; padding-top:26px; font-size:12px; color:var(--muted);
  line-height:1.55; }

.gt-back { align-self:flex-start; background:none; border:none; color:var(--muted);
  font-size:15px; font-weight:700; padding:0 0 12px; cursor:pointer; }

.gt-otpwrap { position:relative; margin-top:6px; }
.gt-otp { width:100%; height:86px; border-radius:18px; border:1.5px solid var(--line);
  background:var(--card); color:transparent; caret-color:transparent;
  font-size:1px; text-align:center; outline:none; }
.gt-otp:focus { border-color:var(--gold); box-shadow:0 0 0 4px rgba(166,123,40,.1); }
.gt-otpdots { position:absolute; inset:0; display:flex; align-items:center;
  justify-content:center; gap:16px; pointer-events:none; }
.gt-otpdot { width:48px; height:58px; border-radius:14px; background:#f7f8fa;
  border:1.5px solid var(--line); }
.gt-otpdot.is-on { background:var(--gold-bg); border-color:var(--gold);
  box-shadow:inset 0 0 0 10px var(--card); }
.gt-checking { text-align:center; font-size:13px; color:var(--muted); margin:14px 0 0; }
.gt-resend { margin-top:20px; width:100%; min-height:52px; border-radius:14px;
  background:transparent; border:1px solid var(--line); color:var(--ink);
  font-size:14.5px; font-weight:700; cursor:pointer; }
.gt-resend:disabled { color:var(--muted); cursor:not-allowed; }

.gt-primary { min-height:58px; border-radius:15px; border:none;
  background:var(--gold); color:#fff; font-size:16px; font-weight:800;
  cursor:pointer; flex:1; box-shadow:0 2px 8px rgba(166,123,40,.25); }
.gt-primary:disabled { background:#d7dbe0; color:#8b929b; box-shadow:none; cursor:not-allowed; }
.gt-big { width:100%; min-height:64px; font-size:17px; }
.gt-ghost { min-height:56px; border-radius:15px; background:transparent;
  border:1px solid var(--line); color:var(--muted); font-size:15px;
  font-weight:700; cursor:pointer; padding:0 22px; }
.gt-wide { width:100%; margin-top:10px; }

.gt-search { display:flex; align-items:center; gap:10px; background:var(--card);
  border:1px solid var(--line); border-radius:15px; padding:0 14px;
  min-height:54px; margin-bottom:14px; }
.gt-search input { flex:1; background:none; border:none; outline:none;
  color:var(--ink); font-size:16px; min-width:0; }
.gt-search button { background:none; border:none; color:var(--muted);
  font-size:15px; cursor:pointer; }

.gt-tools { display:flex; flex-direction:column; gap:10px; }
.gt-tool { display:flex; align-items:center; gap:13px; width:100%;
  background:var(--card); border:1px solid var(--line); border-radius:16px;
  padding:13px 14px; min-height:74px; cursor:pointer; text-align:left; color:var(--ink);
  box-shadow:0 1px 2px rgba(16,24,40,.04); }
.gt-tool:active { background:#fafbfc; }
.gt-stock { width:48px; height:48px; border-radius:14px; flex:0 0 auto;
  display:grid; place-items:center; font-size:18px; font-weight:800;
  font-variant-numeric:tabular-nums; }
.gt-stock.is-ok { background:var(--ok-bg); color:var(--ok); }
.gt-stock.is-low { background:var(--low-bg); color:var(--low); }
.gt-stock.is-out { background:var(--out-bg); color:var(--out); }
.gt-tmain { display:flex; flex-direction:column; min-width:0; flex:1; }
.gt-tname { font-size:16.5px; font-weight:750; overflow-wrap:anywhere; }
.gt-tname.lg { font-size:22px; font-weight:800; }
.gt-tmeta { font-size:12.5px; color:var(--muted); margin-top:2px; }
.gt-chev { color:#b6bcc5; font-size:21px; flex:0 0 auto; }

.gt-toolcard { background:var(--card); border:1px solid var(--line);
  border-radius:18px; padding:18px; margin-bottom:26px;
  box-shadow:0 1px 2px rgba(16,24,40,.04); }
.gt-stepper { display:flex; align-items:center; justify-content:center; gap:24px; }
.gt-stepper button { width:76px; height:76px; border-radius:50%;
  background:var(--card); border:1.5px solid var(--line); color:var(--ink);
  font-size:32px; font-weight:700; cursor:pointer; box-shadow:0 1px 3px rgba(16,24,40,.06); }
.gt-stepper button:disabled { opacity:.4; cursor:not-allowed; box-shadow:none; }
.gt-qtynum { font-size:60px; font-weight:800; min-width:92px; text-align:center;
  font-variant-numeric:tabular-nums; letter-spacing:-.03em; }
.gt-quick { display:flex; gap:9px; justify-content:center; margin-top:22px; }
.gt-quickbtn { min-width:58px; min-height:46px; border-radius:13px;
  background:var(--card); border:1px solid var(--line); color:var(--muted);
  font-size:15.5px; font-weight:700; cursor:pointer; }
.gt-quickbtn.is-on { background:var(--gold-bg); border-color:var(--gold); color:var(--gold); }

.gt-bottom { margin-top:auto; padding-top:28px; }
.gt-fine { text-align:center; font-size:12.5px; color:var(--muted); margin:12px 0 0; }

.gt-done { align-items:center; text-align:center; }
.gt-tick { width:80px; height:80px; border-radius:50%; display:grid;
  place-items:center; font-size:40px; font-weight:800;
  background:var(--ok-bg); color:var(--ok); margin-bottom:20px; }
.gt-doneline { font-size:20px; margin:8px 0 0; }
.gt-done .gt-bottom { width:100%; }

.gt-tally { margin-top:26px; border-top:1px solid var(--line); padding-top:16px; width:100%; }
.gt-tallyhead { font-size:11px; font-weight:800; letter-spacing:.08em;
  text-transform:uppercase; color:var(--muted); margin:0 0 10px; }
.gt-tallyrow { display:flex; align-items:center; gap:12px; padding:7px 0;
  font-size:15px; text-align:left; }
.gt-tallyqty { min-width:32px; height:32px; border-radius:9px; display:grid;
  place-items:center; background:var(--gold-bg); color:var(--gold);
  font-size:13.5px; font-weight:800; }

@media (prefers-reduced-motion: no-preference) {
  .gt-tick { animation: gt-pop .32s ease-out; }
  @keyframes gt-pop { from { transform:scale(.7); opacity:0; } to { transform:scale(1); opacity:1; } }
}
`;
