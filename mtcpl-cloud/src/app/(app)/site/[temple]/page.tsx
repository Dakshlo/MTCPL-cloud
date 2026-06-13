/**
 * 🏛 Site dashboard for one temple (mig 133).
 *
 * Navigation hub for the site incharge: trucks currently on the road to
 * this temple up top, big cards into the Stock Yard + Installation
 * portal, and at-a-glance counts.
 */

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { SITE_ROLES } from "../site-roles";
import { loadSiteData, resolveTemple } from "../site-lib";

export const dynamic = "force-dynamic";

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default async function SiteDashboardPage({ params }: { params: Promise<{ temple: string }> }) {
  const { profile } = await requireAuth();
  if (!SITE_ROLES.includes(profile.role)) redirect("/");
  const { temple: slug } = await params;
  const temple = await resolveTemple(slug);
  if (!temple) notFound();

  const data = await loadSiteData(temple);
  const base = `/site/${encodeURIComponent(slug)}`;

  const stat = (n: number, label: string, color: string) => (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 14px", flex: "1 1 120px", minWidth: 0 }}>
      <div style={{ fontSize: 26, fontWeight: 900, color, lineHeight: 1 }}>{n}</div>
      <div className="muted" style={{ fontSize: 12, fontWeight: 700, marginTop: 4 }}>{label}</div>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, paddingBottom: 40 }}>
      <div>
        <Link href="/site" style={{ fontSize: 13, fontWeight: 700, color: "var(--muted)", textDecoration: "none" }}>← All temples</Link>
        <h1 style={{ margin: "6px 0 0", fontSize: 22 }}>🏛 {temple}</h1>
        <p className="muted" style={{ margin: "2px 0 0", fontSize: 13.5 }}>Site & installation portal.</p>
      </div>

      {/* Quick stats */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {stat(data.counts.onRoad, "🚛 On the road", "#2563EB")}
        {stat(data.counts.toUnload, "🚚 To unload", "#b45309")}
        {stat(data.counts.stock, "📦 In stock", "#0f766e")}
        {stat(data.counts.installed, "✅ Installed", "#15803d")}
        {stat(data.counts.yards, "📍 Yards", "var(--gold-dark)")}
      </div>

      {/* On the road — heading here from Dispatch */}
      <div>
        <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 8 }}>🚛 On the road — coming to this temple</div>
        {data.onRoad.length === 0 ? (
          <div className="muted" style={{ fontSize: 13, padding: "14px 16px", background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: 12 }}>
            No trucks are currently on the way here.
          </div>
        ) : (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {data.onRoad.map((t) => (
              <div key={t.dispatchId} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderLeft: "5px solid #2563EB", borderRadius: 12, padding: "11px 14px", minWidth: 220 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 14 }}>🚛 {t.vehicleNo ?? "—"}</span>
                  {t.loadNumber != null && (
                    <span style={{ fontSize: 10.5, fontWeight: 800, color: "#2563EB", background: "rgba(37,99,235,0.1)", borderRadius: 999, padding: "2px 8px" }}>Load {t.loadNumber}</span>
                  )}
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
                  {t.driverName ?? "No driver"}{t.driverPhone ? ` · ${t.driverPhone}` : ""}
                </div>
                <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>
                  {t.slabCount} slab{t.slabCount === 1 ? "" : "s"} · left {fmtDateTime(t.whenAt)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Big nav cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
        <Link
          href={`${base}/stock`}
          style={{
            textDecoration: "none", color: "var(--text)", background: "var(--surface)",
            border: "1.5px solid var(--border)", borderRadius: 16, padding: "20px 22px",
            display: "flex", flexDirection: "column", gap: 8,
          }}
        >
          <div style={{ fontSize: 30 }}>🏗️</div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>Stock Yard</div>
          <div className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
            Unload delivered trucks into yards, browse stock by yard, transfer between yards.
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
            {data.counts.toUnload > 0 && (
              <span style={{ fontSize: 11.5, fontWeight: 800, color: "#92400e", background: "rgba(180,83,9,0.12)", borderRadius: 999, padding: "2px 10px" }}>🚚 {data.counts.toUnload} to unload</span>
            )}
            <span style={{ fontSize: 11.5, fontWeight: 700, color: "#0f766e", background: "rgba(15,118,110,0.1)", borderRadius: 999, padding: "2px 10px" }}>📦 {data.counts.stock} in stock</span>
          </div>
          <span style={{ fontSize: 13.5, fontWeight: 800, color: "var(--gold-dark)", marginTop: 4 }}>Open stock yard →</span>
        </Link>

        <Link
          href={`${base}/install`}
          style={{
            textDecoration: "none", color: "var(--text)", background: "var(--surface)",
            border: "1.5px solid var(--border)", borderRadius: 16, padding: "20px 22px",
            display: "flex", flexDirection: "column", gap: 8,
          }}
        >
          <div style={{ fontSize: 30 }}>🔨</div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>Installation Portal</div>
          <div className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
            Drag stock to Installed — add a note + photo as proof of installation.
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: "#0f766e", background: "rgba(15,118,110,0.1)", borderRadius: 999, padding: "2px 10px" }}>📦 {data.counts.stock} ready</span>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: "#15803d", background: "rgba(22,163,74,0.1)", borderRadius: 999, padding: "2px 10px" }}>✅ {data.counts.installed} installed</span>
          </div>
          <span style={{ fontSize: 13.5, fontWeight: 800, color: "var(--gold-dark)", marginTop: 4 }}>Open installation →</span>
        </Link>
      </div>
    </div>
  );
}
