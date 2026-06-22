import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { SlabThumb } from "@/components/slab-thumb";
import { ConfirmButton } from "@/components/confirm-button";
import { SlabComponentDetail } from "@/components/slab-component-detail";
import type { StoneTypeDef } from "@/lib/stone-utils";
import {
  sendWorkOrderLineToVendorAction,
  bindSlabToWorkOrderLineAction,
  removeWorkOrderLineAction,
  recallWorkOrderLineAction,
  cancelWorkOrderAction,
  approveWorkOrderAction,
  rejectWorkOrderAction,
  handoverWorkOrderAction,
  markCarvingCompleteManuallyAction,
} from "../../actions";
import { ReadySendPanel } from "./ready-send-panel";

export const dynamic = "force-dynamic";

const ALLOWED = ["developer", "owner", "carving_head", "senior_incharge"];

const SLAB_TONE: Record<string, { bg: string; fg: string; label: string; icon: string }> = {
  open: { bg: "rgba(100,116,139,0.14)", fg: "#475569", label: "Open", icon: "○" },
  planned: { bg: "rgba(217,119,6,0.14)", fg: "#b45309", label: "Planned", icon: "⏳" },
  cut_done: { bg: "rgba(22,163,74,0.14)", fg: "#15803d", label: "Ready", icon: "✅" },
};

