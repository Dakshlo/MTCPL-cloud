// ──────────────────────────────────────────────────────────────────
// /accounts/archived-bills — every archived bill, developer only.
//
// Daksh (Sep 2026): "for everyone else it is deleted. For me, the
// developer, I get to see every archived bill of any vendor and bring
// them back any time."
//
// So this is the other half of mig 226. The owner archives; this page
// is the way back. No expiry, no purge, no window — an archived bill
// can be restored years later, which is the whole reason archiving was
// safe to give him in the first place.
//
// Grouped by vendor because that is how the question arrives ("what did
// we archive for Bhavy Marble?"), with the totals stated so the effect
// on that vendor's figures is visible at a glance.
// ──────────────────────────────────────────────────────────────────

import { redirect } from "next/navigation";
import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getProfilesMap } from "@/lib/profiles";
import { RestoreBillButton } from "./restore-button";

export const dynamic = "force-dynamic";

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

type Row = {
  id: string;
  token: string;
  vendor_bill_no: string;
  bill_date: string;
  description: string | null;
  amount_total: number | null;
  amount_paid: number | null;
  archived_at: string;
  archived_by: string | null;
  archive_reason: string | null;
  bill_vendor_id: string;
  bill_vendors: { name: string } | { name: string }[] | null;
};

export default async function ArchivedBillsPage() {
  const { profile } = await requireAuth();
  if (profile.role !== "developer") redirect("/accounts");

  const admin = createAdminSupabaseClient();
  const [{ data }, profilesMap] = await Promise.all([
    admin
      .from("bills")
      .select(
        "id, token, vendor_bill_no, bill_date, description, amount_total, amount_paid, archived_at, archived_by, archive_reason, bill_vendor_id, bill_vendors(name)",
      )
      .not("archived_at", "is", null)
      .order("archived_at", { ascending: false }),
    getProfilesMap(),
  ]);

  const rows = (data ?? []) as unknown as Row[];
  const vendorName = (r: Row) =>
    (Array.isArray(r.bill_vendors) ? r.bill_vendors[0]?.name : r.bill_vendors?.name) ?? "—";

  // Group by vendor, newest archive first within each.
  const byVendor = new Map<string, { name: string; rows: Row[]; total: number }>();
  for (const r of rows) {
    const g = byVendor.get(r.bill_vendor_id) ?? { name: vendorName(r), rows: [], total: 0 };
    g.rows.push(r);
    g.total += Number(r.amount_total ?? 0);
    byVendor.set(r.bill_vendor_id, g);
  }
  const groups = [...byVendor.entries()].sort((a, b) => b[1].total - a[1].total);
  const grandTotal = rows.reduce((s, r) => s + Number(r.amount_total ?? 0), 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingBottom: 32 }}>
      <div className="record-head" style={{ flexWrap: "wrap", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Developer
          </div>
          <h1 style={{ margin: "2px 0 0" }}>🗄 Archived bills</h1>
        </div>
        <Link
          href="/accounts"
          style={{ textDecoration: "none", alignSelf: "flex-start", padding: "9px 14px", background: "var(--bg)", border: "1.5px solid var(--border)", borderRadius: 10, color: "var(--text)", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}
        >
          ← Accounts
        </Link>
      </div>

      <section className="page-card">
        <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.65, margin: 0 }}>
          Bills the owner has archived. They are hidden from the bill list, the{" "}
          {"vendors'"} totals and every report — but nothing was deleted, and restoring one puts
          it back exactly as it was, with its payments and audit trail intact. There is no
          expiry: a bill archived today can be restored years from now.
        </p>
      </section>

      {rows.length === 0 ? (
        <section className="page-card">
          <div className="muted" style={{ fontSize: 13, textAlign: "center", padding: "40px 20px" }}>
            Nothing has been archived yet.
          </div>
        </section>
      ) : (
        <>
          <section className="page-card">
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase" }}>Archived bills</div>
                <div style={{ fontSize: 24, fontWeight: 900 }}>{rows.length}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase" }}>Value held out of the accounts</div>
                <div style={{ fontSize: 24, fontWeight: 900 }}>{inr(grandTotal)}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase" }}>Vendors</div>
                <div style={{ fontSize: 24, fontWeight: 900 }}>{groups.length}</div>
              </div>
            </div>
          </section>

          {groups.map(([vendorId, g]) => (
            <section className="page-card" key={vendorId}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 10, paddingBottom: 8, borderBottom: "1px solid var(--border)" }}>
                <h2 style={{ margin: 0, fontSize: 15 }}>{g.name}</h2>
                <span className="muted" style={{ fontSize: 12, fontWeight: 700 }}>
                  {g.rows.length} bill{g.rows.length === 1 ? "" : "s"} · {inr(g.total)}
                </span>
                <Link href={`/accounts/vendors/${vendorId}`} className="muted" style={{ fontSize: 11.5, marginLeft: "auto" }}>
                  Open vendor →
                </Link>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {g.rows.map((r) => (
                  <div
                    key={r.id}
                    style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", padding: "9px 11px", border: "1px solid var(--border)", borderRadius: 10, background: "var(--bg)" }}
                  >
                    <div style={{ minWidth: 0, flex: "1 1 260px" }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                        <Link href={`/accounts/bills/${r.id}`} style={{ fontWeight: 800, fontSize: 13, fontFamily: "ui-monospace, monospace" }}>
                          {r.token}
                        </Link>
                        <span className="muted" style={{ fontSize: 11.5 }}>
                          bill {r.vendor_bill_no} · {r.bill_date}
                        </span>
                      </div>
                      <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>
                        Archived{" "}
                        {new Date(r.archived_at).toLocaleString("en-IN", {
                          timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric",
                          hour: "numeric", minute: "2-digit",
                        })}
                        {r.archived_by ? ` by ${profilesMap[r.archived_by] ?? "—"}` : ""}
                        {r.archive_reason ? ` · “${r.archive_reason}”` : ""}
                      </div>
                    </div>
                    <div style={{ fontWeight: 900, fontSize: 14, fontFamily: "ui-monospace, monospace", whiteSpace: "nowrap" }}>
                      {inr(Number(r.amount_total ?? 0))}
                    </div>
                    <RestoreBillButton billId={r.id} token={r.token} />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
