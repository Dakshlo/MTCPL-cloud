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
import { updateTempleAction } from "../actions";
import { BILLING_FIELDS, SHIPPING_FIELDS, SHARED_FIELDS } from "@/lib/temple-billing-fields";

export const dynamic = "force-dynamic";

const ALLOWED = ["owner", "developer", "team_head", "senior_incharge", "carving_head", "accountant", "accountant_star"];

type Search = Promise<{ toast?: string }>;

/* eslint-disable @typescript-eslint/no-explicit-any */
export default async function TempleClientsPage({ searchParams }: { searchParams: Search }) {
  const { profile } = await requireAuth();
  if (!ALLOWED.includes(profile.role)) redirect("/");
  const sp = await searchParams;
  const admin = createAdminSupabaseClient();
  const { data: temples } = await admin.from("temples").select("*").order("name");
  const list = (temples ?? []) as any[];

  const fieldset: React.CSSProperties = { flex: "1 1 320px", minWidth: 280, border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 7 };

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
          <details key={temple.id} style={{ border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface)", overflow: "hidden" }}>
            <summary style={{ cursor: "pointer", padding: "12px 14px", fontSize: 15, fontWeight: 800, display: "flex", alignItems: "center", gap: 10 }}>
              🛕 {temple.name}
              <code className="code-badge" style={{ fontWeight: 700 }}>{temple.code_prefix}</code>
              <span style={{ marginLeft: "auto", fontSize: 11.5, fontWeight: 600, color: "var(--muted)" }}>
                {temple.gst_mode === "igst" ? `IGST ${temple.igst_percent ?? ""}%` : temple.gst_mode === "cgst_sgst" ? `CGST+SGST ${temple.cgst_percent ?? ""}+${temple.sgst_percent ?? ""}%` : "No GST"}
              </span>
            </summary>
            <div style={{ padding: "4px 14px 14px" }}>
              <form action={updateTempleAction}>
                <input type="hidden" name="id" value={temple.id} />
                <input type="hidden" name="temple_name" value={temple.name} />
                <input type="hidden" name="is_active" value={String(temple.is_active)} />
                <input type="hidden" name="return" value="temples" />

                <div className="settings-form-row">
                  <label className="stack" style={{ flex: 1 }}>
                    <span>Installation By</span>
                    <input name="installer_name" defaultValue={temple.installer_name ?? ""} placeholder="Our installation contractor" />
                  </label>
                  <label className="stack" style={{ flex: "0 0 170px" }}>
                    <span>Installation Mobile No.</span>
                    <input name="installer_phone" type="tel" defaultValue={temple.installer_phone ?? ""} placeholder="98…" />
                  </label>
                </div>

                <div style={{ display: "flex", gap: 12, marginTop: 14, flexWrap: "wrap" }}>
                  <fieldset style={fieldset}>
                    <legend style={{ fontSize: 12.5, fontWeight: 800, padding: "0 6px" }}>🧾 Billing To</legend>
                    {BILLING_FIELDS.map((f) => (
                      <label key={f.key} className="stack"><span>{f.label}</span><input name={f.key} defaultValue={temple[f.key] ?? ""} /></label>
                    ))}
                  </fieldset>
                  <fieldset style={fieldset}>
                    <legend style={{ fontSize: 12.5, fontWeight: 800, padding: "0 6px" }}>📦 Shipping To <span className="muted" style={{ fontWeight: 600 }}>· blank = same as billing</span></legend>
                    {SHIPPING_FIELDS.map((f) => (
                      <label key={f.key} className="stack"><span>{f.label}</span><input name={f.key} defaultValue={temple[f.key] ?? ""} /></label>
                    ))}
                  </fieldset>
                </div>

                {/* Default GST for this client (pre-selected when pricing). */}
                <div className="settings-form-row" style={{ marginTop: 12 }}>
                  <label className="stack" style={{ flex: "0 0 190px" }}>
                    <span>🧾 GST type (client)</span>
                    <select name="gst_mode" defaultValue={temple.gst_mode ?? "none"}>
                      <option value="none">No GST</option>
                      <option value="igst">IGST</option>
                      <option value="cgst_sgst">CGST + SGST</option>
                    </select>
                  </label>
                  <label className="stack" style={{ flex: "0 0 110px" }}><span>IGST %</span><input name="igst_percent" type="number" step="0.01" min="0" defaultValue={temple.igst_percent ?? ""} placeholder="18" /></label>
                  <label className="stack" style={{ flex: "0 0 110px" }}><span>CGST %</span><input name="cgst_percent" type="number" step="0.01" min="0" defaultValue={temple.cgst_percent ?? ""} placeholder="9" /></label>
                  <label className="stack" style={{ flex: "0 0 110px" }}><span>SGST %</span><input name="sgst_percent" type="number" step="0.01" min="0" defaultValue={temple.sgst_percent ?? ""} placeholder="9" /></label>
                </div>

                <div className="settings-form-row" style={{ marginTop: 12, alignItems: "flex-end" }}>
                  {SHARED_FIELDS.map((f) => (
                    <label key={f.key} className="stack" style={{ flex: 1 }}><span>{f.label}</span><input name={f.key} defaultValue={temple[f.key] ?? ""} /></label>
                  ))}
                  <div style={{ marginLeft: "auto" }}>
                    <button className="primary-button" type="submit">Save</button>
                  </div>
                </div>
              </form>
            </div>
          </details>
        ))}
      </div>

      <p style={{ marginTop: 16, fontSize: 12 }}>
        <Link href="/invoicing" style={{ color: "var(--muted)", textDecoration: "none" }}>← Invoicing</Link>
      </p>
    </section>
  );
}
