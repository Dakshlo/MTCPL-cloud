/**
 * 🚫 Slab cancel requests — owner approval panel (mig 132).
 *
 * carving_head / senior_incharge long-press a broken slab anywhere in
 * Carving Jobs or Make Dispatch and send a cancel request (reason +
 * photo). Each request lands here; the owner / developer either:
 *   ✓ Approve cancel — slab exits the live flow (status 'cancelled'),
 *     Temple View then asks whether to mint a replacement, or
 *   ✕ Reject — slab unlocks and goes back to normal.
 */

import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getProfilesMap } from "@/lib/profiles";
import { resolveSlabCancelAction } from "../../slabs/cancel-actions";

export const dynamic = "force-dynamic";

const STAGE_LABEL: Record<string, string> = {
  cut_done: "Cut & ready (unassigned)",
  carving_assigned: "Assigned to carving",
  carving_in_progress: "Carving in progress",
  carving_on_hold: "Carving on hold",
  completed: "Ready to dispatch",
};

export default async function SlabCancelRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ toast?: string }>;
}) {
  await requireAuth(["owner", "developer"]);
  const { toast } = await searchParams;
  const admin = createAdminSupabaseClient();

  const { data: rows } = await admin
    .from("slab_requirements")
    .select(
      "id, temple, status, label, description, stone, quality, length_ft, width_ft, thickness_ft, cancel_requested_at, cancel_requested_by, cancel_reason, cancel_photo_path",
    )
    .not("cancel_requested_at", "is", null)
    .neq("status", "cancelled")
    .order("cancel_requested_at", { ascending: true });

  type Row = {
    id: string; temple: string; status: string; label: string | null; description: string | null;
    stone: string | null; quality: string | null;
    length_ft: number; width_ft: number; thickness_ft: number;
    cancel_requested_at: string; cancel_requested_by: string | null;
    cancel_reason: string | null; cancel_photo_path: string | null;
  };
  const requests = (rows ?? []) as Row[];
  const profilesMap = await getProfilesMap();
  const photoUrl = (p: string | null) =>
    p ? admin.storage.from("slab_cancel_photos").getPublicUrl(p).data.publicUrl : null;

  return (
    <section className="page-card">
      <div className="record-head">
        <div>
          <Link href="/tasks" style={{ fontSize: 13, fontWeight: 700, color: "var(--muted)", textDecoration: "none" }}>
            ← Tasks
          </Link>
          <h1 style={{ margin: "6px 0 0" }}>🚫 Slab Cancel Requests</h1>
          <p className="muted" style={{ fontSize: 13.5, maxWidth: 720 }}>
            Broken / unusable slabs reported by the team. <strong>Approve</strong> = the slab is cancelled and exits
            the flow (Temple View will ask whether to create a replacement). <strong>Reject</strong> = the slab goes
            back to normal.
          </p>
        </div>
        <span
          style={{
            alignSelf: "flex-start", fontSize: 14, fontWeight: 800, color: "#b91c1c",
            background: "rgba(185,28,28,0.08)", border: "1.5px solid rgba(185,28,28,0.4)",
            borderRadius: 999, padding: "8px 18px", whiteSpace: "nowrap",
          }}
        >
          {requests.length} pending
        </span>
      </div>

      {toast && (
        <div style={{ marginTop: 14, padding: "12px 16px", background: "rgba(22,101,52,0.08)", border: "1px solid rgba(22,101,52,0.3)", borderRadius: 10, color: "#15803d", fontSize: 14, fontWeight: 600 }}>
          {toast}
        </div>
      )}

      {requests.length === 0 ? (
        <div style={{ marginTop: 20, padding: "48px 20px", textAlign: "center", color: "var(--muted)", background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: 14, fontSize: 15 }}>
          🎉 No cancel requests waiting.
        </div>
      ) : (
        <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 14 }}>
          {requests.map((r) => {
            const url = photoUrl(r.cancel_photo_path);
            const requester = r.cancel_requested_by ? profilesMap[r.cancel_requested_by] ?? "—" : "—";
            return (
              <div
                key={r.id}
                style={{
                  background: "var(--surface)", border: "1.5px solid rgba(185,28,28,0.4)",
                  borderLeft: "6px solid #b91c1c", borderRadius: 14, padding: "14px 18px",
                  display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start",
                }}
              >
                {url && (
                  <a href={url} target="_blank" rel="noopener noreferrer" title="Damage photo — tap to open">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt="damage" style={{ width: 120, height: 92, objectFit: "cover", borderRadius: 10, border: "1.5px solid var(--border)", display: "block" }} />
                  </a>
                )}
                <div style={{ flex: "1 1 280px", minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <code style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 16 }}>{r.id}</code>
                    <span style={{ fontSize: 11, fontWeight: 800, color: "#92400e", background: "rgba(180,83,9,0.1)", border: "1px solid rgba(180,83,9,0.35)", borderRadius: 999, padding: "2px 10px" }}>
                      at: {STAGE_LABEL[r.status] ?? r.status}
                    </span>
                  </div>
                  <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                    🏛 {r.temple}
                    {r.label ? ` · ${r.label}` : ""}
                    {r.description ? ` · ${r.description}` : ""}
                  </div>
                  <div className="muted" style={{ fontSize: 12.5, marginTop: 2, fontFamily: "ui-monospace, monospace" }}>
                    {Number(r.length_ft)}×{Number(r.width_ft)}×{Number(r.thickness_ft)} in
                    {r.stone ? ` · ${r.stone}` : ""}
                    {r.quality ? ` · Grade ${r.quality}` : ""}
                  </div>
                  <div style={{ fontSize: 13.5, marginTop: 8, padding: "9px 12px", background: "rgba(185,28,28,0.05)", border: "1px dashed rgba(185,28,28,0.35)", borderRadius: 8, lineHeight: 1.5 }}>
                    📝 <strong>Reason:</strong> {r.cancel_reason ?? "—"}
                  </div>
                  <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>
                    Requested by <strong>{requester}</strong> ·{" "}
                    {new Date(r.cancel_requested_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, flexShrink: 0, minWidth: 210 }}>
                  <form action={resolveSlabCancelAction}>
                    <input type="hidden" name="slab_id" value={r.id} />
                    <input type="hidden" name="decision" value="approve" />
                    <button
                      type="submit"
                      style={{ width: "100%", padding: "12px 14px", fontSize: 14, fontWeight: 800, color: "#fff", background: "#b91c1c", border: "none", borderRadius: 10, cursor: "pointer" }}
                    >
                      ✓ Approve cancel — slab is out
                    </button>
                  </form>
                  <form action={resolveSlabCancelAction}>
                    <input type="hidden" name="slab_id" value={r.id} />
                    <input type="hidden" name="decision" value="reject" />
                    <button
                      type="submit"
                      style={{ width: "100%", padding: "12px 14px", fontSize: 14, fontWeight: 800, color: "#15803d", background: "rgba(22,163,74,0.08)", border: "1.5px solid rgba(22,163,74,0.4)", borderRadius: 10, cursor: "pointer" }}
                    >
                      ✕ Reject — keep the slab
                    </button>
                  </form>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
