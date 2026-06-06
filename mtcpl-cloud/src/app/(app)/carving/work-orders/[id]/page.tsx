import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  sendWorkOrderLineToVendorAction,
  bindSlabToWorkOrderLineAction,
  removeWorkOrderLineAction,
  cancelWorkOrderAction,
  markCarvingCompleteManuallyAction,
} from "../../actions";

export const dynamic = "force-dynamic";

const ALLOWED = ["developer", "owner", "carving_head", "senior_incharge"];

const SLAB_TONE: Record<string, { bg: string; fg: string }> = {
  open: { bg: "rgba(100,116,139,0.14)", fg: "#475569" },
  planned: { bg: "rgba(217,119,6,0.14)", fg: "#b45309" },
  cut_done: { bg: "rgba(22,163,74,0.14)", fg: "#15803d" },
};

export default async function WorkOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { profile } = await requireAuth();
  if (!ALLOWED.includes(profile.role)) redirect("/carving?mode=outsource");
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

  // Slab statuses for lines that reference a slab.
  const slabIds = lines.map((l) => l.slab_requirement_id).filter(Boolean) as string[];
  const slabMeta = new Map<string, { status: string; label: string | null; dims: string }>();
  if (slabIds.length) {
    const { data } = await admin
      .from("slab_requirements")
      .select("id, status, label, length_ft, width_ft, thickness_ft")
      .in("id", slabIds);
    for (const s of (data ?? []) as Array<{ id: string; status: string; label: string | null; length_ft: number | string; width_ft: number | string; thickness_ft: number | string }>) {
      slabMeta.set(s.id, { status: s.status, label: s.label, dims: `${Number(s.length_ft)}×${Number(s.width_ft)}×${Number(s.thickness_ft)}″` });
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

  const cancelled = !!wo.cancelled_at;
  const btn = (bg: string) => ({ padding: "5px 10px", fontSize: 11, fontWeight: 700, color: "#fff", background: bg, border: "none", borderRadius: 6, cursor: "pointer" } as const);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingBottom: 32, maxWidth: 920 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div>
          <Link href="/carving/work-orders" style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", textDecoration: "none" }}>← Work orders</Link>
          <h1 style={{ margin: "6px 0 0", fontSize: 22, fontFamily: "ui-monospace, monospace" }}>{wo.wo_number}</h1>
          <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}>
            {wo.vendor_name}{wo.title ? ` · ${wo.title}` : ""}{wo.temple ? ` · ${wo.temple}` : ""}
            {wo.jobwork_rate != null ? ` · ₹${Number(wo.jobwork_rate)}/${wo.jobwork_unit ?? "cft"}` : ""}
            {cancelled ? " · CANCELLED" : ""}
          </div>
        </div>
        <Link href="/carving/challans/new" style={{ padding: "8px 14px", fontSize: 12, fontWeight: 700, color: "#92400e", background: "rgba(146,64,14,0.1)", borderRadius: 8, textDecoration: "none" }}>🧾 Generate challan</Link>
      </div>

      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>Lines ({lines.length})</div>
        {lines.map((l) => {
          const slab = l.slab_requirement_id ? slabMeta.get(l.slab_requirement_id) : null;
          const ci = l.carving_item_id ? ciMeta.get(l.carving_item_id) : null;
          const isSent = l.line_status === "sent" || !!l.carving_item_id;
          let stage = "";
          if (isSent && ci) {
            stage = ci.review_approved_at ? "Approved ✓" : ci.completed_at ? "Received — awaiting approval" : "At vendor (carving)";
          }
          return (
            <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderTop: "1px solid var(--border)", flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 280px", minWidth: 0 }}>
                {l.slab_requirement_id ? (
                  <div style={{ fontSize: 13, fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>
                    {l.slab_requirement_id}{slab?.label ? ` · ${slab.label}` : ""}
                    {slab && (
                      <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 800, textTransform: "uppercase", color: (SLAB_TONE[slab.status] ?? SLAB_TONE.open).fg, background: (SLAB_TONE[slab.status] ?? SLAB_TONE.open).bg, borderRadius: 999, padding: "1px 6px" }}>{slab.status.replace("_", " ")}</span>
                    )}
                    {slab?.dims ? <span style={{ color: "var(--muted)", fontWeight: 400 }}> · {slab.dims}</span> : ""}
                  </div>
                ) : (
                  <div style={{ fontSize: 13 }}>
                    <span style={{ fontWeight: 700 }}>📝 {l.description}</span>
                    <span style={{ color: "var(--muted)" }}>{l.planned_length_ft ? ` · ${l.planned_length_ft}×${l.planned_width_ft ?? "?"}×${l.planned_thickness_ft ?? "?"}″` : ""} · qty {l.qty}</span>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                {cancelled ? null : isSent ? (
                  <>
                    <span style={{ fontSize: 11, fontWeight: 700, color: ci?.review_approved_at ? "#15803d" : ci?.completed_at ? "#b45309" : "#92400e" }}>{stage}</span>
                    {ci && !ci.completed_at && (
                      <form action={markCarvingCompleteManuallyAction}>
                        <input type="hidden" name="carving_item_id" value={l.carving_item_id!} />
                        <input type="hidden" name="redirect_to" value={`/carving/work-orders/${id}`} />
                        <button type="submit" style={btn("#15803d")}>📥 Receive</button>
                      </form>
                    )}
                  </>
                ) : l.slab_requirement_id && slab?.status === "cut_done" ? (
                  <form action={sendWorkOrderLineToVendorAction}>
                    <input type="hidden" name="line_id" value={l.id} />
                    <input type="hidden" name="work_order_id" value={id} />
                    <button type="submit" style={btn("#92400e")}>📤 Send to vendor</button>
                  </form>
                ) : l.slab_requirement_id ? (
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>⏳ waiting to be cut</span>
                ) : (
                  // Future-need line — bind a cut slab.
                  <form action={bindSlabToWorkOrderLineAction} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input type="hidden" name="line_id" value={l.id} />
                    <input type="hidden" name="work_order_id" value={id} />
                    <select name="slab_requirement_id" defaultValue="" required style={{ fontSize: 11, padding: "5px 8px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)", maxWidth: 200 }}>
                      <option value="" disabled>Bind cut slab…</option>
                      {availableSlabs.map((s) => <option key={s.id} value={s.id}>{s.id}{s.label ? ` · ${s.label}` : ""}</option>)}
                    </select>
                    <button type="submit" style={btn("#0f766e")}>Link</button>
                  </form>
                )}
                {!cancelled && !isSent && (
                  <form action={removeWorkOrderLineAction}>
                    <input type="hidden" name="line_id" value={l.id} />
                    <input type="hidden" name="work_order_id" value={id} />
                    <button type="submit" style={{ fontSize: 11, fontWeight: 700, color: "#991b1b", background: "none", border: "none", cursor: "pointer" }}>Remove</button>
                  </form>
                )}
              </div>
            </div>
          );
        })}
      </div>

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
