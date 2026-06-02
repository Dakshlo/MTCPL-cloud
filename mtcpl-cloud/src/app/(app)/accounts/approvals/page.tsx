import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getProfilesMap } from "@/lib/profiles";
import { canApproveBills, canApproveDebit } from "@/lib/accounts-permissions";
import { ApprovalsClient, type ApprovalBillRow } from "./approvals-client";
import {
  approveBillAction,
  rejectBillAction,
  approveDebitSettlementFormAction,
  rejectDebitSettlementFormAction,
} from "../actions";
import {
  AccountsHero,
  BUTTON_STYLES,
  ACCOUNTS_TOKENS,
  Money,
  VendorAvatar,
} from "../_ui/components";

export default async function BillsAuditPage() {
  const { profile } = await requireAuth();
  if (!canApproveBills(profile)) {
    redirect("/accounts");
  }

  const supabase = createAdminSupabaseClient();
  const profilesMap = await getProfilesMap();

  const { data: rowsRaw, error } = await supabase
    .from("bills")
    .select(
      "id, token, vendor_bill_no, bill_date, description, cost_head, amount_subtotal, gst_percent, amount_total, status, rejection_note, submitted_by, submitted_at, rejected_by, rejected_at, bill_vendor_id, bill_vendors(id, name, gstin)",
    )
    .in("status", ["pending_approval", "rejected"])
    .order("submitted_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);

  type DbRow = {
    id: string;
    token: string;
    vendor_bill_no: string;
    bill_date: string;
    description: string;
    cost_head: string | null;
    amount_subtotal: number;
    gst_percent: number;
    amount_total: number;
    status: string;
    rejection_note: string | null;
    submitted_by: string | null;
    submitted_at: string | null;
    rejected_by: string | null;
    rejected_at: string | null;
    bill_vendor_id: string;
    bill_vendors:
      | { id: string; name: string; gstin: string | null }
      | { id: string; name: string; gstin: string | null }[]
      | null;
  };

  const dbRows = ((rowsRaw ?? []) as unknown) as DbRow[];

  const rows: ApprovalBillRow[] = dbRows.map((r) => {
    const v = Array.isArray(r.bill_vendors) ? r.bill_vendors[0] ?? null : r.bill_vendors;
    return {
      id: r.id,
      token: r.token,
      vendorName: v?.name ?? "—",
      vendorGstin: v?.gstin ?? null,
      vendorBillNo: r.vendor_bill_no,
      billDate: r.bill_date,
      description: r.description,
      costHead: r.cost_head,
      amountSubtotal: Number(r.amount_subtotal),
      gstPercent: Number(r.gst_percent),
      amountTotal: Number(r.amount_total),
      status: r.status as "pending_approval" | "rejected",
      rejectionNote: r.rejection_note,
      submittedByName: r.submitted_by ? profilesMap[r.submitted_by] ?? "Unknown" : null,
      submittedAt: r.submitted_at,
      rejectedByName: r.rejected_by ? profilesMap[r.rejected_by] ?? "Unknown" : null,
      rejectedAt: r.rejected_at,
    };
  });

  const awaiting = rows.filter((r) => r.status === "pending_approval");
  const rejected = rows.filter((r) => r.status === "rejected");

  // Mig 085 — pending debit settlements awaiting OWNER approval. Only
  // owner / developer see + act on these (canApproveDebit); a
  // crosscheck user on this page sees the bills queue only.
  type PendingDebit = {
    id: string;
    amount: number;
    note: string | null;
    vendorName: string;
    sourceBillToken: string;
    targetBillToken: string;
    createdByName: string | null;
    createdAt: string | null;
  };
  let pendingDebits: PendingDebit[] = [];
  if (canApproveDebit(profile)) {
    const { data: dsRaw } = await supabase
      .from("bill_debit_settlements")
      .select(
        "id, amount, note, vendor_id, source_bill_id, target_bill_id, created_by, created_at",
      )
      .eq("status", "pending_approval")
      .order("created_at", { ascending: true })
      .limit(200);
    const ds = (dsRaw ?? []) as Array<{
      id: string;
      amount: number | string;
      note: string | null;
      vendor_id: string;
      source_bill_id: string;
      target_bill_id: string;
      created_by: string | null;
      created_at: string | null;
    }>;
    if (ds.length > 0) {
      const billIds = Array.from(
        new Set(ds.flatMap((d) => [d.source_bill_id, d.target_bill_id])),
      );
      const vendorIds = Array.from(new Set(ds.map((d) => d.vendor_id)));
      const [{ data: billRows }, { data: vendorRows }] = await Promise.all([
        supabase.from("bills").select("id, token").in("id", billIds),
        supabase.from("bill_vendors").select("id, name").in("id", vendorIds),
      ]);
      const billTokenById = new Map(
        ((billRows ?? []) as Array<{ id: string; token: string }>).map((b) => [
          b.id,
          b.token,
        ]),
      );
      const vendorNameById = new Map(
        ((vendorRows ?? []) as Array<{ id: string; name: string }>).map((v) => [
          v.id,
          v.name,
        ]),
      );
      pendingDebits = ds.map((d) => ({
        id: d.id,
        amount: Number(d.amount ?? 0),
        note: d.note,
        vendorName: vendorNameById.get(d.vendor_id) ?? "—",
        sourceBillToken: billTokenById.get(d.source_bill_id) ?? "—",
        targetBillToken: billTokenById.get(d.target_bill_id) ?? "—",
        createdByName: d.created_by ? profilesMap[d.created_by] ?? "Unknown" : null,
        createdAt: d.created_at,
      }));
    }
  }

  return (
    <section className="page-card">
      <AccountsHero
        title="Crosscheck Queue"
        description="Verify every bill submission before it lands in the accountant's outstanding list. Approve as-is or send back to the submitter with a note. Owner can also approve here as a fallback (Mig 037)."
        actions={
          <Link href="/accounts" style={BUTTON_STYLES.secondary}>
            ← Accounts
          </Link>
        }
      />

      {/* Mig 085 — debit-settlement approvals (owner / developer only).
          Approving applies the debit to the chosen bill (its
          outstanding drops); rejecting leaves the flag open. */}
      {pendingDebits.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 800,
              color: ACCOUNTS_TOKENS.accent,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              margin: "0 2px 10px",
            }}
          >
            ⇄ Debit approvals ({pendingDebits.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {pendingDebits.map((d) => (
              <div
                key={d.id}
                style={{
                  background: "#fff",
                  border: `1px solid ${ACCOUNTS_TOKENS.border}`,
                  borderLeft: `4px solid ${ACCOUNTS_TOKENS.accent}`,
                  borderRadius: 12,
                  padding: "14px 16px",
                  boxShadow: ACCOUNTS_TOKENS.shadow,
                  display: "flex",
                  gap: 14,
                  alignItems: "flex-start",
                  flexWrap: "wrap",
                }}
              >
                <VendorAvatar name={d.vendorName} size={42} />
                <div style={{ flex: "1 1 240px", minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 800 }}>
                    {d.vendorName}
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      marginTop: 4,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      flexWrap: "wrap",
                    }}
                  >
                    <span style={{ fontWeight: 700 }}>Debit</span>
                    <Money value={d.amount} tone="warning" />
                    <span style={{ color: "var(--muted)" }}>
                      from{" "}
                      <code style={{ fontFamily: "ui-monospace, monospace" }}>
                        {d.sourceBillToken}
                      </code>{" "}
                      → apply to{" "}
                      <code
                        style={{
                          fontFamily: "ui-monospace, monospace",
                          color: ACCOUNTS_TOKENS.accent,
                          fontWeight: 700,
                        }}
                      >
                        {d.targetBillToken}
                      </code>
                    </span>
                  </div>
                  {d.note && (
                    <div
                      style={{
                        fontSize: 12,
                        color: "var(--muted)",
                        marginTop: 4,
                        fontStyle: "italic",
                      }}
                    >
                      “{d.note}”
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                    Raised by {d.createdByName ?? "Unknown"}
                    {d.createdAt
                      ? ` · ${new Date(d.createdAt).toLocaleString("en-IN", {
                          timeZone: "Asia/Kolkata",
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}`
                      : ""}
                  </div>
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    minWidth: 200,
                  }}
                >
                  <form action={approveDebitSettlementFormAction}>
                    <input type="hidden" name="settlement_id" value={d.id} />
                    <button
                      type="submit"
                      style={{
                        width: "100%",
                        padding: "9px 14px",
                        fontSize: 13,
                        fontWeight: 800,
                        background: "#16a34a",
                        color: "#fff",
                        border: "1px solid #15803d",
                        borderRadius: 8,
                        cursor: "pointer",
                      }}
                    >
                      ✓ Approve debit
                    </button>
                  </form>
                  <form
                    action={rejectDebitSettlementFormAction}
                    style={{ display: "flex", gap: 6 }}
                  >
                    <input type="hidden" name="settlement_id" value={d.id} />
                    <input
                      type="text"
                      name="reject_reason"
                      placeholder="Reason (optional)"
                      style={{
                        flex: 1,
                        minWidth: 0,
                        padding: "8px 10px",
                        fontSize: 12,
                        border: `1px solid ${ACCOUNTS_TOKENS.border}`,
                        borderRadius: 8,
                      }}
                    />
                    <button
                      type="submit"
                      style={{
                        padding: "8px 12px",
                        fontSize: 13,
                        fontWeight: 800,
                        background: "#fff",
                        color: "#b91c1c",
                        border: "1px solid #fca5a5",
                        borderRadius: 8,
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                      }}
                    >
                      ✕ Reject
                    </button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <ApprovalsClient
        awaiting={awaiting}
        rejected={rejected}
        approveAction={approveBillAction}
        rejectAction={rejectBillAction}
      />
    </section>
  );
}
