import { revalidatePath } from "next/cache";
import { IsoBlockPreview } from "@/components/planning-workbench";
import { PrintButton } from "@/components/print-button";

import { requireAuth } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type SearchParams = Promise<{ show_closed?: string }>;

type SessionRow = {
  id: string;
  session_code: string;
  status: string;
  kerf_mm: number;
  created_at: string;
  cut_session_blocks: Array<{
    id: string;
    status: string;
    block_id: string;
    largest_remainder: { l: number; w: number; h: number } | null;
    restocked_block_id: string | null;
    updated_at: string | null;
    layout: {
      blk?: { id: string; stone: string; yard: number; l: number; w: number; h: number };
      placed?: Array<{
        id: string; sw: number; sh: number; sd?: number;
        pw?: number; ph?: number; px?: number; py?: number;
        aw?: number; ah?: number; rot: boolean;
        label?: string; temple?: string;
        zTop?: number; zBot?: number;
      }>;
    } | null;
    cut_session_slabs: Array<{
      id: string;
      slab_requirement_id: string;
    }>;
  }>;
};

async function refreshPaths() {
  revalidatePath("/cutting");
  revalidatePath("/blocks");
  revalidatePath("/slabs");
  revalidatePath("/dashboard");
}

async function syncSessionStatus(sessionId: string) {
  const supabase = await createServerSupabaseClient();
  const { data: blocks } = await supabase
    .from("cut_session_blocks")
    .select("status")
    .eq("cut_session_id", sessionId);

  const statuses = (blocks ?? []).map((item) => item.status);
  const allClosed = statuses.length > 0 && statuses.every((status) => status === "done" || status === "rejected");

  const nextStatus = allClosed ? "closed" : "in_progress";
  await supabase.from("cut_sessions").update({ status: nextStatus }).eq("id", sessionId);
}

async function approveBlockAction(formData: FormData) {
  "use server";
  await requireAuth(["owner", "worker"]);
  const supabase = await createServerSupabaseClient();
  const sessionBlockId = String(formData.get("session_block_id") || "");
  const sessionId = String(formData.get("session_id") || "");
  const { error } = await supabase.from("cut_session_blocks").update({ status: "cutting" }).eq("id", sessionBlockId);
  if (error) throw new Error(error.message);
  await supabase.from("cut_sessions").update({ status: "in_progress" }).eq("id", sessionId);
  await refreshPaths();
}

async function rejectBlockAction(formData: FormData) {
  "use server";
  const { profile } = await requireAuth(["owner", "worker"]);
  const supabase = await createServerSupabaseClient();
  const sessionBlockId = String(formData.get("session_block_id") || "");
  const sessionId = String(formData.get("session_id") || "");
  const blockId = String(formData.get("block_id") || "");
  const slabIds = JSON.parse(String(formData.get("slab_ids") || "[]")) as string[];

  await supabase.from("blocks")
    .update({ status: "available", updated_by: profile.id, updated_at: new Date().toISOString() })
    .eq("id", blockId);

  if (slabIds.length) {
    await supabase.from("slab_requirements")
      .update({ status: "open", source_block_id: null, updated_by: profile.id, updated_at: new Date().toISOString() })
      .in("id", slabIds);
  }

  await supabase.from("cut_session_blocks").update({ status: "rejected" }).eq("id", sessionBlockId);
  await syncSessionStatus(sessionId);
  await refreshPaths();
}

async function markDonePromptAction(formData: FormData) {
  "use server";
  await requireAuth(["owner", "worker"]);
  const supabase = await createServerSupabaseClient();
  const sessionBlockId = String(formData.get("session_block_id") || "");
  const { error } = await supabase.from("cut_session_blocks").update({ status: "done_prompt" }).eq("id", sessionBlockId);
  if (error) throw new Error(error.message);
  await refreshPaths();
}

