"use client";

/**
 * On-screen signature capture (Daksh) — draw with finger / stylus / mouse via
 * pointer events, so it works on the floor tablets AND on a desktop. Outputs a
 * small PNG data-URL. Used (optional for now) on the royalty add-entry form so
 * the owner can see the vendor's signature when approving.
 *
 * <SignatureCaptureButton value onChange /> shows a button when empty, a live
 * thumbnail + Redo/Remove once signed; the drawing happens in a modal.
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
      {open && <SignatureModal onClose={() => setOpen(false)} onSave={(v) => { onChange(v); setOpen(false); }} />}
    </>
  );
}

function SignatureModal({ onClose, onSave }: { onClose: () => void; onSave: (v: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const drawn = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  function ctxOf() {
    const c = canvasRef.current;
    return c ? c.getContext("2d") : null;
  }
  useEffect(() => {
    const ctx = ctxOf();
    const c = canvasRef.current;
    if (!ctx || !c) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, []);

  function pos(e: React.PointerEvent) {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) };
  }
  function down(e: React.PointerEvent) {
    e.preventDefault();
    drawing.current = true;
    last.current = pos(e);
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* older browsers */ }
  }
  function move(e: React.PointerEvent) {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = ctxOf();
    if (!ctx || !last.current) return;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    drawn.current = true;
  }
  function up() { drawing.current = false; last.current = null; }
  function clear() {
    const ctx = ctxOf();
    const c = canvasRef.current;
    if (!ctx || !c) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
    drawn.current = false;
  }
  function save() {
    if (!drawn.current) { onClose(); return; }
    onSave(canvasRef.current!.toDataURL("image/png"));
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 6000, background: "rgba(15,23,42,0.6)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(560px, 100%)", background: "var(--surface, #fff)", borderRadius: 16, padding: 18, boxShadow: "0 28px 70px rgba(0,0,0,0.4)" }}>
        <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 10, color: "var(--text)" }}>✍️ Vendor signature</div>
        <canvas
          ref={canvasRef}
          width={560}
          height={220}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerLeave={up}
          style={{ width: "100%", height: 220, border: "1.5px dashed var(--border)", borderRadius: 10, background: "#fff", touchAction: "none", cursor: "crosshair", display: "block" }}
        />
        <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>Sign above with a finger, stylus, or mouse.</div>
        <div style={{ display: "flex", gap: 10, justifyContent: "space-between", marginTop: 14 }}>
          <button type="button" onClick={clear} style={{ ...smallBtn }}>↺ Clear</button>
          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" onClick={onClose} style={{ ...smallBtn }}>Cancel</button>
            <button type="button" onClick={save} style={{ fontSize: 13, fontWeight: 800, padding: "9px 18px", borderRadius: 10, border: "none", color: "#fff", background: "#0f172a", cursor: "pointer" }}>✓ Save signature</button>
          </div>
        </div>
      </div>
    </div>
  );
}

const smallBtn: React.CSSProperties = {
  fontSize: 12.5, fontWeight: 600, padding: "8px 13px", borderRadius: 9,
  border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", cursor: "pointer",
};
