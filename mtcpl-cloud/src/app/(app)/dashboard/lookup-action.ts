"use server";

/**
 * ID lookup — owner / developer / team_head / crosscheck / carving_head.
 *
 * Originally a dashboard-only card for owner+dev. Daksh promoted it
 * to a topbar quick-access dropdown (TopbarIdLookup) and widened the
 * roles: anyone who genuinely walks the floor and finds a stone
 * stencilled with an ID should be able to look it up.
 *
 * Anyone is roaming the floor and sees a slab or block stencilled
 * with an ID. They open the search, type the id, and get the full
 * system view: where the slab is, what temple it's for, its size,
 * when it was cut, where it is now (yard / carving vendor /
 * dispatched). Same for blocks (yard, dimensions, cutting status,
 * how many slabs derived).
 *
 * Returns a tagged union shape so the client component can switch on
 * `kind` to render the right panel.
 */

import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

// CFT helper. Slab/block dimensions are stored in INCHES even though
// the column names end with `_ft` (legacy naming). 1728 in³ = 1 ft³.
function toCft(l: number, w: number, h: number): number {
  return (l * w * h) / 1728;
}

export type SlabResult = {
  kind: "slab";
  slab: {
    id: string;
    label: string | null;
    temple: string;
    stone: string | null;
    length_in: number;
    width_in: number;
    thickness_in: number;
    cft: number;
    status: string;
    priority: boolean;
    source_block_id: string | null;
    yard: number | null;
    deadline: string | null;
    priority_note: string | null;
    created_at: string;
    updated_at: string;
    /** Mig 020 — last known physical location (stencilled at cut
     *  time, refreshable by vendors via Edit-location). NULL when
     *  the slab is mid-flight (in transit, on a machine, etc) and
     *  the cutter never set it. */
    stock_location: string | null;
  };
  /** Daksh May 2026 — one-line "where is it now per system" string
   *  derived from status + carving + dispatch + stock_location.
   *  Renders as the most prominent line of the panel so production
   *  / vendor sees the answer at a glance. */
  current_location: string;
  cut: {
    session_code: string;
    cut_at: string | null;
    planner_name: string | null;
    is_filler: boolean;
  } | null;
  carving: {
    vendor_name: string;
    vendor_type: string;
    status: string;
    due_at: string | null;
    completed_at: string | null;
    location: string | null;
    ready_to_dispatch_at: string | null;
  } | null;
  dispatch: {
    challan_number: number | null;
    vehicle_no: string | null;
    dispatched_at: string | null;
    delivered_at: string | null;
    receiver_name: string | null;
    temple: string | null;
  } | null;
};

export type BlockResult = {
  kind: "block";
  block: {
    id: string;
    yard: number;
    stone: string;
    length_in: number;
    width_in: number;
    height_in: number;
    cft: number;
    status: string;
    category: string;
    quality: string | null;
    created_at: string;
    updated_at: string;
    created_by_name: string | null;
  };
  cutting: {
    session_code: string;
    session_block_status: string;
    needs_reprint: boolean;
    largest_remainder_cft: number | null;
    /** Daksh May 2026 — completed-at + cutter name so production
     *  can answer "when was this block cut and by whom". cut_at
     *  is the cut_session_blocks.updated_at when status='done'.
     *  cut_by is the cut_sessions.planned_by profile. */
    cut_at: string | null;
    planner_name: string | null;
  } | null;
  slabs_from_block: {
    total: number;
    by_status: Record<string, number>;
  };
  current_location: string;
};

export type NotFoundResult = {
  kind: "not_found";
  query: string;
  suggestions: Array<{ kind: "slab" | "block"; id: string; hint: string }>;
};

export type LookupResult = SlabResult | BlockResult | NotFoundResult;

/** Build zero-padded variants of an ID so typing "MT-B-90" finds
 *  "MT-B-090" and vice versa. Splits the input on the LAST dash
 *  (the segment most likely to carry leading zeros — e.g. block ids
 *  like MT-B-245 and slab ids like AGROHA-0002-13). If the last
 *  segment is purely numeric, returns variants padded to 1..5 digits;
 *  otherwise returns just the trimmed original. Always uppercase.
 *
 *  Examples:
 *    "mt-b-90"   → ["MT-B-90","MT-B-090","MT-B-0090","MT-B-00090","MT-B-9"]
 *    "wf-0001"   → ["WF-0001","WF-1","WF-01","WF-001","WF-00001"]
 *    "AGROHA-2-13" → permutes the last "13" to "013","0013",… */
