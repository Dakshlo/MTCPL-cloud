/**
 * Mig 058 → Mig 173 UI — Challans list.
 *
 * The body is the client <ChallansBoard>: temple-wise collapsible card sections,
 * an Approval + Bulk top bar (Bulk doubles as a drag-and-drop target), and the
 * status/date filter. The server here just queries + groups by temple.
 */

import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canUseInvoicing } from "@/lib/invoicing-permissions";
import { AccountsHero } from "../../accounts/_ui/components";
import { challanCode } from "@/lib/doc-code";
import { ChallansBoard, type BoardGroup, type BoardChallan } from "../_ui/challans-board";

type StatusFilter = "open" | "pending_approval" | "rejected" | "invoiced" | "converted" | "cancelled" | "all";

type SearchParams = Promise<{
  status?: StatusFilter;
  from?: string;
  to?: string;
  toast?: string;
}>;

export default async function ChallansListPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) redirect("/");
  const sp = await searchParams;

  const supabase = createAdminSupabaseClient();

  // Build the query progressively from the filters.
  let q = supabase
    .from("challans")
    .select(
      "id, challan_number, doc_fy, doc_seq, challan_date, invoice_party_id, temple, notes, source_dispatch_id, cancelled_at, converted_invoice_id, priced_at, owner_approved_at, owner_rejected_at, owner_reject_reason, invoice_parties(name)",
    )
    .order("challan_date", { ascending: false })
    .limit(500);

  if (sp.from) q = q.gte("challan_date", sp.from);
  if (sp.to) q = q.lte("challan_date", sp.to);

  // Mig 167 — status filter maps to the canonical challanStatus() states.
  // "Open" EXCLUDES priced challans (priced → pending/rejected/invoiced).
  const status: StatusFilter = sp.status ?? "all";
  if (status === "open") {
    q = q.is("cancelled_at", null).is("converted_invoice_id", null).is("priced_at", null);
  } else if (status === "pending_approval") {
    q = q
      .is("cancelled_at", null).is("converted_invoice_id", null)
      .not("priced_at", "is", null).is("owner_approved_at", null).is("owner_rejected_at", null);
  } else if (status === "rejected") {
    q = q
      .is("cancelled_at", null).is("converted_invoice_id", null)
      .not("priced_at", "is", null).not("owner_rejected_at", "is", null);
  } else if (status === "invoiced") {
    q = q
      .is("cancelled_at", null).is("converted_invoice_id", null)
      .not("priced_at", "is", null).not("owner_approved_at", "is", null);
  } else if (status === "converted") {
    q = q.is("cancelled_at", null).not("converted_invoice_id", "is", null);
  } else if (status === "cancelled") {
    q = q.not("cancelled_at", "is", null);
  }

  const { data: challansRaw, error } = await q;
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

  // Mig 173 — challans "sent to bulk" leave the Challans page (they live on the
  // Bulk page until invoiced / sent back). Best-effort filter.
  const bulkIds = new Set<string>();
  {
    const { data, error } = await supabase.from("challans").select("id").not("sent_to_bulk_at", "is", null);
    if (!error) for (const r of (data ?? []) as Array<{ id: string }>) bulkIds.add(r.id);
  }

  // Temple-wise grouping (Daksh) — one section per client/temple, alphabetical.
  const visible = challans.filter((c) => !bulkIds.has(c.id));
  const groups: BoardGroup[] = (() => {
    const m = new Map<string, BoardChallan[]>();
    for (const c of visible) {
      const k = clientNameOf(c);
      const card: BoardChallan = {
        id: c.id,
        code: challanCode(c.doc_fy, c.doc_seq) ?? c.challan_number,
        date: c.challan_date,
        notes: c.notes,
        cancelled_at: c.cancelled_at,
        converted_invoice_id: c.converted_invoice_id,
        priced_at: c.priced_at,
        owner_approved_at: c.owner_approved_at,
        owner_rejected_at: c.owner_rejected_at,
        owner_reject_reason: c.owner_reject_reason,
      };
      const a = m.get(k) ?? [];
      a.push(card);
      m.set(k, a);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([temple, rows]) => ({ temple, rows }));
  })();

  return (
    <section className="page-card">
      <AccountsHero
        title="Challans"
        description="One per dispatch (client = temple). Review & price each to print a tax invoice — or drag onto Bulk to bill several together later."
      />

      {sp.toast && (
        <div style={{ marginTop: 12, fontSize: 13, fontWeight: 700, color: "#15803d", background: "rgba(22,101,52,0.08)", border: "1px solid rgba(22,101,52,0.3)", borderRadius: 8, padding: "8px 12px", marginBottom: 6 }}>
          {sp.toast}
        </div>
      )}

      <div style={{ marginTop: 14 }}>
        <ChallansBoard groups={groups} status={status} from={sp.from ?? ""} to={sp.to ?? ""} total={visible.length} />
      </div>
    </section>
  );
}
