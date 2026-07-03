// Mig 178 — invoice-number freeing (Daksh, Jul 2026).
//
// Invoice numbers are LOCKED: auto-assigned from the shared per-FY counter
// (doc_counters['INV:<fy>'] via next_doc_seq), never hand-edited. Cancelling an
// invoice frees its number:
//   • HEAD of the series → roll the counter back so the NEXT invoice reuses it,
//     collapsing through any previously-freed tail numbers.
//   • mid-series → record in freed_invoice_numbers; the series continues at
//     head+1 and the freed number is shown as an indication on Review & price.

import { createAdminSupabaseClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminSupabaseClient>;

export async function freeInvoiceNumber(
  admin: Admin,
  fy: string | null,
  seq: number | null,
  actorId: string,
): Promise<void> {
  if (!fy || seq == null) return;
  try {
    const key = `INV:${fy}`;
    const { data: ctr } = await admin.from("doc_counters").select("last_seq").eq("fy", key).maybeSingle();
    let last = Number((ctr as { last_seq?: number } | null)?.last_seq) || 0;
    if (seq === last) {
      // Head cancellation → roll back, collapsing through any freed tail
      // (cancel 93 with 92 already freed → counter lands on 91).
      last -= 1;
      for (;;) {
        const { data: f } = await admin.from("freed_invoice_numbers").select("seq").eq("fy", fy).eq("seq", last).maybeSingle();
        if (!f) break;
        await admin.from("freed_invoice_numbers").delete().eq("fy", fy).eq("seq", last);
        last -= 1;
      }
      await admin.from("doc_counters").update({ last_seq: Math.max(0, last) }).eq("fy", key);
    } else if (seq < last) {
      await admin.from("freed_invoice_numbers").upsert({ fy, seq, freed_by: actorId }, { onConflict: "fy,seq" });
    }
  } catch {
    /* mig 178 not applied — skip silently; the number is simply retired */
  }
}

/** Freed (gap) numbers for a FY — shown as an indication on Review & price. */
export async function fetchFreedInvoiceNumbers(admin: Admin, fy: string): Promise<number[]> {
  try {
    const { data, error } = await admin.from("freed_invoice_numbers").select("seq").eq("fy", fy).order("seq");
    if (error) return [];
    return ((data ?? []) as Array<{ seq: number }>).map((r) => r.seq);
  } catch {
    return [];
  }
}
