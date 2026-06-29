/**
 * Temple Codes editor (Mig 170) — a focused page so accountants ("account" +
 * "account plus") can edit each temple-as-client's billing / shipping /
 * installation / vendor-work-order / GST info without seeing the rest of
 * Settings. The full Settings → Temple Codes section (add / delete / rename /
 * status) stays owner-tier; this is edit-only. Posts to updateTempleAction.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { TempleEditModal } from "../temple-edit-modal";

export const dynamic = "force-dynamic";

const ALLOWED = ["owner", "developer", "team_head", "senior_incharge", "carving_head", "accountant", "accountant_star"];

type Search = Promise<{ toast?: string }>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function TempleClientsPage({ searchParams }: { searchParams: Search }) {
  const { profile } = await requireAuth();
  if (!ALLOWED.includes(profile.role)) redirect("/");
  const sp = await searchParams;
  const admin = createAdminSupabaseClient();
  const { data: temples } = await admin.from("temples").select("*").order("name");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const list = (temples ?? []) as any[];

  return (
    <section className="page-card">
      <div className="page-header">
        <h1>Client billing &amp; GST</h1>
        <p className="muted">Per-temple billing &amp; shipping address, installation contact, vendor / work-order, and the default GST used when pricing that client&apos;s invoice. Open a temple to edit.</p>
      </div>

      {sp.toast && (
        <div style={{ marginTop: 12, fontSize: 13, fontWeight: 700, color: "#15803d", background: "rgba(22,101,52,0.08)", border: "1px solid rgba(22,101,52,0.3)", borderRadius: 8, padding: "8px 12px" }}>
          {sp.toast}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
        {list.length === 0 && <div className="banner">No temples configured yet.</div>}
        {list.map((temple) => (
          <TempleEditModal key={temple.id} temple={temple} returnTo="temples" />
        ))}
      </div>

      <p style={{ marginTop: 16, fontSize: 12 }}>
        <Link href="/invoicing" style={{ color: "var(--muted)", textDecoration: "none" }}>← Invoicing</Link>
      </p>
    </section>
  );
}
