// Doc-number freeing (mig 178 + 180, Daksh Jul 2026).
//
// Both INVOICE numbers (INV:<fy> counter) and CHALLAN numbers (<fy> counter,
// shared by dispatch + invoicing challan) are LOCKED — auto-assigned, never
// hand-edited. Cancelling frees the number for reuse:
//   • HEAD of the series → roll the counter back so the NEXT doc reuses it,
//     collapsing through any previously-freed tail numbers.
//   • mid-series → record in freed_invoice_numbers; the series continues at
//     head+1 and the freed number is shown as an indication.
//
// freed_invoice_numbers.fy stores the COUNTER KEY verbatim ('INV:26/27' for
// invoices, '26/27' for challans) so the two series can't collide (mig 180
// re-keys legacy invoice rows that were stored without the 'INV:' prefix).

import { createAdminSupabaseClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminSupabaseClient>;

/** Free a number on any doc counter (counterKey = the doc_counters.fy value). */
export async function freeDocNumber(admin: Admin, counterKey: string | null, seq: number | null, actorId: string): Promise<void> {
  if (!counterKey || seq == null) return;
  try {
    const { data: ctr } = await admin.from("doc_counters").select("last_seq").eq("fy", counterKey).maybeSingle();
    let last = Number((ctr as { last_seq?: number } | null)?.last_seq) || 0;
    if (seq === last) {
      // Head cancellation → roll back, collapsing through any freed tail
      // (cancel 93 with 92 already freed → counter lands on 91).
      last -= 1;
      for (;;) {
        const { data: f } = await admin.from("freed_invoice_numbers").select("seq").eq("fy", counterKey).eq("seq", last).maybeSingle();
        if (!f) break;
        await admin.from("freed_invoice_numbers").delete().eq("fy", counterKey).eq("seq", last);
        last -= 1;
      }
      await admin.from("doc_counters").update({ last_seq: Math.max(0, last) }).eq("fy", counterKey);
    } else if (seq < last) {
      await admin.from("freed_invoice_numbers").upsert({ fy: counterKey, seq, freed_by: actorId }, { onConflict: "fy,seq" });
    }
  } catch {
    /* mig not applied — skip silently; the number is simply retired */
  }
}

/** Freed (gap) numbers for any counter — shown as an indication. */
export async function fetchFreedNumbers(admin: Admin, counterKey: string): Promise<number[]> {
  try {
    const { data, error } = await admin.from("freed_invoice_numbers").select("seq").eq("fy", counterKey).order("seq");
    if (error) return [];
    return ((data ?? []) as Array<{ seq: number }>).map((r) => r.seq);
  } catch {
    return [];
  }
}

// ── Invoice-specific convenience wrappers (counter key = 'INV:<fy>') ──
export async function freeInvoiceNumber(admin: Admin, fy: string | null, seq: number | null, actorId: string): Promise<void> {
  if (!fy) return;
  return freeDocNumber(admin, `INV:${fy}`, seq, actorId);
}
export async function fetchFreedInvoiceNumbers(admin: Admin, fy: string): Promise<number[]> {
  return fetchFreedNumbers(admin, `INV:${fy}`);
}

// ── Challan-specific convenience wrappers (counter key = '<fy>') ──
export async function freeChallanNumber(admin: Admin, fy: string | null, seq: number | null, actorId: string): Promise<void> {
  return freeDocNumber(admin, fy, seq, actorId);
}
export async function fetchFreedChallanNumbers(admin: Admin, fy: string): Promise<number[]> {
  return fetchFreedNumbers(admin, fy);
}
