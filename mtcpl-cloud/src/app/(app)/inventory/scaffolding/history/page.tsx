// ──────────────────────────────────────────────────────────────────
// Migration 041 — Inventory history timeline
// ──────────────────────────────────────────────────────────────────
// Chronological feed of every movement (any status). Filterable by
// site + type + status via query params. Rendered as a vertical
// timeline so a quick scan tells you "what moved today" — different
// from finance's tabular ledger.
//
// Default: last 100 movements across all sites / types / statuses.
// ──────────────────────────────────────────────────────────────────

import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { canViewInventory } from "@/lib/inventory-permissions";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getProfilesMap } from "@/lib/profiles";
import { InventoryShell } from "../../_components/inventory-shell";
import { InventorySetupBanner } from "../../_components/setup-banner";
import { INV_THEME, secondaryButton } from "../../_components/theme";

const PG_UNDEFINED_TABLE = "42P01";
import {
  ComponentIcon,
  type ScaffoldingComponentType,
} from "../../_components/component-icon";
import type {
  MovementRow,
  ScaffoldingComponent,
  Site,
} from "../../_components/stock";

const STATUS_FILTERS = [
  { id: "all", label: "All" },
  { id: "pending_approval", label: "Pending" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
  { id: "cancelled", label: "Cancelled" },
];

const TYPE_FILTERS = [
  { id: "all", label: "All" },
  { id: "issue", label: "Issue" },
  { id: "return", label: "Return" },
  { id: "receive", label: "Receive" },
  { id: "writeoff", label: "Write-off" },
];

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; type?: string; site?: string }>;
}) {
  const { profile } = await requireAuth();
  if (!canViewInventory(profile)) {
    redirect("/dashboard");
  }

  const h = await headers();
  const pathname = h.get("x-pathname") ?? "/inventory/scaffolding/history";
  const sp = await searchParams;
  const statusFilter = sp.status ?? "all";
  const typeFilter = sp.type ?? "all";
  const siteFilter = sp.site ?? "all";

  const supabase = createAdminSupabaseClient();

  let q = supabase
    .from("inventory_movements")
    .select("*")
    .order("proposed_at", { ascending: false })
    .limit(200);
  if (statusFilter !== "all") q = q.eq("status", statusFilter);
  if (typeFilter !== "all") q = q.eq("movement_type", typeFilter);
  if (siteFilter !== "all") {
    q = q.or(`from_site_id.eq.${siteFilter},to_site_id.eq.${siteFilter}`);
  }

  const [movementsRes, sitesRes, componentsRes] = await Promise.all([
    q,
    supabase.from("sites").select("id, code, name, is_plant").order("name"),
    supabase.from("scaffolding_components").select("*"),
  ]);

  for (const [name, res] of [
    ["inventory_movements", movementsRes],
    ["sites", sitesRes],
    ["scaffolding_components", componentsRes],
  ] as const) {
    if (res.error?.code === PG_UNDEFINED_TABLE) {
      return (
        <InventoryShell title="History" pathname={pathname}>
          <InventorySetupBanner missing={name} />
        </InventoryShell>
      );
    }
  }

  const movements = ((movementsRes.data ?? []) as unknown) as MovementRow[];
  const sites = ((sitesRes.data ?? []) as unknown) as Pick<
    Site,
    "id" | "code" | "name" | "is_plant"
  >[];
  const components = ((componentsRes.data ?? []) as unknown) as ScaffoldingComponent[];
  const profilesMap = await getProfilesMap();

  const siteById = new Map(sites.map((s) => [s.id, s]));
  const componentById = new Map(components.map((c) => [c.id, c]));

  // Group by batch_id for timeline rendering — each batch is one
  // entry, items shown as a sub-list. Preserves chronological order.
  type Group = {
    batch_id: string;
    rows: MovementRow[];
    proposed_at: string;
    proposed_by: string;
    movement_type: MovementRow["movement_type"];
    status: MovementRow["status"];
    from_site_id: string | null;
    to_site_id: string | null;
    batch_note: string | null;
    approved_at: string | null;
    approved_by: string | null;
    rejected_at: string | null;
    rejected_by: string | null;
    rejection_note: string | null;
    cancelled_at: string | null;
    cancelled_by: string | null;
    cancel_reason: string | null;
  };
  const groups: Group[] = [];
  const byBatch = new Map<string, Group>();
  for (const m of movements) {
    if (!byBatch.has(m.batch_id)) {
      const g: Group = {
        batch_id: m.batch_id,
        rows: [],
        proposed_at: m.proposed_at,
        proposed_by: m.proposed_by,
        movement_type: m.movement_type,
        status: m.status,
        from_site_id: m.from_site_id,
        to_site_id: m.to_site_id,
        batch_note: m.batch_note,
        approved_at: m.approved_at,
        approved_by: m.approved_by,
        rejected_at: m.rejected_at,
        rejected_by: m.rejected_by,
        rejection_note: m.rejection_note,
        cancelled_at: m.cancelled_at,
        cancelled_by: m.cancelled_by,
        cancel_reason: m.cancel_reason,
      };
      byBatch.set(m.batch_id, g);
      groups.push(g);
    }
    byBatch.get(m.batch_id)!.rows.push(m);
  }

  function siteLabel(id: string | null): string {
    if (!id) return "—";
    const s = siteById.get(id);
    if (!s) return "?";
    return s.is_plant ? "Plant" : s.name;
  }

  function chip(active: boolean, href: string, label: string) {
    return (
      <Link
        href={href}
        style={{
          padding: "4px 12px",
          fontSize: 11,
          fontWeight: 700,
          textDecoration: "none",
          background: active ? INV_THEME.steel : INV_THEME.cream,
          color: active ? "#fff" : INV_THEME.steel,
          border: `1px solid ${active ? INV_THEME.steel : INV_THEME.parchment}`,
          borderRadius: 6,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </Link>
    );
  }

  function buildHref(overrides: Record<string, string>): string {
    const params = new URLSearchParams();
    const merged = {
      status: statusFilter,
      type: typeFilter,
      site: siteFilter,
      ...overrides,
    };
    for (const [k, v] of Object.entries(merged)) {
      if (v && v !== "all") params.set(k, v);
    }
    const qs = params.toString();
    return qs ? `/inventory/scaffolding/history?${qs}` : "/inventory/scaffolding/history";
  }

  return (
    <InventoryShell
      title="History"
      subtitle={`${groups.length} batch${groups.length === 1 ? "" : "es"} · most recent first`}
      pathname={pathname}
    >
      {/* Filters */}
      <div
        style={{
          background: INV_THEME.paper,
          border: `1px solid ${INV_THEME.parchment}`,
          borderRadius: 10,
          padding: 12,
          marginBottom: 14,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <FilterRow label="Status">
          {STATUS_FILTERS.map((f) =>
            chip(statusFilter === f.id, buildHref({ status: f.id }), f.label),
          )}
        </FilterRow>
        <FilterRow label="Type">
          {TYPE_FILTERS.map((f) =>
            chip(typeFilter === f.id, buildHref({ type: f.id }), f.label),
          )}
        </FilterRow>
        <FilterRow label="Site">
          {chip(siteFilter === "all", buildHref({ site: "all" }), "All")}
          {sites.map((s) =>
            chip(
              siteFilter === s.id,
              buildHref({ site: s.id }),
              s.is_plant ? "Plant" : s.name,
            ),
          )}
        </FilterRow>
      </div>

      {/* Timeline */}
      {groups.length === 0 ? (
        <div
          style={{
            background: INV_THEME.paper,
            border: `1px dashed ${INV_THEME.parchment}`,
            borderRadius: 12,
            padding: 32,
            textAlign: "center",
            color: INV_THEME.steelLight,
          }}
        >
          No movements match these filters.
        </div>
      ) : (
        <ol
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "flex",
            flexDirection: "column",
            gap: 12,
            position: "relative",
          }}
        >
          {groups.map((g) => {
            const totalQty = g.rows.reduce((s, r) => s + Number(r.qty ?? 0), 0);
            const statusColor =
              g.status === "approved"
                ? INV_THEME.stockHealthy
                : g.status === "rejected"
                  ? INV_THEME.stockOut
                  : g.status === "pending_approval"
                    ? INV_THEME.pending
                    : INV_THEME.cancelled;
            return (
              <li
                key={g.batch_id}
                style={{
                  background: INV_THEME.paper,
                  border: `1px solid ${INV_THEME.parchment}`,
                  borderLeft: `4px solid ${statusColor}`,
                  borderRadius: 10,
                  padding: 14,
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                        alignItems: "center",
                        fontSize: 12,
                        fontWeight: 800,
                        color: INV_THEME.steel,
                      }}
                    >
                      <span
                        style={{
                          padding: "3px 8px",
                          fontSize: 10,
                          fontWeight: 800,
                          background: INV_THEME.steel,
                          color: "#fff",
                          borderRadius: 4,
                          textTransform: "uppercase",
                          letterSpacing: "0.08em",
                        }}
                      >
                        {g.movement_type}
                      </span>
                      <span
                        style={{
                          padding: "3px 8px",
                          fontSize: 10,
                          fontWeight: 800,
                          background: statusColor,
                          color: "#fff",
                          borderRadius: 4,
                          textTransform: "uppercase",
                          letterSpacing: "0.08em",
                        }}
                      >
                        {g.status.replace("_", " ")}
                      </span>
                      {siteLabel(g.from_site_id)} → {siteLabel(g.to_site_id)}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: INV_THEME.steelLight,
                        marginTop: 4,
                        display: "flex",
                        gap: 8,
                        flexWrap: "wrap",
                      }}
                    >
                      <span>
                        Proposed{" "}
                        {new Date(g.proposed_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata",
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}{" "}
                        by {profilesMap[g.proposed_by] ?? "(unknown)"}
                      </span>
                      <span>•</span>
                      <span>
                        {g.rows.length} item{g.rows.length === 1 ? "" : "s"} ·{" "}
                        {totalQty.toLocaleString("en-IN")} pcs
                      </span>
                    </div>
                    {g.batch_note && (
                      <div
                        style={{
                          fontSize: 11,
                          color: INV_THEME.steel,
                          background: INV_THEME.cream,
                          padding: "4px 8px",
                          borderRadius: 4,
                          marginTop: 4,
                          fontStyle: "italic",
                        }}
                      >
                        📝 {g.batch_note}
                      </div>
                    )}
                    {g.rejection_note && (
                      <div
                        style={{
                          fontSize: 11,
                          color: INV_THEME.stockOut,
                          background: "rgba(193, 68, 46, 0.08)",
                          padding: "4px 8px",
                          borderRadius: 4,
                          marginTop: 4,
                        }}
                      >
                        Sent back:{" "}
                        {g.rejected_by && profilesMap[g.rejected_by]
                          ? `${profilesMap[g.rejected_by]} — `
                          : ""}
                        {g.rejection_note}
                      </div>
                    )}
                  </div>
                </div>

                {/* Items inline */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))",
                    gap: 6,
                  }}
                >
                  {g.rows.map((r) => {
                    const c = componentById.get(r.component_id);
                    const typeKey = (c?.component_type ?? "other") as ScaffoldingComponentType;
                    return (
                      <div
                        key={r.id}
                        style={{
                          display: "flex",
                          gap: 8,
                          alignItems: "center",
                          padding: "6px 8px",
                          background: INV_THEME.cream,
                          border: `1px solid ${INV_THEME.parchment}`,
                          borderRadius: 6,
                        }}
                      >
                        <span style={{ color: INV_THEME.steel }}>
                          <ComponentIcon
                            type={typeKey}
                            size={22}
                            imageDataUrl={c?.image_data_url ?? undefined}
                          />
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: 11,
                              fontWeight: 700,
                              color: INV_THEME.steel,
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {c?.name ?? "(removed)"}
                          </div>
                          <div
                            style={{
                              fontSize: 12,
                              fontWeight: 800,
                              color: INV_THEME.steel,
                              fontFeatureSettings: '"tnum"',
                            }}
                          >
                            {/* Mig 083 — round to whole pieces; legacy
                                fractional values stay in the DB but
                                display as integers. */}
                            {Math.round(Number(r.qty)).toLocaleString("en-IN")}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {movements.length === 200 && (
        <div
          style={{
            marginTop: 12,
            padding: "10px 14px",
            background: INV_THEME.cream,
            border: `1px solid ${INV_THEME.parchment}`,
            borderRadius: 8,
            fontSize: 12,
            color: INV_THEME.steelLight,
            textAlign: "center",
          }}
        >
          Showing the most recent 200 movements. Narrow the filters to see
          older history.
        </div>
      )}
    </InventoryShell>
  );
}

function FilterRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <span
        style={{
          fontSize: 10,
          fontWeight: 800,
          color: INV_THEME.steelLight,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          minWidth: 40,
        }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}
