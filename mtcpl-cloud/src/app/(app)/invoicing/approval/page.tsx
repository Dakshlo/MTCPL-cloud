/**
 * Mig 167 — Invoice approval queue (OWNER sign-off).
 *
 * New invoicing flow: Challans → [accountant prices = "convert"] → Approval
 * (owner) → Invoices. A priced challan waits here until the OWNER approves it
 * (→ becomes a final tax invoice + releases the truck) or rejects it (→ back to
 * the accountant on Challans). Accountants can SEE the queue but only the owner
 * (or developer) gets the Approve / Reject controls.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canUseInvoicing, canApproveInvoice } from "@/lib/invoicing-permissions";
import { computeInvoiceTotals, type GstMode } from "@/lib/challan-pricing";
import { invoiceCode } from "@/lib/invoice-code";
import { invoiceCodeFromDoc } from "@/lib/doc-code";
import {
  ACCOUNTS_TOKENS,
  AccountsHero,
  BUTTON_STYLES,
  EmptyState,
} from "../../accounts/_ui/components";
import { ownerApproveChallanAction, ownerRejectChallanAction, ownerApproveBulkAction, ownerRejectBulkAction } from "../actions";
import { OwnerRejectButton } from "../_ui/owner-reject-button";

// Page through a query — the approval queue can in theory exceed the 1000-row
// PostgREST cap; never silently truncate (mirrors invoices/page.tsx).
async function pageAll<T>(
  make: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let off = 0; off < 100_000; off += PAGE) {
    const { data, error } = await make(off, off + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

type PendingChallan = {
  id: string;
  challan_number: string;
  doc_fy: string | null;
  doc_seq: number | null;
  challan_date: string;
  temple: string | null;
  priced_at: string;
  invoice_no_override: string | null;
  gst_mode: string | null;
  igst_percent: number | null;
  cgst_percent: number | null;
  sgst_percent: number | null;
};

type SearchParams = Promise<{ toast?: string }>;

export default async function InvoiceApprovalPage({ searchParams }: { searchParams: SearchParams }) {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) redirect("/");
  const sp = await searchParams;
  // Owner / developer / account-plus (accountant_star) can act; plain accountant
  // sees the queue read-only (Mig 168).
  const isOwner = canApproveInvoice(profile);

  const supabase = createAdminSupabaseClient();

  // PENDING approval = priced, not yet approved, not rejected, not cancelled,
  // not legacy-converted.
  const pending = await pageAll<PendingChallan>((from, to) =>
    supabase
      .from("challans")
      .select(
        "id, challan_number, doc_fy, doc_seq, challan_date, temple, priced_at, invoice_no_override, gst_mode, igst_percent, cgst_percent, sgst_percent",
      )
      .not("priced_at", "is", null)
      .is("owner_approved_at", null)
      .is("owner_rejected_at", null)
      .is("cancelled_at", null)
      .is("converted_invoice_id", null)
      .order("priced_at", { ascending: false })
      .range(from, to),
  );

  // Grand total per challan from its items + GST snapshot (same computation as
  // invoices/page.tsx so the figures agree end to end).
  const totalByChallan = new Map<string, number>();
  const challanIds = pending.map((c) => c.id);
  for (let i = 0; i < challanIds.length; i += 300) {
    const chunk = challanIds.slice(i, i + 300);
    if (chunk.length === 0) break;
    const { data: items } = await supabase
      .from("challan_items")
      .select("challan_id, amount, rate, measure_qty, quantity")
      .in("challan_id", chunk);
    const byCh = new Map<string, number[]>();
    for (const it of (items ?? []) as Array<{ challan_id: string; amount: number | null; rate: number | null; measure_qty: number | null; quantity: number | null }>) {
      const meas = it.measure_qty != null && Number(it.measure_qty) > 0 ? Number(it.measure_qty) : Number(it.quantity) || 0;
      const amt = it.amount != null ? Number(it.amount) : (Number(it.rate) || 0) * meas;
      const arr = byCh.get(it.challan_id) ?? []; arr.push(amt); byCh.set(it.challan_id, arr);
    }
    for (const c of pending) {
      if (!chunk.includes(c.id)) continue;
      const t = computeInvoiceTotals(byCh.get(c.id) ?? [], {
        mode: (c.gst_mode === "igst" || c.gst_mode === "cgst_sgst" ? c.gst_mode : null) as GstMode,
        igst: Number(c.igst_percent) || 0, cgst: Number(c.cgst_percent) || 0, sgst: Number(c.sgst_percent) || 0,
      });
      totalByChallan.set(c.id, t.grand);
    }
  }

  // Mig 172 — independent invoice number (inv_fy/inv_seq), best-effort batch fetch.
  const invByChallan = new Map<string, { fy: string | null; seq: number | null }>();
  {
    const ids = pending.map((c) => c.id);
    for (let i = 0; i < ids.length; i += 300) {
      const chunk = ids.slice(i, i + 300);
      if (chunk.length === 0) break;
      const { data, error } = await supabase.from("challans").select("id, inv_fy, inv_seq").in("id", chunk);
      if (error) break;
      for (const r of (data ?? []) as Array<{ id: string; inv_fy: string | null; inv_seq: number | null }>) invByChallan.set(r.id, { fy: r.inv_fy, seq: r.inv_seq });
    }
  }
  const codeOf = (c: PendingChallan) =>
    (c.invoice_no_override?.trim() || invoiceCodeFromDoc(invByChallan.get(c.id)?.fy ?? null, invByChallan.get(c.id)?.seq ?? null) || invoiceCodeFromDoc(c.doc_fy, c.doc_seq) || invoiceCode(c.challan_number, c.challan_date));

  // Temple-wise sections (alphabetical), newest priced first within each.
  const grouped = (() => {
    const m = new Map<string, PendingChallan[]>();
    for (const c of pending) { const k = c.temple ?? "—"; const a = m.get(k) ?? []; a.push(c); m.set(k, a); }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  })();

  // Mig 173 — pending BULK invoices (manual multi-challan invoices). Best-effort.
  type BulkPending = { id: string; temple: string; invoice_date: string; inv_fy: string | null; inv_seq: number | null; invoice_no_override: string | null; gst_mode: string | null; igst_percent: number | null; cgst_percent: number | null; sgst_percent: number | null };
  let bulkPending: BulkPending[] = [];
  {
    const { data, error } = await supabase
      .from("bulk_invoices")
      .select("id, temple, invoice_date, inv_fy, inv_seq, invoice_no_override, gst_mode, igst_percent, cgst_percent, sgst_percent")
      .is("owner_approved_at", null).is("owner_rejected_at", null).is("cancelled_at", null)
      .order("created_at", { ascending: false });
    if (!error) bulkPending = (data ?? []) as BulkPending[];
  }
  const bulkTotal = new Map<string, number>();
  if (bulkPending.length) {
    const ids = bulkPending.map((b) => b.id);
    for (let i = 0; i < ids.length; i += 300) {
      const chunk = ids.slice(i, i + 300); if (!chunk.length) break;
      const { data: its } = await supabase.from("bulk_invoice_items").select("bulk_invoice_id, amount, quantity, rate").in("bulk_invoice_id", chunk);
      const byB = new Map<string, number[]>();
      for (const it of (its ?? []) as Array<{ bulk_invoice_id: string; amount: number | null; quantity: number | null; rate: number | null }>) {
        const amt = it.amount != null ? Number(it.amount) : (Number(it.quantity) || 0) * (Number(it.rate) || 0);
        const a = byB.get(it.bulk_invoice_id) ?? []; a.push(amt); byB.set(it.bulk_invoice_id, a);
      }
      for (const b of bulkPending) {
        if (!chunk.includes(b.id)) continue;
        const t = computeInvoiceTotals(byB.get(b.id) ?? [], { mode: (b.gst_mode === "igst" || b.gst_mode === "cgst_sgst" ? b.gst_mode : null) as GstMode, igst: Number(b.igst_percent) || 0, cgst: Number(b.cgst_percent) || 0, sgst: Number(b.sgst_percent) || 0 });
        bulkTotal.set(b.id, t.grand);
      }
    }
  }
  const bulkCodeOf = (b: BulkPending) => (b.invoice_no_override?.trim() || invoiceCodeFromDoc(b.inv_fy, b.inv_seq) || `INV-${b.id.slice(0, 6).toUpperCase()}`);

  return (
    <section className="page-card">
      <AccountsHero
        title="Invoice approval"
        description="Owner signs off on priced challans before they become final tax invoices."
        actions={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link href="/invoicing/challans" style={BUTTON_STYLES.secondary}>📋 Challans</Link>
            <Link href="/invoicing/invoices" style={BUTTON_STYLES.secondary}>🧾 Invoices</Link>
            <Link href="/invoicing" style={{ fontSize: 12, color: "var(--muted)", textDecoration: "none", alignSelf: "center" }}>
              ← Dashboard
            </Link>
          </div>
        }
      />

      {sp.toast && (
        <div style={{ marginTop: 12, fontSize: 13, fontWeight: 700, color: "#15803d", background: "rgba(22,101,52,0.08)", border: "1px solid rgba(22,101,52,0.3)", borderRadius: 8, padding: "8px 12px" }}>
          {sp.toast}
        </div>
      )}

      {!isOwner && (
        <div style={{ marginTop: 12, fontSize: 12.5, color: "#92400e", background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 8, padding: "8px 12px" }}>
          Read-only view — only the owner or account-plus can approve or reject. These bills are waiting on their sign-off.
        </div>
      )}

      <div style={{ marginTop: 18 }}>
        {pending.length === 0 && bulkPending.length === 0 ? (
          <EmptyState
            icon="✅"
            title="Nothing waiting for approval."
            description="Priced challans appear here for the owner to approve into final tax invoices."
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {bulkPending.length > 0 && (
              <div>
                <div style={{ fontWeight: 800, fontSize: 13, color: "var(--text)", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                  📦 Bulk invoices
                  <span style={{ color: "var(--muted)", fontWeight: 600, fontSize: 12 }}>· {bulkPending.length} waiting</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {bulkPending.map((b) => (
                    <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "12px 14px", background: "var(--surface, #fff)", border: `1px solid ${ACCOUNTS_TOKENS.border}`, borderRadius: 10 }}>
                      <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 13, color: ACCOUNTS_TOKENS.accent, minWidth: 120 }}>{bulkCodeOf(b)}</span>
                      <span style={{ fontSize: 12, color: "var(--muted)" }}>🏛 {b.temple}</span>
                      <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 13 }}>₹{(bulkTotal.get(b.id) ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      <Link href={`/invoicing/bulk/${b.id}/print`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, fontWeight: 700, color: "var(--gold-dark, #92400e)", textDecoration: "none" }}>🖨 Review invoice →</Link>
                      <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        {isOwner ? (
                          <>
                            <form action={ownerApproveBulkAction}>
                              <input type="hidden" name="id" value={b.id} />
                              <button type="submit" style={{ fontSize: 12.5, fontWeight: 700, padding: "8px 16px", background: "#16a34a", color: "#fff", border: "1px solid #15803d", borderRadius: 8, cursor: "pointer", whiteSpace: "nowrap" }}>✅ Approve</button>
                            </form>
                            <OwnerRejectButton challanId={b.id} action={ownerRejectBulkAction} idField="id" />
                          </>
                        ) : (
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#92400e", background: "#fef3c7", borderRadius: 999, padding: "4px 10px" }}>Awaiting owner approval</span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {grouped.map(([temple, rows]) => (
              <div key={temple}>
                <div style={{ fontWeight: 800, fontSize: 13, color: "var(--text)", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                  🛕 {temple}
                  <span style={{ color: "var(--muted)", fontWeight: 600, fontSize: 12 }}>· {rows.length} waiting</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {rows.map((c) => (
                    <div
                      key={c.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        flexWrap: "wrap",
                        padding: "12px 14px",
                        background: "var(--surface, #fff)",
                        border: `1px solid ${ACCOUNTS_TOKENS.border}`,
                        borderRadius: 10,
                      }}
                    >
                      <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 13, color: ACCOUNTS_TOKENS.accent, minWidth: 120 }}>
                        {codeOf(c)}
                      </span>
                      <span style={{ fontSize: 12, color: "var(--muted)" }}>
                        {new Date(`${c.challan_date}T00:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })}
                      </span>
                      <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 13 }}>
                        ₹{(totalByChallan.get(c.id) ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                      <Link
                        href={`/invoicing/challan/${c.id}/print`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontSize: 12, fontWeight: 700, color: "var(--gold-dark, #92400e)", textDecoration: "none" }}
                      >
                        🖨 Review invoice →
                      </Link>
                      <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        {isOwner ? (
                          <>
                            <form action={ownerApproveChallanAction}>
                              <input type="hidden" name="challan_id" value={c.id} />
                              <button
                                type="submit"
                                style={{
                                  fontSize: 12.5,
                                  fontWeight: 700,
                                  padding: "8px 16px",
                                  background: "#16a34a",
                                  color: "#fff",
                                  border: "1px solid #15803d",
                                  borderRadius: 8,
                                  cursor: "pointer",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                ✅ Approve
                              </button>
                            </form>
                            <OwnerRejectButton challanId={c.id} action={ownerRejectChallanAction} />
                          </>
                        ) : (
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#92400e", background: "#fef3c7", borderRadius: 999, padding: "4px 10px" }}>
                            Awaiting owner approval
                          </span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
