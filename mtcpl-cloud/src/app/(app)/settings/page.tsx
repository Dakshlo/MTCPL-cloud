import { requireAuth } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { addTempleAction, updateTempleAction, deleteTempleAction, updateUserAction } from "./actions";
import type { AppRole } from "@/lib/types";

const ROLE_LABELS: Record<AppRole, string> = {
  owner: "Owner",
  planner: "Team Head",
  block_entry: "Block Entry",
  slab_entry: "Slab Entry",
  worker: "Worker",
  carving_assigner: "Carving",
  dispatch: "Dispatch",
  vendor: "Vendor",
};

const ROLE_ACCESS: Record<AppRole, string[]> = {
  owner: ["Dashboard", "Blocks", "Slabs", "Plan Generator", "Cutting", "Settings"],
  planner: ["Dashboard", "Blocks", "Slabs", "Plan Generator", "Cutting", "Settings"],
  block_entry: ["Dashboard", "Blocks", "Slabs"],
  slab_entry: ["Dashboard", "Blocks", "Slabs"],
  worker: ["Dashboard", "Cutting"],
  carving_assigner: ["Dashboard"],
  dispatch: ["Dashboard"],
  vendor: ["Dashboard"],
};

const ALL_ROLES: AppRole[] = ["owner", "planner", "block_entry", "slab_entry", "worker", "carving_assigner", "dispatch", "vendor"];

export default async function SettingsPage() {
  const { profile: currentUser } = await requireAuth(["owner", "planner"]);
  const supabase = await createServerSupabaseClient();

  const [{ data: temples }, { data: users }] = await Promise.all([
    supabase.from("temples").select("*").order("name"),
    supabase.from("profiles").select("id, full_name, phone, role, is_active").order("full_name"),
  ]);

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

      {/* User Management — owner only */}
      {currentUser.role === "owner" && (
        <div className="settings-section">
          <div className="settings-section-header">
            <h2>Users</h2>
            <p>Manage registered users — set roles and activate or deactivate accounts.</p>
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
                return (
                  <details key={user.id} className="settings-table-row">
                    <summary className="settings-table-row-face" style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr auto" }}>
                      <span>
                        <span className="settings-temple-name">{user.full_name || "—"}</span>
                        {user.phone ? <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>{user.phone}</span> : null}
                        {isSelf ? <span className="role-pill" style={{ marginLeft: 8, fontSize: 11 }}>You</span> : null}
                      </span>
                      <span><span className="role-pill">{ROLE_LABELS[role] ?? role}</span></span>
                      <span className="muted" style={{ fontSize: 12 }}>{(ROLE_ACCESS[role] ?? []).join(", ")}</span>
                      <span>
                        <span className={`role-pill ${user.is_active ? "badge-available" : "badge-discarded"}`}>
                          {user.is_active ? "Active" : "Inactive"}
                        </span>
                      </span>
                      <span className="muted" style={{ fontSize: 12 }}>Edit ▾</span>
                    </summary>

                    <div className="settings-table-edit">
                      <form action={updateUserAction} className="settings-form-row">
                        <input type="hidden" name="id" value={user.id} />
                        <label className="stack" style={{ flex: 1 }}>
                          <span>Role</span>
                          <select name="role" defaultValue={role} disabled={isSelf}>
                            {ALL_ROLES.map((r) => (
                              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                            ))}
                          </select>
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
                        <div style={{ alignSelf: "flex-end" }}>
                          <button className="secondary-button" type="submit" disabled={isSelf}>
                            {isSelf ? "Cannot edit yourself" : "Save"}
                          </button>
                        </div>
                      </form>
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

      {/* Temple Code Configuration */}
      <div className="settings-section">
        <div className="settings-section-header">
          <h2>Temple Codes</h2>
          <p>Each temple gets a unique code prefix used to auto-generate slab IDs (e.g. RM → RM-0001).</p>
        </div>

        {/* Add new temple */}
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

        {/* Temple list */}
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
                  <span>
                    <code className="code-badge">{temple.code_prefix}</code>
                  </span>
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
                      <button
                        className="ghost-button danger-ghost"
                        formAction={deleteTempleAction}
                        formNoValidate
                        type="submit"
                      >
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
    </>
  );
}
