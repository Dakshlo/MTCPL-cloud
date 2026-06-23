// ──────────────────────────────────────────────────────────────────
// Invoicing — Installation Vendor Contract generator (Mig 148)
//
// Issue a contract on the company letterhead. Recent contracts + the
// vendor/site masters live behind two top peek buttons (Daksh) so the
// page leads with the actual "issue a contract" action.
// Access: developer / owner / accountant_star / accountant + MANAGER
// (crosscheck) — Daksh gave the Manager role this page.
// ──────────────────────────────────────────────────────────────────

import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { PeekSection } from "@/components/peek-section";
import {
  createInstallVendorAction,
  createInstallSiteAction,
  deleteInstallContractAction,
  deleteInstallVendorAction,
  deleteInstallSiteAction,
} from "./actions";
import { ContractForm } from "./contract-form";

const ALLOWED = ["developer", "owner", "accountant_star", "accountant", "crosscheck"];

const inp: React.CSSProperties = {
  width: "100%",
  padding: "9px 11px",
  fontSize: 14,
  border: "1px solid var(--border)",
  borderRadius: 8,
  background: "var(--bg)",
  color: "var(--text)",
};
const lbl: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: "var(--muted)", marginBottom: 4, display: "block" };
const card: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: 16,
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

function rs(n: number) {
  return "₹" + (Math.round(Number(n) * 100) / 100).toLocaleString("en-IN");
}
function fmtWhen(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });
  } catch {
    return "—";
  }
}

