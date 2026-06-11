// Mig 123 — Temple View. Pick a temple and browse its slabs organised by
// component: Section (location path, '›'-nested) → Element (part type),
// each with a stage progress bar (pending / cutting / carving / done /
// rejected) and counts. Click a leaf to see the actual slabs. Read-only;
// older slabs with no category sit under "Unassigned" — never lost.

import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canReadRequiredSizes } from "@/lib/cutting-permissions";
import { TempleViewClient, type TempleTree, type StageBucket } from "./temple-view-client";

export const dynamic = "force-dynamic";

type SlabRow = {
  id: string; label: string | null; description: string | null; temple: string; status: string;
  component_section: string | null; component_element: string | null;
  stone: string | null; quality: string | null;
  length_ft: number | null; width_ft: number | null; thickness_ft: number | null;
  priority: boolean | null;
};

export type TempleSlabCard = {
  id: string; status: string; stone: string | null; quality: string | null;
  l: number; w: number; t: number; priority: boolean;
};

const SLAB_LIMIT = 30000;

function stageBucket(status: string): StageBucket {
  if (status === "open" || status === "planned") return "pending";
  if (status === "cutting" || status === "cut_done") return "cutting";
  if (status === "carving_assigned" || status === "carving_in_progress") return "carving";
  if (status === "completed" || status === "dispatched") return "done";
  if (status === "rejected") return "rejected";
  return "pending";
}

const EMPTY_COUNTS = (): Record<StageBucket, number> => ({ pending: 0, cutting: 0, carving: 0, done: 0, rejected: 0 });

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
  const admin = createAdminSupabaseClient();

  // Paginated fetch of every slab (all statuses) — mirrors the slabs page
  // pagination so nothing falls off the PostgREST 1000-row cap.
  async function fetchAll(): Promise<SlabRow[]> {
    const PAGE = 1000;
    const all: SlabRow[] = [];
    for (let offset = 0; offset < SLAB_LIMIT; offset += PAGE) {
      const { data, error } = await admin
        .from("slab_requirements")
        .select("id, label, description, temple, status, component_section, component_element, stone, quality, length_ft, width_ft, thickness_ft, priority")
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
    const temple = (s.temple || "—").trim();
    let root = byTemple.get(temple);
    if (!root) { root = newNode(temple); byTemple.set(temple, root); }

    // Category 1 (section) › Category 2 (element) › Label › Description.
    // section may carry a legacy '›'-path from older AI runs — split it.
    const sectionRaw = (s.component_section ?? "").trim();
    const element = (s.component_element ?? "").trim();
    const label = (s.label ?? "").trim();
    const description = (s.description ?? "").trim();
    const cat1Levels = sectionRaw
      ? sectionRaw.split(/\s*[›>]\s*/).map((x) => x.trim()).filter(Boolean)
      : ["Unassigned"];
    const path = [
      ...cat1Levels,
      ...(element ? [element] : []),
      label || "— (no label)",
      ...(description ? [description] : []),
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingBottom: 40 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 22 }}>🏛 Temple View</h1>
        <p className="muted" style={{ margin: "2px 0 0", fontSize: 13, maxWidth: 760 }}>
          Browse every temple by component — Section (floor / area) → Element (pillar, chajja…), with progress at every level.
          Click a group to see its slabs. Slabs added before AI categorization sit under <strong>Unassigned</strong>.
        </p>
      </div>
      <TempleViewClient trees={trees} />
    </div>
  );
}
