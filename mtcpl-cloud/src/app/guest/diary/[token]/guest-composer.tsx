"use client";

/** Guest reply composer (mig 201) — bottom-stuck, mobile-first. Posts the
 *  token-authenticated server action, then refreshes the thread. */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { postGuestDiaryRemarkAction } from "./guest-actions";

export function GuestComposer({ token, disabled }: { token: string; disabled?: boolean }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startT] = useTransition();

  function send() {
    const text = body.trim();
    if (!text || pending) return;
    startT(async () => {
      setError(null);
      const fd = new FormData();
      fd.set("token", token);
      fd.set("body", text);
      const r = await postGuestDiaryRemarkAction(fd);
      if (!r.ok) { setError(r.error); return; }
      setBody("");
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

  return (
    <div style={{ borderTop: "1px solid #e3dbc8", background: "#fffdf7", padding: "10px 12px calc(10px + env(safe-area-inset-bottom))" }}>
      {error && <div style={{ fontSize: 12.5, fontWeight: 700, color: "#b91c1c", marginBottom: 6 }}>⚠ {error}</div>}
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          placeholder="Type your message…"
          style={{ flex: 1, resize: "none", fontSize: 15, padding: "11px 13px", borderRadius: 14, border: "1.5px solid #d8cfb8", background: "#fff", color: "#1f2937", fontFamily: "inherit", outline: "none" }}
        />
        <button
          type="button"
          disabled={pending || !body.trim()}
          onClick={send}
          style={{ flexShrink: 0, width: 52, height: 46, borderRadius: 14, border: "none", background: pending || !body.trim() ? "#c9c0aa" : "#b45309", color: "#fff", fontSize: 18, fontWeight: 800, cursor: pending || !body.trim() ? "default" : "pointer" }}
        >
          {pending ? "…" : "➤"}
        </button>
      </div>
      <div style={{ fontSize: 10.5, color: "#a39a84", marginTop: 5, textAlign: "center" }}>Your message posts straight into the Work Diary chat.</div>
    </div>
  );
}
