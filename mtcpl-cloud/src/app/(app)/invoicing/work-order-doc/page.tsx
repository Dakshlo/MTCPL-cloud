import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { WorkOrderDocClient, type DocRecord, type SavedVendor } from "./doc-client";

export const dynamic = "force-dynamic";

// Invoicing department audience. Plain accountant added (Daksh, June 2026):
// they get the Work Order Doc inside Invoicing, but not the v2 surfaces.
const ALLOWED = ["developer", "owner", "accountant_star", "accountant"];

type SearchParams = Promise<{ toast?: string; created?: string; vendor_added?: string }>;

export default async function WorkOrderDocPage({ searchParams }: { searchParams: SearchParams }) {
  const { profile } = await requireAuth();
  if (!ALLOWED.includes(profile.role)) redirect("/invoicing");
  const sp = await searchParams;
  const admin = createAdminSupabaseClient();

  type Row = {
    id: string;
    doc_date: string | null;
    vendor: string;
    job_description: string | null;
    job_work_no: string | null;
    unit: string;
    quantity: number | string;
    rate: number | string;
    total: number | string;
    line_items: unknown;
    created_at: string;
  };

  // Saved documents (paginated past the 1000-row cap). Guarded: empty if
  // the migration hasn't run yet (renders the form, not a 500).
  const rows: Row[] = [];
  for (let off = 0; off < 100000; off += 1000) {
    const { data, error } = await admin
      .from("invoicing_work_order_docs")
      .select("id, doc_date, vendor, job_description, job_work_no, unit, quantity, rate, total, line_items, created_at")
      .order("created_at", { ascending: false })
      .range(off, off + 999);
    if (error || !data || data.length === 0) break;
    rows.push(...(data as Row[]));
    if (data.length < 1000) break;
  }

  // Saved vendors (name + address) for quick fill.
  const { data: vendorRows } = await admin
    .from("invoicing_wo_vendors")
    .select("id, name, address")
    .order("name", { ascending: true });
  const vendors: SavedVendor[] = ((vendorRows ?? []) as Array<{ id: string; name: string; address: string | null }>).map(
    (v) => ({ id: v.id, name: v.name, address: v.address ?? "" }),
  );

  const records: DocRecord[] = rows.map((r) => ({
    id: r.id,
    date: r.doc_date ?? (r.created_at ? r.created_at.slice(0, 10) : ""),
    vendor: r.vendor,
    jobDescription: r.job_description ?? "",
    jobWorkNo: r.job_work_no ?? "",
    unit: r.unit === "sft" ? "sft" : "cft",
    quantity: Number(r.quantity),
    rate: Number(r.rate),
    total: Number(r.total),
    lineItemCount: Array.isArray(r.line_items) && r.line_items.length > 0 ? r.line_items.length : 1,
  }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingBottom: 32 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 22 }}>🧾 Work Order Document</h1>
        <p className="muted" style={{ margin: "2px 0 0", fontSize: 13, maxWidth: 760 }}>
          Fill the details by hand and generate a printable work-order on the company letterhead. Standalone —
          not linked to carving work orders or anything else. Every document you generate is kept below.
        </p>
      </div>
      <WorkOrderDocClient
        records={records}
        vendors={vendors}
        toast={sp?.toast ?? null}
        createdId={sp?.created ?? null}
        vendorAddedId={sp?.vendor_added ?? null}
        canDelete={profile.role === "owner" || profile.role === "developer"}
      />
    </div>
  );
}
