import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAuth } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const ROLES = [
  "owner",
  "planner",
  "block_entry",
  "slab_entry",
  "worker",
  "carving_assigner",
  "dispatch",
  "vendor"
] as const;
const VENDOR_TYPES = ["CNC", "Manual"] as const;

async function addVendorAction(formData: FormData) {
  "use server";

  await requireAuth(["owner"]);
  const supabase = await createServerSupabaseClient();

  const name = String(formData.get("name") || "").trim();
  const vendor_type = String(formData.get("vendor_type") || "Manual");
  const is_active = formData.get("is_active") !== "false";

  if (!name) {
    redirect("/users?toast=Vendor+name+is+required");
  }

  const { error } = await supabase.from("vendors").insert({
    name,
    vendor_type,
    is_active
  });

  if (error) {
    redirect(`/users?toast=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/users");
  revalidatePath("/carving-assign");
  redirect("/users?toast=Vendor+added+successfully");
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
    redirect("/users?toast=Vendor+details+are+missing");
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
    redirect(`/users?toast=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/users");
  revalidatePath("/carving-assign");
  revalidatePath("/carving");
  redirect("/users?toast=Vendor+updated+successfully");
}

async function updateUserAction(formData: FormData) {
  "use server";

  await requireAuth(["owner"]);
  const supabase = await createServerSupabaseClient();

  const id = formData.get("id") as string;
  const role = formData.get("role") as string;
  const full_name = formData.get("full_name") as string;
  const is_active = formData.get("is_active") === "true";
  const vendor_id = (formData.get("vendor_id") as string) || null;

  if (!id || !role) throw new Error("User ID and role are required.");

  const { error } = await supabase
    .from("profiles")
    .update({ role, full_name, is_active, vendor_id })
    .eq("id", id);

  if (error) throw new Error(error.message);

  revalidatePath("/users");
  redirect("/users?toast=User+updated+successfully");
}

export default async function UsersPage() {
  await requireAuth(["owner"]);

  const supabase = await createServerSupabaseClient();

  const [{ data: profiles, error }, { data: vendors }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, phone, role, vendor_id, is_active, created_at")
      .order("created_at", { ascending: false }),
    supabase.from("vendors").select("id, name, vendor_type, is_active, created_at").order("name")
  ]);

  if (error) throw new Error(error.message);

  return (
    <section className="page-card">
      <div className="topbar" style={{ marginBottom: 0 }}>
        <div>
          <h1>User Management</h1>
          <p className="muted">
            Manage roles and access for all users. Only owners can see this page.
          </p>
        </div>
        <span className="role-pill">{profiles?.length ?? 0} users</span>
      </div>

      <div className="block-compact-list" style={{ marginTop: 18 }}>
        {(profiles ?? []).map((user) => (
          <details className="block-compact-item" key={user.id}>
            <summary className="block-compact-summary">
              <span
                className="mini-cube"
                style={{ background: user.is_active ? "#4a7c59" : "#b0a090" }}
              />
              <strong>{user.full_name || "Unnamed user"}</strong>
              <span className="role-pill">{user.role}</span>
              {user.phone ? <span className="block-summary-stone">{user.phone}</span> : null}
              <span className={`role-pill ${user.is_active ? "" : "pending-pill"}`}>
                {user.is_active ? "Active" : "Pending approval"}
              </span>
              <span className="block-summary-date muted">
                {new Date(user.created_at).toLocaleDateString("en-IN")}
              </span>
            </summary>

            <form action={updateUserAction} className="block-edit-form">
              <input name="id" type="hidden" value={user.id} />

              <div className="inventory-row">
                <label className="stack">
                  <span>Full name</span>
                  <input defaultValue={user.full_name ?? ""} name="full_name" placeholder="Full name" />
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
                  <span>Vendor (if vendor role)</span>
                  <select defaultValue={user.vendor_id ?? ""} name="vendor_id">
                    <option value="">Not a vendor</option>
                    {(vendors ?? []).map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="block-edit-footer">
                <p className="muted" style={{ fontSize: 12, flex: 1 }}>
                  ID: {user.id}
                </p>
                <button className="secondary-button" type="submit">
                  Save Changes
                </button>
              </div>
            </form>
          </details>
        ))}
      </div>

      {!profiles?.length ? (
        <div className="banner" style={{ marginTop: 16 }}>
          No users found yet.
        </div>
      ) : null}

      <section style={{ marginTop: 28 }}>
        <div className="topbar" style={{ marginBottom: 12 }}>
          <div>
            <h2 style={{ margin: 0 }}>Vendor Directory</h2>
            <p className="muted">Add new carving vendors here and make them available in assignment lists.</p>
          </div>
          <span className="role-pill">{vendors?.length ?? 0} vendors</span>
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
              New vendors added here become available in Carving Assign immediately.
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
                <span
                  className="mini-cube"
                  style={{ background: vendor.vendor_type === "CNC" ? "#5673c8" : "#8c6d43" }}
                />
                <strong>{vendor.name}</strong>
                <span className="role-pill">{vendor.vendor_type}</span>
                <span className={`role-pill ${vendor.is_active ? "" : "pending-pill"}`}>
                  {vendor.is_active ? "Active" : "Inactive"}
                </span>
                <span className="block-summary-date muted">
                  {new Date(vendor.created_at).toLocaleDateString("en-IN")}
                </span>
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
    </section>
  );
}
