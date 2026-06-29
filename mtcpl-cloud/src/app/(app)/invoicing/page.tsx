/**
 * Invoicing dashboard (Daksh redesign).
 *
 * The landing now shows EVERY challan, temple-wise, in the same card board as
 * the Challans page — each tagged with its stage (plain challan / Invoice / In
 * bulk / Bulk invoice) — plus a search bar. The old KPI cards and the recent-
 * invoices strip are gone. The hero keeps the two shortcut menus.
 */

import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canUseInvoicing } from "@/lib/invoicing-permissions";
import { allowedDepartmentsForRole } from "@/lib/departments";
import { AccountsHero } from "../accounts/_ui/components";
import { challanStatus } from "@/lib/challan-status";
import { challanCode } from "@/lib/doc-code";
import { HeroMenu } from "./_ui/hero-menu";
import { DashboardBoard, type DashGroup, type DashCard, type DashStatus } from "./_ui/dashboard-board";

type ChallanRow = {
  id: string;
  challan_number: string;
  doc_fy: string | null;
  doc_seq: number | null;
  challan_date: string;
  temple: string | null;
  cancelled_at: string | null;
  converted_invoice_id: string | null;
  priced_at: string | null;
  owner_approved_at: string | null;
  owner_rejected_at: string | null;
  source_dispatch_id: string | null;
  invoice_parties: { name: string } | { name: string }[] | null;
};

export default async function InvoicingDashboardPage() {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) {
    // Plain accountant gets only the standalone Work Order Document.
    if (allowedDepartmentsForRole(profile.role).includes("invoicing")) redirect("/invoicing/work-order-doc");
    redirect("/");
  }

  const supabase = createAdminSupabaseClient();

  // ALL challans, paged (never silently truncate at the 1000-row cap).
  const challans: ChallanRow[] = [];
  for (let off = 0; off < 100_000; off += 1000) {
    const { data, error } = await supabase
      .from("challans")
      .select("id, challan_number, doc_fy, doc_seq, challan_date, temple, cancelled_at, converted_invoice_id, priced_at, owner_approved_at, owner_rejected_at, source_dispatch_id, invoice_parties(name)")
      .order("challan_date", { ascending: false })
      .range(off, off + 999);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as ChallanRow[];
    challans.push(...rows);
    if (rows.length < 1000) break;
  }

  // Best-effort bulk membership (mig 173 — survive a pre-migration deploy).
  const inBulk = new Set<string>();
  {
    const { data, error } = await supabase.from("challans").select("id").not("sent_to_bulk_at", "is", null);
    if (!error) for (const r of (data ?? []) as Array<{ id: string }>) inBulk.add(r.id);
  }
  const onBulkInvoice = new Set<string>();
  {
    const { data, error } = await supabase.from("bulk_invoice_challans").select("challan_id");
    if (!error) for (const r of (data ?? []) as Array<{ challan_id: string }>) onBulkInvoice.add(r.challan_id);
  }

  // Slab codes / labels per challan → search blob.
  const codesByChallan = new Map<string, string>();
  {
    const ids = challans.map((c) => c.id);
    for (let i = 0; i < ids.length; i += 300) {
      const chunk = ids.slice(i, i + 300);
      if (!chunk.length) break;
      const { data, error } = await supabase.from("challan_items").select("challan_id, codes, label, description").in("challan_id", chunk);
      if (error) break;
      for (const it of (data ?? []) as Array<{ challan_id: string; codes: string | null; label: string | null; description: string | null }>) {
        const extra = [it.codes, it.label, it.description].filter(Boolean).join(" ");
        const prev = codesByChallan.get(it.challan_id) ?? "";
        codesByChallan.set(it.challan_id, `${prev} ${extra}`.trim());
      }
    }
  }

  const templeOf = (c: ChallanRow): string => {
    const legacy = c.invoice_parties ? (Array.isArray(c.invoice_parties) ? c.invoice_parties[0]?.name ?? null : c.invoice_parties.name) : null;
    return c.temple ?? legacy ?? "—";
  };

  const byTemple = new Map<string, DashCard[]>();
  for (const c of challans) {
    let status: DashStatus;
    if (onBulkInvoice.has(c.id)) status = "bulk_invoiced";
    else if (inBulk.has(c.id)) status = "in_bulk";
    else {
      const s = challanStatus(c);
      status = s === "converted" ? "invoiced" : (s as DashStatus);
    }
    const href =
      status === "invoiced" ? `/invoicing/challan/${c.id}/print`
      : status === "in_bulk" || status === "bulk_invoiced" ? "/invoicing/bulk"
      : `/invoicing/challans/${c.id}`;

    const temple = templeOf(c);
    const code = challanCode(c.doc_fy, c.doc_seq) ?? c.challan_number;
    const card: DashCard = {
      id: c.id,
      code,
      date: c.challan_date,
      status,
      href,
      search: `${temple} ${code} ${c.challan_number} ${codesByChallan.get(c.id) ?? ""}`.toLowerCase(),
    };
    const a = byTemple.get(temple) ?? [];
    a.push(card);
    byTemple.set(temple, a);
  }
  const groups: DashGroup[] = [...byTemple.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([temple, rows]) => ({ temple, rows }));

  return (
    <section className="page-card">
      <AccountsHero
        title="Invoicing"
        actions={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <HeroMenu
              label="🛕 Client & GST setup"
              items={[
                { href: "/settings/temples", label: "🛕 Client billing & GST", hint: "Per-temple billing, shipping & default GST" },
                { href: "/invoicing/stone-hsn", label: "🪨 Stone & HSN code", hint: "HSN code per stone (prints on the invoice)" },
              ]}
            />
            <HeroMenu
              label="📄 Documents"
              items={[
                { href: "/invoicing/install-contract", label: "📜 Installation contract", hint: "Generate an installation contract" },
                { href: "/invoicing/work-order-doc", label: "📝 Work Order Doc", hint: "Generate a work order document" },
              ]}
            />
          </div>
        }
      />

      <div style={{ marginTop: 18 }}>
        <DashboardBoard groups={groups} total={challans.length} />
      </div>
    </section>
  );
}
