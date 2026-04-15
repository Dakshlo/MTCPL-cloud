import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { addTempleAction, updateTempleAction, deleteTempleAction, updateUserAction, deleteUserAction, updateOwnNameAction, addStoneTypeAction, deleteStoneTypeAction } from "./actions";
import { stoneDisplayName } from "@/lib/stone-utils";
import type { AppRole } from "@/lib/types";

// All assignable roles — only shown to developer
const UI_ROLES_ALL = [
  { value: "developer",        label: "DEVELOPER" },
  { value: "owner",            label: "OWNER" },
  { value: "team_head",        label: "TEAM HEAD" },
  { value: "block_slab_entry", label: "BLOCK+SLAB ENTRY" },
  { value: "slab_entry",       label: "SLAB ENTRY" },
  { value: "block_entry",      label: "BLOCK ENTRY" },
  { value: "cutting_operator", label: "CUTTING OPERATOR" },
];

// Roles owner/team-head can assign — cannot promote to owner or developer
const UI_ROLES_PLANNER = [
  { value: "team_head",        label: "TEAM HEAD" },
  { value: "block_slab_entry", label: "BLOCK+SLAB ENTRY" },
  { value: "slab_entry",       label: "SLAB ENTRY" },
  { value: "block_entry",      label: "BLOCK ENTRY" },
  { value: "cutting_operator", label: "CUTTING OPERATOR" },
];

// Legacy — kept for roleLabel lookup
const UI_ROLES = UI_ROLES_ALL;

const ROLE_ACCESS: Record<string, string[]> = {
  developer:        ["Dashboard", "Blocks", "Slabs", "Plan Generator", "Cutting", "Settings"],
  owner:            ["Dashboard", "Blocks", "Slabs", "Plan Generator", "Cutting", "Settings"],
  team_head:        ["Blocks", "Slabs", "Plan Generator", "Cutting", "Settings"],
  block_slab_entry: ["Dashboard", "Blocks", "Slabs"],
  slab_entry:       ["Dashboard", "Slabs"],
  block_entry:      ["Blocks"],
  cutting_operator: ["Cutting"],
  carving_assigner: ["Dashboard"],
  dispatch:         ["Dashboard"],
  vendor:           ["Dashboard"],
};

function roleLabel(role: string): string {
  return UI_ROLES.find(r => r.value === role)?.label ?? role.replace(/_/g, " ").toUpperCase();
}

function formatDate(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });
}