function zeroPadVariants(raw: string): string[] {
  const q = raw.trim().toUpperCase();
  if (!q) return [];
  const lastDash = q.lastIndexOf("-");
  if (lastDash === -1) return [q];
  const prefix = q.slice(0, lastDash + 1);
  const tail = q.slice(lastDash + 1);
  if (!/^\d+$/.test(tail)) return [q]; // not numeric — nothing to pad
  const n = parseInt(tail, 10);
  if (!Number.isFinite(n)) return [q];
  const variants = new Set<string>([q]);
  for (let w = 1; w <= 5; w++) {
    variants.add(`${prefix}${String(n).padStart(w, "0")}`);
  }
  return [...variants];
}

export async function lookupId(query: string): Promise<LookupResult> {
  // Mig 044 follow-on (Daksh): widened from dev/owner only to
  // every role that legitimately walks the workshop floor. May 2026
  // — added vendor too. Their stencilled slabs land in the shade and
  // they need to look the slab up just like staff do.
  await requireAuth([
    "developer",
    "owner",
    "team_head",
    "crosscheck",
    "carving_head",
    "vendor",
  ]);
  const admin = createAdminSupabaseClient();

  // Normalise: trim + uppercase. Slab and block IDs in the system are
  // always uppercase ("AGROHA-0002-13", "MT-B-245") so this matches
  // even if the user types lowercase or pastes with leading/trailing
  // whitespace.
  const q = query.trim().toUpperCase();
  if (!q) {
    return { kind: "not_found", query: "", suggestions: [] };
  }

  // Daksh May 2026 — zero-pad variants so "mt-b-90" finds "MT-B-090".
  // The first match wins; try slabs first (more common), then blocks.
  const variants = zeroPadVariants(q);

  // Try the slab table first — slab IDs are far more common (1500+)
  // than block IDs (~250) so this is the more likely match.
  const { data: slabRows } = await admin
    .from("slab_requirements")
    .select(
      "id, label, temple, stone, length_ft, width_ft, thickness_ft, source_block_id, status, priority, deadline, priority_note, created_at, updated_at, stock_location",
    )
    .in("id", variants)
    .limit(1);

  if (slabRows && slabRows.length > 0) {
    return await loadSlabContext(admin, slabRows[0] as Record<string, unknown>);
  }

  // Try block table next — same variant set.
  const { data: blockRows } = await admin
    .from("blocks")
    .select("*")
    .in("id", variants)
    .limit(1);

  if (blockRows && blockRows.length > 0) {
    return await loadBlockContext(admin, blockRows[0] as Record<string, unknown>);
  }

  // Nothing found — pull a few prefix suggestions so the user can pick
  // (handles typos like missing a digit, wrong dash, etc).
  const [slabHint, blockHint] = await Promise.all([
    admin
      .from("slab_requirements")
      .select("id, temple, status")
      .ilike("id", `${q}%`)
      .order("id")
      .limit(5),
    admin
      .from("blocks")
      .select("id, yard, status")
      .ilike("id", `${q}%`)
      .order("id")
      .limit(5),
  ]);

  const suggestions: NotFoundResult["suggestions"] = [];
  for (const s of slabHint.data ?? []) {
    suggestions.push({
      kind: "slab",
      id: (s as { id: string }).id,
      hint: `slab · ${(s as { temple?: string }).temple ?? "—"} · ${(s as { status?: string }).status ?? "—"}`,
    });
  }
  for (const b of blockHint.data ?? []) {
    suggestions.push({
      kind: "block",
      id: (b as { id: string }).id,
      hint: `block · yard ${(b as { yard?: number }).yard ?? "?"} · ${(b as { status?: string }).status ?? "—"}`,
    });
  }

  return { kind: "not_found", query: q, suggestions };
}

// ── Helpers ────────────────────────────────────────────────────────

