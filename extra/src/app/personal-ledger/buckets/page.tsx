/**
 * Migration 055 — Bucket admin page.
 *
 * Tiny page to rename / archive / add buckets that receipts get
 * tagged with. Default seed is "B" and "C" per Daksh's spec — the
 * page auto-creates them on first visit so the user never sees a
 * confusing empty bucket picker on the party detail page.
 *
 * Same owner-scoped + RLS + audit-log discipline as the rest of
 * /personal-ledger.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { canUsePersonalLedger } from "@/lib/personal-ledger-permissions";
import { ensureDefaultBucketsForOwner } from "@/lib/personal-ledger-seed";
import {
  addBucketAction,
  archiveBucketAction,
  renameBucketAction,
} from "../actions";
import { BucketsClient, type BucketRow } from "./buckets-client";

export default async function BucketsPage() {
  const { profile } = await requireAuth();
  if (!canUsePersonalLedger(profile)) redirect("/");

  // Auto-seed defaults ("B" + "C") on first visit. Plain lib helper
  // (not the server action) — calling a "use server" action from a
  // Server Component triggers Next.js's revalidate machinery during
  // render and throws.
  await ensureDefaultBucketsForOwner(profile.id);

  const supabase = createAdminSupabaseClient();
  const { data: rows } = await supabase
    .from("personal_ledger_buckets")
    .select("id, label, sort_order, archived_at")
    .eq("owner_profile_id", profile.id)
    .order("archived_at", { ascending: true, nullsFirst: true })
    .order("sort_order", { ascending: true });

  // Count how many receipts hit each bucket so the admin page can
  // show "12 receipts" beside each row — gives Daksh a sense of
  // which buckets actually matter before he goes renaming things.
  const { data: receiptCounts } = await supabase
    .from("personal_ledger_receipts")
    .select("bucket_id")
    .eq("owner_profile_id", profile.id)
    .is("cancelled_at", null);

  const countsByBucket = new Map<string, number>();
  for (const r of (receiptCounts ?? []) as Array<{ bucket_id: string }>) {
    countsByBucket.set(r.bucket_id, (countsByBucket.get(r.bucket_id) ?? 0) + 1);
  }

  const buckets: BucketRow[] = ((rows ?? []) as Array<{
    id: string;
    label: string;
    sort_order: number;
    archived_at: string | null;
  }>).map((b) => ({
    id: b.id,
    label: b.label,
    sortOrder: b.sort_order,
    archivedAt: b.archived_at,
    receiptCount: countsByBucket.get(b.id) ?? 0,
  }));

  return (
    <BucketsClient
      buckets={buckets}
      addAction={addBucketAction}
      renameAction={renameBucketAction}
      archiveAction={archiveBucketAction}
    />
  );
}