async function finishBlockAction(formData: FormData) {
  "use server";
  const { profile } = await requireAuth(["owner", "worker"]);
  const supabase = await createServerSupabaseClient();

  const sessionBlockId = String(formData.get("session_block_id") || "");
  const sessionId = String(formData.get("session_id") || "");
  const blockId = String(formData.get("block_id") || "");
  const stone = String(formData.get("stone") || "PinkStone");
  const yard = Number(formData.get("yard") || 1);

  // Partial cutting: only checked checkboxes arrive in FormData
  const successSlabIds = formData.getAll("success_slab_ids").map(String);
  const allSlabIds = JSON.parse(String(formData.get("all_slab_ids") || "[]")) as string[];
  const failedSlabIds = allSlabIds.filter(id => !successSlabIds.includes(id));

  // Editable remainder block
  const remL = Number(formData.get("remainder_l") || 0);
  const remW = Number(formData.get("remainder_w") || 0);
  const remH = Number(formData.get("remainder_h") || 0);
  const hasRemainder = remL > 0 && remW > 0 && remH > 0;

  let restockedBlockId: string | null = null;
  if (hasRemainder) {
    restockedBlockId = `${blockId}-R-${Date.now().toString().slice(-5)}`;
    await supabase.from("blocks").insert({
      id: restockedBlockId, stone, yard, category: "Reused",
      length_ft: remL, width_ft: remW, height_ft: remH,
      status: "available", created_by: profile.id, updated_by: profile.id
    });
  }

  await supabase.from("blocks")
    .update({ status: "consumed", updated_by: profile.id, updated_at: new Date().toISOString() })
    .eq("id", blockId);

  if (successSlabIds.length) {
    await supabase.from("slab_requirements")
      .update({ status: "cut_done", updated_by: profile.id, updated_at: new Date().toISOString() })
      .in("id", successSlabIds);
  }

  if (failedSlabIds.length) {
    await supabase.from("slab_requirements")
      .update({ status: "open", source_block_id: null, updated_by: profile.id, updated_at: new Date().toISOString() })
      .in("id", failedSlabIds);
  }

  await supabase.from("cut_session_blocks")
    .update({
      status: "done",
      restocked_block_id: restockedBlockId,
      largest_remainder: hasRemainder ? { l: remL, w: remW, h: remH } : null
    })
    .eq("id", sessionBlockId);

  await syncSessionStatus(sessionId);
  await refreshPaths();
}

