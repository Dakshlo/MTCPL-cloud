// ──────────────────────────────────────────────────────────────────
// /api/parkota/state — live shared state for the Parkota Pillar Tracker
// ──────────────────────────────────────────────────────────────────
// Mig 207. The tracker (public/parkota-tracker.html, served at /parkota) used
// to persist to localStorage, so every device had a private copy. This endpoint
// is what makes it a real shared board.
//
// The state is one JSON document: { v, nid, pts[], elems, linear, stock }.
// `pts` is the 645-pillar array, keyed by a stable numeric `id`.
//
// WHY A PATCH PROTOCOL, NOT A BLOB PUT
// Two people marking different pillars at the same time must not overwrite each
// other. The client diffs its state against the last copy it knows the server
// had and sends only what changed; we merge those pillars into whatever the row
// holds *now*. So concurrent edits to different pillars both survive — only two
// people editing the *same* pillar within the same save window resolve
// last-writer-wins, which is the correct and unavoidable outcome there.
//
// `rev` is a simple counter. The client sends the rev it was working from; if it
// was behind, we hand back the fully merged state so it can catch up in place.
//
// Access: owner / senior_incharge / carving_head / developer (see
// src/lib/parkota-access.ts). Enforced here on every read and write — the static
// shell is gated separately in middleware.ts, but THIS is the gate that matters,
// because this is where the data lives.

import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canUseParkota } from "@/lib/parkota-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ROW_ID = "main";
const SNAPSHOT_EVERY_MS = 30 * 60 * 1000;

type Pillar = { id: number; [k: string]: unknown };
type State = {
  v?: number;
  nid?: number;
  pts?: Pillar[];
  elems?: unknown;
  linear?: unknown;
  stock?: unknown;
  updated?: string | null;
};
type Patch = {
  pts?: Pillar[];
  removedPts?: number[];
  elems?: unknown;
  linear?: unknown;
  stock?: unknown;
  nid?: number;
  v?: number;
};

async function gate() {
  const { user, profile } = await getAuthContext();
  if (!user || !profile) return { error: NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 }) };
  if (!profile.is_active) return { error: NextResponse.json({ ok: false, error: "inactive" }, { status: 403 }) };
  if (!canUseParkota(profile)) return { error: NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 }) };
  return { profile };
}

/**
 * Turn a thrown DB error into a response. The one case worth naming explicitly
 * is "table isn't there yet" — otherwise the tracker just says it can't reach
 * the server, which sends people hunting a network problem that doesn't exist.
 */
function failure(e: unknown) {
  const msg = (e as Error)?.message ?? "unknown error";
  if (/does not exist|schema cache/i.test(msg)) {
    return NextResponse.json(
      { ok: false, error: "The Parkota tables are not set up yet — run migration 207 in Supabase, then reload." },
      { status: 503 },
    );
  }
  return NextResponse.json({ ok: false, error: msg }, { status: 500 });
}

type Row = { state: State | null; rev: number | string; updated_at: string | null; updated_by: string | null };

async function readRow(admin: ReturnType<typeof createAdminSupabaseClient>) {
  const { data, error } = await admin
    .from("parkota_state")
    .select("state, rev, updated_at, updated_by")
    .eq("id", ROW_ID)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? null) as Row | null;
}

/** Resolve the display name for "last saved by" — best-effort, never fatal. */
async function nameOf(admin: ReturnType<typeof createAdminSupabaseClient>, id: string | null) {
  if (!id) return null;
  const { data } = await admin.from("profiles").select("full_name").eq("id", id).maybeSingle();
  return ((data as { full_name?: string } | null)?.full_name ?? null) || null;
}

export async function GET(request: NextRequest) {
  const g = await gate();
  if (g.error) return g.error;

  try {
    const admin = createAdminSupabaseClient();
    const row = await readRow(admin);
    const rev = Number(row?.rev ?? 0);
    const known = Number(request.nextUrl.searchParams.get("rev") ?? "-1");

    // Poll fast-path: nothing changed since the client last looked, so skip
    // shipping the whole document back.
    if (known >= 0 && known === rev) {
      return NextResponse.json({ ok: true, rev, unchanged: true });
    }

    return NextResponse.json({
      ok: true,
      rev,
      state: row?.state ?? {},
      updatedAt: row?.updated_at ?? null,
      updatedBy: await nameOf(admin, row?.updated_by ?? null),
    });
  } catch (e) {
    return failure(e);
  }
}

export async function PATCH(request: NextRequest) {
  const g = await gate();
  if (g.error) return g.error;
  const profile = g.profile!;

  let body: { baseRev?: number; patch?: Patch };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }

  const patch = body.patch ?? {};
  const baseRev = Number(body.baseRev ?? -1);

  try {
    const admin = createAdminSupabaseClient();

    // Compare-and-set on `rev`. If another save landed between our read and our
    // write, the update matches nothing and we retry against the new state —
    // which is safe precisely because the write is a merge, not a replace.
    for (let attempt = 0; attempt < 4; attempt++) {
      const row = await readRow(admin);
      const curRev = Number(row?.rev ?? 0);
      const cur: State = (row?.state ?? {}) as State;

      const byId = new Map<number, Pillar>();
      for (const p of Array.isArray(cur.pts) ? cur.pts : []) byId.set(Number(p.id), p);
      for (const p of Array.isArray(patch.pts) ? patch.pts : []) {
        if (p && Number.isFinite(Number(p.id))) byId.set(Number(p.id), p);
      }
      for (const id of Array.isArray(patch.removedPts) ? patch.removedPts : []) byId.delete(Number(id));

      const pts = [...byId.values()].sort((a, b) => Number(a.id) - Number(b.id));
      const maxId = pts.reduce((m, p) => Math.max(m, Number(p.id)), -1);

      const merged: State = {
        ...cur,
        v: patch.v ?? cur.v ?? 6,
        pts,
        nid: Math.max(Number(cur.nid) || 0, Number(patch.nid) || 0, maxId + 1),
        updated: new Date().toISOString(),
      };
      if (patch.elems !== undefined) merged.elems = patch.elems;
      if (patch.linear !== undefined) merged.linear = patch.linear;
      if (patch.stock !== undefined) merged.stock = patch.stock;

      // Bounded-growth safety net: keep a full copy at most every 30 minutes so
      // a bad bulk edit is recoverable.
      if (Array.isArray(cur.pts) && cur.pts.length) {
        const { data: last } = await admin
          .from("parkota_snapshots")
          .select("created_at")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const lastAt = (last as { created_at?: string } | null)?.created_at;
        if (!lastAt || Date.now() - new Date(lastAt).getTime() > SNAPSHOT_EVERY_MS) {
          await admin.from("parkota_snapshots").insert({ state: cur, rev: curRev, created_by: profile.id });
        }
      }

      const nextRev = curRev + 1;
      const { data: updated, error } = await admin
        .from("parkota_state")
        .update({ state: merged, rev: nextRev, updated_at: new Date().toISOString(), updated_by: profile.id })
        .eq("id", ROW_ID)
        .eq("rev", curRev)
        .select("rev")
        .maybeSingle();

      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      if (!updated) continue; // someone else won the race — re-read and re-merge

      return NextResponse.json({
        ok: true,
        rev: nextRev,
        // The caller was behind, so it needs the merged document to catch up.
        // If it was current, its own state already equals `merged`.
        state: baseRev === curRev ? undefined : merged,
        updatedAt: new Date().toISOString(),
        updatedBy: profile.full_name ?? null,
      });
    }

    return NextResponse.json({ ok: false, error: "write contention" }, { status: 409 });
  } catch (e) {
    return failure(e);
  }
}
