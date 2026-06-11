// Mig 122 — Slab Import Approvals. Excel import batches submitted on
// Required Sizes wait here until owner / senior_incharge / carving_head /
// developer approves (slabs are then created at status 'open') or rejects
// (nothing is created; the submitter is notified either way).

import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getProfilesMap } from "@/lib/profiles";
import { approveSlabImportBatchAction, rejectSlabImportBatchAction } from "../../slabs/actions";

export const dynamic = "force-dynamic";

const ALLOWED = ["owner", "senior_incharge", "carving_head", "developer"];

type BatchRow = {
  id: string;
  temple: string;
  stone: string;
  rows: Array<{
    label: string; description: string | null;
    length: number; width: number; height: number;
    quantity: number; quality: string | null; priority: boolean;
    componentSection?: string | null; componentElement?: string | null;
  }> | null;
  row_count: number | null;
  slab_count: number | null;
  file_name: string | null;
  submitted_by: string | null;
  submitted_at: string | null;
};

function fmtWhen(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

export default async function SlabImportApprovalsPage({ searchParams }: { searchParams: Promise<{ toast?: string }> }) {
  const { profile } = await requireAuth();
  if (!ALLOWED.includes(profile.role)) redirect("/tasks");
  const sp = await searchParams;
  const admin = createAdminSupabaseClient();

  const { data } = await admin
    .from("slab_import_batches")
    .select("id, temple, stone, rows, row_count, slab_count, file_name, submitted_by, submitted_at")
    .eq("status", "pending")
    .order("submitted_at", { ascending: true });
  const batches = (data ?? []) as BatchRow[];
  const profilesMap = await getProfilesMap();

  const th = { fontSize: 10, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: "0.05em", color: "var(--muted)", textAlign: "left" as const, padding: "6px 8px", whiteSpace: "nowrap" as const };
  const td = { padding: "5px 8px", fontSize: 12.5 } as const;

  return (
    <div style={{ maxWidth: 880, margin: "0 auto", padding: "0 4px 40px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <Link href="/tasks" style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", textDecoration: "none" }}>← Tasks</Link>
        <h1 style={{ margin: "6px 0 0", fontSize: 22 }}>🗂 Slab Import Approvals</h1>
        <p className="muted" style={{ margin: "2px 0 0", fontSize: 13 }}>
          Excel import batches from Required Sizes. Approve to create the slabs (status <strong>open</strong>) — or reject with a note. The uploaded Excel stays on record either way.
        </p>
      </div>

      {sp?.toast && (
        <div style={{ background: "rgba(22,163,74,0.1)", border: "1px solid rgba(22,163,74,0.35)", borderRadius: 12, padding: "10px 14px", fontSize: 13, color: "#15803d" }}>
          {sp.toast}
        </div>
      )}

      {batches.length === 0 ? (
        <div className="banner">All clear — no import batches are waiting for approval.</div>
      ) : (
        batches.map((b) => {
          const rows = Array.isArray(b.rows) ? b.rows : [];
          return (
            <div key={b.id} style={{ border: "1.5px solid rgba(234,179,8,0.5)", background: "rgba(234,179,8,0.06)", borderRadius: 14, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
                <div style={{ fontSize: 15, fontWeight: 800 }}>
                  🏛 {b.temple} <span className="muted" style={{ fontWeight: 600, fontSize: 13 }}>· {b.stone}</span>
                </div>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#854d0e" }}>
                  {b.row_count ?? rows.length} row{(b.row_count ?? rows.length) === 1 ? "" : "s"} → {b.slab_count ?? "?"} slab{(b.slab_count ?? 0) === 1 ? "" : "s"}
                </div>
              </div>
              <div className="muted" style={{ fontSize: 11.5 }}>
                Sent by <strong>{b.submitted_by ? (profilesMap[b.submitted_by] ?? "Unknown") : "—"}</strong> · {fmtWhen(b.submitted_at)}
                {b.file_name && <> · 📄 {b.file_name}</>}
              </div>

              <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface)" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border)" }}>
                      <th style={th}>#</th><th style={th}>Cat 1</th><th style={th}>Cat 2</th>
                      <th style={th}>Label</th><th style={th}>Description</th>
                      <th style={th}>L (in)</th><th style={th}>W (in)</th><th style={th}>H (in)</th>
                      <th style={th}>Qty</th><th style={th}>Quality</th><th style={th}>⚡</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                        <td style={{ ...td, color: "var(--muted)", fontFamily: "ui-monospace, monospace", fontSize: 11.5 }}>{i + 1}</td>
                        <td style={{ ...td, fontWeight: 600 }}>{r.componentSection || "—"}</td>
                        <td style={td}>{r.componentElement || "—"}</td>
                        <td style={{ ...td, fontWeight: 600 }}>{r.label}</td>
                        <td style={td}>{r.description ?? "—"}</td>
                        <td style={td}>{r.length}</td>
                        <td style={td}>{r.width}</td>
                        <td style={td}>{r.height}</td>
                        <td style={{ ...td, fontWeight: 700 }}>{r.quantity}</td>
                        <td style={td}>{r.quality || "Both"}</td>
                        <td style={td}>{r.priority ? "⚡" : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <form action={approveSlabImportBatchAction}>
                  <input type="hidden" name="batch_id" value={b.id} />
                  <button type="submit" style={{ padding: "9px 20px", fontSize: 13.5, fontWeight: 800, color: "#fff", background: "#15803d", border: "none", borderRadius: 8, cursor: "pointer", whiteSpace: "nowrap" }}>
                    ✓ Approve — add {b.slab_count ?? rows.length} slab{(b.slab_count ?? 0) === 1 ? "" : "s"}
                  </button>
                </form>
                <form action={rejectSlabImportBatchAction} style={{ display: "flex", gap: 8, alignItems: "center", flex: "1 1 320px" }}>
                  <input type="hidden" name="batch_id" value={b.id} />
                  <input name="note" placeholder="Rejection note (optional)" style={{ flex: 1, padding: "8px 11px", fontSize: 13, border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg)", color: "var(--text)" }} />
                  <button type="submit" style={{ padding: "9px 16px", fontSize: 13.5, fontWeight: 800, color: "#991b1b", background: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.35)", borderRadius: 8, cursor: "pointer", whiteSpace: "nowrap" }}>
                    ✕ Reject
                  </button>
                </form>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
