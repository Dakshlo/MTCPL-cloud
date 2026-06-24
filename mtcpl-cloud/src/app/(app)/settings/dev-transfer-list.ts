// Server-only helper: list the dev_transfers bucket grouped into per-uploader
// "baskets". Files are stored at `${uploaderId}/${ts}-${rand}-${name}`, so the
// top level is one folder per uploader (+ any legacy top-level files from before
// the basket model). Each file gets a fresh 1-hour signed download URL.

import type { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { DEV_TRANSFER_BUCKET } from "./dev-transfer-shared";

export type DevFile = { path: string; name: string; size: number; createdAt: string | null; url: string | null };
export type DevBasket = { uploaderId: string | null; uploaderName: string; files: DevFile[]; totalSize: number };

const PLACEHOLDER = ".emptyFolderPlaceholder";
// Strip the `${ts}-${rand}-` prefix our upload action adds.
const cleanName = (n: string) => n.replace(/^\d+-[a-z0-9]+-/i, "");

type RawEntry = { name: string; id: string | null; created_at?: string | null; metadata?: { size?: number } | null };

export async function listDevTransferBaskets(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  nameOf: (id: string) => string | undefined,
): Promise<DevBasket[]> {
  const { data: top } = await admin.storage
    .from(DEV_TRANSFER_BUCKET)
    .list("", { limit: 1000, sortBy: { column: "name", order: "asc" } });

  const uploaderIds: string[] = [];
  const legacy: RawEntry[] = [];
  for (const e of (top ?? []) as RawEntry[]) {
    if (e.name === PLACEHOLDER) continue;
    // A "folder" (prefix) comes back with id === null; a real file has a uuid.
    if (e.id === null) uploaderIds.push(e.name);
    else legacy.push(e);
  }

  const baskets: DevBasket[] = [];

  for (const uploaderId of uploaderIds) {
    const { data: files } = await admin.storage
      .from(DEV_TRANSFER_BUCKET)
      .list(uploaderId, { limit: 1000, sortBy: { column: "created_at", order: "desc" } });
    const out: DevFile[] = [];
    for (const f of (files ?? []) as RawEntry[]) {
      if (f.name === PLACEHOLDER) continue;
      const path = `${uploaderId}/${f.name}`;
      const display = cleanName(f.name);
      const { data: signed } = await admin.storage
        .from(DEV_TRANSFER_BUCKET)
        .createSignedUrl(path, 3600, { download: display });
      out.push({ path, name: display, size: f.metadata?.size ?? 0, createdAt: f.created_at ?? null, url: signed?.signedUrl ?? null });
    }
    if (out.length === 0) continue;
    baskets.push({
      uploaderId,
      uploaderName: nameOf(uploaderId) ?? "Unknown",
      files: out,
      totalSize: out.reduce((a, f) => a + f.size, 0),
    });
  }

  // Legacy top-level files (uploaded before the per-uploader model) → one basket.
  if (legacy.length > 0) {
    const out: DevFile[] = [];
    for (const f of legacy) {
      const display = f.name.replace(/^\d+-/, "");
      const { data: signed } = await admin.storage
        .from(DEV_TRANSFER_BUCKET)
        .createSignedUrl(f.name, 3600, { download: display });
      out.push({ path: f.name, name: display, size: f.metadata?.size ?? 0, createdAt: f.created_at ?? null, url: signed?.signedUrl ?? null });
    }
    baskets.push({ uploaderId: null, uploaderName: "Earlier uploads", files: out, totalSize: out.reduce((a, f) => a + f.size, 0) });
  }

  // Most-recently-active basket first; legacy bucket always last.
  baskets.sort((a, b) => {
    if (a.uploaderId === null) return 1;
    if (b.uploaderId === null) return -1;
    const at = a.files[0]?.createdAt ?? "";
    const bt = b.files[0]?.createdAt ?? "";
    return bt.localeCompare(at);
  });
  return baskets;
}
