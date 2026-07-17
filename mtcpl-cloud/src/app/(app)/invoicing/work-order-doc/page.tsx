import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getProfilesMap } from "@/lib/profiles";
import { AccountsHero } from "../../accounts/_ui/components";
import Link from "next/link";
import { WorkOrderDocClient, type DocRecord, type FinanceVendor } from "./doc-client";

export const dynamic = "force-dynamic";

// Invoicing department audience. Plain accountant added (Daksh, June 2026):
// they get the Work Order Doc inside Invoicing, but not the v2 surfaces.
const ALLOWED = ["developer", "owner", "accountant_star", "accountant"];

type SearchParams = Promise<{ toast?: string; created?: string; vendor_filled?: string }>;

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
    deleted_at: string | null;
    deleted_by: string | null;
    created_at: string;
  };

  // Saved documents (paginated past the 1000-row cap). Guarded: empty if
  // the migration hasn't run yet (renders the form, not a 500).
  const rows: Row[] = [];
  for (let off = 0; off < 100000; off += 1000) {
    const { data, error } = await admin
      .from("invoicing_work_order_docs")
      .select("id, doc_date, vendor, job_description, job_work_no, unit, quantity, rate, total, line_items, deleted_at, deleted_by, created_at")
      .order("created_at", { ascending: false })
      .range(off, off + 999);
    if (error || !data || data.length === 0) break;
    rows.push(...(data as Row[]));
    if (data.length < 1000) break;
  }

  // Vendors come from the Finance master (bill_vendors). Read-only here —
  // we only ever SELECT; the document never creates a vendor, and the only
  // write path (filling empty display fields) is a tightly-allowlisted
  // server action. Money fields (bank/ifsc/upi/etc) are not even fetched.
  const { data: vendorRows } = await admin
    .from("bill_vendors")
    .select("id, name, category, gstin, email, phone, address")
    .eq("is_active", true)
    .order("name", { ascending: true });
  const financeVendors: FinanceVendor[] = (
    (vendorRows ?? []) as Array<{
      id: string;
      name: string;
      category: string | null;
      gstin: string | null;
      email: string | null;
      phone: string | null;
      address: string | null;
    }>
  ).map((v) => ({
    id: v.id,
    name: v.name,
    category: v.category ?? "",
    gstin: v.gstin ?? "",
    email: v.email ?? "",
    mobile: v.phone ?? "",
    address: v.address ?? "",
  }));

  const profilesMap = await getProfilesMap();
  const records: DocRecord[] = rows.map((r) => ({
    id: r.id,
    date: r.doc_date ?? (r.created_at ? r.created_at.slice(0, 10) : ""),
    vendor: r.vendor,
    jobDescription: r.job_description ?? "",
    jobWorkNo: r.job_work_no ?? "",
    unit: r.unit === "sft" || r.unit === "nos" || r.unit === "tonnes" ? r.unit : "cft",
    quantity: Number(r.quantity),
    rate: Number(r.rate),
    total: Number(r.total),
    lineItemCount: Array.isArray(r.line_items) && r.line_items.length > 0 ? r.line_items.length : 1,
    deletedAt: r.deleted_at,
    deletedByName: r.deleted_by ? (profilesMap[r.deleted_by] ?? null) : null,
  }));

  return (
    <section className="page-card">
      <AccountsHero
        title="🧾 Work Order Document"
        description="Generate a printable work order on the company letterhead. Pick the vendor from Finance; every document you generate is kept below."
        actions={
          <Link
            href="/invoicing/install-contract"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontWeight: 700, fontSize: 13, textDecoration: "none" }}
          >
            📜 Installation contract
          </Link>
        }
      />
      <WorkOrderDocClient
        records={records}
        financeVendors={financeVendors}
        toast={sp?.toast ?? null}
        createdId={sp?.created ?? null}
        vendorFilledId={sp?.vendor_filled ?? null}
        canDelete={ALLOWED.includes(profile.role)}
      />
    </section>
  );
}
