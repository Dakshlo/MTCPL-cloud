"use client";

/**
 * Dark chat inside the normal app shell.
 *
 * Layout:
 *   [ App sidebar (untouched) | CHAT main (flex 1) | Recent chats (260px, right) ]
 *
 * We break out of the default `.page-content` padding via negative margins so
 * the dark background hits the edges of the content area. Height is locked to
 * `calc(100vh - 56px)` (viewport minus the app's 56px sticky topbar) so the
 * chat has a fixed bottom edge that the input sits on.
 *
 * This replaces the earlier `position: fixed; inset: 0` overlay, which fought
 * the app topbar's z-index and hid the main navigation — keeping the app
 * sidebar visible means navigation stays accessible from the chat.
 */

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  deleteSession as deleteSessionAction,
  loadSessionMessages,
  listRecentSessions,
  type ChatSessionSummary,
} from "@/lib/ai/chat-sessions";
import { ChatMarkdown } from "./chat-markdown";
import { SpeakButton } from "./chat-widgets/speak-button";

// Friendly labels shown while a Claude tool runs. Keyed by tool name —
// must match the schema names in src/lib/ai/tools.ts.
const TOOL_LABELS: Record<string, string> = {
  list_temples: "📋 Listing temples…",
  get_inventory_snapshot: "📊 Checking inventory…",
  list_blocks: "🧱 Looking up blocks…",
  get_live_cutting_status: "🔪 Checking live cutting…",
  get_temple_requirements: "🏛️ Loading temple requirements…",
  get_cutting_activity: "📅 Loading cutting activity…",
  run_plan_simulation: "📐 Running plan simulation…",
};

type Msg = {
  role: "user" | "assistant";
  content: string;
  /** Base64 data URLs — user-uploaded photos attached to this message */
  images?: string[];
  /** Cost in INR, attached to the assistant reply when the stream finishes */
  costInr?: number;
};

/** Max concurrent image attachments per message. Cost control — each image
 *  is roughly 1,500 tokens sent to Claude. */
const MAX_ATTACHMENTS = 3;
/** Max pre-resize size. Larger files are rejected with a friendly toast. */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

/** Resize an image client-side to ≤1024 px JPEG 0.8 to keep payloads small. */
function resizeToDataUrl(file: File, maxDim = 1024, quality = 0.8): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const ratio = Math.min(maxDim / img.width, maxDim / img.height, 1);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * ratio);
        canvas.height = Math.round(img.height * ratio);
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("canvas unavailable"));
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => reject(new Error("invalid image"));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

const PRESET_QUESTIONS = [
  "आज का काम क्या हुआ?",
  "कल की पूरी रिपोर्ट दो",
  "कितने blocks available हैं?",
  "Urgent slabs कौन-कौन से हैं?",
  "Aasta Temple के लिए कितने blocks चाहिए?",
  "पिछले हफ्ते कितनी cutting हुई?",
];

// Minimal typing for the browser SpeechRecognition API
type SRType = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  start(): void;
  stop(): void;
};
type SRCtor = new () => SRType;

// ── Palette ────────────────────────────────────────────────────────────────
const C = {
  bg: "#1a1a1a",
  sidebar: "#141414",
  surface: "#242424",
  surfaceHi: "#2e2e2e",
  border: "rgba(255,255,255,0.1)",
  borderHi: "rgba(255,255,255,0.18)",
  accent: "#E8C572",
  accentDark: "#b87333",
  text: "#e8e8e8",
  textMuted: "rgba(255,255,255,0.55)",
  textDim: "rgba(255,255,255,0.35)",
  userBubble: "rgba(255,255,255,0.07)",
  sessionActive: "rgba(232,197,114,0.15)",
  errorBg: "rgba(220,38,38,0.12)",
  errorBorder: "rgba(220,38,38,0.4)",
  errorText: "#fca5a5",
};

