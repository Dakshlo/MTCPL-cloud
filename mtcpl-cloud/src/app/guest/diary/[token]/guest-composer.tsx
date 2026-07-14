"use client";

/** Guest reply composer (mig 201) — bottom-stuck, mobile-first. Posts the
 *  token-authenticated server action, then refreshes the thread. Supports
 *  attachments: the browser uploads straight to storage via a token-gated
 *  signed URL, then submits only the file metadata (same as the in-app diary). */

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { postGuestDiaryRemarkAction, prepareGuestDiaryUploadsAction } from "./guest-actions";

type FileMeta = { name: string; path: string; mime: string | null; size: number | null };

async function uploadGuestFiles(token: string, files: File[]): Promise<{ ok: true; metas: FileMeta[] } | { ok: false; error: string }> {
  if (files.length === 0) return { ok: true, metas: [] };
  const fd = new FormData();
  fd.set("token", token);
  fd.set("names", JSON.stringify(files.map((f) => ({ name: f.name }))));
  const prep = await prepareGuestDiaryUploadsAction(fd);
  if (!prep.ok) return prep;
  const sb = createBrowserSupabaseClient();
  const metas: FileMeta[] = [];
  for (let i = 0; i < files.length; i++) {
    const u = prep.uploads[i];
    const { error } = await sb.storage.from("work-diary").uploadToSignedUrl(u.path, u.token, files[i]);
    if (error) return { ok: false, error: `Upload failed for ${files[i].name}: ${error.message}` };
    metas.push({ name: files[i].name, path: u.path, mime: files[i].type || null, size: files[i].size });
  }
  return { ok: true, metas };
}

const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);

export function GuestComposer({ token, disabled }: { token: string; disabled?: boolean }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startT] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  function send() {
    const text = body.trim();
    if ((!text && files.length === 0) || pending) return;
    startT(async () => {
      setError(null);
      // 1) upload straight to storage (may take a moment for big photos)…
      const up = await uploadGuestFiles(token, files);
      if (!up.ok) { setError(up.error); return; }
      // 2) …then post the remark with just the file metadata.
      const fd = new FormData();
      fd.set("token", token);
      fd.set("body", text);
      fd.set("files", JSON.stringify(up.metas));
      const r = await postGuestDiaryRemarkAction(fd);
      if (!r.ok) { setError(r.error); return; }
      setBody("");
      setFiles([]);
      router.refresh();
    });
  }

  if (disabled) {
    return (
      <div style={{ padding: "12px 14px", textAlign: "center", fontSize: 13, fontWeight: 700, color: "#7a7264", background: "#f4efe3", borderTop: "1px solid #e3dbc8" }}>
        ✅ This activity is closed — no more messages.
      </div>
    );
  }

  const canSend = !pending && (body.trim().length > 0 || files.length > 0);

  return (
    <div style={{ borderTop: "1px solid #e3dbc8", background: "#fffdf7", padding: "10px 12px calc(10px + env(safe-area-inset-bottom))" }}>
      {error && <div style={{ fontSize: 12.5, fontWeight: 700, color: "#b91c1c", marginBottom: 6 }}>⚠ {error}</div>}

      {files.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {files.map((f, i) => (
            <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "#5c4a1f", background: "#f3ead2", border: "1px solid #e0d3ad", borderRadius: 10, padding: "4px 8px", maxWidth: "100%" }}>
              <span aria-hidden>📎</span>
              <span style={{ maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
              <span style={{ color: "#a3966f", fontWeight: 600 }}>{fmtSize(f.size)}</span>
              <button type="button" disabled={pending} onClick={() => setFiles((p) => p.filter((_, k) => k !== i))} title="Remove" style={{ border: "none", background: "transparent", color: "#b45309", fontWeight: 900, cursor: pending ? "default" : "pointer", fontSize: 15, lineHeight: 1, padding: 0 }}>×</button>
            </span>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        <input ref={fileInput} type="file" multiple style={{ display: "none" }} onChange={(e) => { const fs = [...(e.target.files ?? [])]; if (fs.length) setFiles((p) => [...p, ...fs].slice(0, 15)); e.target.value = ""; }} />
        <button
          type="button"
          disabled={pending}
          onClick={() => fileInput.current?.click()}
          title="Attach files"
          style={{ flexShrink: 0, width: 46, height: 46, borderRadius: 14, border: "1.5px solid #d8cfb8", background: "#fff", color: pending ? "#c9c0aa" : "#b45309", fontSize: 20, fontWeight: 800, cursor: pending ? "default" : "pointer" }}
        >📎</button>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          placeholder="Type your message…"
          style={{ flex: 1, resize: "none", fontSize: 15, padding: "11px 13px", borderRadius: 14, border: "1.5px solid #d8cfb8", background: "#fff", color: "#1f2937", fontFamily: "inherit", outline: "none" }}
        />
        <button
          type="button"
          disabled={!canSend}
          onClick={send}
          style={{ flexShrink: 0, width: 52, height: 46, borderRadius: 14, border: "none", background: canSend ? "#b45309" : "#c9c0aa", color: "#fff", fontSize: 18, fontWeight: 800, cursor: canSend ? "pointer" : "default" }}
        >
          {pending ? "…" : "➤"}
        </button>
      </div>
      <div style={{ fontSize: 10.5, color: "#a39a84", marginTop: 5, textAlign: "center" }}>Your message posts straight into the Work Diary chat.</div>
    </div>
  );
}
