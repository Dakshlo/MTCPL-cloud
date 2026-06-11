"use client";

// Shared center-peek modal for opening ONE email in full. The body +
// attachments are fetched LIVE over read-only IMAP (/api/email-snapshot/
// message) and never stored — only the AI summary is. Used by the
// dashboard snapshot card and the "Open all emails" archive page.

import { useEffect, useState } from "react";
import type { FullMessage } from "@/lib/email-snapshot";

export type EmailPeekTarget = { uid?: number | null; subject?: string; from?: string; date?: string };

function fmtEmailDate(iso: string | undefined): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function fmtBytes(n: number): string {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function EmailPeek({ target, onClose }: { target: EmailPeekTarget; onClose: () => void }) {
  const [full, setFull] = useState<FullMessage | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!target.uid) {
        setErr("This email can't be opened — it predates email archiving. Refresh to capture it again.");
        setLoading(false);
        return;
      }
      setLoading(true);
      setErr(null);
      setFull(null);
      try {
        const res = await fetch(`/api/email-snapshot/message?uid=${target.uid}`);
        const json = (await res.json()) as { ok: boolean; message?: FullMessage; error?: string };
        if (cancelled) return;
        if (!json.ok || !json.message) setErr(json.error ?? "Couldn't load this email.");
        else setFull(json.message);
      } catch {
        if (!cancelled) setErr("Couldn't load this email — check your connection.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [target.uid]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface)",
          borderRadius: 14,
          width: "min(760px, 96vw)",
          maxHeight: "88vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
          overflow: "hidden",
        }}
      >
        {/* header */}
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 2 }}>{full?.subject ?? target.subject}</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              <span style={{ fontWeight: 700, color: "var(--text)" }}>{full?.from ?? target.from}</span>
              {(full?.date || target.date) && <> · {fmtEmailDate(full?.date ?? target.date)}</>}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ background: "none", border: "none", fontSize: 22, lineHeight: 1, cursor: "pointer", color: "var(--muted)", padding: 2 }}
          >
            ×
          </button>
        </div>

        {/* body */}
        <div style={{ padding: "16px 18px", overflowY: "auto" }}>
          {loading ? (
            <div style={{ color: "var(--muted)", fontSize: 13, fontWeight: 600 }}>⏳ Loading the full email…</div>
          ) : err ? (
            <div style={{ color: "#b91c1c", fontSize: 13, fontWeight: 600 }}>⚠ {err}</div>
          ) : full ? (
            <>
              {full.attachments.length > 0 && (
                <div style={{ marginBottom: 14, display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    📎 {full.attachments.length} attachment{full.attachments.length > 1 ? "s" : ""}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {full.attachments.map((a) => (
                      <a
                        key={a.index}
                        href={`/api/email-snapshot/attachment?uid=${target.uid}&index=${a.index}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "6px 12px",
                          borderRadius: 8,
                          border: "1px solid var(--border)",
                          background: "var(--bg)",
                          fontSize: 12,
                          fontWeight: 700,
                          color: "var(--text)",
                          textDecoration: "none",
                        }}
                      >
                        📄 {a.filename}
                        {a.size ? <span style={{ color: "var(--muted)", fontWeight: 500 }}>({fmtBytes(a.size)})</span> : null}
                      </a>
                    ))}
                  </div>
                </div>
              )}
              <pre
                style={{
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontFamily: "inherit",
                  fontSize: 13,
                  lineHeight: 1.6,
                  margin: 0,
                  color: "var(--text)",
                }}
              >
                {full.bodyText || "(This email has no plain-text body.)"}
              </pre>
            </>
          ) : null}
        </div>

        {/* footer note */}
        <div style={{ padding: "8px 18px", borderTop: "1px solid var(--border)", fontSize: 10.5, color: "var(--muted)" }}>
          Shown live &amp; read-only — this full email is not stored anywhere.
        </div>
      </div>
    </div>
  );
}