async function loadSlabContext(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  raw: Record<string, unknown>,
): Promise<SlabResult> {
  const slab = raw as {
    id: string;
    label: string | null;
    temple: string;
    stone: string | null;
    length_ft: number | string;
    width_ft: number | string;
    thickness_ft: number | string;
    source_block_id: string | null;
    status: string;
    priority: boolean;
    deadline: string | null;
    priority_note: string | null;
    created_at: string;
    updated_at: string;
    stock_location: string | null;
  };

  const L = Number(slab.length_ft);
  const W = Number(slab.width_ft);
  const T = Number(slab.thickness_ft);

  // Derive "yard" from the source block (slabs themselves don't carry
  // yard — they belong to whichever yard their source block sits in).
  let yard: number | null = null;
  if (slab.source_block_id) {
    const { data: src } = await admin
      .from("blocks")
      .select("yard")
      .eq("id", slab.source_block_id)
      .maybeSingle();
    if (src) yard = (src as { yard: number }).yard;
  }

  // Cut session info (if this slab was actually cut from a session)
  let cut: SlabResult["cut"] = null;
  const { data: cutSlab } = await admin
    .from("cut_session_slabs")
    .select("cut_session_block_id, is_filler")
    .eq("slab_requirement_id", slab.id)
    .maybeSingle();
  if (cutSlab) {
    const { data: cutBlock } = await admin
      .from("cut_session_blocks")
      .select("cut_session_id, updated_at, status")
      .eq("id", (cutSlab as { cut_session_block_id: string }).cut_session_block_id)
      .maybeSingle();
    if (cutBlock) {
      const { data: session } = await admin
        .from("cut_sessions")
        .select("session_code, planned_by")
        .eq("id", (cutBlock as { cut_session_id: string }).cut_session_id)
        .maybeSingle();
      if (session) {
        const sess = session as { session_code: string; planned_by: string | null };
        let plannerName: string | null = null;
        if (sess.planned_by) {
          const { data: planner } = await admin
            .from("profiles")
            .select("full_name")
            .eq("id", sess.planned_by)
            .maybeSingle();
          plannerName = (planner as { full_name?: string } | null)?.full_name ?? null;
        }
        const cb = cutBlock as { updated_at: string; status: string };
        cut = {
          session_code: sess.session_code,
          cut_at: cb.status === "done" ? cb.updated_at : null,
          planner_name: plannerName,
          is_filler: Boolean((cutSlab as { is_filler?: boolean }).is_filler),
        };
      }
    }
  }

  // Carving info — most recent carving_items row for this slab.
  let carving: SlabResult["carving"] = null;
  const { data: cv } = await admin
    .from("carving_items")
    .select(
      "vendor_name, vendor_type, status, due_at, completed_at, location, ready_to_dispatch_at",
    )
    .eq("slab_requirement_id", slab.id)
    .order("assigned_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (cv) {
    carving = cv as SlabResult["carving"];
  }

  // Dispatch info — find via dispatch_logs.
  let dispatch: SlabResult["dispatch"] = null;
  const { data: log } = await admin
    .from("dispatch_logs")
    .select("dispatch_id")
    .eq("slab_requirement_id", slab.id)
    .order("dispatched_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (log) {
    const dispatchId = (log as { dispatch_id: string | null }).dispatch_id;
    if (dispatchId) {
      const { data: d } = await admin
        .from("dispatches")
        .select(
          "challan_number, vehicle_no, dispatched_at, delivered_at, receiver_name, temple",
        )
        .eq("id", dispatchId)
        .maybeSingle();
      if (d) {
        dispatch = d as SlabResult["dispatch"];
      }
    }
  }

  // Compose a single "where is it now per system" line. Most
  // specific signal wins (dispatch > carving > stock_location >
  // yard > unknown). This is what production/vendor scan first.
  let currentLocation = "Unknown — no location signal in the system";
  if (dispatch?.delivered_at) {
    currentLocation = `Delivered to ${dispatch.receiver_name ?? dispatch.temple ?? "—"}`;
  } else if (dispatch?.dispatched_at) {
    currentLocation = `On vehicle ${dispatch.vehicle_no ?? "—"} (dispatched ${new Date(dispatch.dispatched_at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" })})`;
  } else if (carving?.status === "carving_in_progress") {
    currentLocation = `On a CNC at ${carving.vendor_name}`;
  } else if (carving?.status === "completed") {
    currentLocation = `Carving completed at ${carving.vendor_name}${carving.location ? ` · ${carving.location}` : ""}`;
  } else if (carving?.status === "carving_assigned") {
    currentLocation = `Assigned to ${carving.vendor_name} (in transit or pending stock)`;
  } else if (carving) {
    currentLocation = `${carving.vendor_name}${carving.location ? ` · ${carving.location}` : ""}`;
  } else if (slab.stock_location) {
    currentLocation = `Stock: ${slab.stock_location}`;
  } else if (yard != null) {
    currentLocation = `Yard ${yard} (uncut block stock)`;
  }

  return {
    kind: "slab",
    slab: {
      id: slab.id,
      label: slab.label,
      temple: slab.temple,
      stone: slab.stone,
      length_in: L,
      width_in: W,
      thickness_in: T,
      cft: toCft(L, W, T),
      status: slab.status,
      priority: slab.priority,
      source_block_id: slab.source_block_id,
      yard,
      deadline: slab.deadline,
      priority_note: slab.priority_note,
      created_at: slab.created_at,
      updated_at: slab.updated_at,
      stock_location: slab.stock_location ?? null,
    },
    current_location: currentLocation,
    cut,
    carving,
    dispatch,
  };
}

