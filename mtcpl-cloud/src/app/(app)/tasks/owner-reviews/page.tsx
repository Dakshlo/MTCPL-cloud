// Mig 118 — Owner Review queue. Carving slabs the approver escalated to the
// owner during Carving Done Approval ("Involve owner"). Owner / developer
// only. Each row shows the problem; the owner marks it resolved, which clears
// it from here and flips the slab's card to "Issue resolved".

import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getProfilesMap } from "@/lib/profiles";
import { resolveOwnerReviewAction } from "../../carving/actions";

export const dynamic = "force-dynamic";

const ALLOWED = ["owner", "developer"];

function fmtWhen(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

export default async function OwnerReviewsPage({ searchParams }: { searchParams: Promise<{ toast?: string }> }) {
  const { profile } = await requireAuth();
  if (!ALLOWED.includes(profile.role)) redirect("/tasks");
  const sp = await searchParams;
  const admin = createAdminSupabaseClient();

  const { data: rows } = await admin
    .from("carving_items")
    .select("id, slab_requirement_id, vendor_name, vendor_type, owner_review_kind, owner_review_note, owner_review_by, owner_review_at")
    .eq("owner_review_status", "open")
    .order("owner_review_at", { ascending: true });

  type Row = {
    id: string; slab_requirement_id: string; vendor_name: string | null; vendor_type: string | null;
    owner_review_kind: string | null; owner_review_note: string | null;
    owner_review_by: string | null; owner_review_at: string | null;
  };
  const items = (rows ?? []) as Row[];

  // Pull the slab requirement (code / label / temple / dims) for each item.
  const reqIds = [...new Set(items.map((r) => r.slab_requirement_id).filter(Boolean))];
  const reqMap = new Map<string, { id: string; label: string | null; temple: string | null; length_ft: number; width_ft: number; thickness_ft: number }>();
  if (reqIds.length > 0) {
    const { data: reqs } = await admin
      .from("slab_requirements")
      .select("id, label, temple, length_ft, width_ft, thickness_ft")
      .in("id", reqIds);
    for (const r of (reqs ?? []) as Array<{ id: string; label: string | null; temple: string | null; length_ft: number; width_ft: number; thickness_ft: number }>) {
      reqMap.set(r.id, r);
    }
  }
  const profilesMap = await getProfilesMap();

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "0 4px 40px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <Link href="/tasks" style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", textDecoration: "none" }}>← Tasks</Link>
        <h1 style={{ margin: "6px 0 0", fontSize: 22 }}>👤 Owner Review</h1>
        <p className="muted" style={{ margin: "2px 0 0", fontSize: 13 }}>
          Carving slabs flagged to you during Carving Done Approval. Mark each resolved once handled — it then clears here and shows “Issue resolved” on the slab.
        </p>
      </div>

      {sp?.toast && (
        <div style={{ background: "rgba(22,163,74,0.1)", border: "1px solid rgba(22,163,74,0.35)", borderRadius: 12, padding: "10px 14px", fontSize: 13, color: "#15803d" }}>
          {sp.toast}
        </div>
      )}

      {items.length === 0 ? (
        <div className="banner">All clear — no slabs are waiting on your review.</div>
      ) : (
        items.map((r) => {
          const req = reqMap.get(r.slab_requirement_id);
          const dims = req ? `${Number(req.length_ft)}" × ${Number(req.width_ft)}" × ${Number(req.thickness_ft)}"` : null;
          const problem = r.owner_review_kind === "no_slab_code" ? "No slab code" : (r.owner_review_note || "Reported");
          return (
            <div key={r.id} style={{ border: "1.5px solid rgba(180,83,9,0.45)", background: "rgba(180,83,9,0.06)", borderRadius: 14, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
                <div>
                  <code style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 14, color: "var(--text)" }}>{req?.id ?? r.slab_requirement_id}</code>
                  {req?.temple && <span className="muted" style={{ fontSize: 12.5, marginLeft: 8 }}>🏛 {req.temple}</span>}
                </div>
                {r.vendor_name && (
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>{r.vendor_name}{r.vendor_type ? ` · ${r.vendor_type}` : ""}</span>
                )}
              </div>
              {req?.label && <div style={{ fontSize: 13, fontWeight: 600 }}>{req.label}{dims ? <span className="muted" style={{ fontWeight: 400 }}> · {dims}</span> : null}</div>}
              <div style={{ display: "inline-flex", alignItems: "center", gap: 8, alignSelf: "flex-start", padding: "4px 11px", borderRadius: 999, fontSize: 12.5, fontWeight: 800, color: "#7c2d12", background: "rgba(180,83,9,0.16)", border: "1px solid rgba(180,83,9,0.45)" }}>
                ⚠ {problem}
              </div>
              <div className="muted" style={{ fontSize: 11.5 }}>
                Raised by {r.owner_review_by ? (profilesMap[r.owner_review_by] ?? "Unknown") : "—"} · {fmtWhen(r.owner_review_at)}
              </div>
              <form action={resolveOwnerReviewAction} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 2 }}>
                <input type="hidden" name="job_id" value={r.id} />
                <input name="resolution_note" placeholder="Resolution note (optional)" style={{ flex: "1 1 220px", padding: "8px 11px", fontSize: 13, border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg)", color: "var(--text)" }} />
                <button type="submit" style={{ padding: "8px 18px", fontSize: 13, fontWeight: 800, color: "#fff", background: "#15803d", border: "none", borderRadius: 8, cursor: "pointer", whiteSpace: "nowrap" }}>
                  ✓ Mark resolved
                </button>
              </form>
            </div>
          );
        })
      )}
    </div>
  );
}
