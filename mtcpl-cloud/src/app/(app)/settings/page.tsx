import { requireAuth } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { addTempleAction, updateTempleAction, deleteTempleAction, updateUserAction, deleteUserAction } from "./actions";
import type { AppRole } from "@/lib/types";

// Only 3 roles shown in UI
const UI_ROLES = [
  { value: "owner", label: "Owner" },
  { value: "planner", label: "Team Head" },
  { value: "block_entry", label: "Entry (Block & Slab)" },
];

const ROLE_ACCESS: Record<string, string[]> = {
  owner: ["Dashboard", "Blocks", "Slabs", "Plan Generator", "Cutting", "Settings"],
  planner: ["Dashboard", "Blocks", "Slabs", "Plan Generator", "Cutting", "Settings"],
  block_entry: ["Dashboard", "Blocks", "Slabs"],
  slab_entry: ["Dashboard", "Blocks", "Slabs"],
  worker: ["Dashboard", "Cutting"],
  carving_assigner: ["Dashboard"],
  dispatch: ["Dashboard"],
  vendor: ["Dashboard"],
};

function roleLabel(role: string): string {
  if (role === "slab_entry" || role === "block_entry") return "Entry (Block & Slab)";
  return UI_ROLES.find(r => r.value === role)?.label ?? role.replace(/_/g, " ");
}

function formatDate(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export default async function SettingsPage() {
  const { profile: currentUser } = await requireAuth(["owner", "planner"]);
  const supabase = await createServerSupabaseClient();

  const [{ data: temples }, { data: users }] = await Promise.all([
    supabase.from("temples").select("*").order("name"),
    supabase.from("profiles").select("id, full_name, phone, role, is_active, created_at").order("full_name"),
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
            <p>Manage registered users — edit name, role and activate or deactivate accounts.</p>
          </div>

          {/* RLS fix instructions */}
          <details className="settings-card" style={{ marginBottom: 12 }}>
            <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: 13, color: "var(--gold)" }}>
              ⚠ If Save / Remove User is not working → click for database fix SQL
            </summary>
            <div style={{ marginTop: 12 }}>
              <p className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
                Run this SQL once in your <strong>Supabase Dashboard → SQL Editor</strong>. This allows the Owner role to update and delete other users&apos; profiles.
              </p>
              <pre style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, padding: 12, fontSize: 12, overflowX: "auto", userSelect: "text" }}>{`-- Allow owners to update any profile
CREATE POLICY IF NOT EXISTS "Owners can update any profile"
  ON profiles FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'owner'
    )
  );

-- Allow owners to delete any profile
CREATE POLICY IF NOT EXISTS "Owners can delete any profile"
  ON profiles FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'owner'
    )
  );`}</pre>
            </div>
          </details>

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
                        {user.created_at ? <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>Joined {formatDate(user.created_at)}</span> : null}
                      </span>
                      <span><span className="role-pill">{roleLabel(role)}</span></span>
                      <span className="muted" style={{ fontSize: 12 }}>{(ROLE_ACCESS[role] ?? []).join(", ")}</span>
                      <span>
                        <span className={`role-pill ${user.is_active ? "badge-available" : "badge-discarded"}`}>
                          {user.is_active ? "Active" : "Inactive"}
                        </span>
                      </span>
                      <span className="muted" style={{ fontSize: 12 }}>Edit ▾</span>
                    </summary>

                    <div className="settings-table-edit">
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
                          <select name="role" defaultValue={role === "slab_entry" ? "block_entry" : role} disabled={isSelf}>
                            {UI_ROLES.map((r) => (
                              <option key={r.value} value={r.value}>{r.label}</option>
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
                    </div>
                  </details>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Measurement Unit Preference */}
      <div className="settings-section">
        <div className="settings-section-header">
          <h2>Measurement Units</h2>
          <p>Choose how dimensions are entered on Add Block and Add Slab forms. The toggle is available directly in each form header.</p>
        </div>
        <div className="settings-card">
          <p className="muted" style={{ fontSize: 13 }}>
            <strong>Inches (default):</strong> type a single number, e.g. 66 for 66 inches.<br />
            <strong>Feet + Inches:</strong> type 5 ft 6 in — converts automatically to 66 inches for storage.<br /><br />
            Open the <strong>Add Block</strong> or <strong>Add Slab</strong> form and click the <span style={{ background: "var(--border)", padding: "1px 6px", borderRadius: 4, fontSize: 12, fontFamily: "monospace" }}>in / ft+in</span> toggle in the form header to switch modes. Your choice is remembered.
          </p>
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
    </>
  );
}
