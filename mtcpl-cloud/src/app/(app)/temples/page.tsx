// Mig 123 — Temple View. Pick a temple and browse its slabs organised by
// component: Section (location path, '›'-nested) → Element (part type),
// each with a stage progress bar (pending / cutting / carving / done /
// rejected) and counts. Click a leaf to see the actual slabs. Read-only;
// older slabs with no category sit under "Unassigned" — never lost.

import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canReadRequiredSizes } from "@/lib/cutting-permissions";
import { TempleViewClient, type TempleTree, type StageBucket, type ComponentImage } from "./temple-view-client";
import { AddTempleImageButton } from "./add-image-button";

export const dynamic = "force-dynamic";

const IMAGE_WRITE_ROLES = ["owner", "developer", "team_head", "senior_incharge"];

type SlabRow = {
  id: string; label: string | null; description: string | null; temple: string; status: string;
  component_section: string | null; component_element: string | null;
  additional_description: string | null;
  stone: string | null; quality: string | null;
  length_ft: number | null; width_ft: number | null; thickness_ft: number | null;
  priority: boolean | null;
};

export type TempleSlabCard = {
  id: string; status: string; stone: string | null; quality: string | null;
  l: number; w: number; t: number; priority: boolean;
  // Mig 128 — raw component-path fields for the "move slab" modal.
  section: string; element: string; label: string; description: string; additional: string;
};

const SLAB_LIMIT = 30000;

function stageBucket(status: string): StageBucket {
  if (status === "open" || status === "planned") return "pending";
  if (status === "cutting") return "cutting";
  if (status === "cut_done") return "cut_done"; // cut, ready to assign to carving
  if (status === "carving_assigned" || status === "carving_in_progress") return "carving";
  if (status === "completed" || status === "dispatched") return "done";
  if (status === "rejected") return "rejected";
  return "pending";
}

const EMPTY_COUNTS = (): Record<StageBucket, number> => ({ pending: 0, cutting: 0, cut_done: 0, carving: 0, done: 0, rejected: 0 });

// Mutable tree used while building; converted to the serializable shape below.
type BuildNode = {
  name: string;
  children: Map<string, BuildNode>;
  slabs: TempleSlabCard[];
};

function newNode(name: string): BuildNode {
  return { name, children: new Map(), slabs: [] };
}

// Roll a BuildNode (and its subtree) into a serializable TempleTree node,
// summing per-stage counts up from the leaves.
function rollup(node: BuildNode, path: string): { node: TempleTreeNode; counts: Record<StageBucket, number> } {
  const counts = EMPTY_COUNTS();
  for (const s of node.slabs) counts[stageBucket(s.status)] += 1;
  const children: TempleTreeNode[] = [];
  for (const [, child] of [...node.children.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))) {
    const r = rollup(child, `${path}/${child.name}`);
    children.push(r.node);
    for (const k of Object.keys(counts) as StageBucket[]) counts[k] += r.counts[k];
  }
  const total = (Object.values(counts) as number[]).reduce((s, n) => s + n, 0);
  const slabs = node.slabs
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  return {
    node: {
      id: path,
      name: node.name,
      total,
      counts,
      children,
      // Only leaves carry the slab list (children.length === 0).
      slabs: children.length === 0 ? slabs : [],
    },
    counts,
  };
}

type TempleTreeNode = TempleTree["roots"][number];

