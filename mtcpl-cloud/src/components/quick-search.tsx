"use client";

/**
 * Quick search palette (Daksh, Aug 2026) — production floor.
 *
 * Find ID answers everything about an ID and takes a moment to do it. This
 * answers the questions asked mid-stride — WHERE is it, WHAT STAGE is it at —
 * and answers them while you are still typing.
 *
 * It matches on more than the code: label, either category, the description.
 * On the floor a piece is known by what it IS, not only by what is stencilled
 * on it.
 *
 * OPENING IT. ⌘K / Ctrl+K, or hold ; and ' — neighbours on the home row, one
 * motion with the right hand. Esc closes. Both are ignored while you are
 * typing in a field, so the chord can never eat a legitimate apostrophe.
 * ⌘K yields on /carving, where the board bound it to its own search first.
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

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { directDispatchSlabsAction } from "@/app/(app)/carving/actions";

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

const STAGE_TONE: Array<[RegExp, string]> = [
  [/dispatch/i, C.green],
  [/ready/i, C.green],
  [/carving/i, "#7c3aed"],
  [/cutter|cutting/i, "#c2740a"],
  [/cut done/i, "#0284c7"],
  [/cancel|reject/i, "#c0392b"],
];
const toneFor = (stage: string) => STAGE_TONE.find(([re]) => re.test(stage))?.[1] ?? "#64748b";

export function QuickSearch() {
  const router = useRouter();
  const pathname = usePathname();
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
    // The Carving Jobs board owns ⌘K for its own search box; the chord still
    // works there, so nothing is lost.
    const cmdKTaken = pathname === "/carving";

    const onDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        if (cmdKTaken || typing(e.target)) return;
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
  }, [desktop, pathname]);

  useEffect(() => {
    if (!open) return;
    setSel(0);
    setOpenCode(null);
    setFlash(null);
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
        {/* Input */}
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

        {/* Results */}
        {q.trim().length >= 2 && (
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

                        <a
                          href={h.href}
                          onClick={(e) => e.stopPropagation()}
                          style={{ marginLeft: "auto", fontSize: 11.5, fontWeight: 800, color: C.indigo, textDecoration: "none" }}
                        >
                          Open in {h.kind === "slab" ? "Required Sizes" : "Blocks"} ↗
                        </a>
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

        {/* Footer */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "9px 18px", borderTop: `1px solid ${C.line}`, background: C.wash, fontSize: 10.5, color: C.muted, flexShrink: 0 }}>
          <span>↑↓ move</span>
          <span>↵ open here</span>
          <span>esc close</span>
          <span style={{ marginLeft: "auto" }}>Stage + location — Find ID has the full picture</span>
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
.qs-panel { animation: qsIn .13s cubic-bezier(.22,1,.36,1) both; }
@keyframes qsIn { from { opacity: 0; transform: translateY(-8px) scale(.985) } to { opacity: 1; transform: none } }
.qs-spin { animation: qsSpin .7s linear infinite; }
@keyframes qsSpin { to { transform: rotate(360deg) } }
@media (prefers-reduced-motion: reduce) { .qs-panel, .qs-spin { animation: none } }
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
