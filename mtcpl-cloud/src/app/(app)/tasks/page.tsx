/**
 * Owner's mobile task hub (Daksh, May 2026).
 *
 * Daksh's dad approves Cutting Audit / Crosscheck / Pay Today /
 * Final Audit / Royalty Approval queues. The existing topbar Tasks
 * pill works on desktop, but on a phone the dropdown + the
 * underlying queue pages were too cramped to actually use.
 *
 * This page is a dedicated mobile-first dashboard:
 *   • Big tappable cards (one per queue with a non-zero count).
 *   • Generous thumb targets, department-colour rails so the
 *     owner spots Finance vs Production at a glance.
 *   • Single column layout that fills the screen on a phone;
 *     centres on desktop so it doesn't look weird on a laptop.
 *
 * Roles: anyone who has at least one pending task can open this
 * page. The queries below silently return null for unauthorised
 * branches so the page is safe for every role — a vendor with no
 * pending tasks lands on "All clear" rather than an error.
 *
 * Reuses the same badge-count queries as src/app/(app)/layout.tsx
 * (which feeds the topbar pill). They're duplicated rather than
 * extracted because the layout couples them to bypass/dev-mode
 * logic and a one-time refactor would touch a lot more files than
 * this page needs to.
 */

import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canApproveCuts } from "@/lib/cutting-permissions";
import {
  canApproveBills,
  canConfirmPayments,
  canFinalAudit,
  canSubmitBills,
} from "@/lib/accounts-permissions";
import { canApproveInventoryMovements } from "@/lib/inventory-permissions";

type TaskDepartment = "production" | "finance" | "inventory";

type TaskCard = {
  id: string;
  href: string;
  label: string;
  description: string;
  count: number;
  icon: string;
  department: TaskDepartment;
};

const DEPT_META: Record<
  TaskDepartment,
  { label: string; color: string; bg: string }
> = {
  production: { label: "Production", color: "#c9a14a", bg: "rgba(201,161,74,0.06)" },
  finance:    { label: "Finance",    color: "#5e8c4e", bg: "rgba(94,140,78,0.06)"  },
  inventory:  { label: "Inventory",  color: "#c87850", bg: "rgba(200,120,80,0.06)" },
};