function fmtAuditDate(iso: string) {
  const tz = "Asia/Kolkata";
  const d = new Date(iso);
  const now = new Date();
  const yest = new Date(now.getTime() - 86400000);
  // Compare calendar dates in IST, not UTC
  const fmt = (dt: Date) => dt.toLocaleDateString("en-CA", { timeZone: tz }); // YYYY-MM-DD
  const timeStr = d.toLocaleTimeString("en-IN", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
  if (fmt(d) === fmt(now)) return timeStr;
  if (fmt(d) === fmt(yest)) return "Yesterday, " + timeStr;
  return d.toLocaleDateString("en-IN", { timeZone: tz, day: "numeric", month: "short" }) + ", " + timeStr;
}

export default async function SettingsPage() {
  const { profile: currentUser } = await requireAuth(["owner", "team_head", "developer"]);
  const admin = createAdminSupabaseClient();

  const [{ data: temples }, { data: users }, { data: stoneTypes }] = await Promise.all([
    admin.from("temples").select("*").order("name"),
    // Admin client needed — RLS on profiles only returns the current user's own row
    admin.from("profiles").select("id, full_name, phone, role, is_active, created_at").order("full_name"),
    admin.from("stone_types").select("id, name, color_top, color_front, color_side, is_active, sort_order").order("sort_order").order("name"),
  ]);
  const stoneList = stoneTypes ?? [];

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

      {/* User Management — owner, team_head, developer */}
      {(currentUser.role === "owner" || currentUser.role === "developer" || currentUser.role === "team_head") && (
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
                // Lock: developer rows for everyone; owner rows for team_head
                const isLocked =
                  (isDeveloper && !isSelf) ||
                  (role === "owner" && currentUser.role === "team_head");

                // Locked rows: render as plain div (not expandable)
                if (isLocked) {
                  return (
                    <div key={user.id} className="settings-table-row" style={{ cursor: "default" }}>
                      <div className="settings-table-row-face" style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr auto" }}>
                        <span>
                          <span className="settings-temple-name">{user.full_name || "—"}</span>
                          {user.phone ? <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>{user.phone}</span> : null}
                          {user.created_at ? <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>Joined {formatDate(user.created_at)}</span> : null}
                        </span>
                        <span>
                          <span className="role-pill" style={
                            isDeveloper ? { background: "var(--gold)", color: "#fff", fontWeight: 700 } :
                            role === "owner" ? { background: "#1a1a1a", color: "#fff", fontWeight: 700 } :
                            role === "team_head" ? { background: "#1e3a5f", color: "#fff", fontWeight: 700 } : {}
                          }>
                            {roleLabel(role)}
                          </span>
                        </span>
                        <span className="muted" style={{ fontSize: 12 }}>{(ROLE_ACCESS[role] ?? []).join(", ")}</span>
                        <span>
                          <span className={`role-pill ${user.is_active ? "badge-available" : "badge-discarded"}`}>
                            {user.is_active ? "Active" : "Inactive"}
                          </span>
                        </span>
                        <span className="muted" style={{ fontSize: 12 }}>🔒 Locked</span>
                      </div>
                    </div>
                  );
                }

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
                            role === "team_head" ? { background: "#1e3a5f", color: "#fff", fontWeight: 700 } :
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
                      <span className="muted" style={{ fontSize: 12 }}>Edit ▾</span>
                    </summary>

                    <div className="settings-table-edit">
                      {/* Own row: only allow changing display name */}
                      {isSelf ? (
                        <form action={updateOwnNameAction} className="settings-form-row" style={{ flexWrap: "wrap" }}>
                          <label className="stack" style={{ flex: "2 1 160px" }}>
                            <span>Your Display Name</span>
                            <input
                              name="full_name"
                              defaultValue={user.full_name ?? ""}
                              placeholder="Enter your name"
                              required
                            />
                          </label>
                          <div style={{ alignSelf: "flex-end", display: "flex", gap: 8 }}>
                            <button className="secondary-button" type="submit">Update Name</button>
                          </div>
                          <p className="muted" style={{ fontSize: 11, width: "100%", margin: "4px 0 0" }}>
                            This name appears on blocks, slabs, and cutting plans you create.
                            Role and status can only be changed by another admin.
                          </p>
                        </form>
                      ) : (
                      <form action={updateUserAction} className="settings-form-row" style={{ flexWrap: "wrap" }}>
                            <input type="hidden" name="id" value={user.id} />

                            <label className="stack" style={{ flex: "2 1 160px" }}>
                              <span>Display Name</span>
                              <input
                                name="full_name"
                                defaultValue={user.full_name ?? ""}
                                placeholder="Enter full name"
                              />
                            </label>

                            <label className="stack" style={{ flex: "1 1 120px" }}>
                              <span>Role</span>
                              {currentUser.role === "developer" ? (
                                <select name="role" defaultValue={role}>
                                  {UI_ROLES_ALL.map((r) => (
                                    <option key={r.value} value={r.value}>{r.label}</option>
                                  ))}
                                </select>
                              ) : (
                                <select name="role" defaultValue={UI_ROLES_PLANNER.some(r => r.value === role) ? role : "block_slab_entry"}>
                                  {UI_ROLES_PLANNER.map((r) => (
                                    <option key={r.value} value={r.value}>{r.label}</option>
                                  ))}
                                </select>
                              )}
                            </label>

                            <label className="stack" style={{ flex: "0 0 auto" }}>
                              <span>Status</span>
                              <select name="is_active" defaultValue={String(user.is_active)}>
                                <option value="true">Active</option>
                                <option value="false">Inactive</option>
                              </select>
                            </label>

                            <div style={{ alignSelf: "flex-end", display: "flex", gap: 8 }}>
                              <button className="secondary-button" type="submit">Save</button>
                            </div>
                          </form>
                      )}

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
                    </div>
                  </details>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Stone Type Configuration — developer, owner, team_head */}
      <div className="settings-section">
        <div className="settings-section-header">
          <h2>Stone Types</h2>
          <p>Add custom stone types (e.g. Red Stone). They appear automatically in block entry, filters, and 3D views.</p>
        </div>

        <div className="settings-card">
          <h3 className="settings-card-title">Add Stone Type</h3>
          <form action={addStoneTypeAction} className="settings-form-row">
            <label className="stack" style={{ flex: 2 }}>
              <span>Name (no spaces, e.g. RedStone)</span>
              <input name="name" placeholder="e.g. RedStone" required style={{ fontFamily: "ui-monospace, monospace", fontWeight: 600 }} />
            </label>
            <label className="stack" style={{ flex: "0 0 auto" }}>
              <span>Stone Colour</span>
              <input type="color" name="color" defaultValue="#C87A60" style={{ width: 56, height: 36, padding: 2, cursor: "pointer", borderRadius: 6 }} />
            </label>
            <div className="stack" style={{ flex: "0 0 auto", justifyContent: "flex-end" }}>
              <span style={{ visibility: "hidden", fontSize: 12 }}>.</span>
              <button className="primary-button" type="submit">Add Stone</button>
            </div>
          </form>
        </div>

        <div className="settings-table">
          <div className="settings-table-head" style={{ gridTemplateColumns: "1fr auto auto auto" }}>
            <span>Stone Type</span>
            <span>3D Colours</span>
            <span>Blocks Use It</span>
            <span></span>
          </div>
          {stoneList.map(st => {
            const isBuiltIn = st.name === "PinkStone" || st.name === "WhiteStone";
            return (
              <div key={st.id} className="settings-table-row">
                <div className="settings-table-row-face" style={{ gridTemplateColumns: "1fr auto auto auto" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span
                      style={{
                        width: 28, height: 28, borderRadius: 6, flexShrink: 0,
                        background: `linear-gradient(135deg, ${st.color_top} 50%, ${st.color_front} 50%)`,
                        border: "1px solid rgba(0,0,0,0.1)",
                        display: "inline-block",
                      }}
                    />
                    <span className="settings-temple-name">{st.name}</span>
                    <span className="muted" style={{ fontSize: 12 }}>({stoneDisplayName(st.name)})</span>
                    {isBuiltIn && <span className="role-pill" style={{ fontSize: 11 }}>Built-in</span>}
                  </span>
                  <span style={{ display: "flex", gap: 4 }}>
                    <span title="Top" style={{ width: 22, height: 22, borderRadius: 4, background: st.color_top, border: "1px solid rgba(0,0,0,0.1)", display: "inline-block" }} />
                    <span title="Front" style={{ width: 22, height: 22, borderRadius: 4, background: st.color_front, border: "1px solid rgba(0,0,0,0.1)", display: "inline-block" }} />
                    <span title="Side" style={{ width: 22, height: 22, borderRadius: 4, background: st.color_side, border: "1px solid rgba(0,0,0,0.1)", display: "inline-block" }} />
                  </span>
                  <span className="muted" style={{ fontSize: 12 }}>—</span>
                  <span>
                    {isBuiltIn ? (
                      <span className="muted" style={{ fontSize: 12 }}>🔒 Protected</span>
                    ) : (
                      <form action={deleteStoneTypeAction} style={{ display: "inline" }}>
                        <input type="hidden" name="id" value={st.id} />
                        <input type="hidden" name="name" value={st.name} />
                        <button className="ghost-button danger-ghost" type="submit" style={{ fontSize: 12, padding: "3px 10px" }}>
                          Delete
                        </button>
                      </form>
                    )}
                  </span>
                </div>
              </div>
            );
          })}
          {stoneList.length === 0 && (
            <div className="banner">No stone types found. Run the database setup SQL first.</div>
          )}
        </div>
      </div>

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
            <label className="stack" style={{ flex: "0 0 auto" }}>
              <span>Stone Type</span>
              <select name="default_stone" defaultValue="PinkStone">
                {stoneList.length > 0
                  ? stoneList.map(st => <option key={st.name} value={st.name}>{st.name}</option>)
                  : <>
                      <option value="PinkStone">PinkStone</option>
                      <option value="WhiteStone">WhiteStone</option>
                    </>
                }
              </select>
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
                      <span>Stone Type</span>
                      <select name="default_stone" defaultValue={(temple as any).default_stone ?? "PinkStone"}>
                        {stoneList.length > 0
                          ? stoneList.map(st => <option key={st.name} value={st.name}>{st.name}</option>)
                          : <>
                              <option value="PinkStone">PinkStone</option>
                              <option value="WhiteStone">WhiteStone</option>
                            </>
                        }
                      </select>
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

      {/* Full System Backup — developer only */}
      {currentUser.role === "developer" && (
        <div className="settings-section">
          <div className="settings-section-header">
            <h2>Full System Backup</h2>
            <p>Download all live data as an Excel file. Each table is a separate sheet with raw column names — ready to insert directly into Supabase.</p>
          </div>
          <div className="settings-card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
            <div>
              <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>Export: blocks · slab_requirements · cut_sessions · temples · vendors · profiles</p>
              <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>Snapshot of current live data at time of download. JSONB columns are stringified.</p>
            </div>
            <a
              href="/api/export/full-backup"
              className="primary-button"
              style={{ textDecoration: "none", whiteSpace: "nowrap" }}
            >
              ↓ Download Backup
            </a>
          </div>
        </div>
      )}

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
                        {fmtAuditDate(log.created_at)}
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
