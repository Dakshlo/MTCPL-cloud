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
  const totalEntries = counts.reduce((a, b) => a + b, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingBottom: 36 }}>
      {/* Hero */}
      <div
        style={{
          background: "linear-gradient(135deg, #2D2410 0%, #5a4420 100%)",
          borderRadius: 18, padding: "20px 24px", color: "#fff",
          display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap",
          boxShadow: "0 12px 30px rgba(45,36,16,0.28)",
        }}
      >
        <div style={{ fontSize: 40, lineHeight: 1 }}>📒</div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.7, letterSpacing: "0.1em", textTransform: "uppercase" }}>Register</div>
          <div style={{ fontSize: 24, fontWeight: 900, lineHeight: 1.15 }}>Activity Register</div>
        </div>
        <div style={{ display: "flex", gap: 22, flexShrink: 0 }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 30, fontWeight: 900, lineHeight: 1 }}>{rows.length}</div>
            <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.75, marginTop: 3 }}>SITES</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 30, fontWeight: 900, lineHeight: 1, color: "#E8C572" }}>{totalEntries}</div>
            <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.75, marginTop: 3 }}>ENTRIES</div>
          </div>
        </div>
      </div>

      <SitesList sites={sites} toast={sp?.toast ?? null} />
    </div>
  );
}