export default async function TasksPage() {
  const { profile } = await requireAuth();
  const supabase = createAdminSupabaseClient();

  // Same set of helpers as layout.tsx — parallelised. Each returns
  // `number | null`; null means "role doesn't qualify, hide this
  // queue entirely" so the rest of the rendering can skip it.
  async function fetchApprovals(): Promise<number | null> {
    if (!canApproveCuts(profile)) return null;
    const { count } = await supabase
      .from("cut_session_blocks")
      .select("*", { count: "exact", head: true })
      .in("status", ["awaiting_approval", "awaiting_cutter_edit"]);
    return count ?? 0;
  }
  async function fetchBillsAudit(): Promise<number | null> {
    if (!canApproveBills(profile)) return null;
    const { count } = await supabase
      .from("bills")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending_approval");
    return count ?? 0;
  }
  async function fetchPayToday(): Promise<number | null> {
    if (!canConfirmPayments(profile)) return null;
    const { count } = await supabase
      .from("bill_payments")
      .select("*", { count: "exact", head: true })
      .in("status", ["proposed", "confirmed"]);
    return count ?? 0;
  }
  async function fetchInventoryAudit(): Promise<number | null> {
    if (!canApproveInventoryMovements(profile)) return null;
    const { data, error } = await supabase
      .from("inventory_movements")
      .select("batch_id")
      .eq("status", "pending_approval");
    if (error) return null;
    return new Set((data ?? []).map((r) => r.batch_id as string)).size;
  }
  async function fetchRejectedBills(): Promise<number | null> {
    if (!canSubmitBills(profile)) return null;
    const { count } = await supabase
      .from("bills")
      .select("*", { count: "exact", head: true })
      .eq("submitted_by", profile.id)
      .eq("status", "rejected");
    return count ?? 0;
  }
  async function fetchFinalAudit(): Promise<number | null> {
    if (!canFinalAudit(profile)) return null;
    const { count, error } = await supabase
      .from("bill_payments")
      .select("*", { count: "exact", head: true })
      .eq("status", "paid")
      .eq("final_audit_status", "pending");
    if (error) return null;
    return count ?? 0;
  }
  async function fetchRoyaltyApproval(): Promise<number | null> {
    if (profile.role !== "owner" && profile.role !== "developer") return null;
    const { count, error } = await supabase
      .from("vendor_royalty_entries")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending_approval")
      .is("cancelled_at", null);
    if (error) return null;
    return count ?? 0;
  }
  // Mig 098 — outsource work orders await owner price approval before any
  // slab can be sent to the vendor. Owner/dev only.
  async function fetchWorkOrderApproval(): Promise<number | null> {
    if (profile.role !== "owner" && profile.role !== "developer") return null;
    const { count, error } = await supabase
      .from("carving_work_orders")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending_approval");
    if (error) return null;
    return count ?? 0;
  }

  const [
    approvals,
    billsAudit,
    payToday,
    inventoryAudit,
    rejectedBills,
    finalAudit,
    royaltyApproval,
    workOrderApproval,
  ] = await Promise.all([
    fetchApprovals(),
    fetchBillsAudit(),
    fetchPayToday(),
    fetchInventoryAudit(),
    fetchRejectedBills(),
    fetchFinalAudit(),
    fetchRoyaltyApproval(),
    fetchWorkOrderApproval(),
  ]);

  const cards: TaskCard[] = [];
  if (rejectedBills !== null) {
    cards.push({
      id: "rejected-bills",
      href: "/accounts/bills?status=rejected",
      label: "Rejected bills",
      description: "Your submissions sent back at crosscheck — edit & resubmit",
      count: rejectedBills,
      icon: "↺",
      department: "finance",
    });
  }
  if (approvals !== null) {
    cards.push({
      id: "cutting-audit",
      href: "/cutting/approvals",
      label: "Cutting Audit",
      description: "Cutter submissions awaiting your sign-off",
      count: approvals,
      icon: "✓",
      department: "production",
    });
  }
  if (billsAudit !== null) {
    cards.push({
      id: "crosscheck",
      href: "/accounts/approvals",
      label: "Crosscheck",
      description: "Bills waiting for verification",
      count: billsAudit,
      icon: "✅",
      department: "finance",
    });
  }
  if (payToday !== null) {
    cards.push({
      id: "pay-today",
      href: "/accounts/pay-today",
      label: "Pay Today",
      description: "Proposed + confirmed payments in flight",
      count: payToday,
      icon: "💸",
      department: "finance",
    });
  }
  if (finalAudit !== null) {
    cards.push({
      id: "final-audit",
      href: "/accounts/final-audit",
      label: "Final Audit",
      description: "Paid payments awaiting UTR recheck",
      count: finalAudit,
      icon: "🧾",
      department: "finance",
    });
  }
  if (royaltyApproval !== null) {
    cards.push({
      id: "royalty-approval",
      href: "/accounts/royalty-approvals",
      label: "Royalty Approval",
      description: "Pending royalty entries awaiting your sign-off",
      count: royaltyApproval,
      icon: "🏷️",
      department: "finance",
    });
  }
  if (workOrderApproval !== null) {
    cards.push({
      id: "work-order-approval",
      href: "/carving/work-orders",
      label: "Work Order Approvals",
      description: "Outsource work orders awaiting your price approval",
      count: workOrderApproval,
      icon: "🏭",
      department: "production",
    });
  }
  if (inventoryAudit !== null) {
    cards.push({
      id: "inventory-audit",
      href: "/inventory/approvals",
      label: "Inventory Audit",
      description: "Stock movement batches awaiting audit",
      count: inventoryAudit,
      icon: "📦",
      department: "inventory",
    });
  }

  const total = cards.reduce((s, c) => s + c.count, 0);

  return (
    <div
      style={{
        maxWidth: 560,
        margin: "0 auto",
        padding: "8px 4px 24px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "14px 16px",
          background: "linear-gradient(135deg, #1a1a1a 0%, #2D2410 60%, #6b4f18 100%)",
          color: "#fff",
          borderRadius: 14,
          boxShadow: "0 4px 16px rgba(45,36,16,0.18)",
        }}
      >
        <div
          style={{
            fontSize: 11,
            color: "rgba(255,255,255,0.55)",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            fontWeight: 700,
          }}
        >
          My Tasks
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginTop: 4,
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.01em" }}>
            {total > 0
              ? `${total} pending`
              : "All clear"}
          </div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.65)" }}>
            {profile.full_name ?? profile.phone ?? "You"}
          </div>
        </div>
        {total > 0 && (
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.65)", marginTop: 4 }}>
            Tap a row to open the queue.
          </div>
        )}
      </div>

      {/* Empty state */}
      {cards.length === 0 && (
        <div
          style={{
            padding: 28,
            textAlign: "center",
            background: "var(--surface)",
            border: "1px dashed var(--border)",
            borderRadius: 12,
            color: "var(--muted)",
            fontSize: 14,
            lineHeight: 1.5,
          }}
        >
          <div style={{ fontSize: 32, marginBottom: 8 }}>🎉</div>
          <div style={{ fontWeight: 700, color: "var(--text)" }}>Nothing to action right now.</div>
          <div style={{ marginTop: 4, fontSize: 12 }}>
            New queue items will appear here as soon as they land.
          </div>
        </div>
      )}

      {/* Task cards — one per queue */}
      {cards.map((c) => {
        const meta = DEPT_META[c.department];
        const hasPending = c.count > 0;
        return (
          <Link
            key={c.id}
            href={c.href}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              padding: "14px 16px",
              background: hasPending ? meta.bg : "var(--surface)",
              border: `1px solid ${hasPending ? meta.color : "var(--border)"}`,
              borderLeft: `5px solid ${meta.color}`,
              borderRadius: 12,
              textDecoration: "none",
              color: "inherit",
              touchAction: "manipulation",
              transition: "transform 0.12s ease, box-shadow 0.12s ease",
              minHeight: 76,
              boxShadow: hasPending ? "0 1px 0 rgba(15,23,42,0.04)" : "none",
            }}
          >
            {/* Big count badge */}
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: "50%",
                background: hasPending ? meta.color : "var(--surface-alt)",
                color: hasPending ? "#fff" : "var(--muted)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                fontWeight: 800,
                fontSize: c.count >= 100 ? 16 : c.count >= 10 ? 18 : 22,
                fontFeatureSettings: '"tnum"',
                letterSpacing: "-0.02em",
                boxShadow: hasPending
                  ? "0 2px 6px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.18)"
                  : "none",
              }}
            >
              {c.count}
            </div>

            {/* Label + description */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 15,
                  fontWeight: 700,
                  color: "var(--text)",
                  lineHeight: 1.2,
                }}
              >
                <span aria-hidden style={{ fontSize: 14 }}>
                  {c.icon}
                </span>
                <span>{c.label}</span>
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--muted)",
                  marginTop: 4,
                  lineHeight: 1.4,
                  overflow: "hidden",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                }}
              >
                {c.description}
              </div>
              <div
                style={{
                  fontSize: 9,
                  color: meta.color,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  fontWeight: 800,
                  marginTop: 5,
                }}
              >
                {meta.label}
              </div>
            </div>

            {/* Chevron */}
            <span
              aria-hidden
              style={{
                fontSize: 22,
                color: "var(--muted)",
                flexShrink: 0,
                lineHeight: 1,
              }}
            >
              ›
            </span>
          </Link>
        );
      })}

      {/* Footer hint */}
      {cards.length > 0 && (
        <p
          style={{
            margin: "8px 4px 0",
            fontSize: 11,
            color: "var(--muted)",
            textAlign: "center",
            lineHeight: 1.5,
          }}
        >
          Tip: bookmark this page on your phone for one-tap access.
        </p>
      )}
    </div>
  );
}