export default async function TemplesPage() {
  const { profile } = await requireAuth();
  if (!canReadRequiredSizes(profile)) redirect("/");
  const canWriteImages = IMAGE_WRITE_ROLES.includes(profile.role);
  const admin = createAdminSupabaseClient();

  // Paginated fetch of every slab (all statuses) — mirrors the slabs page
  // pagination so nothing falls off the PostgREST 1000-row cap.
  async function fetchAll(): Promise<SlabRow[]> {
    const PAGE = 1000;
    const all: SlabRow[] = [];
    for (let offset = 0; offset < SLAB_LIMIT; offset += PAGE) {
      const { data, error } = await admin
        .from("slab_requirements")
        .select("id, label, description, temple, status, component_section, component_element, additional_description, stone, quality, length_ft, width_ft, thickness_ft, priority")
        .order("temple", { ascending: true })
        .range(offset, offset + PAGE - 1);
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) break;
      all.push(...(data as SlabRow[]));
      if (data.length < PAGE) break;
    }
    return all;
  }

  const slabs = await fetchAll();

  // Group by temple → build a Section(›-nested) → Element tree.
  const byTemple = new Map<string, BuildNode>();
  for (const s of slabs) {
    // Daksh — rejected slabs are excluded from Temple View entirely
    // (they were confusing). They stay in the DB, just not shown here.
    if (s.status === "rejected") continue;
    const temple = (s.temple || "—").trim();
    let root = byTemple.get(temple);
    if (!root) { root = newNode(temple); byTemple.set(temple, root); }

    // Category 1 (section) › Category 2 (element) › Label › Description.
    // section may carry a legacy '›'-path from older AI runs — split it.
    const sectionRaw = (s.component_section ?? "").trim();
    const element = (s.component_element ?? "").trim();
    const label = (s.label ?? "").trim();
    const description = (s.description ?? "").trim();
    // Mig 128 — Additional Description adds a further folder level UNDER
    // Description, but ONLY when it has a value (empty = no extra level).
    const additional = (s.additional_description ?? "").trim();
    const cat1Levels = sectionRaw
      ? sectionRaw.split(/\s*[›>]\s*/).map((x) => x.trim()).filter(Boolean)
      : ["Unassigned"];
    const path = [
      ...cat1Levels,
      ...(element ? [element] : []),
      label || "— (no label)",
      ...(description ? [description] : []),
      ...(additional ? [additional] : []),
    ];

    let cur = root;
    for (const part of path) {
      let next = cur.children.get(part);
      if (!next) { next = newNode(part); cur.children.set(part, next); }
      cur = next;
    }
    cur.slabs.push({
      id: s.id,
      status: s.status,
      stone: s.stone,
      quality: s.quality,
      l: Number(s.length_ft) || 0,
      w: Number(s.width_ft) || 0,
      t: Number(s.thickness_ft) || 0,
      priority: s.priority === true,
      section: sectionRaw,
      element,
      label,
      description,
      additional,
    });
  }

  const trees: TempleTree[] = [...byTemple.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([temple, root]) => {
      const roots = [...root.children.entries()]
        .sort((a, b) => {
          // Push "Unassigned" to the bottom; everything else alphabetical/numeric.
          if (a[0] === "Unassigned") return 1;
          if (b[0] === "Unassigned") return -1;
          return a[0].localeCompare(b[0], undefined, { numeric: true });
        })
        .map(([, child]) => rollup(child, `${temple}/${child.name}`).node);
      const counts = EMPTY_COUNTS();
      for (const r of roots) for (const k of Object.keys(counts) as StageBucket[]) counts[k] += r.counts[k];
      const total = (Object.values(counts) as number[]).reduce((s, n) => s + n, 0);
      return { temple, total, counts, roots };
    })
    .filter((t) => t.total > 0);

  // Per-temple Category 1 → Category 2[] structure, for the Add-image picker.
  const categoryStruct: Record<string, Record<string, string[]>> = {};
  for (const t of trees) {
    const byCat1: Record<string, string[]> = {};
    for (const c1 of t.roots) {
      if (c1.name === "Unassigned") continue;
      byCat1[c1.name] = c1.children.map((c2) => c2.name).filter((n) => !n.startsWith("—"));
    }
    categoryStruct[t.temple] = byCat1;
  }

  // Reference images (mig 124 + 128) → map each to its tree node by the full
  // node path (any level). Older rows without node_path fall back to the
  // legacy temple/section[/element] key (back-filled by mig 128 anyway).
  const { data: imgRows } = await admin
    .from("temple_component_images")
    .select("id, temple, section, element, node_path, caption, image_path")
    .order("created_at", { ascending: true });
  const pub = (p: string) => admin.storage.from("temple_component_images").getPublicUrl(p).data.publicUrl;
  const imagesByNode: Record<string, ComponentImage[]> = {};
  for (const r of (imgRows ?? []) as Array<{ id: string; temple: string; section: string; element: string | null; node_path: string | null; caption: string | null; image_path: string }>) {
    const nodeId = (r.node_path && r.node_path.trim())
      ? r.node_path.trim()
      : r.element ? `${r.temple}/${r.section}/${r.element}` : `${r.temple}/${r.section}`;
    (imagesByNode[nodeId] ??= []).push({ id: r.id, url: pub(r.image_path), caption: r.caption });
  }

  // Per-temple distinct Category 1 / Category 2 / Label values — feed the
  // "move slab" modal's suggestion datalists in the card browser.
  const templeCats: Record<string, { cat1: string[]; cat2: string[]; labels: string[] }> = {};
  {
    const acc: Record<string, { c1: Set<string>; c2: Set<string>; lb: Set<string> }> = {};
    for (const s of slabs) {
      if (s.status === "rejected") continue;
      const t = (s.temple || "").trim();
      if (!t) continue;
      const b = (acc[t] ??= { c1: new Set(), c2: new Set(), lb: new Set() });
      const c1 = (s.component_section || "").trim();
      const c2 = (s.component_element || "").trim();
      const lb = (s.label || "").trim();
      if (c1) b.c1.add(c1);
      if (c2) b.c2.add(c2);
      if (lb) b.lb.add(lb);
    }
    const srt = (set: Set<string>) => [...set].sort((a, c) => a.localeCompare(c, undefined, { numeric: true }));
    for (const [t, b] of Object.entries(acc)) {
      templeCats[t] = { cat1: srt(b.c1), cat2: srt(b.c2), labels: srt(b.lb) };
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingBottom: 40 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>🏛 Temple View</h1>
          <p className="muted" style={{ margin: "2px 0 0", fontSize: 13, maxWidth: 760 }}>
            Browse every temple by component — Category 1 (floor / area) → Category 2 (cloister / sub-area) → Label, with
            progress at every level. Click a group to see its slab cards. Slabs added before categorization sit under{" "}
            <strong>Unassigned</strong>. Add reference photos with <strong>📷 Add image</strong>.
          </p>
        </div>
        {canWriteImages && <AddTempleImageButton categoryStruct={categoryStruct} />}
      </div>
      <TempleViewClient trees={trees} imagesByNode={imagesByNode} canManageImages={canWriteImages} templeCats={templeCats} />
    </div>
  );
}
