"use client";

/**
 * Carving dashboard client — renders each of the four tabs (Unassigned,
 * Active, Awaiting Review, Carving Done) as temple-grouped
 * sections. Also exposes a Temple filter dropdown to narrow the view
 * to one specific temple.
 *
 * Temple filter is persisted in the URL as ?temple=... so switching
 * tabs preserves it, and operators who only handle one temple can
 * bookmark their scope.
 *
 * Future-proofing: when we add per-user temple scopes, the server
 * will pre-filter `unassignedSlabs` / `activeJobs` / etc. to the
 * user's scope and pass `scopedTemples` as the only valid filter
 * options. Client code stays the same.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
  temple: string;
  slab_label: string | null;
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
  templeNames,
  templeFilter,
}: {
  tab: "unassigned" | "active" | "review" | "done";
  unassignedSlabs: UnassignedSlab[];
  activeJobs: JobRow[];
  reviewJobs: JobRow[];
  doneJobs: JobRow[];
  vendors: Vendor[];
  machineCodeById: Record<string, string>;
  /** Every temple that appears in any of the four datasets. Dropdown source. */
  templeNames: string[];
  /** Currently-selected temple filter. "" or "all" means no filter. */
  templeFilter: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [assigning, setAssigning] = useState<UnassignedSlab | null>(null);

  // Temple filter handler — updates URL, preserving tab.
  function setTempleFilter(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next && next !== "all") params.set("temple", next);
    else params.delete("temple");
    const q = params.toString();
    router.replace(q ? `/carving?${q}` : "/carving");
  }

  // Apply temple filter to each dataset.
  const filteredUnassigned = useMemo(
    () =>
      templeFilter && templeFilter !== "all"
        ? unassignedSlabs.filter((s) => s.temple === templeFilter)
        : unassignedSlabs,
    [unassignedSlabs, templeFilter],
  );
  const filteredActive = useMemo(
    () =>
      templeFilter && templeFilter !== "all"
        ? activeJobs.filter((j) => j.temple === templeFilter)
        : activeJobs,
    [activeJobs, templeFilter],
  );
  const filteredReview = useMemo(
    () =>
      templeFilter && templeFilter !== "all"
        ? reviewJobs.filter((j) => j.temple === templeFilter)
        : reviewJobs,
    [reviewJobs, templeFilter],
  );
  const filteredDone = useMemo(
    () =>
      templeFilter && templeFilter !== "all"
        ? doneJobs.filter((j) => j.temple === templeFilter)
        : doneJobs,
    [doneJobs, templeFilter],
  );

  function fmtDate(iso: string | null) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  }

  function daysUntil(iso: string | null) {
    if (!iso) return null;
    return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
  }

  const filterBar = (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 14px",
        marginBottom: 14,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        flexWrap: "wrap",
      }}
    >
      <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
        Temple
      </span>
      <select
        value={templeFilter || "all"}
        onChange={(e) => setTempleFilter(e.target.value)}
        style={{
          fontSize: 13,
          padding: "6px 10px",
          border: "1px solid var(--border)",
          borderRadius: 6,
          background: "var(--bg)",
          color: "var(--text)",
          minWidth: 220,
        }}
      >
        <option value="all">All temples</option>
        {templeNames.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      {templeFilter && templeFilter !== "all" && (
        <button
          type="button"
          onClick={() => setTempleFilter("all")}
          style={{
            background: "transparent",
            border: "1px solid var(--border)",
            color: "var(--muted)",
            padding: "4px 10px",
            fontSize: 11,
            borderRadius: 5,
            cursor: "pointer",
          }}
        >
          ✕ Clear
        </button>
      )}
    </div>
  );

  return (
    <>
      {filterBar}

      {tab === "unassigned" && (
        <UnassignedByTemple
          slabs={filteredUnassigned}
          onAssign={(s) => setAssigning(s)}
        />
      )}

      {tab === "active" && (
        <JobsByTemple
          jobs={filteredActive}
          machineCodeById={machineCodeById}
          columns={["deadline", "phase"]}
          emptyMessage="No active carving jobs. Assign some slabs from the Unassigned tab."
          fmtDate={fmtDate}
          daysUntil={daysUntil}
        />
      )}

      {tab === "review" && (
        <JobsByTemple
          jobs={filteredReview}
          machineCodeById={machineCodeById}
          columns={["completed"]}
          emptyMessage="Nothing waiting for review. When a vendor marks a job complete, it lands here."
          fmtDate={fmtDate}
          daysUntil={daysUntil}
        />
      )}

      {tab === "done" && (
        <JobsByTemple
          jobs={filteredDone}
          machineCodeById={machineCodeById}
          columns={["approved"]}
          emptyMessage="No slabs in Carving Done yet."
          fmtDate={fmtDate}
          daysUntil={daysUntil}
        />
      )}

      {assigning && (
        <AssignModal slab={assigning} vendors={vendors} onClose={() => setAssigning(null)} />
      )}
    </>
  );
}

