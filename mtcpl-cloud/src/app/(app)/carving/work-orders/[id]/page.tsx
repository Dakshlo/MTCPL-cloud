import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { SlabThumb } from "@/components/slab-thumb";
import type { StoneTypeDef } from "@/lib/stone-utils";
import {
  sendWorkOrderLineToVendorAction,
  sendAllReadyWorkOrderLinesAction,
  bindSlabToWorkOrderLineAction,
  removeWorkOrderLineAction,
  cancelWorkOrderAction,
  markCarvingCompleteManuallyAction,
} from "../../actions";

export const dynamic = "force-dynamic";

const ALLOWED = ["developer", "owner", "carving_head", "senior_incharge"];

const SLAB_TONE: Record<string, { bg: string; fg: string; label: string; icon: string }> = {
  open: { bg: "rgba(100,116,139,0.14)", fg: "#475569", label: "Open", icon: "○" },
  planned: { bg: "rgba(217,119,6,0.14)", fg: "#b45309", label: "Planned", icon: "⏳" },
  cut_done: { bg: "rgba(22,163,74,0.14)", fg: "#15803d", label: "Ready", icon: "✅" },
};

export default async function WorkOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { profile } = await requireAuth();
  if (!ALLOWED.includes(profile.role)) redirect("/carving");
  const { id } = await params;
  const admin = createAdminSupabaseClient();

  const { data: woRow } = await admin
    .from("carving_work_orders")
    .select("id, wo_number, vendor_name, title, temple, jobwork_rate, jobwork_unit, status, notes, cancelled_at")
    .eq("id", id)
    .maybeSingle();
  if (!woRow) redirect("/carving/work-orders?toast=Work+order+not+found");
  const wo = woRow as {
    wo_number: string; vendor_name: string; title: string | null; temple: string | null;
    jobwork_rate: number | string | null; jobwork_unit: string | null; status: string;
    notes: string | null; cancelled_at: string | null;
  };

  const { data: lineRows } = await admin
    .from("carving_work_order_items")
    .select("id, slab_requirement_id, carving_item_id, description, planned_length_ft, planned_width_ft, planned_thickness_ft, qty, line_status, position")
    .eq("work_order_id", id)
    .order("position", { ascending: true });
  const lines = ((lineRows ?? []) as Array<{
    id: string; slab_requirement_id: string | null; carving_item_id: string | null;
    description: string | null; planned_length_ft: number | null; planned_width_ft: number | null;
    planned_thickness_ft: number | null; qty: number; line_status: string;
  }>).filter((l) => l.line_status !== "cancelled");

  // Slab meta (status + dims + stone + stock loc) for lines that reference a slab.
  const slabIds = lines.map((l) => l.slab_requirement_id).filter(Boolean) as string[];
  type SlabMeta = {
    status: string; label: string | null; stone: string | null;
    l: number; w: number; t: number; stock_location: string | null;
  };
  const slabMeta = new Map<string, SlabMeta>();
  if (slabIds.length) {
    const { data } = await admin
      .from("slab_requirements")
      .select("id, status, label, stone, stock_location, length_ft, width_ft, thickness_ft")
      .in("id", slabIds);
    for (const s of (data ?? []) as Array<{ id: string; status: string; label: string | null; stone: string | null; stock_location: string | null; length_ft: number | string; width_ft: number | string; thickness_ft: number | string }>) {
      slabMeta.set(s.id, {
        status: s.status,
        label: s.label,
        stone: s.stone,
        l: Number(s.length_ft) || 0,
        w: Number(s.width_ft) || 0,
        t: Number(s.thickness_ft) || 0,
        stock_location: s.stock_location,
      });
    }
  }

  // Live carving_item state for sent lines (source of truth for sent→received→approved).
  const ciIds = lines.map((l) => l.carving_item_id).filter(Boolean) as string[];
  const ciMeta = new Map<string, { completed_at: string | null; review_approved_at: string | null }>();
  if (ciIds.length) {
    const { data } = await admin
      .from("carving_items")
      .select("id, completed_at, review_approved_at")
      .in("id", ciIds);
    for (const c of (data ?? []) as Array<{ id: string; completed_at: string | null; review_approved_at: string | null }>) {
      ciMeta.set(c.id, { completed_at: c.completed_at, review_approved_at: c.review_approved_at });
    }
  }

  // Cut-done slabs available to bind to a future-need line.
  const { data: availRows } = await admin
    .from("slab_requirements")
    .select("id, label, temple")
    .eq("status", "cut_done")
    .order("created_at", { ascending: false })
    .limit(300);
  const { data: liveLineRows } = await admin
    .from("carving_work_order_items")
    .select("slab_requirement_id, line_status")
    .neq("line_status", "cancelled")
    .not("slab_requirement_id", "is", null);
  const taken = new Set(((liveLineRows ?? []) as Array<{ slab_requirement_id: string | null }>).map((r) => r.slab_requirement_id).filter(Boolean) as string[]);
  const availableSlabs = ((availRows ?? []) as Array<{ id: string; label: string | null; temple: string }>).filter((s) => !taken.has(s.id));

  // Stone palettes for the 3D thumbnails.
  const { data: stoneRows } = await admin
    .from("stone_types")
    .select("id, name, color_top, color_front, color_side, sort_order, is_active")
    .order("sort_order")
    .order("name");
  const stoneTypes = (stoneRows ?? []) as StoneTypeDef[];

  const cancelled = !!wo.cancelled_at;
  // Lines that are cut-done + not yet sent → eligible for "Send all ready".
  const readyToSend = lines.filter(
    (l) => !l.carving_item_id && l.line_status === "planned" && l.slab_requirement_id && slabMeta.get(l.slab_requirement_id)?.status === "cut_done",
  ).length;

  const btn = (bg: string) => ({ width: "100%", padding: "7px 10px", fontSize: 11.5, fontWeight: 700, color: "#fff", background: bg, border: "none", borderRadius: 6, cursor: "pointer" } as const);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingBottom: 32, maxWidth: 1180 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div>
          <Link href="/carving/work-orders" style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", textDecoration: "none" }}>← Work orders</Link>
          <h1 style={{ margin: "6px 0 0", fontSize: 22, fontFamily: "ui-monospace, monospace" }}>{wo.wo_number}</h1>
          <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}>
            🤝 {wo.vendor_name}{wo.title ? ` · ${wo.title}` : ""}{wo.temple ? ` · ${wo.temple}` : ""}
            {wo.jobwork_rate != null ? ` · ₹${Number(wo.jobwork_rate)}/${wo.jobwork_unit ?? "cft"}` : ""}
            {cancelled ? " · CANCELLED" : ""}
          </div>
        </div>
        <Link href="/carving/challans/new" style={{ padding: "8px 14px", fontSize: 12, fontWeight: 700, color: "#92400e", background: "rgba(146,64,14,0.1)", borderRadius: 8, textDecoration: "none" }}>🧾 Generate challan</Link>
      </div>

      {/* Send-all bar — sends every cut-done, un-sent slab to the vendor at once. */}
      {!cancelled && readyToSend > 0 && (
        <form action={sendAllReadyWorkOrderLinesAction} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", background: "rgba(146,64,14,0.06)", border: "1px solid rgba(146,64,14,0.3)", borderRadius: 12, padding: "12px 16px" }}>
          <input type="hidden" name="work_order_id" value={id} />
          <div style={{ fontSize: 13, fontWeight: 700, color: "#7c2d12" }}>
            {readyToSend} ready slab{readyToSend === 1 ? "" : "s"} can be sent to {wo.vendor_name} now.
          </div>
          <button type="submit" style={{ padding: "9px 18px", fontSize: 13, fontWeight: 800, color: "#fff", background: "#92400e", border: "none", borderRadius: 8, cursor: "pointer" }}>
            📤 Send all ready ({readyToSend})
          </button>
        </form>
      )}

      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>Lines ({lines.length})</div>

      {lines.length === 0 ? (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 24, color: "var(--muted)", fontSize: 13, textAlign: "center" }}>No lines on this work order.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
          {lines.map((l) => {
            const slab = l.slab_requirement_id ? slabMeta.get(l.slab_requirement_id) : null;
            const ci = l.carving_item_id ? ciMeta.get(l.carving_item_id) : null;
            const isSent = l.line_status === "sent" || !!l.carving_item_id;
            const stageTone = ci?.review_approved_at ? "#15803d" : ci?.completed_at ? "#b45309" : "#92400e";
            const stage = isSent && ci
              ? ci.review_approved_at ? "Approved ✓" : ci.completed_at ? "Received — awaiting approval" : "At vendor (carving)"
              : "";
            const tn = slab ? (SLAB_TONE[slab.status] ?? SLAB_TONE.open) : null;
            return (
              <div key={l.id} style={{ display: "flex", flexDirection: "column", gap: 6, padding: 10, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12 }}>
                {l.slab_requirement_id && slab ? (
                  <SlabThumb stone={slab.stone} l={slab.l} w={slab.w} t={slab.t} stoneTypes={stoneTypes} />
                ) : (
                  <div style={{ height: 80, background: "var(--surface-alt)", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted-light)", fontSize: 11 }}>📝 future need</div>
                )}

                {l.slab_requirement_id ? (
                  <>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                      <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700, fontSize: 12, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.slab_requirement_id}</span>
                      {slab?.stone && <span className="role-pill" style={{ fontSize: 9, padding: "1px 6px", flexShrink: 0 }}>{slab.stone}</span>}
                    </div>
                    {slab?.label && <div style={{ fontSize: 10, color: "var(--muted)" }}>{slab.label}</div>}
                    {slab && (
                      <div style={{ fontSize: 10, color: "var(--muted-light)", fontFamily: "ui-monospace, monospace" }}>{slab.l}×{slab.w}×{slab.t}&Prime;</div>
                    )}
                    {slab?.stock_location && (
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#7c2d12", background: "rgba(180,115,51,0.08)", border: "1px solid rgba(180,115,51,0.25)", padding: "3px 7px", borderRadius: 5, alignSelf: "flex-start", fontFamily: "ui-monospace, monospace" }}>📍 {slab.stock_location}</div>
                    )}
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>📝 {l.description}</div>
                    <div style={{ fontSize: 10, color: "var(--muted-light)" }}>{l.planned_length_ft ? `${l.planned_length_ft}×${l.planned_width_ft ?? "?"}×${l.planned_thickness_ft ?? "?"}″ · ` : ""}qty {l.qty}</div>
                  </>
                )}

                {/* status / stage chip */}
                {isSent ? (
                  <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em", color: stageTone, background: "rgba(146,64,14,0.08)", borderRadius: 999, padding: "3px 9px", alignSelf: "flex-start" }}>📤 {stage}</div>
                ) : tn ? (
                  <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em", color: tn.fg, background: tn.bg, borderRadius: 999, padding: "3px 9px", alignSelf: "flex-start" }}>{tn.icon} {tn.label}</div>
                ) : null}

                {/* action */}
                <div style={{ marginTop: "auto", paddingTop: 4, display: "flex", flexDirection: "column", gap: 4 }}>
                  {cancelled ? null : isSent ? (
                    ci && !ci.completed_at ? (
                      <form action={markCarvingCompleteManuallyAction}>
                        <input type="hidden" name="carving_item_id" value={l.carving_item_id!} />
                        <input type="hidden" name="redirect_to" value={`/carving/work-orders/${id}`} />
                        <button type="submit" style={btn("#15803d")}>📥 Receive</button>
                      </form>
                    ) : null
                  ) : l.slab_requirement_id && slab?.status === "cut_done" ? (
                    <form action={sendWorkOrderLineToVendorAction}>
                      <input type="hidden" name="line_id" value={l.id} />
                      <input type="hidden" name="work_order_id" value={id} />
                      <button type="submit" style={btn("#92400e")}>📤 Send to vendor</button>
                    </form>
                  ) : l.slab_requirement_id ? (
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>⏳ waiting to be cut</span>
                  ) : (
                    <form action={bindSlabToWorkOrderLineAction} style={{ display: "flex", gap: 4, alignItems: "center" }}>
                      <input type="hidden" name="line_id" value={l.id} />
                      <input type="hidden" name="work_order_id" value={id} />
                      <select name="slab_requirement_id" defaultValue="" required style={{ flex: 1, minWidth: 0, fontSize: 11, padding: "5px 6px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)" }}>
                        <option value="" disabled>Bind cut slab…</option>
                        {availableSlabs.map((s) => <option key={s.id} value={s.id}>{s.id}{s.label ? ` · ${s.label}` : ""}</option>)}
                      </select>
                      <button type="submit" style={{ fontSize: 11, fontWeight: 700, color: "#fff", background: "#0f766e", border: "none", borderRadius: 6, padding: "5px 10px", cursor: "pointer" }}>Link</button>
                    </form>
                  )}
                  {!cancelled && !isSent && (
                    <form action={removeWorkOrderLineAction}>
                      <input type="hidden" name="line_id" value={l.id} />
                      <input type="hidden" name="work_order_id" value={id} />
                      <button type="submit" style={{ fontSize: 11, fontWeight: 700, color: "#991b1b", background: "none", border: "none", cursor: "pointer", padding: "2px 0" }}>Remove</button>
                    </form>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!cancelled && (
        <form action={cancelWorkOrderAction} style={{ marginTop: 4 }}>
          <input type="hidden" name="work_order_id" value={id} />
          <button type="submit" style={{ fontSize: 12, fontWeight: 700, color: "#991b1b", background: "none", border: "1px solid rgba(220,38,38,0.4)", borderRadius: 8, padding: "8px 14px", cursor: "pointer" }}>
            Cancel work order (un-sent lines only)
          </button>
        </form>
      )}
    </div>
  );
}
