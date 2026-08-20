"use client";

/**
 * Quick search palette (Daksh, Aug 2026) — production floor.
 *
 * Find ID answers everything about an ID and takes a moment to do it. This
 * answers the two questions asked mid-stride — WHERE is it, WHAT STAGE is it
 * at — and nothing else, so it can answer while you are still typing.
 *
 * OPENING IT. Hold ; and ' together. They are neighbours on the home row, so
 * it is one motion with the right hand and no modifier key to reach for. Esc
 * closes. The chord is ignored while you are typing in a field, so it can
 * never eat a legitimate apostrophe.
 *
 * DESKTOP ONLY, on purpose. Tablets on the floor run the app's own on-screen
 * keyboard; a chord shortcut means nothing there and a second search UI would
 * just be in the way. Gated on (pointer: fine) — a real mouse or trackpad —
 * rather than a width guess.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Hit = {
  kind: "slab" | "block";
  code: string;
  temple: string | null;
  stage: string;
  where: string | null;
  note: string | null;
  href: string;
};

/** The two keys of the chord. */
const CHORD = new Set([";", "'"]);

const STAGE_TONE: Array<[RegExp, string]> = [
  [/dispatch/i, "#0f9d58"],
  [/ready/i, "#0f9d58"],
  [/carving/i, "#7c3aed"],
  [/cutter|cutting/i, "#c2740a"],
  [/cut done/i, "#0284c7"],
  [/cancel|reject/i, "#c0392b"],
];
const toneFor = (stage: string) => STAGE_TONE.find(([re]) => re.test(stage))?.[1] ?? "#64748b";

export function QuickSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState(0);
  const [desktop, setDesktop] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const down = useRef<Set<string>>(new Set());
  /** Every in-flight request carries a token; only the newest may paint, so a
   *  slow early keystroke can't overwrite a fast later one. */
  const seq = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(pointer: fine)");
    const sync = () => setDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // ── the chord ──────────────────────────────────────────────────────────
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
      if (!CHORD.has(e.key)) return;
      // Never steal a keystroke from a field — including this palette's own.
      if (typing(e.target)) return;
      down.current.add(e.key);
      if (down.current.size === CHORD.size) {
        e.preventDefault();
        down.current.clear();
        setOpen(true);
      }
    };
    const onUp = (e: KeyboardEvent) => { down.current.delete(e.key); };
    // A lost focus (alt-tab mid-chord) would otherwise leave a key "held".
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

  useEffect(() => {
    if (!open) return;
    setSel(0);
    const t = setTimeout(() => inputRef.current?.focus(), 20);
    return () => clearTimeout(t);
  }, [open]);

  // ── suggestions, debounced ─────────────────────────────────────────────
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
        if (mine !== seq.current) return; // a newer keystroke already won
        setHits(j.hits ?? []);
      } catch {
        if (mine === seq.current) setHits([]);
      } finally {
        if (mine === seq.current) setBusy(false);
      }
    }, 140);
    return () => clearTimeout(t);
  }, [q, open]);

  const go = useCallback((h: Hit) => {
    setOpen(false);
    setQ("");
    router.push(h.href);
  }, [router]);

  if (!desktop || !open) return null;

  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
      style={{
        position: "fixed", inset: 0, zIndex: 400,
        background: "rgba(11,18,32,0.45)", backdropFilter: "blur(3px)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        paddingTop: "14vh",
      }}
    >
      <div
        className="qs-panel"
        style={{
          width: "min(660px, 92vw)",
          background: "#fff",
          borderRadius: 16,
          boxShadow: "0 24px 70px rgba(11,18,32,0.35), 0 0 0 1px rgba(11,18,32,0.06)",
          overflow: "hidden",
        }}
      >
        {/* Input row */}
        <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "14px 17px", borderBottom: hits.length || q.trim().length >= 2 ? "1px solid #e6eaf0" : "none" }}>
          <span style={{ fontSize: 16, color: "#8892a4" }}>⌕</span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") { setOpen(false); return; }
              if (e.key === "ArrowDown") { e.preventDefault(); setSel((i) => Math.min(i + 1, hits.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setSel((i) => Math.max(i - 1, 0)); }
              else if (e.key === "Enter" && hits[sel]) { e.preventDefault(); go(hits[sel]); }
            }}
            placeholder="Slab or block code…"
            style={{
              flex: 1, border: "none", outline: "none", background: "transparent",
              fontSize: 17, fontWeight: 600, color: "#0b1220", letterSpacing: "-0.01em",
            }}
          />
          {busy && <span className="qs-spin" style={{ width: 13, height: 13, borderRadius: "50%", border: "2px solid #e6eaf0", borderTopColor: "#4f46e5", display: "inline-block" }} />}
          <kbd style={{ fontSize: 10, fontWeight: 800, color: "#8892a4", background: "#f6f8fb", border: "1px solid #e6eaf0", borderRadius: 6, padding: "3px 7px" }}>esc</kbd>
        </div>

        {/* Results */}
        {q.trim().length >= 2 && (
          <div style={{ maxHeight: "48vh", overflowY: "auto" }}>
            {hits.length === 0 && !busy && (
              <div style={{ padding: "20px 18px", fontSize: 13, color: "#8892a4" }}>
                Nothing matches “{q.trim()}”.
              </div>
            )}
            {hits.map((h, i) => {
              const on = i === sel;
              const tone = toneFor(h.stage);
              return (
                <button
                  key={`${h.kind}-${h.code}`}
                  type="button"
                  onMouseEnter={() => setSel(i)}
                  onClick={() => go(h)}
                  style={{
                    display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 12,
                    width: "100%", textAlign: "left", border: "none", cursor: "pointer",
                    background: on ? "rgba(79,70,229,0.07)" : "transparent",
                    padding: "10px 17px", borderLeft: `3px solid ${on ? "#4f46e5" : "transparent"}`,
                  }}
                >
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 800, color: "#0b1220", fontFamily: "ui-monospace, monospace" }}>{h.code}</span>
                      <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.08em", color: "#8892a4", textTransform: "uppercase" }}>{h.kind}</span>
                      {h.note && <span style={{ fontSize: 11.5, color: "#3f4a5c", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.note}</span>}
                    </span>
                    {h.temple && (
                      <span style={{ display: "block", fontSize: 11, color: "#8892a4", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {h.temple}
                      </span>
                    )}
                  </span>
                  <span style={{ textAlign: "right", flexShrink: 0 }}>
                    <span style={{ display: "inline-block", fontSize: 10.5, fontWeight: 800, color: tone, background: `${tone}18`, borderRadius: 999, padding: "3px 10px", whiteSpace: "nowrap" }}>
                      {h.stage}
                    </span>
                    <span style={{ display: "block", fontSize: 11, color: h.where ? "#3f4a5c" : "#c8cdd6", marginTop: 3, whiteSpace: "nowrap" }}>
                      {h.where ?? "location not set"}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Footer hint */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "9px 17px", borderTop: "1px solid #e6eaf0", background: "#f6f8fb", fontSize: 10.5, color: "#8892a4" }}>
          <span>↑↓ move</span>
          <span>↵ open</span>
          <span style={{ marginLeft: "auto" }}>Stage + location only — Find ID has the full picture</span>
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
}