// ── Helpers ───────────────────────────────────────────────────────────────
function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export function AskAiChat({
  userName,
  initialRecentSessions,
}: {
  userName: string;
  initialRecentSessions: ChatSessionSummary[];
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [voiceLang, setVoiceLang] = useState<"en-IN" | "hi-IN">("en-IN");
  const [listening, setListening] = useState(false);
  const [sessions, setSessions] = useState<ChatSessionSummary[]>(initialRecentSessions);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [loadingSession, setLoadingSession] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const recognitionRef = useRef<SRType | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isEmpty = messages.length === 0;

  const greeting = useMemo(() => {
    const hr = new Date().getHours();
    if (hr < 12) return "Good morning";
    if (hr < 17) return "Good afternoon";
    return "Good evening";
  }, []);

  const speechSupported = useMemo(() => {
    if (typeof window === "undefined") return false;
    const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
    return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
  }, []);

  // Collapse sidebar on narrow screens
  useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth < 1024) {
      setSidebarOpen(false);
    }
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streaming]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      try { recognitionRef.current?.stop(); } catch { /* noop */ }
    };
  }, []);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, [input]);

  // ── Session actions ──────────────────────────────────────────────────────

  function startNewChat() {
    if (streaming) return;
    abortRef.current?.abort();
    setMessages([]);
    setActiveSessionId(null);
    setInput("");
    setError(null);
  }

  async function selectSession(sessionId: string) {
    if (streaming) return;
    if (activeSessionId === sessionId) return;
    setLoadingSession(sessionId);
    try {
      const rows = await loadSessionMessages(sessionId);
      setMessages(rows.map((r) => ({
        role: r.role,
        content: r.content,
        images: r.images && r.images.length > 0 ? r.images : undefined,
      })));
      setActiveSessionId(sessionId);
      setError(null);
    } catch {
      setError("Could not load that chat.");
    } finally {
      setLoadingSession(null);
    }
  }

  async function handleDeleteSession(sessionId: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (streaming) return;
    if (!confirm("Delete this chat?")) return;
    const result = await deleteSessionAction(sessionId);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    if (activeSessionId === sessionId) startNewChat();
  }

  async function refreshSessionList() {
    try {
      const next = await listRecentSessions(30);
      setSessions(next);
    } catch { /* non-critical */ }
  }

  // ── Send message ─────────────────────────────────────────────────────────

  async function sendMessage(text: string, imagesOverride?: string[]) {
    const trimmed = text.trim();
    // Allow "image-only" messages (e.g. dad pastes a photo without typing)
    const images = imagesOverride ?? attachments;
    if (!trimmed && images.length === 0) return;
    if (streaming) return;

    setError(null);
    setActiveTool(null);
    const nextMessages: Msg[] = [
      ...messages,
      {
        role: "user",
        content: trimmed,
        images: images.length > 0 ? images : undefined,
      },
      { role: "assistant", content: "" },
    ];
    setMessages(nextMessages);
    setInput("");
    setAttachments([]);
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    const wasNewChat = activeSessionId === null;

    try {
      const res = await fetch("/api/ask-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages.slice(0, -1).map((m) => ({
            role: m.role,
            content: m.content,
            ...(m.images && m.images.length > 0 ? { images: m.images } : {}),
          })),
          sessionId: activeSessionId,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const body = await res.json();
          if (body?.error) msg = body.error;
        } catch { /* leave as HTTP N */ }
        setError(msg);
        setStreaming(false);
        setMessages((prev) => prev.slice(0, -1));
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let sepIdx;
        while ((sepIdx = buffer.indexOf("\n\n")) !== -1) {
          const raw = buffer.slice(0, sepIdx);
          buffer = buffer.slice(sepIdx + 2);

          let eventName = "message";
          const dataLines: string[] = [];
          for (const line of raw.split("\n")) {
            if (line.startsWith("event: ")) eventName = line.slice(7).trim();
            else if (line.startsWith("data: ")) dataLines.push(line.slice(6));
          }
          const data = dataLines.join("\n");

          if (eventName === "session") {
            if (data && data !== activeSessionId) setActiveSessionId(data);
            continue;
          }
          if (eventName === "tool_start") {
            setActiveTool(data);
            continue;
          }
          if (eventName === "tool_end") {
            setActiveTool(null);
            continue;
          }
          if (eventName === "cost") {
            const n = Number(data);
            if (Number.isFinite(n)) {
              setMessages((prev) => {
                const copy = prev.slice();
                const last = copy[copy.length - 1];
                if (last?.role === "assistant") {
                  copy[copy.length - 1] = { ...last, costInr: n };
                }
                return copy;
              });
            }
            continue;
          }
          if (eventName === "error") {
            setError(data || "AI returned an error");
            continue;
          }
          if (eventName === "done" || data === "[DONE]") {
            continue;
          }
          // First text chunk arriving — clear any tool-progress indicator
          if (activeTool) setActiveTool(null);
          const chunk = data.replace(/\\n/g, "\n");
          setMessages((prev) => {
            const copy = prev.slice();
            const last = copy[copy.length - 1];
            if (last?.role === "assistant") {
              copy[copy.length - 1] = { role: "assistant", content: last.content + chunk };
            }
            return copy;
          });
        }
      }
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      const msg = err instanceof Error ? err.message : "Request failed";
      setError(msg);
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setStreaming(false);
      setActiveTool(null);
      abortRef.current = null;
      if (wasNewChat || activeSessionId) refreshSessionList();
    }
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    sendMessage(input);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  function handlePreset(text: string) {
    if (streaming) return;
    sendMessage(text);
  }

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const slotsLeft = MAX_ATTACHMENTS - attachments.length;
    if (slotsLeft <= 0) {
      setError(`Max ${MAX_ATTACHMENTS} images per message. Send these first, then add more.`);
      return;
    }
    const files = [...fileList].slice(0, slotsLeft);
    const added: string[] = [];
    for (const f of files) {
      if (!f.type.startsWith("image/")) {
        setError(`${f.name} is not an image.`);
        continue;
      }
      if (f.size > MAX_UPLOAD_BYTES) {
        setError(`${f.name} is too large (max 10 MB).`);
        continue;
      }
      try {
        const dataUrl = await resizeToDataUrl(f);
        added.push(dataUrl);
      } catch {
        setError(`Could not read ${f.name}.`);
      }
    }
    if (added.length > 0) {
      setAttachments((prev) => [...prev, ...added].slice(0, MAX_ATTACHMENTS));
      setError(null);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeAttachment(idx: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  }

  function toggleVoice() {
    if (!speechSupported) return;
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.lang = voiceLang;
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      let finalText = "";
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) finalText += result[0].transcript;
      }
      if (finalText) setInput((prev) => (prev ? prev + " " : "") + finalText.trim());
    };
    recognition.onerror = () => { setListening(false); };
    recognition.onend = () => { setListening(false); };

    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }

  return (
    <div
      style={{
        // Break out of .page-content padding so the dark skin hits the edges
        // of the content area. The app sidebar on the left stays untouched.
        marginTop: -24,
        marginLeft: -28,
        marginRight: -28,
        marginBottom: -40,
        height: "calc(100vh - 56px)",
        display: "flex",
        flexDirection: "row",
        background: C.bg,
        color: C.text,
        overflow: "hidden",
        fontFamily: "inherit",
      }}
    >
      {/* ── Main chat column (left) ────────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <header
          style={{
            flexShrink: 0,
            padding: "14px 22px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: `1px solid ${C.border}`,
            gap: 10,
          }}
        >
          <span style={{ fontSize: 15, fontWeight: 600, color: C.text, letterSpacing: "-0.2px" }}>
            ✨ MTCPL-AI
          </span>

          {/* Sidebar toggle moves to the right since the sidebar lives there now */}
          <button
            type="button"
            onClick={() => setSidebarOpen((v) => !v)}
            style={{
              background: "transparent",
              border: `1px solid ${C.border}`,
              color: C.textMuted,
              padding: "6px 12px",
              borderRadius: 8,
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 500,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
            title={sidebarOpen ? "Hide recent chats" : "Show recent chats"}
          >
            {sidebarOpen ? "Hide" : "Recent"} chats {sidebarOpen ? "→" : "←"}
          </button>
        </header>

        {/* Scrollable content */}
        <main
          ref={scrollRef}
          className="ask-ai-scroll"
          style={{
            flex: 1,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            justifyContent: isEmpty ? "center" : "flex-start",
          }}
        >
          {isEmpty ? (
            <EmptyHero greeting={greeting} userName={userName} onPick={handlePreset} disabled={streaming} />
          ) : (
            <MessageList
              messages={messages}
              streaming={streaming}
              onFollowUp={handlePreset}
              activeTool={activeTool}
            />
          )}
        </main>

        {/* Error banner */}
        {error && (
          <div
            style={{
              margin: "0 auto 10px",
              maxWidth: 760,
              width: "calc(100% - 32px)",
              padding: "10px 14px",
              background: C.errorBg,
              border: `1px solid ${C.errorBorder}`,
              borderRadius: 8,
              fontSize: 12,
              color: C.errorText,
              flexShrink: 0,
            }}
          >
            {error}
            <button
              onClick={() => setError(null)}
              style={{ float: "right", background: "transparent", border: "none", color: C.errorText, cursor: "pointer", fontSize: 14, padding: 0, marginLeft: 10 }}
            >
              ×
            </button>
          </div>
        )}

        {/* Input area */}
        <footer
          style={{
            flexShrink: 0,
            padding: "0 16px 16px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          {!isEmpty && (
            <div
              style={{
                display: "flex",
                gap: 6,
                flexWrap: "wrap",
                justifyContent: "center",
                maxWidth: 760,
                width: "100%",
                marginBottom: 10,
              }}
            >
              {PRESET_QUESTIONS.slice(0, 4).map((q) => (
                <Chip key={q} label={q} onClick={() => handlePreset(q)} disabled={streaming} compact />
              ))}
            </div>
          )}

          <form
            onSubmit={handleSubmit}
            style={{
              width: "100%",
              maxWidth: 760,
              background: C.surface,
              border: `1px solid ${C.border}`,
              borderRadius: 18,
              padding: "10px 12px",
              display: "flex",
              flexDirection: "column",
              gap: 8,
              transition: "border-color 0.15s, box-shadow 0.15s",
              boxShadow: "0 2px 20px rgba(0,0,0,0.25)",
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = "rgba(232,197,114,0.5)";
              e.currentTarget.style.boxShadow = "0 2px 20px rgba(0,0,0,0.35), 0 0 0 3px rgba(232,197,114,0.08)";
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = C.border;
              e.currentTarget.style.boxShadow = "0 2px 20px rgba(0,0,0,0.25)";
            }}
          >
            {/* Hidden file input (triggered by the paperclip button) */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: "none" }}
              onChange={(e) => handleFiles(e.target.files)}
            />

            {/* Attachment thumbnails row */}
            {attachments.length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: "4px 4px 0" }}>
                {attachments.map((url, i) => (
                  <div
                    key={i}
                    style={{
                      position: "relative",
                      width: 56,
                      height: 56,
                      borderRadius: 8,
                      overflow: "hidden",
                      border: "1px solid rgba(255,255,255,0.18)",
                      background: "rgba(0,0,0,0.3)",
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={url}
                      alt={`attachment ${i + 1}`}
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                    <button
                      type="button"
                      onClick={() => removeAttachment(i)}
                      title="Remove"
                      style={{
                        position: "absolute",
                        top: 2,
                        right: 2,
                        width: 20,
                        height: 20,
                        borderRadius: "50%",
                        border: "none",
                        background: "rgba(0,0,0,0.7)",
                        color: "#fff",
                        fontSize: 13,
                        lineHeight: 1,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={streaming}
              placeholder={
                attachments.length > 0
                  ? "Ask about these photos... (or send with no text)"
                  : isEmpty
                  ? "Ask me anything about blocks, slabs, cutting..."
                  : "Reply..."
              }
              rows={1}
              style={{
                width: "100%",
                background: "transparent",
                border: "none",
                outline: "none",
                color: C.text,
                fontSize: 17,
                lineHeight: 1.5,
                resize: "none",
                fontFamily: "inherit",
                padding: "10px 10px 6px",
                minHeight: 44,
                maxHeight: 200,
              }}
            />

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={streaming || attachments.length >= MAX_ATTACHMENTS}
                  title={
                    attachments.length >= MAX_ATTACHMENTS
                      ? `Max ${MAX_ATTACHMENTS} images per message`
                      : "Attach photos"
                  }
                  style={{
                    padding: "7px 12px",
                    fontSize: 17,
                    background: attachments.length > 0 ? "rgba(232,197,114,0.12)" : "transparent",
                    color: attachments.length > 0 ? "#E8C572" : C.textMuted,
                    border: `1px solid ${attachments.length > 0 ? "rgba(232,197,114,0.4)" : C.border}`,
                    borderRadius: 8,
                    cursor: streaming || attachments.length >= MAX_ATTACHMENTS ? "not-allowed" : "pointer",
                    opacity: streaming || attachments.length >= MAX_ATTACHMENTS ? 0.5 : 1,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  📎{attachments.length > 0 ? <span style={{ fontSize: 11, fontWeight: 700 }}>{attachments.length}</span> : null}
                </button>

                <button
                  type="button"
                  onClick={() => setVoiceLang((l) => (l === "en-IN" ? "hi-IN" : "en-IN"))}
                  title="Toggle voice input language"
                  style={{
                    padding: "7px 12px",
                    fontSize: 13,
                    fontWeight: 700,
                    background: "transparent",
                    color: C.textMuted,
                    border: `1px solid ${C.border}`,
                    borderRadius: 8,
                    cursor: "pointer",
                    minWidth: 52,
                  }}
                >
                  {voiceLang === "hi-IN" ? "हिं" : "EN"}
                </button>

                <button
                  type="button"
                  onClick={toggleVoice}
                  disabled={!speechSupported || streaming}
                  title={
                    !speechSupported
                      ? "Voice input not supported on this browser — try Chrome"
                      : listening
                      ? "Stop listening"
                      : `Speak in ${voiceLang === "hi-IN" ? "Hindi" : "English"}`
                  }
                  style={{
                    padding: "7px 12px",
                    fontSize: 17,
                    background: listening ? "rgba(220,38,38,0.15)" : "transparent",
                    border: `1px solid ${listening ? "rgba(220,38,38,0.5)" : C.border}`,
                    borderRadius: 8,
                    color: speechSupported ? (listening ? "#fca5a5" : C.textMuted) : C.textDim,
                    cursor: !speechSupported ? "not-allowed" : "pointer",
                    opacity: speechSupported ? 1 : 0.4,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  {listening && (
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#ef4444", animation: "ask-ai-pulse 1.2s ease-in-out infinite" }} />
                  )}
                  🎤
                </button>
              </div>

              <button
                type="submit"
                disabled={streaming || !input.trim()}
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: "50%",
                  border: "none",
                  background: streaming || !input.trim() ? "rgba(255,255,255,0.08)" : C.accent,
                  color: streaming || !input.trim() ? C.textDim : "#1a1a1a",
                  cursor: streaming || !input.trim() ? "not-allowed" : "pointer",
                  fontSize: 20,
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transition: "background 0.15s",
                }}
                title={streaming ? "Generating…" : "Send message"}
              >
                {streaming ? <ThinkingDots /> : "↑"}
              </button>
            </div>
          </form>

          <div style={{ fontSize: 12, color: C.textDim, textAlign: "center", marginTop: 10 }}>
            MTCPL-AI can make mistakes — verify anything important.
          </div>
        </footer>
      </div>

      {/* ── Right-side sidebar: recent chats ──────────────────────── */}
      {sidebarOpen && (
        <aside
          style={{
            width: 260,
            flexShrink: 0,
            background: C.sidebar,
            borderLeft: `1px solid ${C.border}`,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "14px 14px 12px",
              borderBottom: `1px solid ${C.border}`,
            }}
          >
            <button
              type="button"
              onClick={startNewChat}
              disabled={streaming || isEmpty}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                padding: "11px 14px",
                background: isEmpty ? "rgba(255,255,255,0.04)" : C.accent,
                color: isEmpty ? C.textMuted : "#1a1a1a",
                border: `1px solid ${isEmpty ? C.border : C.accent}`,
                borderRadius: 10,
                fontWeight: 700,
                fontSize: 14,
                cursor: streaming || isEmpty ? "not-allowed" : "pointer",
                opacity: streaming && !isEmpty ? 0.6 : 1,
                transition: "all 0.15s",
              }}
              title={isEmpty ? "Already on a new chat" : "Start a new conversation"}
            >
              <span style={{ fontSize: 16, lineHeight: 1 }}>+</span>
              New chat
            </button>
          </div>

          <div
            className="ask-ai-scroll"
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "10px 8px",
            }}
          >
            {sessions.length === 0 ? (
              <div style={{ padding: "20px 12px", fontSize: 13, color: C.textDim, textAlign: "center" }}>
                No past chats yet.
              </div>
            ) : (
              <>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: C.textDim,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    padding: "4px 10px 8px",
                  }}
                >
                  Recent
                </div>
                {sessions.map((s) => {
                  const isActive = s.id === activeSessionId;
                  const isLoading = s.id === loadingSession;
                  return (
                    <div
                      key={s.id}
                      onClick={() => selectSession(s.id)}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 6,
                        padding: "8px 10px",
                        borderRadius: 8,
                        cursor: streaming ? "not-allowed" : "pointer",
                        background: isActive ? C.sessionActive : "transparent",
                        opacity: isLoading ? 0.6 : 1,
                        marginBottom: 2,
                        transition: "background 0.12s",
                      }}
                      onMouseEnter={(e) => {
                        if (!isActive && !streaming) e.currentTarget.style.background = "rgba(255,255,255,0.04)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = isActive ? C.sessionActive : "transparent";
                      }}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          selectSession(s.id);
                        }
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 14,
                            fontWeight: 500,
                            color: isActive ? C.text : "rgba(255,255,255,0.78)",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            lineHeight: 1.4,
                          }}
                        >
                          {s.title}
                        </div>
                        <div style={{ fontSize: 11, color: C.textDim, marginTop: 3 }}>
                          {relativeTime(s.updatedAt)}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => handleDeleteSession(s.id, e)}
                        title="Delete this chat"
                        style={{
                          // Always visible so the button is reachable on touch
                          // devices too — subtle at rest, bright red on hover.
                          opacity: 0.45,
                          background: "transparent",
                          border: "none",
                          color: C.textMuted,
                          cursor: "pointer",
                          fontSize: 18,
                          lineHeight: 1,
                          padding: "4px 8px",
                          borderRadius: 6,
                          flexShrink: 0,
                          transition: "opacity 0.12s, color 0.12s, background 0.12s",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.opacity = "1";
                          e.currentTarget.style.color = "#fca5a5";
                          e.currentTarget.style.background = "rgba(220,38,38,0.12)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.opacity = "0.45";
                          e.currentTarget.style.color = C.textMuted;
                          e.currentTarget.style.background = "transparent";
                        }}
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </>
            )}
          </div>

          <div style={{ padding: "10px 12px", borderTop: `1px solid ${C.border}` }}>
            <Link
              href="/dashboard"
              style={{
                display: "block",
                textAlign: "center",
                fontSize: 12,
                color: C.textMuted,
                textDecoration: "none",
                padding: "6px 10px",
                borderRadius: 6,
                fontWeight: 500,
              }}
            >
              ← Back to Dashboard
            </Link>
          </div>
        </aside>
      )}

      {/* Animations + scrollbar */}
      <style>{`
        @keyframes ask-ai-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @keyframes ask-ai-bounce {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.5; }
          40% { transform: scale(1); opacity: 1; }
        }
        @keyframes ask-ai-fade-in {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .ask-ai-scroll::-webkit-scrollbar { width: 8px; }
        .ask-ai-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 4px; }
        .ask-ai-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.25); }
        .ask-ai-scroll::-webkit-scrollbar-track { background: transparent; }
      `}</style>
    </div>
  );
}

