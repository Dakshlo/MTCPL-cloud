"use client";

/**
 * Daksh May 2026 — live camera capture modal.
 *
 * Daksh: "I want capture image and upload like live capturing" —
 * meaning no Gallery / Photo Library / Choose File chooser. Just
 * camera, snap, upload. The HTML <input type="file" capture="environment">
 * works on Android but iOS Safari shows a chooser anyway. So we
 * implement camera access ourselves via getUserMedia + canvas
 * snapshot, which behaves the same on every browser.
 *
 * Flow:
 *   1. Mount → request camera permission (back camera by default;
 *      facingMode 'environment'). User taps Allow.
 *   2. Live preview in a <video>.
 *   3. Tap "📸 Capture" → freeze the current frame into a <canvas>,
 *      stop the stream, show preview + "Use photo" / "Retake".
 *   4. Tap "Use photo" → File handed to parent via onCapture(file).
 *      Tap "Retake" → restart preview.
 *   5. Tap "Cancel" or close → onClose(), stream torn down.
 *
 * Encoded as JPEG quality 0.85 so the upload stays comfortably
 * under the 5 MB cap on the carving_review_media bucket.
 *
 * Falls back to a clear error pill when the browser blocks camera
 * access (permission denied, no HTTPS, no camera hardware). User
 * can still tap Cancel and use a different flow if they end up
 * here.
 */

import { useEffect, useRef, useState } from "react";

type Props = {
  /** File name prefix for the captured image. Final name is
   *  `${filenamePrefix}-${ts}.jpg`. Defaults to "capture". */
  filenamePrefix?: string;
  /** Called with the captured File on "Use photo". */
  onCapture: (file: File) => void;
  /** Called on Cancel / Esc / backdrop click. */
  onClose: () => void;
};

