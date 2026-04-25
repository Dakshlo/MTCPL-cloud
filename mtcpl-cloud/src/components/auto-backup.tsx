"use client";

/**
 * Browser-side auto-backup scheduler.
 *
 * Sits on the /settings page (developer-only). When enabled, it
 * triggers a download of /api/export/full-backup at a chosen interval
 * (1h / 6h / 24h). Files end up either:
 *
 *   (a) Directly inside a folder the user picks once via the File
 *       System Access API (Chrome / Edge / modern Chromium browsers).
 *       Picked folder handle is persisted in IndexedDB so subsequent
 *       sessions reuse it after a quick permission re-grant.
 *
 *   (b) The browser's default Downloads folder (Safari / Firefox, or
 *       any case where the user hasn't picked a folder).
 *
 * Filename format: mtcpl-backup-YYYY-MM-DD-HH-mm.xlsx (IST timestamp).
 *
 * Constraints:
 *   - Only works while THIS tab is open. Close the tab → no backups.
 *   - File System Access API requires Chromium-based browser. Safari
 *     and Firefox fall back to Downloads automatically.
 *   - Folder permission may need re-granting after a browser restart
 *     (handled by ensurePermission below — usually one click).
 *   - PC sleep / browser background-throttling can delay a tick by
 *     a few minutes; not a problem for hourly+ schedules.
 *
 * State persistence (localStorage `mtcpl_autobackup_*`):
 *   - enabled / interval / last_at / last_ok
 * Folder handle persists in IndexedDB (key: 'backup-dir-handle').
 */

import { useEffect, useRef, useState } from "react";

// ─── Type augmentation for the File System Access API ──────────────────
// TypeScript doesn't include these in lib.dom yet (as of TS 5.x).
type FSPermissionDescriptor = { mode: "read" | "readwrite" };
type FSPermissionState = "granted" | "denied" | "prompt";
type FSWritableFileStream = {
  write: (data: Blob | BufferSource | string) => Promise<void>;
  close: () => Promise<void>;
};
type FSFileHandle = {
  createWritable: () => Promise<FSWritableFileStream>;
};
type FSDirectoryHandle = {
  name: string;
  kind: "directory";
  getFileHandle: (name: string, opts?: { create?: boolean }) => Promise<FSFileHandle>;
  queryPermission: (desc: FSPermissionDescriptor) => Promise<FSPermissionState>;
  requestPermission: (desc: FSPermissionDescriptor) => Promise<FSPermissionState>;
};
declare global {
  interface Window {
    showDirectoryPicker?: (opts?: { mode?: "read" | "readwrite" }) => Promise<FSDirectoryHandle>;
  }
}

type Interval = "1h" | "6h" | "24h";

const INTERVAL_MS: Record<Interval, number> = {
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
};

const INTERVAL_LABEL: Record<Interval, string> = {
  "1h": "Every hour",
  "6h": "Every 6 hours",
  "24h": "Every 24 hours",
};

const KEY_ENABLED = "mtcpl_autobackup_enabled";
const KEY_INTERVAL = "mtcpl_autobackup_interval";
const KEY_LAST_AT = "mtcpl_autobackup_last_at";
const KEY_LAST_OK = "mtcpl_autobackup_last_ok";

// ─── IndexedDB helpers (storing the FileSystemDirectoryHandle) ────────
// localStorage can only hold strings, but FS handles need full object
// persistence. IndexedDB does this natively for FS handles in Chrome/Edge.

