"use client";

// File Transfer uploader — drag files in (or pick files / a whole folder),
// uploaded straight to private storage via short-lived signed URLs (any size,
// any type). Folder uploads keep their relative path in the name. Live progress.

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { createDevTransferUploadUrlAction } from "./actions";
import { DEV_TRANSFER_BUCKET } from "./dev-transfer-shared";

export function DevFileTransfer() {
  const router = useRouter();
  const filesRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [current, setCurrent] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // webkitdirectory isn't a typed React prop — set it on the folder input.
  useEffect(() => {
    const el = folderRef.current;
    if (el) {
      el.setAttribute("webkitdirectory", "");
      el.setAttribute("directory", "");
    }
  }, []);

  async function uploadFiles(files: File[]) {
    if (files.length === 0 || busy) return;
    setBusy(true);
    setErr(null);
    setDone(0);
    setTotal(files.length);
    const supabase = createBrowserSupabaseClient();
    let ok = 0;
    for (const file of files) {
      const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
      setCurrent(rel);
      try {
        const fd = new FormData();
        fd.set("filename", rel);
        const res = await createDevTransferUploadUrlAction(fd);
        if (!res.ok) {
          setErr(`${rel}: ${res.error}`);
        } else {
          const { error } = await supabase.storage.from(DEV_TRANSFER_BUCKET).uploadToSignedUrl(res.path, res.token, file);
          if (error) setErr(`${rel}: ${error.message}`);
          else ok++;
        }
      } catch (e) {
        setErr(`${rel}: ${e instanceof Error ? e.message : "upload failed"}`);
      }
      setDone((d) => d + 1);
    }
    setCurrent(null);
    setBusy(false);
    if (ok > 0) router.refresh();
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = "";
    void uploadFiles(picked);
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
    void uploadFiles(dropped);
  }

  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const btn: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 16px", fontSize: 13.5, fontWeight: 800, borderRadius: 9, border: "1.5px solid var(--gold-dark)", background: "var(--surface)", color: "var(--gold-dark)", cursor: busy ? "wait" : "pointer" };

  return (
    <div className="settings-card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <h3 className="settings-card-title">📤 Upload</h3>

      <div
        onDragOver={(e) => { e.preventDefault(); if (!busy) setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        style={{
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12,
          padding: "26px 16px", borderRadius: 12, textAlign: "center",
          border: `2px dashed ${dragOver ? "var(--gold-dark)" : "var(--border)"}`,
          background: dragOver ? "rgba(184,115,51,0.07)" : "var(--bg)",
          transition: "border-color .12s, background .12s",
        }}
      >
        {busy ? (
          <div style={{ width: "100%", maxWidth: 420 }}>
            <div style={{ fontSize: 14, fontWeight: 800 }}>Uploading {done} / {total}…</div>
            <div style={{ height: 8, borderRadius: 999, background: "var(--border)", overflow: "hidden", margin: "10px 0 6px" }}>
              <div style={{ height: "100%", width: `${pct}%`, background: "var(--gold-dark)", transition: "width .2s" }} />
            </div>
            {current && <div className="muted" style={{ fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={current}>📄 {current}</div>}
          </div>
        ) : (
          <>
            <div style={{ fontSize: 30, lineHeight: 1 }}>📦</div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Drag files here</div>
            <div className="muted" style={{ fontSize: 12 }}>or</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
              <button type="button" onClick={() => filesRef.current?.click()} style={btn}>📄 Choose files</button>
              <button type="button" onClick={() => folderRef.current?.click()} style={btn}>📁 Choose folder</button>
            </div>
          </>
        )}
      </div>

      <input ref={filesRef} type="file" multiple onChange={onPick} disabled={busy} style={{ display: "none" }} />
      <input ref={folderRef} type="file" multiple onChange={onPick} disabled={busy} style={{ display: "none" }} />

      {err && <div style={{ fontSize: 12.5, fontWeight: 700, color: "#dc2626" }}>⚠ {err}</div>}
      <div className="muted" style={{ fontSize: 11.5 }}>
        Any file type · any size · whole folders. Uploads here → log in on the other device → download from the basket below.
      </div>
    </div>
  );
}
