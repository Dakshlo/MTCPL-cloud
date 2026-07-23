// Vehicles → Commercial (mig 204) — owner + developer. EMI monitor +
// government-paper uploads + insurance / PUC / FITNESS expiries.

import { requireAuth } from "@/lib/auth";
import { VEHICLES_ROLES } from "@/lib/vehicles-access";
import { loadVehicles, toastFrom } from "../_data";
import { VehiclesBoard } from "../vehicles-client";

export const dynamic = "force-dynamic";

export default async function CommercialVehiclesPage({ searchParams }: { searchParams: Promise<{ toast?: string }> }) {
  await requireAuth(VEHICLES_ROLES);
  const sp = await searchParams;
  const { rows, migMissing } = await loadVehicles("commercial");
  const toast = toastFrom(sp);

  return (
    <section className="page-card">
      <div className="page-header">
        <h1>🚛 Commercial vehicles</h1>
        <p className="muted">EMI · insurance · PUC · <strong>fitness</strong> · government papers. <span style={{ fontWeight: 700 }}>{rows.length}</span> vehicle{rows.length === 1 ? "" : "s"}.</p>
      </div>
      {toast && (
        <div style={{ marginTop: 12, fontSize: 13, fontWeight: 700, color: "#15803d", background: "rgba(22,101,52,0.08)", border: "1px solid rgba(22,101,52,0.3)", borderRadius: 8, padding: "8px 12px" }}>{toast}</div>
      )}
      {migMissing ? (
        <div className="banner" style={{ marginTop: 14 }}>Run migration <strong>204_vehicles_department.sql</strong> to switch this department on.</div>
      ) : (
        <VehiclesBoard kind="commercial" vehicles={rows} />
      )}
    </section>
  );
}
