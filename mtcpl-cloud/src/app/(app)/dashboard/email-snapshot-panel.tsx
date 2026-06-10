"use client";

// Dashboard email-snapshot panel (owner/dev only — the run route
// re-checks the role). Owns: collapse toggle, the manual-refresh range
// picker (Today / Yesterday / Last 3 days / Last 7 days), and the
// sender-first item layout. The 5am/2pm crons always fetch just today;
// only this Refresh button may widen the window.

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SnapshotItem, FullMessage } from "@/lib/email-snapshot";

type Snap = {
  generatedAt: string;
  items: SnapshotItem[];
  overview: string | null;
  scannedCount: number;
  range: string;
  error: string | null;
};

const CATEGORY_META: Record<string, { label: string; icon: string }> = {
  bank_payment: { label: "Bank / Payment", icon: "🏦" },
  government_gst: { label: "Govt / GST", icon: "🏛️" },
  client: { label: "Client", icon: "🤝" },
  vendor: { label: "Vendor", icon: "📦" },
  legal: { label: "Legal", icon: "⚖️" },
  other: { label: "Other", icon: "✉️" },
};

const RANGE_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last_3_days", label: "Last 3 days" },
  { value: "last_7_days", label: "Last 7 days" },
] as const;

const RANGE_LABEL: Record<string, string> = {
  today: "Today",
  yesterday: "Yesterday onward",
  last_3_days: "Last 3 days",
  last_7_days: "Last 7 days",
};

