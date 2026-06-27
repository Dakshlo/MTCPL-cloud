/**
 * Friendly slab-status labels (Daksh June 2026) — DISPLAY ONLY, the
 * slab_status enum values are unchanged.
 *
 *   completed                          → "Ready to dispatch"
 *   dispatched + no approval yet       → "Dispatch approval pending"
 *   dispatched + approved, undelivered → "On the way to site"
 *   dispatched + delivered             → "Delivered"
 *
 * The three dispatched sub-states need the slab's dispatch record
 * (approved_at / delivered_at) — pass it via the optional `dispatch`
 * arg. Without it, a dispatched slab falls back to a neutral "Dispatched".
 */

export type SlabDispatchState = {
  approvedAt?: string | null;
  deliveredAt?: string | null;
} | null | undefined;

const STATIC_LABELS: Record<string, string> = {
  open: "Open",
  planned: "Planned",
  cutting: "Cutting",
  awaiting_approval: "Cut approval pending",
  cut_done: "Cut · awaiting carving",
  carving_assigned: "Carving assigned",
  carving_in_progress: "Carving in progress",
  carving_on_hold: "Carving on hold",
  rejected: "Broken / rejected",
};

export function slabStatusLabel(status: string, dispatch?: SlabDispatchState): string {
  if (status === "completed") return "Ready to dispatch";
  if (status === "dispatched") {
    if (dispatch?.deliveredAt) return "Delivered";
    if (dispatch?.approvedAt) return "On the way to site";
    if (dispatch) return "Dispatch approval pending"; // on a provisional (unapproved) truck
    return "Dispatched"; // no dispatch record available — neutral fallback
  }
  return STATIC_LABELS[status] ?? status.replace(/_/g, " ");
}
