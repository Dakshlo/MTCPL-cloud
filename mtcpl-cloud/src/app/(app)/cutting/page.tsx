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
    layout: {
      blk?: { id: string; stone: string; yard: number; l: number; w: number; h: number };
      placed?: Array<{ id: string; sw: number; sh: number; pw?: number; ph?: number; px?: number; py?: number; aw?: number; ah?: number; rot: boolean; label?: string; temple?: string; sd?: number }>;
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

  const blockUpdate = await supabase
    .from("blocks")
    .update({
      status: "available",
      updated_by: profile.id,
      updated_at: new Date().toISOString()
    })
    .eq("id", blockId);
  if (blockUpdate.error) throw new Error(blockUpdate.error.message);

  if (slabIds.length) {
    const slabReset = await supabase
      .from("slab_requirements")
      .update({
        status: "open",
        source_block_id: null,
        updated_by: profile.id,
        updated_at: new Date().toISOString()
      })
      .in("id", slabIds);
    if (slabReset.error) throw new Error(slabReset.error.message);
  }

  const sessionBlockUpdate = await supabase
    .from("cut_session_blocks")
    .update({ status: "rejected" })
    .eq("id", sessionBlockId);
  if (sessionBlockUpdate.error) throw new Error(sessionBlockUpdate.error.message);

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
  const slabIds = JSON.parse(String(formData.get("slab_ids") || "[]")) as string[];
  const restock = String(formData.get("restock") || "") === "yes";
  const remainder = JSON.parse(String(formData.get("largest_remainder") || "null")) as
    | { l: number; w: number; h: number }
    | null;

  let restockedBlockId: string | null = null;

  if (restock && remainder && remainder.l > 0 && remainder.w > 0 && remainder.h > 0) {
    restockedBlockId = `${blockId}-R-${Date.now().toString().slice(-5)}`;
    const insertRemainder = await supabase.from("blocks").insert({
      id: restockedBlockId,
      stone,
      yard,
      category: "Reused",
      length_ft: remainder.l,
      width_ft: remainder.w,
      height_ft: remainder.h,
      status: "available",
      created_by: profile.id,
      updated_by: profile.id
    });
    if (insertRemainder.error) throw new Error(insertRemainder.error.message);
  }

  const blockConsumed = await supabase
    .from("blocks")
    .update({
      status: "consumed",
      updated_by: profile.id,
      updated_at: new Date().toISOString()
    })
    .eq("id", blockId);
  if (blockConsumed.error) throw new Error(blockConsumed.error.message);

  if (slabIds.length) {
    const slabDone = await supabase
      .from("slab_requirements")
      .update({
        status: "cut_done",
        updated_by: profile.id,
        updated_at: new Date().toISOString()
      })
      .in("id", slabIds);
    if (slabDone.error) throw new Error(slabDone.error.message);
  }

  const sessionBlockDone = await supabase
    .from("cut_session_blocks")
    .update({
      status: "done",
      restocked_block_id: restockedBlockId
    })
    .eq("id", sessionBlockId);
  if (sessionBlockDone.error) throw new Error(sessionBlockDone.error.message);

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
      "id, session_code, status, kerf_mm, created_at, cut_session_blocks(id, status, block_id, largest_remainder, restocked_block_id, layout, cut_session_slabs(id, slab_requirement_id))"
    )
    .order("created_at", { ascending: false })
    .limit(20);

  if (!showClosed) {
    query = query.neq("status", "closed");
  }

  const { data: sessions } = await query;
  const rows = (sessions ?? []) as SessionRow[];

  return (
    <section className="page-card">
      <div className="record-head print-hide">
        <div>
          <h1>Cutting</h1>
          <p className="muted">Workers can now approve blocks, reject them, mark cutting in progress, and finish with optional restock.</p>
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
                {session.cut_session_blocks.reduce((sum, block) => sum + block.cut_session_slabs.length, 0)} slabs
              </span>
            </div>

            <div className="records-stack">
              {session.cut_session_blocks.map((block) => {
                const slabIds = block.cut_session_slabs.map((slab) => slab.slab_requirement_id);
                const layout = block.layout || null;
                const remainder = block.largest_remainder || null;

                return (
                  <div className="plan-card" key={block.id}>
                    <div className="record-head">
                      <div>
                        <strong>{block.block_id}</strong>
                        <p className="muted">
                          Status {block.status}
                          {layout?.blk
                            ? ` | ${layout.blk.stone} | Yard ${layout.blk.yard} | ${layout.blk.l} x ${layout.blk.w} x ${layout.blk.h} ft`
                            : ""}
                        </p>
                      </div>
                      <span className="role-pill">{slabIds.length} slabs</span>
                    </div>

                    {layout?.blk ? <IsoBlockPreview block={layout.blk as any} placed={(layout.placed ?? []) as any} /> : null}

                    <div className="chip-row">
                      {(layout?.placed ?? []).map((slab) => (
                        <span className="plan-chip" key={slab.id}>
                          {slab.id} {slab.rot ? "R" : ""} {slab.sw}x{slab.sh} ft
                        </span>
                      ))}
                    </div>

                    {remainder ? (
                      <p className="muted" style={{ marginTop: 12 }}>
                        Largest remainder {remainder.l} x {remainder.w} x {remainder.h} ft
                      </p>
                    ) : null}

                    <div className="record-actions print-hide" style={{ marginTop: 14 }}>
                      {block.status === "pending_worker" ? (
                        <>
                          <form action={approveBlockAction}>
                            <input name="session_block_id" type="hidden" value={block.id} />
                            <input name="session_id" type="hidden" value={session.id} />
                            <button className="primary-button" type="submit">
                              Approve Block
                            </button>
                          </form>

                          <form action={rejectBlockAction}>
                            <input name="session_block_id" type="hidden" value={block.id} />
                            <input name="session_id" type="hidden" value={session.id} />
                            <input name="block_id" type="hidden" value={block.block_id} />
                            <input name="slab_ids" type="hidden" value={JSON.stringify(slabIds)} />
                            <button className="ghost-button" type="submit">
                              Reject
                            </button>
                          </form>
                        </>
                      ) : null}

                      {block.status === "cutting" ? (
                        <form action={markDonePromptAction}>
                          <input name="session_block_id" type="hidden" value={block.id} />
                          <button className="primary-button" type="submit">
                            Mark as Done
                          </button>
                        </form>
                      ) : null}

                      {block.status === "done_prompt" ? (
                        <>
                          <form action={finishBlockAction}>
                            <input name="session_block_id" type="hidden" value={block.id} />
                            <input name="session_id" type="hidden" value={session.id} />
                            <input name="block_id" type="hidden" value={block.block_id} />
                            <input name="stone" type="hidden" value={layout?.blk?.stone ?? "PinkStone"} />
                            <input name="yard" type="hidden" value={String(layout?.blk?.yard ?? 1)} />
                            <input name="slab_ids" type="hidden" value={JSON.stringify(slabIds)} />
                            <input name="largest_remainder" type="hidden" value={JSON.stringify(remainder)} />
                            <input name="restock" type="hidden" value="yes" />
                            <button className="primary-button" type="submit">
                              Done and Restock
                            </button>
                          </form>

                          <form action={finishBlockAction}>
                            <input name="session_block_id" type="hidden" value={block.id} />
                            <input name="session_id" type="hidden" value={session.id} />
                            <input name="block_id" type="hidden" value={block.block_id} />
                            <input name="stone" type="hidden" value={layout?.blk?.stone ?? "PinkStone"} />
                            <input name="yard" type="hidden" value={String(layout?.blk?.yard ?? 1)} />
                            <input name="slab_ids" type="hidden" value={JSON.stringify(slabIds)} />
                            <input name="largest_remainder" type="hidden" value={JSON.stringify(remainder)} />
                            <input name="restock" type="hidden" value="no" />
                            <button className="secondary-button" type="submit">
                              Done and Discard
                            </button>
                          </form>
                        </>
                      ) : null}

                      {block.status === "done" ? (
                        <span className="role-pill">
                          Done {block.restocked_block_id ? `| Restocked ${block.restocked_block_id}` : "| Discarded"}
                        </span>
                      ) : null}

                      {block.status === "rejected" ? <span className="role-pill">Rejected and returned</span> : null}
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
