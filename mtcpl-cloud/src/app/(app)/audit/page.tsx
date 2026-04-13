/*
 * Run the following SQL in Supabase to create the audit_logs table:
 *
 * CREATE TABLE IF NOT EXISTS audit_logs (
 *   id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
 *   user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
 *   action TEXT NOT NULL,
 *   entity_type TEXT NOT NULL,
 *   entity_id TEXT NOT NULL,
 *   details JSONB,
 *   created_at TIMESTAMPTZ DEFAULT now()
 * );
 */

import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

type AuditLog = {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  details: Record<string, unknown> | null;
  created_at: string;
  profiles: { full_name: string | null } | null;
};

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function AuditPage() {
  await requireAuth(["owner"]);

  const admin = createAdminSupabaseClient();

  const { data: logs, error } = await admin
    .from("audit_logs")
    .select("id, action, entity_type, entity_id, details, created_at, profiles(full_name)")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) throw new Error(error.message);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (logs ?? []) as any as AuditLog[];

  return (
    <section className="page-card">
      <div className="topbar" style={{ marginBottom: 16 }}>
        <div>
          <h1>Audit Log</h1>
          <p className="muted">Last 200 actions across blocks and slabs</p>
        </div>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "2px solid var(--border, #E8DDD0)", textAlign: "left" }}>
              <th style={{ padding: "8px 12px", fontWeight: 600 }}>Date / Time</th>
              <th style={{ padding: "8px 12px", fontWeight: 600 }}>User</th>
              <th style={{ padding: "8px 12px", fontWeight: 600 }}>Action</th>
              <th style={{ padding: "8px 12px", fontWeight: 600 }}>Entity</th>
              <th style={{ padding: "8px 12px", fontWeight: 600 }}>Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: "24px 12px", textAlign: "center" }} className="muted">
                  No audit logs found.
                </td>
              </tr>
            ) : (
              rows.map((log) => (
                <tr
                  key={log.id}
                  style={{ borderBottom: "1px solid var(--border, #E8DDD0)" }}
                >
                  <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }} className="muted">
                    {fmtDateTime(log.created_at)}
                  </td>
                  <td style={{ padding: "8px 12px" }}>
                    {log.profiles?.full_name ?? <span className="muted">—</span>}
                  </td>
                  <td style={{ padding: "8px 12px" }}>
                    <span className="role-pill">{log.action}</span>
                  </td>
                  <td style={{ padding: "8px 12px" }}>
                    <span className="muted">{log.entity_type}</span>{" "}
                    <code style={{ fontSize: 12 }}>{log.entity_id}</code>
                  </td>
                  <td style={{ padding: "8px 12px" }} className="muted">
                    {log.details ? (
                      <code style={{ fontSize: 11, wordBreak: "break-all" }}>
                        {JSON.stringify(log.details)}
                      </code>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
