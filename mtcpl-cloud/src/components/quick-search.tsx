"use client";

/**
 * Quick search palette (Daksh, Aug 2026) — everywhere in the app.
 *
 * Three things stacked, in the order a hand reaches for them:
 *
 *   1. PINNED LINKS. Up to six pages this person chose (mig 221), as buttons.
 *      Everyone gets these, in every department.
 *   2. SLAB / BLOCK LOOKUP. Production only, because only production has slabs.
 *      Where is it, what stage — answered while you type, matching on code,
 *      label, either category or description, since on the floor a piece is
 *      known by what it IS, not only by what is stencilled on it.
 *   3. GO TO A PAGE. Everyone. Searches the nav registry, which is exactly the
 *      set of pages this user may open — royalty and the personal ledger are
 *      not in it, so they cannot be found here.
 *
 * Outside production the middle section simply is not rendered, and the palette
 * is pins + page search.
 *
 * OPENING IT. ⌘K / Ctrl+K, or hold ; and ' — neighbours on the home row, one
 * motion with the right hand. Esc closes. Both are ignored while you are
 * typing in a field, so the chord can never eat a legitimate apostrophe.
 * ⌘K works on EVERY production page. It used to yield on /carving, where the
 * board had bound it to its own search box — but a global shortcut with one
 * silent exception reads as broken, so the board gave up the duplicate and
 * kept its `/`.
 *
 * CLICKING A RESULT OPENS IT HERE. It does not navigate — being thrown onto
 * Required Sizes was losing the very context you opened the palette to keep.
 * There is an explicit link for when you do want the full page.
 *
 * PORTALLED TO BODY, and this is not optional: the topbar carries a
 * backdrop-filter, which makes it the containing block for position:fixed
 * children. Rendered in place, `inset: 0` resolved to the TOPBAR's box — a
 * 1185×126 strip — and painted the dim as a black band across the top of the
 * screen instead of over the page.
 *
 * DESKTOP ONLY. Floor tablets run the app's own on-screen keyboard; a chord
 * means nothing there. Gated on (pointer: fine), not a width guess.
 */

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { directDispatchSlabsAction } from "@/app/(app)/carving/actions";
import { saveQuickLinksAction } from "@/app/(app)/quick-links-actions";
import { MAX_QUICK_LINKS } from "@/lib/nav-registry";

type Detail = {
  label: string | null;
  category1: string | null;
  category2: string | null;
  description: string | null;
  stone: string | null;
  dims: string | null;
  parked: boolean;
};

type Hit = {
  kind: "slab" | "block";
  code: string;
  temple: string | null;
  stage: string;
  where: string | null;
  note: string | null;
  href: string;
  detail: Detail | null;
  canReady: boolean;
  readyBlockedBecause: string | null;
};

const CHORD = new Set([";", "'"]);

const C = {
  ink: "#0b1220",
  ink2: "#3f4a5c",
  muted: "#8892a4",
  line: "#e6eaf0",
  wash: "#f6f8fb",
  indigo: "#4f46e5",
  green: "#0f9d58",
};

/** Tile gradients, one per department — the same accents the sidebar's
 *  department switcher wears, so a pinned tile reads as "that room". */
const DEPT_TINT: Record<string, { from: string; to: string }> = {
  production:  { from: "#3b2f0b", to: "#b8860b" },
  finance:     { from: "#12301f", to: "#2f8f5b" },
  invoicing:   { from: "#1a2540", to: "#4f6aa8" },
  inventory:   { from: "#3a1f12", to: "#c87850" },
  register:    { from: "#2a1c3d", to: "#8a6fb0" },
  maintenance: { from: "#0f2b28", to: "#3f8f86" },
  salary:      { from: "#331f26", to: "#9c5f6e" },
  vehicles:    { from: "#182739", to: "#4f6d9c" },
};

