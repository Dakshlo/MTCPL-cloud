// ──────────────────────────────────────────────────────────────────
// Migration 041 — Site switcher
// ──────────────────────────────────────────────────────────────────
// Horizontal "shop-tag" tabs at the top of the board / history pages.
// Each tag is one site (plant + every active project site). Active
// tag pulled forward with a copper underline. Tag shows site name +
// total component types it currently holds.
//
// Server-component friendly: no client state — the active site is
// picked via a query param (`?site=<id>`) and the links carry it.
// ──────────────────────────────────────────────────────────────────

import Link from "next/link";
import type { Site, StockMap } from "./stock";
import { INV_THEME } from "./theme";
import { stockKey } from "./stock";

export function SiteSwitcher({
  sites,
  components,
  stock,
  activeSiteId,
  hrefBase,
}: {
  sites: Site[];
  components: { id: string }[];
  stock: StockMap;
  activeSiteId: string;
  /** Where each tag links to (will append ?site=<id>). */
  hrefBase: string;
}) {
  // Sort: plant first, then active project sites alphabetically.
  const ordered = [...sites]
    .filter((s) => s.is_plant || s.is_active)
    .sort((a, b) => {
      if (a.is_plant && !b.is_plant) return -1;
      if (!a.is_plant && b.is_plant) return 1;
      return a.name.localeCompare(b.name);
    });

  function totalAtSite(siteId: string): number {
    let total = 0;
    for (const c of components) {
      const e = stock.get(stockKey(c.id, siteId));
      if (e) total += e.onHand;
    }
    return total;
  }

  return (
    <div
      style={{
        display: "flex",
        gap: 6,
        overflowX: "auto",
        paddingBottom: 4,
        marginBottom: 8,
      }}
    >
      {ordered.map((s) => {
        const active = s.id === activeSiteId;
        const qty = totalAtSite(s.id);
        return (
          <Link
            key={s.id}
            href={`${hrefBase}?site=${s.id}`}
            title={s.is_plant ? "The warehouse / yard" : (s.address ?? s.name)}
            style={{
              padding: "10px 16px 12px",
              minWidth: 130,
              textAlign: "center",
              textDecoration: "none",
              background: active ? INV_THEME.steel : INV_THEME.paper,
              color: active ? "#fff" : INV_THEME.steel,
              border: `1px solid ${active ? INV_THEME.steel : INV_THEME.parchment}`,
              borderRadius: 10,
              boxShadow: active
                ? "0 4px 0 rgba(44, 74, 94, 0.18)"
                : "0 1px 0 rgba(28, 52, 69, 0.04)",
              transform: active ? "translateY(-2px)" : "none",
              transition: "transform 0.15s ease, box-shadow 0.15s ease",
              whiteSpace: "nowrap",
              display: "inline-flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 2,
              position: "relative",
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                opacity: active ? 0.9 : 0.7,
              }}
            >
              {s.is_plant ? "Plant" : s.code}
            </span>
            <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.01em" }}>
              {s.name.replace(/^Plant.*$/, "Warehouse")}
            </span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                marginTop: 2,
                padding: "1px 8px",
                background: active ? "rgba(255,255,255,0.18)" : INV_THEME.cream,
                color: active ? "#fff" : INV_THEME.steelLight,
                borderRadius: 8,
                fontFamily: "ui-monospace, monospace",
                fontFeatureSettings: '"tnum"',
              }}
            >
              {qty.toLocaleString("en-IN")} pcs
            </span>
            {active && (
              <span
                style={{
                  position: "absolute",
                  bottom: -4,
                  left: "50%",
                  transform: "translateX(-50%)",
                  width: 24,
                  height: 4,
                  background: INV_THEME.copper,
                  borderRadius: 2,
                }}
              />
            )}
          </Link>
        );
      })}
    </div>
  );
}
