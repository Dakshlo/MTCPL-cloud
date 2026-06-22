import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { addTempleAction, updateTempleAction, deleteTempleAction, updateUserAction, deleteUserAction, updateOwnNameAction, addStoneTypeAction, deleteStoneTypeAction, setStoneCategoryAction, addTransferTruckAction, setTransferTruckActiveAction } from "./actions";
import {
  takeSystemDownAction,
  bringSystemUpAction,
} from "./system-status-actions";
import { stoneDisplayName } from "@/lib/stone-utils";
import type { AppRole } from "@/lib/types";
import { AutoBackup } from "@/components/auto-backup";
import { PeekSection } from "@/components/peek-section";
import { getSystemStatus, getDepartmentStatus } from "@/lib/system-status";
import { getProfilesMap } from "@/lib/profiles";
import { SystemStatusSection } from "./system-status-section";
import { MaintenanceCollapsible } from "./maintenance-collapsible";
import { UserRoleVendorPicker } from "./user-role-vendor-picker";
import { WaRecipientsEditor } from "./wa-recipients-editor";
import { getReportRecipientNumbers } from "@/lib/wa-recipients";
import { WaVendorCcEditor } from "./wa-vendor-cc-editor";
import { getVendorCcSetting } from "@/lib/wa-vendor-cc";
import { WaAlertsEditor } from "./wa-alerts-editor";
import { getSlabTransferAlert, getCarvingBacklog } from "@/lib/wa-alerts";

// All assignable roles — only shown to developer.
//
// Mig 037 housekeeping:
//   • biller — dropped from this picker (accountant now does bill entry).
//     The role stays valid in the AppRole enum so any existing
//     biller-role profile keeps working; we just stop minting new ones.
//   • crosscheck — added as the new bill-verification role.
//   • accountant — present below for completeness; was already valid
//     since Mig 028. Mig 037 broadens what accountant can do.
const UI_ROLES_ALL = [
  { value: "developer",        label: "DEVELOPER" },
  { value: "owner",            label: "OWNER" },
  // Mig 076 — senior_incharge listed BETWEEN owner and team_head so
  // the visual hierarchy in the role picker matches the actual
  // authority chain (Rajesh sits a tier above the regular team_head).
  { value: "senior_incharge",  label: "SENIOR INCHARGE ★" },
  { value: "team_head",        label: "TEAM HEAD" },
  { value: "carving_head",     label: "CARVING HEAD" },
  // Mig 104 — Tender Manager (owns the Register department).
  { value: "tender_manager",   label: "TENDER MANAGER" },
  { value: "block_slab_entry", label: "BLOCK+SLAB ENTRY" },
  { value: "slab_entry",       label: "SLAB ENTRY" },
  { value: "block_entry",      label: "BLOCK ENTRY" },
  { value: "cutting_operator", label: "CUTTING OPERATOR" },
  { value: "vendor",           label: "CNC OPERATOR" },
  { value: "slab_transfer",    label: "SLAB TRANSFER" },
  { value: "accountant",       label: "ACCOUNTANT" },
  // Mig 076 round 2 — Daksh renamed the display label to MANAGER.
  // DB enum stays 'crosscheck' so existing rows + audit history don't
  // need a backfill.
  { value: "crosscheck",       label: "MANAGER" },
  // Mig 053 — was `final_auditor`. Has full accountant powers PLUS
  // owner backup for confirming proposed payments + approving bills.
  // Primary daily duty is the /accounts/final-audit page.
  // Mig 058 — display as "ACCOUNTANT ★".
  // Mig 061 — DB enum renamed from `final_auditor` to `accountant_star`.
  { value: "accountant_star",    label: "ACCOUNTANT ★" },
  // Mig 054 — CNC operational expense entry. Mig 060 widened to
  // cutter expenses too, so the display label is just "EXPENSES
  // ENTRY" now (DB enum stays `cnc_expense_entry`).
  { value: "cnc_expense_entry", label: "EXPENSES ENTRY" },
  // Wall-display kiosk role — lands on the carving floor TV view only.
  { value: "tv",               label: "TV DISPLAY" },
];

// Roles owner/team-head can assign — cannot promote to owner or developer.
// Mig 076 — owner can also assign senior_incharge (Rajesh-tier).
const UI_ROLES_PLANNER = [
  { value: "senior_incharge",  label: "SENIOR INCHARGE ★" },
  { value: "team_head",        label: "TEAM HEAD" },
  { value: "carving_head",     label: "CARVING HEAD" },
  { value: "tender_manager",   label: "TENDER MANAGER" },
  { value: "block_slab_entry", label: "BLOCK+SLAB ENTRY" },
  { value: "slab_entry",       label: "SLAB ENTRY" },
  { value: "block_entry",      label: "BLOCK ENTRY" },
  { value: "cutting_operator", label: "CUTTING OPERATOR" },
  { value: "vendor",           label: "CNC OPERATOR" },
  { value: "slab_transfer",    label: "SLAB TRANSFER" },
  { value: "tv",               label: "TV DISPLAY" },
];

// Legacy — kept for roleLabel lookup
const UI_ROLES = UI_ROLES_ALL;

const ROLE_ACCESS: Record<string, string[]> = {
  developer:        ["Dashboard", "Blocks", "Slabs", "Plan Generator", "Cutting", "Settings"],
  owner:            ["Dashboard", "Blocks", "Slabs", "Plan Generator", "Cutting", "Settings"],
  team_head:        ["Blocks", "Slabs", "Plan Generator", "Cutting", "Settings"],
  // Mig 076 — Senior Incharge = team_head's surfaces PLUS the full
  // carving stack (Ready Sizes Stock, Carving Jobs, Carving Done
  // Approval) AND read-only Global My Jobs.
  senior_incharge:  ["Blocks", "Slabs", "Plan Generator", "Cutting", "Ready Sizes Stock", "Carving Jobs", "Carving Done Approval", "My Jobs (read-only)", "Activity Register", "Settings"],
  carving_head:     ["Ready Sizes", "Carving Jobs", "Slab Transfer", "Dispatch", "My Jobs (read-only)", "Activity Register"],
  // Mig 104 — Tender Manager owns the Register department.
  tender_manager:   ["Activity Register"],
  block_slab_entry: ["Dashboard", "Blocks", "Slabs"],
  slab_entry:       ["Dashboard", "Slabs"],
  block_entry:      ["Blocks"],
  cutting_operator: ["Cutting"],
  carving_assigner: ["Dashboard"],
  dispatch:         ["Dashboard"],
  vendor:           ["My Jobs"],
  slab_transfer:    ["Slab Transfer"],
  tv:               ["Carving Floor (wall)"],
  // Mig 037 — crosscheck verifies pending bills. Mig 061 follow-on
  // (Daksh): also gets read-access to Vendor Account so they can
  // verify a vendor's GSTIN / bank / address while reviewing a bill.
  crosscheck:       ["All Bills", "Crosscheck Queue", "Vendor Account"],
  // Mig 053 — accountant_star (the starred accountant, was
  // `final_auditor` until mig 061 renamed) sees the full finance
  // toolbox.
  accountant_star:  ["All Bills", "Crosscheck Queue", "Due Bills", "Pay Today", "Final Audit", "Payment History", "Vendor Account"],
  // Mig 054 — CNC expense entry role. Single-page portal — only
  // sees the CNC Expenses entry page under the Carving section.
  cnc_expense_entry: ["CNC Expenses"],
};

function roleLabel(role: string): string {
  return UI_ROLES.find(r => r.value === role)?.label ?? role.replace(/_/g, " ").toUpperCase();
}

function formatDate(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });
}

