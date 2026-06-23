import Link from "next/link";

// Outsource "In Transit" tab (Daksh, Jun 2026) — slabs assigned to an
// outsource vendor that the cutting→carving transfer runner hasn't delivered
// yet (carving_assigned + no receipt). Shows current location → vendor
// (destination); they move to Active once the runner marks them delivered.

export type InTransitJob = {
  slab_requirement_id: string;
  vendor_name: string;
  temple: string;
  slab_label: string | null;
  stone: string | null;
  length_ft: number;
  width_ft: number;
  thickness_ft: number;
  slab_stock_location: string | null;
  assigned_at: string | null;
};

function fmtWhen(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "—";
  }
}

export function InTransitTab({ jobs }: { jobs: InTransitJob[] }) {
  if (jobs.length === 0) {
    return (
      <div className="banner">
        🚚 Nothing in transit. When you assign a cut slab to an outsource vendor, it waits here until the transfer runner delivers it — then it moves to <strong>Active</strong>.
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          {jobs.length} slab{jobs.length === 1 ? "" : "s"} assigned to a vendor, waiting for the transfer runner. They move to <strong>Active</strong> once marked delivered.
        </p>
        <Link href="/carving/transfer" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--gold-dark)", textDecoration: "none", border: "1px solid var(--gold-dark)", borderRadius: 8, padding: "7px 12px", whiteSpace: "nowrap" }}>
          🚚 Open Slab Transfer →
        </Link>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10 }}>
        {jobs.map((j) => (
          <div key={j.slab_requirement_id} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderLeft: "4px solid #4f46e5", borderRadius: 10, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 5 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <code style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 13 }}>{j.slab_requirement_id}</code>
              {j.stone && <span className="role-pill" style={{ fontSize: 9, padding: "1px 6px" }}>{j.stone}</span>}
              <span style={{ marginLeft: "auto", fontSize: 9.5, fontWeight: 800, color: "#fff", background: "#4f46e5", borderRadius: 4, padding: "2px 7px", letterSpacing: "0.03em" }}>🚚 IN TRANSIT</span>
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>{j.temple}{j.slab_label ? ` · ${j.slab_label}` : ""}</div>
            <div style={{ fontSize: 10.5, color: "var(--muted-light)", fontFamily: "ui-monospace, monospace" }}>{j.length_ft}×{j.width_ft}×{j.thickness_ft}&Prime;</div>
            <div style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 2 }}>
              <span style={{ fontWeight: 700, color: "#7c2d12" }}>📍 {j.slab_stock_location || "—"}</span>
              <span style={{ color: "var(--muted)" }}>→</span>
              <span style={{ fontWeight: 800, color: "#92400e" }}>🏭 {j.vendor_name}</span>
            </div>
            <div style={{ fontSize: 10.5, color: "var(--muted)" }}>Assigned {fmtWhen(j.assigned_at)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
