/**
 * Bulk challans (Mig 173). Open challans "sent to bulk" land here, grouped by
 * temple. Each can be downloaded (the delivery challan) or sent back. "Create
 * tax invoice" bills several of a temple's bulk challans on one invoice.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canUseInvoicing } from "@/lib/invoicing-permissions";
import { challanCode, invoiceCodeFromDoc } from "@/lib/doc-code";
import { BUTTON_STYLES } from "../../accounts/_ui/components";
import { BulkSendBack } from "./bulk-send-back";
import { BulkCancel } from "./bulk-cancel";

export const dynamic = "force-dynamic";

type Search = Promise<{ toast?: string }>;
type BulkRow = { id: string; challan_number: string; doc_fy: string | null; doc_seq: number | null; challan_date: string; temple: string | null; source_dispatch_id: string | null };

export default async function BulkChallansPage({ searchParams }: { searchParams: Search }) {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) redirect("/");
  const sp = await searchParams;
  const admin = createAdminSupabaseClient();

  const { data: rows } = await admin
    .from("challans")
    .select("id, challan_number, doc_fy, doc_seq, challan_date, temple, source_dispatch_id")
    .not("sent_to_bulk_at", "is", null)
    .is("priced_at", null)
    .is("converted_invoice_id", null)
    .is("cancelled_at", null)
    .order("challan_date", { ascending: false });
  const all = (rows ?? []) as BulkRow[];

  // Drop challans already on a bulk invoice (best-effort).
  const invoiced = new Set<string>();
  {
    const { data, error } = await admin.from("bulk_invoice_challans").select("challan_id");
    if (!error) for (const r of (data ?? []) as Array<{ challan_id: string }>) invoiced.add(r.challan_id);
  }
  const pool = all.filter((c) => !invoiced.has(c.id));

  const byTemple = new Map<string, BulkRow[]>();
  for (const c of pool) { const k = c.temple ?? "—"; const a = byTemple.get(k) ?? []; a.push(c); byTemple.set(k, a); }
  const temples = [...byTemple.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  // Owner-rejected bulk invoices. Their challans are ALREADY back in the pool
  // (reject returns them); this list just shows the reason + a dismiss. Best-effort.
  type RejBulk = { id: string; temple: string; inv_fy: string | null; inv_seq: number | null; invoice_no_override: string | null; owner_reject_reason: string | null };
  let rejected: RejBulk[] = [];
  {
    const { data, error } = await admin.from("bulk_invoices")
      .select("id, temple, inv_fy, inv_seq, invoice_no_override, owner_reject_reason")
      .not("owner_rejected_at", "is", null).is("cancelled_at", null)
      .order("created_at", { ascending: false });
    if (!error) rejected = (data ?? []) as RejBulk[];
  }

  return (
    <section className="page-card">
      <div className="page-header" style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div>
          <h1>Bulk challans</h1>
          <p className="muted">Challans parked here are billed together later. Use <strong>Create tax invoice</strong> to bill several of a temple&apos;s challans on one invoice.</p>
        </div>
        <Link href="/invoicing/bulk/new" style={BUTTON_STYLES.primary}>🧾 Create tax invoice</Link>
      </div>

      {sp.toast && (
        <div style={{ marginTop: 12, fontSize: 13, fontWeight: 700, color: "#15803d", background: "rgba(22,101,52,0.08)", border: "1px solid rgba(22,101,52,0.3)", borderRadius: 8, padding: "8px 12px" }}>
          {sp.toast}
        </div>
      )}

      {rejected.length > 0 && (
        <div style={{ marginTop: 14, border: "1px solid #fca5a5", borderRadius: 12, background: "#fef2f2", padding: "12px 14px" }}>
          <div style={{ fontWeight: 800, fontSize: 13, color: "#991b1b", marginBottom: 8 }}>⚠ Owner-rejected bulk invoices — their challans are back in the pool above; re-bill them, then dismiss</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {rejected.map((b) => (
              <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "10px 12px", border: "1px solid #fecaca", borderRadius: 8, background: "#fff" }}>
                <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800 }}>{(b.invoice_no_override ?? "").trim() || invoiceCodeFromDoc(b.inv_fy, b.inv_seq) || `INV-${b.id.slice(0, 6).toUpperCase()}`}</span>
                <span className="muted" style={{ fontSize: 12 }}>🏛 {b.temple}</span>
                {b.owner_reject_reason && <span style={{ fontSize: 12, color: "#991b1b" }}>Reason: {b.owner_reject_reason}</span>}
                <span style={{ marginLeft: "auto" }}><BulkCancel id={b.id} /></span>
              </div>
            ))}
          </div>
        </div>
      )}

      {temples.length === 0 ? (
        <div className="banner" style={{ marginTop: 14 }}>No bulk challans. Send open challans here from the Challans page.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 14 }}>
          {temples.map(([temple, list]) => (
            <div key={temple} style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
              <div style={{ padding: "10px 14px", background: "var(--surface)", borderBottom: "1px solid var(--border)", fontWeight: 800, display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <span>🏛 {temple}</span>
                <span className="muted" style={{ fontWeight: 600, fontSize: 12.5 }}>{list.length} challan{list.length !== 1 ? "s" : ""}</span>
              </div>
              <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                {list.map((c) => (
                  <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg)" }}>
                    <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800 }}>{challanCode(c.doc_fy, c.doc_seq) ?? c.challan_number}</span>
                    <span className="muted" style={{ fontSize: 12 }}>{c.challan_date}</span>
                    <span style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {c.source_dispatch_id && (
                        <Link href={`/dispatch/${c.source_dispatch_id}/print`} target="_blank" rel="noopener noreferrer" style={{ ...BUTTON_STYLES.secondary, fontSize: 12 }}>🖨 Download</Link>
                      )}
                      <BulkSendBack id={c.id} />
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <p style={{ marginTop: 16, fontSize: 12 }}>
        <Link href="/invoicing/challans" style={{ color: "var(--muted)", textDecoration: "none" }}>← Challans</Link>
      </p>
    </section>
  );
}