function fmtAuditDate(iso: string) {
  const tz = "Asia/Kolkata";
  const d = new Date(iso);
  const now = new Date();
  const yest = new Date(now.getTime() - 86400000);
  // Compare calendar dates in IST, not UTC
  const fmt = (dt: Date) => dt.toLocaleDateString("en-CA", { timeZone: tz }); // YYYY-MM-DD
  const timeStr = d.toLocaleTimeString("en-IN", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
  if (fmt(d) === fmt(now)) return timeStr;
  if (fmt(d) === fmt(yest)) return "Yesterday, " + timeStr;
  return d.toLocaleDateString("en-IN", { timeZone: tz, day: "numeric", month: "short" }) + ", " + timeStr;
}

export default async function SettingsPage() {
  const { profile: currentUser } = await requireAuth(["owner", "team_head", "senior_incharge", "developer"]);
  const admin = createAdminSupabaseClient();

  // Daily WhatsApp report recipients (owner/developer manage these below).
  const canManageWaReport = currentUser.role === "owner" || currentUser.role === "developer";
  const waReportRecipients = canManageWaReport ? await getReportRecipientNumbers() : [];

  // Vendor-message carbon-copy (developer only).
  const canManageVendorCc = currentUser.role === "developer";
  const vendorCc = canManageVendorCc ? await getVendorCcSetting() : null;

  // WhatsApp operational alerts — slab-transfer ping + carving backlog
  // (developer only).
  const canManageWaAlerts = currentUser.role === "developer";
  const [slabTransferAlert, carvingBacklog] = canManageWaAlerts
    ? await Promise.all([getSlabTransferAlert(), getCarvingBacklog()])
    : [null, null];

  // Last 5 paid payments — fuel the developer "send test" in the CC card.
  const recentPaidForTest: { id: string; label: string }[] = [];
  if (canManageVendorCc) {
    const { data: rp } = await admin
      .from("bill_payments")
      .select("id, paid_amount, paid_at, bills(token, bill_vendors(name))")
      .eq("status", "paid")
      .order("paid_at", { ascending: false })
      .limit(5);
    for (const row of (rp ?? []) as unknown[]) {
      const r = row as { id: string; paid_amount: number | null; paid_at: string | null; bills: unknown };
      const bill = (Array.isArray(r.bills) ? r.bills[0] : r.bills) as { token?: string; bill_vendors?: unknown } | null;
      const vend = (Array.isArray(bill?.bill_vendors) ? bill?.bill_vendors[0] : bill?.bill_vendors) as { name?: string } | null;
      const d = r.paid_at ? new Date(r.paid_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "";
      recentPaidForTest.push({
        id: r.id,
        label: `${bill?.token ?? "?"} · ${vend?.name ?? "Vendor"} · ₹${Number(r.paid_amount || 0).toLocaleString("en-IN")} · ${d}`,
      });
    }
  }

  // System Status — load global + per-department flags (Migration 036).
  // Each falls back to `down: false` if the relevant migration hasn't
  // run, so the page renders normally even on a fresh deploy.
  const [systemStatus, productionStatus, financeStatus, invoicingStatus, inventoryStatus] = await Promise.all([
    getSystemStatus(),
    getDepartmentStatus("production"),
    getDepartmentStatus("finance"),
    getDepartmentStatus("invoicing"),
    getDepartmentStatus("inventory"),
  ]);
  // Build a single lookup for updated_by → display name across all
  // five rows. Cheaper than five parallel single-row lookups.
  const profilesMapForSystem: Record<string, string> = await (async () => {
    const ids = new Set<string>(
      [systemStatus, productionStatus, financeStatus, invoicingStatus, inventoryStatus]
        .map((s) => s.updatedBy)
        .filter((v): v is string => Boolean(v)),
    );
    if (ids.size === 0) return {};
    try {
      return await getProfilesMap();
    } catch {
      return {};
    }
  })();
  const systemUpdatedByName = systemStatus.updatedBy
    ? profilesMapForSystem[systemStatus.updatedBy] ?? null
    : null;
  const productionUpdatedByName = productionStatus.updatedBy
    ? profilesMapForSystem[productionStatus.updatedBy] ?? null
    : null;
  const financeUpdatedByName = financeStatus.updatedBy
    ? profilesMapForSystem[financeStatus.updatedBy] ?? null
    : null;
  const invoicingUpdatedByName = invoicingStatus.updatedBy
    ? profilesMapForSystem[invoicingStatus.updatedBy] ?? null
    : null;
  const inventoryUpdatedByName = inventoryStatus.updatedBy
    ? profilesMapForSystem[inventoryStatus.updatedBy] ?? null
    : null;

  // Screen time — developer only
  const istNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const todayIST = `${istNow.getFullYear()}-${String(istNow.getMonth() + 1).padStart(2, "0")}-${String(istNow.getDate()).padStart(2, "0")}`;
  const todayStart = new Date(`${todayIST}T00:00:00+05:30`).toISOString();
  const todayEnd = new Date(`${todayIST}T23:59:59.999+05:30`).toISOString();

  const [{ data: temples }, { data: users }, { data: stoneTypes }, { data: blockStones }, { data: slabStones }, { data: templeSlabCounts }, { data: vendorRows }, { data: partyRows }] = await Promise.all([
    admin.from("temples").select("*").order("name"),
    // Admin client needed — RLS on profiles only returns the current user's own row.
    // vendor_id pulled so the row's vendor-picker can show the current binding.
    admin.from("profiles").select("id, full_name, phone, role, is_active, created_at, vendor_id, idle_logout_minutes").order("full_name"),
    admin.from("stone_types").select("id, name, color_top, color_front, color_side, is_active, sort_order, stone_category").order("sort_order").order("name"),
    // Usage counts for stone types
    admin.from("blocks").select("stone"),
    admin.from("slab_requirements").select("stone, temple"),
    admin.from("slab_requirements").select("temple"),
    // Daksh May 2026 — carving vendors for the per-user vendor
    // picker. Both CNC and Manual qualify (Mohit is CNC; lathe-only
    // vendors fall under Manual). is_active=true so the dropdown
    // doesn't list archived rows.
    admin
      .from("vendors")
      .select("id, name, vendor_type, is_active")
      .eq("is_active", true)
      .in("vendor_type", ["CNC", "Outsource"])
      .order("name"),
    // Mig 154 — invoice parties for the temple→customer billing map.
    // A temple's invoice_party_id decides which customer the auto
    // dispatch→invoicing challan bills to.
    admin.from("invoice_parties").select("id, name").order("name"),
  ]);
  const partyList = (partyRows ?? []) as Array<{ id: string; name: string }>;
  const vendorList = (vendorRows ?? []) as Array<{
    id: string;
    name: string;
    vendor_type: "CNC" | "Outsource";
    is_active: boolean;
  }>;
  const stoneList = stoneTypes ?? [];
  const userList = users ?? [];
  // Deactivated ("removed") users are hidden from the main list and tucked
  // into a collapsed "Inactive" disclosure (still reactivatable). userList
  // stays full — it's used elsewhere (e.g. live-users name lookup).
  const activeUsers = userList.filter((u) => u.is_active);
  const inactiveUsers = userList.filter((u) => !u.is_active);

  // Pre-compute usage counts so delete guards are visible in UI
  const blockStoneCount = (blockStones ?? []).reduce<Record<string, number>>((acc, b) => {
    if (b.stone) acc[b.stone] = (acc[b.stone] ?? 0) + 1;
    return acc;
  }, {});
  const slabStoneCount = (slabStones ?? []).reduce<Record<string, number>>((acc, s) => {
    if (s.stone) acc[s.stone] = (acc[s.stone] ?? 0) + 1;
    return acc;
  }, {});
  const templeSlabCount = (templeSlabCounts ?? []).reduce<Record<string, number>>((acc, s) => {
    if (s.temple) acc[s.temple] = (acc[s.temple] ?? 0) + 1;
    return acc;
  }, {});

  // Screen time data (developer + owner)
  let screenTimeData: Array<{ name: string; role: string; minutes: number; lastSeen: string | null }> = [];
  if (currentUser.role === "developer" || currentUser.role === "owner") {
    const res = await admin
      .from("heartbeat_log")
      .select("user_id, created_at")
      .gte("created_at", todayStart)
      .lte("created_at", todayEnd);
    const pings = res.error ? null : res.data;

    if (pings && pings.length > 0) {
      const pingsByUser = new Map<string, string[]>();
      for (const p of pings) {
        const list = pingsByUser.get(p.user_id) ?? [];
        list.push(p.created_at);
        pingsByUser.set(p.user_id, list);
      }

      screenTimeData = [...pingsByUser.entries()].map(([uid, timestamps]) => {
        const user = userList.find(u => u.id === uid);
        // Each ping ≈ 2 minutes of activity
        const minutes = timestamps.length * 2;
        const sorted = timestamps.sort();
        const lastSeen = sorted[sorted.length - 1] ?? null;
        return {
          name: user?.full_name || user?.phone || "Unknown",
          role: user?.role ?? "unknown",
          minutes,
          lastSeen,
        };
      }).sort((a, b) => b.minutes - a.minutes);
    }
  }

  // Admin client needed — profiles join in audit log returns null names for non-self users under RLS
  const { data: recentAudit } = await admin
    .from("audit_logs")
    .select("id, action, entity_type, entity_id, created_at, profiles(full_name)")
    .order("created_at", { ascending: false })
    .limit(50);

  // Live Users (developer only) — who is on which page right now.
  // Pulls last_seen_at + last_path from profiles. last_path is set
  // by the heartbeat ping every 2 min (or on tab focus / soft nav)
  // — see /api/heartbeat. Anyone seen within 5 min is treated as
  // "online now".
  type LiveUserRow = {
    id: string;
    full_name: string | null;
    role: string;
    last_seen_at: string | null;
    last_path: string | null;
    // Mig 046 — login-location columns. Always nullable; populated by
    // the LoginLocationProbe client component.
    last_login_at: string | null;
    last_login_ip: string | null;
    last_login_city: string | null;
    last_login_region: string | null;
    last_login_country: string | null;
    last_login_gps_lat: number | null;
    last_login_gps_lng: number | null;
    last_login_gps_accuracy_m: number | null;
    last_login_gps_status: string | null;
  };
  let liveUsers: LiveUserRow[] = [];
  if (currentUser.role === "developer" || currentUser.role === "owner") {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data } = await admin
      .from("profiles")
      .select(
        "id, full_name, role, last_seen_at, last_path, last_login_at, last_login_ip, last_login_city, last_login_region, last_login_country, last_login_gps_lat, last_login_gps_lng, last_login_gps_accuracy_m, last_login_gps_status",
      )
      .gte("last_seen_at", fiveMinAgo)
      .order("last_seen_at", { ascending: false })
      .limit(50);
    liveUsers = (data ?? []) as LiveUserRow[];
  }

  // Friendly label for the most common pathnames so the table
  // reads as "Cutting" instead of "/cutting". Falls back to the
  // raw path for routes not in the map.
  function pathLabel(path: string | null): string {
    if (!path) return "—";
    const map: Record<string, string> = {
      "/dashboard": "Dashboard",
      "/blocks": "Blocks Inventory",
      "/blocks/report": "Block Report",
      "/slabs": "Required Sizes",
      "/slabs/view": "Slab View",
      "/slabs/ready": "Ready Sizes",
      "/planning": "Plan Generator",
      "/planning/weekly": "Weekly Plan",
      "/cutting": "Cutting",
      "/dispatch": "Dispatch",
      "/carving": "Carving",
      "/carving-assign": "Carving Assign",
      "/block-journey": "Block Journey",
      "/settings": "Settings",
      "/users": "Users",
      "/vendors": "Vendors",
      "/audit": "Audit Log",
      "/my-jobs": "My Jobs",
      "/approval": "Approval Queue",
    };
    if (map[path]) return map[path];
    // /cutting/<id> → "Cutting › <id>"
    if (path.startsWith("/cutting/")) return `Cutting › ${path.slice("/cutting/".length, "/cutting/".length + 24)}`;
    if (path.startsWith("/blocks/")) return `Blocks › ${path.slice("/blocks/".length, "/blocks/".length + 24)}`;
    if (path.startsWith("/slabs/")) return `Slabs › ${path.slice("/slabs/".length, "/slabs/".length + 24)}`;
    return path;
  }

  const templeList = temples ?? [];

  // Mig 144 — transfer fleet (owner/developer manage). Safe if the
  // table doesn't exist yet (returns null → empty list).
  const canManageTrucks = currentUser.role === "developer" || currentUser.role === "owner";
  let truckList: Array<{ id: string; name: string; is_active: boolean; driver_name?: string | null }> = [];
  if (canManageTrucks) {
    // select("*") so this stays safe before migration 147 adds driver_name.
    const { data: trucks } = await admin.from("trucks").select("*").order("name");
    truckList = (trucks ?? []) as Array<{ id: string; name: string; is_active: boolean; driver_name?: string | null }>;
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p className="muted">Manage temples and system users.</p>
        </div>
      </div>

      {/* Mig 057 — Personal Ledger card removed. The module was
          extracted to a standalone app (its own Supabase + Vercel)
          and the in-MTCPL copy is no longer in use. */}

      {/* System Status cards are now tucked into a collapsible at the
          BOTTOM of the page (after Full System Backup). Migrating
          out of the top slot per Daksh — these toggles are
          rarely-used + high-impact, so hiding them behind a click
          keeps the page focused on daily-use sections (Users,
          Stone Types, Temple Codes, etc.). See <MaintenanceCollapsible>
          rendered below the AutoBackup PeekSection. */}

      {/* ALL WhatsApp settings under ONE section (Daksh) — daily report,
          vendor carbon-copy, and the operational alerts — so the settings
          page stays uncluttered. Each group is gated by its own permission
          (daily report = owner/developer; the rest = developer). Everything
          lives in app_settings; no redeploy needed. */}
      {(canManageWaReport || canManageVendorCc || canManageWaAlerts) && (
        <PeekSection icon="💬" title="WhatsApp" modalMaxWidth={560}>
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {canManageWaReport && (
              <div>
                <div style={{ fontSize: 15, fontWeight: 800, margin: "0 0 12px", display: "flex", alignItems: "center", gap: 8 }}>
                  📲 Daily report
                </div>
                <WaRecipientsEditor initial={waReportRecipients} />
              </div>
            )}
            {canManageVendorCc && vendorCc && (
              <div style={{ borderTop: "1px solid var(--border)", paddingTop: 20 }}>
                <div style={{ fontSize: 15, fontWeight: 800, margin: "0 0 12px", display: "flex", alignItems: "center", gap: 8 }}>
                  📩 Vendor message carbon-copy
                </div>
                <WaVendorCcEditor initial={vendorCc} recentPaid={recentPaidForTest} />
              </div>
            )}
            {canManageWaAlerts && slabTransferAlert && carvingBacklog && (
              <div style={{ borderTop: "1px solid var(--border)", paddingTop: 20 }}>
                <div style={{ fontSize: 15, fontWeight: 800, margin: "0 0 12px", display: "flex", alignItems: "center", gap: 8 }}>
                  🔔 Operational alerts
                </div>
                <WaAlertsEditor slabTransfer={slabTransferAlert} backlog={carvingBacklog} />
              </div>
            )}
          </div>
        </PeekSection>
      )}

      {/* Transfer trucks (Mig 144) — owner/developer fleet management.
          Add trucks by number plate; the slab-transfer runner picks one
          when claiming. Deactivating hides a truck from the picker
          without deleting its history. */}
      {canManageTrucks && (
        <PeekSection
          icon="🚚"
          title="Transfer trucks"
          subtitle={`${truckList.filter((t) => t.is_active).length} active · slab-transfer fleet`}
          modalMaxWidth={560}
        >
          <div className="settings-card">
            <h3 className="settings-card-title">Add truck</h3>
            <form action={addTransferTruckAction}>
              <div className="settings-form-row" style={{ alignItems: "flex-end" }}>
                <label className="stack" style={{ flex: 1 }}>
                  <span>Truck number / plate</span>
                  <input
                    name="name"
                    placeholder="e.g. MH-04-AB-1234"
                    required
                    style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700, textTransform: "uppercase" }}
                  />
                </label>
                <label className="stack" style={{ flex: 1 }}>
                  <span>Driver name (optional)</span>
                  <input name="driver_name" placeholder="e.g. Ramesh" />
                </label>
                <button type="submit" className="primary-button" style={{ minHeight: 40 }}>
                  Add truck
                </button>
              </div>
            </form>
            {truckList.length > 0 && (
              <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 6 }}>
                {truckList.map((t) => (
                  <div
                    key={t.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 10px",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      background: t.is_active ? "var(--surface)" : "var(--surface-alt)",
                      opacity: t.is_active ? 1 : 0.6,
                    }}
                  >
                    <span style={{ fontSize: 16 }}>🚚</span>
                    <code style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 14 }}>
                      {t.name.toUpperCase()}
                    </code>
                    {t.driver_name && (
                      <span style={{ fontSize: 12, color: "var(--muted)" }}>· {t.driver_name}</span>
                    )}
                    {!t.is_active && (
                      <span style={{ fontSize: 10, fontWeight: 800, color: "var(--muted)", background: "var(--bg)", borderRadius: 999, padding: "2px 8px" }}>
                        inactive
                      </span>
                    )}
                    <form action={setTransferTruckActiveAction} style={{ marginLeft: "auto" }}>
                      <input type="hidden" name="id" value={t.id} />
                      <input type="hidden" name="active" value={t.is_active ? "0" : "1"} />
                      <button type="submit" className="ghost-button" style={{ fontSize: 12, padding: "6px 12px" }}>
                        {t.is_active ? "Deactivate" : "Activate"}
                      </button>
                    </form>
                  </div>
                ))}
              </div>
            )}
          </div>
        </PeekSection>
      )}

      {/* User Management — owner + developer only.
          Daksh (this pass): "remove user section on setting page
          from all roles other than owner and developer. Currently
          team heads can see — remove it." Future intent he flagged:
          a department head should eventually see just their own
          department's users (e.g. carving_head sees vendor + carving
          roles). Skipped here — we'll wire that filter when there's
          a clearer department→roles mapping in the schema. */}
      {(currentUser.role === "owner" || currentUser.role === "developer") && (
        <PeekSection
          icon="👥"
          title="Users"
          count={activeUsers.length}          modalMaxWidth={1100}
        >
          {activeUsers.length === 0 ? (
            <div className="banner">No active users.</div>
          ) : (
            <div className="settings-table">
              <div className="settings-table-head" style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr auto" }}>
                <span>Name / Phone</span>
                <span>Role</span>
                <span>Access</span>
                <span>Status</span>
                <span></span>
              </div>
              {activeUsers.map((user) => {
                const role = user.role as AppRole;
                const isSelf = user.id === currentUser.id;
                const isDeveloper = role === "developer";
                // Lock: developer rows for everyone; owner rows for
                // team_head / senior_incharge; senior_incharge rows
                // for team_head (peer can't demote a senior). Owner +
                // dev can edit anyone (except dev-by-non-dev).
                const isLocked =
                  (isDeveloper && !isSelf) ||
                  (role === "owner" && currentUser.role !== "developer" && currentUser.role !== "owner") ||
                  (role === "senior_incharge" && currentUser.role === "team_head");

                // Locked rows: render as plain div (not expandable)
                if (isLocked) {
                  return (
                    <div key={user.id} className="settings-table-row" style={{ cursor: "default" }}>
                      <div className="settings-table-row-face" style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr auto" }}>
                        <span>
                          <span className="settings-temple-name">{user.full_name || "—"}</span>
                          {user.phone ? <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>{user.phone}</span> : null}
                          {user.created_at ? <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>Joined {formatDate(user.created_at)}</span> : null}
                        </span>
                        <span>
                          <span className="role-pill" style={
                            isDeveloper ? { background: "var(--gold)", color: "#fff", fontWeight: 700 } :
                            role === "owner" ? { background: "#1a1a1a", color: "#fff", fontWeight: 700 } :
                            role === "senior_incharge" ? {
                              // Mig 076 — emerald gradient. See note on
                              // the editable row below for full rationale.
                              background: "linear-gradient(135deg, #047857 0%, #10b981 100%)",
                              color: "#fff",
                              fontWeight: 800,
                              letterSpacing: "0.04em",
                              boxShadow: "0 0 0 1px rgba(255,255,255,0.18) inset, 0 1px 3px rgba(16,185,129,0.35)",
                            } :
                            role === "carving_head" ? {
                              // Daksh June 2026 — "carved / engraved stone"
                              // chip for the Carving Head. Bronze stone
                              // gradient + pressed-in inset shadow + letterpress
                              // text so it reads chiselled, not flat.
                              background: "linear-gradient(135deg, #6e5230 0%, #8a6a3a 45%, #574122 100%)",
                              color: "#f6ecd6",
                              fontWeight: 800,
                              letterSpacing: "0.08em",
                              textShadow: "0 1px 1px rgba(0,0,0,0.55), 0 -1px 0 rgba(255,255,255,0.12)",
                              boxShadow: "inset 0 2px 3px rgba(0,0,0,0.55), inset 0 -1px 1px rgba(255,255,255,0.18), 0 1px 2px rgba(0,0,0,0.25)",
                              border: "1px solid rgba(60,40,15,0.5)",
                            } :
                            role === "team_head" ? { background: "#1e3a5f", color: "#fff", fontWeight: 700 } : {}
                          }>
                            {roleLabel(role)}
                          </span>
                        </span>
                        <span className="muted" style={{ fontSize: 12 }}>{(ROLE_ACCESS[role] ?? []).join(", ")}</span>
                        <span>
                          <span className={`role-pill ${user.is_active ? "badge-available" : "badge-discarded"}`}>
                            {user.is_active ? "Active" : "Inactive"}
                          </span>
                        </span>
                        <span className="muted" style={{ fontSize: 12 }}>🔒 Locked</span>
                      </div>
                    </div>
                  );
                }

                return (
                  <details key={user.id} className="settings-table-row">
                    <summary className="settings-table-row-face" style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr auto" }}>
                      <span>
                        <span className="settings-temple-name">{user.full_name || "—"}</span>
                        {user.phone ? <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>{user.phone}</span> : null}
                        {isSelf ? <span className="role-pill" style={{ marginLeft: 8, fontSize: 11 }}>You</span> : null}
                        {user.created_at ? <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>Joined {formatDate(user.created_at)}</span> : null}
                      </span>
                      <span>
                        <span
                          className="role-pill"
                          style={
                            isDeveloper ? { background: "var(--gold)", color: "#fff", fontWeight: 700 } :
                            role === "owner" ? { background: "#1a1a1a", color: "#fff", fontWeight: 700 } :
                            role === "senior_incharge" ? {
                              // Mig 076 — emerald gradient + subtle glow.
                              // Rajesh-tier: visually one rank above the
                              // dark-blue TEAM HEAD pill.
                              background: "linear-gradient(135deg, #047857 0%, #10b981 100%)",
                              color: "#fff",
                              fontWeight: 800,
                              letterSpacing: "0.04em",
                              boxShadow: "0 0 0 1px rgba(255,255,255,0.18) inset, 0 1px 3px rgba(16,185,129,0.35)",
                            } :
                            role === "carving_head" ? {
                              // Carved / engraved stone chip (see locked-row note).
                              background: "linear-gradient(135deg, #6e5230 0%, #8a6a3a 45%, #574122 100%)",
                              color: "#f6ecd6",
                              fontWeight: 800,
                              letterSpacing: "0.08em",
                              textShadow: "0 1px 1px rgba(0,0,0,0.55), 0 -1px 0 rgba(255,255,255,0.12)",
                              boxShadow: "inset 0 2px 3px rgba(0,0,0,0.55), inset 0 -1px 1px rgba(255,255,255,0.18), 0 1px 2px rgba(0,0,0,0.25)",
                              border: "1px solid rgba(60,40,15,0.5)",
                            } :
                            role === "team_head" ? { background: "#1e3a5f", color: "#fff", fontWeight: 700 } :
                            {}
                          }
                        >
                          {roleLabel(role)}
                        </span>
                      </span>
                      <span className="muted" style={{ fontSize: 12 }}>{(ROLE_ACCESS[role] ?? []).join(", ")}</span>
                      <span>
                        <span className={`role-pill ${user.is_active ? "badge-available" : "badge-discarded"}`}>
                          {user.is_active ? "Active" : "Inactive"}
                        </span>
                      </span>
                      <span className="muted" style={{ fontSize: 12 }}>Edit ▾</span>
                    </summary>

                    <div className="settings-table-edit">
                      {/* Daksh May 2026 — self-rename locked.
                          Several role gates key off the display name
                          (sidebar grants dashboard access to specific
                          names like RAJESH / NARESH). If a user
                          renames themselves they silently lose those
                          grants. Only developer can edit their own
                          row here; everyone else sees a read-only
                          panel telling them to ask an admin. */}
                      {isSelf && currentUser.role === "developer" ? (
                        <form action={updateOwnNameAction} className="settings-form-row" style={{ flexWrap: "wrap" }}>
                          <label className="stack" style={{ flex: "2 1 160px" }}>
                            <span>Your Display Name</span>
                            <input
                              name="full_name"
                              defaultValue={user.full_name ?? ""}
                              placeholder="Enter your name"
                              required
                            />
                          </label>
                          <div style={{ alignSelf: "flex-end", display: "flex", gap: 8 }}>
                            <button className="secondary-button" type="submit">Update Name</button>
                          </div>
                          <p className="muted" style={{ fontSize: 11, width: "100%", margin: "4px 0 0" }}>
                            This name appears on blocks, slabs, and cutting plans you create.
                            Role and status can only be changed by another admin.
                          </p>
                        </form>
                      ) : isSelf ? (
                        <div
                          style={{
                            padding: "12px 14px",
                            background: "var(--surface-alt)",
                            border: "1px solid var(--border)",
                            borderRadius: 8,
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              fontSize: 13,
                              fontWeight: 700,
                            }}
                          >
                            <span>🔒</span>
                            <span>{user.full_name || "—"}</span>
                          </div>
                          <p className="muted" style={{ fontSize: 11, margin: "6px 0 0" }}>
                            Your display name is locked because role
                            permissions key off it. Ask the developer
                            if it really needs to change.
                          </p>
                        </div>
                      ) : (
                      <form action={updateUserAction} className="settings-form-row" style={{ flexWrap: "wrap" }}>
                            <input type="hidden" name="id" value={user.id} />

                            <label className="stack" style={{ flex: "2 1 160px" }}>
                              <span>Display Name</span>
                              <input
                                name="full_name"
                                defaultValue={user.full_name ?? ""}
                                placeholder="Enter full name"
                              />
                            </label>

                            {/* Role + carving-vendor picker (Daksh May
                                2026). When the admin picks role
                                "vendor" the vendor dropdown appears
                                inline so they can immediately bind
                                this profile to Mohit / Vivek / etc.
                                For owner/team_head the role list is
                                trimmed so they can still hand out a
                                vendor role without elevating to
                                owner/dev. */}
                            <UserRoleVendorPicker
                              roleOptions={
                                currentUser.role === "developer"
                                  ? UI_ROLES_ALL
                                  : UI_ROLES_PLANNER
                              }
                              vendorOptions={vendorList.map((v) => ({
                                id: v.id,
                                name: v.name,
                                vendor_type: v.vendor_type,
                              }))}
                              defaultRole={
                                currentUser.role === "developer"
                                  ? role
                                  : UI_ROLES_PLANNER.some((r) => r.value === role)
                                    ? role
                                    : "block_slab_entry"
                              }
                              defaultVendorId={user.vendor_id ?? null}
                            />

                            <label className="stack" style={{ flex: "0 0 auto" }}>
                              <span>Status</span>
                              <select name="is_active" defaultValue={String(user.is_active)}>
                                <option value="true">Active</option>
                                <option value="false">Inactive</option>
                              </select>
                            </label>

                            {/* Per-user idle auto-logout window (mig 113).
                                DEVELOPER-ONLY control. Some users want a
                                longer window (or none), while critical
                                roles like owner / accounts should keep the
                                short 10-min default. The field is only
                                rendered for the developer, and the server
                                only honors it for the developer — so an
                                owner saving a row never changes it.
                                "" = default 10 min, "0" = never. */}
                            {currentUser.role === "developer" && (
                              <label className="stack" style={{ flex: "0 0 auto" }}>
                                <span>Idle logout ⏳</span>
                                <select
                                  name="idle_logout_minutes"
                                  defaultValue={
                                    (user as { idle_logout_minutes?: number | null }).idle_logout_minutes == null
                                      ? ""
                                      : String((user as { idle_logout_minutes?: number | null }).idle_logout_minutes)
                                  }
                                >
                                  <option value="">Default (10 min)</option>
                                  <option value="10">10 minutes</option>
                                  <option value="30">30 minutes</option>
                                  <option value="60">1 hour</option>
                                  <option value="120">2 hours</option>
                                  <option value="240">4 hours</option>
                                  <option value="480">8 hours</option>
                                  <option value="0">Never log out</option>
                                </select>
                              </label>
                            )}

                            <div style={{ alignSelf: "flex-end", display: "flex", gap: 8 }}>
                              <button className="secondary-button" type="submit">Save</button>
                            </div>
                          </form>
                      )}

                          {!isSelf && (
                            <div style={{ marginTop: 10 }}>
                              <form action={deleteUserAction} style={{ display: "inline" }}>
                                <input type="hidden" name="id" value={user.id} />
                                <button
                                  className="ghost-button danger-ghost"
                                  type="submit"
                                  formNoValidate
                                  style={{ fontSize: 12 }}
                                >
                                  Remove User
                                </button>
                              </form>
                              <span className="muted" style={{ fontSize: 11, marginLeft: 10 }}>
                                Removes access. Auth account remains in Supabase.
                              </span>
                            </div>
                          )}

                      <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                        Access pages: {(ROLE_ACCESS[role] ?? []).join(" · ")}
                      </div>
                    </div>
                  </details>
                );
              })}
            </div>
          )}

          {/* Removed (deactivated) users — hidden from the list above, kept
              here in a collapsed disclosure so they don't clutter but can
              still be reactivated. */}
          {inactiveUsers.length > 0 && (
            <details style={{ marginTop: 14, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
              <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 700, color: "var(--muted)", padding: "6px 4px" }}>
                Inactive users ({inactiveUsers.length}) · removed — hidden from the list above
              </summary>
              <div className="settings-table" style={{ marginTop: 8 }}>
                {inactiveUsers.map((user) => {
                  const role = user.role as AppRole;
                  const isSelf = user.id === currentUser.id;
                  const isLocked =
                    (role === "developer" && !isSelf) ||
                    (role === "owner" && currentUser.role !== "developer" && currentUser.role !== "owner") ||
                    (role === "senior_incharge" && currentUser.role === "team_head");
                  return (
                    <div key={user.id} className="settings-table-row-face" style={{ gridTemplateColumns: "2fr 1fr 1fr auto", alignItems: "center", opacity: 0.7 }}>
                      <span>
                        <span className="settings-temple-name">{user.full_name || "—"}</span>
                        {user.phone ? <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>{user.phone}</span> : null}
                      </span>
                      <span><span className="role-pill">{roleLabel(role)}</span></span>
                      <span><span className="role-pill badge-discarded">Inactive</span></span>
                      <span>
                        {isLocked ? (
                          <span className="muted" style={{ fontSize: 12 }}>🔒</span>
                        ) : (
                          <form action={updateUserAction} style={{ display: "inline" }}>
                            <input type="hidden" name="id" value={user.id} />
                            <input type="hidden" name="full_name" value={user.full_name ?? ""} />
                            <input type="hidden" name="role" value={user.role} />
                            <input type="hidden" name="is_active" value="true" />
                            {user.vendor_id ? <input type="hidden" name="vendor_id" value={user.vendor_id} /> : null}
                            <button className="ghost-button" type="submit" style={{ fontSize: 12 }}>Reactivate</button>
                          </form>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </details>
          )}
        </PeekSection>
      )}

      {/* Stone Type Configuration — visible to everyone who can hit
          /settings (developer / owner / team_head / senior_incharge).
          No role gate intentionally — Rajesh-tier (senior_incharge)
          needs to add new stone types as new yards come online.
          The destructive sub-actions (recategorise, delete) have
          their own data-presence guards inside the server actions. */}
      <PeekSection
        icon="🪨"
        title="Stone Types"
        count={stoneList.length}        modalMaxWidth={1100}
      >
        <div className="settings-card">
          <h3 className="settings-card-title">Add Stone Type</h3>
          <form action={addStoneTypeAction} className="settings-form-row">
            <label className="stack" style={{ flex: 2, minWidth: 180 }}>
              <span>Name (no spaces, e.g. RedStone)</span>
              <input name="name" required style={{ fontFamily: "ui-monospace, monospace", fontWeight: 600 }} />
            </label>
            <label className="stack" style={{ flex: "0 0 auto", minWidth: 130 }}>
              <span>Category</span>
              <select name="stone_category" defaultValue="sandstone" style={{ fontWeight: 600 }}>
                <option value="sandstone">Sandstone (CFT)</option>
                <option value="marble">🗿 Marble (tonnes)</option>
              </select>
            </label>
            <label className="stack" style={{ flex: "0 0 auto" }}>
              <span>Stone Colour</span>
              <input type="color" name="color" defaultValue="#A85555" style={{ width: 56, height: 36, padding: 2, cursor: "pointer", borderRadius: 6 }} />
            </label>
            <div className="stack" style={{ flex: "0 0 auto", justifyContent: "flex-end" }}>
              <span style={{ visibility: "hidden", fontSize: 12 }}>.</span>
              <button className="primary-button" type="submit">Add Stone</button>
            </div>
          </form>
          <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>
            <strong>Sandstone</strong> = measured in CFT, plan generator works. <strong>Marble</strong> = measured in tonnes per truck, manual cut only. Pick the right one — it affects how the block inventory and Block Journey treat this stone.
          </p>
        </div>

        <div className="settings-table">
          <div className="settings-table-head" style={{ gridTemplateColumns: "1fr auto auto auto auto" }}>
            <span>Stone Type</span>
            <span>Category</span>
            <span>3D Colours</span>
            <span>Blocks Use It</span>
            <span></span>
          </div>
          {stoneList.map(st => {
            const isBuiltIn = st.name === "PinkStone" || st.name === "WhiteStone";
            const stoneCategory: string = (st as { stone_category?: string }).stone_category ?? "sandstone";
            const isMarble = stoneCategory === "marble";
            return (
              <div key={st.id} className="settings-table-row">
                <div className="settings-table-row-face" style={{ gridTemplateColumns: "1fr auto auto auto auto" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span
                      style={{
                        width: 28, height: 28, borderRadius: 6, flexShrink: 0,
                        background: `linear-gradient(135deg, ${st.color_top} 50%, ${st.color_front} 50%)`,
                        border: "1px solid rgba(0,0,0,0.1)",
                        display: "inline-block",
                      }}
                    />
                    <span className="settings-temple-name">{st.name}</span>
                    <span className="muted" style={{ fontSize: 12 }}>({stoneDisplayName(st.name)})</span>
                    {isBuiltIn && <span className="role-pill" style={{ fontSize: 11 }}>Built-in</span>}
                  </span>
                  <span>
                    {(() => {
                      // Lock the category whenever this stone already has
                      // blocks or slabs — flipping PinkStone's category
                      // from sandstone to marble (or vice versa) would
                      // break how those rows render (dims vs tonnes).
                      const inUseBlocks = blockStoneCount[st.name] ?? 0;
                      const inUseSlabs = slabStoneCount[st.name] ?? 0;
                      const isLocked = inUseBlocks + inUseSlabs > 0;
                      if (isLocked) {
                        return (
                          <span
                            title={`Locked — ${inUseBlocks} block${inUseBlocks !== 1 ? "s" : ""} and ${inUseSlabs} slab${inUseSlabs !== 1 ? "s" : ""} already use this stone. Category is fixed to preserve their display. To change, first reassign or delete the blocks/slabs.`}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              fontSize: 12,
                              fontWeight: 700,
                              padding: "3px 10px",
                              border: `1px solid ${isMarble ? "rgba(180,83,9,0.35)" : "rgba(22,101,52,0.3)"}`,
                              borderRadius: 4,
                              background: isMarble ? "rgba(180,83,9,0.1)" : "rgba(22,101,52,0.08)",
                              color: isMarble ? "#b45309" : "#15803d",
                              cursor: "help",
                            }}
                          >
                            🔒 {isMarble ? "🗿 Marble" : "Sandstone"}
                          </span>
                        );
                      }
                      return (
                        <form action={setStoneCategoryAction} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <input type="hidden" name="id" value={st.id} />
                          <select
                            name="stone_category"
                            defaultValue={stoneCategory}
                            style={{
                              fontSize: 12,
                              fontWeight: 700,
                              padding: "3px 8px",
                              border: `1px solid ${isMarble ? "rgba(180,83,9,0.35)" : "var(--border)"}`,
                              borderRadius: 4,
                              background: isMarble ? "rgba(180,83,9,0.1)" : "rgba(22,101,52,0.08)",
                              color: isMarble ? "#b45309" : "#15803d",
                            }}
                          >
                            <option value="sandstone">Sandstone</option>
                            <option value="marble">🗿 Marble</option>
                          </select>
                          <button
                            type="submit"
                            className="ghost-button"
                            style={{ fontSize: 11, padding: "2px 8px" }}
                            title="Save category change"
                          >
                            Save
                          </button>
                        </form>
                      );
                    })()}
                  </span>
                  <span style={{ display: "flex", gap: 4 }}>
                    <span title="Top" style={{ width: 22, height: 22, borderRadius: 4, background: st.color_top, border: "1px solid rgba(0,0,0,0.1)", display: "inline-block" }} />
                    <span title="Front" style={{ width: 22, height: 22, borderRadius: 4, background: st.color_front, border: "1px solid rgba(0,0,0,0.1)", display: "inline-block" }} />
                    <span title="Side" style={{ width: 22, height: 22, borderRadius: 4, background: st.color_side, border: "1px solid rgba(0,0,0,0.1)", display: "inline-block" }} />
                  </span>
                  <span style={{ fontSize: 12 }}>
                    {(() => {
                      const bc = blockStoneCount[st.name] ?? 0;
                      const sc = slabStoneCount[st.name] ?? 0;
                      const total = bc + sc;
                      if (total === 0) return <span className="muted">None</span>;
                      return <span style={{ color: "#b87333", fontWeight: 600 }}>{bc} block{bc !== 1 ? "s" : ""}, {sc} slab{sc !== 1 ? "s" : ""}</span>;
                    })()}
                  </span>
                  <span>
                    {isBuiltIn ? (
                      <span className="muted" style={{ fontSize: 12 }}>🔒 Protected</span>
                    ) : (
                      <form action={deleteStoneTypeAction} style={{ display: "inline" }}>
                        <input type="hidden" name="id" value={st.id} />
                        <input type="hidden" name="name" value={st.name} />
                        <button
                          className="ghost-button danger-ghost"
                          type="submit"
                          style={{ fontSize: 12, padding: "3px 10px" }}
                          title={(blockStoneCount[st.name] ?? 0) + (slabStoneCount[st.name] ?? 0) > 0
                            ? "Cannot delete — blocks/slabs exist with this stone type"
                            : "Delete stone type"}
                        >
                          Delete
                        </button>
                      </form>
                    )}
                  </span>
                </div>
              </div>
            );
          })}
          {stoneList.length === 0 && (
            <div className="banner">No stone types found. Run the database setup SQL first.</div>
          )}
        </div>
      </PeekSection>

      {/* Temple Code Configuration — visible to everyone who can hit
          /settings (developer / owner / team_head / senior_incharge).
          Same posture as Stone Types: Rajesh-tier needs to add a
          temple when a new contract comes in. Deletion is guarded
          server-side by the slab-count check. */}
      <PeekSection
        icon="🛕"
        title="Temple Codes"
        count={templeList.length}        modalMaxWidth={1100}
      >
        <div className="settings-card">
          <h3 className="settings-card-title">Add Temple</h3>
          <form action={addTempleAction}>
            <div className="settings-form-row">
              <label className="stack" style={{ flex: 2 }}>
                <span>Temple Name</span>
                <input name="name" required />
              </label>
              <label className="stack" style={{ flex: 1 }}>
                <span>Code Prefix</span>
                <input
                  name="code_prefix"

                  maxLength={6}
                  required
                  style={{ textTransform: "uppercase", fontFamily: "ui-monospace, monospace", fontWeight: 700 }}
                />
              </label>
              <label className="stack" style={{ flex: "0 0 auto" }}>
                <span>Stone Type</span>
                <select name="default_stone" defaultValue="PinkStone">
                  {stoneList.length > 0
                    ? stoneList.map(st => <option key={st.name} value={st.name}>{st.name}</option>)
                    : <>
                        <option value="PinkStone">PinkStone</option>
                        <option value="WhiteStone">WhiteStone</option>
                      </>
                  }
                </select>
              </label>
              {/* Mig 154 — billing customer. When a dispatch for this
                  temple is approved, an invoicing challan auto-creates
                  for this party. Optional: unmapped temples just skip
                  the auto-challan (it can be made by hand later). */}
              <label className="stack" style={{ flex: 1 }}>
                <span>💳 Customer (billing)</span>
                <select name="invoice_party_id" defaultValue="">
                  <option value="">— None —</option>
                  {partyList.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
            </div>
            {/* Mig 130 — site info, auto-filled onto every dispatch
                challan for this temple. All optional; editable later. */}
            <div className="settings-form-row" style={{ marginTop: 10 }}>
              <label className="stack" style={{ flex: 2 }}>
                <span>📍 Site Location (Bill-To address)</span>
                <input name="site_location" placeholder="e.g. Math Asthal Bohar, Rohtak, Haryana" />
              </label>
              <label className="stack" style={{ flex: 1 }}>
                <span>Site Incharge (client)</span>
                <input name="site_incharge_name" placeholder="Name" />
              </label>
              <label className="stack" style={{ flex: "0 0 140px" }}>
                <span>Incharge Mobile</span>
                <input name="site_incharge_phone" type="tel" placeholder="98…" />
              </label>
              <label className="stack" style={{ flex: 1 }}>
                <span>Installation By (our contractor)</span>
                <input name="installer_name" placeholder="Name" />
              </label>
              <label className="stack" style={{ flex: "0 0 140px" }}>
                <span>Installer Mobile</span>
                <input name="installer_phone" type="tel" placeholder="98…" />
              </label>
              <div className="stack" style={{ flex: "0 0 auto", justifyContent: "flex-end" }}>
                <span style={{ visibility: "hidden", fontSize: 12 }}>.</span>
                <button className="primary-button" type="submit">Add Temple</button>
              </div>
            </div>
          </form>
        </div>

        {/* (Mig 130 follow-on: the dispatch-incharge editor lives on the
            Dispatch page header now, not here.) */}

        {templeList.length === 0 ? (
          <div className="banner">No temples configured yet. Add your first temple above.</div>
        ) : (
          <div className="settings-table">
            <div className="settings-table-head">
              <span>Temple Name</span>
              <span>Code Prefix</span>
              <span>Slab ID Format</span>
              <span>Status</span>
              <span></span>
            </div>
            {templeList.map(temple => (
              <details key={temple.id} className="settings-table-row">
                <summary className="settings-table-row-face">
                  <span className="settings-temple-name">{temple.name}</span>
                  <span><code className="code-badge">{temple.code_prefix}</code></span>
                  <span className="muted" style={{ fontSize: 13 }}>
                    {temple.code_prefix}-0001, {temple.code_prefix}-0002…
                  </span>
                  <span>
                    <span className={`role-pill ${temple.is_active ? "badge-available" : "badge-discarded"}`}>
                      {temple.is_active ? "Active" : "Inactive"}
                    </span>
                  </span>
                  <span className="muted" style={{ fontSize: 12 }}>Edit ▾</span>
                </summary>

                <div className="settings-table-edit">
                  {(() => {
                    const sc = templeSlabCount[temple.name] ?? 0;
                    if (sc > 0) return (
                      <p style={{ fontSize: 12, color: "#b87333", margin: "0 0 10px", fontWeight: 600 }}>
                        ⚠️ {sc} slab{sc !== 1 ? "s" : ""} belong to this temple — delete is blocked until all slabs are completed or removed.
                      </p>
                    );
                    return null;
                  })()}
                  <form action={updateTempleAction}>
                    <div className="settings-form-row">
                    <input type="hidden" name="id" value={temple.id} />
                    <input type="hidden" name="temple_name" value={temple.name} />
                    {/* Daksh: temple name / code prefix / stone type are
                        LOCKED after creation. Changing them mid-flow
                        caused problems with existing slab IDs and
                        references. The fields render as read-only with
                        a 🔒 hint; only Status (and Delete) stay
                        actionable. The server action also ignores any
                        attempt to send new values for these three. */}
                    <label className="stack" style={{ flex: 2 }}>
                      <span>Temple Name 🔒</span>
                      <input
                        name="name"
                        defaultValue={temple.name}
                        readOnly
                        disabled
                        title="Locked after creation"
                        style={{ background: "#f5f1e6", color: "#4a4a4a", cursor: "not-allowed" }}
                      />
                    </label>
                    <label className="stack" style={{ flex: 1 }}>
                      <span>Code Prefix 🔒</span>
                      <input
                        name="code_prefix"
                        defaultValue={temple.code_prefix}
                        maxLength={6}
                        readOnly
                        disabled
                        title="Locked after creation"
                        style={{
                          textTransform: "uppercase",
                          fontFamily: "ui-monospace, monospace",
                          fontWeight: 700,
                          background: "#f5f1e6",
                          color: "#4a4a4a",
                          cursor: "not-allowed",
                        }}
                      />
                    </label>
                    <label className="stack" style={{ flex: "0 0 auto" }}>
                      <span>Stone Type 🔒</span>
                      <select
                        name="default_stone"
                        defaultValue={(temple as any).default_stone ?? "PinkStone"}
                        disabled
                        title="Locked after creation"
                        style={{ background: "#f5f1e6", color: "#4a4a4a", cursor: "not-allowed" }}
                      >
                        {stoneList.length > 0
                          ? stoneList.map(st => <option key={st.name} value={st.name}>{st.name}</option>)
                          : <>
                              <option value="PinkStone">PinkStone</option>
                              <option value="WhiteStone">WhiteStone</option>
                            </>
                        }
                      </select>
                    </label>
                    <label className="stack" style={{ flex: "0 0 auto" }}>
                      <span>Status</span>
                      <select name="is_active" defaultValue={String(temple.is_active)}>
                        <option value="true">Active</option>
                        <option value="false">Inactive</option>
                      </select>
                    </label>
                    </div>
                    {/* Mig 130 — site info (EDITABLE, feeds the dispatch
                        challan: Bill-To location, client incharge,
                        installation contractor). */}
                    <div className="settings-form-row" style={{ marginTop: 10 }}>
                      <label className="stack" style={{ flex: 2 }}>
                        <span>📍 Site Location</span>
                        <input name="site_location" defaultValue={(temple as any).site_location ?? ""} placeholder="Bill-To address on challan" />
                      </label>
                      <label className="stack" style={{ flex: 1 }}>
                        <span>Site Incharge (client)</span>
                        <input name="site_incharge_name" defaultValue={(temple as any).site_incharge_name ?? ""} />
                      </label>
                      <label className="stack" style={{ flex: "0 0 130px" }}>
                        <span>Incharge Mobile</span>
                        <input name="site_incharge_phone" type="tel" defaultValue={(temple as any).site_incharge_phone ?? ""} />
                      </label>
                      <label className="stack" style={{ flex: 1 }}>
                        <span>Installation By</span>
                        <input name="installer_name" defaultValue={(temple as any).installer_name ?? ""} />
                      </label>
                      <label className="stack" style={{ flex: "0 0 130px" }}>
                        <span>Installer Mobile</span>
                        <input name="installer_phone" type="tel" defaultValue={(temple as any).installer_phone ?? ""} />
                      </label>
                      {/* Mig 154 — billing customer for the auto
                          dispatch→invoicing challan. */}
                      <label className="stack" style={{ flex: 1 }}>
                        <span>💳 Customer (billing)</span>
                        <select name="invoice_party_id" defaultValue={(temple as any).invoice_party_id ?? ""}>
                          <option value="">— None —</option>
                          {partyList.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      </label>
                      <div style={{ display: "flex", gap: 8, alignSelf: "flex-end" }}>
                        <button className="secondary-button" type="submit">Save</button>
                        <button className="ghost-button danger-ghost" formAction={deleteTempleAction} formNoValidate type="submit">
                          Delete
                        </button>
                      </div>
                    </div>
                  </form>
                  <p style={{ fontSize: 11, color: "var(--muted)", margin: "8px 2px 0", lineHeight: 1.5 }}>
                    🔒 Temple name, code prefix and stone type are locked
                    after the temple is first created. Changing them
                    mid-flow corrupts slab IDs that already reference
                    this temple. If you genuinely need to rename, mark
                    this temple Inactive and add a new one.
                  </p>
                </div>
              </details>
            ))}
          </div>
        )}
      </PeekSection>

      {/* Operator/admin surfaces — all rendered as collapsed cards
          that open in a Notion-style center-peek modal. Order:
          Live Users (developer only — most actionable signal when
          someone needs help), Screen Time, Audit Log, Backup. */}

      {/* 0. Live Users — developer + owner. Mig 046 added the
          Location column so Daksh can spot users hitting the system
          from outside the factory. */}
      {(currentUser.role === "developer" || currentUser.role === "owner") && (
        <PeekSection
          icon="🛰"
          title="Live Users"
          count={liveUsers.length}          modalMaxWidth={1100}
        >
          <div className="settings-card" style={{ padding: 0, overflow: "hidden" }}>
            {liveUsers.length === 0 ? (
              <p className="muted" style={{ padding: 16 }}>
                Nobody is online right now. Heartbeat detects activity within the last 5 minutes.
              </p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "var(--surface-alt)" }}>
                    <th style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>User</th>
                    <th style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Role</th>
                    <th style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>On Page</th>
                    <th style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Location</th>
                    <th style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Last Seen</th>
                  </tr>
                </thead>
                <tbody>
                  {liveUsers.map((u) => {
                    const lastSeenMs = u.last_seen_at ? new Date(u.last_seen_at).getTime() : 0;
                    const elapsedSec = lastSeenMs ? Math.max(0, Math.round((Date.now() - lastSeenMs) / 1000)) : null;
                    const lastSeenLabel =
                      elapsedSec == null
                        ? "—"
                        : elapsedSec < 60
                          ? `${elapsedSec}s ago`
                          : elapsedSec < 300
                            ? `${Math.floor(elapsedSec / 60)}m ago`
                            : new Date(u.last_seen_at!).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });

                    // Mig 046 — location renderer. Two layers:
                    //   • IP-level: city / region from Vercel headers
                    //   • GPS-level: lat/lng if browser permission was
                    //     granted, exposed as a 📍 link to Google Maps
                    // gps_status tells us whether GPS was granted,
                    // denied, or unavailable so we can show the right
                    // icon next to the city line.
                    const cityLine = [
                      u.last_login_city,
                      u.last_login_region,
                      u.last_login_country,
                    ]
                      .filter((s) => !!s)
                      .join(", ");
                    const gpsAvail =
                      u.last_login_gps_status === "granted" &&
                      u.last_login_gps_lat != null &&
                      u.last_login_gps_lng != null;
                    const gpsLabel =
                      u.last_login_gps_status === "granted"
                        ? "📍 GPS"
                        : u.last_login_gps_status === "denied"
                          ? "🚫 GPS denied"
                          : u.last_login_gps_status === "timeout"
                            ? "⏱ GPS timeout"
                            : u.last_login_gps_status === "unavailable"
                              ? "✖ no GPS"
                              : null;
                    const mapsHref = gpsAvail
                      ? `https://www.google.com/maps/search/?api=1&query=${u.last_login_gps_lat},${u.last_login_gps_lng}`
                      : null;

                    return (
                      <tr key={u.id} style={{ borderBottom: "1px solid var(--border)" }}>
                        <td style={{ padding: "10px 16px", fontWeight: 600 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#22c55e", flexShrink: 0, boxShadow: "0 0 0 2px rgba(34,197,94,0.25)" }} />
                            {u.full_name || "—"}
                          </div>
                        </td>
                        <td style={{ padding: "10px 16px" }}>
                          <span className="role-pill" style={{ fontSize: 11 }}>{roleLabel(u.role as AppRole)}</span>
                        </td>
                        <td style={{ padding: "10px 16px", fontSize: 12 }}>
                          {u.last_path ? (
                            <span style={{ color: "var(--gold-dark)", fontWeight: 600 }}>
                              {pathLabel(u.last_path)}
                            </span>
                          ) : (
                            <span className="muted">unknown</span>
                          )}
                          {u.last_path && (
                            <span className="muted" style={{ fontSize: 11, marginLeft: 6, fontFamily: "ui-monospace, monospace" }}>
                              {u.last_path}
                            </span>
                          )}
                        </td>
                        <td style={{ padding: "10px 16px", fontSize: 12, minWidth: 200 }}>
                          {!u.last_login_at && (
                            <span className="muted" style={{ fontStyle: "italic" }}>
                              not captured yet
                            </span>
                          )}
                          {u.last_login_at && (
                            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                              <span style={{ color: "var(--text)", fontWeight: 600 }}>
                                {cityLine || "—"}
                              </span>
                              <span
                                className="muted"
                                style={{
                                  fontSize: 11,
                                  fontFamily: "ui-monospace, monospace",
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 6,
                                  flexWrap: "wrap",
                                }}
                              >
                                {u.last_login_ip ?? "—"}
                                {gpsAvail && mapsHref && (
                                  <a
                                    href={mapsHref}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{
                                      color: "#0ea5e9",
                                      textDecoration: "none",
                                      fontWeight: 700,
                                    }}
                                    title={`GPS: ${u.last_login_gps_lat?.toFixed(6)}, ${u.last_login_gps_lng?.toFixed(6)} (±${u.last_login_gps_accuracy_m ?? "?"}m) — open in Google Maps`}
                                  >
                                    📍 Map
                                  </a>
                                )}
                                {!gpsAvail && gpsLabel && (
                                  <span
                                    style={{
                                      color: "var(--muted)",
                                      fontSize: 10,
                                    }}
                                    title="Browser GPS permission state"
                                  >
                                    {gpsLabel}
                                  </span>
                                )}
                              </span>
                            </div>
                          )}
                        </td>
                        <td style={{ padding: "10px 16px", color: "#22c55e", fontWeight: 600, fontSize: 12 }}>
                          {lastSeenLabel}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <p className="muted" style={{ fontSize: 11, padding: "10px 16px", borderTop: "1px solid var(--border)", margin: 0 }}>
              Path is captured on every soft nav + every 2-minute heartbeat. May lag by up to 2 min on rapid navigation.
              {" · "}
              Location is captured once per browser session at login. City + IP are always recorded; precise GPS only if the user grants browser permission (📍 = granted, 🚫 = denied).
            </p>
          </div>
        </PeekSection>
      )}

      {/* 1. Screen Time Today — developer + owner */}
      {(currentUser.role === "developer" || currentUser.role === "owner") && (
        <PeekSection
          icon="🕐"
          title="Screen Time Today"
          count={screenTimeData.length}        >
          <div className="settings-card" style={{ padding: 0, overflow: "hidden" }}>
            {screenTimeData.length === 0 ? (
              <p className="muted" style={{ padding: 16 }}>No activity recorded today yet.</p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "var(--surface-alt)" }}>
                    <th style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>User</th>
                    <th style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Role</th>
                    <th style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Time Today</th>
                    <th style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Last Active</th>
                  </tr>
                </thead>
                <tbody>
                  {screenTimeData.map((row, i) => {
                    const hours = Math.floor(row.minutes / 60);
                    const mins = row.minutes % 60;
                    const timeLabel = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
                    const maxMinutes = screenTimeData[0]?.minutes ?? 1;
                    const barWidth = Math.max(4, Math.round((row.minutes / maxMinutes) * 100));
                    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
                    const isOnline = row.lastSeen && new Date(row.lastSeen).getTime() > fiveMinAgo;

                    return (
                      <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                        <td style={{ padding: "10px 16px", fontWeight: 600 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            {isOnline && (
                              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#22c55e", flexShrink: 0, boxShadow: "0 0 0 2px rgba(34,197,94,0.25)" }} />
                            )}
                            {row.name}
                          </div>
                        </td>
                        <td style={{ padding: "10px 16px" }}>
                          <span className="role-pill" style={{ fontSize: 11 }}>{roleLabel(row.role)}</span>
                        </td>
                        <td style={{ padding: "10px 16px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <div style={{ width: 100, height: 6, background: "var(--border)", borderRadius: 3, overflow: "hidden" }}>
                              <div style={{ width: `${barWidth}%`, height: "100%", background: hours >= 1 ? "var(--gold)" : "rgba(184,115,51,0.4)", borderRadius: 3 }} />
                            </div>
                            <span style={{ fontWeight: 700, fontSize: 13, color: "var(--text)", minWidth: 50 }}>{timeLabel}</span>
                          </div>
                        </td>
                        <td style={{ padding: "10px 16px", color: "var(--muted)", fontSize: 12 }}>
                          {row.lastSeen ? (
                            isOnline ? (
                              <span style={{ color: "#22c55e", fontWeight: 600 }}>Online now</span>
                            ) : (
                              new Date(row.lastSeen).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" })
                            )
                          ) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </PeekSection>
      )}

      {/* 2. Audit Log — developer + owner */}
      {(currentUser.role === "owner" || currentUser.role === "developer") && (
        <PeekSection
          icon="📋"
          title="Audit Log"
          count={(recentAudit ?? []).length}        >
          <div className="settings-card" style={{ padding: 0, overflow: "hidden" }}>
            {(recentAudit ?? []).length === 0 ? (
              <p className="muted" style={{ padding: 16 }}>No actions recorded yet.</p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <tbody>
                  {(recentAudit ?? []).map((log: any) => (
                    <tr key={log.id} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "8px 14px", color: "var(--muted)", whiteSpace: "nowrap" }}>
                        {fmtAuditDate(log.created_at)}
                      </td>
                      <td style={{ padding: "8px 14px", fontWeight: 600 }}>{log.profiles?.full_name ?? "—"}</td>
                      <td style={{ padding: "8px 14px" }}><span className="role-pill">{log.action}</span></td>
                      <td style={{ padding: "8px 14px", color: "var(--muted)" }}>{log.entity_type} · <code style={{ fontSize: 11 }}>{log.entity_id}</code></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </PeekSection>
      )}

      {/* 3. Full System Backup — developer only */}
      {currentUser.role === "developer" && (
        <PeekSection
          icon="💾"
          title="Full System Backup"        >
          <div className="settings-card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
            <div>
              <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>Export: blocks · slab_requirements · cut_sessions · temples · vendors · profiles</p>
              <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>Snapshot of current live data at time of download. JSONB columns are stringified.</p>
            </div>
            <a
              href="/api/export/full-backup"
              className="primary-button"
              style={{ textDecoration: "none", whiteSpace: "nowrap" }}
            >
              ↓ Download Backup
            </a>
          </div>

          {/* Browser-side auto-backup. Saves Excel to Downloads folder
              every N hours while this tab is open. Belt-and-braces with
              Supabase Pro snapshot backups. */}
          <AutoBackup />
        </PeekSection>
      )}

      {/* Maintenance & system status — DEVELOPER ONLY. Tucked into a
          collapsible at the very bottom so it doesn't compete with
          daily-use sections at the top. Five cards in order of blast
          radius:
            1. Global       — the legacy kill-switch (mig 031). Locks
                              everyone in every department.
            2. Production   — Cutting / Carving / Dispatch / etc.
            3. Finance      — /accounts/* (Bills + Payments).
            4. Invoicing    — /invoicing/* (mig 038, outgoing invoices).
            5. Inventory    — placeholder for the v2 inventory module.
          Each is independent. */}
      {currentUser.role === "developer" && (
        <MaintenanceCollapsible>
          <SystemStatusSection
            isDown={systemStatus.down}
            message={systemStatus.message}
            updatedAt={systemStatus.updatedAt}
            updatedByName={systemUpdatedByName}
            takeDownAction={takeSystemDownAction}
            bringUpAction={bringSystemUpAction}
            department={null}
            scopeLabel="System status — Global"
            scopeIcon="🛡️"
            scopeDescription="Locks every department at once — the nuclear option. Use for total deploys or DB-wide maintenance."
          />
          <SystemStatusSection
            isDown={productionStatus.down}
            message={productionStatus.message}
            updatedAt={productionStatus.updatedAt}
            updatedByName={productionUpdatedByName}
            takeDownAction={takeSystemDownAction}
            bringUpAction={bringSystemUpAction}
            department="production"
            scopeLabel="Production"
            scopeIcon="🏭"
            scopeDescription="Locks the cutting / carving / dispatch flow. Finance + Invoicing + Inventory stay live."
          />
          <SystemStatusSection
            isDown={financeStatus.down}
            message={financeStatus.message}
            updatedAt={financeStatus.updatedAt}
            updatedByName={financeUpdatedByName}
            takeDownAction={takeSystemDownAction}
            bringUpAction={bringSystemUpAction}
            department="finance"
            scopeLabel="Finance"
            scopeIcon="💼"
            scopeDescription="Locks the accounts module (/accounts/*). Production + Invoicing + Inventory stay live."
          />
          <SystemStatusSection
            isDown={invoicingStatus.down}
            message={invoicingStatus.message}
            updatedAt={invoicingStatus.updatedAt}
            updatedByName={invoicingUpdatedByName}
            takeDownAction={takeSystemDownAction}
            bringUpAction={bringSystemUpAction}
            department="invoicing"
            scopeLabel="Invoicing"
            scopeIcon="🧾"
            scopeDescription="Locks the customer-invoicing module (/invoicing/*). Production + Finance + Inventory stay live."
          />
          <SystemStatusSection
            isDown={inventoryStatus.down}
            message={inventoryStatus.message}
            updatedAt={inventoryStatus.updatedAt}
            updatedByName={inventoryUpdatedByName}
            takeDownAction={takeSystemDownAction}
            bringUpAction={bringSystemUpAction}
            department="inventory"
            scopeLabel="Inventory"
            scopeIcon="📦"
            scopeDescription="Locks the (stub) inventory module. Production + Finance + Invoicing stay live."
          />
        </MaintenanceCollapsible>
      )}
    </>
  );
}
