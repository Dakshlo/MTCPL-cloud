/**
 * Mig 058 → Mig 173 UI — Challans list.
 *
 * The body is the client <ChallansBoard>: a search bar (temple / challan no. /
 * slab code), temple-wise collapsible card sections, an Approval + Bulk top bar,
 * and a floating drop zone for sending a challan to bulk. The server here loads
 * every active challan, groups by temple, and builds a per-challan search blob
 * (temple + code + slab codes/labels).
 */

import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canUseInvoicing } from "@/lib/invoicing-permissions";
import { AccountsHero } from "../../accounts/_ui/components";
import { challanCode } from "@/lib/doc-code";
import { ChallansBoard, type BoardGroup, type BoardChallan, type DroppedChallan } from "../_ui/challans-board";

type SearchParams = Promise<{ toast?: string }>;

export default async function ChallansListPage({ searchParams }: { searchParams: SearchParams }) {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) redirect("/");
  const sp = await searchParams;

  const supabase = createAdminSupabaseClient();

  // Daksh — the Challans page is the WORK queue: only challans NOT yet on a final
  // invoice. Exclude owner-approved (invoiced → they live on the Invoices page),
  // legacy converted, and cancelled. What's left = open / under-review / rejected
  // (a priced challan stays here while the owner reviews it, and only leaves once
  // approved). Bulk-parked challans are filtered out separately (best-effort).
  const { data: challansRaw, error } = await supabase
    .from("challans")
    .select(
      "id, challan_number, doc_fy, doc_seq, challan_date, invoice_party_id, temple, notes, source_dispatch_id, cancelled_at, converted_invoice_id, priced_at, owner_approved_at, owner_rejected_at, owner_reject_reason, invoice_parties(name)",
    )
    .is("cancelled_at", null)
    .is("converted_invoice_id", null)
    .is("owner_approved_at", null)
    .order("challan_date", { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);

  const challans = (challansRaw ?? []) as Array<{
    id: string;
    challan_number: string;
    doc_fy: string | null;
    doc_seq: number | null;
    challan_date: string;
    invoice_party_id: string | null;
    temple: string | null;
    notes: string | null;
    source_dispatch_id: string | null;
    cancelled_at: string | null;
    converted_invoice_id: string | null;
    priced_at: string | null;
    owner_approved_at: string | null;
    owner_rejected_at: string | null;
    owner_reject_reason: string | null;
    invoice_parties: { name: string } | { name: string }[] | null;
  }>;

  type ChallanRow = (typeof challans)[number];
  const clientNameOf = (c: ChallanRow): string => {
    const legacy = c.invoice_parties
      ? Array.isArray(c.invoice_parties) ? c.invoice_parties[0]?.name ?? null : c.invoice_parties.name
      : null;
    return c.temple ?? legacy ?? "—";
  };

  // Mig 173 — challans "sent to bulk" leave the Challans page. Best-effort filter.
  const bulkIds = new Set<string>();
  {
    const { data, error } = await supabase.from("challans").select("id").not("sent_to_bulk_at", "is", null);
    if (!error) for (const r of (data ?? []) as Array<{ id: string }>) bulkIds.add(r.id);
  }

  // Mig 177 — "dropped" challans (custom whole-piece bill) leave the board into a
  // Dropped section. Best-effort so a pre-migration deploy just shows no section.
  const droppedIds = new Set<string>();
  const dropped: DroppedChallan[] = [];
  {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await supabase
      .from("challans")
      .select("id, challan_number, doc_fy, doc_seq, challan_date, temple, custom_billed_at, inv_seq, gst_mode, igst_percent, cgst_percent, sgst_percent, invoice_parties(name), challan_custom_items(position, particulars, hsn, unit, quantity, rate, amount)")
      .not("dropped_at", "is", null)
      .is("cancelled_at", null)
      .order("dropped_at", { ascending: false });
    if (!error) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const r of (data ?? []) as any[]) {
        droppedIds.add(r.id);
        if (r.inv_seq != null) continue; // invoiced → shows on Invoices, not the Dropped section
        const p = Array.isArray(r.invoice_parties) ? r.invoice_parties[0] : r.invoice_parties;
        const gm = r.gst_mode === "igst" || r.gst_mode === "cgst_sgst" ? r.gst_mode : null;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const items = ((r.challan_custom_items ?? []) as any[])
          .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
          .map((it) => ({ particulars: it.particulars ?? "", hsn: it.hsn ?? "", unit: it.unit ?? "", quantity: Number(it.quantity) || 0, rate: Number(it.rate) || 0, amount: Number(it.amount) || 0 }));
        dropped.push({
          id: r.id, code: challanCode(r.doc_fy, r.doc_seq) ?? r.challan_number, temple: r.temple ?? p?.name ?? "—",
          date: r.challan_date, customBilled: !!r.custom_billed_at, gstMode: gm,
          igst: Number(r.igst_percent) || 0, cgst: Number(r.cgst_percent) || 0, sgst: Number(r.sgst_percent) || 0, items,
        });
      }
    }
  }
  const visible = challans.filter((c) => !bulkIds.has(c.id) && !droppedIds.has(c.id));

  // Slab codes / labels per challan → folded into the search blob so the search
  // bar matches by slab code too (challan_items.codes is comma-separated text).
  const codesByChallan = new Map<string, string>();
  {
    const ids = visible.map((c) => c.id);
    for (let i = 0; i < ids.length; i += 300) {
      const chunk = ids.slice(i, i + 300);
      if (!chunk.length) break;
      const { data, error } = await supabase
        .from("challan_items")
        .select("challan_id, codes, label, description")
        .in("challan_id", chunk);
      if (error) break;
      for (const it of (data ?? []) as Array<{ challan_id: string; codes: string | null; label: string | null; description: string | null }>) {
        const extra = [it.codes, it.label, it.description].filter(Boolean).join(" ");
        const prev = codesByChallan.get(it.challan_id) ?? "";
        codesByChallan.set(it.challan_id, `${prev} ${extra}`.trim());
      }
    }
  }

  // Temple-wise grouping (Daksh) — one section per client/temple, alphabetical.
  const groups: BoardGroup[] = (() => {
    const m = new Map<string, BoardChallan[]>();
    for (const c of visible) {
      const temple = clientNameOf(c);
      const code = challanCode(c.doc_fy, c.doc_seq) ?? c.challan_number;
      const card: BoardChallan = {
        id: c.id,
        code,
        date: c.challan_date,
        notes: c.notes,
        cancelled_at: c.cancelled_at,
        converted_invoice_id: c.converted_invoice_id,
        priced_at: c.priced_at,
        owner_approved_at: c.owner_approved_at,
        owner_rejected_at: c.owner_rejected_at,
        owner_reject_reason: c.owner_reject_reason,
        search: `${temple} ${code} ${c.challan_number} ${codesByChallan.get(c.id) ?? ""}`.toLowerCase(),
      };
      const a = m.get(temple) ?? [];
      a.push(card);
      m.set(temple, a);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([temple, rows]) => ({ temple, rows }));
  })();

  return (
    <section className="page-card">
      <AccountsHero title="Challans" />

      {sp.toast && (
        <div style={{ marginTop: 12, fontSize: 13, fontWeight: 700, color: "#15803d", background: "rgba(22,101,52,0.08)", border: "1px solid rgba(22,101,52,0.3)", borderRadius: 8, padding: "8px 12px", marginBottom: 6 }}>
          {sp.toast}
        </div>
      )}

      <div style={{ marginTop: 14 }}>
        <ChallansBoard groups={groups} total={visible.length} dropped={dropped} />
      </div>
    </section>
  );
}