function fmtIst(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

// Email date for the card — day + month + year, no time, to stay compact.
function fmtEmailDate(iso: string | undefined): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "numeric",
      month: "short",
      year: "numeric",
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

export function EmailSnapshotPanel({ snap, configured }: { snap: Snap | null; configured: boolean }) {
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [range, setRange] = useState<string>(snap?.range ?? "today");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Center-peek: the full email is fetched LIVE on click (never stored).
  const [openItem, setOpenItem] = useState<SnapshotItem | null>(null);
  const [full, setFull] = useState<FullMessage | null>(null);
  const [fullLoading, setFullLoading] = useState(false);
  const [fullErr, setFullErr] = useState<string | null>(null);

  async function openCard(it: SnapshotItem) {
    if (!it.uid) return;
    setOpenItem(it);
    setFull(null);
    setFullErr(null);
    setFullLoading(true);
    try {
      const res = await fetch(`/api/email-snapshot/message?uid=${it.uid}`);
      const json = (await res.json()) as { ok: boolean; message?: FullMessage; error?: string };
      if (!json.ok || !json.message) {
        setFullErr(json.error ?? "Couldn't load this email.");
      } else {
        setFull(json.message);
      }
    } catch {
      setFullErr("Couldn't load this email — check your connection.");
    } finally {
      setFullLoading(false);
    }
  }

  function closeCard() {
    setOpenItem(null);
    setFull(null);
    setFullErr(null);
  }

  async function refresh() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/email-snapshot/run?range=${encodeURIComponent(range)}`, { method: "POST" });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) {
        setErr(json.error ?? "Refresh failed.");
        return;
      }
      router.refresh();
    } catch {
      setErr("Refresh failed — check your connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: "14px 18px",
        display: "flex",
        flexDirection: "column",
        gap: collapsed ? 0 : 12,
      }}
    >
      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Expand" : "Collapse"}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
            color: "var(--text)",
          }}
        >
          <span style={{ fontSize: 12, color: "var(--muted)", transform: collapsed ? "rotate(-90deg)" : "none", transition: "transform 0.15s" }}>▼</span>
          <span style={{ fontSize: 15, fontWeight: 800 }}>📧 Email Snapshot</span>
          {snap && !snap.error && (
            <span className="muted" style={{ fontSize: 11.5, fontWeight: 500 }}>
              {fmtIst(snap.generatedAt)} · {RANGE_LABEL[snap.range] ?? "Today"} · {snap.scannedCount} scanned
            </span>
          )}
        </button>

        <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <select
            value={range}
            onChange={(e) => setRange(e.target.value)}
            disabled={busy}
            title="How far back to fetch when you refresh"
            style={{
              fontSize: 12,
              fontWeight: 600,
              padding: "6px 8px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "var(--bg)",
              color: "var(--text)",
              cursor: busy ? "wait" : "pointer",
            }}
          >
            {RANGE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={refresh}
            disabled={busy}
            style={{
              padding: "6px 14px",
              fontSize: 12,
              fontWeight: 700,
              color: "var(--text)",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              cursor: busy ? "wait" : "pointer",
              opacity: busy ? 0.7 : 1,
              whiteSpace: "nowrap",
            }}
          >
            {busy ? "⏳ Reading…" : "↻ Refresh"}
          </button>
        </div>
      </div>

      {err && <div style={{ fontSize: 11.5, color: "#b91c1c", fontWeight: 600 }}>⚠ {err}</div>}

      {/* ── Body (hidden when collapsed) ── */}
      {!collapsed && (
        <>
          {!configured || !snap ? (
            <p className="muted" style={{ fontSize: 12.5, margin: 0, lineHeight: 1.5 }}>
              Not set up yet — run migrations <code>119</code> &amp; <code>120</code>, then add{" "}
              <code>GMAIL_USER</code>, <code>GMAIL_APP_PASSWORD</code> and <code>CRON_SECRET</code> in Vercel.
              Snapshots run at 5:00 am and 2:00 pm IST, or tap Refresh.
            </p>
          ) : snap.error ? (
            <p style={{ fontSize: 12.5, margin: 0, color: "#b91c1c", fontWeight: 600 }}>⚠ Last run failed: {snap.error}</p>
          ) : (
            <>
              {snap.overview && <p style={{ fontSize: 13, margin: 0, fontWeight: 600 }}>{snap.overview}</p>}
              {snap.items.length === 0 ? (
                <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>Nothing important — inbox is quiet. ✅</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {snap.items.map((it, i) => {
                    const cat = CATEGORY_META[it.category] ?? CATEGORY_META.other;
                    const action = it.urgency === "action_needed";
                    const clickable = !!it.uid;
                    const dateStr = fmtEmailDate(it.date);
                    return (
                      <div
                        key={i}
                        onClick={clickable ? () => openCard(it) : undefined}
                        role={clickable ? "button" : undefined}
                        tabIndex={clickable ? 0 : undefined}
                        onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openCard(it); } } : undefined}
                        title={clickable ? "Open the full email" : undefined}
                        style={{
                          padding: "10px 12px",
                          borderRadius: 10,
                          border: `1px solid ${action ? "rgba(220,38,38,0.4)" : "var(--border)"}`,
                          background: action ? "rgba(220,38,38,0.05)" : "var(--bg)",
                          display: "flex",
                          flexDirection: "column",
                          gap: 3,
                          cursor: clickable ? "pointer" : "default",
                        }}
                      >
                        {/* Sender first (bold), then the email date, then the urgency badge */}
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 13.5, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {it.from}
                          </span>
                          {dateStr && (
                            <span className="muted" style={{ fontSize: 11, fontWeight: 500, flexShrink: 0 }}>· {dateStr}</span>
                          )}
                          <span style={{ flex: 1 }} />
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 800,
                              padding: "2px 8px",
                              borderRadius: 999,
                              textTransform: "uppercase",
                              letterSpacing: "0.04em",
                              flexShrink: 0,
                              color: action ? "#fff" : "#475569",
                              background: action ? "#dc2626" : "rgba(148,163,184,0.2)",
                            }}
                          >
                            {action ? "Action needed" : "FYI"}
                          </span>
                        </div>
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text)" }}>{it.subject}</div>
                        <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>{it.summary}</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)" }}>
                            {cat.icon} {cat.label}
                          </span>
                          {clickable && (
                            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--accent, #4f46e5)", marginLeft: "auto" }}>
                              Open full email →
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 2 }}>
                Read-only · Google&apos;s own emails are hidden · auto-refreshes 5 am &amp; 2 pm (today only)
              </div>
            </>
          )}
        </>
      )}
    </div>

    {/* ── Center-peek: the full email, fetched live (never stored) ── */}
    {openItem && (
      <div
        onClick={closeCard}
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
              <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 2 }}>{full?.subject ?? openItem.subject}</div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>
                <span style={{ fontWeight: 700, color: "var(--text)" }}>{full?.from ?? openItem.from}</span>
                {(full?.date || openItem.date) && <> · {fmtEmailDate(full?.date ?? openItem.date)}</>}
              </div>
            </div>
            <button
              type="button"
              onClick={closeCard}
              aria-label="Close"
              style={{ background: "none", border: "none", fontSize: 22, lineHeight: 1, cursor: "pointer", color: "var(--muted)", padding: 2 }}
            >
              ×
            </button>
          </div>

          {/* body */}
          <div style={{ padding: "16px 18px", overflowY: "auto" }}>
            {fullLoading ? (
              <div style={{ color: "var(--muted)", fontSize: 13, fontWeight: 600 }}>⏳ Loading the full email…</div>
            ) : fullErr ? (
              <div style={{ color: "#b91c1c", fontSize: 13, fontWeight: 600 }}>⚠ {fullErr}</div>
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
                          href={`/api/email-snapshot/attachment?uid=${openItem.uid}&index=${a.index}`}
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
            Shown live & read-only — this full email is not stored anywhere.
          </div>
        </div>
      </div>
    )}
    </>
  );
}
