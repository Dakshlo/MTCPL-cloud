// Owner email snapshot card (Daksh, June 2026). Server component —
// reads the latest mig-119/120 snapshot via the admin client (the table
// has no client-read policy on purpose; summaries are personal) and
// hands plain data to the client panel. Rendered on the dashboard for
// owner/developer only (gated by the caller).
//
// The underlying mailbox connection is READ-ONLY (IMAP, no SMTP — see
// src/lib/email-snapshot.ts); refreshes run at 5:00 + 14:00 IST via
// Vercel cron (today only), or on demand with a chosen window.

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { requireAuth } from "@/lib/auth";
import type { SnapshotItem } from "@/lib/email-snapshot";
import { EmailSnapshotPanel } from "./email-snapshot-panel";

export async function EmailSnapshotCard() {
  const admin = createAdminSupabaseClient();
  // Mig 224 — which language this person last chose. NULL = English.
  const { profile } = await requireAuth();
  const { data: prefRow } = await admin
    .from("profiles")
    .select("snapshot_lang")
    .eq("id", profile.id)
    .maybeSingle();
  const lang = ((prefRow as { snapshot_lang?: string } | null)?.snapshot_lang === "hi" ? "hi" : "en") as "en" | "hi";
  // Guarded: if the migrations haven't run yet, render the setup hint, not a 500.
  const { data, error } = await admin
    .from("email_snapshots")
    .select("generated_at, items, overview, overview_hi, scanned_count, trigger, range, error")
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const configured = !error;
  const snap = data
    ? {
        generatedAt: data.generated_at as string,
        items: (data.items ?? []) as SnapshotItem[],
        overview: (data.overview ?? null) as string | null,
        overviewHi: (data.overview_hi ?? null) as string | null,
        scannedCount: (data.scanned_count ?? 0) as number,
        range: (data.range ?? "today") as string,
        error: (data.error ?? null) as string | null,
      }
    : null;

  return <EmailSnapshotPanel snap={configured ? snap : null} configured={configured} initialLang={lang} />;
}
