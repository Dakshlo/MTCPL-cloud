import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAuth } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const ROLES = ["owner", "office", "assigner", "vendor", "dispatch"] as const;
const VENDOR_TYPES = ["CNC", "Manual"] as const;

async function updateDimensionModeAction(formData: FormData) {
  "use server";

  await requireAuth(["owner"]);
  const supabase = await createServerSupabaseClient();
  const dimensionMode = String(formData.get("dimension_mode") || "ft_inch");

  const { error } = await supabase.from("system_settings").upsert(
    {
      id: true,
      dimension_mode: dimensionMode,
      updated_at: new Date().toISOString()
    },
    { onConflict: "id" }
  );

  if (error) redirect(`/settings?toast=${encodeURIComponent(error.message)}`);

  revalidatePath("/settings");
  revalidatePath("/slabs");
  redirect("/settings?toast=Dimension+mode+updated");
}

async function addTempleAction(formData: FormData) {
  "use server";

  await requireAuth(["owner"]);
  const supabase = await createServerSupabaseClient();
  const name = String(formData.get("name") || "").trim();
  const codePrefix = String(formData.get("code_prefix") || "").trim().toUpperCase();
  const displayOrder = Number(formData.get("display_order") || 100);
  const isActive = formData.get("is_active") !== "false";

  if (!name || !codePrefix) {
    redirect("/settings?toast=Temple+name+and+prefix+are+required");
  }

  const { error } = await supabase.from("temples").insert({
    name,
    code_prefix: codePrefix,
    display_order: Number.isFinite(displayOrder) ? displayOrder : 100,
    is_active: isActive
  });

  if (error) redirect(`/settings?toast=${encodeURIComponent(error.message)}`);

  revalidatePath("/settings");
  revalidatePath("/slabs");
  revalidatePath("/carving-assign");
  redirect("/settings?toast=Temple+added");
}

async function updateTempleAction(formData: FormData) {
  "use server";

  await requireAuth(["owner"]);
  const supabase = await createServerSupabaseClient();
  const id = String(formData.get("id") || "").trim();
  const name = String(formData.get("name") || "").trim();
  const codePrefix = String(formData.get("code_prefix") || "").trim().toUpperCase();
  const displayOrder = Number(formData.get("display_order") || 100);
  const isActive = formData.get("is_active") === "true";

  if (!id || !name || !codePrefix) {
    redirect("/settings?toast=Temple+details+are+missing");
  }

  const { error } = await supabase
    .from("temples")
    .update({
      name,
      code_prefix: codePrefix,
      display_order: Number.isFinite(displayOrder) ? displayOrder : 100,
      is_active: isActive
    })
    .eq("id", id);

  if (error) redirect(`/settings?toast=${encodeURIComponent(error.message)}`);

  revalidatePath("/settings");
  revalidatePath("/slabs");
  revalidatePath("/carving-assign");
  redirect("/settings?toast=Temple+updated");
}

async function addVendorAction(formData: FormData) {
  "use server";

  await requireAuth(["owner"]);
  const supabase = await createServerSupabaseClient();
  const name = String(formData.get("name") || "").trim();
  const vendor_type = String(formData.get("vendor_type") || "Manual");
  const is_active = formData.get("is_active") !== "false";

  if (!name) {
    redirect("/settings?toast=Vendor+name+is+required&section=vendors");
  }

  const { error } = await supabase.from("vendors").insert({
    name,
    vendor_type,
    is_active
  });

  if (error) {
    redirect(`/settings?toast=${encodeURIComponent(error.message)}&section=vendors`);
  }

  revalidatePath("/settings");
  revalidatePath("/carving-assign");
  revalidatePath("/carving");
  redirect("/settings?toast=Vendor+added&section=vendors");
}

