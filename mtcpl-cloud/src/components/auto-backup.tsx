"use client";

/**
 * Browser-side auto-backup scheduler.
 *
 * Sits on the /settings page (developer-only). When enabled, it
 * triggers a download of /api/export/full-backup at a chosen interval
 * (1h / 6h / 24h). The Excel file lands in the browser's default
 * Downloads folder with a timestamped filename like:
 *   mtcpl-backup-2026-04-23-15-00.xlsx
 *
 * Constraints (worth knowing):
 *   - Only works while THIS tab is open. Close the tab → no backups.
 *   - Browser's "always allow downloads from this site" must be enabled
 *     once, otherwise Chrome will silently block multi-file downloads.
 *   - PC sleep / browser background-throttling can delay a tick by
 *     a few minutes; not a problem for hourly+ schedules.
 *
 * State persistence:
 *   - On/off + interval + last backup time → localStorage (key prefix
 *     `mtcpl_autobackup_`). Survives refreshes; resumes on next tab load.
 *
 * The endpoint /api/export/full-backup is developer-gated; if a
 * non-developer somehow toggled this on, the download would 403.
 */

import { useEffect, useRef, useState } from "react";

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
  const d = new Date();
  // Keep filename-safe: YYYY-MM-DD-HH-mm in IST so backups sort by date.
  const ist = new Date(d.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const yyyy = ist.getFullYear();
  const mm = String(ist.getMonth() + 1).padStart(2, "0");
  const dd = String(ist.getDate()).padStart(2, "0");
  const HH = String(ist.getHours()).padStart(2, "0");
  const MM = String(ist.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}-${HH}-${MM}`;
}

/** Trigger a download of the backup file via a temporary anchor.
 *  Browsers will save it to Downloads with the suggested filename.
 *  Returns true on success, false if the fetch errored (not 200). */
async function triggerDownload(): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/export/full-backup", {
      method: "GET",
      cache: "no-store",
      credentials: "include",
    });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `mtcpl-backup-${timestampForFilename()}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();

    // Free the blob URL after a short delay so the download completes.
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

export function AutoBackup() {
  const [enabled, setEnabled] = useState(false);
  const [interval, setInterval] = useState<Interval>("1h");
  const [lastAt, setLastAt] = useState<string | null>(null);
  const [lastOk, setLastOk] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string>("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mounted, setMounted] = useState(false);

  // ── Hydrate from localStorage on mount
  useEffect(() => {
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
    setMounted(true);
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
  // Recomputed whenever enabled/interval/lastAt changes.
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
      const result = await triggerDownload();
      const at = nowIso();
      try {
        localStorage.setItem(KEY_LAST_AT, at);
        localStorage.setItem(KEY_LAST_OK, result.ok ? "1" : "0");
      } catch {}
      setLastAt(at);
      setLastOk(result.ok);
      setBusy(false);
      setStatusMsg(result.ok ? "✓ Backup saved" : `✕ Failed: ${result.error ?? "unknown"}`);
      // Clear status message after a few seconds.
      setTimeout(() => setStatusMsg(""), 6000);
    }, delay);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [enabled, interval, lastAt, mounted]);

  // ── Manual trigger ("Download Now") + immediate test
  async function handleManual() {
    if (busy) return;
    setBusy(true);
    setStatusMsg("Downloading…");
    const result = await triggerDownload();
    const at = nowIso();
    try {
      localStorage.setItem(KEY_LAST_AT, at);
      localStorage.setItem(KEY_LAST_OK, result.ok ? "1" : "0");
    } catch {}
    setLastAt(at);
    setLastOk(result.ok);
    setBusy(false);
    setStatusMsg(result.ok ? "✓ Backup saved" : `✕ Failed: ${result.error ?? "unknown"}`);
    setTimeout(() => setStatusMsg(""), 6000);
  }

  // ── Compute "next backup at" for display
  const nextAtDate = (() => {
    if (!enabled || !mounted) return null;
    const lastMs = lastAt ? new Date(lastAt).getTime() : Date.now();
    const next = new Date(lastMs + INTERVAL_MS[interval]);
    return next > new Date() ? next : new Date(Date.now() + INTERVAL_MS[interval]);
  })();

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
            Downloads the full backup Excel to your computer's <strong>Downloads</strong> folder on
            a schedule. Only works while this browser tab is open. Useful as a belt-and-braces
            safety net even with Supabase Pro backups in place.
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
          ⚠️ <strong>For this to work reliably:</strong> keep this tab open in a window that doesn't
          sleep. The first time a backup downloads, Chrome will ask if you want to allow multiple
          downloads from this site — click <strong>Allow</strong>. Backups land in your default
          Downloads folder; consider symlinking it to Google Drive or iCloud so files are also off-PC.
        </p>
      )}
    </div>
  );
}
