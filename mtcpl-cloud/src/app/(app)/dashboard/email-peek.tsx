"use client";

// Shared center-peek modal for opening ONE email in full. The body +
// attachments are fetched LIVE over read-only IMAP (/api/email-snapshot/
// message) and never stored — only the AI summary is. Used by the
// dashboard snapshot card and the "Open all emails" archive page.
//
// Aug 2026 makeover (Daksh): read like an email client, not a text dump.
// A proper header (avatar, name, email, date), the new message shown
// cleanly, and the quoted reply history folded behind a Gmail-style "•••"
// toggle instead of pasted inline.

import { useEffect, useMemo, useState } from "react";
import type { FullMessage } from "@/lib/email-snapshot";

export type EmailPeekTarget = { uid?: number | null; subject?: string; from?: string; date?: string };

function fmtEmailDate(iso: string | undefined): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
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

/** Split a name + email out of a raw From header like
 *  `"ANKUR JAIN" <jainankur@lntecc.com>` or a bare address. */
function parseFrom(raw: string | undefined): { name: string; email: string } {
  if (!raw) return { name: "", email: "" };
  const m = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim(), email: m[2].trim() };
  if (raw.includes("@")) return { name: raw.split("@")[0], email: raw.trim() };
  return { name: raw.trim(), email: "" };
}

