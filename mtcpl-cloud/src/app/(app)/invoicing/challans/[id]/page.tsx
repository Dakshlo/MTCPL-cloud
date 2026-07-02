/**
 * Mig 058 — Challan detail page.
 *
 * Daksh (mig 168): this page is now just the challan CODE + the action chrome
 * (status pill, per-status buttons, owner-reject banner). The full delivery-
 * challan reproduction lives on the dispatch print page — linked from here —
 * so the detail view no longer re-renders items / party / footer.
 */

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canUseInvoicing } from "@/lib/invoicing-permissions";
import {
  ACCOUNTS_TOKENS,
  BUTTON_STYLES,
} from "../../../accounts/_ui/components";
import { challanStatus } from "@/lib/challan-status";
import { challanCode } from "@/lib/doc-code";
import { ChallanStatusPill } from "../../_ui/challan-status-pill";
import { cancelChallanAction, returnDispatchToWaitingAction } from "../../actions";
import { CancelChallanButton } from "./cancel-button";
import { ReturnToDispatchButton } from "../../_ui/return-to-dispatch-button";

type Params = Promise<{ id: string }>;

export default async function ChallanDetailPage({ params }: { params: Params }) {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) redirect("/");

  const { id } = await params;
  const supabase = createAdminSupabaseClient();

  const { data: challan } = await supabase
    .from("challans")
    .select(
      "id, challan_number, doc_fy, doc_seq, challan_date, invoice_party_id, cancelled_at, converted_invoice_id, source_dispatch_id, priced_at, owner_approved_at, owner_rejected_at, owner_reject_reason, temple, invoices:converted_invoice_id(invoice_number)",
    )
    .eq("id", id)
    .maybeSingle();

  if (!challan) notFound();
  const c = challan as {
    id: string;
    challan_number: string;
    doc_fy: string | null;
    doc_seq: number | null;
    challan_date: string;
    invoice_party_id: string;
    cancelled_at: string | null;
    converted_invoice_id: string | null;
    source_dispatch_id: string | null;
    priced_at: string | null;
    owner_approved_at: string | null;
    owner_rejected_at: string | null;
    owner_reject_reason: string | null;
    temple: string | null;
    invoices: { invoice_number: string } | { invoice_number: string }[] | null;
  };
  const linkedInvoice = c.invoices
    ? Array.isArray(c.invoices)
      ? c.invoices[0]
      : c.invoices
    : null;

  const status = challanStatus(c);
  const code = challanCode(c.doc_fy, c.doc_seq) ?? c.challan_number;

  return (
    <section className="page-card">
      {/* On-screen chrome */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 14,
          flexWrap: "wrap",
        }}
      >
        <Link
          href="/invoicing/challans"
          style={{ fontSize: 13, color: "var(--muted)", textDecoration: "none" }}
        >
          ← All challans
        </Link>
        <span style={{ marginLeft: 6 }}>
          <ChallanStatusPill challan={c} />
        </span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {/* Mig 157 — landscape tax invoice (priced challan). Once priced it's
              always reviewable (watermarked UNDER APPROVAL until the owner signs
              off — mig 167). */}
          {c.priced_at && (
            <Link href={`/invoicing/challan/${c.id}/print`} target="_blank" rel="noopener noreferrer" style={BUTTON_STYLES.secondary}>
              🖨 Tax invoice →
            </Link>
          )}
          {/* OPEN — price it (the primary path). Legacy portrait convert only for
              old party-based challans that are NOT dispatch-sourced (mig 167:
              dispatch-sourced challans go price → owner approval, never convert). */}
          {status === "open" && (
            <>
              <Link href={`/invoicing/challans/${c.id}/review`} style={BUTTON_STYLES.primary}>
                🧾 Review &amp; price →
              </Link>
              {!c.temple && !c.source_dispatch_id && (
                <Link href={`/invoicing/challans/${c.id}/convert`} style={BUTTON_STYLES.secondary}>
                  Create purchase invoice →
                </Link>
              )}
              <CancelChallanButton challanId={c.id} cancelAction={cancelChallanAction} />
            </>
          )}
          {/* PENDING — sent to the owner; just the waiting note (NO re-price —
              the server blocks re-pricing a pending challan; mig 167). */}
          {status === "pending_approval" && (
            <span style={{ fontSize: 12.5, fontWeight: 700, color: "#92400e", background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 8, padding: "6px 10px" }}>
              Sent to owner for approval.
            </span>
          )}
          {/* INVOICED — owner approved; final. No re-price (the "Tax invoice →"
              link above opens the finished bill). */}
          {/* REJECTED — owner bounced it back: re-price or cancel → dispatch. */}
          {status === "rejected" && (
            <>
              <Link href={`/invoicing/challans/${c.id}/review`} style={BUTTON_STYLES.primary}>
                ✏️ Re-price →
              </Link>
              <ReturnToDispatchButton challanId={c.id} action={returnDispatchToWaitingAction} />
            </>
          )}
          {status === "converted" && linkedInvoice && (
            <Link
              href={`/invoicing/invoices?party=${c.invoice_party_id}`}
              style={BUTTON_STYLES.secondary}
            >
              View invoice {linkedInvoice.invoice_number} →
            </Link>
          )}
        </span>
      </div>

      {/* Mig 167 — owner reject reason (rejected challans go back to the
          accountant here to re-price or cancel → dispatch). */}
      {status === "rejected" && c.owner_reject_reason && (
        <div
          style={{ marginBottom: 14, fontSize: 13, color: "#991b1b", background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 8, padding: "10px 12px" }}
        >
          <strong>Owner rejected this invoice:</strong> {c.owner_reject_reason}
        </div>
      )}

      {/* Code + minimal meta (the full delivery challan lives on the dispatch
          print page, linked below). */}
      <div
        style={{
          background: "var(--surface, #fff)",
          border: `1px solid ${ACCOUNTS_TOKENS.border}`,
          borderRadius: 12,
          padding: "28px 32px",
          maxWidth: 640,
          margin: "0 auto",
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontSize: 10,
            fontWeight: 800,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            color: ACCOUNTS_TOKENS.accent,
          }}
        >
          Delivery Challan
        </div>
        <div
          style={{
            fontSize: 30,
            fontWeight: 800,
            marginTop: 6,
            fontFamily: "ui-monospace, monospace",
            color: "var(--text)",
          }}
        >
          {code}
        </div>
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", marginTop: 10 }}>
          {c.temple ?? "—"}
        </div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 4 }}>
          {c.challan_date}
        </div>
        {c.source_dispatch_id && (
          <div style={{ marginTop: 18 }}>
            <Link
              href={`/dispatch/${c.source_dispatch_id}/print`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 13, fontWeight: 700, color: "var(--gold-dark, #92400e)", textDecoration: "none" }}
            >
              🖨 View delivery challan →
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
