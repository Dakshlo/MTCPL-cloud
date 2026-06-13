"use client";

/**
 * 🚫 Request slab cancel — shared modal (mig 132).
 *
 * Opened by long-pressing a slab card (Carving Unassigned, Make
 * Dispatch) or from the job peek / Carving Done Approval. Reason is
 * mandatory, damage photo optional. Sends the request to the owner's
 * task panel; the slab stays where it is, red + locked, until the
 * owner approves or rejects.
 */

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { requestSlabCancelAction } from "@/app/(app)/slabs/cancel-actions";

export function SlabCancelRequestModal({
  slabId,
  temple,
  label,
  onClose,
}: {
  slabId: string;
  temple?: string | null;
  label?: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [submitting, startSubmit] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  function submit() {
    if (submitting) return;
    if (!reason.trim()) {
      setErr("Reason is required — what happened to this slab?");
      return;
    }
    setErr(null);
    const fd = new FormData();
    fd.set("slab_id", slabId);
    fd.set("reason", reason.trim());
    const f = fileRef.current?.files?.[0];
    if (f) fd.set("photo", f);
    startSubmit(async () => {
      try {
        const res = await requestSlabCancelAction(fd);
        if (!res.ok) {
          setErr(res.error);
          return;
        }
        setDone(true);
        router.refresh();
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    });
  }

  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget && !submitting) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 1600, background: "rgba(15,12,6,0.62)",
        backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 14,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Request cancel — ${slabId}`}
        style={{
          width: "100%", maxWidth: 460, background: "var(--surface)", border: "1.5px solid rgba(185,28,28,0.45)",
          borderTop: "6px solid #b91c1c", borderRadius: 16, boxShadow: "0 24px 80px rgba(0,0,0,0.5)",
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}
      >
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", gap: 12, alignItems: "flex-start" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: "#b91c1c" }}>🚫 Request slab cancel</div>
            <div style={{ fontSize: 13, marginTop: 3 }}>
              <code style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800 }}>{slabId}</code>
              {temple ? <span className="muted"> · 🏛 {temple}</span> : null}
              {label ? <span className="muted"> · {label}</span> : null}
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={submitting} aria-label="Close" style={{ marginLeft: "auto", background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "var(--muted)" }}>×</button>
        </div>

        {done ? (
          <div style={{ padding: "22px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ padding: "12px 14px", background: "rgba(22,101,52,0.08)", border: "1px solid rgba(22,101,52,0.3)", borderRadius: 10, color: "#15803d", fontSize: 13.5, fontWeight: 700, lineHeight: 1.5 }}>
              ✓ Request sent to the owner. The slab now shows <strong style={{ color: "#b91c1c" }}>CANCEL REQUESTED</strong> and
              is locked (no assign / dispatch) until the owner approves or rejects.
            </div>
            <button type="button" className="primary-button" onClick={onClose} style={{ fontSize: 14 }}>Done</button>
          </div>
        ) : (
          <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
              Slab टूट गई या किसी कारण cancel करनी है? Reason लिखें (photo भी लगा सकते हैं) — owner approve करेगा तभी cancel होगी।
            </div>
            <label className="stack">
              <span style={{ fontSize: 13, fontWeight: 700 }}>Reason / cause <span style={{ color: "#DC2626" }}>*</span></span>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="e.g. Slab cracked through the middle while shifting…"
                style={{ resize: "vertical", fontFamily: "inherit", fontSize: 14 }}
              />
            </label>

            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 76,
                background: preview ? "var(--surface)" : "rgba(185,28,28,0.04)",
                border: `2px dashed ${preview ? "#15803d" : "rgba(185,28,28,0.45)"}`,
                borderRadius: 12, cursor: "pointer", color: "var(--text)", position: "relative", overflow: "hidden", padding: 8,
              }}
            >
              {preview ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={preview} alt="damage" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.85 }} />
                  <span style={{ position: "relative", fontSize: 12, fontWeight: 800, color: "#fff", background: "rgba(21,128,61,0.9)", borderRadius: 999, padding: "4px 12px" }}>
                    ✓ Photo attached — tap to change
                  </span>
                </>
              ) : (
                <span style={{ fontSize: 13, fontWeight: 700 }}>📷 Add damage photo (optional)</span>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={() => {
                  const f = fileRef.current?.files?.[0];
                  if (preview) URL.revokeObjectURL(preview);
                  setPreview(f ? URL.createObjectURL(f) : null);
                }}
                style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
              />
            </button>

            {err && (
              <div style={{ padding: "10px 13px", background: "rgba(185,28,28,0.08)", border: "1px solid rgba(185,28,28,0.35)", borderRadius: 10, color: "#b91c1c", fontSize: 13, fontWeight: 600 }}>
                ⚠ {err}
              </div>
            )}

            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={submit}
                disabled={submitting}
                style={{
                  flex: 1, padding: "12px 14px", fontSize: 14.5, fontWeight: 800, color: "#fff",
                  background: submitting ? "var(--border)" : "#b91c1c", border: "none", borderRadius: 10,
                  cursor: submitting ? "wait" : "pointer",
                }}
              >
                {submitting ? "Sending…" : "🚫 Send cancel request to owner"}
              </button>
              <button type="button" className="ghost-button" onClick={onClose} disabled={submitting}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Long-press helper — returns pointer handlers that fire `onLongPress`
 *  after `ms` of continuous press (move/leave/up cancels). Spread onto
 *  any card element. */
export function longPressHandlers(onLongPress: () => void, ms = 900) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clear = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
  return {
    onPointerDown: () => {
      clear();
      timer = setTimeout(onLongPress, ms);
    },
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerMove: clear,
    onContextMenu: (e: React.MouseEvent) => {
      // Right-click / long-press context menu = the desktop shortcut.
      e.preventDefault();
      clear();
      onLongPress();
    },
  };
}
