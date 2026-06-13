/**
 * 🏛 Site dashboard for one temple (mig 133).
 *
 * Navigation hub for the site incharge: an installation-progress hero,
 * tappable stat tiles, the trucks currently on the road to this temple,
 * and two big cards into the Stock Yard + Installation portal.
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

/** SVG progress ring — % of everything-at-site that's installed. */
function Ring({ pct, size = 96 }: { pct: number; size?: number }) {
  const stroke = 9;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const filled = (Math.max(0, Math.min(100, pct)) / 100) * c;
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: "block" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke="#fff" strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${filled} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className="site-ring"
        />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#fff" }}>
        <span style={{ fontSize: size * 0.3, fontWeight: 900, lineHeight: 1 }}>{pct}%</span>
        <span style={{ fontSize: 9.5, fontWeight: 700, opacity: 0.85, letterSpacing: "0.04em" }}>INSTALLED</span>
      </div>
    </div>
  );
}

export default async function SiteDashboardPage({ params }: { params: Promise<{ temple: string }> }) {
  const { profile } = await requireAuth();
  if (!SITE_ROLES.includes(profile.role)) redirect("/");
  const { temple: slug } = await params;
  const temple = await resolveTemple(slug);
  if (!temple) notFound();

  const data = await loadSiteData(temple);
  const base = `/site/${encodeURIComponent(slug)}`;
  const c = data.counts;
  const atSite = c.toUnload + c.stock + c.installed; // physically reached the temple
  const pct = atSite > 0 ? Math.round((c.installed / atSite) * 100) : 0;

  // Tappable stat tiles. `href` null = display-only.
  const tiles: Array<{ n: number; label: string; icon: string; color: string; href: string | null; alert?: boolean }> = [
    { n: c.onRoad, label: "On the road", icon: "🚛", color: "#2563EB", href: null },
    { n: c.toUnload, label: "To unload", icon: "🚚", color: "#b45309", href: `${base}/stock`, alert: c.toUnload > 0 },
    { n: c.stock, label: "In stock", icon: "📦", color: "#0f766e", href: `${base}/stock` },
    { n: c.installed, label: "Installed", icon: "✅", color: "#15803d", href: `${base}/install` },
    { n: c.yards, label: "Yards", icon: "📍", color: "#b87333", href: `${base}/stock` },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingBottom: 44 }}>
      <style>{`
        @keyframes siteIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
        @keyframes ringIn { from { stroke-dashoffset: 60; } to { stroke-dashoffset: 0; } }
        @keyframes barIn { from { transform: scaleX(0); } to { transform: scaleX(1); } }
        @keyframes softPulse { 0%,100% { box-shadow: 0 0 0 0 rgba(180,83,9,0.35); } 50% { box-shadow: 0 0 0 6px rgba(180,83,9,0); } }
        .s-anim { opacity: 0; animation: siteIn .4s cubic-bezier(.2,.7,.3,1) forwards; }
        .site-ring { stroke-dashoffset: 0; animation: ringIn .9s cubic-bezier(.2,.7,.3,1); }
        .s-tile { transition: transform .14s ease, box-shadow .14s ease, border-color .14s ease; text-decoration: none; }
        .s-tile.link:hover { transform: translateY(-3px); box-shadow: 0 10px 24px rgba(0,0,0,.1); }
        .s-alert { animation: softPulse 2.2s ease-in-out infinite; }
        .s-action { transition: transform .15s ease, box-shadow .15s ease, border-color .15s ease; text-decoration: none; }
        .s-action:hover { transform: translateY(-4px); box-shadow: 0 16px 36px rgba(0,0,0,.14); border-color: var(--gold-dark) !important; }
        .s-action:hover .s-go { transform: translateX(4px); }
        .s-go { display: inline-block; transition: transform .15s ease; }
        .s-bar { transform-origin: left; animation: barIn .8s cubic-bezier(.2,.7,.3,1); }
      `}</style>

      <Link href="/site" style={{ fontSize: 13, fontWeight: 700, color: "var(--muted)", textDecoration: "none" }}>← All temples</Link>

      {/* Hero */}
      <div
        className="s-anim"
        style={{
          background: "linear-gradient(135deg, #b87333 0%, #8a5022 100%)",
          borderRadius: 20, padding: "22px 24px", color: "#fff",
          display: "flex", alignItems: "center", gap: 22, flexWrap: "wrap",
          boxShadow: "0 14px 36px rgba(138,80,34,0.32)",
        }}
      >
        <Ring pct={pct} />
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.85, letterSpacing: "0.08em", textTransform: "uppercase" }}>Site &amp; Installation</div>
          <div style={{ fontSize: 25, fontWeight: 900, lineHeight: 1.15, marginTop: 2 }}>🏛 {temple}</div>
          <div style={{ marginTop: 12, height: 9, borderRadius: 999, background: "rgba(255,255,255,0.22)", overflow: "hidden", maxWidth: 420 }}>
            <div className="s-bar" style={{ width: `${pct}%`, height: "100%", background: "#fff", borderRadius: 999 }} />
          </div>
          <div style={{ marginTop: 10, fontSize: 14, fontWeight: 600, opacity: 0.95 }}>
            {atSite === 0
              ? "Nothing has reached the site yet — delivered trucks will appear here to unload."
              : <><strong style={{ fontSize: 16 }}>{c.installed}</strong> of <strong>{atSite}</strong> slabs at site installed{c.toUnload > 0 ? ` · ${c.toUnload} still to unload` : c.stock > 0 ? ` · ${c.stock} ready to install` : " · all done 🎉"}</>}
          </div>
        </div>
      </div>

      {/* Stat tiles */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
        {tiles.map((t, i) => {
          const inner = (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 30, fontWeight: 900, color: t.color, lineHeight: 1 }}>{t.n}</span>
                <span style={{ fontSize: 22, opacity: 0.9 }}>{t.icon}</span>
              </div>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--muted)", marginTop: 6 }}>{t.label}</div>
              {t.href && <div style={{ fontSize: 11, fontWeight: 800, color: t.color, marginTop: 6 }}>Open →</div>}
            </>
          );
          const style = {
            animationDelay: `${Math.min(i * 60, 320)}ms`,
            background: "var(--surface)", border: "1px solid var(--border)",
            borderTop: `4px solid ${t.color}`, borderRadius: 14, padding: "14px 16px",
            display: "block", color: "var(--text)",
            ...(t.alert ? { borderColor: "rgba(180,83,9,0.5)" } : {}),
          } as const;
          return t.href ? (
            <Link key={t.label} href={t.href} className={`s-anim s-tile link${t.alert ? " s-alert" : ""}`} style={style}>{inner}</Link>
          ) : (
            <div key={t.label} className="s-anim s-tile" style={style}>{inner}</div>
          );
        })}
      </div>

      {/* On the road */}
      <div className="s-anim" style={{ animationDelay: "180ms" }}>
        <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
          🚛 On the road — coming to this temple
          {c.onRoad > 0 && <span style={{ fontSize: 11.5, fontWeight: 800, color: "#fff", background: "#2563EB", borderRadius: 999, padding: "2px 10px" }}>{c.onRoad}</span>}
        </div>
        {data.onRoad.length === 0 ? (
          <div className="muted" style={{ fontSize: 13, padding: "16px 18px", background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: 14, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 18, opacity: 0.5 }}>🛣️</span> No trucks are on the way here right now.
          </div>
        ) : (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {data.onRoad.map((t) => (
              <div key={t.dispatchId} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderLeft: "5px solid #2563EB", borderRadius: 14, padding: "12px 15px", minWidth: 230 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 14.5 }}>🚛 {t.vehicleNo ?? "—"}</span>
                  {t.loadNumber != null && <span style={{ fontSize: 10.5, fontWeight: 800, color: "#2563EB", background: "rgba(37,99,235,0.1)", borderRadius: 999, padding: "2px 8px" }}>Load {t.loadNumber}</span>}
                </div>
                <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>{t.driverName ?? "No driver"}{t.driverPhone ? ` · ${t.driverPhone}` : ""}</div>
                <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>{t.slabCount} slab{t.slabCount === 1 ? "" : "s"} · left {fmtDateTime(t.whenAt)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Big action cards */}
      <div className="s-anim" style={{ animationDelay: "240ms", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
        <Link href={`${base}/stock`} className="s-action" style={{ background: "var(--surface)", border: "1.5px solid var(--border)", borderRadius: 18, overflow: "hidden", color: "var(--text)", display: "flex", flexDirection: "column" }}>
          <div style={{ background: "linear-gradient(135deg, rgba(15,118,110,0.16), rgba(15,118,110,0.04))", padding: "18px 22px", display: "flex", alignItems: "center", gap: 14 }}>
            <span style={{ fontSize: 34 }}>🏗️</span>
            <div>
              <div style={{ fontSize: 19, fontWeight: 900 }}>Stock Yard</div>
              <div style={{ fontSize: 12.5, color: "var(--muted)", fontWeight: 600 }}>Unload trucks · manage stock</div>
            </div>
          </div>
          <div style={{ padding: "16px 22px", display: "flex", flexDirection: "column", gap: 12, flex: 1 }}>
            <div className="muted" style={{ fontSize: 13.5, lineHeight: 1.55 }}>
              Unload delivered trucks into yards, browse stock yard-wise, and transfer slabs between yards.
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: "auto" }}>
              {c.toUnload > 0 && <span style={{ fontSize: 12, fontWeight: 800, color: "#92400e", background: "rgba(180,83,9,0.12)", borderRadius: 999, padding: "4px 12px" }}>🚚 {c.toUnload} to unload</span>}
              <span style={{ fontSize: 12, fontWeight: 700, color: "#0f766e", background: "rgba(15,118,110,0.1)", borderRadius: 999, padding: "4px 12px" }}>📦 {c.stock} in stock</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#b87333", background: "rgba(184,115,51,0.1)", borderRadius: 999, padding: "4px 12px" }}>📍 {c.yards} yard{c.yards === 1 ? "" : "s"}</span>
            </div>
            <div style={{ fontSize: 14, fontWeight: 800, color: "var(--gold-dark)" }}>Open stock yard <span className="s-go">→</span></div>
          </div>
        </Link>

        <Link href={`${base}/install`} className="s-action" style={{ background: "var(--surface)", border: "1.5px solid var(--border)", borderRadius: 18, overflow: "hidden", color: "var(--text)", display: "flex", flexDirection: "column" }}>
          <div style={{ background: "linear-gradient(135deg, rgba(22,163,74,0.16), rgba(22,163,74,0.04))", padding: "18px 22px", display: "flex", alignItems: "center", gap: 14 }}>
            <span style={{ fontSize: 34 }}>🔨</span>
            <div>
              <div style={{ fontSize: 19, fontWeight: 900 }}>Installation Portal</div>
              <div style={{ fontSize: 12.5, color: "var(--muted)", fontWeight: 600 }}>Drag stock → installed</div>
            </div>
          </div>
          <div style={{ padding: "16px 22px", display: "flex", flexDirection: "column", gap: 12, flex: 1 }}>
            <div className="muted" style={{ fontSize: 13.5, lineHeight: 1.55 }}>
              Drag a stock slab into Installed (or tap Install) — add a note + photo as proof of installation.
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: "auto" }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#0f766e", background: "rgba(15,118,110,0.1)", borderRadius: 999, padding: "4px 12px" }}>📦 {c.stock} ready</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#15803d", background: "rgba(22,163,74,0.1)", borderRadius: 999, padding: "4px 12px" }}>✅ {c.installed} installed</span>
            </div>
            <div style={{ fontSize: 14, fontWeight: 800, color: "var(--gold-dark)" }}>Open installation <span className="s-go">→</span></div>
          </div>
        </Link>
      </div>
    </div>
  );
}
