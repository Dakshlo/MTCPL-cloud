import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { ActivityRegisterTable, type RegisterEntry } from "./register-table";

export const dynamic = "force-dynamic";

// Owner/dev only for now (Mig 101). To open it to a specific staff
// member later, widen this list (or gate on a profile flag).
const ALLOWED = ["owner", "developer"];

type SearchParams = Promise<{ toast?: string }>;

export default async function ActivityRegisterPage({ searchParams }: { searchParams: SearchParams }) {
  const { profile } = await requireAuth();
  if (!ALLOWED.includes(profile.role)) redirect("/dashboard");
  const sp = await searchParams;
  const admin = createAdminSupabaseClient();

  type Row = {
    id: string;
    entry_code: string | null;
    activity_date: string | null;
    activity: string;
    person: string | null;
    reference: string | null;
    proof_path: string | null;
    created_at: string;
  };

  // Fetch every entry (paginated past PostgREST's 1000-row cap). The
  // table read is guarded: if the migration hasn't run yet the query
  // errors and we render an empty register instead of a 500.
  const rows: Row[] = [];
  for (let off = 0; off < 100000; off += 1000) {
    const { data, error } = await admin
      .from("activity_register")
      .select("id, entry_code, activity_date, activity, person, reference, proof_path, created_at")
      .order("created_at", { ascending: false })
      .range(off, off + 999);
    if (error || !data || data.length === 0) break;
    rows.push(...(data as Row[]));
    if (data.length < 1000) break;
  }

  const total = rows.length;
  const entries: RegisterEntry[] = rows.map((r, i) => ({
    id: r.id,
    srNo: total - i, // newest on top → highest Sr No; first-ever entry = 1
    code: r.entry_code ?? "—",
    date: r.activity_date ?? (r.created_at ? r.created_at.slice(0, 10) : ""),
    activity: r.activity,
    person: r.person ?? "",
    reference: r.reference ?? "",
    hasProof: !!r.proof_path,
  }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingBottom: 32 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 22 }}>📒 Activity Register</h1>
        <p className="muted" style={{ margin: "2px 0 0", fontSize: 13, maxWidth: 760 }}>
          A dated, searchable record of company activities with proof — e.g. a stone demo / sample sent to a
          client. Each entry gets a permanent code and can carry a photo or PDF as proof, so years later you can
          search and show exactly what was done and when.
        </p>
      </div>
      <ActivityRegisterTable entries={entries} toast={sp?.toast ?? null} />
    </div>
  );
}
