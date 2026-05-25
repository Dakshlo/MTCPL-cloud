import type { Profile } from "@/lib/types";

/**
 * Cross-block slab transfer + Fit-to-Fill access. Trusted to:
 *
 *   - Every developer (full system access).
 *   - Every team_head (per business decision — the role is meant to
 *     own day-to-day cutting decisions, including filling a block
 *     with extra slabs from other plans).
 *   - The two named owners — Naresh and Rajesh — regardless of how
 *     their full_name is stored ("Naresh", "Naresh Kumar Soni",
 *     "Mr Naresh", "Rajesh Kumar Sharma" all match). Kept around
 *     even though team_head now covers Rajesh by role, in case
 *     either of them gets stored under a different role later.
 *
 * Other roles (block_entry, slab_entry, cutting_operator, owner with
 * a different name) are intentionally NOT granted this — that's
 * still a deliberately gated capability.
 */
const TRANSFER_ALLOWED_NAME_SUBSTRINGS = ["NARESH", "RAJESH"];

export function canTransferPlannedSlabs(profile: Pick<Profile, "role" | "full_name">): boolean {
  if (profile.role === "developer") return true;
  if (profile.role === "team_head") return true;
  const name = (profile.full_name ?? "").toUpperCase().trim();
  if (!name) return false;
  // Substring match — "Naresh", "Naresh Bhai", "Naresh Kumar Soni" etc.
  // all match "NARESH". Same for Rajesh. Tolerates whatever variant
  // the profile happens to be stored as.
  return TRANSFER_ALLOWED_NAME_SUBSTRINGS.some((sub) => name.includes(sub));
}

/**
 * Manage cutter operators — pick from list, add new ones, assign to
 * blocks. Open to every role that already touches cutting flow:
 * developer, owner, team_head, cutting_operator. Block-entry /
 * slab-entry roles stay locked out — they don't run cutting.
 *
 * The operator NAME, however, surfaces on cards for everyone — only
 * the management actions are gated.
 */
export function canManageOperators(profile: Pick<Profile, "role" | "full_name">): boolean {
  if (profile.role === "developer") return true;
  if (profile.role === "owner") return true;
  if (profile.role === "team_head") return true;
  if (profile.role === "cutting_operator") return true;
  return false;
}

/**
 * Cutting-Done supervisor approval (migration 027 + Mig 037 follow-up).
 * Sees the top-bar "Cutting Audit" badge + can press Approve / Edit /
 * Allow cutter to edit:
 *
 *   - developer (always)
 *   - owner (always)
 *   - team_head, carving_head, or crosscheck — but ONLY if their
 *     profile has can_approve_cuts=TRUE.
 *
 * Today the flag is intended to be set on:
 *   - Rajesh Kumar (team_head)   — original cutting-audit deputy
 *   - Parth Sompura (carving_head) — added per Daksh, second auditor
 *   - Mafat Purohit (crosscheck)   — added per Daksh, third auditor
 *
 * Other holders of those roles keep their existing capabilities but
 * don't see the audit surface unless the flag is set. The flag is the
 * gate; the role list above is the narrow set we trust to even be
 * eligible.
 */
const CUT_APPROVE_FLAG_ELIGIBLE_ROLES = ["team_head", "senior_incharge", "carving_head", "crosscheck"] as const;

export function canApproveCuts(
  profile: Pick<Profile, "role" | "can_approve_cuts">,
): boolean {
  if (profile.role === "developer") return true;
  if (profile.role === "owner") return true;
  if (
    (CUT_APPROVE_FLAG_ELIGIBLE_ROLES as readonly string[]).includes(profile.role) &&
    profile.can_approve_cuts === true
  ) {
    return true;
  }
  return false;
}

/**
 * Mig 074 — Carving-head-lite access. Reaches /carving (Unassigned +
 * Active + Carving Done tabs) and /slabs (Required Sizes), so the
 * holder can pick which slabs to assign and to whom. Does NOT include
 * Awaiting Review — that stays the team's sign-off queue
 * (canSeeAwaitingReview below).
 *
 * Granted to:
 *   - developer / owner (always)
 *   - carving_head (always — original role)
 *   - team_head (Daksh May 2026 round 2 — Rajesh needs to land here
 *     to use the "Add external cut slab" affordance described below.
 *     The existing assign actions stay gated to dev/owner/carving_head,
 *     so team_head can browse but their Assign clicks toast if they
 *     try — that's fine, the data-entry button is the goal.)
 *   - any profile with can_assign_carving=TRUE (typically a vendor
 *     who also runs the carving-assign step, e.g. Mohit)
 */
export function canAccessCarvingPage(
  profile: Pick<Profile, "role" | "can_assign_carving">,
): boolean {
  if (profile.role === "developer") return true;
  if (profile.role === "owner") return true;
  if (profile.role === "carving_head") return true;
  if (profile.role === "senior_incharge") return true;
  if (profile.role === "team_head") return true;
  if (profile.can_assign_carving === true) return true;
  return false;
}

/**
 * Daksh May 2026 round 2 — "external cut slab" data-entry button on
 * the /carving Unassigned tab. Use case: a ready-to-carve slab walks
 * in from an outside supplier without ever passing through MTCPL's
 * cutting pipeline, so there's no block / cut session to attach to.
 * The action inserts a slab_requirements row directly at
 * status='cut_done' with source_block_id NULL, which lands in the
 * carving Unassigned tab ready to assign without touching anything
 * cutting-side.
 *
 * Restricted set: anything that touches stock data direct + leaves
 * an audit trail. NOT given to can_assign_carving vendors — they
 * should only assign existing in-system slabs, not invent new ones.
 */
export function canAddExternalCutSlab(profile: Pick<Profile, "role">): boolean {
  if (profile.role === "developer") return true;
  if (profile.role === "owner") return true;
  if (profile.role === "carving_head") return true;
  if (profile.role === "senior_incharge") return true;
  if (profile.role === "team_head") return true;
  return false;
}

/**
 * Mig 074 — gates the Awaiting Review tab on /carving + downstream
 * approve / re-route actions. Tighter than canAccessCarvingPage so
 * vendors with can_assign_carving=TRUE don't approve their own work.
 */
export function canSeeAwaitingReview(
  profile: Pick<Profile, "role">,
): boolean {
  if (profile.role === "developer") return true;
  if (profile.role === "owner") return true;
  if (profile.role === "carving_head") return true;
  // Mig 076 — senior_incharge has the "Carving Done Approval"
  // sign-off responsibility (the rename Daksh asked for; the
  // server-side query keys stay 'review' for backward compat).
  if (profile.role === "senior_incharge") return true;
  return false;
}

/**
 * Read access to the Required Sizes (/slabs) page.
 *
 * Mig 074 first pass briefly included can_assign_carving holders here
 * so Mohit could open the requirements list. Daksh May 2026 round 2 —
 * dropped that carve-out: Mohit's sidebar now points at Ready Sizes
 * Stock (the actionable bucket view) instead, and the abstract
 * requirements list is the cutting/planning team's surface. Keeps the
 * gate matching its original audience.
 */
export function canReadRequiredSizes(
  profile: Pick<Profile, "role">,
): boolean {
  if (profile.role === "developer") return true;
  if (profile.role === "owner") return true;
  if (profile.role === "team_head") return true;
  if (profile.role === "senior_incharge") return true;
  if (profile.role === "slab_entry") return true;
  if (profile.role === "block_slab_entry") return true;
  return false;
}
