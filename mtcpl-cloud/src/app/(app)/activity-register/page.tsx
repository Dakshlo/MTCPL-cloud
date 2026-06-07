import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { SitesList, type SiteCard } from "./sites-list";

export const dynamic = "force-dynamic";

// Mig 101 + 104 — owner/dev plus Tender Manager, senior_incharge, carving_head.
const ALLOWED = ["owner", "developer", "tender_manager", "senior_incharge", "carving_head"];

type SearchParams = Promise<{ toast?: string }>;

export default async function ActivityRegisterHome({ searchParams }: { searchParams: SearchParams }) {
  const { profile } = await requireAuth();
  if (!ALLOWED.includes(profile.role)) redirect("/dashboard");
  const sp = await searchParams;
  const admin = createAdminSupabaseClient();

  // Sites. Guarded: if the migration hasn't run yet the query errors and
  // we render an empty list (with a "create a site" prompt) instead of 500.
  const { data: siteRows } = await admin
    .from("activity_sites")
    .select("id, name, code_prefix, code_pad, created_at")
    .order("name", { ascending: true });
  const rows = (siteRows ?? []) as Array<{
    id: string;
    name: string;
    code_prefix: string;
    code_pad: number;
    created_at: string;
  }>;

  // Per-site entry counts (cheap head counts; a handful of sites).
  const counts = await Promise.all(
    rows.map((s) =>
      admin
        .from("activity_register")
        .select("*", { count: "exact", head: true })
        .eq("site_id", s.id)
        .then((r) => r.count ?? 0),
    ),
  );

  const sites: SiteCard[] = rows.map((s, i) => ({
    id: s.id,
    name: s.name,
    codePrefix: s.code_prefix,
    codePad: s.code_pad,
    count: counts[i] ?? 0,
  }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingBottom: 32 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 22 }}>📒 Activity Register</h1>
        <p className="muted" style={{ margin: "2px 0 0", fontSize: 13, maxWidth: 760 }}>
          A dated, searchable record of company activities with proof — organised by site. Open a site to see
          its register and add entries; each site has its own code scheme (e.g. <code>Lnt/OOS/001</code>).
        </p>
      </div>
      <SitesList sites={sites} toast={sp?.toast ?? null} />
    </div>
  );
}