// ─── Empty state hero ────────────────────────────────────────────────────────

function EmptyHero({
  greeting,
  userName,
  onPick,
  disabled,
}: {
  greeting: string;
  userName: string;
  onPick: (text: string) => void;
  disabled: boolean;
}) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 20px",
        animation: "ask-ai-fade-in 0.4s ease-out",
      }}
    >
      <div
        style={{
          fontSize: 40,
          fontWeight: 500,
          letterSpacing: "-0.6px",
          color: C.text,
          marginBottom: 10,
          textAlign: "center",
        }}
      >
        {greeting}, <span style={{ color: C.accent }}>{userName}</span>.
      </div>
      <div style={{ fontSize: 20, color: C.textMuted, marginBottom: 36, textAlign: "center", fontWeight: 400 }}>
        How can I help today?
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", maxWidth: 640 }}>
        {PRESET_QUESTIONS.map((q) => (
          <Chip key={q} label={q} onClick={() => onPick(q)} disabled={disabled} />
        ))}
      </div>
    </div>
  );
}

// ─── Chip ────────────────────────────────────────────────────────────────────

function Chip({
  label,
  onClick,
  disabled,
  compact = false,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        fontSize: compact ? 13 : 15,
        padding: compact ? "7px 13px" : "10px 18px",
        borderRadius: 999,
        border: `1px solid ${C.border}`,
        background: "transparent",
        color: C.textMuted,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        fontWeight: 500,
        transition: "background 0.15s, color 0.15s, border-color 0.15s",
        whiteSpace: "nowrap",
      }}
      onMouseEnter={(e) => {
        if (disabled) return;
        e.currentTarget.style.background = "rgba(255,255,255,0.06)";
        e.currentTarget.style.color = C.text;
        e.currentTarget.style.borderColor = C.borderHi;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = C.textMuted;
        e.currentTarget.style.borderColor = C.border;
      }}
    >
      {label}
    </button>
  );
}

