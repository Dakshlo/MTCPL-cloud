"use server";

// Mig 124 — temple component reference images. Upload a photo against a
// temple component node (temple → Category 1 → optional Category 2) and
// delete it. Public bucket; the page renders thumbnails on matching nodes.

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import type { AppRole } from "@/lib/types";

const WRITE_ROLES: AppRole[] = ["owner", "developer", "team_head", "senior_incharge", "carving_head"];
// Daksh — renaming a whole category (a tree-head node) is a heavier edit, so
// it's limited to owner / developer / carving head / slab incharge (senior).
const CAT_EDIT_ROLES: AppRole[] = ["owner", "developer", "carving_head", "senior_incharge"];
const BUCKET = "temple_component_images";
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB
const IMG_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"]);

function ext(mime: string): string {
  return mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : mime === "image/gif" ? "gif" : "jpg";
}

export async function addTempleComponentImageAction(
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { profile } = await requireAuth(WRITE_ROLES);
  const admin = createAdminSupabaseClient();

  // Two callers:
  //  · legacy Add-image button → temple + section (+ optional element).
  //  · card-browser node uploader (mig 128) → node_path (the full tree path,
  //    any level) + node_label. We derive section/element from the path so
  //    the NOT NULL columns stay valid, and store node_path for keying.
  const rawNodePath = String(formData.get("node_path") || "").trim();
  let temple = String(formData.get("temple") || "").trim();
  let section = String(formData.get("section") || "").trim();
  let element = String(formData.get("element") || "").trim() || null;
  const nodeLabel = String(formData.get("node_label") || "").trim() || null;
  const caption = String(formData.get("caption") || "").trim() || null;

  let nodePath: string;
  if (rawNodePath) {
    const segs = rawNodePath.split("/").map((s) => s.trim()).filter(Boolean);
    if (segs.length < 1) return { ok: false, error: "Bad node path." };
    if (!temple) temple = segs[0];
    section = segs[1] ?? "(temple)";
    element = segs[2] ?? null;
    nodePath = rawNodePath;
  } else {
    if (!temple) return { ok: false, error: "Pick a temple." };
    if (!section) return { ok: false, error: "Pick a Category 1." };
    nodePath = element ? `${temple}/${section}/${element}` : `${temple}/${section}`;
  }

  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose an image to upload." };
  if (file.size > MAX_BYTES) return { ok: false, error: "Image too large — max 8 MB." };
  const mime = (file.type || "").toLowerCase();
  if (!IMG_TYPES.has(mime)) return { ok: false, error: "Use a JPG, PNG, WEBP, GIF or HEIC image." };

  const id = randomUUID();
  const path = `${temple.replace(/[^a-zA-Z0-9]+/g, "_")}/${id}.${ext(mime)}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: upErr } = await admin.storage.from(BUCKET).upload(path, buffer, { contentType: mime, upsert: false });
  if (upErr) return { ok: false, error: `Upload failed: ${upErr.message}` };

  const { error } = await admin.from("temple_component_images").insert({
    id, temple, section, element, node_path: nodePath, label: nodeLabel,
    image_path: path, caption, uploaded_by: profile.id,
  });
  if (error) {
    await admin.storage.from(BUCKET).remove([path]).catch(() => {});
    return { ok: false, error: error.message };
  }
  await logAudit(profile.id, "temple_image_added", "temple_component_image", id, { temple, node_path: nodePath });
  revalidatePath("/temples");
  return { ok: true };
}

// Mig 128 — re-categorize slabs from the card browser. Moves one OR many
// slabs (multi-select) from the SAME leaf to a new spot in Temple View
// (Category 1 / 2 / Label / Description / Additional) without touching size,
// stone, status or code. Cat 1/2 + Label are stored UPPERCASE (same as
// import); Description / Additional keep their case.
export async function moveSlabsComponentAction(
  formData: FormData,
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const { profile } = await requireAuth(WRITE_ROLES);
  const admin = createAdminSupabaseClient();

  let ids: string[] = [];
  try { ids = JSON.parse(String(formData.get("slab_ids") || "[]")); } catch { ids = []; }
  ids = (Array.isArray(ids) ? ids : []).filter(Boolean);
  if (ids.length === 0) return { ok: false, error: "No slabs selected." };

  const up = (k: string) => String(formData.get(k) || "").trim().toUpperCase();
  const asis = (k: string) => String(formData.get(k) || "").trim();
  const section = up("section");
  const element = up("element");
  const label = up("label");
  const description = asis("description");
  const additional = asis("additional");
  if (!label) return { ok: false, error: "Label can't be empty." };

  const { data: updated, error } = await admin
    .from("slab_requirements")
    .update({
      component_section: section || null,
      component_element: element || null,
      label,
      description: description || null,
      additional_description: additional || null,
      updated_by: profile.id,
      updated_at: new Date().toISOString(),
    })
    .in("id", ids)
    .select("id");
  if (error) return { ok: false, error: error.message };
  const count = (updated ?? []).length;

  await logAudit(profile.id, "slabs_recategorized", "slab", "batch", {
    count, slab_ids: ids, to: { component_section: section || null, component_element: element || null, label },
  });
  revalidatePath("/temples");
  revalidatePath("/slabs");
  return { ok: true, count };
}

// Mig 139 — save a free-text remark on a single slab, edited inline from the
// Temple View table. Read-only everywhere else; this is the one writable
// column in the table. Mirrors moveSlabsComponentAction's single-table update.
export async function saveSlabRemarkAction(
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { profile } = await requireAuth(WRITE_ROLES);
  const admin = createAdminSupabaseClient();

  const id = String(formData.get("slab_id") || "").trim();
  if (!id) return { ok: false, error: "Missing slab id." };
  const remark = String(formData.get("remark") || "").trim();

  const { data: updated, error } = await admin
    .from("slab_requirements")
    .update({
      remark: remark || null,
      updated_by: profile.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!updated) return { ok: false, error: "Slab not found." };

  await logAudit(profile.id, "slab_remark_saved", "slab", id, { remark: remark || null });
  revalidatePath("/temples");
  revalidatePath("/slabs");
  return { ok: true };
}

// Mig 128 follow-on — RENAME a whole tree-head node. Daksh: from the card
// browser you can rename a Category 1 / Category 2 / Label / Description group
// in one go (and renaming it to an EXISTING sibling merges them). We rebuild
// each slab's path EXACTLY like the Temple View tree does, so the segment at
// the node's depth maps back to the right DB field — even when Category 1 is
// a '›'-nested path or the element/description levels are absent.
function decomposePath(s: {
  component_section: string | null; component_element: string | null;
  label: string | null; description: string | null; additional_description: string | null;
}) {
  const sectionRaw = (s.component_section ?? "").trim();
  const element = (s.component_element ?? "").trim();
  const label = (s.label ?? "").trim();
  const description = (s.description ?? "").trim();
  const additional = (s.additional_description ?? "").trim();
  const cat1Levels = sectionRaw
    ? sectionRaw.split(/\s*[›>]\s*/).map((x) => x.trim()).filter(Boolean)
    : ["Unassigned"];
  const segs = [
    ...cat1Levels,
    ...(element ? [element] : []),
    label || "— (no label)",
    ...(description ? [description] : []),
    ...(additional ? [additional] : []),
  ];
  return { cat1Levels, element, description, additional, segs };
}

export async function renameTempleNodeAction(
  formData: FormData,
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const { profile } = await requireAuth(CAT_EDIT_ROLES);
  const admin = createAdminSupabaseClient();

  const temple = String(formData.get("temple") || "").trim();
  let segments: string[] = [];
  try { segments = JSON.parse(String(formData.get("segments") || "[]")); } catch { segments = []; }
  segments = (Array.isArray(segments) ? segments : []).map((x) => String(x));
  const rawNew = String(formData.get("new_name") || "").trim();
  if (!temple || segments.length === 0) return { ok: false, error: "Bad request." };
  if (!rawNew) return { ok: false, error: "Name can't be empty." };
  const depth = segments.length - 1; // 0-indexed position of the segment to rename

  // Pull this temple's slabs (everything the tree shows — i.e. not rejected).
  type Row = {
    id: string; component_section: string | null; component_element: string | null;
    label: string | null; description: string | null; additional_description: string | null;
  };
  const rows: Row[] = [];
  const PAGE = 1000;
  for (let off = 0; off < 30000; off += PAGE) {
    const { data, error } = await admin
      .from("slab_requirements")
      .select("id, component_section, component_element, label, description, additional_description")
      .eq("temple", temple)
      .neq("status", "rejected")
      .range(off, off + PAGE - 1);
    if (error) return { ok: false, error: error.message };
    if (!data || data.length === 0) break;
    rows.push(...(data as Row[]));
    if (data.length < PAGE) break;
  }

  const SEP = " › ";
  // Group identical resulting patches so we issue one UPDATE per distinct value
  // (label/element renames collapse to a single value; section renames vary by
  // the slab's deeper levels, so they group naturally too).
  const groups = new Map<string, string[]>();
  let renamedKind = "";
  for (const s of rows) {
    const p = decomposePath(s);
    if (p.segs.length <= depth) continue;
    let match = true;
    for (let i = 0; i <= depth; i++) { if (p.segs[i] !== segments[i]) { match = false; break; } }
    if (!match) continue;

    const C = p.cat1Levels.length;
    const elementIdx = p.element ? C : -1;
    const labelIdx = C + (p.element ? 1 : 0);
    const descIdx = p.description ? labelIdx + 1 : -1;
    const addIdx = p.additional ? labelIdx + 1 + (p.description ? 1 : 0) : -1;

    let kind = "";
    let set: Record<string, string | null> = {};
    if (depth < C) {
      kind = "section";
      const lv = [...p.cat1Levels];
      lv[depth] = rawNew.toUpperCase();
      set = { component_section: lv.join(SEP) };
    } else if (depth === elementIdx) {
      kind = "element"; set = { component_element: rawNew.toUpperCase() };
    } else if (depth === labelIdx) {
      kind = "label"; set = { label: rawNew.toUpperCase() };
    } else if (depth === descIdx) {
      kind = "description"; set = { description: rawNew };
    } else if (depth === addIdx) {
      kind = "additional"; set = { additional_description: rawNew };
    } else {
      continue;
    }
    renamedKind = kind;
    const key = JSON.stringify(set);
    const arr = groups.get(key);
    if (arr) arr.push(s.id); else groups.set(key, [s.id]);
  }

  if (groups.size === 0) return { ok: false, error: "No slabs found under this category." };

  let count = 0;
  const nowIso = new Date().toISOString();
  for (const [key, ids] of groups) {
    const set = { ...(JSON.parse(key) as Record<string, string | null>), updated_by: profile.id, updated_at: nowIso };
    const { data, error } = await admin.from("slab_requirements").update(set).in("id", ids).select("id");
    if (error) return { ok: false, error: error.message };
    count += (data ?? []).length;
  }

  await logAudit(profile.id, "temple_node_renamed", "slab", "batch", {
    temple, from: segments[depth], to: rawNew, kind: renamedKind, depth, count,
  });
  revalidatePath("/temples");
  revalidatePath("/slabs");
  return { ok: true, count };
}

// Redirect-style (returns void) so it can be used directly as a <form action>.
export async function deleteTempleComponentImageAction(formData: FormData): Promise<void> {
  const { profile } = await requireAuth(WRITE_ROLES);
  const admin = createAdminSupabaseClient();
  const id = String(formData.get("id") || "").trim();
  if (!id) return;

  const { data } = await admin.from("temple_component_images").select("image_path").eq("id", id).maybeSingle();
  const path = (data as { image_path?: string } | null)?.image_path;
  await admin.from("temple_component_images").delete().eq("id", id);
  if (path) await admin.storage.from(BUCKET).remove([path]).catch(() => {});
  await logAudit(profile.id, "temple_image_deleted", "temple_component_image", id, {});
  revalidatePath("/temples");
}
