/**
 * 🧱 Site / Installation — temple picker (mig 133).
 *
 * The stage after dispatch: each temple has a site portal where the
 * incharge unloads delivered trucks into yards, keeps stock, and marks
 * slabs installed. (Per-temple site_incharge scoping comes later — for
 * now the office management circle sees every temple.)
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { SITE_ROLES } from "./site-roles";

export const dynamic = "force-dynamic";

export default async function SiteIndexPage() {
  const { profile } = await requireAuth();
  if (!SITE_ROLES.includes(profile.role)) redirect("/");
  const admin = createAdminSupabaseClient();

  const { data: temples } = await admin
    .from("temples")
    .select("name, code_prefix")
    .eq("is_active", true)
    .order("name");

  type T = { name: string; code_prefix: string };
  const list = (temples ?? []) as T[];

  // Per-temple site counts (one query each, parallel) — to-unload +
  // in-stock + installed, so the picker shows where attention is needed.
  const counts = await Promise.all(
    list.map(async (t) => {
      const [{ count: stock }, { count: installed }, { data: delivered }] = await Promise.all([
        admin.from("slab_requirements").select("*", { count: "exact", head: true })
          .eq("temple", t.name).not("site_yard_id", "is", null).is("installed_at", null),
        admin.from("slab_requirements").select("*", { count: "exact", head: true })
          .eq("temple", t.name).not("installed_at", "is", null),
        admin.from("dispatches").select("id").eq("temple", t.name).not("delivered_at", "is", null).limit(400),
      ]);
      // To-unload: delivered dispatches with ≥1 un-yarded slab.
      let toUnload = 0;
      const dispIds = ((delivered ?? []) as Array<{ id: string }>).map((d) => d.id);
      if (dispIds.length > 0) {
        const { data: logs } = await admin.from("dispatch_logs").select("slab_requirement_id").in("dispatch_id", dispIds);
        const ids = [...new Set(((logs ?? []) as Array<{ slab_requirement_id: string | null }>).map((l) => l.slab_requirement_id).filter(Boolean) as string[])];
        if (ids.length > 0) {
          for (let i = 0; i < ids.length; i += 1000) {
            const { count } = await admin.from("slab_requirements").select("*", { count: "exact", head: true })
              .in("id", ids.slice(i, i + 1000)).is("site_yard_id", null).is("installed_at", null);
            toUnload += count ?? 0;
          }
        }
      }
      return { ...t, stock: stock ?? 0, installed: installed ?? 0, toUnload };
    }),
  );

  // Temples with any site activity float to the top.
  const sorted = counts.sort((a, b) =>
    (b.toUnload + b.stock) - (a.toUnload + a.stock) || a.name.localeCompare(b.name),
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, paddingBottom: 40 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 22 }}>🧱 Site / Installation</h1>
        <p className="muted" style={{ margin: "3px 0 0", fontSize: 13.5, maxWidth: 760 }}>
          Pick a temple site. Unload delivered trucks into yards, keep stock, and mark slabs installed.
          Trucks delivered from Dispatch land here for unloading.
        </p>
      </div>

      {sorted.length === 0 ? (
        <div className="banner">No active temples.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
          {sorted.map((t) => (
            <Link
              key={t.name}
              href={`/site/${encodeURIComponent(t.code_prefix)}`}
              style={{
                textDecoration: "none", color: "var(--text)",
                background: "var(--surface)", border: "1px solid var(--border)",
                borderLeft: `5px solid ${t.toUnload > 0 ? "#b45309" : "var(--gold-dark)"}`,
                borderRadius: 14, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12,
                transition: "transform .12s ease, box-shadow .12s ease",
              }}
            >
              <div style={{ fontSize: 17, fontWeight: 800, lineHeight: 1.2 }}>🏛 {t.name}</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {t.toUnload > 0 && (
                  <span style={{ fontSize: 12, fontWeight: 800, color: "#92400e", background: "rgba(180,83,9,0.12)", border: "1px solid rgba(180,83,9,0.35)", borderRadius: 999, padding: "3px 11px" }}>
                    🚚 {t.toUnload} to unload
                  </span>
                )}
                <span style={{ fontSize: 12, fontWeight: 700, color: "#0f766e", background: "rgba(15,118,110,0.1)", borderRadius: 999, padding: "3px 11px" }}>
                  📦 {t.stock} in stock
                </span>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#15803d", background: "rgba(22,163,74,0.1)", borderRadius: 999, padding: "3px 11px" }}>
                  ✅ {t.installed} installed
                </span>
              </div>
              <span style={{ fontSize: 13, fontWeight: 800, color: "var(--gold-dark)", marginTop: 2 }}>Open site →</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
