import { requireAuth } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { addTempleAction, updateTempleAction, deleteTempleAction, updateUserAction, deleteUserAction } from "./actions";
import type { AppRole } from "@/lib/types";

// All assignable roles — only shown to developer
const UI_ROLES_ALL = [
  { value: "developer", label: "DEVELOPER" },
  { value: "owner",     label: "OWNER" },
  { value: "planner",   label: "TEAM HEAD" },
  { value: "block_entry", label: "BLOCK+SLAB ENTRY" },
  { value: "slab_entry",  label: "SLAB ENTRY" },
  { value: "block_only",  label: "BLOCK ENTRY" },
  { value: "worker",    label: "CUTTING OPERATOR" },
];

// Roles a team-lead (planner) can assign — cannot promote to owner or developer
const UI_ROLES_PLANNER = [
  { value: "planner",   label: "TEAM HEAD" },
  { value: "block_entry", label: "BLOCK+SLAB ENTRY" },
  { value: "slab_entry",  label: "SLAB ENTRY" },
  { value: "block_only",  label: "BLOCK ENTRY" },
  { value: "worker",    label: "CUTTING OPERATOR" },
];

// Legacy — kept for roleLabel lookup
const UI_ROLES = UI_ROLES_ALL;

const ROLE_ACCESS: Record<string, string[]> = {
  developer:   ["Dashboard", "Blocks", "Slabs", "Plan Generator", "Cutting", "Settings"],
  owner:       ["Dashboard", "Blocks", "Slabs", "Plan Generator", "Cutting", "Settings"],
  planner:     ["Dashboard", "Blocks", "Slabs", "Plan Generator", "Cutting", "Settings"],
  block_entry: ["Dashboard", "Blocks", "Slabs"],
  slab_entry:  ["Dashboard", "Slabs"],
  block_only:  ["Blocks"],
  worker:      ["Cutting"],
  carving_assigner: ["Dashboard"],
  dispatch:    ["Dashboard"],
  vendor:      ["Dashboard"],
};

function roleLabel(role: string): string {
  return UI_ROLES.find(r => r.value === role)?.label ?? role.replace(/_/g, " ").toUpperCase();
}

