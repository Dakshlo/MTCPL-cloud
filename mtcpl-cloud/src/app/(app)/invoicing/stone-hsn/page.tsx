/**
 * Stone & HSN code (Mig 171) — accountant-managed. Each stone type gets an HSN
 * code and an optional vendor HSN code; these print on the tax invoice next to
 * the stone name. HSN belongs to the stone (same on every temple). The per-temple
 * choice of HSN vs vendor HSN (which forces 18% GST) lives on Client billing & GST.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canUseInvoicing } from "@/lib/invoicing-permissions";
import { setStoneHsnAction } from "../actions";

export const dynamic = "force-dynamic";

type Search = Promise<{ toast?: string }>;

export default async function StoneHsnPage({ searchParams }: { searchParams: Search }) {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) redirect("/");
  const sp = await searchParams;
  const admin = createAdminSupabaseClient();
  const { data: stones } = await admin
    .from("stone_types")
    .select("id, name, hsn_code, hsn_vendor_code")
    .order("name");
  const list = (stones ?? []) as Array<{ id: string; name: string; hsn_code: string | null; hsn_vendor_code: string | null }>;

  const inp: React.CSSProperties = { fontSize: 13, padding: "7px 9px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontFamily: "ui-monospace, monospace" };

  return (
    <section className="page-card">
      <div className="page-header">
        <h1>Stone &amp; HSN code</h1>
        <p className="muted">Set the HSN code (and optional vendor HSN) per stone type. It prints next to the stone name on every tax invoice. Whether a temple uses the normal or vendor HSN is set on <strong>Client billing &amp; GST</strong>.</p>
      </div>

      {sp.toast && (
        <div style={{ marginTop: 12, fontSize: 13, fontWeight: 700, color: "#15803d", background: "rgba(22,101,52,0.08)", border: "1px solid rgba(22,101,52,0.3)", borderRadius: 8, padding: "8px 12px" }}>
          {sp.toast}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
        {list.length === 0 && <div className="banner">No stone types configured yet.</div>}
        {list.map((s) => (
          <form key={s.id} action={setStoneHsnAction} style={{ display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap", border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface)", padding: "12px 14px" }}>
            <input type="hidden" name="id" value={s.id} />
            <div style={{ flex: "1 1 180px", minWidth: 0 }}>
              <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--muted)" }}>Stone type</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text)" }}>{s.name}</div>
            </div>
            <label className="stack" style={{ flex: "0 0 200px" }}>
              <span>HSN code</span>
              <input name="hsn_code" defaultValue={s.hsn_code ?? ""} style={inp} />
            </label>
            <label className="stack" style={{ flex: "0 0 200px" }}>
              <span>Vendor HSN code <span className="muted" style={{ fontWeight: 600 }}>(optional)</span></span>
              <input name="hsn_vendor_code" defaultValue={s.hsn_vendor_code ?? ""} style={inp} />
            </label>
            <button className="primary-button" type="submit">Save</button>
          </form>
        ))}
      </div>

      <p style={{ marginTop: 16, fontSize: 12 }}>
        <Link href="/invoicing" style={{ color: "var(--muted)", textDecoration: "none" }}>← Invoicing</Link>
      </p>
    </section>
  );
}