// ─── Unassigned tab — grouped by temple ─────────────────────────────────

function UnassignedByTemple({
  slabs,
  onAssign,
}: {
  slabs: UnassignedSlab[];
  onAssign: (s: UnassignedSlab) => void;
}) {
  const groups = useMemo(() => groupByTemple(slabs, (s) => s.temple), [slabs]);

  if (slabs.length === 0) {
    return (
      <section className="page-card">
        <div style={{ textAlign: "center", padding: "32px 20px", color: "var(--muted-light)" }}>
          🎉 No slabs waiting for carving assignment in this view.
        </div>
      </section>
    );
  }

  const openByDefault = groups.length <= 3;

  return (
    <>
      <p className="muted" style={{ margin: "0 0 12px", fontSize: 13 }}>
        {slabs.length} slab{slabs.length > 1 ? "s" : ""} across {groups.length} temple{groups.length > 1 ? "s" : ""}.
        Assign each to a carving vendor.
      </p>
      {groups.map(({ temple, items }) => (
        <details key={temple} open={openByDefault} style={{ marginBottom: 10 }}>
          <summary
            style={{
              cursor: "pointer",
              padding: "10px 14px",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "10px 10px 0 0",
              display: "flex",
              alignItems: "center",
              gap: 10,
              userSelect: "none",
              listStyle: "none",
            }}
          >
            <span style={{ fontSize: 11 }}>▾</span>
            <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>🏛 {temple}</span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                padding: "2px 9px",
                borderRadius: 999,
                background: "var(--gold-dark)",
                color: "#fff",
                fontFamily: "ui-monospace, monospace",
                minWidth: 24,
                textAlign: "center",
              }}
            >
              {items.length}
            </span>
          </summary>
          <div
            style={{
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderTop: "none",
              borderRadius: "0 0 10px 10px",
              padding: 12,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))",
              gap: 10,
            }}
          >
            {items.map((s) => (
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
                    {s.priority && "⚡ "}
                    {s.id}
                  </span>
                  {s.stone && (
                    <span className="role-pill" style={{ fontSize: 10 }}>
                      {s.stone}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>{s.label}</div>
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--muted-light)",
                    fontFamily: "ui-monospace, monospace",
                  }}
                >
                  {s.length_ft}×{s.width_ft}×{s.thickness_ft}&Prime;
                  {s.source_block_id && ` · from ${s.source_block_id}`}
                </div>
                <button
                  type="button"
                  onClick={() => onAssign(s)}
                  className="primary-button"
                  style={{ marginTop: 6, fontSize: 12, padding: "6px 12px" }}
                >
                  Assign to Vendor →
                </button>
              </div>
            ))}
          </div>
        </details>
      ))}
    </>
  );
}

// ─── Jobs (active / review / done) — grouped by temple ──────────────────

