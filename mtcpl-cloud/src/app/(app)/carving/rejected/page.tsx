/**
 * Mig 080 — Carving Rejected (team-side read-only landing).
 *
 * Daksh May 2026: When the reviewer hits Reject (the hard one — two
 * confirmations, mandatory image + reason), the slab flips to
 * status='carving_rejected' and lands here.
 *
 * Audience: developer / owner / carving_head / senior_incharge
 *   (same as canSeeAwaitingReview — the Carving Done Approval crowd).
 * Tone: read-only. Daksh's note: "we don't know yet what we'll do
 *   when reject is there." So we surface what happened (slab id,
 *   vendor, reviewer, when, reason, photo) and that's it. No
 *   "delete row" / "un-reject" / "re-route to a different vendor"
 *   actions yet — those would arrive in a follow-on once Daksh
 *   decides how rejects fold back into operations.
 *
 * Sorted by reject time (newest first). Capped at 100 rows — there
 * should never be that many rejects in flight; if we ever hit the
 * cap a paginator can land then.
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canSeeAwaitingReview } from "@/lib/cutting-permissions";
import { CarvingRejectedClient } from "./client";

export default async function CarvingRejectedPage() {
  const { profile } = await requireAuth();
  if (!canSeeAwaitingReview(profile)) {
    redirect("/");
  }
  const admin = createAdminSupabaseClient();

  // Pull rejected carving_items + everything we need to render in
  // one round-trip. The vendor_name + reviewer name (via a fk-lookup
  // on review_rejected_by → profiles) ride along so the client
  // doesn't have to re-fetch. Image rendering is a separate signed-
  // URL roundtrip per row, lazy on the client.
  const { data: rejectedRows } = await admin
    .from("carving_items")
    .select(
      "id, slab_requirement_id, vendor_id, vendor_name, review_decision, review_rejected_at, review_rejected_by, review_image_path, review_image_paths, review_notes, completed_at, status",
    )
    .eq("status", "carving_rejected")
    .order("review_rejected_at", { ascending: false })
    .limit(100);

  const rows = (rejectedRows ?? []) as Array<{
    id: string;
    slab_requirement_id: string;
    vendor_id: string | null;
    vendor_name: string | null;
    review_decision: string | null;
    review_rejected_at: string | null;
    review_rejected_by: string | null;
    review_image_path: string | null;
    review_image_paths: string[] | null;
    review_notes: string | null;
    completed_at: string | null;
    status: string;
  }>;

  // Hydrate slabs + reviewer names in parallel. Map by id so the
  // client just gets a flat list of fully-shaped rows.
  const slabIds = [...new Set(rows.map((r) => r.slab_requirement_id))];
  const reviewerIds = [
    ...new Set(rows.map((r) => r.review_rejected_by).filter((x): x is string => !!x)),
  ];

  const [{ data: slabs }, { data: reviewers }] = await Promise.all([
    slabIds.length
      ? admin
          .from("slab_requirements")
          .select("id, label, temple, stone, length_ft, width_ft, thickness_ft")
          .in("id", slabIds)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    reviewerIds.length
      ? admin
          .from("profiles")
          .select("id, full_name")
          .in("id", reviewerIds)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
  ]);

  type SlabRow = {
    id: string;
    label: string | null;
    temple: string;
    stone: string | null;
    length_ft: number | string;
    width_ft: number | string;
    thickness_ft: number | string;
  };
  type ReviewerRow = { id: string; full_name: string | null };

  const slabById = new Map<string, SlabRow>();
  for (const s of (slabs ?? []) as SlabRow[]) slabById.set(s.id, s);
  const reviewerById = new Map<string, ReviewerRow>();
  for (const r of (reviewers ?? []) as ReviewerRow[])
    reviewerById.set(r.id, r);

  const items = rows.map((r) => {
    const slab = slabById.get(r.slab_requirement_id) ?? null;
    const reviewer = r.review_rejected_by
      ? reviewerById.get(r.review_rejected_by) ?? null
      : null;
    return {
      id: r.id,
      slab_id: r.slab_requirement_id,
      vendor_name: r.vendor_name,
      reviewer_name: reviewer?.full_name ?? null,
      rejected_at: r.review_rejected_at,
      image_path: r.review_image_path,
      image_paths: r.review_image_paths,
      notes: r.review_notes,
      slab: slab
        ? {
            label: slab.label,
            temple: slab.temple ?? "—",
            stone: slab.stone,
            length_in: Number(slab.length_ft) || 0,
            width_in: Number(slab.width_ft) || 0,
            thickness_in: Number(slab.thickness_ft) || 0,
          }
        : null,
    };
  });

  return (
    <div style={{ padding: 20, maxWidth: 920, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <Link
          href="/carving"
          style={{
            fontSize: 13,
            color: "var(--muted)",
            textDecoration: "none",
          }}
        >
          ← Carving
        </Link>
      </div>
      <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>
        Carving Rejected
      </h1>
      <p
        className="muted"
        style={{ marginTop: 6, fontSize: 13, lineHeight: 1.5 }}
      >
        Slabs the reviewer rejected — these are out of the active loop.
        Read-only view; we'll decide together what to do with rejected
        pieces.
      </p>

      <div style={{ marginTop: 18 }}>
        <CarvingRejectedClient items={items} />
      </div>
    </div>
  );
}
