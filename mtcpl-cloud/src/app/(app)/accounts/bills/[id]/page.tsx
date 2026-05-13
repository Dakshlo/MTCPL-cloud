import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getProfilesMap } from "@/lib/profiles";
import {
  canApproveBills,
  canManageAccounts,
  canMarkPaid,
  canSubmitBills,
} from "@/lib/accounts-permissions";
import {
  approveBillFormAction,
  cancelBillFormAction,
} from "../../actions";
import { RejectBillForm } from "./reject-bill-form";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ error?: string; saved?: string }>;

const STATUS_TINT: Record<
  string,
  { label: string; bg: string; color: string; border: string }
> = {
  pending_approval: {
    label: "Pending approval",
    bg: "rgba(232,197,114,0.18)",
    color: "var(--gold-dark)",
    border: "var(--gold)",
  },
  approved: { label: "Approved", bg: "rgba(22,101,52,0.10)", color: "#15803d", border: "#86efac" },
  rejected: { label: "Rejected", bg: "rgba(220,38,38,0.10)", color: "#b91c1c", border: "#fca5a5" },
  fully_paid: {
    label: "Fully paid",
    bg: "rgba(15,118,110,0.10)",
    color: "#0f766e",
    border: "rgba(15,118,110,0.4)",
  },
  cancelled: { label: "Cancelled", bg: "rgba(0,0,0,0.06)", color: "var(--muted)", border: "var(--border)" },
};