function JobsByTemple({
  jobs,
  machineCodeById,
  columns,
  emptyMessage,
  fmtDate,
  daysUntil,
}: {
  jobs: JobRow[];
  machineCodeById: Record<string, string>;
  columns: Array<"deadline" | "phase" | "completed" | "approved">;
  emptyMessage: string;
  fmtDate: (iso: string | null) => string;
  daysUntil: (iso: string | null) => number | null;
}) {
  const groups = useMemo(() => groupByTemple(jobs, (j) => j.temple), [jobs]);

  if (jobs.length === 0) {
    return (
      <section className="page-card">
        <div style={{ textAlign: "center", padding: "32px 20px", color: "var(--muted-light)" }}>
          {emptyMessage}
        </div>
      </section>
    );
  }

  const openByDefault = groups.length <= 3;

  return (
    <>
      <p className="muted" style={{ margin: "0 0 12px", fontSize: 13 }}>
        {jobs.length} job{jobs.length > 1 ? "s" : ""} across {groups.length} temple
        {groups.length > 1 ? "s" : ""}.
      </p>
      {groups.map(({ temple, items }) => (
        <details key={temple} open={openByDefault} style={{ marginBottom: 10 }}>
          <summary
            style={{
              cursor: "pointer",
              padding: "10px 14px",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "10px 10px 0 0",
              display: "flex",
              alignItems: "center",
              gap: 10,
              userSelect: "none",
              listStyle: "none",
            }}
          >
            <span style={{ fontSize: 11 }}>▾</span>
            <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>🏛 {temple}</span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                padding: "2px 9px",
                borderRadius: 999,
                background: "var(--gold-dark)",
                color: "#fff",
                fontFamily: "ui-monospace, monospace",
                minWidth: 24,
                textAlign: "center",
              }}
            >
              {items.length}
            </span>
          </summary>
          <section
            className="page-card"
            style={{
              padding: 0,
              overflow: "hidden",
              borderTop: "none",
              borderRadius: "0 0 10px 10px",
            }}
          >
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "var(--surface-alt)" }}>
                  {["Slab", "Vendor", "Machine", ...columns.map((c) => c[0].toUpperCase() + c.slice(1))].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: "10px 14px",
                        textAlign: "left",
                        fontSize: 10,
                        fontWeight: 700,
                        color: "var(--muted)",
                        textTransform: "uppercase",
                        letterSpacing: "0.07em",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((j) => {
                  const days = daysUntil(j.due_at);
                  const overdue = days !== null && days < 0;
                  return (
                    <tr key={j.id} style={{ borderTop: "1px solid var(--border-light)" }}>
                      <td
                        style={{
                          padding: "10px 14px",
                          fontFamily: "ui-monospace, monospace",
                          fontWeight: 700,
                        }}
                      >
                        <Link
                          href={`/carving/${j.id}`}
                          style={{ color: "var(--text)", textDecoration: "none" }}
                        >
                          {j.slab_requirement_id}
                        </Link>
                        {j.slab_label && (
                          <div
                            style={{
                              fontSize: 11,
                              color: "var(--muted)",
                              fontWeight: 400,
                              marginTop: 2,
                              fontFamily: "inherit",
                            }}
                          >
                            {j.slab_label}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: "10px 14px" }}>
                        <div style={{ fontWeight: 600 }}>{j.vendor_name}</div>
                        <div style={{ fontSize: 11, color: "var(--muted)" }}>{j.vendor_type}</div>
                      </td>
                      <td
                        style={{
                          padding: "10px 14px",
                          fontFamily: "ui-monospace, monospace",
                          fontSize: 11,
                          color: "var(--muted)",
                        }}
                      >
                        {j.cnc_machine_id ? machineCodeById[j.cnc_machine_id] ?? "—" : "—"}
                      </td>
                      {columns.includes("deadline") && (
                        <td style={{ padding: "10px 14px", fontSize: 12 }}>
                          <span
                            style={{
                              fontWeight: 600,
                              color: overdue
                                ? "#DC2626"
                                : days !== null && days <= 2
                                  ? "#D97706"
                                  : "var(--text)",
                            }}
                          >
                            {days === null
                              ? "—"
                              : overdue
                                ? `Overdue by ${Math.abs(days)}d`
                                : days === 0
                                  ? "Due today"
                                  : `${days}d`}
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
                          {j.status === "dispatched"
                            ? "✓ Dispatched"
                            : fmtDate(j.review_approved_at ?? null)}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        </details>
      ))}
    </>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function groupByTemple<T>(items: T[], getTemple: (item: T) => string): Array<{ temple: string; items: T[] }> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const t = getTemple(item) || "(no temple)";
    if (!map.has(t)) map.set(t, []);
    map.get(t)!.push(item);
  }
  return [...map.entries()]
    .map(([temple, items]) => ({ temple, items }))
    .sort((a, b) => a.temple.localeCompare(b.temple));
}
