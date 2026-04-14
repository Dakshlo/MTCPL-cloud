import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

async function updateNameAction(formData: FormData) {
  "use server";
  const { profile } = await requireAuth();
  const full_name = (formData.get("full_name") as string | null)?.trim() ?? "";
  if (!full_name) redirect("/profile?toast=Name+cannot+be+empty");

  const admin = createAdminSupabaseClient();
  const { error } = await admin
    .from("profiles")
    .update({ full_name })
    .eq("id", profile.id);

  if (error) redirect(`/profile?toast=${encodeURIComponent(error.message)}`);
  revalidatePath("/profile");
  revalidatePath("/");
  redirect("/profile?toast=Name+updated");
}

export default async function ProfilePage() {
  const { profile } = await requireAuth();

  const displayName =
    profile.full_name || profile.vendor_name || profile.phone || "";

  return (
    <section className="page-card" style={{ maxWidth: 480 }}>
      <div className="record-head">
        <div>
          <h1>My Profile</h1>
          <p className="muted">Update your display name — shown on blocks, slabs, and cutting plans.</p>
        </div>
      </div>

      <form
        action={updateNameAction}
        style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 24 }}
      >
        <label className="stack">
          <span>Display Name</span>
          <input
            name="full_name"
            defaultValue={displayName}
            placeholder="Enter your full name"
            required
            autoFocus
            style={{ fontSize: 15 }}
          />
        </label>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button className="primary-button" type="submit">
            Save Name
          </button>
          <a href="/" style={{ fontSize: 13, color: "var(--muted)", textDecoration: "none" }}>
            Cancel
          </a>
        </div>
      </form>

      <div style={{ marginTop: 28, padding: "14px 16px", background: "var(--surface-alt)", borderRadius: 8, fontSize: 12, color: "var(--muted)" }}>
        <strong style={{ color: "var(--text)" }}>Phone / Role</strong>
        <p style={{ margin: "4px 0 0" }}>
          {profile.phone ?? "—"} &nbsp;·&nbsp;{" "}
          {profile.role.replace(/_/g, " ")}
        </p>
        <p style={{ margin: "6px 0 0", fontSize: 11 }}>
          To change your role or phone number, ask your admin.
        </p>
      </div>
    </section>
  );
}
