"use client";

/**
 * On-screen signature capture (Daksh) — v2, FULL-SCREEN.
 *
 * The old pad was a small 880×380 strip inside a modal — cramped and jittery on
 * the floor tablets ("really hard to use"). Now tapping ✍️ opens a full-screen
 * white sheet: the ENTIRE screen is the signing surface, so the vendor signs
 * wherever they like, any size.
 *
 *   • High-DPI canvas (devicePixelRatio) + quadratic smoothing + coalesced
 *     pointer events + light pressure → real ink feel, no jaggies.
 *   • ↶ Undo (per stroke), ↺ Clear, big tablet-friendly buttons.
 *   • Save auto-CROPS to just the inked area (padded) so the stored PNG is the
 *     signature itself, not a huge white sheet — thumbnails look right and the
 *     data-URL stays small.
 *   • 📷 "Photo instead" — the easy alternative: vendor signs on paper like
 *     they always have, you snap it with the camera; downscaled + stored the
 *     same way.
 *   • Survives rotation/resize (strokes replay), body scroll locked while open.
 *
 * Output stays a small data-URL string → vendor_royalty_entries.signature_data
 * (mig 175), which the owner already sees on the royalty-approvals page. Same
 * <SignatureCaptureButton value onChange /> API as v1.
 */

import { useEffect, useRef, useState } from "react";

export function SignatureCaptureButton({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {value ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt="Vendor signature" style={{ height: 46, maxWidth: 200, objectFit: "contain", border: "1px solid var(--border)", borderRadius: 6, background: "#fff" }} />
          <button type="button" onClick={() => setOpen(true)} style={smallBtn}>✍️ Redo</button>
          <button type="button" onClick={() => onChange(null)} style={{ ...smallBtn, color: "#b91c1c" }}>✕ Remove</button>
        </div>
      ) : (
        <button type="button" onClick={() => setOpen(true)} style={{ ...smallBtn, fontWeight: 700 }}>✍️ Add vendor signature</button>
      )}
      {open && <FullscreenSignaturePad onClose={() => setOpen(false)} onSave={(v) => { onChange(v); setOpen(false); }} />}
    </>
  );
}

type Pt = { x: number; y: number; p: number }; // CSS px + pressure 0..1

