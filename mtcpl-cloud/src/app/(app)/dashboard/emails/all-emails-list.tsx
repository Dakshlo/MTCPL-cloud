"use client";

// Gmail-style archive list: every scanned email, grouped by date (newest
// first), with a search box and a sender-first row. Click a row to open
// the full email (live, read-only) via the shared EmailPeek.

import { useMemo, useState } from "react";
import { EmailPeek } from "../email-peek";

export type ArchivedEmail = {
  id: string;
  uid: number | null;
  from: string;
  subject: string;
  summary: string;
  category: string;
  urgency: string;
  emailDate: string | null;
};

const CATEGORY_META: Record<string, { label: string; icon: string }> = {
  bank_payment: { label: "Bank / Payment", icon: "🏦" },
  government_gst: { label: "Govt / GST", icon: "🏛️" },
  client: { label: "Client", icon: "🤝" },
  vendor: { label: "Vendor", icon: "📦" },
  legal: { label: "Legal", icon: "⚖️" },
  other: { label: "Other", icon: "✉️" },
};

function dayKey(iso: string | null): string {
  if (!iso) return "Undated";
  try {
    return new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", year: "numeric" });
  } catch {
    return "Undated";
  }
}

function fmtTime(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export function AllEmailsList({ messages }: { messages: ArchivedEmail[] }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<ArchivedEmail | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return messages;
    return messages.filter((m) =>
      [m.from, m.subject, m.summary, CATEGORY_META[m.category]?.label].some((v) => (v ?? "").toLowerCase().includes(needle)),
    );
  }, [q, messages]);

  // Walk the (already date-sorted) list, dropping a date header when the day changes.
  const groups: Array<{ day: string; items: ArchivedEmail[] }> = [];
  for (const m of filtered) {
    const day = dayKey(m.emailDate);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(m);
    else groups.push({ day, items: [m] });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search sender, subject or summary…"
          style={{
            flex: "1 1 280px",
            padding: "9px 12px",
            fontSize: 14,
            border: "1px solid var(--border)",
            borderRadius: 9,
            background: "var(--bg)",
            color: "var(--text)",
          }}
        />
        <span className="muted" style={{ fontSize: 12 }}>{filtered.length} email{filtered.length === 1 ? "" : "s"}</span>
      </div>

      {messages.length === 0 ? (
        <p className="muted" style={{ fontSize: 13 }}>No emails archived yet — refresh the dashboard email snapshot to start building this list.</p>
      ) : filtered.length === 0 ? (
        <p className="muted" style={{ fontSize: 13 }}>No emails match “{q}”.</p>
      ) : (
        <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", background: "var(--surface)" }}>
          {groups.map((g) => (
            <div key={g.day}>
              <div style={{ padding: "7px 14px", background: "var(--surface-alt, rgba(0,0,0,0.03))", fontSize: 11.5, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em", borderBottom: "1px solid var(--border)" }}>
                {g.day}
              </div>
              {g.items.map((m) => {
                const cat = CATEGORY_META[m.category] ?? CATEGORY_META.other;
                const action = m.urgency === "action_needed";
                const clickable = !!m.uid;
                return (
                  <div
                    key={m.id}
                    onClick={clickable ? () => setOpen(m) : undefined}
                    role={clickable ? "button" : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(m); } } : undefined}
                    title={clickable ? "Open the full email" : "Refresh to re-capture this email so it can be opened"}
                    style={{
                      display: "flex",
                      gap: 10,
                      padding: "10px 14px",
                      borderBottom: "1px solid var(--border)",
                      cursor: clickable ? "pointer" : "default",
                      background: action ? "rgba(220,38,38,0.04)" : "transparent",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 13.5, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.from}</span>
                        <span className="muted" style={{ fontSize: 11, fontWeight: 500, flexShrink: 0 }}>{fmtTime(m.emailDate)}</span>
                        <span style={{ flex: 1 }} />
                        <span
                          style={{
                            fontSize: 9.5,
                            fontWeight: 800,
                            padding: "2px 7px",
                            borderRadius: 999,
                            textTransform: "uppercase",
                            letterSpacing: "0.04em",
                            flexShrink: 0,
                            color: action ? "#fff" : "#475569",
                            background: action ? "#dc2626" : "rgba(148,163,184,0.2)",
                          }}
                        >
                          {action ? "Action" : "FYI"}
                        </span>
                      </div>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.subject}</div>
                      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 1, lineHeight: 1.45, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{m.summary}</div>
                      <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--muted)", marginTop: 2 }}>{cat.icon} {cat.label}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {open && (
        <EmailPeek
          target={{ uid: open.uid, subject: open.subject, from: open.from, date: open.emailDate ?? undefined }}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}
