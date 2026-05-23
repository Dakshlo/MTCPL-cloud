import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

/**
 * Self-service name update. Daksh May 2026 — locked down to
 * developer-only because several role gates in the app key off
 * display name (sidebar.tsx grants RAJESH / NARESH dashboard
 * access by name match; some MTCPL-AI prompts customise on the
 * first word of full_name). A user renaming themselves would
 * silently lose those name-based capabilities.
 *
 * The form on /profile is gone for everyone but developer. A non-
 * dev who somehow POSTs to this action (e.g. an old bookmarked
 * tab, a curl request) gets a quiet redirect with a toast rather
 * than a successful update.
 */
async function updateNameAction(formData: FormData) {
  "use server";
  const { profile } = await requireAuth();
  if (profile.role !== "developer") {
    // Belt-and-braces — the UI no longer renders a form for non-
    // devs, but a stale tab or scripted POST would otherwise still
    // succeed. Reject cleanly with a toast.
    redirect("/profile?toast=Name+changes+are+admin-only");
  }
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
    profile.full_name || profile.vendor_name || profile.phone || "—";

  // Daksh May 2026 — only developer sees the edit form. Everyone
  // else gets a read-only view so a team_head with name-based
  // dashboard access (RAJESH / NARESH) doesn't accidentally rename
  // themselves out of those grants.
  const canEdit = profile.role === "developer";

  return (
    <section className="page-card" style={{ maxWidth: 480 }}>
      <div className="record-head">
        <div>
          <h1>My Profile</h1>
          <p className="muted">
            {canEdit
              ? "Update your display name — shown on blocks, slabs, and cutting plans."
              : "Your display name is set by your admin. Some role permissions are linked to your name, so it can't be self-changed."}
          </p>
        </div>
      </div>

      {/* Name row — read-only chip for non-devs, editable form for devs. */}
      {canEdit ? (
        <form
          action={updateNameAction}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 16,
            marginTop: 24,
          }}
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
            <a
              href="/"
              style={{ fontSize: 13, color: "var(--muted)", textDecoration: "none" }}
            >
              Cancel
            </a>
          </div>
        </form>
      ) : (
        <div
          style={{
            marginTop: 24,
            padding: "14px 16px",
            background: "var(--surface-alt)",
            border: "1px solid var(--border)",
            borderRadius: 8,
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 800,
              color: "var(--muted)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            Display name
          </div>
          <div
            style={{
              marginTop: 4,
              fontSize: 18,
              fontWeight: 700,
              color: "var(--text)",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span>🔒</span>
            <span>{displayName}</span>
          </div>
          <p
            style={{
              margin: "10px 0 0",
              fontSize: 12,
              color: "var(--muted)",
              lineHeight: 1.5,
            }}
          >
            Locked because role permissions key off the name (e.g. team
            heads with dashboard access are matched by name). Ask your
            admin if it really needs to change.
          </p>
        </div>
      )}

      <div
        style={{
          marginTop: 28,
          padding: "14px 16px",
          background: "var(--surface-alt)",
          borderRadius: 8,
          fontSize: 12,
          color: "var(--muted)",
        }}
      >
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