export default async function InstallContractPage({
  searchParams,
}: {
  searchParams: Promise<{ toast?: string; created?: string }>;
}) {
  const { profile } = await requireAuth();
  if (!ALLOWED.includes(profile.role)) redirect("/invoicing");
  const admin = createAdminSupabaseClient();
  const params = await searchParams;

  const [{ data: vendors }, { data: sites }, { data: contracts }] = await Promise.all([
    admin.from("install_vendors").select("id, name, contact_person, phone, gstin, address").eq("is_active", true).order("name"),
    admin.from("install_sites").select("id, project_name, location").eq("is_active", true).order("project_name"),
    admin
      .from("install_contracts")
      .select("id, contract_no, vendor_name, site_project, price, doc_date, created_at, deleted_at")
      .order("created_at", { ascending: false })
      .limit(40),
  ]);
  const vList = (vendors ?? []) as { id: string; name: string; contact_person: string | null; phone: string | null; gstin: string | null; address: string | null }[];
  const sList = (sites ?? []) as { id: string; project_name: string; location: string | null }[];
  const cList = (contracts ?? []) as {
    id: string; contract_no: string | null; vendor_name: string; site_project: string;
    price: number | string; doc_date: string | null; created_at: string; deleted_at: string | null;
  }[];
  const activeContracts = cList.filter((c) => !c.deleted_at).length;

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingBottom: 40, maxWidth: 880 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 22 }}>📜 Installation Vendor Contract</h1>
        <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
          Issue a formal installation contract on the company letterhead. Pick a vendor + project site and a price.
        </p>
      </div>

      {params.toast && (
        <div role="status" style={{ padding: "10px 14px", background: "rgba(22,163,74,0.10)", border: "1px solid rgba(22,163,74,0.35)", color: "#15803d", borderRadius: 8, fontSize: 13, fontWeight: 700 }}>
          {params.toast}
        </div>
      )}

      {/* ── Top buttons: Recent Contracts + Vendors & Sites ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
        <PeekSection title="Recent Contracts" icon="📋" count={cList.length} subtitle={`${activeContracts} active · download or cancel`} modalMaxWidth={760}>
          {cList.length === 0 ? (
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>No contracts issued yet.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {cList.map((c) => {
                const deleted = !!c.deleted_at;
                const isNew = params.created === c.id;
                return (
                  <div
                    key={c.id}
                    style={{
                      display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
                      padding: "10px 12px", borderRadius: 10,
                      border: `1px solid ${deleted ? "#dc2626" : isNew ? "var(--gold-dark)" : "var(--border)"}`,
                      background: deleted ? "rgba(220,38,38,0.06)" : isNew ? "rgba(232,197,114,0.10)" : "var(--surface-alt)",
                      opacity: deleted ? 0.75 : 1,
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <code style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 13 }}>{c.contract_no ?? "—"}</code>
                        {deleted && <span style={{ fontSize: 10, fontWeight: 800, color: "#fff", background: "#dc2626", borderRadius: 4, padding: "1px 6px" }}>CANCELLED</span>}
                        <span style={{ fontSize: 11, color: "var(--muted)" }}>{fmtWhen(c.doc_date ?? c.created_at)}</span>
                      </div>
                      <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>
                        {c.vendor_name} · {c.site_project} · <strong style={{ color: "var(--text)" }}>{rs(Number(c.price))}</strong>
                      </div>
                    </div>
                    <a href={`/api/invoicing/install-contract/${c.id}`} className="ghost-button" style={{ fontSize: 13, padding: "7px 14px", textDecoration: "none" }}>
                      ⬇ Download
                    </a>
                    {!deleted && (
                      <form action={deleteInstallContractAction}>
                        <input type="hidden" name="id" value={c.id} />
                        <button type="submit" className="ghost-button danger-ghost" style={{ fontSize: 13, padding: "7px 12px" }}>Cancel</button>
                      </form>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </PeekSection>

        <PeekSection title="Vendors & Sites" icon="🏢" count={vList.length + sList.length} subtitle={`${vList.length} vendor${vList.length === 1 ? "" : "s"} · ${sList.length} site${sList.length === 1 ? "" : "s"} — add or manage`} modalMaxWidth={860}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
            {/* Vendors */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <h3 style={{ margin: 0, fontSize: 14 }}>🛠 Installation vendors</h3>
              <form action={createInstallVendorAction} style={{ display: "flex", flexDirection: "column", gap: 10, ...card, padding: 12 }}>
                <div><label style={lbl}>Vendor name *</label><input name="name" required placeholder="e.g. Shree Installation Works" style={inp} /></div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ flex: "1 1 130px" }}><label style={lbl}>Contact person</label><input name="contact_person" style={inp} /></div>
                  <div style={{ flex: "1 1 130px" }}><label style={lbl}>Phone</label><input name="phone" style={inp} /></div>
                </div>
                <div><label style={lbl}>GSTIN</label><input name="gstin" style={{ ...inp, textTransform: "uppercase" }} /></div>
                <div><label style={lbl}>Address</label><textarea name="address" rows={2} style={{ ...inp, resize: "vertical", fontFamily: "inherit" }} /></div>
                <button type="submit" className="primary-button" style={{ alignSelf: "flex-start", fontSize: 13, padding: "8px 16px" }}>＋ Add vendor</button>
              </form>
              {vList.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {vList.map((v) => (
                    <div key={v.id} style={{ ...card, padding: "10px 12px", gap: 4, borderLeft: "3px solid var(--gold-dark)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
                        <span style={{ fontWeight: 800, fontSize: 14 }}>🛠 {v.name}</span>
                        <form action={deleteInstallVendorAction}>
                          <input type="hidden" name="id" value={v.id} />
                          <button type="submit" className="ghost-button danger-ghost" style={{ fontSize: 11, padding: "4px 9px" }}>Delete</button>
                        </form>
                      </div>
                      {(v.contact_person || v.phone) && (
                        <div style={{ fontSize: 12, color: "var(--muted)" }}>👤 {[v.contact_person, v.phone].filter(Boolean).join(" · ") || "—"}</div>
                      )}
                      {v.gstin && <div style={{ fontSize: 11.5, color: "var(--muted)", fontFamily: "ui-monospace, monospace" }}>GSTIN: {v.gstin}</div>}
                      {v.address && <div style={{ fontSize: 11.5, color: "var(--muted)" }}>📍 {v.address}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Sites */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <h3 style={{ margin: 0, fontSize: 14 }}>🏛 Project sites</h3>
              <form action={createInstallSiteAction} style={{ display: "flex", flexDirection: "column", gap: 10, ...card, padding: 12 }}>
                <div><label style={lbl}>Temple / Project name *</label><input name="project_name" required placeholder="e.g. Umiya Mataji Temple" style={inp} /></div>
                <div><label style={lbl}>Site location</label><input name="location" placeholder="e.g. Ahmedabad, Gujarat" style={inp} /></div>
                <button type="submit" className="primary-button" style={{ alignSelf: "flex-start", fontSize: 13, padding: "8px 16px" }}>＋ Add site</button>
              </form>
              {sList.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {sList.map((s) => (
                    <div key={s.id} style={{ ...card, padding: "10px 12px", gap: 4, borderLeft: "3px solid #0f766e" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
                        <span style={{ fontWeight: 800, fontSize: 14 }}>🏛 {s.project_name}</span>
                        <form action={deleteInstallSiteAction}>
                          <input type="hidden" name="id" value={s.id} />
                          <button type="submit" className="ghost-button danger-ghost" style={{ fontSize: 11, padding: "4px 9px" }}>Delete</button>
                        </form>
                      </div>
                      {s.location && <div style={{ fontSize: 12, color: "var(--muted)" }}>📍 {s.location}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </PeekSection>
      </div>

      {/* ── Issue a contract — the main action ── */}
      <div style={{ ...card, border: "1.5px solid var(--gold-dark)" }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>✍️ Issue a contract</h2>
        {vList.length === 0 || sList.length === 0 ? (
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>
            Open <strong>🏢 Vendors &amp; Sites</strong> above and add at least one {vList.length === 0 ? "vendor" : ""}{vList.length === 0 && sList.length === 0 ? " and " : ""}{sList.length === 0 ? "site" : ""} first.
          </p>
        ) : (
          <ContractForm vendors={vList} sites={sList} today={today} />
        )}
      </div>
    </div>
  );
}
