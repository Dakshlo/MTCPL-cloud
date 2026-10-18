"use client";

/**
 * The wardrobe screen, in a thumb.
 *
 *   name → a 4-digit code to that person's own phone → in for the shift
 *   tool → what are you taking?
 *   qty  → how many?
 *   done → a tick, and "Take another" with the person still signed in
 *
 * Oct 2026 — the company step is gone. Daksh: "why you ask vendors
 * selection, no need of that — eg Mohit login, then if he take any stock
 * that means its taken from his account." The OTP already proves who is
 * standing there, and that is the whole signature; asking a man who he
 * works for, at a cupboard, every time, was a screen that told us
 * nothing we did not know.
 *
 * Colour does real work here. This is read at arm's length, in a bright
 * office, by someone holding a tool in the other hand — so the stock
 * level is a colour before it is a number, the live step is the only
 * bright thing on the screen, and the only button that writes anything
 * is the big green one.
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
  /** Mig 233 — the photo. A man holding the tool recognises it here
   *  faster than he reads "450mm tool". */
  imageUrl: string | null;
};
export type RosterPerson = {
  id: string;
  name: string;
  maskedPhone: string;
};
type Session = { name: string };

type SendRes = { ok: true; sentTo: string } | { ok: false; error: string };
type VerifyRes =
  | { ok: true; name: string }
  | { ok: false; error: string; attemptsLeft?: number };
type TakeRes =
  | { ok: true; left: number; toolName: string; qty: number }
  | { ok: false; error: string; signedOut?: boolean };

type Step = "who" | "code" | "tool" | "qty" | "done";

const DIGITS = 4;

/** One colour per person, picked from their name so it is the same every
 *  morning — the men recognise their own tile before they read it. */
const PERSON_COLOURS = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ec4899", "#8b5cf6"];
function colourFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PERSON_COLOURS[h % PERSON_COLOURS.length];
}
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

