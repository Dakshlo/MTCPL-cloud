"use client";

// Dashboard email-snapshot panel (owner/dev only — the run route
// re-checks the role). Owns: collapse toggle, the manual-refresh range
// picker (Today / Yesterday / Last 3 days / Last 7 days), and the
// sender-first item layout. The 5am/2pm crons always fetch just today;
// only this Refresh button may widen the window.

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { SnapshotItem } from "@/lib/email-snapshot";
import { EmailPeek } from "./email-peek";
import { setSnapshotLangAction, type SnapshotLang } from "./snapshot-lang-action";

type Snap = {
  generatedAt: string;
  items: SnapshotItem[];
  overview: string | null;
  overviewHi: string | null;
  scannedCount: number;
  range: string;
  error: string | null;
};

const CATEGORY_META: Record<string, { label: string; icon: string }> = {
  bank_payment: { label: "Bank / Payment", icon: "🏦" },
  government_gst: { label: "Govt / GST", icon: "🏛️" },
  client: { label: "Client", icon: "🤝" },
  vendor: { label: "Vendor", icon: "📦" },
  // Our own staff — a colleague copying the owner is not a customer.
  internal: { label: "Our team", icon: "🏠" },
  legal: { label: "Legal", icon: "⚖️" },
  other: { label: "Other", icon: "✉️" },
};

const RANGE_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last_3_days", label: "Last 3 days" },
  { value: "last_7_days", label: "Last 7 days" },
  { value: "last_15_days", label: "Last 15 days" },
  { value: "days_15_30", label: "15–30 days ago" },
] as const;

const RANGE_LABEL: Record<string, string> = {
  today: "Today",
  yesterday: "Yesterday onward",
  last_3_days: "Last 3 days",
  last_7_days: "Last 7 days",
  last_15_days: "Last 15 days",
  days_15_30: "15–30 days ago",
  last_month: "Last 1 month", // legacy
};

