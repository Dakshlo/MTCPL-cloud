/**
 * 🛠 Rework Tunnel — slabs approved at carving but marked DEPART (they
 * need a finishing touch before they can ship). Moved out of the Make
 * Dispatch tab into its own page at Daksh's request.
 *
 * Each card shows what the slab is (label + description), why it's here
 * (the depart note from the carving approval), and how long it's been
 * held. "✓ Done — release to dispatch" puts it straight into Make
 * Dispatch.
 */

import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { clearDispatchHoldAction } from "../actions";
import { TimeAgo } from "../time-ago";

export const dynamic = "force-dynamic";

function toCft(l: number, w: number, t: number): number {
  return (l * w * t) / 1728;
}

export default async function ReworkTunnelPage({
  searchParams,
}: {
  searchParams: Promise<{ dispatch_toast?: string; dispatch_error?: string }>;
}) {
  await requireAuth(["developer", "owner", "carving_head", "senior_incharge"]);
  const { dispatch_toast: toast, dispatch_error: error } = await searchParams;
  const admin = createAdminSupabaseClient();

  const { data: heldRows } = await admin
    .from("slab_requirements")
    .select("id, label, description, temple, stone, quality, length_ft, width_ft, thickness_ft, priority")
    .eq("status", "completed")
    .eq("dispatch_hold", true)
    .order("updated_at", { ascending: true });

  type Held = {
    id: string; label: string | null; description: string | null; temple: string;
    stone: string | null; quality: string | null;
    length_ft: number; width_ft: number; thickness_ft: number; priority: boolean | null;
  };
  const held = (heldRows ?? []) as Held[];

  // Why + since-when, from the carving approval that flagged Depart.
  const noteBySlab = new Map<string, { note: string | null; at: string | null }>();
  if (held.length > 0) {
    const { data: ciRows } = await admin
      .from("carving_items")
      .select("slab_requirement_id, depart_note, depart_at")
      .in("slab_requirement_id", held.map((s) => s.id));
    for (const r of (ciRows ?? []) as Array<{ slab_requirement_id: string; depart_note: string | null; depart_at: string | null }>) {
      noteBySlab.set(r.slab_requirement_id, { note: r.depart_note, at: r.depart_at });
    }
  }

  return (
    <section className="page-card">
      <div className="record-head">
        <div>
          <Link href="/dispatch" style={{ fontSize: 13, fontWeight: 700, color: "var(--muted)", textDecoration: "none" }}>
            ← Dispatch Station
          </Link>
          <h1 style={{ margin: "6px 0 0" }}>🛠 Rework Tunnel</h1>
          <p className="muted" style={{ fontSize: 13.5, maxWidth: 720 }}>
            These slabs passed carving but need a <strong>finishing touch</strong> before they can ship.
            जब slab ठीक हो जाए, <strong>Done</strong> दबाएँ — slab सीधे Make Dispatch में चली जाएगी।
          </p>
        </div>
        <span
          style={{
            alignSelf: "flex-start", fontSize: 14, fontWeight: 800, color: "#92400e",
            background: "rgba(180,83,9,0.12)", border: "1.5px solid rgba(180,83,9,0.4)",
            borderRadius: 999, padding: "8px 18px", whiteSpace: "nowrap",
          }}
        >
          {held.length} slab{held.length === 1 ? "" : "s"} waiting
        </span>
      </div>

      {toast && (
        <div style={{ marginTop: 14, padding: "12px 16px", background: "rgba(22,101,52,0.08)", border: "1px solid rgba(22,101,52,0.3)", borderRadius: 10, color: "#15803d", fontSize: 14, fontWeight: 600 }}>
          {toast}
        </div>
      )}
      {error && (
        <div style={{ marginTop: 14, padding: "12px 16px", background: "rgba(185,28,28,0.08)", border: "1px solid rgba(185,28,28,0.3)", borderRadius: 10, color: "#b91c1c", fontSize: 14, fontWeight: 600 }}>
          {error}
        </div>
      )}

      {held.length === 0 ? (
        <div style={{ marginTop: 20, padding: "48px 20px", textAlign: "center", color: "var(--muted)", background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: 14, fontSize: 15 }}>
          🎉 Tunnel is empty — no slabs are held for rework.
        </div>
      ) : (
        <div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))", gap: 14 }}>
          {held.map((s) => {
            const info = noteBySlab.get(s.id);
            const cft = toCft(Number(s.length_ft), Number(s.width_ft), Number(s.thickness_ft));
            return (
              <div
                key={s.id}
                style={{
                  background: "var(--surface)", border: "1.5px solid rgba(180,83,9,0.35)",
                  borderTop: "5px solid #b45309", borderRadius: 14, padding: "14px 16px",
                  display: "flex", flexDirection: "column", gap: 8,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <code style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 15 }}>
                    {s.priority ? "⚡ " : ""}{s.id}
                  </code>
                  {info?.at && (
                    <span style={{ marginLeft: "auto", fontSize: 11.5, fontWeight: 800, color: "#92400e", background: "rgba(180,83,9,0.1)", borderRadius: 999, padding: "3px 10px", whiteSpace: "nowrap" }}>
                      ⏱ held <TimeAgo iso={info.at} />
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 13.5, fontWeight: 700 }}>
                  {s.label ?? "—"}
                  {s.description && (
                    <span style={{ fontWeight: 500, color: "var(--muted)" }}> · {s.description}</span>
                  )}
                </div>
                <div className="muted" style={{ fontSize: 12.5 }}>
                  🏛 {s.temple} · {s.stone ?? "—"}
                  {s.quality ? ` · Grade ${s.quality}` : ""}
                </div>
                <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 12.5 }}>
                  {Number(s.length_ft)}×{Number(s.width_ft)}×{Number(s.thickness_ft)} in · {cft.toFixed(2)} CFT
                </div>
                {info?.note && (
                  <div style={{ fontSize: 12.5, color: "#7c2d12", background: "rgba(180,83,9,0.07)", border: "1px dashed rgba(180,83,9,0.35)", borderRadius: 8, padding: "8px 10px" }}>
                    📝 <strong>Why:</strong> {info.note}
                  </div>
                )}
                <form action={clearDispatchHoldAction} style={{ marginTop: "auto" }}>
                  <input type="hidden" name="slab_id" value={s.id} />
                  <input type="hidden" name="from" value="rework" />
                  <button
                    type="submit"
                    style={{
                      width: "100%", padding: "12px 10px", fontSize: 14.5, fontWeight: 800,
                      color: "#fff", background: "#15803d", border: "none", borderRadius: 10, cursor: "pointer",
                    }}
                  >
                    ✓ Done — release to dispatch
                  </button>
                </form>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