function FullscreenSignaturePad({ onClose, onSave }: { onClose: () => void; onSave: (v: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const strokes = useRef<Pt[][]>([]);
  const current = useRef<Pt[] | null>(null);
  const [hasInk, setHasInk] = useState(false);
  const [, bump] = useState(0); // re-render for Undo button state

  const BASE_W = 3.4; // CSS px pen width at normal pressure

  // ── canvas setup + replay ─────────────────────────────────────────
  function setupAndReplay() {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const w = window.innerWidth, h = window.innerHeight;
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    for (const s of strokes.current) drawStroke(ctx, s);
  }
  function drawStroke(ctx: CanvasRenderingContext2D, pts: Pt[]) {
    if (pts.length === 0) return;
    ctx.strokeStyle = "#101828";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (pts.length < 3) {
      ctx.beginPath();
      ctx.lineWidth = BASE_W * (0.6 + pts[0].p * 0.9);
      ctx.arc(pts[0].x, pts[0].y, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fillStyle = "#101828";
      ctx.fill();
      return;
    }
    // quadratic through midpoints — smooth ink
    for (let i = 1; i < pts.length - 1; i++) {
      const m1 = { x: (pts[i - 1].x + pts[i].x) / 2, y: (pts[i - 1].y + pts[i].y) / 2 };
      const m2 = { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 };
      ctx.beginPath();
      ctx.lineWidth = BASE_W * (0.6 + pts[i].p * 0.9);
      ctx.moveTo(m1.x, m1.y);
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, m2.x, m2.y);
      ctx.stroke();
    }
  }

  useEffect(() => {
    setupAndReplay();
    const onResize = () => setupAndReplay();
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    // lock page scroll while the sheet is open
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── drawing ───────────────────────────────────────────────────────
  function ptOf(e: PointerEvent | React.PointerEvent): Pt {
    return { x: e.clientX, y: e.clientY, p: e.pressure && e.pressure > 0 ? Math.min(1, e.pressure) : 0.5 };
  }
  function down(e: React.PointerEvent) {
    e.preventDefault();
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* older browsers */ }
    current.current = [ptOf(e)];
  }
  function move(e: React.PointerEvent) {
    if (!current.current) return;
    e.preventDefault();
    const native = e.nativeEvent as PointerEvent;
    const pts: Pt[] = [];
    // coalesced events = every sample the digitiser saw, not just per-frame
    if (typeof native.getCoalescedEvents === "function") {
      for (const ce of native.getCoalescedEvents()) pts.push(ptOf(ce));
    }
    if (pts.length === 0) pts.push(ptOf(e));
    const s = current.current;
    const ctx = canvasRef.current?.getContext("2d");
    for (const p of pts) {
      s.push(p);
      // incremental smooth segment
      if (ctx && s.length >= 3) {
        const n = s.length;
        const m1 = { x: (s[n - 3].x + s[n - 2].x) / 2, y: (s[n - 3].y + s[n - 2].y) / 2 };
        const m2 = { x: (s[n - 2].x + s[n - 1].x) / 2, y: (s[n - 2].y + s[n - 1].y) / 2 };
        ctx.strokeStyle = "#101828";
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.lineWidth = BASE_W * (0.6 + s[n - 2].p * 0.9);
        ctx.moveTo(m1.x, m1.y);
        ctx.quadraticCurveTo(s[n - 2].x, s[n - 2].y, m2.x, m2.y);
        ctx.stroke();
      }
    }
  }
  function up() {
    const s = current.current;
    current.current = null;
    if (!s || s.length === 0) return;
    strokes.current.push(s);
    if (s.length < 3) { const ctx = canvasRef.current?.getContext("2d"); if (ctx) drawStroke(ctx, s); } // dot
    setHasInk(true);
    bump((n) => n + 1);
  }
  function undo() {
    strokes.current.pop();
    if (strokes.current.length === 0) setHasInk(false);
    setupAndReplay();
    bump((n) => n + 1);
  }
  function clearAll() {
    strokes.current = [];
    setHasInk(false);
    setupAndReplay();
  }

  // ── save: crop to ink bbox + downscale ────────────────────────────
  function save() {
    if (!hasInk) { onClose(); return; }
    const all = strokes.current.flat();
    const PAD = 26;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of all) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    x0 -= PAD; y0 -= PAD; x1 += PAD; y1 += PAD;
    const w = Math.max(60, x1 - x0), h = Math.max(60, y1 - y0);
    const scale = Math.min(2, 1000 / w); // crisp but ≤1000px wide
    const out = document.createElement("canvas");
    out.width = Math.round(w * scale);
    out.height = Math.round(h * scale);
    const ctx = out.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.setTransform(scale, 0, 0, scale, -x0 * scale, -y0 * scale);
    for (const s of strokes.current) drawStroke(ctx, s);
    onSave(out.toDataURL("image/png"));
  }

  // ── photo alternative (vendor signs on paper → snap it) ──────────
  function onPhoto(file: File | null) {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const maxW = 1200;
      const scale = Math.min(1, maxW / img.width);
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      onSave(c.toDataURL("image/jpeg", 0.82));
    };
    img.src = url;
  }

  const canUndo = strokes.current.length > 0;
  const bar: React.CSSProperties = {
    position: "absolute", left: 0, right: 0, display: "flex", alignItems: "center", gap: 10,
    padding: "10px 14px", pointerEvents: "none", // buttons re-enable below
  };
  const bigBtn: React.CSSProperties = {
    pointerEvents: "auto", fontSize: 14, fontWeight: 800, padding: "12px 20px", borderRadius: 12,
    border: "1px solid var(--border)", background: "rgba(255,255,255,0.94)", color: "#0f172a",
    cursor: "pointer", boxShadow: "0 2px 10px rgba(15,23,42,0.12)",
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 6000, background: "#fff", touchAction: "none", overscrollBehavior: "contain" }}>
      <canvas
        ref={canvasRef}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        style={{ position: "absolute", inset: 0, touchAction: "none", cursor: "crosshair", display: "block" }}
      />

      {/* ghost hint — disappears once they start signing */}
      {!hasInk && (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none" }}>
          <div style={{ textAlign: "center", color: "rgba(15,23,42,0.22)", userSelect: "none" }}>
            <div style={{ fontSize: 44 }}>✍️</div>
            <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: "0.02em" }}>Sign anywhere on this screen</div>
            <div style={{ fontSize: 13.5, fontWeight: 600, marginTop: 4 }}>The whole screen is the pad — big and comfortable.</div>
          </div>
        </div>
      )}

      {/* top bar — title + cancel */}
      <div style={{ ...bar, top: 0, justifyContent: "space-between" }}>
        <span style={{ pointerEvents: "none", fontSize: 14.5, fontWeight: 900, color: "#0f172a", background: "rgba(255,255,255,0.9)", borderRadius: 10, padding: "8px 14px", boxShadow: "0 2px 10px rgba(15,23,42,0.08)" }}>
          ✍️ Vendor signature
        </span>
        <button type="button" onClick={onClose} style={{ ...bigBtn, fontWeight: 700 }}>✕ Cancel</button>
      </div>

      {/* bottom bar — tools left, save right */}
      <div style={{ ...bar, bottom: 0, justifyContent: "space-between", paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
        <span style={{ display: "inline-flex", gap: 10 }}>
          <button type="button" onClick={undo} disabled={!canUndo} style={{ ...bigBtn, opacity: canUndo ? 1 : 0.45 }}>↶ Undo</button>
          <button type="button" onClick={clearAll} disabled={!canUndo} style={{ ...bigBtn, opacity: canUndo ? 1 : 0.45 }}>↺ Clear</button>
          <button type="button" onClick={() => fileRef.current?.click()} style={bigBtn} title="Vendor signed on paper? Take a photo of it instead.">📷 Photo instead</button>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={(e) => { onPhoto(e.target.files?.[0] ?? null); e.target.value = ""; }} />
        </span>
        <button type="button" onClick={save} disabled={!hasInk} style={{ ...bigBtn, background: hasInk ? "#0f172a" : "rgba(15,23,42,0.35)", color: "#fff", border: "none", padding: "12px 26px" }}>
          ✓ Save signature
        </button>
      </div>
    </div>
  );
}

const smallBtn: React.CSSProperties = {
  fontSize: 12.5, fontWeight: 600, padding: "8px 13px", borderRadius: 9,
  border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", cursor: "pointer",
};