async function loadBlockContext(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  raw: Record<string, unknown>,
): Promise<BlockResult> {
  const blk = raw as {
    id: string;
    yard: number;
    stone: string;
    length_ft: number | string;
    width_ft: number | string;
    height_ft: number | string;
    status: string;
    category: string;
    quality?: string | null;
    created_at: string;
    updated_at: string;
    created_by?: string | null;
  };
  const L = Number(blk.length_ft);
  const W = Number(blk.width_ft);
  const H = Number(blk.height_ft);

  // Daksh May 2026 — who entered the block (for "when was this
  // block added, by whom" production questions).
  let createdByName: string | null = null;
  if (blk.created_by) {
    const { data: who } = await admin
      .from("profiles")
      .select("full_name")
      .eq("id", blk.created_by)
      .maybeSingle();
    createdByName = (who as { full_name?: string } | null)?.full_name ?? null;
  }

  // Most recent cut session for this block.
  let cutting: BlockResult["cutting"] = null;
  const { data: csb } = await admin
    .from("cut_session_blocks")
    .select("id, status, needs_reprint, largest_remainder, cut_session_id, updated_at")
    .eq("block_id", blk.id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (csb) {
    const c = csb as {
      status: string;
      needs_reprint?: boolean;
      largest_remainder?: { l: number; w: number; h: number } | null;
      cut_session_id: string;
      updated_at: string;
    };
    const { data: sess } = await admin
      .from("cut_sessions")
      .select("session_code, planned_by")
      .eq("id", c.cut_session_id)
      .maybeSingle();
    const lr = c.largest_remainder;
    const s = sess as { session_code?: string; planned_by?: string | null } | null;
    let plannerName: string | null = null;
    if (s?.planned_by) {
      const { data: planner } = await admin
        .from("profiles")
        .select("full_name")
        .eq("id", s.planned_by)
        .maybeSingle();
      plannerName = (planner as { full_name?: string } | null)?.full_name ?? null;
    }
    cutting = {
      session_code: s?.session_code ?? "—",
      session_block_status: c.status,
      needs_reprint: Boolean(c.needs_reprint),
      largest_remainder_cft: lr ? toCft(lr.l, lr.w, lr.h) : null,
      cut_at: c.status === "done" ? c.updated_at : null,
      planner_name: plannerName,
    };
  }

  // Slabs derived from this block, grouped by status.
  const { data: slabs } = await admin
    .from("slab_requirements")
    .select("status")
    .eq("source_block_id", blk.id);
  const by_status: Record<string, number> = {};
  for (const s of slabs ?? []) {
    const st = (s as { status: string }).status;
    by_status[st] = (by_status[st] ?? 0) + 1;
  }

  // "Where is the block now": pre-cut → yard; mid-cut → on the
  // cutter; post-cut → not a single location any more (slabs
  // dispersed) but we still tell the user the block's last yard.
  let currentLocation: string;
  if (cutting?.session_block_status === "cutting") {
    currentLocation = `On the cutter · session ${cutting.session_code}`;
  } else if (cutting?.session_block_status === "done") {
    currentLocation = `Cut done — slabs dispersed (was Yard ${blk.yard})`;
  } else {
    currentLocation = `Yard ${blk.yard}`;
  }

  return {
    kind: "block",
    block: {
      id: blk.id,
      yard: blk.yard,
      stone: blk.stone,
      length_in: L,
      width_in: W,
      height_in: H,
      cft: toCft(L, W, H),
      status: blk.status,
      category: blk.category,
      quality: blk.quality ?? null,
      created_at: blk.created_at,
      updated_at: blk.updated_at,
      created_by_name: createdByName,
    },
    cutting,
    slabs_from_block: {
      total: slabs?.length ?? 0,
      by_status,
    },
    current_location: currentLocation,
  };
}