// ─── Message list ────────────────────────────────────────────────────────────

function MessageList({
  messages,
  streaming,
  onFollowUp,
  activeTool,
}: {
  messages: Msg[];
  streaming: boolean;
  onFollowUp: (q: string) => void;
  activeTool: string | null;
}) {
  return (
    <div
      style={{
        width: "100%",
        maxWidth: 760,
        margin: "0 auto",
        padding: "28px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 20,
      }}
    >
      {messages.map((m, i) => {
        const isLastAssistant = m.role === "assistant" && i === messages.length - 1;
        return (
          <MessageBubble
            key={i}
            role={m.role}
            content={m.content}
            images={m.images}
            costInr={m.costInr}
            isStreaming={streaming && isLastAssistant}
            // Tool-progress indicator only on the currently-generating assistant message
            activeTool={isLastAssistant && streaming ? activeTool : null}
            // Follow-up chips only render on the latest assistant message once
            // it's fully streamed — stale chips from earlier in the thread
            // would be confusing and cross-topic.
            onFollowUp={isLastAssistant && !streaming ? onFollowUp : undefined}
            followUpsDisabled={streaming}
          />
        );
      })}
    </div>
  );
}

function MessageBubble({
  role,
  content,
  images,
  costInr,
  isStreaming,
  activeTool,
  onFollowUp,
  followUpsDisabled,
}: {
  role: "user" | "assistant";
  content: string;
  images?: string[];
  costInr?: number;
  isStreaming: boolean;
  activeTool?: string | null;
  onFollowUp?: (q: string) => void;
  followUpsDisabled?: boolean;
}) {
  const isUser = role === "user";

  if (isUser) {
    return (
      <div style={{ display: "flex", justifyContent: "flex-end", animation: "ask-ai-fade-in 0.25s ease-out" }}>
        <div
          style={{
            maxWidth: "82%",
            padding: images && images.length > 0 ? "10px 10px 13px" : "13px 18px",
            borderRadius: 18,
            background: C.userBubble,
            color: C.text,
            fontSize: 17,
            lineHeight: 1.55,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {images && images.length > 0 && (
            <div style={{ display: "grid", gap: 6, gridTemplateColumns: `repeat(${Math.min(images.length, 3)}, minmax(0, 1fr))`, marginBottom: content ? 10 : 0 }}>
              {images.map((url, i) => (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  key={i}
                  src={url}
                  alt={`attachment ${i + 1}`}
                  style={{
                    width: "100%",
                    maxHeight: 220,
                    objectFit: "cover",
                    borderRadius: 10,
                    border: "1px solid rgba(255,255,255,0.12)",
                    display: "block",
                  }}
                />
              ))}
            </div>
          )}
          {content && <div style={{ padding: images && images.length > 0 ? "0 6px" : 0 }}>{content}</div>}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", gap: 12, animation: "ask-ai-fade-in 0.25s ease-out" }}>
      <div
        aria-hidden
        style={{
          flexShrink: 0,
          width: 32,
          height: 32,
          borderRadius: "50%",
          background: `linear-gradient(135deg, ${C.accent} 0%, ${C.accentDark} 100%)`,
          color: "#1a1a1a",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 16,
          fontWeight: 700,
          boxShadow: "0 2px 8px rgba(232,197,114,0.2)",
        }}
      >
        ✨
      </div>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          color: C.text,
          fontSize: 17,
          lineHeight: 1.65,
          wordBreak: "break-word",
          paddingTop: 4,
        }}
      >
        {content ? (
          <ChatMarkdown
            content={content}
            onFollowUp={onFollowUp}
            followUpsDisabled={followUpsDisabled}
          />
        ) : activeTool ? (
          <ToolProgress toolName={activeTool} />
        ) : (isStreaming ? <ThinkingDots /> : null)}
        {isStreaming && content && (
          <span
            style={{
              display: "inline-block",
              width: 7,
              height: 15,
              marginLeft: 2,
              background: C.accent,
              verticalAlign: "middle",
              animation: "ask-ai-pulse 1s step-end infinite",
            }}
          />
        )}
        {/* Read-aloud + cost pill — only on completed assistant replies */}
        {content && !isStreaming && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            <SpeakButton text={content} />
            {typeof costInr === "number" ? (
              <span
                title={`This reply cost ~₹${costInr.toFixed(2)} in AI tokens`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "5px 10px",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "#E8C572",
                  background: "rgba(232,197,114,0.12)",
                  border: "1px solid rgba(232,197,114,0.35)",
                  borderRadius: 999,
                  fontFamily: "ui-monospace, monospace",
                  letterSpacing: "-0.01em",
                }}
              >
                💰 ₹{costInr.toFixed(2)}
              </span>
            ) : (
              // Older chats loaded from history don't have a cost — show a
              // placeholder so the feature is still discoverable.
              <span
                title="Cost tracking not available for older chats"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "5px 10px",
                  fontSize: 12,
                  fontWeight: 500,
                  color: "rgba(255,255,255,0.4)",
                  background: "transparent",
                  border: "1px dashed rgba(255,255,255,0.18)",
                  borderRadius: 999,
                  fontFamily: "ui-monospace, monospace",
                }}
              >
                💰 ₹—
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * "🔍 Looking up today's cuts…" indicator while a Claude tool runs.
 * Fades between bouncing dots and the tool-specific label so the user
 * knows what the AI is doing instead of just seeing generic dots.
 */
function ToolProgress({ toolName }: { toolName: string }) {
  const label = TOOL_LABELS[toolName] || "⚙️ Working…";
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 12px",
        background: "rgba(232,197,114,0.08)",
        border: "1px solid rgba(232,197,114,0.25)",
        borderRadius: 999,
        fontSize: 13,
        color: "rgba(255,255,255,0.8)",
        fontWeight: 500,
      }}
    >
      <span>{label}</span>
      <ThinkingDots />
    </div>
  );
}

function ThinkingDots() {
  return (
    <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: 5,
            height: 5,
            borderRadius: "50%",
            background: "currentColor",
            animation: `ask-ai-bounce 1.2s ease-in-out infinite`,
            animationDelay: `${i * 0.16}s`,
          }}
        />
      ))}
    </span>
  );
}
