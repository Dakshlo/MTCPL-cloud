import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getProfilesMap } from "@/lib/profiles";
import {
  canApproveBills,
  canConfirmPayments,
  canManageAccounts,
  canMarkPaid,
  canSubmitBills,
} from "@/lib/accounts-permissions";
import {
  approveBillFormAction,
  cancelBillFormAction,
} from "../../actions";
import { RejectBillForm } from "./reject-bill-form";
import {
  ACCOUNTS_TOKENS,
  BillStatusPill,
  BUTTON_STYLES,
  Money,
  PaymentStatusPill,
  TABLE_STYLES,
  VendorAvatar,
  VendorIdentity,
} from "../../_ui/components";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ error?: string; saved?: string; just_submitted?: string }>;

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
      "id, token, vendor_bill_no, bill_date, description, cost_head, amount_subtotal, gst_percent, cgst_percent, sgst_percent, igst_percent, tds_percent, tcs_percent, amount_gst, amount_cgst, amount_sgst, amount_igst, amount_tds, amount_tcs, amount_total, amount_payable_to_vendor, amount_paid, amount_outstanding, status, rejection_note, submitted_by, submitted_at, approved_by, approved_at, rejected_by, rejected_at, cancelled_by, cancelled_at, bill_vendor_id, bill_vendors(id, name, category, gstin, phone, email, address, bank_name, bank_account, ifsc, upi_id, tds_applicable, tcs_applicable)",
    )
    .eq("id", id)
    .maybeSingle();

  if (!bill) notFound();

  type VendorInfo = {
    id: string;
    name: string;
    category: string | null;
    gstin: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    bank_name: string | null;
    bank_account: string | null;
    ifsc: string | null;
    upi_id: string | null;
  };
  const vendor: VendorInfo | null = Array.isArray(bill.bill_vendors)
    ? (bill.bill_vendors[0] as VendorInfo) ?? null
    : ((bill.bill_vendors as VendorInfo) ?? null);

  const profilesMap = await getProfilesMap();

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

  const hasOpenPayment = payments.some((p) => p.status === "proposed" || p.status === "confirmed");
  const isLocked = payments.some((p) => p.status !== "cancelled");
  const isOwnBill = bill.submitted_by === profile.id;
  const canEdit =
    !isLocked &&
    ((bill.status === "rejected" &&
      (canApproveBills(profile) || isOwnBill || canSubmitBills(profile))) ||
      (bill.status === "pending_approval" && canApproveBills(profile)) ||
      // Mig 042 follow-on (Daksh): once a bill is in the due-bills
      // list, only the owner can edit. Accountant cannot — they must
      // ask the owner. The button stays hidden for them.
      (bill.status === "approved" && canConfirmPayments(profile)));

  // Timeline events for the right rail
  const timeline: Array<{ at: string; label: string; by: string | null; tone: string }> = [];
  if (bill.submitted_at) {
    timeline.push({
      at: bill.submitted_at,
      label: "Submitted",
      by: bill.submitted_by ? profilesMap[bill.submitted_by] ?? null : null,
      tone: ACCOUNTS_TOKENS.neutral,
    });
  }
  if (bill.approved_at) {
    timeline.push({
      at: bill.approved_at,
      label: "Approved",
      by: bill.approved_by ? profilesMap[bill.approved_by] ?? null : null,
      tone: ACCOUNTS_TOKENS.success,
    });
  }
  if (bill.rejected_at) {
    timeline.push({
      at: bill.rejected_at,
      label: "Rejected",
      by: bill.rejected_by ? profilesMap[bill.rejected_by] ?? null : null,
      tone: ACCOUNTS_TOKENS.danger,
    });
  }
  if (bill.cancelled_at) {
    timeline.push({
      at: bill.cancelled_at,
      label: "Cancelled",
      by: bill.cancelled_by ? profilesMap[bill.cancelled_by] ?? null : null,
      tone: ACCOUNTS_TOKENS.neutral,
    });
  }
  for (const p of payments) {
    if (p.paid_at) {
      timeline.push({
        at: p.paid_at,
        label: `Paid ₹${Number(p.paid_amount ?? 0).toLocaleString("en-IN")} · ${p.payment_method?.toUpperCase() ?? "—"}`,
        by: p.paid_by ? profilesMap[p.paid_by] ?? null : null,
        tone: ACCOUNTS_TOKENS.success,
      });
    } else if (p.confirmed_at) {
      timeline.push({
        at: p.confirmed_at,
        label: `Payment confirmed · ₹${Number(p.proposed_amount).toLocaleString("en-IN")}`,
        by: p.confirmed_by ? profilesMap[p.confirmed_by] ?? null : null,
        tone: ACCOUNTS_TOKENS.warning,
      });
    } else if (p.proposed_at) {
      timeline.push({
        at: p.proposed_at,
        label: `Payment proposed · ₹${Number(p.proposed_amount).toLocaleString("en-IN")}`,
        by: p.proposed_by ? profilesMap[p.proposed_by] ?? null : null,
        tone: ACCOUNTS_TOKENS.accent,
      });
    }
    if (p.cancelled_at) {
      timeline.push({
        at: p.cancelled_at,
        label: `Payment cancelled${p.cancel_reason ? ` · ${p.cancel_reason}` : ""}`,
        by: p.cancelled_by ? profilesMap[p.cancelled_by] ?? null : null,
        tone: ACCOUNTS_TOKENS.neutral,
      });
    }
  }
  timeline.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return (
    <section className="page-card">
      <div style={{ marginBottom: 14 }}>
        <Link
          href="/accounts/bills"
          style={{
            color: "var(--muted)",
            textDecoration: "none",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          ← All bills
        </Link>
      </div>

      {sp.saved && (
        <FlashBanner tone="success">✓ Saved successfully.</FlashBanner>
      )}
      {sp.error && (
        <FlashBanner tone="danger"><strong>Action failed:</strong> {sp.error}</FlashBanner>
      )}

      {/* Mig 042 — fresh-submit banner. Renders only when the
          page is reached via the new-bill redirect with
          `?just_submitted=1`. The token blinks (CSS animation) and
          sits big at the top of the page so the biller is reminded
          to write it on the physical bill. Once they leave/refresh
          without the flag, it goes away. */}
      {sp.just_submitted && (
        <>
          {/* Style block for the blink animation. Scoped to this page
              via a unique class name so it can't leak. */}
          <style>{`
            @keyframes mtcpl-token-blink {
              0%,   60%  { opacity: 1; transform: scale(1); }
              80%        { opacity: 0.35; transform: scale(0.985); }
              100%       { opacity: 1; transform: scale(1); }
            }
            .mtcpl-token-blink {
              animation: mtcpl-token-blink 1.4s ease-in-out infinite;
            }
            @media (prefers-reduced-motion: reduce) {
              .mtcpl-token-blink { animation: none; }
            }
          `}</style>
          <div
            style={{
              marginBottom: 18,
              padding: "16px 22px",
              background: "linear-gradient(135deg, #fff7ed 0%, #fffaf3 100%)",
              border: `2px solid ${ACCOUNTS_TOKENS.warning}`,
              borderRadius: 14,
              display: "flex",
              gap: 18,
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              boxShadow: "0 4px 12px rgba(217, 119, 6, 0.18)",
            }}
          >
            <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
              <span style={{ fontSize: 34, lineHeight: 1 }} aria-hidden>✍️</span>
              <div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 800,
                    color: ACCOUNTS_TOKENS.warning,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                  }}
                >
                  Write this on the physical bill before filing
                </div>
                <div
                  style={{
                    marginTop: 2,
                    fontSize: 13,
                    color: "var(--text)",
                    lineHeight: 1.5,
                    fontWeight: 600,
                  }}
                >
                  Bill submitted and queued for crosscheck audit. Pen the
                  token below on the paper bill so we can match it back to
                  this entry later.
                </div>
              </div>
            </div>
            <code
              className="mtcpl-token-blink"
              style={{
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: 32,
                fontWeight: 800,
                padding: "10px 22px",
                background: "#fff",
                color: ACCOUNTS_TOKENS.warning,
                border: `3px dashed ${ACCOUNTS_TOKENS.warning}`,
                borderRadius: 10,
                letterSpacing: "0.04em",
              }}
            >
              {bill.token}
            </code>
          </div>
        </>
      )}

      {/* Hero block — token, vendor, total, status */}
      <div
        style={{
          background: "linear-gradient(135deg, #f8fafc 0%, #ffffff 100%)",
          border: `1px solid ${ACCOUNTS_TOKENS.border}`,
          borderRadius: 14,
          padding: "20px 22px",
          marginBottom: 18,
          boxShadow: ACCOUNTS_TOKENS.shadow,
          display: "flex",
          gap: 20,
          flexWrap: "wrap",
          alignItems: "flex-start",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", minWidth: 0 }}>
          <VendorAvatar name={vendor?.name ?? "?"} size={56} />
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
              <code
                style={{
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  fontSize: 14,
                  fontWeight: 700,
                  padding: "3px 10px",
                  background: ACCOUNTS_TOKENS.accentLight,
                  color: ACCOUNTS_TOKENS.accent,
                  borderRadius: 6,
                  letterSpacing: "0.02em",
                }}
              >
                {bill.token}
              </code>
              <BillStatusPill status={bill.status} />
            </div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.02em" }}>
              {vendor?.name ?? "Unknown vendor"}
            </h1>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--muted)" }}>
              Vendor bill <code style={{ fontFamily: "ui-monospace, monospace", color: "var(--text)" }}>{bill.vendor_bill_no}</code>
              {" · "}
              {new Date(bill.bill_date).toLocaleDateString("en-IN", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
              {bill.cost_head ? <> · <span style={{ color: ACCOUNTS_TOKENS.warning, fontWeight: 600 }}>{bill.cost_head}</span></> : null}
            </p>
          </div>
        </div>
        <div style={{ textAlign: "right", minWidth: 220 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
            Bill total
          </div>
          <Money value={Number(bill.amount_total)} size="hero" tone="accent" />
          {/* Full tax breakdown — CGST + SGST OR IGST, plus TDS / TCS
              when the bill carried them. Existing bills (entered
              before mig 042) have all the new percents at 0 and just
              fall back to showing the legacy GST line. */}
          <div
            style={{
              marginTop: 8,
              fontSize: 11,
              fontFamily: "ui-monospace, monospace",
              color: "var(--muted)",
              display: "flex",
              flexDirection: "column",
              gap: 3,
              alignItems: "flex-end",
            }}
          >
            <BreakdownRow label="Net" value={Number(bill.amount_subtotal)} />
            {Number(bill.cgst_percent ?? 0) > 0 && (
              <BreakdownRow
                label={`CGST ${Number(bill.cgst_percent)}%`}
                value={Number(bill.amount_cgst ?? 0)}
              />
            )}
            {Number(bill.sgst_percent ?? 0) > 0 && (
              <BreakdownRow
                label={`SGST ${Number(bill.sgst_percent)}%`}
                value={Number(bill.amount_sgst ?? 0)}
              />
            )}
            {Number(bill.igst_percent ?? 0) > 0 && (
              <BreakdownRow
                label={`IGST ${Number(bill.igst_percent)}%`}
                value={Number(bill.amount_igst ?? 0)}
              />
            )}
            {/* Legacy bills (mig 028) that only have gst_percent and
                no breakdown — show the single GST line. */}
            {Number(bill.cgst_percent ?? 0) === 0 &&
              Number(bill.sgst_percent ?? 0) === 0 &&
              Number(bill.igst_percent ?? 0) === 0 &&
              Number(bill.gst_percent) > 0 && (
                <BreakdownRow
                  label={`GST ${Number(bill.gst_percent)}%`}
                  value={Number(bill.amount_gst)}
                />
              )}
            {Number(bill.tds_percent ?? 0) > 0 && (
              <BreakdownRow
                label={`− TDS ${Number(bill.tds_percent)}%`}
                value={Number(bill.amount_tds ?? 0)}
                tone="danger"
              />
            )}
            {Number(bill.tcs_percent ?? 0) > 0 && (
              <BreakdownRow
                label={`+ TCS ${Number(bill.tcs_percent)}%`}
                value={Number(bill.amount_tcs ?? 0)}
              />
            )}
            {(Number(bill.tds_percent ?? 0) > 0 ||
              Number(bill.tcs_percent ?? 0) > 0) && (
              <div
                style={{
                  marginTop: 4,
                  paddingTop: 4,
                  borderTop: `1px dashed ${ACCOUNTS_TOKENS.border}`,
                  width: "100%",
                  display: "flex",
                  justifyContent: "space-between",
                  fontWeight: 700,
                  color: ACCOUNTS_TOKENS.success,
                }}
              >
                <span>Pay vendor</span>
                <span>
                  ₹{Number(
                    bill.amount_payable_to_vendor ?? bill.amount_total,
                  ).toLocaleString("en-IN")}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Two-column body: details + side rail */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(280px, 340px)",
          gap: 18,
        }}
      >
        {/* LEFT column — payment summary + description + payment history */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Payment summary cards */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 12,
            }}
          >
            <SummaryCard
              label="Total"
              value={<Money value={Number(bill.amount_total)} size="large" />}
              tone={ACCOUNTS_TOKENS.neutral}
            />
            <SummaryCard
              label="Paid"
              value={
                Number(bill.amount_paid) > 0 ? (
                  <Money value={Number(bill.amount_paid)} size="large" tone="success" />
                ) : (
                  <span style={{ fontSize: 16, color: "var(--muted)", fontWeight: 600 }}>—</span>
                )
              }
              tone={ACCOUNTS_TOKENS.success}
            />
            <SummaryCard
              label="Outstanding"
              value={
                Number(bill.amount_outstanding) > 0 ? (
                  <Money value={Number(bill.amount_outstanding)} size="large" tone="warning" />
                ) : (
                  <span style={{ fontSize: 16, color: ACCOUNTS_TOKENS.success, fontWeight: 700 }}>Cleared</span>
                )
              }
              tone={Number(bill.amount_outstanding) > 0 ? ACCOUNTS_TOKENS.warning : ACCOUNTS_TOKENS.success}
            />
          </div>

          {/* Description */}
          <Section title="Description">
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap", color: "var(--text)" }}>
              {bill.description}
            </p>
          </Section>

          {/* Rejection note */}
          {bill.status === "rejected" && bill.rejection_note && (
            <div
              style={{
                padding: "14px 16px",
                background: ACCOUNTS_TOKENS.dangerLight,
                border: `1px solid ${ACCOUNTS_TOKENS.danger}`,
                borderLeft: `4px solid ${ACCOUNTS_TOKENS.danger}`,
                borderRadius: 10,
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: ACCOUNTS_TOKENS.danger,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  marginBottom: 4,
                }}
              >
                Rejected
                {bill.rejected_by && profilesMap[bill.rejected_by]
                  ? ` · by ${profilesMap[bill.rejected_by]}`
                  : ""}
              </div>
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>{bill.rejection_note}</p>
            </div>
          )}

          {/* Owner audit actions */}
          {bill.status === "pending_approval" && canApproveBills(profile) && (
            <div
              style={{
                padding: 16,
                background: ACCOUNTS_TOKENS.accentLight,
                border: `1.5px solid ${ACCOUNTS_TOKENS.accentBorder}`,
                borderRadius: 12,
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              <span style={{ fontSize: 13, color: ACCOUNTS_TOKENS.accent, fontWeight: 600, flex: 1, minWidth: 200 }}>
                ⏱ This bill is waiting for your audit. Review the entry against the physical bill.
              </span>
              <form action={approveBillFormAction} style={{ display: "inline" }}>
                <input type="hidden" name="bill_id" value={bill.id} />
                <button type="submit" style={BUTTON_STYLES.primary}>
                  ✓ Approve bill
                </button>
              </form>
              <RejectBillForm billId={bill.id} />
            </div>
          )}

          {/* Payment history */}
          <Section
            title={`Payment history`}
            subtitle={`${payments.length} record${payments.length === 1 ? "" : "s"}`}
          >
            {payments.length === 0 ? (
              <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", padding: "10px 4px" }}>
                No payment activity yet.
              </p>
            ) : (
              <div style={{ overflowX: "auto", marginTop: 6 }}>
                <table style={TABLE_STYLES.table}>
                  <thead style={TABLE_STYLES.thead}>
                    <tr>
                      <th style={TABLE_STYLES.th}>Status</th>
                      <th style={TABLE_STYLES.th}>Activity</th>
                      <th style={TABLE_STYLES.thRight}>Proposed</th>
                      <th style={TABLE_STYLES.thRight}>Paid</th>
                      <th style={TABLE_STYLES.th}>Method · Ref</th>
                      <th style={TABLE_STYLES.th}>Who</th>
                      <th style={TABLE_STYLES.th}>Voucher</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((p) => (
                      <tr key={p.id}>
                        <td style={TABLE_STYLES.td}>
                          <PaymentStatusPill status={p.status} />
                        </td>
                        <td style={{ ...TABLE_STYLES.td, fontSize: 12, color: "var(--muted)" }}>
                          {p.paid_at
                            ? new Date(p.paid_at).toLocaleString("en-IN", {
                                day: "numeric",
                                month: "short",
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                            : p.proposed_at
                              ? new Date(p.proposed_at).toLocaleString("en-IN", {
                                  day: "numeric",
                                  month: "short",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })
                              : "—"}
                        </td>
                        <td style={TABLE_STYLES.tdRight}>
                          <Money value={Number(p.proposed_amount)} size="small" tone="muted" />
                        </td>
                        <td style={TABLE_STYLES.tdRight}>
                          {p.paid_amount != null ? (
                            <Money value={Number(p.paid_amount)} size="small" tone="success" />
                          ) : (
                            <span style={{ color: "var(--muted)" }}>—</span>
                          )}
                        </td>
                        <td style={{ ...TABLE_STYLES.td, fontSize: 12 }}>
                          {p.payment_method ? (
                            <>
                              <strong style={{ textTransform: "uppercase", letterSpacing: "0.04em" }}>
                                {p.payment_method}
                              </strong>
                              {p.payment_reference ? <span style={{ color: "var(--muted)" }}> · {p.payment_reference}</span> : null}
                            </>
                          ) : (
                            <span style={{ color: "var(--muted)" }}>—</span>
                          )}
                        </td>
                        <td style={{ ...TABLE_STYLES.td, fontSize: 12, color: "var(--muted)" }}>
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
                        <td style={{ ...TABLE_STYLES.td, fontSize: 12 }}>
                          {p.status === "paid" ? (
                            <Link
                              href={`/accounts/payments/${p.id}/voucher`}
                              title="Open the printable payment voucher"
                              style={{
                                textDecoration: "none",
                                color: ACCOUNTS_TOKENS.accent,
                                fontWeight: 700,
                                fontSize: 11,
                                padding: "3px 10px",
                                background: ACCOUNTS_TOKENS.accentLight,
                                border: `1px solid ${ACCOUNTS_TOKENS.accentBorder ?? ACCOUNTS_TOKENS.accent}`,
                                borderRadius: 6,
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 4,
                                whiteSpace: "nowrap",
                              }}
                            >
                              🖨 Voucher
                            </Link>
                          ) : (
                            <span style={{ color: "var(--muted)" }}>—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {isLocked && (
            <p style={{ fontSize: 11, color: "var(--muted)", fontStyle: "italic" }}>
              Bill is locked — payment activity exists. Contact a developer for corrections.
            </p>
          )}
        </div>

        {/* RIGHT rail — vendor info + timeline + secondary actions */}
        <aside style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Vendor card */}
          {vendor && (
            <div
              style={{
                background: "#fff",
                border: `1px solid ${ACCOUNTS_TOKENS.border}`,
                borderRadius: 12,
                padding: 16,
                boxShadow: ACCOUNTS_TOKENS.shadow,
              }}
            >
              <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
                Vendor
              </div>
              <VendorIdentity
                name={vendor.name}
                subLabel={vendor.category ?? undefined}
                size={36}
                href={`/accounts/vendors/${vendor.id}`}
              />
              <dl style={{ margin: "14px 0 0", display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
                {vendor.gstin && <KV k="GSTIN" v={vendor.gstin} mono />}
                {vendor.phone && <KV k="Phone" v={vendor.phone} />}
                {vendor.email && <KV k="Email" v={vendor.email} />}
                {vendor.upi_id && <KV k="UPI" v={vendor.upi_id} mono />}
                {vendor.bank_name && <KV k="Bank" v={vendor.bank_name} />}
                {vendor.ifsc && <KV k="IFSC" v={vendor.ifsc} mono />}
              </dl>
            </div>
          )}

          {/* Actions */}
          {canEdit && (
            <div
              style={{
                background: "#fff",
                border: `1px solid ${ACCOUNTS_TOKENS.border}`,
                borderRadius: 12,
                padding: 16,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Actions
              </div>
              <Link href={`/accounts/bills/${bill.id}/edit`} style={BUTTON_STYLES.secondary}>
                ✏ Edit bill
              </Link>
              {!isLocked &&
                (bill.status === "pending_approval" || bill.status === "rejected") &&
                (profile.role === "developer" || profile.role === "owner") && (
                  <form action={cancelBillFormAction}>
                    <input type="hidden" name="bill_id" value={bill.id} />
                    <button type="submit" style={{ ...BUTTON_STYLES.ghost, width: "100%" }}>
                      Cancel this bill
                    </button>
                  </form>
                )}
            </div>
          )}

          {/* Approved + has outstanding → reminder */}
          {bill.status === "approved" &&
            Number(bill.amount_outstanding) > 0 &&
            !hasOpenPayment &&
            canManageAccounts(profile) && (
              <div
                style={{
                  background: ACCOUNTS_TOKENS.successLight,
                  border: `1px solid ${ACCOUNTS_TOKENS.success}`,
                  borderRadius: 12,
                  padding: 14,
                  fontSize: 13,
                  color: ACCOUNTS_TOKENS.success,
                  fontWeight: 600,
                }}
              >
                Ready for payment proposal —{" "}
                <Link href="/accounts" style={{ color: ACCOUNTS_TOKENS.success, fontWeight: 700, textDecoration: "underline" }}>
                  open Due Bills
                </Link>
              </div>
            )}
          {hasOpenPayment && canManageAccounts(profile) && (
            <div
              style={{
                background: ACCOUNTS_TOKENS.warningLight,
                border: `1px solid ${ACCOUNTS_TOKENS.warning}`,
                borderRadius: 12,
                padding: 14,
                fontSize: 13,
                color: ACCOUNTS_TOKENS.warning,
                fontWeight: 600,
              }}
            >
              Payment in flight —{" "}
              <Link href="/accounts/pay-today" style={{ color: ACCOUNTS_TOKENS.warning, fontWeight: 700, textDecoration: "underline" }}>
                continue on Pay Today
              </Link>
            </div>
          )}

          {/* Audit timeline */}
          <div
            style={{
              background: "#fff",
              border: `1px solid ${ACCOUNTS_TOKENS.border}`,
              borderRadius: 12,
              padding: 16,
              boxShadow: ACCOUNTS_TOKENS.shadow,
            }}
          >
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>
              Audit trail
            </div>
            {timeline.length === 0 ? (
              <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>No events yet.</p>
            ) : (
              <ol style={{ listStyle: "none", padding: 0, margin: 0, position: "relative" }}>
                {/* vertical line */}
                <span
                  style={{
                    position: "absolute",
                    left: 6,
                    top: 6,
                    bottom: 6,
                    width: 1.5,
                    background: ACCOUNTS_TOKENS.border,
                  }}
                />
                {timeline.map((e, i) => (
                  <li key={i} style={{ position: "relative", paddingLeft: 22, paddingBottom: i === timeline.length - 1 ? 0 : 14 }}>
                    <span
                      style={{
                        position: "absolute",
                        left: 0,
                        top: 3,
                        width: 13,
                        height: 13,
                        borderRadius: "50%",
                        background: e.tone,
                        border: `2px solid var(--surface, #fff)`,
                      }}
                    />
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>
                      {e.label}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>
                      {new Date(e.at).toLocaleString("en-IN", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {e.by ? ` · ${e.by}` : ""}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}

function FlashBanner({
  tone,
  children,
}: {
  tone: "success" | "danger";
  children: React.ReactNode;
}) {
  const tones = {
    success: { bg: ACCOUNTS_TOKENS.successLight, border: ACCOUNTS_TOKENS.success, fg: ACCOUNTS_TOKENS.success },
    danger: { bg: ACCOUNTS_TOKENS.dangerLight, border: ACCOUNTS_TOKENS.danger, fg: ACCOUNTS_TOKENS.danger },
  };
  const t = tones[tone];
  return (
    <div
      style={{
        marginBottom: 12,
        padding: "10px 14px",
        background: t.bg,
        border: `1px solid ${t.border}`,
        borderRadius: 8,
        color: t.fg,
        fontSize: 13,
      }}
    >
      {children}
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "#fff",
        border: `1px solid ${ACCOUNTS_TOKENS.border}`,
        borderRadius: 12,
        padding: 16,
        boxShadow: ACCOUNTS_TOKENS.shadow,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.005em" }}>
          {title}
        </h3>
        {subtitle && (
          <span style={{ fontSize: 11, color: "var(--muted)" }}>{subtitle}</span>
        )}
      </div>
      {children}
    </div>
  );
}

/** Compact "label / value" line for the tax breakdown column.
 *  Mig 042 — shows one row per non-zero tax line so the bill detail
 *  carries the full breakdown the accountant needs. */
function BreakdownRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "muted" | "danger";
}) {
  const color =
    tone === "danger" ? ACCOUNTS_TOKENS.danger : "var(--muted)";
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        width: "100%",
        gap: 10,
      }}
    >
      <span style={{ color }}>{label}</span>
      <span style={{ color: "var(--text)", fontWeight: 600 }}>
        ₹{value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
      </span>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone: string;
}) {
  return (
    <div
      style={{
        padding: 14,
        background: "#fff",
        border: `1px solid ${ACCOUNTS_TOKENS.border}`,
        borderLeft: `3px solid ${tone}`,
        borderRadius: 10,
        boxShadow: ACCOUNTS_TOKENS.shadow,
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div>{value}</div>
    </div>
  );
}

function KV({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
      <dt style={{ color: "var(--muted)", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {k}
      </dt>
      <dd
        style={{
          margin: 0,
          fontFamily: mono ? "ui-monospace, monospace" : undefined,
          color: "var(--text)",
          fontSize: 12,
          textAlign: "right",
          wordBreak: "break-all",
        }}
      >
        {v}
      </dd>
    </div>
  );
}
