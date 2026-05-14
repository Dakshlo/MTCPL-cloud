// ──────────────────────────────────────────────────────────────────
// Migration 041 — "Tables missing, run the migration" banner.
// ──────────────────────────────────────────────────────────────────
// Rendered by every inventory page when loadInventorySnapshotOrSetup
// returns kind="needs_migration". Gives the developer / owner a
// clear next step instead of dumping them into the generic error
// boundary.
// ──────────────────────────────────────────────────────────────────

import { INV_THEME } from "./theme";

export function InventorySetupBanner({ missing }: { missing: string }) {
  return (
    <div
      style={{
        background: INV_THEME.paper,
        border: `1.5px dashed ${INV_THEME.copper}`,
        borderRadius: 12,
        padding: 24,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <span
          style={{
            fontSize: 32,
            lineHeight: 1,
          }}
          aria-hidden="true"
        >
          🛠
        </span>
        <div>
          <h2
            style={{
              margin: 0,
              fontSize: 18,
              fontWeight: 800,
              color: INV_THEME.steel,
            }}
          >
            Inventory module isn&rsquo;t set up on this database yet
          </h2>
          <p
            style={{
              margin: "4px 0 0",
              fontSize: 13,
              color: INV_THEME.steelLight,
              lineHeight: 1.5,
            }}
          >
            The <code>{missing}</code> table doesn&rsquo;t exist. Run migration{" "}
            <strong>041_inventory_scaffolding.sql</strong> in the Supabase SQL
            editor, then reload this page.
          </p>
        </div>
      </div>

      <ol
        style={{
          margin: 0,
          paddingLeft: 22,
          fontSize: 13,
          lineHeight: 1.6,
          color: INV_THEME.steel,
        }}
      >
        <li>
          Open Supabase &rarr; SQL Editor and paste this <em>first</em>{" "}
          (it has to run outside a transaction):
        </li>
        <CodeBlock>
{`ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'storekeeper';`}
        </CodeBlock>
        <li>
          Then paste the rest of{" "}
          <code>supabase/migrations/041_inventory_scaffolding.sql</code>{" "}
          (the <code>BEGIN&nbsp;&hellip;&nbsp;COMMIT</code> block) in a new
          SQL editor tab and run it.
        </li>
        <li>
          The migration seeds one <code>PLANT</code> site row and 18 default
          scaffolding components, so the board has something to render right
          away.
        </li>
      </ol>

      <p
        style={{
          margin: 0,
          fontSize: 12,
          color: INV_THEME.steelLight,
        }}
      >
        Production and Finance are unaffected by this — they live in
        different tables.
      </p>
    </div>
  );
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  return (
    <pre
      style={{
        margin: "6px 0 6px",
        padding: "10px 12px",
        background: INV_THEME.cream,
        border: `1px solid ${INV_THEME.parchment}`,
        borderRadius: 6,
        fontSize: 12,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        color: INV_THEME.steel,
        whiteSpace: "pre-wrap",
        overflowX: "auto",
      }}
    >
      <code>{children}</code>
    </pre>
  );
}
