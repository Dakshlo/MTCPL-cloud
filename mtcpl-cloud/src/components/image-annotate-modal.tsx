"use client";

/**
 * Daksh (June 2026) — image annotation modal for carving review.
 *
 * Daksh: "after upload we can highlight or do color marking image
 * (it will be helpful to identify problem in future steps); those
 * highlighted marks will show in carving done pages and all relevant
 * like rework / carving rejected page with image."
 *
 * Design decision — marks are BAKED INTO the image. The user draws
 * translucent highlighter strokes on a canvas laid over the captured
 * photo; on Save we composite photo + strokes and export a single
 * JPEG File. That uploaded file already carries the marks, so every
 * surface that renders review_image_path (Carving Done card + peek,
 * vendor cockpit rework photo, Carving Rejected page) shows the
 * annotated image with ZERO display-side changes and no extra schema
 * / storage. The trade-off (marks aren't separately toggleable) is
 * exactly what's wanted here: "show the problem on the photo".
 *
 * Pointer Events unify mouse + touch + pen; touch-action:none on the
 * canvas stops the page scrolling mid-stroke. Strokes are kept as
 * point arrays so Undo / Clear are trivial (we just repaint).
 *
 * The source image's longest side is capped (MAX_DIM) so a 12-MP
 * phone photo doesn't export a huge file — keeps us under the 5 MB
 * carving_review_media bucket cap.
 */

import { useEffect, useRef, useState } from "react";

type Point = { x: number; y: number };
type Stroke = { color: string; width: number; points: Point[] };

type Props = {
  /** The photo to annotate (from CameraCaptureModal or a prior mark
   *  pass). */
  file: File;
  /** Called with the composited (photo + marks) File on Save. */
  onDone: (file: File) => void;
  /** Called on Cancel / Esc / backdrop — keep the photo as-is. */
  onCancel: () => void;
};

// Highlighter palette. Red default (problem), then amber / lime /
// sky / white for variety. Translucent so the photo shows through.
const COLORS = [
  { key: "red", value: "#ef4444", label: "Red" },
  { key: "amber", value: "#f59e0b", label: "Amber" },
  { key: "lime", value: "#84cc16", label: "Green" },
  { key: "sky", value: "#38bdf8", label: "Blue" },
  { key: "white", value: "#ffffff", label: "White" },
];

const MAX_DIM = 1600; // cap the longest side of the working canvas

