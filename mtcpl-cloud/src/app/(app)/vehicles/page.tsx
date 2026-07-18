// Vehicles → Overview (mig 204) — owner + developer. The expiry radar:
// everything expiring soon (insurance / PUC / fitness) across BOTH fleets,
// plus the monthly EMI load. Pure server render — fast.

import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { loadVehicles } from "./_data";

export const dynamic = "force-dynamic";

// Local copy — do NOT import runtime values from the "use client" module
// (client-reference proxy gotcha).
function daysTo(date: string | null): number | null {
  if (!date) return null;
  const target = new Date(`${date.slice(0, 10)}T00:00:00+05:30`).getTime();
  return Math.floor((target - Date.now()) / 86_400_000);
}
const fmtD = (d: string) =>
  new Date(`${d.slice(0, 10)}T00:00:00+05:30`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

export default async function VehiclesOverviewPage() {
  await requireAuth(["owner", "developer"]);
  const { rows, migMissing } = await loadVehicles();

  type Alert = { vehicle: string; kind: "commercial" | "personal"; doc: string; date: string; days: number };
  const alerts: Alert[] = [];
  for (const v of rows) {
    const docs: Array<[string, string | null]> = [
      ["Insurance", v.insurance_expiry],
      ["PUC", v.puc_expiry],
      ...(v.kind === "commercial" ? ([["Fitness", v.fitness_expiry]] as Array<[string, string | null]>) : []),
    ];
    for (const [doc, date] of docs) {
      const d = daysTo(date);
      if (date && d != null && d <= 45) alerts.push({ vehicle: v.name, kind: v.kind, doc, date, days: d });
    }
  }
  alerts.sort((a, b) => a.days - b.days);
  const expired = alerts.filter((a) => a.days < 0).length;
  const soon = alerts.filter((a) => a.days >= 0 && a.days <= 30).length;

  const emis = rows.filter((v) => v.emi_active && v.emi_amount != null).sort((a, b) => (a.emi_day ?? 32) - (b.emi_day ?? 32));
  const emiTotal = emis.reduce((s, v) => s + (v.emi_amount ?? 0), 0);
  const commercial = rows.filter((v) => v.kind === "commercial").length;
  const personal = rows.length - commercial;

  const stat = (icon: string, n: string | number, label: string, color?: string): React.ReactNode => (
    <div style={{ flex: "1 1 150px", border: "1px solid var(--border)", borderRadius: 13, background: "var(--surface)", padding: "14px 16px" }}>
      <div style={{ fontSize: 21, fontWeight: 900, color: color ?? "var(--text)" }}>{icon} {n}</div>
      <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", marginTop: 3 }}>{label}</div>
    </div>
  );

  return (
    <section className="page-card">
      <div className="page-header">
        <h1>🚚 Vehicles</h1>
        <p className="muted">Every vehicle document in one place — what expires next, and this month&apos;s EMI load.</p>
      </div>

      {migMissing ? (
        <div className="banner" style={{ marginTop: 14 }}>Run migration <strong>204_vehicles_department.sql</strong> to switch this department on.</div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
            {stat("🚛", commercial, "Commercial")}
            {stat("🚗", personal, "Personal")}
            {stat("⛔", expired, "Expired documents", expired ? "#b91c1c" : undefined)}
            {stat("⏳", soon, "Expiring ≤ 30 days", soon ? "#b45309" : undefined)}
            {stat("💳", emis.length ? inr(emiTotal) : "—", `Monthly EMI · ${emis.length} loan${emis.length === 1 ? "" : "s"}`, "#4f6d9c")}
          </div>

          {/* Expiry radar */}
          <div style={{ marginTop: 22 }}>
            <div style={{ fontSize: 12, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", marginBottom: 9 }}>📅 Expiry radar — next 45 days</div>
            {alerts.length === 0 ? (
              <div style={{ border: "1px dashed var(--border)", borderRadius: 12, background: "var(--surface)", padding: "22px", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
                ✅ Nothing expiring in the next 45 days.
              </div>
            ) : (
              <div style={{ display: "grid", gap: 7 }}>
                {alerts.map((a, i) => {
                  const exp = a.days < 0;
                  return (
                    <Link key={i} href={`/vehicles/${a.kind}`} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "10px 14px", borderRadius: 11, textDecoration: "none", color: "var(--text)", background: exp ? "rgba(220,38,38,0.05)" : "rgba(217,119,6,0.05)", border: `1px solid ${exp ? "#fecaca" : "#fde68a"}`, borderLeft: `4px solid ${exp ? "#dc2626" : "#d97706"}` }}>
                      <span style={{ fontSize: 16 }}>{a.kind === "commercial" ? "🚛" : "🚗"}</span>
                      <span style={{ fontWeight: 900, fontSize: 13.5, minWidth: 120 }}>{a.vehicle}</span>
                      <span style={{ fontSize: 11, fontWeight: 800, color: exp ? "#b91c1c" : "#b45309", background: exp ? "rgba(220,38,38,0.1)" : "rgba(217,119,6,0.12)", borderRadius: 999, padding: "2px 10px" }}>{a.doc.toUpperCase()}</span>
                      <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{fmtD(a.date)}</span>
                      <span style={{ marginLeft: "auto", fontSize: 12.5, fontWeight: 900, color: exp ? "#b91c1c" : "#b45309" }}>
                        {exp ? `EXPIRED ${Math.abs(a.days)}d ago` : a.days === 0 ? "expires TODAY" : `${a.days} days left`}
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {/* EMI monitor */}
          <div style={{ marginTop: 22 }}>
            <div style={{ fontSize: 12, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", marginBottom: 9 }}>💳 EMI monitor — by due day</div>
            {emis.length === 0 ? (
              <div style={{ border: "1px dashed var(--border)", borderRadius: 12, background: "var(--surface)", padding: "22px", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
                No vehicles on EMI.
              </div>
            ) : (
              <div style={{ display: "grid", gap: 7 }}>
                {emis.map((v) => (
                  <Link key={v.id} href={`/vehicles/${v.kind}`} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "10px 14px", borderRadius: 11, textDecoration: "none", color: "var(--text)", background: "var(--surface)", border: "1px solid var(--border)", borderLeft: "4px solid #4f6d9c" }}>
                    <span style={{ fontSize: 16 }}>{v.kind === "commercial" ? "🚛" : "🚗"}</span>
                    <span style={{ fontWeight: 900, fontSize: 13.5, minWidth: 120 }}>{v.name}</span>
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>{v.emi_lender || "—"}</span>
                    <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={{ fontSize: 12, fontWeight: 800, color: "#4f6d9c" }}>day {v.emi_day ?? "—"}</span>
                      <span style={{ fontSize: 13.5, fontWeight: 900, fontFamily: "ui-monospace, monospace" }}>{inr(v.emi_amount ?? 0)}</span>
                    </span>
                  </Link>
                ))}
                <div style={{ display: "flex", justifyContent: "flex-end", fontSize: 13, fontWeight: 900, padding: "4px 14px" }}>
                  Total monthly outgo: <span style={{ fontFamily: "ui-monospace, monospace", marginLeft: 8, color: "#4f6d9c" }}>{inr(emiTotal)}</span>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
