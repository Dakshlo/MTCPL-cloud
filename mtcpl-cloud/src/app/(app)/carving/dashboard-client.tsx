"use client";

import Link from "next/link";
import { useState } from "react";
import { AssignModal } from "./assign-modal";

type UnassignedSlab = {
  id: string;
  label: string;
  temple: string;
  stone: string | null;
  length_ft: number;
  width_ft: number;
  thickness_ft: number;
  status: string;
  priority: boolean;
  source_block_id: string | null;
};

type JobRow = {
  id: string;
  slab_requirement_id: string;
  vendor_id: string;
  vendor_name: string;
  vendor_type: "CNC" | "Manual";
  status: string;
  due_at: string | null;
  assigned_at: string;
  completed_at: string | null;
  review_approved_at?: string | null;
  progress_phase?: string | null;
  cnc_machine_id?: string | null;
};

type Vendor = {
  id: string;
  name: string;
  vendor_type: "CNC" | "Manual";
  machines: Array<{ id: string; machine_code: string }>;
};

export function CarvingDashboardClient({
  tab,
  unassignedSlabs,
  activeJobs,
  reviewJobs,
  doneJobs,
  vendors,
  machineCodeById,
}: {
  tab: "unassigned" | "active" | "review" | "done";
  unassignedSlabs: UnassignedSlab[];
  activeJobs: JobRow[];
  reviewJobs: JobRow[];
  doneJobs: JobRow[];
  vendors: Vendor[];
  machineCodeById: Record<string, string>;
}) {
  const [assigning, setAssigning] = useState<UnassignedSlab | null>(null);

  function fmtDate(iso: string | null) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  }

  function daysUntil(iso: string | null) {
    if (!iso) return null;
    return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
  }

  return (
    <>
      {tab === "unassigned" && (
        <section className="page-card">
          {unassignedSlabs.length === 0 ? (
            <div style={{ textAlign: "center", padding: "32px 20px", color: "var(--muted-light)" }}>
              🎉 No slabs waiting for carving assignment right now.
            </div>
          ) : (
            <>
              <p className="muted" style={{ marginTop: 0, marginBottom: 12, fontSize: 13 }}>
                {unassignedSlabs.length} slab{unassignedSlabs.length > 1 ? "s" : ""} reached <strong>cut_done</strong>. Assign each to a carving vendor.
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 10 }}>
                {unassignedSlabs.map((s) => (
                  <div
                    key={s.id}
                    style={{
                      padding: "12px 14px",
                      background: s.priority ? "rgba(220,38,38,0.04)" : "var(--surface)",
                      border: `1px solid ${s.priority ? "rgba(220,38,38,0.2)" : "var(--border)"}`,
                      borderRadius: 10,
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700, fontSize: 13 }}>
                        {s.priority && "⚡ "}{s.id}
                      </span>
                      {s.stone && <span className="role-pill" style={{ fontSize: 10 }}>{s.stone}</span>}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{s.temple}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>{s.label}</div>
                    <div style={{ fontSize: 11, color: "var(--muted-light)", fontFamily: "ui-monospace, monospace" }}>
                      {s.length_ft}×{s.width_ft}×{s.thickness_ft}&Prime;
                      {s.source_block_id && ` · from ${s.source_block_id}`}
                    </div>
                    <button
                      type="button"
                      onClick={() => setAssigning(s)}
                      className="primary-button"
                      style={{ marginTop: 6, fontSize: 12, padding: "6px 12px" }}
                    >
                      Assign to Vendor →
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {tab === "active" && (
        <JobTable
          jobs={activeJobs}
          machineCodeById={machineCodeById}
          columns={["deadline", "phase"]}
          emptyMessage="No active carving jobs. Assign some slabs from the Unassigned tab."
        />
      )}

      {tab === "review" && (
        <JobTable
          jobs={reviewJobs}
          machineCodeById={machineCodeById}
          columns={["completed"]}
          emptyMessage="Nothing waiting for review. When a vendor marks a job complete, it lands here."
        />
      )}

      {tab === "done" && (
        <JobTable
          jobs={doneJobs}
          machineCodeById={machineCodeById}
          columns={["approved"]}
          emptyMessage="No approved or dispatched jobs yet."
        />
      )}

      {assigning && (
        <AssignModal
          slab={assigning}
          vendors={vendors}
          onClose={() => setAssigning(null)}
        />
      )}
    </>
  );

  function JobTable({
    jobs,
    machineCodeById,
    columns,
    emptyMessage,
  }: {
    jobs: JobRow[];
    machineCodeById: Record<string, string>;
    columns: Array<"deadline" | "phase" | "completed" | "approved">;
    emptyMessage: string;
  }) {
    if (jobs.length === 0) {
      return (
        <section className="page-card">
          <div style={{ textAlign: "center", padding: "32px 20px", color: "var(--muted-light)" }}>
            {emptyMessage}
          </div>
        </section>
      );
    }

    return (
      <section className="page-card" style={{ padding: 0, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "var(--surface-alt)" }}>
              {["Slab", "Vendor", "Machine", ...columns.map((c) => c[0].toUpperCase() + c.slice(1))].map((h) => (
                <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em", whiteSpace: "nowrap" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => {
              const days = daysUntil(j.due_at);
              const overdue = days !== null && days < 0;
              return (
                <tr key={j.id} style={{ borderTop: "1px solid var(--border-light)" }}>
                  <td style={{ padding: "10px 14px", fontFamily: "ui-monospace, monospace", fontWeight: 700 }}>
                    <Link href={`/carving/${j.id}`} style={{ color: "var(--text)", textDecoration: "none" }}>
                      {j.slab_requirement_id}
                    </Link>
                  </td>
                  <td style={{ padding: "10px 14px" }}>
                    <div style={{ fontWeight: 600 }}>{j.vendor_name}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>{j.vendor_type}</div>
                  </td>
                  <td style={{ padding: "10px 14px", fontFamily: "ui-monospace, monospace", fontSize: 11, color: "var(--muted)" }}>
                    {j.cnc_machine_id ? machineCodeById[j.cnc_machine_id] ?? "—" : "—"}
                  </td>
                  {columns.includes("deadline") && (
                    <td style={{ padding: "10px 14px", fontSize: 12 }}>
                      <span style={{ fontWeight: 600, color: overdue ? "#DC2626" : days !== null && days <= 2 ? "#D97706" : "var(--text)" }}>
                        {days === null ? "—" : overdue ? `Overdue by ${Math.abs(days)}d` : days === 0 ? "Due today" : `${days}d`}
                      </span>
                      <div style={{ fontSize: 10, color: "var(--muted)" }}>{fmtDate(j.due_at)}</div>
                    </td>
                  )}
                  {columns.includes("phase") && (
                    <td style={{ padding: "10px 14px", fontSize: 12, color: "var(--muted)" }}>
                      {j.progress_phase ?? "—"}
                    </td>
                  )}
                  {columns.includes("completed") && (
                    <td style={{ padding: "10px 14px", fontSize: 12, color: "var(--muted)" }}>
                      {fmtDate(j.completed_at)}
                    </td>
                  )}
                  {columns.includes("approved") && (
                    <td style={{ padding: "10px 14px", fontSize: 12, color: "var(--muted)" }}>
                      {j.status === "dispatched" ? "✓ Dispatched" : fmtDate(j.review_approved_at ?? null)}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    );
  }
}