/** Avatar colour, stable per sender. */
const AVATAR_COLORS = ["#4f46e5", "#0891b2", "#0d9488", "#b45309", "#be185d", "#7c3aed", "#c2410c", "#15803d"];
function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function initials(name: string, email: string): string {
  const src = (name || email || "?").trim();
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

/**
 * Separate the newest message from the quoted reply history so we can fold
 * the history away. The boundary is the first of the usual quote markers:
 * an Outlook "From:…Sent:…" block, an "On … wrote:" line, an
 * "-----Original Message-----" rule, or the point where every remaining line
 * is ">"-quoted. Nothing matches → it's all fresh, no fold.
 */
function splitQuoted(text: string): { main: string; quoted: string } {
  if (!text) return { main: "", quoted: "" };
  const patterns: RegExp[] = [
    /\n-{2,}\s*Original Message\s*-{2,}/i,
    /\n_{5,}\s*\n\s*From:\s/i,
    /\nOn .{0,160}?\bwrote:\s*\n/i,
    /\n\s*From:\s.+\n\s*(Sent|Date):\s/i,
  ];
  let cut = -1;
  for (const re of patterns) {
    const m = re.exec(text);
    if (m && (cut === -1 || m.index < cut)) cut = m.index;
  }
  // A block of consecutive ">" lines also marks the start of a quote.
  const gt = text.search(/\n>\s?.*(?:\n>\s?.*){1,}/);
  if (gt !== -1 && (cut === -1 || gt < cut)) cut = gt;

  if (cut === -1) return { main: text.trimEnd(), quoted: "" };
  return { main: text.slice(0, cut).trimEnd(), quoted: text.slice(cut).trim() };
}

export function EmailPeek({ target, onClose }: { target: EmailPeekTarget; onClose: () => void }) {
  const [full, setFull] = useState<FullMessage | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [showQuoted, setShowQuoted] = useState(false);

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
      setShowQuoted(false);
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

  // Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const fromRaw = full?.from ?? target.from;
  const { name, email } = useMemo(() => parseFrom(fromRaw), [fromRaw]);
  const { main, quoted } = useMemo(() => splitQuoted(full?.bodyText ?? ""), [full?.bodyText]);
  const dateStr = fmtEmailDate(full?.date ?? target.date);

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
          borderRadius: 16,
          width: "min(720px, 96vw)",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 24px 70px rgba(0,0,0,0.4)",
          overflow: "hidden",
        }}
      >
        {/* ── Subject bar ── */}
        <div style={{ padding: "16px 20px 12px", display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0, fontSize: 18, fontWeight: 800, lineHeight: 1.3, color: "var(--text)" }}>
            {full?.subject ?? target.subject ?? "(no subject)"}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              flexShrink: 0, width: 30, height: 30, borderRadius: "50%",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              background: "var(--surface-alt)", border: "1px solid var(--border)",
              fontSize: 17, lineHeight: 1, cursor: "pointer", color: "var(--muted)",
            }}
          >
            ×
          </button>
        </div>

        {/* ── Sender row (avatar · name · email · date) ── */}
        <div style={{ padding: "0 20px 14px", display: "flex", alignItems: "center", gap: 11, borderBottom: "1px solid var(--border)" }}>
          <div style={{
            flexShrink: 0, width: 38, height: 38, borderRadius: "50%",
            background: avatarColor(name || email || "?"), color: "#fff",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            fontSize: 14, fontWeight: 800, letterSpacing: "0.02em",
          }}>
            {initials(name, email)}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 800, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {name || email || "Unknown sender"}
            </div>
            {email && name && (
              <div style={{ fontSize: 11.5, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {email}
              </div>
            )}
          </div>
          {dateStr && (
            <div style={{ flexShrink: 0, fontSize: 11.5, color: "var(--muted)", fontWeight: 500, textAlign: "right" }}>
              {dateStr}
            </div>
          )}
        </div>

        {/* ── Body ── */}
        <div style={{ padding: "18px 20px", overflowY: "auto" }}>
          {loading ? (
            <div style={{ color: "var(--muted)", fontSize: 13, fontWeight: 600 }}>⏳ Loading the full email…</div>
          ) : err ? (
            <div style={{ color: "#b91c1c", fontSize: 13, fontWeight: 600 }}>⚠ {err}</div>
          ) : full ? (
            <div style={{ maxWidth: 640 }}>
              {full.attachments.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 10.5, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 7 }}>
                    {full.attachments.length} attachment{full.attachments.length > 1 ? "s" : ""}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {full.attachments.map((a) => (
                      <a
                        key={a.index}
                        href={`/api/email-snapshot/attachment?uid=${target.uid}&index=${a.index}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 9,
                          padding: "8px 12px", borderRadius: 10,
                          border: "1px solid var(--border)", background: "var(--surface-alt)",
                          textDecoration: "none", maxWidth: 240,
                        }}
                      >
                        <span style={{ fontSize: 18, flexShrink: 0 }}>📄</span>
                        <span style={{ minWidth: 0 }}>
                          <span style={{ display: "block", fontSize: 12, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.filename}</span>
                          {a.size ? <span style={{ fontSize: 10.5, color: "var(--muted)" }}>{fmtBytes(a.size)}</span> : null}
                        </span>
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* The newest message, shown clean. */}
              <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 14, lineHeight: 1.65, color: "var(--text)" }}>
                {main || full.bodyText || "(This email has no plain-text body.)"}
              </div>

              {/* Quoted history — folded like Gmail's "•••". */}
              {quoted && (
                <div style={{ marginTop: 14 }}>
                  <button
                    type="button"
                    onClick={() => setShowQuoted((s) => !s)}
                    title={showQuoted ? "Hide the replied-to messages" : "Show the replied-to messages"}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 6,
                      padding: "2px 12px", borderRadius: 999,
                      border: "1px solid var(--border)", background: "var(--surface-alt)",
                      cursor: "pointer", color: "var(--muted)", fontSize: 13, fontWeight: 800, letterSpacing: "0.06em",
                    }}
                  >
                    •••
                    <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0 }}>
                      {showQuoted ? "Hide quoted" : "Show quoted history"}
                    </span>
                  </button>
                  {showQuoted && (
                    <div style={{
                      marginTop: 10, paddingLeft: 12,
                      borderLeft: "2px solid var(--border)",
                      whiteSpace: "pre-wrap", wordBreak: "break-word",
                      fontSize: 12.5, lineHeight: 1.55, color: "var(--muted)",
                    }}>
                      {quoted}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* ── Footer ── */}
        <div style={{ padding: "9px 20px", borderTop: "1px solid var(--border)", fontSize: 10.5, color: "var(--muted)", display: "flex", alignItems: "center", gap: 6 }}>
          <span>🔒</span> Shown live &amp; read-only — this full email is not stored anywhere.
        </div>
      </div>
    </div>
  );
}
