"use client";

// Developer file transfer — upload a file from one device, download it on
// another after logging in (no email/AirDrop). Uploads go straight to storage
// via a short-lived signed URL, so any file size works.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { createDevTransferUploadUrlAction } from "./actions";
import { DEV_TRANSFER_BUCKET } from "./dev-transfer-shared";

export function DevFileTransfer() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setBusy(true);
    setErr(null);
    const supabase = createBrowserSupabaseClient();
    const picked = Array.from(files);
    try {
      let done = 0;
      for (const file of picked) {
        setStatus(`Uploading ${file.name} (${done + 1}/${picked.length})…`);
        const fd = new FormData();
        fd.set("filename", file.name);
        const res = await createDevTransferUploadUrlAction(fd);
        if (!res.ok) { setErr(res.error); continue; }
        const { error } = await supabase.storage
          .from(DEV_TRANSFER_BUCKET)
          .uploadToSignedUrl(res.path, res.token, file);
        if (error) { setErr(`${file.name}: ${error.message}`); }
        done += 1;
      }
      setStatus(null);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }

  return (
    <div className="settings-card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <h3 className="settings-card-title">Upload a file</h3>
      <label
        style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
          padding: "12px 16px", fontSize: 14, fontWeight: 800, borderRadius: 10,
          border: "1.5px dashed var(--border)", cursor: busy ? "wait" : "pointer",
          background: "var(--bg)", color: "var(--text)", textAlign: "center",
        }}
      >
        {busy ? (status ?? "Uploading…") : "📤 Choose file(s) to upload"}
        <input type="file" multiple onChange={onPick} disabled={busy} style={{ display: "none" }} />
      </label>
      <div className="muted" style={{ fontSize: 11.5 }}>
        Uploads here, then log in on the other device and download from the list below.
      </div>
      {err && <div style={{ fontSize: 12.5, fontWeight: 700, color: "#dc2626" }}>⚠ {err}</div>}
    </div>
  );
}
