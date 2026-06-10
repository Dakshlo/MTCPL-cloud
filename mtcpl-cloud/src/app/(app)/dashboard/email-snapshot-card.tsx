// Owner email snapshot card (Daksh, June 2026). Server component —
// reads the latest mig-119 snapshot via the admin client (the table has
// no client-read policy on purpose; summaries are personal). Rendered
// on the dashboard for owner/developer only (gated by the caller).
//
// The underlying mailbox connection is READ-ONLY (IMAP, no SMTP — see
// src/lib/email-snapshot.ts); refreshes run at 5:00 + 14:00 IST via
// Vercel cron, or on demand with the Refresh button.

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import type { SnapshotItem } from "@/lib/email-snapshot";
import { EmailRefreshButton } from "./email-refresh-button";

const CATEGORY_META: Record<string, { label: string; icon: string }> = {
  bank_payment: { label: "Bank / Payment", icon: "🏦" },
  government_gst: { label: "Govt / GST", icon: "🏛️" },
  client: { label: "Client", icon: "🤝" },
  vendor: { label: "Vendor", icon: "📦" },
  legal: { label: "Legal", icon: "⚖️" },
  other: { label: "Other", icon: "✉️" },
};

function fmtIst(iso: string | null): string {
  if (!iso) return "—";
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

export async function EmailSnapshotCard() {
  const admin = createAdminSupabaseClient();
  // Guarded: if mig 119 hasn't run yet, render the setup hint, not a 500.
  const { data, error } = await admin
    .from("email_snapshots")
    .select("generated_at, items, overview, scanned_count, trigger, error")
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const snap = (data ?? null) as
    | { generated_at: string; items: SnapshotItem[]; overview: string | null; scanned_count: number; trigger: string; error: string | null }
    | null;

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: "16px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 15, fontWeight: 800 }}>📧 Email Snapshot</span>
          {snap && (
            <span className="muted" style={{ fontSize: 11.5 }}>
              {fmtIst(snap.generated_at)} IST · {snap.scanned_count} scanned · read-only
            </span>
          )}
        </div>
        <EmailRefreshButton />
      </div>

      {error || !snap ? (
        <p className="muted" style={{ fontSize: 12.5, margin: 0, lineHeight: 1.5 }}>
          Not set up yet — run migration 119, then add <code>GMAIL_USER</code>, <code>GMAIL_APP_PASSWORD</code> and{" "}
          <code>CRON_SECRET</code> in Vercel. Snapshots run at 5:00 am and 2:00 pm IST, or tap Refresh now.
        </p>
      ) : snap.error ? (
        <p style={{ fontSize: 12.5, margin: 0, color: "#b91c1c", fontWeight: 600 }}>
          ⚠ Last run failed: {snap.error}
        </p>
      ) : (
        <>
          {snap.overview && (
            <p style={{ fontSize: 13, margin: 0, fontWeight: 600 }}>{snap.overview}</p>
          )}
          {snap.items.length === 0 ? (
            <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>Nothing important — inbox is quiet. ✅</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {snap.items.map((it, i) => {
                const cat = CATEGORY_META[it.category] ?? CATEGORY_META.other;
                const action = it.urgency === "action_needed";
                return (
                  <div
                    key={i}
                    style={{
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: `1px solid ${action ? "rgba(220,38,38,0.4)" : "var(--border)"}`,
                      background: action ? "rgba(220,38,38,0.05)" : "var(--bg)",
                      display: "flex",
                      flexDirection: "column",
                      gap: 3,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 800,
                          padding: "2px 8px",
                          borderRadius: 999,
                          textTransform: "uppercase",
                          letterSpacing: "0.04em",
                          color: action ? "#fff" : "#475569",
                          background: action ? "#dc2626" : "rgba(148,163,184,0.2)",
                        }}
                      >
                        {action ? "Action needed" : "FYI"}
                      </span>
                      <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>
                        {cat.icon} {cat.label}
                      </span>
                      <span className="muted" style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 260 }}>
                        {it.from}
                      </span>
                    </div>
                    <div style={{ fontSize: 12.5, fontWeight: 700 }}>{it.subject}</div>
                    <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>{it.summary}</div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