export function ImageAnnotateModal({ file, onDone, onCancel }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const currentRef = useRef<Stroke | null>(null);
  const drawingRef = useRef(false);

  const [color, setColor] = useState(COLORS[0].value);
  const [ready, setReady] = useState(false);
  // Mark count drives the toolbar (Undo/Clear enabled-state + the
  // "N marks" label) AND serves as the re-render trigger after a
  // committed change. Drawing itself paints imperatively.
  const [markCount, setMarkCount] = useState(0);
  const [saving, setSaving] = useState(false);

  // Brush width scales with the image so it reads the same on a
  // small slab close-up and a wide shot.
  const brushWidth = () => {
    const c = canvasRef.current;
    if (!c) return 14;
    return Math.max(8, Math.round(Math.max(c.width, c.height) * 0.012));
  };

  function repaint() {
    const c = canvasRef.current;
    const img = imgRef.current;
    if (!c || !img) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const all = currentRef.current
      ? [...strokesRef.current, currentRef.current]
      : strokesRef.current;
    for (const s of all) {
      if (s.points.length === 0) continue;
      ctx.save();
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      // Highlighter feel — translucent + multiply so overlapping
      // strokes deepen rather than wash out.
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      if (s.points.length === 1) {
        // A tap = a dot.
        const p = s.points[0];
        ctx.arc(p.x, p.y, s.width / 2, 0, Math.PI * 2);
        ctx.fillStyle = s.color;
        ctx.fill();
      } else {
        ctx.moveTo(s.points[0].x, s.points[0].y);
        for (let i = 1; i < s.points.length; i++) {
          ctx.lineTo(s.points[i].x, s.points[i].y);
        }
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // Load the image into the canvas at a capped resolution.
  useEffect(() => {
    let cancelled = false;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const c = canvasRef.current;
      if (!c) return;
      let w = img.naturalWidth || 1280;
      let h = img.naturalHeight || 720;
      const longest = Math.max(w, h);
      if (longest > MAX_DIM) {
        const scale = MAX_DIM / longest;
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
      c.width = w;
      c.height = h;
      imgRef.current = img;
      strokesRef.current = [];
      currentRef.current = null;
      setMarkCount(0);
      setReady(true);
      repaint();
    };
    img.src = url;
    return () => {
      cancelled = true;
      URL.revokeObjectURL(url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  // Esc cancels.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  function toCanvasCoords(clientX: number, clientY: number): Point {
    const c = canvasRef.current;
    if (!c) return { x: 0, y: 0 };
    const rect = c.getBoundingClientRect();
    const scaleX = c.width / rect.width;
    const scaleY = c.height / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!ready) return;
    e.preventDefault();
    (e.target as HTMLCanvasElement).setPointerCapture?.(e.pointerId);
    drawingRef.current = true;
    currentRef.current = {
      color,
      width: brushWidth(),
      points: [toCanvasCoords(e.clientX, e.clientY)],
    };
    repaint();
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current || !currentRef.current) return;
    e.preventDefault();
    currentRef.current.points.push(toCanvasCoords(e.clientX, e.clientY));
    repaint();
  }

  function endStroke() {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    if (currentRef.current && currentRef.current.points.length > 0) {
      strokesRef.current.push(currentRef.current);
    }
    currentRef.current = null;
    setMarkCount(strokesRef.current.length);
    repaint();
  }

  function undo() {
    strokesRef.current.pop();
    setMarkCount(strokesRef.current.length);
    repaint();
  }

  function clearAll() {
    strokesRef.current = [];
    currentRef.current = null;
    setMarkCount(0);
    repaint();
  }

  function save() {
    const c = canvasRef.current;
    if (!c) return;
    setSaving(true);
    c.toBlob(
      (blob) => {
        if (!blob) {
          setSaving(false);
          return;
        }
        const base = file.name.replace(/\.[^.]+$/, "");
        const cleanBase = base.endsWith("-marked") ? base : `${base}-marked`;
        const out = new File([blob], `${cleanBase}.jpg`, { type: "image/jpeg" });
        onDone(out);
      },
      "image/jpeg",
      0.85,
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Mark photo"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10001,
        background: "rgba(0, 0, 0, 0.94)",
        display: "flex",
        flexDirection: "column",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      {/* Top bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          color: "#fff",
        }}
      >
        <button
          type="button"
          onClick={onCancel}
          style={{
            background: "rgba(255,255,255,0.12)",
            color: "#fff",
            border: "1px solid rgba(255,255,255,0.2)",
            padding: "6px 12px",
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          ← Cancel
        </button>
        <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.04em" }}>
          ✏️ MARK THE PROBLEM
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={undo}
            disabled={markCount === 0}
            title="Undo last mark"
            style={{
              background: "rgba(255,255,255,0.12)",
              color: "#fff",
              border: "1px solid rgba(255,255,255,0.2)",
              padding: "6px 12px",
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 700,
              cursor: markCount === 0 ? "not-allowed" : "pointer",
              opacity: markCount === 0 ? 0.4 : 1,
            }}
          >
            ↶ Undo
          </button>
          <button
            type="button"
            onClick={clearAll}
            disabled={markCount === 0}
            title="Clear all marks"
            style={{
              background: "rgba(255,255,255,0.12)",
              color: "#fff",
              border: "1px solid rgba(255,255,255,0.2)",
              padding: "6px 12px",
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 700,
              cursor: markCount === 0 ? "not-allowed" : "pointer",
              opacity: markCount === 0 ? 0.4 : 1,
            }}
          >
            ✕ Clear
          </button>
        </div>
      </div>

      {/* Canvas viewport */}
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 8,
          minHeight: 0,
        }}
      >
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endStroke}
          onPointerLeave={endStroke}
          onPointerCancel={endStroke}
          style={{
            maxWidth: "100%",
            maxHeight: "100%",
            display: "block",
            borderRadius: 8,
            background: "#000",
            boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
            touchAction: "none",
            cursor: "crosshair",
          }}
        />
      </div>

      {/* Bottom bar — color swatches + Save */}
      <div
        style={{
          padding: "14px 14px 24px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          {COLORS.map((c) => {
            const active = c.value === color;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => setColor(c.value)}
                aria-label={c.label}
                title={c.label}
                style={{
                  width: active ? 40 : 34,
                  height: active ? 40 : 34,
                  borderRadius: "50%",
                  background: c.value,
                  border: active
                    ? "3px solid #fff"
                    : "2px solid rgba(255,255,255,0.35)",
                  cursor: "pointer",
                  boxShadow: active ? "0 0 0 2px rgba(0,0,0,0.4)" : "none",
                  transition: "width 0.12s, height 0.12s",
                  touchAction: "manipulation",
                }}
              />
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <span style={{ color: "rgba(255,255,255,0.65)", fontSize: 12 }}>
            {markCount === 0
              ? "Draw on the photo to highlight"
              : `${markCount} mark${markCount === 1 ? "" : "s"}`}
          </span>
          <button
            type="button"
            onClick={save}
            disabled={saving || !ready}
            style={{
              padding: "12px 26px",
              background: "#16a34a",
              color: "#fff",
              border: "1px solid #15803d",
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 800,
              cursor: saving || !ready ? "not-allowed" : "pointer",
              opacity: saving || !ready ? 0.6 : 1,
              minHeight: 48,
              touchAction: "manipulation",
            }}
          >
            {saving ? "Saving…" : "✓ Save marks"}
          </button>
        </div>
      </div>
    </div>
  );
}
