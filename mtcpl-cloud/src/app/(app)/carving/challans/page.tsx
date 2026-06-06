import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const ALLOWED = ["developer", "owner", "carving_head", "senior_incharge"];

function inr(n: number): string {
  return "₹" + Math.round(Number(n)).toLocaleString("en-IN");
}
function fmtDate(d: string | null): string {
  if (!d) return "—";
  try {
    return new Date(d.length <= 10 ? `${d}T00:00:00+05:30` : d).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "Asia/Kolkata",
    });
  } catch {
    return d;
  }
}

export default async function CarvingChallansListPage() {
  const { profile } = await requireAuth();
  if (!ALLOWED.includes(profile.role)) redirect("/carving?mode=outsource");
  const admin = createAdminSupabaseClient();

  const { data: rows } = await admin
    .from("carving_challans")
    .select("id, challan_number, challan_date, vendor_name, amount_total, is_rcm, cancelled_at, created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  const challans = ((rows ?? []) as Array<{
    id: string;
    challan_number: string;
    challan_date: string | null;
    vendor_name: string;
    amount_total: number;
    is_rcm: boolean;
    cancelled_at: string | null;
  }>);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingBottom: 32, maxWidth: 880 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div>
          <Link href="/carving?mode=outsource" style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", textDecoration: "none" }}>
            ← Carving Jobs
          </Link>
          <h1 style={{ margin: "6px 0 0", fontSize: 22 }}>🧾 Jobwork challans</h1>
        </div>
        <Link href="/carving/challans/new" style={{ padding: "8px 16px", fontSize: 13, fontWeight: 700, color: "#fff", background: "var(--gold-dark)", borderRadius: 8, textDecoration: "none" }}>
          + New challan
        </Link>
      </div>

      {challans.length === 0 ? (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 20, color: "var(--muted)" }}>
          No jobwork challans yet. Generate one from approved Outsource slabs.
        </div>
      ) : (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
          {challans.map((c) => (
            <Link
              key={c.id}
              href={`/carving/challans/${c.id}`}
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 16px", borderTop: "1px solid var(--border)", textDecoration: "none", color: "inherit" }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>
                  {c.challan_number}
                  {c.cancelled_at && (
                    <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 800, color: "#991b1b", background: "rgba(220,38,38,0.1)", borderRadius: 999, padding: "1px 6px" }}>CANCELLED</span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>{c.vendor_name} · {fmtDate(c.challan_date)}</div>
              </div>
              <div style={{ fontSize: 15, fontWeight: 800, fontFamily: "ui-monospace, monospace", color: "var(--gold-dark)" }}>
                {inr(c.amount_total)}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
