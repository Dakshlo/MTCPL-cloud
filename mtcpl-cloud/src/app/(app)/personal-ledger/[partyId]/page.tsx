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
import { ensureDefaultBucketsForOwner } from "@/lib/personal-ledger-seed";
import {
  addInvoiceAction,
  addReceiptAction,
  cancelInvoiceAction,
  cancelReceiptAction,
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
  // has none. Plain lib helper — safe to call during render. The
  // earlier server-action variant called revalidatePath() which is
  // not allowed inside a Server Component render path and was
  // throwing on every party-detail load.
  await ensureDefaultBucketsForOwner(profile.id);

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
    // Pull ALL buckets (live + archived) so historical receipts can
    // still resolve their bucket label even if the bucket was later
    // archived. The receipt-form picker filters down to live only.
    supabase
      .from("personal_ledger_buckets")
      .select("id, label, sort_order, archived_at")
      .eq("owner_profile_id", profile.id)
      .order("sort_order"),
    supabase
      .from("personal_ledger_invoices")
      .select("id, invoice_no, invoice_date, items_json, subtotal, gst_amount, total, notes, created_at, cancelled_at")
      .eq("party_id", partyId)
      .eq("owner_profile_id", profile.id)
      .order("invoice_date", { ascending: false }),
    // No PostgREST embed for the bucket relationship — we'd hit the
    // schema-cache race ("Could not find a relationship between …")
    // when PostgREST hasn't reloaded after migration 055 yet. Resolve
    // labels in JS using the buckets list above.
    supabase
      .from("personal_ledger_receipts")
      .select("id, bucket_id, amount, receipt_date, note, created_at, cancelled_at")
      .eq("party_id", partyId)
      .eq("owner_profile_id", profile.id)
      .order("receipt_date", { ascending: false }),
  ]);

  if (!party) notFound();

  type BucketDbRow = {
    id: string;
    label: string;
    sort_order: number;
    archived_at: string | null;
  };
  const allBuckets = ((buckets ?? []) as BucketDbRow[]);
  const bucketOptions: BucketOption[] = allBuckets
    .filter((b) => !b.archived_at)
    .map((b) => ({ id: b.id, label: b.label }));
  const bucketLabelById = new Map<string, string>();
  for (const b of allBuckets) bucketLabelById.set(b.id, b.label);

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
  };
  const receipts: ReceiptRow[] = ((receiptsRaw ?? []) as RcvRaw[])
    .filter((r) => !r.cancelled_at)
    .map((r) => ({
      id: r.id,
      bucketId: r.bucket_id,
      bucketLabel: bucketLabelById.get(r.bucket_id) ?? "—",
      amount: Number(r.amount ?? 0),
      receiptDate: r.receipt_date,
      note: r.note,
      createdAt: r.created_at,
    }));

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