export default async function BillDetailPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { profile } = await requireAuth();
  const { id } = await params;
  const sp = await searchParams;

  const supabase = createAdminSupabaseClient();
  const { data: bill } = await supabase
    .from("bills")
    .select(
      "id, token, vendor_bill_no, bill_date, description, cost_head, amount_subtotal, gst_percent, amount_gst, amount_total, amount_paid, amount_outstanding, status, rejection_note, submitted_by, submitted_at, approved_by, approved_at, rejected_by, rejected_at, cancelled_by, cancelled_at, bill_vendor_id, bill_vendors(id, name, category, gstin, phone)",
    )
    .eq("id", id)
    .maybeSingle();

  if (!bill) notFound();

  // Cast joined vendor object (PostgREST may return as array depending on relationship)
  type VendorInfo = {
    id: string;
    name: string;
    category: string | null;
    gstin: string | null;
    phone: string | null;
  };
  const vendor: VendorInfo | null = Array.isArray(bill.bill_vendors)
    ? (bill.bill_vendors[0] as VendorInfo) ?? null
    : ((bill.bill_vendors as VendorInfo) ?? null);

  const profilesMap = await getProfilesMap();

  // Payment history (newest first)
  const { data: paymentsRaw } = await supabase
    .from("bill_payments")
    .select(
      "id, status, proposed_amount, proposed_by, proposed_at, confirmed_by, confirmed_at, paid_amount, payment_method, payment_reference, payment_note, paid_by, paid_at, cancelled_by, cancelled_at, cancel_reason",
    )
    .eq("bill_id", id)
    .order("proposed_at", { ascending: false });
  const payments = (paymentsRaw ?? []) as Array<{
    id: string;
    status: string;
    proposed_amount: number;
    proposed_by: string | null;
    proposed_at: string | null;
    confirmed_by: string | null;
    confirmed_at: string | null;
    paid_amount: number | null;
    payment_method: string | null;
    payment_reference: string | null;
    payment_note: string | null;
    paid_by: string | null;
    paid_at: string | null;
    cancelled_by: string | null;
    cancelled_at: string | null;
    cancel_reason: string | null;
  }>;

  const tint = STATUS_TINT[bill.status] ?? STATUS_TINT.cancelled;
  const hasOpenPayment = payments.some((p) => p.status === "proposed" || p.status === "confirmed");
  const isLocked = payments.some((p) => p.status !== "cancelled");
  const isOwnBill = bill.submitted_by === profile.id;
  const canEdit =
    !isLocked &&
    ((bill.status === "rejected" &&
      (canApproveBills(profile) || isOwnBill || canSubmitBills(profile))) ||
      (bill.status === "pending_approval" && canApproveBills(profile)));

  return (
    <section className="page-card">
      <div style={{ marginBottom: 18 }}>
        <Link
          href="/accounts/bills"
          style={{
            color: "var(--muted)",
            textDecoration: "none",
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          ← All bills
        </Link>
      </div>

      {sp.saved && (
        <div
          style={{
            marginBottom: 14,
            padding: "10px 14px",
            background: "rgba(22,101,52,0.10)",
            border: "1px solid #86efac",
            borderRadius: 6,
            color: "#15803d",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          ✓ Bill saved successfully.
        </div>
      )}
      {sp.error && (
        <div
          style={{
            marginBottom: 14,
            padding: "10px 14px",
            background: "rgba(220,38,38,0.08)",
            border: "1.5px solid #dc2626",
            borderRadius: 6,
            color: "#7f1d1d",
            fontSize: 13,
          }}
        >
          <strong>Action failed:</strong> {sp.error}
        </div>
      )}

      {/* Header */}
      <div className="record-head" style={{ marginBottom: 16, alignItems: "flex-start" }}>
        <div>
          <h1
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              margin: 0,
              fontFamily: "ui-monospace, monospace",
            }}
          >
            <code>{bill.token}</code>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                padding: "4px 12px",
                borderRadius: 14,
                background: tint.bg,
                color: tint.color,
                border: `1px solid ${tint.border}`,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
              }}
            >
              {tint.label}
            </span>
          </h1>
          <p className="muted" style={{ marginTop: 6 }}>
            {vendor?.name ?? "—"}
            {vendor?.gstin ? ` · GSTIN ${vendor.gstin}` : ""}
            {" · Vendor bill no "}
            <strong style={{ color: "var(--text)" }}>{bill.vendor_bill_no}</strong>
          </p>
        </div>
        {canEdit && (
          <Link
            href={`/accounts/bills/${bill.id}/edit`}
            style={{
              textDecoration: "none",
              fontSize: 13,
              padding: "8px 16px",
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              fontWeight: 600,
              color: "var(--text)",
            }}
          >
            ✏ Edit
          </Link>
        )}
      </div>

      {/* Amount summary block */}
      <div
        style={{
          padding: "14px 18px",
          background: "var(--surface)",
          border: "1.5px solid var(--gold)",
          borderRadius: 8,
          marginBottom: 16,
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: 16,
            fontFamily: "ui-monospace, monospace",
          }}
        >
          <Stat label="Subtotal" value={`₹${Number(bill.amount_subtotal).toLocaleString("en-IN")}`} />
          <Stat
            label={`GST (${Number(bill.gst_percent)}%)`}
            value={`₹${Number(bill.amount_gst).toLocaleString("en-IN")}`}
          />
          <Stat
            label="Total"
            value={`₹${Number(bill.amount_total).toLocaleString("en-IN")}`}
            highlight
          />
          <Stat
            label="Paid"
            value={`₹${Number(bill.amount_paid).toLocaleString("en-IN")}`}
            tone={Number(bill.amount_paid) > 0 ? "#15803d" : undefined}
          />
          <Stat
            label="Outstanding"
            value={`₹${Number(bill.amount_outstanding).toLocaleString("en-IN")}`}
            tone={Number(bill.amount_outstanding) > 0 ? "#b45309" : "#15803d"}
            highlight
          />
        </div>
      </div>

      {/* Bill details */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
          marginBottom: 16,
        }}
      >
        <InfoBlock label="Bill date">
          {new Date(bill.bill_date).toLocaleDateString("en-IN", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
        </InfoBlock>
        <InfoBlock label="Cost head">
          {bill.cost_head ? (
            <span
              style={{
                fontSize: 12,
                padding: "3px 10px",
                borderRadius: 4,
                background: "rgba(184,115,51,0.10)",
                color: "#b45309",
                fontWeight: 600,
              }}
            >
              {bill.cost_head}
            </span>
          ) : (
            <span className="muted" style={{ fontSize: 12 }}>—</span>
          )}
        </InfoBlock>
      </div>
      <InfoBlock label="Description">
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{bill.description}</p>
      </InfoBlock>

      {/* Rejection note (if any) */}
      {bill.status === "rejected" && bill.rejection_note && (
        <div
          style={{
            marginTop: 14,
            padding: "12px 14px",
            background: "rgba(220,38,38,0.06)",
            border: "1px solid rgba(220,38,38,0.30)",
            borderLeft: "5px solid #dc2626",
            borderRadius: 6,
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "#b91c1c",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: 4,
            }}
          >
            Rejection note
            {bill.rejected_by && profilesMap[bill.rejected_by]
              ? ` · ${profilesMap[bill.rejected_by]}`
              : ""}
          </div>
          <p style={{ margin: 0, fontSize: 13 }}>{bill.rejection_note}</p>
        </div>
      )}

      {/* Owner action buttons (pending_approval only) */}
      {bill.status === "pending_approval" && canApproveBills(profile) && (
        <div
          style={{
            marginTop: 18,
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            padding: "14px",
            background: "rgba(232,197,114,0.08)",
            border: "1.5px solid var(--gold)",
            borderRadius: 8,
          }}
        >
          <form action={approveBillFormAction}>
            <input type="hidden" name="bill_id" value={bill.id} />
            <button className="primary-button" type="submit">
              ✓ Approve bill
            </button>
          </form>
          <RejectBillForm billId={bill.id} />
        </div>
      )}

      {/* Cancel action (developer/owner, only if no payments) */}
      {!isLocked &&
        (bill.status === "pending_approval" || bill.status === "rejected") &&
        (profile.role === "developer" || profile.role === "owner") && (
          <form action={cancelBillFormAction} style={{ marginTop: 12 }}>
            <input type="hidden" name="bill_id" value={bill.id} />
            <button
              type="submit"
              style={{
                fontSize: 12,
                padding: "6px 14px",
                background: "transparent",
                border: "1px dashed var(--border)",
                color: "var(--muted)",
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              Cancel this bill (no payments exist yet)
            </button>
          </form>
        )}

      {/* Approved + has outstanding → link to propose payment */}
      {bill.status === "approved" &&
        Number(bill.amount_outstanding) > 0 &&
        !hasOpenPayment &&
        canManageAccounts(profile) && (
          <div
            style={{
              marginTop: 18,
              padding: "12px 14px",
              background: "rgba(22,101,52,0.08)",
              border: "1.5px solid #86efac",
              borderRadius: 8,
            }}
          >
            <p style={{ margin: 0, fontSize: 13 }}>
              Approved. Pick this bill from{" "}
              <Link href="/accounts" style={{ color: "var(--gold-dark)", fontWeight: 700 }}>
                Due Bills
              </Link>{" "}
              to propose a payment.
            </p>
          </div>
        )}

      {hasOpenPayment && canManageAccounts(profile) && (
        <div
          style={{
            marginTop: 18,
            padding: "12px 14px",
            background: "rgba(184,115,51,0.10)",
            border: "1.5px solid #b45309",
            borderRadius: 8,
          }}
        >
          <p style={{ margin: 0, fontSize: 13 }}>
            A payment is open for this bill. Continue on{" "}
            <Link
              href="/accounts/pay-today"
              style={{ color: "var(--gold-dark)", fontWeight: 700 }}
            >
              Pay Today
            </Link>
            .
          </p>
        </div>
      )}

      {/* Audit trail */}
      <h2 style={{ fontSize: 14, marginTop: 28, marginBottom: 10, color: "var(--muted)" }}>
        Audit trail
      </h2>
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: 0,
          fontSize: 12,
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <AuditRow
          label="Submitted"
          at={bill.submitted_at}
          by={bill.submitted_by ? profilesMap[bill.submitted_by] : null}
        />
        {bill.approved_at && (
          <AuditRow
            label="Approved"
            at={bill.approved_at}
            by={bill.approved_by ? profilesMap[bill.approved_by] : null}
          />
        )}
        {bill.rejected_at && (
          <AuditRow
            label="Rejected"
            at={bill.rejected_at}
            by={bill.rejected_by ? profilesMap[bill.rejected_by] : null}
          />
        )}
        {bill.cancelled_at && (
          <AuditRow
            label="Cancelled"
            at={bill.cancelled_at}
            by={bill.cancelled_by ? profilesMap[bill.cancelled_by] : null}
          />
        )}
      </ul>

      {/* Payment history */}
      <h2 style={{ fontSize: 14, marginTop: 28, marginBottom: 10, color: "var(--muted)" }}>
        Payment history ({payments.length})
      </h2>
      {payments.length === 0 ? (
        <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          No payment rows yet.
        </p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              <th style={thStyle}>Proposed</th>
              <th style={thStyle}>Status</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Proposed ₹</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Paid ₹</th>
              <th style={thStyle}>Method · Ref</th>
              <th style={thStyle}>Who</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.id} style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={tdStyle}>
                  {p.proposed_at
                    ? new Date(p.proposed_at).toLocaleString("en-IN", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "—"}
                </td>
                <td style={tdStyle}>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: "2px 8px",
                      borderRadius: 4,
                      background:
                        p.status === "paid"
                          ? "rgba(22,101,52,0.12)"
                          : p.status === "confirmed"
                            ? "rgba(232,197,114,0.18)"
                            : p.status === "proposed"
                              ? "rgba(15,118,110,0.10)"
                              : "rgba(0,0,0,0.06)",
                      color:
                        p.status === "paid"
                          ? "#15803d"
                          : p.status === "confirmed"
                            ? "var(--gold-dark)"
                            : p.status === "proposed"
                              ? "#0f766e"
                              : "var(--muted)",
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                    }}
                  >
                    {p.status}
                  </span>
                </td>
                <td style={{ ...tdStyle, textAlign: "right", fontFamily: "ui-monospace, monospace" }}>
                  ₹{Number(p.proposed_amount).toLocaleString("en-IN")}
                </td>
                <td style={{ ...tdStyle, textAlign: "right", fontFamily: "ui-monospace, monospace" }}>
                  {p.paid_amount != null
                    ? `₹${Number(p.paid_amount).toLocaleString("en-IN")}`
                    : "—"}
                </td>
                <td style={tdStyle}>
                  {p.payment_method ? (
                    <>
                      <strong>{p.payment_method.toUpperCase()}</strong>
                      {p.payment_reference ? ` · ${p.payment_reference}` : ""}
                    </>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td style={tdStyle}>
                  {p.status === "paid" && p.paid_by
                    ? profilesMap[p.paid_by]
                    : p.status === "cancelled" && p.cancelled_by
                      ? `Cancelled · ${profilesMap[p.cancelled_by] ?? ""}`
                      : p.status === "confirmed" && p.confirmed_by
                        ? `Confirmed · ${profilesMap[p.confirmed_by] ?? ""}`
                        : p.proposed_by
                          ? profilesMap[p.proposed_by]
                          : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Locked-out hint */}
      {isLocked && (
        <p className="muted" style={{ fontSize: 11, marginTop: 14, fontStyle: "italic" }}>
          Bill is locked — payment activity exists. Contact a developer for corrections.
        </p>
      )}
    </section>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 10px",
  fontSize: 10,
  fontWeight: 700,
  color: "var(--muted)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};
const tdStyle: React.CSSProperties = { padding: "8px 10px", verticalAlign: "middle" };

function Stat({
  label,
  value,
  tone,
  highlight,
}: {
  label: string;
  value: string;
  tone?: string;
  highlight?: boolean;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          color: "var(--muted)",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: highlight ? 18 : 14,
          fontWeight: highlight ? 800 : 700,
          color: tone ?? (highlight ? "var(--gold-dark)" : "var(--text)"),
          marginTop: 3,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function InfoBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          color: "var(--muted)",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}

function AuditRow({
  label,
  at,
  by,
}: {
  label: string;
  at: string | null;
  by: string | null | undefined;
}) {
  return (
    <li style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          minWidth: 90,
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: 12 }}>
        {at
          ? new Date(at).toLocaleString("en-IN", {
              day: "numeric",
              month: "short",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })
          : "—"}
        {by && (
          <>
            {" · "}
            <span style={{ color: "var(--gold-dark)", fontWeight: 600 }}>{by}</span>
          </>
        )}
      </span>
    </li>
  );
}