// Friendly label for a send-batch timestamp.
function fmtBatch(at: string): string {
  if (at === "unknown") return "earlier";
  try {
    return new Date(at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
  } catch { return at; }
}
const gpBtn = { padding: "8px 14px", fontSize: 12, fontWeight: 700, color: "#1d4ed8", background: "rgba(37,99,235,0.1)", border: "1px solid rgba(37,99,235,0.35)", borderRadius: 8, textDecoration: "none" } as const;

export default async function WorkOrderDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { profile } = await requireAuth();
  if (!ALLOWED.includes(profile.role)) redirect("/carving");
  const { id } = await params;
  const sp = await searchParams;
  // ?sent=CODE1,CODE2 — slabs just sent in the last batch → offer a gate pass.
  const justSentCodes = String(sp.sent ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const admin = createAdminSupabaseClient();

  const { data: woRow } = await admin
    .from("carving_work_orders")
    .select("id, wo_number, vendor_name, title, temple, jobwork_rate, jobwork_unit, status, notes, cancelled_at, reject_reason")
    .eq("id", id)
    .maybeSingle();
  if (!woRow) redirect("/carving/work-orders?toast=Work+order+not+found");
  const wo = woRow as {
    wo_number: string; vendor_name: string; title: string | null; temple: string | null;
    jobwork_rate: number | string | null; jobwork_unit: string | null; status: string;
    notes: string | null; cancelled_at: string | null; reject_reason: string | null;
  };

  const { data: lineRows } = await admin
    .from("carving_work_order_items")
    .select("id, slab_requirement_id, carving_item_id, description, planned_length_ft, planned_width_ft, planned_thickness_ft, qty, line_status, position, sent_batch_at")
    .eq("work_order_id", id)
    .order("position", { ascending: true });
  const lines = ((lineRows ?? []) as Array<{
    id: string; slab_requirement_id: string | null; carving_item_id: string | null;
    description: string | null; planned_length_ft: number | null; planned_width_ft: number | null;
    planned_thickness_ft: number | null; qty: number; line_status: string; sent_batch_at: string | null;
  }>).filter((l) => l.line_status !== "cancelled");

  // Slab meta (status + dims + stone + stock loc) for lines that reference a slab.
  const slabIds = lines.map((l) => l.slab_requirement_id).filter(Boolean) as string[];
  type SlabMeta = {
    status: string; label: string | null; stone: string | null;
    l: number; w: number; t: number; stock_location: string | null;
    description: string | null; component_section: string | null;
    component_element: string | null; additional_description: string | null;
  };
  const slabMeta = new Map<string, SlabMeta>();
  if (slabIds.length) {
    const { data } = await admin
      .from("slab_requirements")
      .select("id, status, label, stone, stock_location, length_ft, width_ft, thickness_ft, description, component_section, component_element, additional_description")
      .in("id", slabIds);
    for (const s of (data ?? []) as Array<{ id: string; status: string; label: string | null; stone: string | null; stock_location: string | null; length_ft: number | string; width_ft: number | string; thickness_ft: number | string; description: string | null; component_section: string | null; component_element: string | null; additional_description: string | null }>) {
      slabMeta.set(s.id, {
        status: s.status,
        label: s.label,
        stone: s.stone,
        l: Number(s.length_ft) || 0,
        w: Number(s.width_ft) || 0,
        t: Number(s.thickness_ft) || 0,
        stock_location: s.stock_location,
        description: s.description,
        component_section: s.component_section,
        component_element: s.component_element,
        additional_description: s.additional_description,
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
  // Mig 098 — only the owner can edit/cancel/approve; slabs can be sent only
  // once the work order is owner-approved (status open/in_progress).
  const isOwner = profile.role === "owner" || profile.role === "developer";
  const approved = wo.status === "open" || wo.status === "in_progress";
  // Mig 100 — handover gate. After approval the work-order doc is handed
  // to the vendor; only then can slabs be sent. Guarded query so the page
  // survives before mig 100 runs (missing column → treated as not handed
  // over, which just surfaces the handover step).
  let handedOver = false;
  {
    const { data: hoRow } = await admin
      .from("carving_work_orders")
      .select("handed_over_at")
      .eq("id", id)
      .maybeSingle();
    handedOver = !!(hoRow as { handed_over_at?: string | null } | null)?.handed_over_at;
  }
  // Lines that are cut-done + not yet sent → eligible to send (all / selected).
  const readyLines = lines
    .filter((l) => !l.carving_item_id && l.line_status === "planned" && l.slab_requirement_id && slabMeta.get(l.slab_requirement_id)?.status === "cut_done")
    .map((l) => {
      const m = slabMeta.get(l.slab_requirement_id!)!;
      return { lineId: l.id, code: l.slab_requirement_id!, dims: `${m.l}×${m.w}×${m.t}` };
    });
  const readyToSend = readyLines.length;
  // Slabs currently OUT at the vendor → reprintable gate pass.
  const outCount = lines.filter((l) => l.line_status === "sent" && l.slab_requirement_id).length;
  // Group sent slabs into the BATCHES they left in (one gate pass per batch).
  const batchMap = new Map<string, string[]>();
  for (const l of lines) {
    if (l.line_status !== "sent" || !l.slab_requirement_id) continue;
    const key = l.sent_batch_at ?? "unknown";
    const arr = batchMap.get(key);
    if (arr) arr.push(l.slab_requirement_id); else batchMap.set(key, [l.slab_requirement_id]);
  }
  const batches = [...batchMap.entries()]
    .map(([at, codes]) => ({ at, codes }))
    .sort((a, b) => (a.at < b.at ? -1 : 1));

  const btn = (bg: string) => ({ width: "100%", padding: "7px 10px", fontSize: 11.5, fontWeight: 700, color: "#fff", background: bg, border: "none", borderRadius: 6, cursor: "pointer" } as const);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingBottom: 32, maxWidth: 1180 }}>
      <style>{`
        @keyframes woReadyPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(22,163,74,0); }
          50% { box-shadow: 0 0 0 3px rgba(22,163,74,0.30); }
        }
        .wo-ready-blink { animation: woReadyPulse 1.5s ease-in-out infinite; }
        .gp-summary { list-style: none; cursor: pointer; }
        .gp-summary::-webkit-details-marker { display: none; }
      `}</style>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div>
          <Link href="/carving?mode=outsource&tab=workorders" style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", textDecoration: "none" }}>← Work orders</Link>
          <h1 style={{ margin: "6px 0 0", fontSize: 22, fontFamily: "ui-monospace, monospace" }}>{wo.wo_number}</h1>
          <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}>
            🤝 {wo.vendor_name}{wo.title ? ` · ${wo.title}` : ""}{wo.temple ? ` · ${wo.temple}` : ""}
            {wo.jobwork_rate != null ? ` · ₹${Number(wo.jobwork_rate)}/${wo.jobwork_unit === "job" ? "slab" : wo.jobwork_unit ?? "cft"}` : ""}
            {cancelled ? " · CANCELLED" : ""}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {/* Mig 100 — download/print the work-order document anytime from
              here (the tab card only offers it at handover). */}
          {(approved || wo.status === "completed") && (
            <a href={`/api/carving/work-order-pdf/${id}`} target="_blank" rel="noopener noreferrer" style={{ padding: "8px 14px", fontSize: 12, fontWeight: 700, color: "#92400e", background: "rgba(146,64,14,0.1)", border: "1px solid rgba(146,64,14,0.35)", borderRadius: 8, textDecoration: "none" }}>⬇ Work order doc</a>
          )}
          {/* One batch → a single gate pass; several → a dropdown so you can
              print the respective gate pass for each assignment batch. */}
          {batches.length === 1 && (
            <a href={`/api/carving/gate-pass/${id}`} target="_blank" rel="noopener noreferrer" title="Gate pass for the slabs out at the vendor" style={gpBtn}>🪪 Gate pass ({outCount})</a>
          )}
          {batches.length > 1 && (
            <details style={{ position: "relative" }}>
              <summary className="gp-summary" style={{ ...gpBtn, display: "inline-block" }}>🪪 Gate pass · {batches.length} batches ▾</summary>
              <div style={{ position: "absolute", right: 0, top: "100%", marginTop: 4, zIndex: 20, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, boxShadow: "0 12px 30px rgba(0,0,0,0.18)", padding: 6, minWidth: 240 }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", padding: "4px 8px 6px" }}>Print gate pass for…</div>
                {batches.map((b, i) => (
                  <a key={b.at} href={`/api/carving/gate-pass/${id}?slabs=${encodeURIComponent(b.codes.join(","))}`} target="_blank" rel="noopener noreferrer" style={{ display: "block", padding: "7px 9px", fontSize: 12.5, color: "var(--text)", textDecoration: "none", borderRadius: 6 }}>
                    🪪 Batch {i + 1} · {fmtBatch(b.at)} · {b.codes.length} slab{b.codes.length === 1 ? "" : "s"}
                  </a>
                ))}
                <a href={`/api/carving/gate-pass/${id}`} target="_blank" rel="noopener noreferrer" style={{ display: "block", padding: "7px 9px", fontSize: 12.5, fontWeight: 700, color: "#1d4ed8", textDecoration: "none", borderTop: "1px solid var(--border)", marginTop: 4 }}>
                  📋 All out ({outCount})
                </a>
              </div>
            </details>
          )}
          <Link href="/carving/challans/new" style={{ padding: "8px 14px", fontSize: 12, fontWeight: 700, color: "#92400e", background: "rgba(146,64,14,0.1)", borderRadius: 8, textDecoration: "none" }}>🧾 Generate challan</Link>
        </div>
      </div>

      {/* Batch just sent → prominent gate-pass print (for exactly those slabs). */}
      {justSentCodes.length > 0 && (
        <div style={{ background: "rgba(37,99,235,0.07)", border: "1px solid rgba(37,99,235,0.4)", borderRadius: 12, padding: "13px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#1e40af" }}>
            📤 {justSentCodes.length} slab{justSentCodes.length === 1 ? "" : "s"} sent to {wo.vendor_name}. Print the gate pass to hand at the main gate for exit.
          </div>
          <a href={`/api/carving/gate-pass/${id}?slabs=${encodeURIComponent(justSentCodes.join(","))}`} target="_blank" rel="noopener noreferrer" style={{ padding: "9px 18px", fontSize: 13, fontWeight: 800, color: "#fff", background: "#1d4ed8", border: "none", borderRadius: 8, textDecoration: "none", whiteSpace: "nowrap" }}>
            🪪 Print gate pass ({justSentCodes.length})
          </a>
        </div>
      )}

      {/* Mig 098 — owner price-approval gate. Nothing can be sent until approved. */}
      {wo.status === "pending_approval" && (
        isOwner ? (
          <div style={{ background: "rgba(217,119,6,0.08)", border: "1px solid rgba(217,119,6,0.4)", borderRadius: 12, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#92400e" }}>⏳ This work order needs your price approval before any slab can be sent.</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "flex-end" }}>
              <form action={approveWorkOrderAction} style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
                <input type="hidden" name="work_order_id" value={id} />
                <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--muted)" }}>Price (required)</span>
                  <input name="jobwork_rate" type="number" min="0" step="0.01" required defaultValue={wo.jobwork_rate != null ? String(Number(wo.jobwork_rate)) : ""} style={{ width: 120, padding: "7px 9px", border: "1px solid var(--border)", borderRadius: 7, fontSize: 13 }} />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--muted)" }}>Unit</span>
                  <select name="jobwork_unit" defaultValue={wo.jobwork_unit === "sft" ? "sft" : wo.jobwork_unit === "job" ? "job" : "cft"} style={{ padding: "7px 9px", border: "1px solid var(--border)", borderRadius: 7, fontSize: 13 }}>
                    <option value="cft">/cft</option>
                    <option value="sft">/sft</option>
                    <option value="job">/slab (job)</option>
                  </select>
                </label>
                <button type="submit" style={{ padding: "9px 18px", fontSize: 13, fontWeight: 800, color: "#fff", background: "#15803d", border: "none", borderRadius: 8, cursor: "pointer" }}>✓ Approve</button>
              </form>
              <form action={rejectWorkOrderAction} style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
                <input type="hidden" name="work_order_id" value={id} />
                <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--muted)" }}>Reject reason</span>
                  <input name="reason" placeholder="optional" style={{ width: 160, padding: "7px 9px", border: "1px solid var(--border)", borderRadius: 7, fontSize: 13 }} />
                </label>
                <button type="submit" style={{ padding: "9px 16px", fontSize: 13, fontWeight: 700, color: "#991b1b", background: "rgba(220,38,38,0.1)", border: "1px solid rgba(220,38,38,0.3)", borderRadius: 8, cursor: "pointer" }}>✕ Reject</button>
              </form>
            </div>
          </div>
        ) : (
          <div style={{ background: "rgba(217,119,6,0.08)", border: "1px solid rgba(217,119,6,0.4)", borderRadius: 12, padding: "14px 16px", fontSize: 13, fontWeight: 700, color: "#92400e" }}>
            ⏳ Waiting for the owner to approve the price. Slabs can be sent only after approval.
          </div>
        )
      )}
      {wo.status === "rejected" && (
        <div style={{ background: "rgba(220,38,38,0.07)", border: "1px solid rgba(220,38,38,0.35)", borderRadius: 12, padding: "14px 16px", fontSize: 13, color: "#991b1b" }}>
          <div style={{ fontWeight: 800 }}>✕ This work order was rejected by the owner.</div>
          {wo.reject_reason && <div style={{ marginTop: 4 }}>Reason: {wo.reject_reason}</div>}
        </div>
      )}

      {/* Mig 100 — approved, awaiting handover: print the work-order doc,
          get it signed, hand it to the vendor. Sending unlocks after. */}
      {approved && !cancelled && !handedOver && (
        <div style={{ background: "rgba(22,163,74,0.07)", border: "1px solid rgba(22,163,74,0.35)", borderRadius: 12, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#15803d" }}>✅ Approved — print the work order, get it signed, and hand it to {wo.vendor_name}. Slabs can be sent only after handover.</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <a href={`/api/carving/work-order-pdf/${id}`} target="_blank" rel="noopener noreferrer" style={{ padding: "9px 16px", fontSize: 13, fontWeight: 700, color: "#92400e", background: "rgba(146,64,14,0.1)", border: "1px solid rgba(146,64,14,0.35)", borderRadius: 8, textDecoration: "none" }}>⬇ Download work order document</a>
            <form action={handoverWorkOrderAction}>
              <input type="hidden" name="work_order_id" value={id} />
              <button type="submit" style={{ padding: "9px 18px", fontSize: 13, fontWeight: 800, color: "#fff", background: "#15803d", border: "none", borderRadius: 8, cursor: "pointer" }}>🤝 Handover to vendor</button>
            </form>
          </div>
        </div>
      )}

      {/* Pick which ready slabs to send (defaults to all) — with confirm. */}
      {approved && handedOver && !cancelled && readyLines.length > 0 && (
        <ReadySendPanel workOrderId={id} vendorName={wo.vendor_name} ready={readyLines} />
      )}

      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>Lines ({lines.length})</div>

      {lines.length === 0 ? (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 24, color: "var(--muted)", fontSize: 13, textAlign: "center" }}>No lines on this work order.</div>
      ) : (
        (() => {
          // Group the cards by stage (Daksh): Open together, then At vendor,
          // then Received (awaiting approval), then Approved.
          const groupOf = (l: (typeof lines)[number]): "open" | "vendor" | "received" | "approved" => {
            const gci = l.carving_item_id ? ciMeta.get(l.carving_item_id) : null;
            const gSent = l.line_status === "sent" || !!l.carving_item_id;
            if (!gSent) return "open";
            if (gci?.review_approved_at) return "approved";
            if (gci?.completed_at) return "received";
            return "vendor";
          };
          const SECTIONS = [
            { key: "open" as const, label: "Open / not yet sent", icon: "○", tone: "#64748b" },
            { key: "vendor" as const, label: "At vendor (carving)", icon: "📤", tone: "#1d4ed8" },
            { key: "received" as const, label: "Received — awaiting approval", icon: "📥", tone: "#b45309" },
            { key: "approved" as const, label: "Approved", icon: "✓", tone: "#15803d" },
          ];
          const renderLine = (l: (typeof lines)[number]) => {
            const slab = l.slab_requirement_id ? slabMeta.get(l.slab_requirement_id) : null;
            const ci = l.carving_item_id ? ciMeta.get(l.carving_item_id) : null;
            const isSent = l.line_status === "sent" || !!l.carving_item_id;
            const stageTone = ci?.review_approved_at ? "#15803d" : ci?.completed_at ? "#b45309" : "#92400e";
            const stage = isSent && ci
              ? ci.review_approved_at ? "Approved ✓" : ci.completed_at ? "Received — awaiting approval" : "At vendor (carving)"
              : "";
            const tn = slab ? (SLAB_TONE[slab.status] ?? SLAB_TONE.open) : null;
            // Cut-done + not yet sent → "needs attention": blink + green accent.
            const isReady = !isSent && !cancelled && slab?.status === "cut_done";
            const accent = isSent ? "#1d4ed8" : isReady ? "#15803d" : slab ? "#94a3b8" : "#cbd5e1";
            return (
              <div key={l.id} className={isReady ? "wo-ready-blink" : undefined} style={{ display: "flex", flexDirection: "column", gap: 4, padding: 8, background: "var(--surface)", border: "1px solid var(--border)", borderLeft: `4px solid ${accent}`, borderRadius: 10 }}>
                {l.slab_requirement_id && slab ? (
                  <SlabThumb stone={slab.stone} l={slab.l} w={slab.w} t={slab.t} stoneTypes={stoneTypes} size={56} height={46} />
                ) : (
                  <div style={{ height: 46, background: "var(--surface-alt)", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted-light)", fontSize: 10 }}>📝 future</div>
                )}

                {l.slab_requirement_id ? (
                  <>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                      <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700, fontSize: 12, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.slab_requirement_id}</span>
                      {slab?.stone && <span className="role-pill" style={{ fontSize: 9, padding: "1px 6px", flexShrink: 0 }}>{slab.stone}</span>}
                    </div>
                    {slab && (
                      <SlabComponentDetail
                        section={slab.component_section}
                        element={slab.component_element}
                        label={slab.label}
                        description={slab.description}
                        additional={slab.additional_description}
                      />
                    )}
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
                  {isSent ? (
                    <>
                      {!cancelled && ci && !ci.completed_at && (
                        <form action={markCarvingCompleteManuallyAction}>
                          <input type="hidden" name="carving_item_id" value={l.carving_item_id!} />
                          <input type="hidden" name="redirect_to" value={`/carving/work-orders/${id}`} />
                          <button type="submit" style={btn("#15803d")}>📥 Receive</button>
                        </form>
                      )}
                      {/* Owner/dev can pull a sent slab back to "not yet
                          shipped" — even while active, after approval, or on
                          a cancelled work order. */}
                      {isOwner && (
                        <form action={recallWorkOrderLineAction}>
                          <input type="hidden" name="line_id" value={l.id} />
                          <input type="hidden" name="work_order_id" value={id} />
                          <ConfirmButton
                            message="Cancel this slab's assignment and bring it back to ‘not yet shipped’? Its carving record is removed and the slab returns to cut-done (you can re-send it later)."
                            style={{ width: "100%", padding: "6px 10px", fontSize: 11, fontWeight: 700, color: "#991b1b", background: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.3)", borderRadius: 6, cursor: "pointer" }}
                          >
                            ↩ Cancel assignment
                          </ConfirmButton>
                        </form>
                      )}
                    </>
                  ) : cancelled ? null : l.slab_requirement_id && slab?.status === "cut_done" ? (
                    approved && handedOver ? (
                      <form action={sendWorkOrderLineToVendorAction}>
                        <input type="hidden" name="line_id" value={l.id} />
                        <input type="hidden" name="work_order_id" value={id} />
                        <ConfirmButton message={`Send ${l.slab_requirement_id} to ${wo.vendor_name} for carving?`} style={btn("#92400e")}>📤 Send to vendor</ConfirmButton>
                      </form>
                    ) : (
                      <span style={{ fontSize: 11, color: "#b45309", fontWeight: 600 }}>{approved ? "⏳ hand over WO to send" : "⏳ approve WO to send"}</span>
                    )
                  ) : l.slab_requirement_id ? (
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>⏳ waiting to be cut</span>
                  ) : isOwner ? (
                    <form action={bindSlabToWorkOrderLineAction} style={{ display: "flex", gap: 4, alignItems: "center" }}>
                      <input type="hidden" name="line_id" value={l.id} />
                      <input type="hidden" name="work_order_id" value={id} />
                      <select name="slab_requirement_id" defaultValue="" required style={{ flex: 1, minWidth: 0, fontSize: 11, padding: "5px 6px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)" }}>
                        <option value="" disabled>Bind cut slab…</option>
                        {availableSlabs.map((s) => <option key={s.id} value={s.id}>{s.id}{s.label ? ` · ${s.label}` : ""}</option>)}
                      </select>
                      <button type="submit" style={{ fontSize: 11, fontWeight: 700, color: "#fff", background: "#0f766e", border: "none", borderRadius: 6, padding: "5px 10px", cursor: "pointer" }}>Link</button>
                    </form>
                  ) : (
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>📝 future need</span>
                  )}
                  {isOwner && !cancelled && !isSent && (
                    <form action={removeWorkOrderLineAction}>
                      <input type="hidden" name="line_id" value={l.id} />
                      <input type="hidden" name="work_order_id" value={id} />
                      {/* No confirm — Daksh wants Remove to act immediately. */}
                      <button
                        type="submit"
                        style={{ fontSize: 11, fontWeight: 700, color: "#991b1b", background: "none", border: "none", cursor: "pointer", padding: "2px 0" }}
                      >
                        Remove
                      </button>
                    </form>
                  )}
                </div>
              </div>
            );
          };
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {SECTIONS.map((sec) => {
                const groupLines = lines.filter((l) => groupOf(l) === sec.key);
                if (groupLines.length === 0) return null;
                return (
                  <div key={sec.key} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: sec.tone }}>
                      {sec.icon} {sec.label} <span style={{ color: "var(--muted)" }}>· {groupLines.length}</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(168px, 1fr))", gap: 9 }}>
                      {groupLines.map(renderLine)}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()
      )}

      {/* Mig 098 — only the owner can cancel a work order. */}
      {isOwner && !cancelled && wo.status !== "rejected" && (
        <form action={cancelWorkOrderAction} style={{ marginTop: 4, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input type="hidden" name="work_order_id" value={id} />
          <input name="reason" placeholder="Cancel reason (optional)" style={{ fontSize: 12, padding: "7px 9px", border: "1px solid var(--border)", borderRadius: 7, minWidth: 200 }} />
          <button type="submit" style={{ fontSize: 12, fontWeight: 700, color: "#991b1b", background: "none", border: "1px solid rgba(220,38,38,0.4)", borderRadius: 8, padding: "8px 14px", cursor: "pointer" }}>
            Cancel work order (un-sent lines only)
          </button>
        </form>
      )}
    </div>
  );
}
