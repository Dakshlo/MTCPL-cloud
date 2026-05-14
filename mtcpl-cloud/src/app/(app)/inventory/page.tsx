import Link from "next/link";
import { requireAuth } from "@/lib/auth";

// Inventory module placeholder (Migration 036).
//
// V1 ships with the inventory department wired into the sidebar
// switcher but no actual inventory functionality yet — that's the
// V2 module that will track CNC tools, motors, scaffolding, etc.,
// likely linked back to bills via the `inventory_ref_token` stub
// column on `bills` (added in migration 028).
//
// This page exists so the switcher has somewhere to land, and so
// the per-department maintenance toggle has a real route to gate.
// Locked to developer + owner until there's a real module to show.
export default async function InventoryPlaceholderPage() {
  await requireAuth(["developer", "owner"]);

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "60px 24px" }}>
      <div
        style={{
          background: "var(--surface)",
          border: "1px dashed var(--border)",
          borderRadius: 16,
          padding: "40px 32px",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 48, marginBottom: 12 }}>📦</div>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>
          Inventory module — coming soon
        </h1>
        <p
          style={{
            margin: "12px auto 0",
            maxWidth: 540,
            fontSize: 14,
            lineHeight: 1.6,
            color: "var(--muted)",
          }}
        >
          The inventory department is reserved for the next module — tracking
          stock landings against the bills already in Finance (CNC tools,
          scaffolding, motors, etc.) and tying each receipt back to the
          purchase bill via a shared token. The placeholder is here so the
          department switcher and selective-maintenance toggles have somewhere
          to live; the real module ships in v2.
        </p>
        <div
          style={{
            marginTop: 24,
            display: "flex",
            gap: 10,
            justifyContent: "center",
            flexWrap: "wrap",
          }}
        >
          <Link
            href="/dashboard"
            style={{
              padding: "9px 18px",
              fontSize: 13,
              fontWeight: 700,
              background: "var(--gold)",
              color: "#fff",
              textDecoration: "none",
              borderRadius: 8,
              border: "1px solid var(--gold-dark)",
            }}
          >
            🏭 Back to Production
          </Link>
          <Link
            href="/accounts"
            style={{
              padding: "9px 18px",
              fontSize: 13,
              fontWeight: 700,
              background: "var(--bg)",
              color: "var(--text)",
              textDecoration: "none",
              borderRadius: 8,
              border: "1px solid var(--border)",
            }}
          >
            💼 Open Finance
          </Link>
        </div>
      </div>
    </div>
  );
}