function formatDate(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export default async function SettingsPage() {
  const { profile: currentUser } = await requireAuth(["owner", "planner", "developer"]);
  const supabase = await createServerSupabaseClient();
  const admin = createAdminSupabaseClient();

  const [{ data: temples }, { data: users }] = await Promise.all([
    supabase.from("temples").select("*").order("name"),
    // Admin client needed — RLS on profiles only returns the current user's own row
    admin.from("profiles").select("id, full_name, phone, role, is_active, created_at").order("full_name"),
  ]);

  // Admin client needed — profiles join in audit log returns null names for non-self users under RLS
  const { data: recentAudit } = await admin
    .from("audit_logs")
    .select("id, action, entity_type, entity_id, created_at, profiles(full_name)")
    .order("created_at", { ascending: false })
    .limit(50);

  const templeList = temples ?? [];
  const userList = users ?? [];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p className="muted">Manage temples and system users.</p>
        </div>
      </div>

      {/* User Management — owner/developer only */}
      {(currentUser.role === "owner" || currentUser.role === "developer") && (
        <div className="settings-section">
          <div className="settings-section-header">
            <h2>Users</h2>
            <p>Manage registered users — edit name, role and activate or deactivate accounts.</p>
          </div>

          {userList.length === 0 ? (
            <div className="banner">No users found.</div>
          ) : (
            <div className="settings-table">
              <div className="settings-table-head" style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr auto" }}>
                <span>Name / Phone</span>
                <span>Role</span>
                <span>Access</span>
                <span>Status</span>
                <span></span>
              </div>
              {userList.map((user) => {
                const role = user.role as AppRole;
                const isSelf = user.id === currentUser.id;
                const isDeveloper = role === "developer";
                const isLocked = isDeveloper && !isSelf; // other people can't touch developer rows
                return (
                  <details key={user.id} className="settings-table-row">
                    <summary className="settings-table-row-face" style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr auto" }}>
                      <span>
                        <span className="settings-temple-name">{user.full_name || "—"}</span>
                        {user.phone ? <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>{user.phone}</span> : null}
                        {isSelf ? <span className="role-pill" style={{ marginLeft: 8, fontSize: 11 }}>You</span> : null}
                        {user.created_at ? <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>Joined {formatDate(user.created_at)}</span> : null}
                      </span>
                      <span>
                        <span
                          className="role-pill"
                          style={
                            isDeveloper ? { background: "var(--gold)", color: "#fff", fontWeight: 700 } :
                            role === "owner" ? { background: "#1a1a1a", color: "#fff", fontWeight: 700 } :
                            {}
                          }
                        >
                          {roleLabel(role)}
                        </span>
                      </span>
                      <span className="muted" style={{ fontSize: 12 }}>{(ROLE_ACCESS[role] ?? []).join(", ")}</span>
                      <span>
                        <span className={`role-pill ${user.is_active ? "badge-available" : "badge-discarded"}`}>
                          {user.is_active ? "Active" : "Inactive"}
                        </span>
                      </span>
                      <span className="muted" style={{ fontSize: 12 }}>{isLocked ? "🔒 Locked" : "Edit ▾"}</span>
                    </summary>

                    <div className="settings-table-edit">
                      {isLocked ? (
                        <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                          🔒 Developer account — cannot be edited or removed by anyone.
                        </p>
                      ) : (
                        <>
                          <form action={updateUserAction} className="settings-form-row" style={{ flexWrap: "wrap" }}>
                            <input type="hidden" name="id" value={user.id} />

                            <label className="stack" style={{ flex: "2 1 160px" }}>
                              <span>Display Name</span>
                              <input
                                name="full_name"
                                defaultValue={user.full_name ?? ""}
                                placeholder="Enter full name"
                                disabled={isSelf}
                              />
                            </label>

                            <label className="stack" style={{ flex: "1 1 120px" }}>
                              <span>Role</span>
                              {/* Developer: full list | Planner: restricted list | Owner: read-only */}
                              {currentUser.role === "developer" ? (
                                <select name="role" defaultValue={role} disabled={isSelf}>
                                  {UI_ROLES_ALL.map((r) => (
                                    <option key={r.value} value={r.value}>{r.label}</option>
                                  ))}
                                </select>
                              ) : currentUser.role === "planner" ? (
                                <select name="role" defaultValue={UI_ROLES_PLANNER.some(r => r.value === role) ? role : "block_entry"}>
                                  {UI_ROLES_PLANNER.map((r) => (
                                    <option key={r.value} value={r.value}>{r.label}</option>
                                  ))}
                                </select>
                              ) : (
                                // Owner — cannot change roles
                                <>
                                  <input name="role" type="hidden" value={role} />
                                  <select disabled defaultValue={role}>
                                    <option value={role}>{roleLabel(role)}</option>
                                  </select>
                                </>
                              )}
                              {isSelf ? <input type="hidden" name="role" value={role} /> : null}
                            </label>

                            <label className="stack" style={{ flex: "0 0 auto" }}>
                              <span>Status</span>
                              <select name="is_active" defaultValue={String(user.is_active)} disabled={isSelf}>
                                <option value="true">Active</option>
                                <option value="false">Inactive</option>
                              </select>
                              {isSelf ? <input type="hidden" name="is_active" value="true" /> : null}
                            </label>

                            <div style={{ alignSelf: "flex-end", display: "flex", gap: 8 }}>
                              <button className="secondary-button" type="submit" disabled={isSelf}>
                                {isSelf ? "Can't edit self" : "Save"}
                              </button>
                            </div>
                          </form>

                          {!isSelf && (
                            <div style={{ marginTop: 10 }}>
                              <form action={deleteUserAction} style={{ display: "inline" }}>
                                <input type="hidden" name="id" value={user.id} />
                                <button
                                  className="ghost-button danger-ghost"
                                  type="submit"
                                  formNoValidate
                                  style={{ fontSize: 12 }}
                                >
                                  Remove User
                                </button>
                              </form>
                              <span className="muted" style={{ fontSize: 11, marginLeft: 10 }}>
                                Removes access. Auth account remains in Supabase.
                              </span>
                            </div>
                          )}

                          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                            Access pages: {(ROLE_ACCESS[role] ?? []).join(" · ")}
                          </div>
                        </>
                      )}
                    </div>
                  </details>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Temple Code Configuration */}
      <div className="settings-section">
        <div className="settings-section-header">
          <h2>Temple Codes</h2>
          <p>Each temple gets a unique code prefix used to auto-generate slab IDs (e.g. RM → RM-0001).</p>
        </div>

        <div className="settings-card">
          <h3 className="settings-card-title">Add Temple</h3>
          <form action={addTempleAction} className="settings-form-row">
            <label className="stack" style={{ flex: 2 }}>
              <span>Temple Name</span>
              <input name="name" placeholder="e.g. Ram Mandir" required />
            </label>
            <label className="stack" style={{ flex: 1 }}>
              <span>Code Prefix</span>
              <input
                name="code_prefix"
                placeholder="e.g. RM"
                maxLength={6}
                required
                style={{ textTransform: "uppercase", fontFamily: "ui-monospace, monospace", fontWeight: 700 }}
              />
            </label>
            <div className="stack" style={{ flex: "0 0 auto", justifyContent: "flex-end" }}>
              <span style={{ visibility: "hidden", fontSize: 12 }}>.</span>
              <button className="primary-button" type="submit">Add Temple</button>
            </div>
          </form>
        </div>

        {templeList.length === 0 ? (
          <div className="banner">No temples configured yet. Add your first temple above.</div>
        ) : (
          <div className="settings-table">
            <div className="settings-table-head">
              <span>Temple Name</span>
              <span>Code Prefix</span>
              <span>Slab ID Format</span>
              <span>Status</span>
              <span></span>
            </div>
            {templeList.map(temple => (
              <details key={temple.id} className="settings-table-row">
                <summary className="settings-table-row-face">
                  <span className="settings-temple-name">{temple.name}</span>
                  <span><code className="code-badge">{temple.code_prefix}</code></span>
                  <span className="muted" style={{ fontSize: 13 }}>
                    {temple.code_prefix}-0001, {temple.code_prefix}-0002…
                  </span>
                  <span>
                    <span className={`role-pill ${temple.is_active ? "badge-available" : "badge-discarded"}`}>
                      {temple.is_active ? "Active" : "Inactive"}
                    </span>
                  </span>
                  <span className="muted" style={{ fontSize: 12 }}>Edit ▾</span>
                </summary>

                <div className="settings-table-edit">
                  <form action={updateTempleAction} className="settings-form-row">
                    <input type="hidden" name="id" value={temple.id} />
                    <label className="stack" style={{ flex: 2 }}>
                      <span>Temple Name</span>
                      <input name="name" defaultValue={temple.name} required />
                    </label>
                    <label className="stack" style={{ flex: 1 }}>
                      <span>Code Prefix</span>
                      <input
                        name="code_prefix"
                        defaultValue={temple.code_prefix}
                        maxLength={6}
                        required
                        style={{ textTransform: "uppercase", fontFamily: "ui-monospace, monospace", fontWeight: 700 }}
                      />
                    </label>
                    <label className="stack" style={{ flex: "0 0 auto" }}>
                      <span>Status</span>
                      <select name="is_active" defaultValue={String(temple.is_active)}>
                        <option value="true">Active</option>
                        <option value="false">Inactive</option>
                      </select>
                    </label>
                    <div style={{ display: "flex", gap: 8, alignSelf: "flex-end" }}>
                      <button className="secondary-button" type="submit">Save</button>
                      <button className="ghost-button danger-ghost" formAction={deleteTempleAction} formNoValidate type="submit">
                        Delete
                      </button>
                    </div>
                  </form>
                </div>
              </details>
            ))}
          </div>
        )}
      </div>

      {/* Audit Log */}
      {(currentUser.role === "owner" || currentUser.role === "developer") && (
        <div className="settings-section">
          <div className="settings-section-header">
            <h2>Audit Log</h2>
            <p>Last 50 actions by your team.</p>
          </div>
          <div className="settings-card" style={{ padding: 0, overflow: "hidden" }}>
            {(recentAudit ?? []).length === 0 ? (
              <p className="muted" style={{ padding: 16 }}>No actions recorded yet.</p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <tbody>
                  {(recentAudit ?? []).map((log: any) => (
                    <tr key={log.id} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "8px 14px", color: "var(--muted)", whiteSpace: "nowrap" }}>
                        {new Date(log.created_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td style={{ padding: "8px 14px", fontWeight: 600 }}>{log.profiles?.full_name ?? "—"}</td>
                      <td style={{ padding: "8px 14px" }}><span className="role-pill">{log.action}</span></td>
                      <td style={{ padding: "8px 14px", color: "var(--muted)" }}>{log.entity_type} · <code style={{ fontSize: 11 }}>{log.entity_id}</code></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </>
  );
}
