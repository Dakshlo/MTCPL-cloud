/**
 * Migration 055 — Party detail page.
 *
 * Three-card layout (Daksh's spec):
 *   • Invoices  — list + create form
 *   • Received  — list + create form (bucket-tagged)
 *   • Summary   — invoiced − received = outstanding, Excel link
 *
 * Owner-scoped. RLS + WHERE owner_profile_id = profile.id on every
 * query. Hard "PERSONAL — NOT COMPANY BOOKS" banner.
 */

import { notFound, redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canUsePersonalLedger } from "@/lib/personal-ledger-permissions";
import {
  addInvoiceAction,
  addReceiptAction,
  cancelInvoiceAction,
  cancelReceiptAction,
  ensureDefaultBucketsAction,
} from "../actions";
import {
  PartyDetailClient,
  type BucketOption,
  type InvoiceRow,
  type ReceiptRow,
} from "./party-detail-client";

export default async function PartyDetailPage({
  params,
}: {
  params: Promise<{ partyId: string }>;
}) {
  const { profile } = await requireAuth();
  if (!canUsePersonalLedger(profile)) redirect("/");

  const { partyId } = await params;
  const supabase = createAdminSupabaseClient();

  // Auto-seed default buckets (B / C) on first visit if the user
  // has none. The action is idempotent — no-op when already seeded.
  await ensureDefaultBucketsAction();

  const [
    { data: party },
    { data: buckets },
    { data: invoicesRaw },
    { data: receiptsRaw },
  ] = await Promise.all([
    supabase
      .from("personal_ledger_parties")
      .select("id, name")
      .eq("id", partyId)
      .eq("owner_profile_id", profile.id)
      .maybeSingle(),
    supabase
      .from("personal_ledger_buckets")
      .select("id, label, sort_order")
      .eq("owner_profile_id", profile.id)
      .is("archived_at", null)
      .order("sort_order"),
    supabase
      .from("personal_ledger_invoices")
      .select("id, invoice_no, invoice_date, items_json, subtotal, gst_amount, total, notes, created_at, cancelled_at")
      .eq("party_id", partyId)
      .eq("owner_profile_id", profile.id)
      .order("invoice_date", { ascending: false }),
    supabase
      .from("personal_ledger_receipts")
      .select("id, bucket_id, amount, receipt_date, note, created_at, cancelled_at, personal_ledger_buckets(label)")
      .eq("party_id", partyId)
      .eq("owner_profile_id", profile.id)
      .order("receipt_date", { ascending: false }),
  ]);

  if (!party) notFound();

  const bucketOptions: BucketOption[] = ((buckets ?? []) as Array<{
    id: string;
    label: string;
  }>).map((b) => ({ id: b.id, label: b.label }));

  // Filter cancelled rows out for the visible lists + totals.
  type InvRaw = {
    id: string;
    invoice_no: string;
    invoice_date: string;
    items_json: unknown;
    subtotal: number | string;
    gst_amount: number | string;
    total: number | string;
    notes: string | null;
    created_at: string;
    cancelled_at: string | null;
  };
  const invoices: InvoiceRow[] = ((invoicesRaw ?? []) as InvRaw[])
    .filter((r) => !r.cancelled_at)
    .map((r) => ({
      id: r.id,
      invoiceNo: r.invoice_no,
      invoiceDate: r.invoice_date,
      items: Array.isArray(r.items_json) ? (r.items_json as InvoiceRow["items"]) : [],
      subtotal: Number(r.subtotal ?? 0),
      gstAmount: Number(r.gst_amount ?? 0),
      total: Number(r.total ?? 0),
      notes: r.notes,
      createdAt: r.created_at,
    }));

  type RcvRaw = {
    id: string;
    bucket_id: string;
    amount: number | string;
    receipt_date: string;
    note: string | null;
    created_at: string;
    cancelled_at: string | null;
    personal_ledger_buckets: { label: string } | { label: string }[] | null;
  };
  const receipts: ReceiptRow[] = ((receiptsRaw ?? []) as RcvRaw[])
    .filter((r) => !r.cancelled_at)
    .map((r) => {
      const embedded = r.personal_ledger_buckets;
      const bucketLabel = embedded
        ? Array.isArray(embedded)
          ? embedded[0]?.label ?? "—"
          : embedded.label
        : "—";
      return {
        id: r.id,
        bucketId: r.bucket_id,
        bucketLabel,
        amount: Number(r.amount ?? 0),
        receiptDate: r.receipt_date,
        note: r.note,
        createdAt: r.created_at,
      };
    });

  return (
    <PartyDetailClient
      partyId={party.id}
      partyName={party.name}
      buckets={bucketOptions}
      invoices={invoices}
      receipts={receipts}
      addInvoiceAction={addInvoiceAction}
      cancelInvoiceAction={cancelInvoiceAction}
      addReceiptAction={addReceiptAction}
      cancelReceiptAction={cancelReceiptAction}
    />
  );
}
