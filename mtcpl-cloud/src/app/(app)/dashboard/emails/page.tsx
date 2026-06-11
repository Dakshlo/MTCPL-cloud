import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { AllEmailsList, type ArchivedEmail } from "./all-emails-list";

export const dynamic = "force-dynamic";

// "Open all emails" — a Gmail-style archive of every important email the AI
// has surfaced, newest-to-oldest, deduplicated (mig 121). Owner/dev only;
// the table has no client-read policy (service-role admin client only).
export default async function AllEmailsPage() {
  const { profile } = await requireAuth();
  if (profile.role !== "owner" && profile.role !== "developer") {
    redirect("/dashboard");
  }

  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("email_messages")
    .select("id, uid, from_name, subject, summary, category, urgency, email_date")
    .order("email_date", { ascending: false, nullsFirst: false })
    .limit(500);

  const configured = !error;
  const messages: ArchivedEmail[] = (data ?? []).map((r) => ({
    id: r.id as string,
    uid: (r.uid ?? null) as number | null,
    from: (r.from_name ?? "(unknown sender)") as string,
    subject: (r.subject ?? "(no subject)") as string,
    summary: (r.summary ?? "") as string,
    category: (r.category ?? "other") as string,
    urgency: (r.urgency ?? "fyi") as string,
    emailDate: (r.email_date ?? null) as string | null,
  }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingBottom: 32 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <Link href="/dashboard" style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", textDecoration: "none" }}>← Dashboard</Link>
          <h1 style={{ margin: "4px 0 0", fontSize: 22 }}>📧 All scanned emails</h1>
          <p className="muted" style={{ margin: "2px 0 0", fontSize: 12.5 }}>
            Every important email the AI has found, newest first. Click one to read it in full (live &amp; read-only).
            Use <strong>Refresh → Last 1 month</strong> on the dashboard to pull older emails in.
          </p>
        </div>
      </div>

      {!configured ? (
        <p className="muted" style={{ fontSize: 12.5 }}>
          Not set up yet — run migration <code>121</code> in Supabase, then refresh the dashboard email snapshot once.
        </p>
      ) : (
        <AllEmailsList messages={messages} />
      )}
    </div>
  );
}
