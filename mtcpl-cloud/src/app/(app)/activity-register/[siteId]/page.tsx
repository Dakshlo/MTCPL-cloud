import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { ActivityRegisterTable, type RegisterEntry } from "../register-table";

export const dynamic = "force-dynamic";

const ALLOWED = ["owner", "developer"];

type Params = Promise<{ siteId: string }>;
type SearchParams = Promise<{ toast?: string }>;

export default async function ActivitySitePage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { profile } = await requireAuth();
  if (!ALLOWED.includes(profile.role)) redirect("/dashboard");
  const { siteId } = await params;
  const sp = await searchParams;
  const admin = createAdminSupabaseClient();

  const { data: siteRow } = await admin
    .from("activity_sites")
    .select("id, name, code_prefix, code_pad")
    .eq("id", siteId)
    .maybeSingle();
  if (!siteRow) redirect("/activity-register?toast=Site+not+found");
  const site = siteRow as { id: string; name: string; code_prefix: string; code_pad: number };

  type Row = {
    id: string;
    entry_code: string | null;
    site_seq: number | null;
    activity_date: string | null;
    activity: string;
    person: string | null;
    concern_person: string | null;
    reference: string | null;
    proof_path: string | null;
    created_at: string;
  };

  // All entries for this site (paginated past the 1000-row cap).
  const rows: Row[] = [];
  for (let off = 0; off < 100000; off += 1000) {
    const { data, error } = await admin
      .from("activity_register")
      .select(
        "id, entry_code, site_seq, activity_date, activity, person, concern_person, reference, proof_path, created_at",
      )
      .eq("site_id", siteId)
      .order("site_seq", { ascending: false })
      .range(off, off + 999);
    if (error || !data || data.length === 0) break;
    rows.push(...(data as Row[]));
    if (data.length < 1000) break;
  }

  const maxSeq = rows.reduce((m, r) => Math.max(m, r.site_seq ?? 0), 0);
  const pad = Number(site.code_pad) || 3;
  const nextCode = `${site.code_prefix}/${String(maxSeq + 1).padStart(pad, "0")}`;

  const entries: RegisterEntry[] = rows.map((r) => ({
    id: r.id,
    srNo: r.site_seq ?? 0,
    code: r.entry_code ?? "—",
    date: r.activity_date ?? (r.created_at ? r.created_at.slice(0, 10) : ""),
    activity: r.activity,
    person: r.person ?? "",
    concernPerson: r.concern_person ?? "",
    reference: r.reference ?? "",
    hasProof: !!r.proof_path,
  }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingBottom: 32 }}>
      <div>
        <Link href="/activity-register" style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", textDecoration: "none" }}>
          ← All sites
        </Link>
        <h1 style={{ margin: "6px 0 0", fontSize: 22 }}>📒 {site.name}</h1>
        <p className="muted" style={{ margin: "2px 0 0", fontSize: 13 }}>
          Code scheme <code>{site.code_prefix}/{"0".repeat(Math.max(0, pad - 1))}1</code> · next entry will be{" "}
          <strong style={{ fontFamily: "ui-monospace, monospace" }}>{nextCode}</strong>
        </p>
      </div>
      <ActivityRegisterTable
        site={{ id: site.id, name: site.name, nextCode }}
        entries={entries}
        toast={sp?.toast ?? null}
      />
    </div>
  );
}