async function updateVendorAction(formData: FormData) {
  "use server";

  await requireAuth(["owner"]);
  const supabase = await createServerSupabaseClient();
  const id = String(formData.get("id") || "").trim();
  const name = String(formData.get("name") || "").trim();
  const vendor_type = String(formData.get("vendor_type") || "Manual");
  const is_active = formData.get("is_active") === "true";

  if (!id || !name) {
    redirect("/settings?toast=Vendor+details+are+missing&section=vendors");
  }

  const { error } = await supabase
    .from("vendors")
    .update({
      name,
      vendor_type,
      is_active
    })
    .eq("id", id);

  if (error) {
    redirect(`/settings?toast=${encodeURIComponent(error.message)}&section=vendors`);
  }

  revalidatePath("/settings");
  revalidatePath("/carving-assign");
  revalidatePath("/carving");
  redirect("/settings?toast=Vendor+updated&section=vendors");
}

async function updateUserAction(formData: FormData) {
  "use server";

  await requireAuth(["owner"]);
  const supabase = await createServerSupabaseClient();
  const id = String(formData.get("id") || "");
  const role = String(formData.get("role") || "");
  const fullName = String(formData.get("full_name") || "");
  const isActive = formData.get("is_active") === "true";
  const vendorId = String(formData.get("vendor_id") || "") || null;
  const templeIds = formData.getAll("temple_ids").map((value) => String(value));

  if (!id || !role) {
    redirect("/settings?toast=User+ID+and+role+are+required&section=users");
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      role,
      full_name: fullName,
      is_active: isActive,
      vendor_id: role === "vendor" ? vendorId : null,
      updated_at: new Date().toISOString()
    })
    .eq("id", id);

  if (error) {
    redirect(`/settings?toast=${encodeURIComponent(error.message)}&section=users`);
  }

  await supabase.from("user_temple_access").delete().eq("user_id", id);

  if (role === "assigner" && templeIds.length) {
    const { error: templeError } = await supabase.from("user_temple_access").insert(
      templeIds.map((templeId) => ({
        user_id: id,
        temple_id: templeId
      }))
    );

    if (templeError) {
      redirect(`/settings?toast=${encodeURIComponent(templeError.message)}&section=users`);
    }
  }

  revalidatePath("/settings");
  revalidatePath("/carving-assign");
  redirect("/settings?toast=User+updated+successfully&section=users");
}

async function repairVendorAssignmentLinksAction() {
  "use server";

  await requireAuth(["owner"]);
  const supabase = await createServerSupabaseClient();

  const [{ data: vendors, error: vendorsError }, { data: slabs, error: slabsError }] = await Promise.all([
    supabase.from("vendors").select("id, name"),
    supabase.from("slabs").select("id, slab_code, assigned_vendor_id, assigned_vendor_name").not("assigned_vendor_name", "is", null)
  ]);

  if (vendorsError || slabsError) {
    redirect(`/settings?toast=${encodeURIComponent(vendorsError?.message || slabsError?.message || "Repair failed")}&section=vendors`);
  }

  const vendorMap = new Map((vendors ?? []).map((vendor) => [vendor.name, vendor.id]));
  const repairs = (slabs ?? [])
    .filter((slab) => slab.assigned_vendor_name && vendorMap.has(slab.assigned_vendor_name))
    .filter((slab) => slab.assigned_vendor_id !== vendorMap.get(slab.assigned_vendor_name as string))
    .map((slab) => ({
      id: slab.id,
      assigned_vendor_id: vendorMap.get(slab.assigned_vendor_name as string),
      assigned_vendor_name: slab.assigned_vendor_name
    }));

  if (!repairs.length) {
    redirect("/settings?toast=No+vendor+assignment+repair+was+needed&section=vendors");
  }

  const updates = await Promise.all(
    repairs.map((repair) =>
      supabase
        .from("slabs")
        .update({
          assigned_vendor_id: repair.assigned_vendor_id,
          assigned_vendor_name: repair.assigned_vendor_name,
          updated_at: new Date().toISOString()
        })
        .eq("id", repair.id)
    )
  );

  const failed = updates.find((result) => result.error);
  if (failed?.error) {
    redirect(`/settings?toast=${encodeURIComponent(failed.error.message)}&section=vendors`);
  }

  revalidatePath("/settings");
  revalidatePath("/carving");
  revalidatePath("/carving-assign");
  revalidatePath("/slab-viewer");
  revalidatePath("/dashboard");
  redirect(`/settings?toast=${encodeURIComponent(`Repaired ${repairs.length} slab assignment link(s)`)}&section=vendors`);
}