export function GuestTakeClient({
  token, label, tools, roster, session,
  sendCodeAction, verifyCodeAction, signOutAction, takeAction,
}: {
  token: string;
  label: string;
  tools: TakeTool[];
  roster: RosterPerson[];
  session: Session | null;
  sendCodeAction: (fd: FormData) => Promise<SendRes>;
  verifyCodeAction: (fd: FormData) => Promise<VerifyRes>;
  signOutAction: (fd: FormData) => Promise<{ ok: boolean }>;
  takeAction: (fd: FormData) => Promise<TakeRes>;
}) {
  const [who, setWho] = useState<Session | null>(session);
  const [step, setStep] = useState<Step>(session ? "tool" : "who");
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
    const live = tools.filter((t) => Math.max(0, t.stock - (taken[t.id] ?? 0)) > 0);
    if (!needle) return live;
    return live.filter(
      (t) => t.name.toLowerCase().includes(needle) || (t.spec ?? "").toLowerCase().includes(needle),
    );
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
        setErr(r.attemptsLeft != null
          ? `${r.error} ${r.attemptsLeft} ${r.attemptsLeft === 1 ? "try" : "tries"} left.`
          : r.error);
        setCode("");
        codeRef.current?.focus();
        return;
      }
      setWho({ name: r.name });
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
    <main className="gt allow-portrait">
      <style>{CSS}</style>

      <header className="gt-head">
        <div className="gt-head-row">
          <div className="gt-brand">
            <span className="gt-logo" aria-hidden>🧰</span>
            <div>
              <div className="gt-brand-label">{label}</div>
              <div className="gt-brand-sub">Tool store</div>
            </div>
          </div>
          {who && (
            <button type="button" className="gt-me" onClick={signOut} disabled={pending}>
              <span className="gt-me-dot" style={{ background: colourFor(who.name) }}>
                {initials(who.name)}
              </span>
              <span className="gt-me-name">{who.name}</span>
              <span className="gt-me-out">Sign out</span>
            </button>
          )}
        </div>

        {/* Where you are, in three dots — so a man knows the screen is
            going somewhere and how far is left. */}
        {who && step !== "done" && (
          <div className="gt-steps" aria-hidden>
            <i data-on={step === "tool" ? "1" : undefined} data-done={step !== "tool" ? "1" : undefined} />
            <i data-on={step === "qty" ? "1" : undefined} />
          </div>
        )}
      </header>

      {err && (
        <div className="gt-err" role="alert">
          <span aria-hidden>⚠</span>
          <span>{err}</span>
          <button type="button" onClick={() => setErr(null)} aria-label="Close">✕</button>
        </div>
      )}

      {/* ── 1. who ─────────────────────────────────────────────── */}
      {step === "who" && (
        <section className="gt-body">
          <h1 className="gt-q">Who is taking?</h1>
          <p className="gt-hint">Tap your name. A 4-digit code comes to your phone.</p>
          {roster.length === 0 ? (
            <div className="gt-blank">
              Nobody is set up for this cupboard yet. Ask the office.
            </div>
          ) : (
            <div className="gt-people">
              {roster.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="gt-person"
                  style={{ ["--who" as string]: colourFor(p.name) }}
                  onClick={() => sendCode(p)}
                  disabled={pending}
                >
                  <span className="gt-pface">{initials(p.name)}</span>
                  <span className="gt-pbody">
                    <strong>{p.name}</strong>
                    <span>code to {p.maskedPhone}</span>
                  </span>
                  <span className="gt-pgo" aria-hidden>→</span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── 2. code ────────────────────────────────────────────── */}
      {step === "code" && picked && (
        <section className="gt-body">
          <h1 className="gt-q">Your code</h1>
          <p className="gt-hint">
            Sent to <strong>{sentTo || picked.maskedPhone}</strong> — {picked.name}
          </p>

          <div className="gt-otp" onClick={() => codeRef.current?.focus()}>
            {Array.from({ length: DIGITS }).map((_, i) => (
              <span key={i} className="gt-otp-box" data-filled={code[i] ? "1" : undefined} data-live={code.length === i ? "1" : undefined}>
                {code[i] ?? ""}
              </span>
            ))}
            <input
              ref={codeRef}
              className="gt-otp-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={DIGITS}
              value={code}
              disabled={pending}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, "").slice(0, DIGITS);
                setCode(v);
                if (v.length === DIGITS) verify(v);
              }}
              aria-label="4-digit code"
            />
          </div>

          <div className="gt-code-actions">
            <button
              type="button"
              className="gt-ghost"
              onClick={() => { setStep("who"); setCode(""); setErr(null); }}
              disabled={pending}
            >
              ← Not me
            </button>
            <button
              type="button"
              className="gt-ghost"
              onClick={() => sendCode(picked)}
              disabled={pending || cooldown > 0}
            >
              {cooldown > 0 ? `Send again in ${cooldown}s` : "Send again"}
            </button>
          </div>
        </section>
      )}

      {/* ── 3. tool ────────────────────────────────────────────── */}
      {step === "tool" && (
        <section className="gt-body">
          <h1 className="gt-q">What are you taking?</h1>

          {tools.length > 6 && (
            <div className="gt-search">
              <span aria-hidden>🔍</span>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search the shelf…"
                aria-label="Search tools"
              />
              {q && <button type="button" onClick={() => setQ("")} aria-label="Clear">✕</button>}
            </div>
          )}

          {shown.length === 0 ? (
            <div className="gt-blank">
              {q ? `Nothing matches “${q}”.` : "The shelf is empty. Tell the office."}
            </div>
          ) : (
            <div className="gt-tools">
              {shown.map((t) => {
                const left = stockOf(t);
                const lvl = left <= 0 ? "out" : t.level === "ok" ? "ok" : "low";
                return (
                  <button
                    key={t.id}
                    type="button"
                    className="gt-tool"
                    data-level={lvl}
                    onClick={() => { setTool(t); setQty(1); setStep("qty"); }}
                    disabled={pending}
                  >
                    <span className="gt-thumb" data-empty={t.imageUrl ? undefined : "1"}>
                      {t.imageUrl
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={t.imageUrl} alt="" loading="lazy" />
                        : <i>{t.name.trim().charAt(0).toUpperCase() || "?"}</i>}
                    </span>
                    <span className="gt-tool-main">
                      <strong>{t.name}</strong>
                      <span className="gt-tool-spec">{t.spec ? t.spec : `counted in ${t.unit}`}</span>
                    </span>
                    <span className="gt-tool-left">
                      <b>{left}</b>
                      <i>{t.unit}</i>
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {tally.length > 0 && (
            <div className="gt-tally">
              <span className="gt-tally-head">Taken just now</span>
              {tally.map((t, i) => (
                <span key={i} className="gt-tally-chip">
                  {t.qty} × {t.toolName}
                </span>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── 4. qty ─────────────────────────────────────────────── */}
      {step === "qty" && tool && (
        <section className="gt-body">
          <button type="button" className="gt-back" onClick={() => { setTool(null); setStep("tool"); }}>
            ← Pick another tool
          </button>

          <h1 className="gt-q">How many?</h1>
          <div className="gt-chosen">
            <span className="gt-thumb gt-thumb-lg" data-empty={tool.imageUrl ? undefined : "1"}>
              {tool.imageUrl
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={tool.imageUrl} alt="" />
                : <i>{tool.name.trim().charAt(0).toUpperCase() || "?"}</i>}
            </span>
            <span className="gt-chosen-text">
              <strong>{tool.name}</strong>
              {tool.spec && <span>{tool.spec}</span>}
              <em>{max} {tool.unit} on the shelf</em>
            </span>
          </div>

          <div className="gt-stepper">
            <button
              type="button"
              onClick={() => setQty((n) => Math.max(1, n - 1))}
              disabled={pending || qty <= 1}
              aria-label="One less"
            >
              −
            </button>
            <div className="gt-qty">
              <b>{qty}</b>
              <i>{tool.unit}</i>
            </div>
            <button
              type="button"
              onClick={() => setQty((n) => Math.min(max, n + 1))}
              disabled={pending || qty >= max}
              aria-label="One more"
            >
              +
            </button>
          </div>

          <button type="button" className="gt-take" onClick={submit} disabled={pending}>
            {pending ? "Recording…" : `Take ${qty} ${tool.unit}`}
          </button>
          <p className="gt-fine">Signed by <strong>{who?.name}</strong></p>
        </section>
      )}

      {/* ── 5. done ────────────────────────────────────────────── */}
      {step === "done" && done && (
        <section className="gt-body gt-donestep">
          <div className="gt-tick" aria-hidden>✓</div>
          <h1 className="gt-donetitle">
            {done.qty} × {done.toolName}
          </h1>
          <p className="gt-donesub">
            Written in the register against <strong>{who?.name}</strong>.
            <br />
            {done.left} left on the shelf.
          </p>

          <button
            type="button"
            className="gt-take"
            onClick={() => { setTool(null); setDone(null); setQ(""); setStep("tool"); }}
          >
            Take something else
          </button>
          <button type="button" className="gt-ghost gt-wide" onClick={signOut} disabled={pending}>
            That is all — sign out
          </button>

          {tally.length > 1 && (
            <div className="gt-tally">
              <span className="gt-tally-head">This visit</span>
              {tally.map((t, i) => (
                <span key={i} className="gt-tally-chip">{t.qty} × {t.toolName}</span>
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  );
}

const CSS = `
.gt {
  --ink:#15181d; --dim:#6b7280; --line:#e6e4df; --card:#ffffff;
  --brand:#4f46e5; --brand2:#7c3aed;
  --ok:#059669; --okbg:#ecfdf5; --low:#d97706; --lowbg:#fffbeb;
  --out:#dc2626; --outbg:#fef2f2;
  min-height:100dvh; background:#f6f6f4; color:var(--ink);
  font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
  padding-bottom:40px; -webkit-text-size-adjust:100%;
}
.gt *, .gt *::before, .gt *::after { box-sizing:border-box; }

/* ── header ─────────────────────────────────────────────── */
.gt-head {
  background:linear-gradient(135deg, var(--brand) 0%, var(--brand2) 100%);
  color:#fff; padding:16px 16px 14px; border-radius:0 0 22px 22px;
  box-shadow:0 10px 28px rgba(79,70,229,.26);
}
.gt-head-row { display:flex; align-items:center; gap:12px; }
.gt-brand { display:flex; align-items:center; gap:10px; min-width:0; }
.gt-logo {
  width:40px; height:40px; flex:0 0 auto; border-radius:13px; font-size:20px;
  display:grid; place-items:center; background:rgba(255,255,255,.18);
}
.gt-brand-label { font-size:16px; font-weight:800; letter-spacing:-.2px;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.gt-brand-sub { font-size:11px; font-weight:700; letter-spacing:.1em;
  text-transform:uppercase; color:rgba(255,255,255,.72); }
.gt-me {
  margin-left:auto; display:flex; align-items:center; gap:7px; max-width:46%;
  padding:6px 10px 6px 6px; border-radius:999px; border:none; cursor:pointer;
  background:rgba(255,255,255,.17); color:#fff; font:inherit;
}
.gt-me-dot { width:26px; height:26px; flex:0 0 auto; border-radius:50%;
  display:grid; place-items:center; font-size:11px; font-weight:800; color:#fff;
  box-shadow:0 0 0 2px rgba(255,255,255,.45); }
.gt-me-name { font-size:12.5px; font-weight:700; white-space:nowrap;
  overflow:hidden; text-overflow:ellipsis; }
.gt-me-out { font-size:10px; font-weight:700; opacity:.8; white-space:nowrap; }
.gt-steps { display:flex; gap:6px; margin:12px 2px 0; }
.gt-steps i { height:4px; flex:1; border-radius:99px; background:rgba(255,255,255,.28); }
.gt-steps i[data-done] { background:rgba(255,255,255,.62); }
.gt-steps i[data-on] { background:#fff; }

/* ── shared body ────────────────────────────────────────── */
.gt-body { padding:20px 16px 0; max-width:560px; margin:0 auto; }
.gt-q { font-size:23px; font-weight:800; letter-spacing:-.4px; margin:0 0 6px; }
.gt-hint { font-size:14px; color:var(--dim); line-height:1.5; margin:0 0 18px; }
.gt-blank { padding:26px 18px; text-align:center; font-size:14.5px; color:var(--dim);
  background:var(--card); border:1px dashed var(--line); border-radius:16px; }
.gt-err {
  display:flex; align-items:center; gap:9px; margin:14px 16px 0; padding:12px 14px;
  background:var(--outbg); border:1px solid #fecaca; border-radius:14px;
  color:#991b1b; font-size:13.5px; font-weight:600; line-height:1.4;
}
.gt-err button { margin-left:auto; background:none; border:none; color:inherit;
  font-size:15px; cursor:pointer; padding:0 2px; }
.gt-back { background:none; border:none; padding:0 0 12px; font:inherit;
  font-size:13.5px; font-weight:700; color:var(--brand); cursor:pointer; }

/* ── people ─────────────────────────────────────────────── */
.gt-people { display:flex; flex-direction:column; gap:11px; }
.gt-person {
  display:flex; align-items:center; gap:13px; width:100%; text-align:left;
  padding:14px; border-radius:18px; cursor:pointer; font:inherit;
  background:var(--card); border:1.5px solid var(--line);
  box-shadow:0 2px 10px rgba(20,20,30,.05);
}
.gt-person:active { transform:scale(.99); }
.gt-person:disabled { opacity:.55; }
.gt-pface {
  width:46px; height:46px; flex:0 0 auto; border-radius:15px; color:#fff;
  display:grid; place-items:center; font-size:16px; font-weight:800;
  background:var(--who); box-shadow:0 4px 12px color-mix(in srgb, var(--who) 40%, transparent);
}
.gt-pbody { display:flex; flex-direction:column; gap:2px; min-width:0; flex:1; }
.gt-pbody strong { font-size:16.5px; font-weight:800; }
.gt-pbody span { font-size:12.5px; color:var(--dim); }
.gt-pgo { font-size:18px; color:var(--who); font-weight:800; }

/* ── otp ────────────────────────────────────────────────── */
.gt-otp { position:relative; display:flex; gap:10px; justify-content:center; margin:6px 0 20px; }
.gt-otp-box {
  width:60px; height:72px; border-radius:16px; display:grid; place-items:center;
  font-size:30px; font-weight:800; background:var(--card);
  border:2px solid var(--line); color:var(--ink);
}
.gt-otp-box[data-filled] { border-color:var(--brand); background:#eef2ff; }
.gt-otp-box[data-live] { border-color:var(--brand); box-shadow:0 0 0 4px rgba(79,70,229,.14); }
.gt-otp-input { position:absolute; inset:0; width:100%; height:100%;
  opacity:0; border:none; background:transparent; font-size:30px; }
.gt-code-actions { display:flex; gap:10px; justify-content:space-between; }
.gt-ghost { padding:12px 14px; border-radius:13px; font:inherit; font-size:13.5px;
  font-weight:700; cursor:pointer; background:var(--card);
  border:1.5px solid var(--line); color:var(--ink); }
.gt-ghost:disabled { opacity:.5; }
.gt-wide { display:block; width:100%; margin-top:10px; }

/* ── tools ──────────────────────────────────────────────── */
.gt-search {
  display:flex; align-items:center; gap:9px; padding:0 14px; margin-bottom:14px;
  background:var(--card); border:1.5px solid var(--line); border-radius:15px;
}
.gt-search input { flex:1; min-width:0; border:none; outline:none; background:none;
  font:inherit; font-size:15.5px; padding:14px 0; color:var(--ink); }
.gt-search button { background:none; border:none; color:var(--dim); font-size:15px; cursor:pointer; }
.gt-tools { display:flex; flex-direction:column; gap:11px; }
.gt-tool {
  display:flex; align-items:center; gap:12px; width:100%; text-align:left;
  padding:15px 15px 15px 18px; border-radius:18px; cursor:pointer; font:inherit;
  background:var(--card); border:1.5px solid var(--line); position:relative;
  overflow:hidden; box-shadow:0 2px 10px rgba(20,20,30,.05);
}
.gt-tool::before { content:""; position:absolute; left:0; top:0; bottom:0; width:6px; }
.gt-tool[data-level="ok"]::before  { background:var(--ok); }
.gt-tool[data-level="low"]::before { background:var(--low); }
.gt-tool[data-level="out"]::before { background:var(--out); }
.gt-tool:active { transform:scale(.99); }
.gt-tool-main { display:flex; flex-direction:column; gap:3px; min-width:0; flex:1; }
.gt-tool-main strong { font-size:16.5px; font-weight:800; }
.gt-tool-spec { font-size:12.5px; color:var(--dim); }
.gt-tool-left { flex:0 0 auto; display:flex; flex-direction:column; align-items:center;
  min-width:58px; padding:7px 10px; border-radius:13px; }
.gt-tool-left b { font-size:21px; font-weight:800; line-height:1; }
.gt-tool-left i { font-style:normal; font-size:10px; font-weight:700;
  letter-spacing:.06em; text-transform:uppercase; opacity:.75; }
.gt-tool[data-level="ok"]  .gt-tool-left { background:var(--okbg);  color:var(--ok); }
.gt-tool[data-level="low"] .gt-tool-left { background:var(--lowbg); color:var(--low); }
.gt-tool[data-level="out"] .gt-tool-left { background:var(--outbg); color:var(--out); }

/* ── quantity ───────────────────────────────────────────── */
.gt-chosen { background:var(--card); border:1.5px solid var(--line); border-radius:18px;
  padding:14px 16px; margin-bottom:18px; display:flex; align-items:center; gap:13px; }
.gt-chosen-text { display:flex; flex-direction:column; gap:3px; min-width:0; }
.gt-chosen strong { font-size:18px; font-weight:800; }
.gt-chosen-text span { font-size:13px; color:var(--dim); }
.gt-chosen em { font-style:normal; font-size:12.5px; font-weight:700; color:var(--ok); margin-top:4px; }

/* the photo (mig 233) — or the tool's initial in its level colour, so a
   tool without one still reads as a tool rather than a broken box */
.gt-thumb { width:52px; height:52px; flex:0 0 auto; border-radius:15px; overflow:hidden;
  display:grid; place-items:center; background:#f1f1ee; }
.gt-thumb img { width:100%; height:100%; object-fit:cover; display:block; }
.gt-thumb i { font-style:normal; font-size:21px; font-weight:800; }
.gt-thumb-lg { width:62px; height:62px; border-radius:17px; }
.gt-tool[data-level="ok"]  .gt-thumb[data-empty] { background:var(--okbg);  color:var(--ok); }
.gt-tool[data-level="low"] .gt-thumb[data-empty] { background:var(--lowbg); color:var(--low); }
.gt-tool[data-level="out"] .gt-thumb[data-empty] { background:var(--outbg); color:var(--out); }
.gt-chosen .gt-thumb[data-empty] { background:var(--okbg); color:var(--ok); }
.gt-stepper { display:flex; align-items:center; gap:14px; margin-bottom:20px; }
.gt-stepper button {
  width:74px; height:74px; flex:0 0 auto; border-radius:24px; font-size:34px;
  font-weight:700; cursor:pointer; background:var(--card); color:var(--brand);
  border:2px solid var(--line); line-height:1;
}
.gt-stepper button:disabled { opacity:.35; }
.gt-stepper button:active:not(:disabled) { background:#eef2ff; }
.gt-qty { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center;
  background:linear-gradient(135deg, var(--brand) 0%, var(--brand2) 100%); color:#fff;
  border-radius:24px; padding:12px 8px; box-shadow:0 8px 22px rgba(79,70,229,.3); }
.gt-qty b { font-size:42px; font-weight:800; line-height:1; }
.gt-qty i { font-style:normal; font-size:11px; font-weight:700; letter-spacing:.08em;
  text-transform:uppercase; opacity:.85; margin-top:3px; }
.gt-take {
  display:block; width:100%; padding:19px; border-radius:20px; border:none;
  font:inherit; font-size:17.5px; font-weight:800; color:#fff; cursor:pointer;
  background:linear-gradient(135deg, #059669 0%, #047857 100%);
  box-shadow:0 10px 24px rgba(5,150,105,.34);
}
.gt-take:disabled { opacity:.6; }
.gt-take:active:not(:disabled) { transform:translateY(1px); }
.gt-fine { text-align:center; font-size:12.5px; color:var(--dim); margin:12px 0 0; }

/* ── done ───────────────────────────────────────────────── */
.gt-donestep { text-align:center; padding-top:34px; }
.gt-tick { width:88px; height:88px; margin:0 auto 18px; border-radius:50%;
  display:grid; place-items:center; font-size:44px; color:#fff;
  background:linear-gradient(135deg, #10b981 0%, #059669 100%);
  box-shadow:0 12px 30px rgba(16,185,129,.4); animation:gtPop .32s cubic-bezier(.2,1.3,.4,1) both; }
@keyframes gtPop { from { transform:scale(.6); opacity:0; } to { transform:scale(1); opacity:1; } }
.gt-donetitle { font-size:25px; font-weight:800; letter-spacing:-.4px; margin:0 0 8px; }
.gt-donesub { font-size:14.5px; color:var(--dim); line-height:1.6; margin:0 0 24px; }

/* ── tally ──────────────────────────────────────────────── */
.gt-tally { display:flex; flex-wrap:wrap; gap:7px; align-items:center;
  margin-top:22px; padding-top:16px; border-top:1px dashed var(--line); }
.gt-tally-head { width:100%; font-size:10.5px; font-weight:800; letter-spacing:.08em;
  text-transform:uppercase; color:var(--dim); margin-bottom:2px; }
.gt-tally-chip { font-size:12.5px; font-weight:700; padding:6px 11px; border-radius:999px;
  background:var(--okbg); color:var(--ok); border:1px solid #a7f3d0; }

@media (prefers-reduced-motion: reduce) { .gt-tick { animation:none; } }
`;
