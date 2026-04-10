import { requireAuth } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { addTempleAction, updateTempleAction, deleteTempleAction } from "./actions";

export default async function SettingsPage() {
  await requireAuth(["owner", "planner"]);
  const supabase = await createServerSupabaseClient();

  const { data: temples } = await supabase
    .from("temples")
    .select("*")
    .order("name");

  const templeList = temples ?? [];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p className="muted">Configure temples and their unique slab code prefixes.</p>
        </div>
      </div>

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