function fmtIst(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

// Email date for the card — day + month + year, no time, to stay compact.
function fmtEmailDate(iso: string | undefined): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

export function EmailSnapshotPanel({
  snap,
  configured,
  initialLang = "en",
}: {
  snap: Snap | null;
  configured: boolean;
  /** Mig 224 — the language this person last chose, from their profile. */
  initialLang?: SnapshotLang;
}) {
  const router = useRouter();
  // Switch instantly, save in the background. Waiting on a round-trip to
  // repaint a language toggle would feel broken; if the save fails the
  // view is still right for this session and the next load falls back.
  const [lang, setLang] = useState<SnapshotLang>(initialLang);
  function chooseLang(next: SnapshotLang) {
    if (next === lang) return;
    setLang(next);
    void setSnapshotLangAction(next);
  }
  const hi = lang === "hi";
  const [collapsed, setCollapsed] = useState(false);
  const [range, setRange] = useState<string>(snap?.range ?? "today");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Center-peek: the full email is fetched LIVE on click (never stored).
  const [openItem, setOpenItem] = useState<SnapshotItem | null>(null);
  function openCard(it: SnapshotItem) {
    if (it.uid) setOpenItem(it);
  }

  async function refresh() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/email-snapshot/run?range=${encodeURIComponent(range)}`, { method: "POST" });
      // A timeout (e.g. a heavy 1-month pull) returns a non-JSON gateway
      // error — read defensively so we can show a useful message.
      let json: { ok?: boolean; error?: string } | null = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }
      if (!res.ok || !json?.ok) {
        if (res.status === 504 || res.status === 502) {
          setErr("That took too long to read — try a shorter range (the inbox was large).");
        } else {
          setErr(json?.error ?? `Refresh failed (status ${res.status}).`);
        }
        return;
      }
      router.refresh();
    } catch {
      setErr("Refresh failed — check your connection.");
    } finally {
      setBusy(false);
    }
  }

  const need = snap ? snap.items.filter((x) => x.urgency === "action_needed").length : 0;
  const fyi = snap ? snap.items.length - need : 0;
  const overview = snap ? (hi ? snap.overviewHi || snap.overview : snap.overview) : null;

  return (
    <>
      <section className={`es${collapsed ? " es-shut" : ""}`}>
        <style>{CSS}</style>

        {/* ── bar ─────────────────────────────────────────────── */}
        <header className="es-bar">
          <button
            type="button"
            className="es-title"
            onClick={() => setCollapsed((c) => !c)}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand the email snapshot" : "Collapse the email snapshot"}
          >
            <span className="es-caret" aria-hidden>▾</span>
            <span className="es-name">Email snapshot</span>
            {snap && !snap.error && (
              <span className="es-meta">
                {fmtIst(snap.generatedAt)} · {RANGE_LABEL[snap.range] ?? "Today"} · {snap.scannedCount} read
              </span>
            )}
          </button>

          <div className="es-tools">
            <Link href="/dashboard/emails" className="es-btn" title="Browse every scanned email, newest first">
              All emails
            </Link>
            <select
              className="es-range"
              value={range}
              onChange={(e) => setRange(e.target.value)}
              disabled={busy}
              title="How far back to fetch when you refresh"
            >
              {RANGE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <button type="button" className="es-btn es-btn-go" onClick={refresh} disabled={busy}>
              {busy ? "Reading…" : "Refresh"}
            </button>
          </div>
        </header>

        {err && <div className="es-err" role="alert">{err}</div>}

        {!collapsed && (
          <>
            {!configured || !snap ? (
              <p className="es-note">
                Not set up yet — run migrations <code>119</code> &amp; <code>120</code>, then add{" "}
                <code>GMAIL_USER</code>, <code>GMAIL_APP_PASSWORD</code> and <code>CRON_SECRET</code> in
                Vercel. Snapshots run at 5:00 am and 2:00 pm IST, or tap Refresh.
              </p>
            ) : snap.error ? (
              <p className="es-err">Last run failed: {snap.error}</p>
            ) : (
              <>
                {/* ── the lede ───────────────────────────────────
                    The counts and the one-line summary are one block
                    with a gold rule down its edge, because together
                    they ARE the snapshot: everything below is the
                    evidence for this sentence. */}
                <div className="es-lede">
                  <div className="es-counts">
                    {need > 0 && <span className="es-pill es-pill-act">{need} need{need === 1 ? "s" : ""} action</span>}
                    {fyi > 0 && <span className="es-pill">{fyi} to note</span>}
                    {snap.items.length === 0 && <span className="es-pill es-pill-ok">Inbox quiet</span>}
                    <span className="es-of">of {snap.scannedCount} read</span>

                    {/* Mig 224 — next to the text it changes, not in the
                        bar. The choice saves to the profile. */}
                    <span className="es-lang" role="group" aria-label="Language">
                      {([["en", "EN"], ["hi", "हिं"]] as const).map(([code, label]) => (
                        <button
                          key={code}
                          type="button"
                          onClick={() => chooseLang(code)}
                          aria-pressed={lang === code}
                          className={lang === code ? "on" : ""}
                          title={code === "hi" ? "हिंदी में पढ़ें" : "Read in English"}
                        >
                          {label}
                        </button>
                      ))}
                    </span>
                  </div>
                  {overview && <p className="es-over">{overview}</p>}
                </div>

                {snap.items.length === 0 ? (
                  <p className="es-quiet">Nothing needs you — the inbox is quiet.</p>
                ) : (
                  <ol className="es-list">
                    {snap.items.map((it, i) => {
                      const cat = CATEGORY_META[it.category] ?? CATEGORY_META.other;
                      const action = it.urgency === "action_needed";
                      const clickable = !!it.uid;
                      const dateStr = fmtEmailDate(it.date);
                      const summary = hi ? it.summaryHi || it.summary : it.summary;
                      const pts = hi ? it.keyPointsHi ?? it.keyPoints : it.keyPoints;
                      return (
                        <li
                          key={i}
                          className={`es-item${action ? " act" : ""}${clickable ? " hit" : ""}`}
                          onClick={clickable ? () => openCard(it) : undefined}
                          role={clickable ? "button" : undefined}
                          tabIndex={clickable ? 0 : undefined}
                          onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openCard(it); } } : undefined}
                          title={clickable ? "Open the full email" : undefined}
                        >
                          {/* The category as a tile down the left. It gives
                              a list of near-identical grey boxes a rhythm,
                              and says whose email this is before a word is
                              read — which the little grey tag at the bottom
                              never managed. */}
                          <span className="es-ico" aria-hidden>{cat.icon}</span>

                          <div className="es-body">
                            <div className="es-who">
                              <strong>{it.from}</strong>
                              {dateStr && <span className="es-date">{dateStr}</span>}
                              <span className={`es-tag${action ? " act" : ""}`}>
                                {action ? "Action needed" : "FYI"}
                              </span>
                            </div>

                            <h3 className="es-subj">{it.subject}</h3>
                            {summary && <p className="es-sum">{summary}</p>}

                            {pts && pts.length > 0 && (
                              <ul className="es-pts">
                                {pts.map((k, ki) => <li key={ki}>{k}</li>)}
                              </ul>
                            )}

                            {it.action && (
                              <div className="es-do">
                                <span className="es-do-k">Do</span>
                                <span className="es-do-v">
                                  {hi ? it.actionHi || it.action : it.action}
                                  {it.deadline && <b className="es-by">{it.deadline}</b>}
                                </span>
                              </div>
                            )}

                            <div className="es-foot">
                              <span className="es-cat">{cat.label}</span>
                              {clickable && <span className="es-open">Open full email →</span>}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}

                <p className="es-fine">
                  Read-only · Google&apos;s own emails are hidden · refreshes itself at 5 am and 2 pm, today only
                </p>
              </>
            )}
          </>
        )}
      </section>

      {/* Centre-peek: the full email, fetched live (never stored). */}
      {openItem && (
        <EmailPeek
          target={{ uid: openItem.uid, subject: openItem.subject, from: openItem.from, date: openItem.date }}
          onClose={() => setOpenItem(null)}
        />
      )}
    </>
  );
}

/* ── Why this is a stylesheet and not three hundred style props ────
   Daksh, Nov 2026: "improve the UI of the email thing on dashboard,
   really good professional UI. Complete makeover of the email module
   only."

   The old panel set every rule inline, which is why it drifted: the
   accent fell back to #4f46e5, an indigo that belongs to no other
   screen in this app, and it was on the Refresh button, the language
   toggle, the bullets and the open link. Four purple things on a page
   of gold and brown. Named classes make the palette one decision
   rather than thirty, and buy hover and focus states that inline
   styles cannot express at all. */
const CSS = `
.es {
  background:var(--surface); border:1px solid var(--border); border-radius:14px;
  padding:15px 18px 16px; display:flex; flex-direction:column; gap:14px;
}
.es-shut { gap:0; padding-bottom:15px; }

.es-bar { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }
.es-title {
  display:inline-flex; align-items:baseline; gap:9px; flex:1 1 auto; min-width:0;
  background:none; border:0; padding:0; cursor:pointer; text-align:left; color:var(--text);
}
.es-caret { font-size:11px; color:var(--muted); transition:transform .15s; flex:none;
  position:relative; top:-1px; }
.es-shut .es-caret { transform:rotate(-90deg); }
.es-name { font-size:15px; font-weight:800; letter-spacing:-.2px; flex:none; }
.es-meta { font-size:11.5px; color:var(--muted); min-width:0; overflow:hidden;
  text-overflow:ellipsis; white-space:nowrap; }

.es-tools { display:flex; align-items:center; gap:7px; flex:none; flex-wrap:wrap; }
.es-btn {
  display:inline-flex; align-items:center; height:29px; padding:0 12px;
  font:inherit; font-size:11.5px; font-weight:700; white-space:nowrap;
  color:var(--text); background:var(--surface); border:1px solid var(--border);
  border-radius:8px; text-decoration:none; cursor:pointer;
}
.es-btn:hover { background:var(--surface-alt); }
/* Gold, like every other primary action in the app. It was indigo. */
.es-btn-go { color:#fff; background:var(--gold); border-color:var(--gold-dark); }
.es-btn-go:hover { background:var(--gold-dark); }
.es-btn-go:disabled { opacity:.6; cursor:wait; }
.es-range {
  height:29px; max-width:150px; padding:0 8px; font:inherit; font-size:11.5px;
  font-weight:600; color:var(--text); background:var(--bg);
  border:1px solid var(--border); border-radius:8px; cursor:pointer;
}
.es-range:disabled { opacity:.6; cursor:wait; }

/* ── the lede ───────────────────────────────────────────────────
   The counts and the summary line are one block, because together
   they are the snapshot; everything under them is the evidence. The
   gold rule says "start here". */
.es-lede {
  display:flex; flex-direction:column; gap:7px;
  padding:11px 14px; border-radius:10px;
  background:var(--gold-subtle); border:1px solid var(--gold-border);
  border-left:3px solid var(--gold);
}
.es-counts { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.es-pill {
  font-size:11px; font-weight:800; padding:3px 11px; border-radius:999px;
  background:rgba(255,255,255,.75); color:var(--text); border:1px solid var(--gold-border);
}
.es-pill-act { background:var(--danger); color:#fff; border-color:var(--danger); }
.es-pill-ok { background:rgba(22,163,74,.14); color:var(--success); border-color:rgba(22,163,74,.3); }
.es-of { font-size:11px; color:var(--muted); }
.es-over { margin:0; font-size:13px; line-height:1.55; color:var(--text); }

.es-lang { display:inline-flex; margin-left:auto; flex:none; border:1px solid var(--gold-border);
  border-radius:999px; overflow:hidden; background:rgba(255,255,255,.6); }
.es-lang button {
  padding:3px 12px; font:inherit; font-size:10.5px; font-weight:800;
  border:0; cursor:pointer; background:transparent; color:var(--muted);
}
.es-lang button.on { background:var(--gold); color:#fff; }

/* ── the emails ─────────────────────────────────────────────── */
.es-list { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:9px; }
.es-item {
  display:grid; grid-template-columns:38px minmax(0,1fr); gap:12px;
  padding:12px 14px; border-radius:11px;
  background:var(--bg); border:1px solid var(--border);
  border-left:3px solid var(--border);
  transition:border-color .12s, background .12s, transform .12s;
}
.es-item.hit { cursor:pointer; }
.es-item.hit:hover {
  background:var(--surface); border-color:var(--gold-border);
  border-left-color:var(--gold); transform:translateX(2px);
}
.es-item.act { border-left-color:var(--danger); background:rgba(220,38,38,.045); }
.es-item.act.hit:hover { border-color:rgba(220,38,38,.4); border-left-color:var(--danger); }

.es-ico {
  width:38px; height:38px; border-radius:10px; display:grid; place-items:center;
  font-size:18px; background:var(--surface-alt); border:1px solid var(--border);
}
.es-item.act .es-ico { background:rgba(220,38,38,.1); border-color:rgba(220,38,38,.22); }

.es-body { min-width:0; display:flex; flex-direction:column; gap:3px; }
.es-who { display:flex; align-items:baseline; gap:8px; min-width:0; }
.es-who strong { font-size:13px; font-weight:800; color:var(--text);
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.es-date { font-size:11px; color:var(--muted); flex:none; }
.es-tag {
  margin-left:auto; flex:none; font-size:9.5px; font-weight:800; letter-spacing:.07em;
  text-transform:uppercase; padding:2px 8px; border-radius:999px;
  color:var(--muted); background:var(--surface-alt); border:1px solid var(--border);
}
.es-tag.act { color:#fff; background:var(--danger); border-color:var(--danger); }

.es-subj { margin:1px 0 0; font-size:13.5px; font-weight:700; line-height:1.35; color:var(--text); }
.es-sum { margin:2px 0 0; font-size:12px; line-height:1.5; color:var(--muted); }

/* Hanging bullets with a real indent, so a point that wraps lines up
   under itself instead of under the dot. */
.es-pts { list-style:none; margin:7px 0 0; padding:0; display:flex; flex-direction:column; gap:4px; }
.es-pts li { position:relative; padding-left:15px; font-size:12.5px; line-height:1.5; color:var(--text); }
.es-pts li::before {
  content:""; position:absolute; left:3px; top:7px; width:5px; height:5px;
  border-radius:50%; background:var(--gold);
}
.es-item.act .es-pts li::before { background:var(--danger); }

.es-do {
  display:flex; align-items:flex-start; gap:9px; margin-top:9px;
  padding:8px 11px; border-radius:9px;
  background:rgba(220,38,38,.08); border:1px solid rgba(220,38,38,.22);
}
.es-do-k { flex:none; font-size:9.5px; font-weight:800; letter-spacing:.09em;
  text-transform:uppercase; color:var(--danger); margin-top:3px; }
.es-do-v { font-size:12.5px; font-weight:600; line-height:1.45; color:var(--text); }
.es-by { margin-left:8px; font-size:11px; font-weight:800; white-space:nowrap;
  color:#991b1b; background:rgba(220,38,38,.14); padding:1px 8px; border-radius:999px; }

.es-foot { display:flex; align-items:baseline; gap:10px; margin-top:9px;
  padding-top:8px; border-top:1px solid var(--border); }
.es-cat { font-size:10.5px; font-weight:700; letter-spacing:.05em; text-transform:uppercase;
  color:var(--muted); }
.es-open { margin-left:auto; font-size:11px; font-weight:700; color:var(--gold-dark); }
.es-item.hit:hover .es-open { text-decoration:underline; }

.es-note, .es-quiet { margin:0; font-size:12.5px; line-height:1.55; color:var(--muted); }
.es-err { font-size:12px; font-weight:600; color:var(--danger);
  background:var(--danger-bg); border:1px solid rgba(220,38,38,.25);
  border-radius:8px; padding:8px 11px; }
.es-fine { margin:2px 0 0; font-size:10.5px; color:var(--muted-light); }

/* A phone has no room for the tile, and the sender line needs the width. */
@media (max-width: 640px) {
  .es { padding:13px 14px 14px; }
  .es-item { grid-template-columns:minmax(0,1fr); gap:0; }
  .es-ico { display:none; }
}
`;