export default async function SettingsPage() {
  await requireAuth(["owner"]);
  const supabase = await createServerSupabaseClient();
  const [{ data: settings }, { data: temples }, { data: vendors }, { data: profiles, error: profilesError }, { data: accessRows }, { data: slabAssignments }] = await Promise.all([
    supabase.from("system_settings").select("dimension_mode").limit(1).single(),
    supabase.from("temples").select("id, name, code_prefix, display_order, is_active, created_at").order("display_order"),
    supabase.from("vendors").select("id, name, vendor_type, is_active, created_at").order("name"),
    supabase.from("profiles").select("id, full_name, phone, role, vendor_id, is_active, created_at").order("created_at", { ascending: false }),
    supabase.from("user_temple_access").select("user_id, temple_id"),
    supabase.from("slabs").select("assigned_vendor_id, assigned_vendor_name").not("assigned_vendor_name", "is", null)
  ]);

  if (profilesError) throw new Error(profilesError.message);

  const accessMap = (accessRows ?? []).reduce<Record<string, string[]>>((acc, row) => {
    if (!acc[row.user_id]) acc[row.user_id] = [];
    acc[row.user_id].push(row.temple_id);
    return acc;
  }, {});

  const vendorMap = new Map((vendors ?? []).map((vendor) => [vendor.name, vendor.id]));
  const brokenVendorAssignmentCount = (slabAssignments ?? []).filter(
    (slab) => slab.assigned_vendor_name && vendorMap.has(slab.assigned_vendor_name) && slab.assigned_vendor_id !== vendorMap.get(slab.assigned_vendor_name)
  ).length;

  return (
    <>
      <section className="page-card">
        <div className="topbar" style={{ marginBottom: 12 }}>
          <div>
            <h1>Settings</h1>
            <p className="muted">Manage slab dimension entry mode and temple master data from one place.</p>
          </div>
        </div>

        <form action={updateDimensionModeAction} className="block-edit-form">
          <div className="inventory-row">
            <label className="stack">
              <span>Dimension input mode</span>
              <select defaultValue={settings?.dimension_mode || "ft_inch"} name="dimension_mode">
                <option value="ft_inch">Feet + inches</option>
                <option value="decimal_ft">Decimal feet</option>
              </select>
            </label>
          </div>
          <div className="block-edit-footer">
            <p className="muted" style={{ fontSize: 12, flex: 1 }}>
              Slab Entry will switch its input layout based on this owner-level setting.
            </p>
            <button className="secondary-button" type="submit">
              Save Setting
            </button>
          </div>
        </form>
      </section>

      <section className="page-card" style={{ marginTop: 16 }}>
        <div className="topbar" style={{ marginBottom: 12 }}>
          <div>
            <h2 style={{ margin: 0 }}>Temple Master</h2>
            <p className="muted">Temple prefixes control the generated slab code format.</p>
          </div>
          <span className="role-pill">{temples?.length ?? 0} temples</span>
        </div>

        <form action={addTempleAction} className="block-edit-form" style={{ marginBottom: 16 }}>
          <div className="inventory-row">
            <label className="stack">
              <span>Temple name</span>
              <input name="name" placeholder="Umia Mata" required />
            </label>
            <label className="stack">
              <span>Code prefix</span>
              <input maxLength={5} name="code_prefix" placeholder="UM" required />
            </label>
            <label className="stack">
              <span>Display order</span>
              <input defaultValue="100" min="1" name="display_order" type="number" />
            </label>
            <label className="stack">
              <span>Status</span>
              <select defaultValue="true" name="is_active">
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </label>
          </div>
          <div className="block-edit-footer">
            <p className="muted" style={{ fontSize: 12, flex: 1 }}>
              Newly added temples appear immediately in Slab Entry and temple-scoped assignment.
            </p>
            <button className="secondary-button" type="submit">
              Add Temple
            </button>
          </div>
        </form>

        <div className="block-compact-list">
          {(temples ?? []).map((temple) => (
            <details className="block-compact-item" key={temple.id}>
              <summary className="block-compact-summary">
                <span className="mini-cube" style={{ background: temple.is_active ? "#4a7c59" : "#b0a090" }} />
                <strong>{temple.name}</strong>
                <span className="role-pill">{temple.code_prefix}</span>
                <span className={`role-pill ${temple.is_active ? "" : "pending-pill"}`}>{temple.is_active ? "Active" : "Inactive"}</span>
              </summary>
              <form action={updateTempleAction} className="block-edit-form">
                <input name="id" type="hidden" value={temple.id} />
                <div className="inventory-row">
                  <label className="stack">
                    <span>Temple name</span>
                    <input defaultValue={temple.name} name="name" required />
                  </label>
                  <label className="stack">
                    <span>Code prefix</span>
                    <input defaultValue={temple.code_prefix} maxLength={5} name="code_prefix" required />
                  </label>
                  <label className="stack">
                    <span>Display order</span>
                    <input defaultValue={temple.display_order} min="1" name="display_order" type="number" />
                  </label>
                  <label className="stack">
                    <span>Status</span>
                    <select defaultValue={String(temple.is_active)} name="is_active">
                      <option value="true">Active</option>
                      <option value="false">Inactive</option>
                    </select>
                  </label>
                </div>
                <div className="block-edit-footer">
                  <p className="muted" style={{ fontSize: 12, flex: 1 }}>
                    Temple created on {new Date(temple.created_at).toLocaleDateString("en-IN")}
                  </p>
                  <button className="secondary-button" type="submit">
                    Save Temple
                  </button>
                </div>
              </form>
            </details>
          ))}
        </div>
      </section>

      <section className="page-card" style={{ marginTop: 16 }}>
        <div className="topbar" style={{ marginBottom: 12 }}>
          <div>
            <h2 style={{ margin: 0 }}>Vendor Directory</h2>
            <p className="muted">Add and manage vendors here. Active vendors appear automatically in Assign Vendor.</p>
          </div>
          <span className="role-pill">{vendors?.length ?? 0} vendors</span>
        </div>

        <div className="banner" style={{ marginBottom: 16 }}>
          <strong>Vendor assignment health:</strong>{" "}
          {brokenVendorAssignmentCount
            ? `${brokenVendorAssignmentCount} slab assignment link(s) need repair before vendors can see them in their portal.`
            : "All slab assignment links are aligned with vendor IDs."}
          <form action={repairVendorAssignmentLinksAction} style={{ marginTop: 12 }}>
            <button className="secondary-button" type="submit">
              Repair Vendor Assignment Links
            </button>
          </form>
        </div>

        <form action={addVendorAction} className="block-edit-form" style={{ marginBottom: 16 }}>
          <div className="inventory-row">
            <label className="stack">
              <span>Vendor name</span>
              <input name="name" placeholder="Mohit, New CNC Vendor..." required />
            </label>

            <label className="stack">
              <span>Type</span>
              <select defaultValue="Manual" name="vendor_type">
                {VENDOR_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>

            <label className="stack">
              <span>Status</span>
              <select defaultValue="true" name="is_active">
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </label>
          </div>

          <div className="block-edit-footer">
            <p className="muted" style={{ fontSize: 12, flex: 1 }}>
              Added vendors can be linked to user accounts and used immediately in slab assignment.
            </p>
            <button className="secondary-button" type="submit">
              Add Vendor
            </button>
          </div>
        </form>

        <div className="block-compact-list">
          {(vendors ?? []).map((vendor) => (
            <details className="block-compact-item" key={vendor.id}>
              <summary className="block-compact-summary">
                <span className="mini-cube" style={{ background: vendor.vendor_type === "CNC" ? "#5673c8" : "#8c6d43" }} />
                <strong>{vendor.name}</strong>
                <span className="role-pill">{vendor.vendor_type}</span>
                <span className={`role-pill ${vendor.is_active ? "" : "pending-pill"}`}>{vendor.is_active ? "Active" : "Inactive"}</span>
                <span className="block-summary-date muted">{new Date(vendor.created_at).toLocaleDateString("en-IN")}</span>
              </summary>

              <form action={updateVendorAction} className="block-edit-form">
                <input name="id" type="hidden" value={vendor.id} />

                <div className="inventory-row">
                  <label className="stack">
                    <span>Vendor name</span>
                    <input defaultValue={vendor.name} name="name" required />
                  </label>

                  <label className="stack">
                    <span>Type</span>
                    <select defaultValue={vendor.vendor_type} name="vendor_type">
                      {VENDOR_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="stack">
                    <span>Status</span>
                    <select defaultValue={String(vendor.is_active)} name="is_active">
                      <option value="true">Active</option>
                      <option value="false">Inactive</option>
                    </select>
                  </label>
                </div>

                <div className="block-edit-footer">
                  <p className="muted" style={{ fontSize: 12, flex: 1 }}>
                    Vendor ID: {vendor.id}
                  </p>
                  <button className="secondary-button" type="submit">
                    Save Vendor
                  </button>
                </div>
              </form>
            </details>
          ))}
        </div>
      </section>

      <section className="page-card" style={{ marginTop: 16 }}>
        <div className="topbar" style={{ marginBottom: 12 }}>
          <div>
            <h2 style={{ margin: 0 }}>User Management</h2>
            <p className="muted">Activate users, assign roles, link vendors, and set temple access for assigners.</p>
          </div>
          <span className="role-pill">{profiles?.length ?? 0} users</span>
        </div>

        <div className="block-compact-list">
          {(profiles ?? []).map((user) => (
            <details className="block-compact-item" key={user.id}>
              <summary className="block-compact-summary">
                <span className="mini-cube" style={{ background: user.is_active ? "#4a7c59" : "#b0a090" }} />
                <strong>{user.full_name || "Unnamed user"}</strong>
                <span className="role-pill">{user.role}</span>
                {user.phone ? <span className="block-summary-stone">{user.phone}</span> : null}
                <span className={`role-pill ${user.is_active ? "" : "pending-pill"}`}>{user.is_active ? "Active" : "Pending approval"}</span>
                <span className="block-summary-date muted">{new Date(user.created_at).toLocaleDateString("en-IN")}</span>
              </summary>

              <form action={updateUserAction} className="block-edit-form">
                <input name="id" type="hidden" value={user.id} />

                <div className="inventory-row">
                  <label className="stack">
                    <span>Full name</span>
                    <input defaultValue={user.full_name ?? ""} name="full_name" />
                  </label>

                  <label className="stack">
                    <span>Role</span>
                    <select defaultValue={user.role} name="role">
                      {ROLES.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="stack">
                    <span>Access</span>
                    <select defaultValue={String(user.is_active)} name="is_active">
                      <option value="true">Approved and active</option>
                      <option value="false">Pending approval</option>
                    </select>
                  </label>

                  <label className="stack">
                    <span>Vendor link</span>
                    <select defaultValue={user.vendor_id ?? ""} name="vendor_id">
                      <option value="">Not a vendor</option>
                      {(vendors ?? []).map((vendor) => (
                        <option key={vendor.id} value={vendor.id}>
                          {vendor.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="stack" style={{ marginTop: 12 }}>
                  <span>Assigner temple access</span>
                  <div className="inventory-chip-row">
                    {(temples ?? []).filter((temple) => temple.is_active).map((temple) => {
                      const checked = accessMap[user.id]?.includes(temple.id);
                      return (
                        <label className="role-pill" key={temple.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <input defaultChecked={checked} name="temple_ids" type="checkbox" value={temple.id} />
                          {temple.name}
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="block-edit-footer">
                  <p className="muted" style={{ fontSize: 12, flex: 1 }}>
                    User ID: {user.id}
                  </p>
                  <button className="secondary-button" type="submit">
                    Save Changes
                  </button>
                </div>
              </form>
            </details>
          ))}
        </div>
      </section>
    </>
  );
}
