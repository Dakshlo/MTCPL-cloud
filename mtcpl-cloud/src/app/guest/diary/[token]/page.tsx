/**
 * Work Diary GUEST view (mig 201) — the page behind the WhatsApp mention ping.
 * Opens WITHOUT login: the 48-h token identifies one (entry, person) pair. The
 * mentioned person reads the activity's chat and replies right here; replies
 * post into the Work Diary thread under their own name.
 *
 * Mobile-first on purpose — this link is opened from WhatsApp on a phone.
 */

import { notFound } from "next/navigation";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { GuestComposer } from "./guest-composer";

export const dynamic = "force-dynamic";

type Params = Promise<{ token: string }>;

const fmtStamp = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const fmtDate = (d: string | null) =>
  d ? new Date(`${d.slice(0, 10)}T00:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" }) : null;
const hueOf = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return h; };
const escRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Server-side mention highlighting — "@Name" of anyone on the entry → pill. */
function mentionNodes(body: string, names: string[]): React.ReactNode {
  const list = names.filter(Boolean).sort((a, b) => b.length - a.length);
  if (list.length === 0 || !body.includes("@")) return body;
  const re = new RegExp(`@(${list.map(escRe).join("|")})`, "gi");
  const parts: React.ReactNode[] = [];
  let last = 0; let m: RegExpExecArray | null; let k = 0;
  while ((m = re.exec(body)) !== null) {
    if (m.index > last) parts.push(body.slice(last, m.index));
    parts.push(<span key={k++} style={{ color: "#0b5cad", fontWeight: 800, background: "rgba(37,99,235,0.1)", borderRadius: 5, padding: "0 3px" }}>@{m[1]}</span>);
    last = m.index + m[0].length;
  }
  if (last < body.length) parts.push(body.slice(last));
  return parts;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main style={{ minHeight: "100dvh", background: "#efe9da", display: "flex", justifyContent: "center", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif" }}>
      <div style={{ width: "min(560px, 100%)", minHeight: "100dvh", background: "#faf6ec", display: "flex", flexDirection: "column", boxShadow: "0 0 40px rgba(0,0,0,0.08)" }}>
        {children}
      </div>
    </main>
  );
}

function DeadLink({ title, note }: { title: string; note: string }) {
  return (
    <Shell>
      <div style={{ flex: 1, display: "grid", placeItems: "center", padding: 24 }}>
        <div style={{ textAlign: "center", maxWidth: 340 }}>
          <div style={{ fontSize: 44, marginBottom: 10 }}>⏳</div>
          <div style={{ fontSize: 18, fontWeight: 900, color: "#3f3627", marginBottom: 6 }}>{title}</div>
          <div style={{ fontSize: 13.5, color: "#7a7264", lineHeight: 1.6 }}>{note}</div>
        </div>
      </div>
    </Shell>
  );
}

export default async function GuestDiaryPage({ params }: { params: Params }) {
  const { token } = await params;
  if (!token || token.length < 20) notFound();
  const admin = createAdminSupabaseClient();

  // ── The token IS the credential.
  const { data: lRow } = await admin
    .from("work_diary_guest_links")
    .select("id, entry_id, profile_id, expires_at")
    .eq("token", token)
    .maybeSingle();
  const link = lRow as { id: string; entry_id: string; profile_id: string; expires_at: string } | null;
  if (!link) return <DeadLink title="This link is not valid" note="Ask for a fresh link, or open the Work Diary inside the MTCPL app." />;
  if (new Date(link.expires_at).getTime() < Date.now()) {
    return <DeadLink title="This link has expired" note="Mention links work for 48 hours. Open the Work Diary inside the MTCPL app to continue the chat." />;
  }

  const { data: eRow } = await admin
    .from("work_diary_entries")
    .select("id, activity, details, created_by, due_date, closed_at, closed_by, created_at, urgent")
    .eq("id", link.entry_id)
    .maybeSingle();
  const e = eRow as { id: string; activity: string; details: string | null; created_by: string; due_date: string | null; closed_at: string | null; closed_by: string | null; created_at: string; urgent?: boolean | null } | null;
  if (!e) return <DeadLink title="Activity not found" note="This Work Diary entry was deleted." />;

  // ── Names.
  const { data: profRows } = await admin.from("profiles").select("id, full_name, phone");
  const profs = (profRows ?? []) as Array<{ id: string; full_name: string | null; phone: string | null }>;
  const nameOf = (id: string | null | undefined) => {
    if (!id) return "—";
    const p = profs.find((x) => x.id === id);
    return p?.full_name || p?.phone || "—";
  };

  const { data: pRows } = await admin.from("work_diary_participants").select("profile_id").eq("entry_id", e.id);
  const participants = ((pRows ?? []) as Array<{ profile_id: string }>).map((r) => ({ id: r.profile_id, name: nameOf(r.profile_id) }));
  const partNames = participants.map((p) => p.name);

  const { data: rRows } = await admin.from("work_diary_remarks").select("*").eq("entry_id", e.id).order("created_at", { ascending: true }).limit(300);
  const remarks = ((rRows ?? []) as Array<{ id: string; author: string; body: string; kind: string; created_at: string }>);

  // Attachments (names + public links; the bucket is public).
  const filesByRemark = new Map<string, Array<{ id: string; name: string; url: string }>>();
  {
    const { data: fs, error } = await admin.from("work_diary_files").select("id, remark_id, name, path").eq("entry_id", e.id);
    if (!error) {
      for (const f of (fs ?? []) as Array<{ id: string; remark_id: string | null; name: string; path: string }>) {
        if (!f.remark_id) continue;
        const url = admin.storage.from("work-diary").getPublicUrl(f.path).data.publicUrl;
        const a = filesByRemark.get(f.remark_id) ?? [];
        a.push({ id: f.id, name: f.name, url });
        filesByRemark.set(f.remark_id, a);
      }
    }
  }

  const meId = link.profile_id;
  const meName = nameOf(meId);

  return (
    <Shell>
      {/* Header */}
      <div style={{ padding: "14px 16px 12px", background: "#b45309", color: "#fff" }}>
        <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", opacity: 0.85 }}>📒 MTCPL Work Diary</div>
        <div style={{ fontSize: 17, fontWeight: 900, lineHeight: 1.3, textTransform: "uppercase", marginTop: 3 }}>{e.urgent ? "🔥 " : ""}{e.activity}</div>
        {e.details && <div style={{ fontSize: 12.5, opacity: 0.9, marginTop: 4, whiteSpace: "pre-wrap" }}>{e.details}</div>}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8, fontSize: 11.5, opacity: 0.92 }}>
          <span>✍️ From <strong>{nameOf(e.created_by)}</strong></span>
          {fmtDate(e.due_date) && <span>📅 Due <strong>{fmtDate(e.due_date)}</strong></span>}
          {e.closed_at ? <span>✅ Closed by <strong>{nameOf(e.closed_by)}</strong></span> : <span>🟢 Open</span>}
        </div>
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 8 }}>
          {participants.map((p) => (
            <span key={p.id} style={{ fontSize: 10.5, fontWeight: 700, background: "rgba(255,255,255,0.16)", border: "1px solid rgba(255,255,255,0.3)", borderRadius: 999, padding: "2px 9px" }}>
              {p.id === meId ? `👋 ${p.name} (you)` : p.name}
            </span>
          ))}
        </div>
      </div>

      {/* Signed-in-as strip */}
      <div style={{ padding: "7px 16px", fontSize: 11.5, fontWeight: 700, color: "#7a6a3f", background: "#f6efdc", borderBottom: "1px solid #e3dbc8" }}>
        You were mentioned in this activity — replying as <strong style={{ color: "#3f3627" }}>{meName}</strong>. Link valid 48 h.
      </div>

      {/* Thread */}
      <div style={{ flex: 1, overflowY: "auto", padding: "14px 12px", display: "flex", flexDirection: "column", gap: 9 }}>
        {remarks.length === 0 && <div style={{ color: "#a39a84", fontSize: 13, textAlign: "center", padding: "24px 0" }}>No messages yet — write the first one below.</div>}
        {remarks.map((r) =>
          r.kind === "remark" ? (
            <div key={r.id} style={{ alignSelf: r.author === meId ? "flex-end" : "flex-start", maxWidth: "86%", background: r.author === meId ? "#e7f6d9" : "#fff", border: "1px solid #e0d8c4", borderRadius: 13, padding: "8px 12px", boxShadow: "0 1px 1px rgba(0,0,0,0.04)" }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: `hsl(${hueOf(r.author)} 55% 38%)` }}>{r.author === meId ? "You" : nameOf(r.author)}</div>
              {r.body && <div style={{ fontSize: 14, color: "#26221a", whiteSpace: "pre-wrap", lineHeight: 1.45 }}>{mentionNodes(r.body, partNames)}</div>}
              {(filesByRemark.get(r.id) ?? []).map((f) => (
                <a key={f.id} href={f.url} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 700, color: "#0b5cad", background: "#eef5fd", border: "1px solid #c7ddf6", borderRadius: 999, padding: "3px 10px", marginTop: 5, textDecoration: "none" }}>
                  📎 {f.name}
                </a>
              ))}
              <div style={{ fontSize: 9.5, color: "#a39a84", marginTop: 3, textAlign: "right" }}>{fmtStamp(r.created_at)}</div>
            </div>
          ) : (
            <div key={r.id} style={{ alignSelf: "center", textAlign: "center", fontSize: 11, fontWeight: 700, color: "#a39a84" }}>
              {r.kind === "closed" ? "✅" : "↩"} {nameOf(r.author)} {r.kind === "closed" ? "closed this" : "reopened this"} · {fmtStamp(r.created_at)}
              {r.kind === "closed" && r.body && <div style={{ fontSize: 12, fontWeight: 700, color: "#3f7d2c", marginTop: 2 }}>&ldquo;{r.body}&rdquo;</div>}
            </div>
          ),
        )}
      </div>

      <GuestComposer token={token} disabled={!!e.closed_at} />
    </Shell>
  );
}