export default async function CuttingPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAuth(["owner", "worker"]);

  const params = await searchParams;
  const showClosed = params.show_closed === "1";

  const supabase = await createServerSupabaseClient();
  let query = supabase
    .from("cut_sessions")
    .select(
      "id, session_code, status, kerf_mm, created_at, cut_session_blocks(id, status, block_id, largest_remainder, restocked_block_id, layout, updated_at, cut_session_slabs(id, slab_requirement_id))"
    )
    .order("created_at", { ascending: false })
    .limit(20);

  if (!showClosed) {
    query = query.neq("status", "closed");
  }

  const { data: sessions } = await query;
  const rows = (sessions ?? []) as SessionRow[];

  function fmtDate(iso: string | null) {
    if (!iso) return null;
    return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  }

  return (
    <section className="page-card">
      <div className="record-head print-hide">
        <div>
          <h1>Cutting</h1>
          <p className="muted">Approve blocks, mark individual slabs cut or returned, add restocked remainder.</p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <a
            className={showClosed ? "secondary-button" : "ghost-button"}
            href={showClosed ? "/cutting" : "/cutting?show_closed=1"}
            style={{ textDecoration: "none", fontSize: 13 }}
          >
            {showClosed ? "Hide completed" : "Show completed"}
          </a>
          <PrintButton />
        </div>
      </div>

      <div className="records-stack" style={{ marginTop: 18 }}>
        {rows.length === 0 && (
          <div className="banner">No active cutting sessions. Generate and approve a plan first.</div>
        )}
        {rows.map((session) => (
          <article className="record-card" key={session.id}>
            <div className="record-head">
              <div>
                <strong>{session.session_code}</strong>
                <p className="muted">
                  {session.status} | Kerf {session.kerf_mm} mm | {new Date(session.created_at).toLocaleString()}
                </p>
              </div>
              <span className="role-pill">
                {session.cut_session_blocks.length} blocks /{" "}
                {session.cut_session_blocks.reduce((sum, b) => sum + b.cut_session_slabs.length, 0)} slabs
              </span>
            </div>

            <div className="records-stack">
              {session.cut_session_blocks.map((block) => {
                const slabIds = block.cut_session_slabs.map((s) => s.slab_requirement_id);
                const layout = block.layout || null;
                const remainder = block.largest_remainder || null;
                const placedSlabs = layout?.placed ?? [];

                return (
                  <div className="plan-card" key={block.id}>
                    <div className="record-head">
                      <div>
                        <strong>{block.block_id}</strong>
                        <p className="muted">
                          Status: <strong>{block.status}</strong>
                          {layout?.blk
                            ? ` | ${layout.blk.stone} | Yard ${layout.blk.yard} | ${layout.blk.l} × ${layout.blk.w} × ${layout.blk.h} in`
                            : ""}
                        </p>
                      </div>
                      <span className="role-pill">{slabIds.length} slabs</span>
                    </div>

                    {layout?.blk ? <IsoBlockPreview block={layout.blk as any} placed={placedSlabs as any} /> : null}

                    <div className="chip-row">
                      {placedSlabs.map((slab) => (
                        <span className="plan-chip" key={slab.id}>
                          {slab.id} {slab.rot ? "R" : ""} {slab.sw}×{slab.sh} in
                        </span>
                      ))}
                    </div>

                    {remainder ? (
                      <p className="muted" style={{ marginTop: 10 }}>
                        Suggested remainder {remainder.l} × {remainder.w} × {remainder.h} in
                      </p>
                    ) : null}

                    <div className="record-actions print-hide" style={{ marginTop: 14 }}>

                      {/* ── PENDING WORKER ── */}
                      {block.status === "pending_worker" ? (
                        <>
                          <form action={approveBlockAction}>
                            <input name="session_block_id" type="hidden" value={block.id} />
                            <input name="session_id" type="hidden" value={session.id} />
                            <button className="primary-button" type="submit">
                              Approve Block and Start Cutting
                            </button>
                          </form>
                          <form action={rejectBlockAction}>
                            <input name="session_block_id" type="hidden" value={block.id} />
                            <input name="session_id" type="hidden" value={session.id} />
                            <input name="block_id" type="hidden" value={block.block_id} />
                            <input name="slab_ids" type="hidden" value={JSON.stringify(slabIds)} />
                            <button className="ghost-button" type="submit">Reject</button>
                          </form>
                        </>
                      ) : null}

                      {/* ── CUTTING ── */}
                      {block.status === "cutting" ? (
                        <form action={markDonePromptAction}>
                          <input name="session_block_id" type="hidden" value={block.id} />
                          <button className="primary-button" type="submit">Mark as Done</button>
                        </form>
                      ) : null}

                      {/* ── DONE PROMPT: partial cut checklist + editable remainder ── */}
                      {block.status === "done_prompt" ? (
                        <form action={finishBlockAction} style={{ width: "100%" }}>
                          <input name="session_block_id" type="hidden" value={block.id} />
                          <input name="session_id" type="hidden" value={session.id} />
                          <input name="block_id" type="hidden" value={block.block_id} />
                          <input name="stone" type="hidden" value={layout?.blk?.stone ?? "PinkStone"} />
                          <input name="yard" type="hidden" value={String(layout?.blk?.yard ?? 1)} />
                          <input name="all_slab_ids" type="hidden" value={JSON.stringify(slabIds)} />

                          <p style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>✓ Which slabs were successfully cut?</p>
                          <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
                            Uncheck any slab that could NOT be cut (cracks, colour issues, etc.) — it returns to inventory as <strong>open</strong>.
                          </p>
                          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
                            {(placedSlabs.length > 0 ? placedSlabs : slabIds.map(id => ({ id, sw: 0, sh: 0, rot: false }))).map(slab => (
                              <label key={slab.id} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", padding: "6px 10px", borderRadius: 6, background: "var(--bg)", border: "1px solid var(--border-light)" }}>
                                <input
                                  type="checkbox"
                                  name="success_slab_ids"
                                  value={slab.id}
                                  defaultChecked
                                  style={{ width: 16, height: 16, accentColor: "var(--gold)", flexShrink: 0 }}
                                />
                                <span style={{ fontSize: 13 }}>
                                  <strong>{slab.id}</strong>
                                  {"label" in slab && (slab as any).label ? ` — ${(slab as any).label}` : ""}
                                  {slab.sw > 0 ? <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>{slab.sw}×{slab.sh} in</span> : null}
                                </span>
                              </label>
                            ))}
                          </div>

                          <p style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Remaining block dimensions</p>
                          <p className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                            Enter actual leftover size to auto-restock it. Set all to 0 if no usable piece remains.
                          </p>
                          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
                            <label className="stack" style={{ flex: "1 1 80px" }}>
                              <span>Length (in)</span>
                              <input name="remainder_l" type="number" min="0" step="0.5" defaultValue={String(remainder?.l ?? 0)} />
                            </label>
                            <label className="stack" style={{ flex: "1 1 80px" }}>
                              <span>Width (in)</span>
                              <input name="remainder_w" type="number" min="0" step="0.5" defaultValue={String(remainder?.w ?? 0)} />
                            </label>
                            <label className="stack" style={{ flex: "1 1 80px" }}>
                              <span>Height (in)</span>
                              <input name="remainder_h" type="number" min="0" step="0.5" defaultValue={String(remainder?.h ?? 0)} />
                            </label>
                          </div>

                          <button className="primary-button" type="submit">Finish Cutting and Save</button>
                        </form>
                      ) : null}

                      {/* ── DONE ── */}
                      {block.status === "done" ? (
                        <span className="role-pill">
                          Done{block.restocked_block_id ? ` · Restocked as ${block.restocked_block_id}` : " · No remainder"}
                          {block.updated_at ? ` · Cut ${fmtDate(block.updated_at)}` : ""}
                        </span>
                      ) : null}

                      {block.status === "rejected" ? (
                        <span className="role-pill">Rejected — block and slabs returned to inventory</span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