const IDB_NAME = "mtcpl-autobackup";
const IDB_STORE = "handles";
const IDB_KEY = "backup-dir-handle";

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveDirHandle(handle: FSDirectoryHandle): Promise<void> {
  const db = await openIDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(handle, IDB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function loadDirHandle(): Promise<FSDirectoryHandle | null> {
  try {
    const db = await openIDB();
    const handle = await new Promise<FSDirectoryHandle | null>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
      req.onsuccess = () => resolve((req.result as FSDirectoryHandle | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return handle;
  } catch {
    return null;
  }
}

async function clearDirHandle(): Promise<void> {
  try {
    const db = await openIDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).delete(IDB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // ignore
  }
}

/** Verify (or re-request) write permission on a saved handle. */
async function ensurePermission(handle: FSDirectoryHandle): Promise<boolean> {
  try {
    const opts: FSPermissionDescriptor = { mode: "readwrite" };
    const status = await handle.queryPermission(opts);
    if (status === "granted") return true;
    const requested = await handle.requestPermission(opts);
    return requested === "granted";
  } catch {
    return false;
  }
}

// ─── Filename helpers ─────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString();
}

function fmt(d: Date): string {
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function timestampForFilename(): string {
  // YYYY-MM-DD-HH-mm in IST so files sort by date in Finder/Explorer.
  const d = new Date();
  const ist = new Date(d.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const yyyy = ist.getFullYear();
  const mm = String(ist.getMonth() + 1).padStart(2, "0");
  const dd = String(ist.getDate()).padStart(2, "0");
  const HH = String(ist.getHours()).padStart(2, "0");
  const MM = String(ist.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}-${HH}-${MM}`;
}

// ─── Backup execution ─────────────────────────────────────────────────

async function fetchBackupBlob(): Promise<{
  blob: Blob;
  totalRows: number | null;
  tables: number | null;
}> {
  const res = await fetch("/api/export/full-backup", {
    method: "GET",
    cache: "no-store",
    credentials: "include",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  // Server sets these so we can show "all N rows" without re-parsing.
  const totalRowsHdr = res.headers.get("X-Backup-Total-Rows");
  const tablesHdr = res.headers.get("X-Backup-Tables");
  const totalRows = totalRowsHdr ? Number(totalRowsHdr) : null;
  const tables = tablesHdr ? Number(tablesHdr) : null;
  const blob = await res.blob();
  return { blob, totalRows, tables };
}

/** Save blob into the chosen FS-Access folder (requires Chromium + permission). */
async function writeToFolder(
  handle: FSDirectoryHandle,
  blob: Blob,
  filename: string,
): Promise<void> {
  const fileHandle = await handle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

/** Fallback: save via the standard browser download flow (Downloads folder). */
function downloadBlobAsFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function runBackup(
  dirHandle: FSDirectoryHandle | null,
): Promise<{
  ok: boolean;
  method: "folder" | "downloads";
  error?: string;
  totalRows?: number | null;
  tables?: number | null;
}> {
  try {
    const { blob, totalRows, tables } = await fetchBackupBlob();
    const filename = `mtcpl-backup-${timestampForFilename()}.xlsx`;

    if (dirHandle) {
      const granted = await ensurePermission(dirHandle);
      if (granted) {
        try {
          await writeToFolder(dirHandle, blob, filename);
          return { ok: true, method: "folder", totalRows, tables };
        } catch (e) {
          // Fall through to default download if folder write fails
          // (folder may have been deleted, permission revoked, etc.)
          downloadBlobAsFile(blob, filename);
          return {
            ok: true,
            method: "downloads",
            totalRows,
            tables,
            error: `Folder write failed (${e instanceof Error ? e.message : "unknown"}) — fell back to Downloads`,
          };
        }
      }
      // Permission denied — fall back
      downloadBlobAsFile(blob, filename);
      return {
        ok: true,
        method: "downloads",
        totalRows,
        tables,
        error: "Folder permission denied — fell back to Downloads",
      };
    }

    downloadBlobAsFile(blob, filename);
    return { ok: true, method: "downloads", totalRows, tables };
  } catch (e) {
    return {
      ok: false,
      method: "downloads",
      error: e instanceof Error ? e.message : "unknown",
    };
  }
}

// ─── Component ────────────────────────────────────────────────────────

export function AutoBackup() {
  const [enabled, setEnabled] = useState(false);
  const [interval, setInterval] = useState<Interval>("1h");
  const [lastAt, setLastAt] = useState<string | null>(null);
  const [lastOk, setLastOk] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string>("");
  const [folderHandle, setFolderHandle] = useState<FSDirectoryHandle | null>(null);
  const [folderName, setFolderName] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mounted, setMounted] = useState(false);

  // ── Hydrate from localStorage + IndexedDB on mount
  useEffect(() => {
    (async () => {
      try {
        const en = localStorage.getItem(KEY_ENABLED) === "1";
        const iv = (localStorage.getItem(KEY_INTERVAL) as Interval) || "1h";
        const la = localStorage.getItem(KEY_LAST_AT);
        const lo = localStorage.getItem(KEY_LAST_OK);
        setEnabled(en);
        if (iv === "1h" || iv === "6h" || iv === "24h") setInterval(iv);
        setLastAt(la);
        setLastOk(lo === "1" ? true : lo === "0" ? false : null);
      } catch {
        // localStorage may be unavailable in private mode; ignore
      }

      // Load saved folder handle if any
      const handle = await loadDirHandle();
      if (handle) {
        setFolderHandle(handle);
        setFolderName(handle.name);
      }
      setMounted(true);
    })();
  }, []);

  // ── Persist toggles + interval
  useEffect(() => {
    if (!mounted) return;
    try {
      localStorage.setItem(KEY_ENABLED, enabled ? "1" : "0");
      localStorage.setItem(KEY_INTERVAL, interval);
    } catch {}
  }, [enabled, interval, mounted]);

  // ── The actual scheduler. Sets a timer based on (last backup time +
  // chosen interval). On fire: download → record timestamp → reschedule.
  useEffect(() => {
    if (!mounted) return;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!enabled) return;

    const intervalMs = INTERVAL_MS[interval];
    const lastMs = lastAt ? new Date(lastAt).getTime() : 0;
    const nextAtMs = lastMs > 0 ? lastMs + intervalMs : Date.now() + intervalMs;
    const delay = Math.max(0, nextAtMs - Date.now());

    timerRef.current = setTimeout(async () => {
      setBusy(true);
      setStatusMsg("Downloading backup…");
      const result = await runBackup(folderHandle);
      const at = nowIso();
      try {
        localStorage.setItem(KEY_LAST_AT, at);
        localStorage.setItem(KEY_LAST_OK, result.ok ? "1" : "0");
      } catch {}
      setLastAt(at);
      setLastOk(result.ok);
      setBusy(false);
      const where =
        result.method === "folder" ? `→ ${folderName ?? "chosen folder"}` : "→ Downloads";
      const sizeNote =
        result.ok && result.totalRows
          ? ` · ${result.totalRows.toLocaleString()} rows in ${result.tables ?? "?"} tables`
          : "";
      setStatusMsg(
        result.ok
          ? `✓ Backup saved ${where}${sizeNote}${result.error ? ` (${result.error})` : ""}`
          : `✕ Failed: ${result.error ?? "unknown"}`,
      );
      setTimeout(() => setStatusMsg(""), 8000);
    }, delay);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [enabled, interval, lastAt, mounted, folderHandle, folderName]);

  // ── Manual trigger
  async function handleManual() {
    if (busy) return;
    setBusy(true);
    setStatusMsg("Downloading…");
    const result = await runBackup(folderHandle);
    const at = nowIso();
    try {
      localStorage.setItem(KEY_LAST_AT, at);
      localStorage.setItem(KEY_LAST_OK, result.ok ? "1" : "0");
    } catch {}
    setLastAt(at);
    setLastOk(result.ok);
    setBusy(false);
    const where =
      result.method === "folder" ? `→ ${folderName ?? "chosen folder"}` : "→ Downloads";
    const sizeNote =
      result.ok && result.totalRows
        ? ` · ${result.totalRows.toLocaleString()} rows in ${result.tables ?? "?"} tables`
        : "";
    setStatusMsg(
      result.ok
        ? `✓ Backup saved ${where}${sizeNote}${result.error ? ` (${result.error})` : ""}`
        : `✕ Failed: ${result.error ?? "unknown"}`,
    );
    setTimeout(() => setStatusMsg(""), 8000);
  }

  // ── Folder picker
  async function handlePickFolder() {
    if (typeof window === "undefined" || !window.showDirectoryPicker) {
      setStatusMsg("Folder picker not supported in this browser. Use Chrome / Edge.");
      setTimeout(() => setStatusMsg(""), 6000);
      return;
    }
    try {
      const handle = await window.showDirectoryPicker({ mode: "readwrite" });
      // Make sure the permission is actually granted (some browsers
      // return a handle but with prompt-pending permission).
      const granted = await ensurePermission(handle);
      if (!granted) {
        setStatusMsg("Folder permission was denied.");
        setTimeout(() => setStatusMsg(""), 6000);
        return;
      }
      await saveDirHandle(handle);
      setFolderHandle(handle);
      setFolderName(handle.name);
      setStatusMsg(`✓ Folder set: ${handle.name}`);
      setTimeout(() => setStatusMsg(""), 5000);
    } catch (e) {
      // User cancelled the dialog → no error needed
      const isAbort = e instanceof Error && e.name === "AbortError";
      if (!isAbort) {
        setStatusMsg(
          `✕ Could not pick folder: ${e instanceof Error ? e.message : "unknown"}`,
        );
        setTimeout(() => setStatusMsg(""), 6000);
      }
    }
  }

  async function handleClearFolder() {
    await clearDirHandle();
    setFolderHandle(null);
    setFolderName(null);
    setStatusMsg("Folder cleared — backups will go to Downloads.");
    setTimeout(() => setStatusMsg(""), 5000);
  }

  // ── Compute "next backup at" for display
  const nextAtDate = (() => {
    if (!enabled || !mounted) return null;
    const lastMs = lastAt ? new Date(lastAt).getTime() : Date.now();
    const next = new Date(lastMs + INTERVAL_MS[interval]);
    return next > new Date() ? next : new Date(Date.now() + INTERVAL_MS[interval]);
  })();

  const fsApiSupported = mounted && typeof window !== "undefined" && !!window.showDirectoryPicker;

  return (
    <div
      className="settings-card"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 280px" }}>
          <p style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>
            🕒 Automatic Hourly Backup
          </p>
          <p className="muted" style={{ margin: "4px 0 0", fontSize: 12, lineHeight: 1.55 }}>
            Downloads the full backup Excel on a schedule. Pick a folder once with the button below
            and files land there directly (no Downloads-folder detour). Only works while this
            browser tab is open.
          </p>
          <p className="muted" style={{ margin: "4px 0 0", fontSize: 11, lineHeight: 1.55, fontStyle: "italic" }}>
            17 tables, raw column names, every row included (no 1000-row truncation). If data is
            ever lost, re-import any sheet via Supabase Table Editor → Insert from spreadsheet to
            restore. Check the <code>_manifest</code> sheet to verify row counts.
          </p>
        </div>
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 12px",
            background: enabled ? "rgba(22,163,74,0.1)" : "var(--surface-alt)",
            border: `1px solid ${enabled ? "rgba(22,163,74,0.4)" : "var(--border)"}`,
            borderRadius: 8,
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 700,
            color: enabled ? "#15803d" : "var(--muted)",
            userSelect: "none",
            whiteSpace: "nowrap",
          }}
        >
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            style={{ width: 16, height: 16, cursor: "pointer" }}
          />
          {enabled ? "ON" : "OFF"}
        </label>
      </div>

      {/* Folder picker row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 12px",
          background: folderHandle ? "rgba(22,163,74,0.06)" : "var(--surface-alt)",
          border: `1px solid ${folderHandle ? "rgba(22,163,74,0.25)" : "var(--border)"}`,
          borderRadius: 8,
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: 16 }}>📁</span>
        <div style={{ flex: 1, minWidth: 200, fontSize: 12 }}>
          <div style={{ fontWeight: 700, color: folderHandle ? "#15803d" : "var(--muted)" }}>
            {folderHandle ? `Saving to: ${folderName}` : "No folder picked"}
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
            {folderHandle
              ? "Files write directly into this folder."
              : "Backups will land in your browser's Downloads folder."}
          </div>
        </div>
        {fsApiSupported ? (
          <>
            <button
              type="button"
              onClick={handlePickFolder}
              className="ghost-button"
              style={{ fontSize: 12, padding: "6px 12px", whiteSpace: "nowrap" }}
            >
              {folderHandle ? "Change Folder" : "📁 Choose Folder"}
            </button>
            {folderHandle && (
              <button
                type="button"
                onClick={handleClearFolder}
                className="ghost-button danger-ghost"
                style={{ fontSize: 12, padding: "6px 10px" }}
                title="Stop saving to this folder; revert to Downloads"
              >
                ✕
              </button>
            )}
          </>
        ) : (
          <span className="muted" style={{ fontSize: 11, fontStyle: "italic" }}>
            Folder picker unsupported — use Chrome or Edge to enable
          </span>
        )}
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        <label className="stack" style={{ flex: "0 0 180px" }}>
          <span>Frequency</span>
          <select
            value={interval}
            onChange={(e) => setInterval(e.target.value as Interval)}
            disabled={!enabled}
            style={{ opacity: enabled ? 1 : 0.5 }}
          >
            <option value="1h">{INTERVAL_LABEL["1h"]}</option>
            <option value="6h">{INTERVAL_LABEL["6h"]}</option>
            <option value="24h">{INTERVAL_LABEL["24h"]}</option>
          </select>
        </label>

        <button
          type="button"
          onClick={handleManual}
          disabled={busy}
          className="ghost-button"
          style={{ fontSize: 12, padding: "6px 14px", whiteSpace: "nowrap" }}
        >
          {busy ? "Downloading…" : "↓ Download Now"}
        </button>

        <div style={{ flex: 1 }} />

        <div style={{ fontSize: 11, color: "var(--muted)", textAlign: "right", lineHeight: 1.6 }}>
          {lastAt && (
            <div>
              Last:{" "}
              <strong style={{ color: lastOk ? "#15803d" : "var(--danger)", fontWeight: 600 }}>
                {fmt(new Date(lastAt))}
              </strong>{" "}
              {lastOk === false && "(failed)"}
            </div>
          )}
          {enabled && nextAtDate && (
            <div>
              Next: <strong style={{ color: "var(--text)" }}>{fmt(nextAtDate)}</strong>
            </div>
          )}
          {!enabled && <div style={{ fontStyle: "italic" }}>Auto-backup off</div>}
        </div>
      </div>

      {statusMsg && (
        <div
          style={{
            padding: "8px 12px",
            background: lastOk === false ? "rgba(220,38,38,0.08)" : "rgba(22,163,74,0.08)",
            border: `1px solid ${lastOk === false ? "rgba(220,38,38,0.3)" : "rgba(22,163,74,0.3)"}`,
            borderRadius: 6,
            fontSize: 12,
            color: lastOk === false ? "#b91c1c" : "#15803d",
            fontWeight: 600,
          }}
        >
          {statusMsg}
        </div>
      )}

      {enabled && (
        <p className="muted" style={{ margin: 0, fontSize: 11, lineHeight: 1.5 }}>
          ⚠️ <strong>For this to work reliably:</strong> keep this tab open in a browser that
          doesn't sleep. If you picked a folder, the browser may ask once per session to confirm
          permission — click <strong>Allow</strong>. Files are named{" "}
          <code>mtcpl-backup-YYYY-MM-DD-HH-MM.xlsx</code> so they sort by date in Finder.
        </p>
      )}
    </div>
  );
}