const DEPT_LABEL: Record<string, string> = {
  production: "Production", finance: "Finance", invoicing: "Invoicing",
  inventory: "Inventory", register: "Register", maintenance: "Maintenance",
  salary: "Employees", vehicles: "Vehicles",
};

const STAGE_TONE: Array<[RegExp, string]> = [
  [/dispatch/i, C.green],
  [/ready/i, C.green],
  [/carving/i, "#7c3aed"],
  [/cutter|cutting/i, "#c2740a"],
  [/cut done/i, "#0284c7"],
  [/cancel|reject/i, "#c0392b"],
];
const toneFor = (stage: string) => STAGE_TONE.find(([re]) => re.test(stage))?.[1] ?? "#64748b";

export type QuickPage = { href: string; label: string; icon: string; department: string };

export function QuickSearch({
  slabLookup,
  pages,
  pinned,
}: {
  /** Production only — the slab/block section is hidden without it. */
  slabLookup: boolean;
  /** Every page this user may open, already role-filtered on the server. */
  pages: QuickPage[];
  /** Their saved pins, already validated against `pages`. */
  pinned: QuickPage[];
}) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState(0);
  const [openCode, setOpenCode] = useState<string | null>(null);
  const [sending, setSending] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ code: string; text: string; ok: boolean } | null>(null);
  const [desktop, setDesktop] = useState(false);
  const [pageQ, setPageQ] = useState("");
  const [editPins, setEditPins] = useState(false);
  const [pins, setPins] = useState<string[]>(pinned.map((p) => p.href));
  const [savingPins, setSavingPins] = useState(false);
  /** The href we are navigating to, and whether React is still fetching it.
   *  The global NavigationProgress bar only listens for real <a> clicks and
   *  form submits, so a programmatic router.push gave no feedback at all —
   *  the palette just vanished and the page changed whenever it felt like it. */
  const [navTo, setNavTo] = useState<string | null>(null);
  const [navPending, startNav] = useTransition();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const down = useRef<Set<string>>(new Set());
  /** Every request carries a token; only the newest may paint, so a slow early
   *  keystroke can't overwrite a fast later one. */
  const seq = useRef(0);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(pointer: fine)");
    const sync = () => setDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!desktop) return;
    const typing = (el: EventTarget | null) => {
      const n = el as HTMLElement | null;
      if (!n) return false;
      const tag = n.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || n.isContentEditable;
    };
    const onDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        if (typing(e.target)) return;
        e.preventDefault();
        setOpen(true);
        return;
      }
      if (!CHORD.has(e.key)) return;
      if (typing(e.target)) return;
      down.current.add(e.key);
      if (down.current.size === CHORD.size) {
        e.preventDefault();
        down.current.clear();
        setOpen(true);
      }
    };
    const onUp = (e: KeyboardEvent) => { down.current.delete(e.key); };
    const clear = () => down.current.clear();
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", clear);
    };
  }, [desktop]);

  // Lock the page while the palette is up.
  //
  // It must be the SCROLLING element, which in this app is <html>, not <body>:
  // body carries overflow hidden already and never scrolls, so locking it did
  // exactly nothing and the page kept moving behind the panel. The scrollbar's
  // width is paid back as padding, otherwise hiding it shifts the layout
  // sideways the moment the palette opens.
  useEffect(() => {
    if (!open) return;
    const el = (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
    const prevOverflow = el.style.overflow;
    const prevPad = el.style.paddingRight;
    const gap = window.innerWidth - document.documentElement.clientWidth;
    el.style.overflow = "hidden";
    if (gap > 0) el.style.paddingRight = `${gap}px`;
    return () => { el.style.overflow = prevOverflow; el.style.paddingRight = prevPad; };
  }, [open]);

  // Navigation finished — the new route's payload is in. Only now does the
  // palette get out of the way.
  useEffect(() => {
    if (navTo && !navPending) { setOpen(false); setNavTo(null); }
  }, [navTo, navPending]);

  useEffect(() => {
    if (!open) return;
    setSel(0);
    setOpenCode(null);
    setFlash(null);
    setPageQ("");
    setEditPins(false);
    setNavTo(null);
    const t = setTimeout(() => inputRef.current?.focus(), 20);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (term.length < 2) { setHits([]); setBusy(false); return; }
    setBusy(true);
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/quick-search?q=${encodeURIComponent(term)}`, { cache: "no-store" });
        const j = (await r.json()) as { hits?: Hit[] };
        if (mine !== seq.current) return;
        setHits(j.hits ?? []);
        setOpenCode(null);
      } catch {
        if (mine === seq.current) setHits([]);
      } finally {
        if (mine === seq.current) setBusy(false);
      }
    }, 140);
    return () => clearTimeout(t);
  }, [q, open]);

  /** Send a cut-and-ready slab straight to dispatch. The server action
   *  re-checks status='cut_done' itself, so a slab that got assigned to
   *  carving between the search and the click is refused, not silently moved. */
  const sendToReady = useCallback(async (h: Hit) => {
    setSending(h.code);
    setFlash(null);
    try {
      const fd = new FormData();
      fd.set("slab_ids", JSON.stringify([h.code]));
      const res = await directDispatchSlabsAction(fd);
      if (res.ok) {
        setFlash({ code: h.code, text: "Sent to Ready to dispatch", ok: true });
        setHits((prev) =>
          prev.map((x) =>
            x.code === h.code
              ? { ...x, stage: "Ready", where: x.where, canReady: false, readyBlockedBecause: "already ready" }
              : x,
          ),
        );
        router.refresh();
      } else {
        setFlash({ code: h.code, text: res.error, ok: false });
      }
    } catch (e) {
      setFlash({ code: h.code, text: e instanceof Error ? e.message : "Failed", ok: false });
    } finally {
      setSending(null);
    }
  }, [router]);

  const togglePin = (href: string) =>
    setPins((prev) =>
      prev.includes(href) ? prev.filter((h) => h !== href) : prev.length >= MAX_QUICK_LINKS ? prev : [...prev, href],
    );

  const savePins = async () => {
    setSavingPins(true);
    try {
      const res = await saveQuickLinksAction(pins);
      if (res.ok) { setPins(res.saved); setEditPins(false); router.refresh(); }
    } finally {
      setSavingPins(false);
    }
  };

  const byHref = new Map(pages.map((p) => [p.href, p]));
  const livePins = pins.map((h) => byHref.get(h)).filter(Boolean) as QuickPage[];
  const pageTerm = pageQ.trim().toLowerCase();
  const pageHits = pageTerm
    ? pages.filter((p) => p.label.toLowerCase().includes(pageTerm) || p.href.toLowerCase().includes(pageTerm)).slice(0, 8)
    : [];

  const goPage = (href: string) => {
    if (navTo) return; // one navigation at a time
    setNavTo(href);
    startNav(() => router.push(href));
  };

  if (!mounted || !desktop || !open) return null;

  const body = (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
      style={{
        position: "fixed", inset: 0, zIndex: 2000,
        background: "rgba(11,18,32,0.5)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "12vh 16px 24px",
      }}
    >
      <div
        className="qs-panel"
        style={{
          width: "min(700px, 94vw)",
          maxHeight: "76vh",
          display: "flex", flexDirection: "column",
          background: "#fff",
          borderRadius: 18,
          boxShadow: "0 30px 80px rgba(11,18,32,0.4), 0 0 0 1px rgba(11,18,32,0.05)",
          overflow: "hidden",
        }}
      >
        {/* A stripe across the top of the panel while a route loads — the same
            language as the app's global navigation bar, which does not fire for
            programmatic pushes. */}
        {navTo && (
          <div aria-hidden style={{ height: 3, background: "rgba(79,70,229,0.15)", overflow: "hidden", flexShrink: 0 }}>
            <div className="qs-bar" style={{ height: "100%", width: "40%", background: C.indigo, borderRadius: 999 }} />
          </div>
        )}

        {/* 1 — pinned links. Everyone, every department. */}
        <div style={{ padding: "13px 18px 11px", borderBottom: `1px solid ${C.line}`, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: livePins.length || editPins ? 9 : 0 }}>
            <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.09em", textTransform: "uppercase", color: C.muted }}>
              Your links
            </span>
            <button
              type="button"
              onClick={() => setEditPins((v) => !v)}
              style={{ marginLeft: "auto", border: "none", background: "transparent", color: editPins ? C.indigo : C.muted, fontSize: 11, fontWeight: 800, cursor: "pointer", padding: 0 }}
            >
              {editPins ? "Done choosing" : livePins.length ? "Edit" : `Choose up to ${MAX_QUICK_LINKS}`}
            </button>
          </div>

          {!editPins && livePins.length > 0 && (
            /* Tiles, not chips — these are the same doors as the dashboard
               cards, so they wear the same clothes: department eyebrow, big
               title, its department's colour. Three across, so six fit. */
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 9 }}>
              {livePins.map((p) => {
                const accent = DEPT_TINT[p.department] ?? DEPT_TINT.production;
                const loading = navTo === p.href;
                const dim = navTo != null && !loading;
                return (
                  <button
                    key={p.href}
                    type="button"
                    disabled={navTo != null}
                    onClick={() => goPage(p.href)}
                    className={loading ? "qs-pin qs-pin-loading" : "qs-pin"}
                    style={{
                      display: "flex", flexDirection: "column", justifyContent: "space-between",
                      gap: 10, minHeight: 84, textAlign: "left",
                      cursor: navTo ? "default" : "pointer",
                      opacity: dim ? 0.45 : 1, transition: "opacity .15s",
                      border: "none", borderRadius: 13, padding: "12px 14px",
                      background: `linear-gradient(135deg, ${accent.from} 0%, ${accent.to} 100%)`,
                      boxShadow: "0 2px 10px rgba(11,18,32,0.16)",
                      overflow: "hidden", position: "relative",
                    }}
                  >
                    {loading && (
                      <span aria-hidden style={{ position: "absolute", inset: 0, background: "rgba(11,18,32,0.28)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <span className="qs-spin" style={{ width: 18, height: 18, borderRadius: "50%", border: "2.5px solid rgba(255,255,255,0.35)", borderTopColor: "#fff", display: "inline-block" }} />
                      </span>
                    )}
                    <span aria-hidden style={{ position: "absolute", top: -22, right: -22, width: 84, height: 84, borderRadius: "50%", background: "radial-gradient(circle, rgba(255,255,255,0.20) 0%, rgba(255,255,255,0) 70%)", pointerEvents: "none" }} />
                    <span style={{ position: "relative", display: "block", fontSize: 8.5, fontWeight: 800, letterSpacing: "0.11em", textTransform: "uppercase", color: "rgba(255,255,255,0.72)" }}>
                      <span aria-hidden style={{ marginRight: 5 }}>{p.icon}</span>
                      {DEPT_LABEL[p.department] ?? p.department}
                    </span>
                    <span style={{ position: "relative", display: "block", fontSize: 14.5, fontWeight: 800, color: "#fff", letterSpacing: "-0.015em", lineHeight: 1.25 }}>
                      {p.label}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {!editPins && livePins.length === 0 && (
            <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.6 }}>
              Pin the pages you live in and they become buttons here.
            </div>
          )}

          {editPins && (
            <div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 168, overflowY: "auto", paddingRight: 2 }}>
                {pages.map((p) => {
                  const on = pins.includes(p.href);
                  const full = !on && pins.length >= MAX_QUICK_LINKS;
                  return (
                    <button
                      key={p.href}
                      type="button"
                      disabled={full}
                      onClick={() => togglePin(p.href)}
                      title={full ? `${MAX_QUICK_LINKS} is the limit — remove one first` : undefined}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 6,
                        cursor: full ? "not-allowed" : "pointer", opacity: full ? 0.4 : 1,
                        border: `1px solid ${on ? C.indigo : C.line}`,
                        background: on ? "rgba(79,70,229,0.08)" : "#fff",
                        color: on ? C.indigo : C.ink2,
                        borderRadius: 9, padding: "5px 10px", fontSize: 11.5, fontWeight: 700,
                      }}
                    >
                      <span aria-hidden style={{ fontSize: 12, lineHeight: 1 }}>{p.icon}</span>
                      {p.label}
                      {on && <span style={{ fontSize: 10 }}>✓</span>}
                    </button>
                  );
                })}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
                <span style={{ fontSize: 11, color: C.muted }}>{pins.length} of {MAX_QUICK_LINKS} chosen</span>
                <button
                  type="button"
                  onClick={() => void savePins()}
                  disabled={savingPins}
                  style={{ marginLeft: "auto", border: "none", borderRadius: 9, background: savingPins ? "#9aa4b5" : C.indigo, color: "#fff", fontSize: 12, fontWeight: 800, padding: "7px 16px", cursor: savingPins ? "default" : "pointer" }}
                >
                  {savingPins ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 2 — slab / block lookup. Production only. */}
        {slabLookup && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "15px 18px", borderBottom: q.trim().length >= 2 ? `1px solid ${C.line}` : "none", flexShrink: 0 }}>
          <span style={{ fontSize: 17, color: C.muted, lineHeight: 1 }}>⌕</span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") { setOpen(false); return; }
              if (e.key === "ArrowDown") { e.preventDefault(); setSel((i) => Math.min(i + 1, hits.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setSel((i) => Math.max(i - 1, 0)); }
              else if (e.key === "Enter" && hits[sel]) {
                e.preventDefault();
                // Enter opens the row in place. It never navigates.
                setOpenCode((c) => (c === hits[sel].code ? null : hits[sel].code));
              }
            }}
            placeholder="Code, label, category or description…"
            style={{
              flex: 1, border: "none", outline: "none", background: "transparent",
              fontSize: 17, fontWeight: 600, color: C.ink, letterSpacing: "-0.01em",
            }}
          />
          {busy && <span className="qs-spin" style={{ width: 14, height: 14, borderRadius: "50%", border: "2px solid #e6eaf0", borderTopColor: C.indigo, display: "inline-block", flexShrink: 0 }} />}
          <kbd style={{ fontSize: 10, fontWeight: 800, color: C.muted, background: C.wash, border: `1px solid ${C.line}`, borderRadius: 6, padding: "3px 7px", flexShrink: 0 }}>esc</kbd>
        </div>
        )}

        {/* Results */}
        {slabLookup && q.trim().length >= 2 && (
          <div style={{ overflowY: "auto", flex: 1, minHeight: 0 }}>
            {hits.length === 0 && !busy && (
              <div style={{ padding: "26px 20px", fontSize: 13, color: C.muted, textAlign: "center" }}>
                Nothing matches “{q.trim()}”.
              </div>
            )}
            {hits.map((h, i) => {
              const on = i === sel;
              const shown = openCode === h.code;
              const tone = toneFor(h.stage);
              return (
                <div key={`${h.kind}-${h.code}`} style={{ borderBottom: `1px solid ${C.line}` }}>
                  <div
                    role="button"
                    tabIndex={-1}
                    onMouseEnter={() => setSel(i)}
                    onClick={() => setOpenCode((c) => (c === h.code ? null : h.code))}
                    style={{
                      display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 14,
                      cursor: "pointer", padding: "11px 18px",
                      background: shown ? "rgba(79,70,229,0.06)" : on ? C.wash : "transparent",
                      borderLeft: `3px solid ${shown ? C.indigo : on ? "#cdd3de" : "transparent"}`,
                    }}
                  >
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 13.5, fontWeight: 800, color: C.ink, fontFamily: "ui-monospace, monospace" }}>{h.code}</span>
                        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.09em", color: "#fff", background: h.kind === "slab" ? "#94a3b8" : "#0284c7", borderRadius: 4, padding: "1.5px 5px" }}>
                          {h.kind.toUpperCase()}
                        </span>
                        {h.note && <span style={{ fontSize: 11.5, fontWeight: 700, color: C.ink2 }}>{h.note}</span>}
                      </span>
                      {h.temple && (
                        <span style={{ display: "block", fontSize: 11, color: C.muted, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {h.temple}
                        </span>
                      )}
                    </span>
                    <span style={{ textAlign: "right", flexShrink: 0 }}>
                      <span style={{ display: "inline-block", fontSize: 10.5, fontWeight: 800, color: tone, background: `${tone}18`, borderRadius: 999, padding: "3px 10px", whiteSpace: "nowrap" }}>
                        {h.stage}
                      </span>
                      <span style={{ display: "block", fontSize: 11, color: h.where ? C.ink2 : "#c8cdd6", marginTop: 3, whiteSpace: "nowrap" }}>
                        {h.where ?? "location not set"}
                      </span>
                    </span>
                  </div>

                  {/* Opened in place — the palette answers, it does not send
                      you somewhere else. */}
                  {shown && (
                    <div style={{ padding: "2px 18px 14px 21px", background: "rgba(79,70,229,0.03)" }}>
                      {h.detail && (
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "7px 18px", marginBottom: 11 }}>
                          <Field k="Category 1" v={h.detail.category1} />
                          <Field k="Category 2" v={h.detail.category2} />
                          <Field k="Description" v={h.detail.description} />
                          <Field k="Stone" v={h.detail.stone} />
                          <Field k="Size" v={h.detail.dims} />
                          <Field k="Storage" v={h.detail.parked ? "Parked in Main Storage" : null} />
                        </div>
                      )}

                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        {h.canReady ? (
                          <button
                            type="button"
                            disabled={sending === h.code}
                            onClick={(e) => { e.stopPropagation(); void sendToReady(h); }}
                            style={{
                              border: "none", borderRadius: 9, cursor: sending === h.code ? "default" : "pointer",
                              background: sending === h.code ? "#9aa4b5" : C.green, color: "#fff",
                              fontSize: 12, fontWeight: 800, padding: "8px 15px",
                            }}
                          >
                            {sending === h.code ? "Sending…" : "→ Send to Ready to dispatch"}
                          </button>
                        ) : h.kind === "slab" && h.readyBlockedBecause ? (
                          <span style={{ fontSize: 11.5, color: C.muted }}>
                            Can&rsquo;t send to dispatch — {h.readyBlockedBecause}.
                          </span>
                        ) : null}

                        <button
                          type="button"
                          disabled={navTo != null}
                          onClick={(e) => { e.stopPropagation(); goPage(h.href); }}
                          style={{ marginLeft: "auto", border: "none", background: "transparent", fontSize: 11.5, fontWeight: 800, color: C.indigo, cursor: navTo ? "default" : "pointer", display: "inline-flex", alignItems: "center", gap: 6, padding: 0 }}
                        >
                          {navTo === h.href && (
                            <span className="qs-spin" style={{ width: 11, height: 11, borderRadius: "50%", border: "2px solid #e6eaf0", borderTopColor: C.indigo, display: "inline-block" }} />
                          )}
                          Open in {h.kind === "slab" ? "Required Sizes" : "Blocks"} ↗
                        </button>
                      </div>

                      {flash && flash.code === h.code && (
                        <div style={{ marginTop: 9, fontSize: 11.5, fontWeight: 700, lineHeight: 1.6, color: flash.ok ? C.green : "#c0392b" }}>
                          {flash.ok ? "✓ " : "⚠ "}{flash.text}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* 3 — go to a page. Everyone. Searches only what this user may open;
             royalty and the personal ledger are not in the registry at all. */}
        <div style={{ borderTop: `1px solid ${C.line}`, background: C.wash, flexShrink: 0 }}>
          {pageHits.length > 0 && (
            <div style={{ maxHeight: 190, overflowY: "auto", borderBottom: `1px solid ${C.line}` }}>
              {pageHits.map((p) => (
                <button
                  key={p.href}
                  type="button"
                  disabled={navTo != null}
                  onClick={() => goPage(p.href)}
                  className="qs-pagehit"
                  style={{
                    display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left",
                    border: "none", background: "transparent",
                    cursor: navTo ? "default" : "pointer",
                    opacity: navTo != null && navTo !== p.href ? 0.45 : 1,
                    padding: "9px 18px", fontSize: 12.5, fontWeight: 700, color: C.ink,
                  }}
                >
                  <span aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>{p.icon}</span>
                  {p.label}
                  {navTo === p.href && (
                    <span className="qs-spin" style={{ width: 12, height: 12, borderRadius: "50%", border: "2px solid #e6eaf0", borderTopColor: C.indigo, display: "inline-block" }} />
                  )}
                  <span style={{ marginLeft: "auto", fontSize: 10.5, color: C.muted, fontFamily: "ui-monospace, monospace" }}>{p.href}</span>
                </button>
              ))}
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 18px" }}>
            <span style={{ fontSize: 12, color: C.muted, lineHeight: 1 }}>⇢</span>
            <input
              value={pageQ}
              onChange={(e) => setPageQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") { setOpen(false); return; }
                if (e.key === "Enter" && pageHits[0]) { e.preventDefault(); goPage(pageHits[0].href); }
              }}
              placeholder="Go to a page…"
              style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontSize: 12.5, fontWeight: 600, color: C.ink }}
            />
            <span style={{ fontSize: 10.5, color: C.muted, whiteSpace: "nowrap" }}>
              {slabLookup ? "Stage + location — Find ID has the full picture" : `${pages.length} pages`}
            </span>
          </div>
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
.qs-pin { transition: transform .12s ease, box-shadow .12s ease; }
.qs-pin:hover { transform: translateY(-2px); box-shadow: 0 8px 22px rgba(11,18,32,0.26) !important; }
.qs-pagehit:hover { background: rgba(79,70,229,0.07) !important; }
.qs-panel { animation: qsIn .13s cubic-bezier(.22,1,.36,1) both; }
@keyframes qsIn { from { opacity: 0; transform: translateY(-8px) scale(.985) } to { opacity: 1; transform: none } }
.qs-spin { animation: qsSpin .7s linear infinite; }
.qs-pin-loading { transform: none !important; }
.qs-bar { animation: qsBar 1s ease-in-out infinite; }
@keyframes qsBar { 0% { margin-left: -40% } 100% { margin-left: 100% } }
@keyframes qsSpin { to { transform: rotate(360deg) } }
@media (prefers-reduced-motion: reduce) { .qs-panel, .qs-spin, .qs-bar { animation: none } }
` }} />
    </div>
  );

  // Portalled to body — see the header note; the topbar's backdrop-filter
  // would otherwise capture position:fixed and paint the dim as a black strip.
  return createPortal(body, document.body);
}

function Field({ k, v }: { k: string; v: string | null }) {
  if (!v) return null;
  return (
    <span style={{ minWidth: 0 }}>
      <span style={{ display: "block", fontSize: 9, fontWeight: 800, letterSpacing: "0.09em", textTransform: "uppercase", color: "#b6bdc9" }}>{k}</span>
      <span style={{ display: "block", fontSize: 12, fontWeight: 700, color: C.ink2, marginTop: 1 }}>{v}</span>
    </span>
  );
}