export function CameraCaptureModal({
  filenamePrefix = "capture",
  onCapture,
  onClose,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<"starting" | "live" | "captured" | "error">(
    "starting",
  );
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [capturedFile, setCapturedFile] = useState<File | null>(null);
  // Front-vs-back toggle. Floor uses back almost always — but the
  // toggle is cheap and avoids "stuck on the wrong camera" panic
  // on a tablet that defaulted to the front-facing one.
  const [facing, setFacing] = useState<"environment" | "user">("environment");

  // Start (or restart) the camera stream. Called once on mount,
  // again on Retake, again when the user flips the camera.
  async function startCamera() {
    // Tear down any prior stream first.
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setStatus("starting");
    setErrMsg(null);
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices ||
      !navigator.mediaDevices.getUserMedia
    ) {
      setStatus("error");
      setErrMsg("Camera not supported in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing },
        audio: false,
      });
      streamRef.current = stream;
      const v = videoRef.current;
      if (v) {
        v.srcObject = stream;
        // iOS Safari needs both autoplay + playsInline + a .play() call.
        v.playsInline = true;
        // Muted is required for autoplay on most browsers.
        v.muted = true;
        await v.play().catch(() => {});
      }
      setStatus("live");
    } catch (e) {
      setStatus("error");
      const msg = e instanceof Error ? e.message : String(e);
      // Normalise common permission errors into a friendly hint.
      if (/Permission/i.test(msg) || /NotAllowed/i.test(msg)) {
        setErrMsg("Camera permission denied. Allow access in your browser settings, then try again.");
      } else if (/NotFound/i.test(msg)) {
        setErrMsg("No camera found on this device.");
      } else if (/NotReadable/i.test(msg)) {
        setErrMsg("Camera is busy — close other apps using the camera and retry.");
      } else {
        setErrMsg(msg);
      }
    }
  }

  useEffect(() => {
    startCamera();
    return () => {
      // Always tear down the stream when the modal closes.
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facing]);

  // Esc to cancel.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function doCapture() {
    const v = videoRef.current;
    const c = canvasRef.current;
    if (!v || !c) return;
    const w = v.videoWidth;
    const h = v.videoHeight;
    if (!w || !h) return;
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, w, h);
    // Freeze the stream — gives the user a "captured!" beat.
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    c.toBlob(
      (blob) => {
        if (!blob) {
          setErrMsg("Capture failed — please retake.");
          return;
        }
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        const file = new File([blob], `${filenamePrefix}-${ts}.jpg`, {
          type: "image/jpeg",
        });
        setCapturedFile(file);
        const url = URL.createObjectURL(blob);
        setPreviewUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
        setStatus("captured");
      },
      "image/jpeg",
      0.85,
    );
  }

  function doRetake() {
    setCapturedFile(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    startCamera();
  }

  function doUse() {
    if (capturedFile) onCapture(capturedFile);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Take photo"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        background: "rgba(0, 0, 0, 0.92)",
        display: "flex",
        flexDirection: "column",
      }}
      onClick={(e) => {
        // Click on the backdrop (not the inner card) cancels.
        if (e.target === e.currentTarget) onClose();
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
          onClick={onClose}
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
          📸 LIVE CAPTURE
        </div>
        <button
          type="button"
          onClick={() => setFacing((f) => (f === "environment" ? "user" : "environment"))}
          disabled={status !== "live"}
          title="Flip camera (front / back)"
          style={{
            background: "rgba(255,255,255,0.12)",
            color: "#fff",
            border: "1px solid rgba(255,255,255,0.2)",
            padding: "6px 12px",
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 700,
            cursor: status === "live" ? "pointer" : "not-allowed",
            opacity: status === "live" ? 1 : 0.5,
          }}
        >
          🔄
        </button>
      </div>

      {/* Viewport */}
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
        {status === "error" ? (
          <div
            style={{
              maxWidth: 360,
              padding: 18,
              background: "rgba(220,38,38,0.18)",
              border: "1.5px solid rgba(220,38,38,0.6)",
              borderRadius: 12,
              color: "#fff",
              textAlign: "center",
              fontSize: 14,
              lineHeight: 1.5,
            }}
          >
            <div style={{ fontSize: 24, marginBottom: 6 }}>⚠</div>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>
              Can&apos;t start camera
            </div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.85)" }}>
              {errMsg ?? "Unknown error."}
            </div>
            <button
              type="button"
              onClick={startCamera}
              style={{
                marginTop: 14,
                padding: "8px 16px",
                background: "#fff",
                color: "#b91c1c",
                border: "none",
                borderRadius: 6,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Retry
            </button>
          </div>
        ) : status === "captured" && previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl}
            alt="Captured"
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              borderRadius: 8,
              boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
            }}
          />
        ) : (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              borderRadius: 8,
              background: "#000",
              transform: facing === "user" ? "scaleX(-1)" : undefined,
            }}
          />
        )}
        {/* Off-screen canvas used for the snapshot. */}
        <canvas ref={canvasRef} style={{ display: "none" }} />
      </div>

      {/* Bottom action bar */}
      <div
        style={{
          padding: "16px 14px 24px",
          display: "flex",
          justifyContent: "center",
          gap: 16,
          alignItems: "center",
        }}
      >
        {status === "live" && (
          <button
            type="button"
            onClick={doCapture}
            aria-label="Capture photo"
            style={{
              width: 78,
              height: 78,
              borderRadius: "50%",
              background: "#fff",
              border: "5px solid rgba(255,255,255,0.4)",
              cursor: "pointer",
              boxShadow: "0 4px 14px rgba(0,0,0,0.4)",
              touchAction: "manipulation",
            }}
          />
        )}
        {status === "captured" && (
          <>
            <button
              type="button"
              onClick={doRetake}
              style={{
                padding: "12px 22px",
                background: "rgba(255,255,255,0.12)",
                color: "#fff",
                border: "1px solid rgba(255,255,255,0.3)",
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 700,
                cursor: "pointer",
                minHeight: 48,
                touchAction: "manipulation",
              }}
            >
              ↺ Retake
            </button>
            <button
              type="button"
              onClick={doUse}
              style={{
                padding: "12px 22px",
                background: "#16a34a",
                color: "#fff",
                border: "1px solid #15803d",
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 800,
                cursor: "pointer",
                minHeight: 48,
                touchAction: "manipulation",
              }}
            >
              ✓ Use photo
            </button>
          </>
        )}
        {status === "starting" && (
          <div style={{ color: "rgba(255,255,255,0.75)", fontSize: 13 }}>
            Starting camera…
          </div>
        )}
      </div>
    </div>
  );
}
