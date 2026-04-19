"use client";

/**
 * Full-viewport dark chat — modeled after Claude.ai's new-tab look.
 *
 * Layout states:
 *   - Empty (no messages yet)  → centered greeting, suggestion chips below,
 *                                input pinned at the bottom.
 *   - Populated                → messages scroll, input stays pinned, chips
 *                                move above the input as a compact row.
 *
 * The whole thing is a fixed overlay (`position: fixed; inset: 0`) so it
 * covers the app sidebar and uses a dark palette without affecting the rest
 * of the app's light theme. A small "Back to Dashboard" link in the header
 * is the only way out.
 */

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

type Msg = { role: "user" | "assistant"; content: string };

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
  errorBg: "rgba(220,38,38,0.12)",
  errorBorder: "rgba(220,38,38,0.4)",
  errorText: "#fca5a5",
};

export function AskAiChat({ userName }: { userName: string }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voiceLang, setVoiceLang] = useState<"en-IN" | "hi-IN">("en-IN");
  const [listening, setListening] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const recognitionRef = useRef<SRType | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isEmpty = messages.length === 0;

  // Time-based greeting to match the dashboard's greeting tone
  const greeting = useMemo(() => {
    const hr = new Date().getHours();
    if (hr < 12) return "Good morning";
    if (hr < 17) return "Good afternoon";
    return "Good evening";
  }, []);

  // Detect Web Speech API availability once
  const speechSupported = useMemo(() => {
    if (typeof window === "undefined") return false;
    const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
    return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
  }, []);

  // Auto-scroll to newest
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streaming]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      try { recognitionRef.current?.stop(); } catch { /* noop */ }
    };
  }, []);

  // Auto-grow textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 180) + "px";
  }, [input]);

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;

    setError(null);
    const nextMessages: Msg[] = [
      ...messages,
      { role: "user", content: trimmed },
      { role: "assistant", content: "" },
    ];
    setMessages(nextMessages);
    setInput("");
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/ask-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages.slice(0, -1).map((m) => ({ role: m.role, content: m.content })),
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

          if (eventName === "error") {
            setError(data || "AI returned an error");
            continue;
          }
          if (eventName === "done" || data === "[DONE]") {
            continue;
          }
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
      abortRef.current = null;
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

  function clearChat() {
    if (streaming) return;
    if (!confirm("Clear this conversation?")) return;
    setMessages([]);
    setError(null);
    setInput("");
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
        position: "fixed",
        inset: 0,
        background: C.bg,
        zIndex: 50,
        display: "flex",
        flexDirection: "column",
        color: C.text,
        fontFamily: "inherit",
      }}
    >
      {/* ── Top bar ─────────────────────────────────────────────────── */}
      <header
        style={{
          flexShrink: 0,
          padding: "14px 22px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: `1px solid ${C.border}`,
        }}
      >
        <Link
          href="/dashboard"
          style={{
            color: C.textMuted,
            textDecoration: "none",
            fontSize: 13,
            fontWeight: 500,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 10px",
            borderRadius: 8,
            transition: "background 0.15s",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.05)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          ← Dashboard
        </Link>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: C.text, letterSpacing: "-0.2px" }}>
            ✨ MTCPL AI
          </span>
          {messages.length > 0 && (
            <button
              type="button"
              onClick={clearChat}
              disabled={streaming}
              style={{
                fontSize: 11,
                padding: "5px 10px",
                background: "transparent",
                color: C.textMuted,
                border: `1px solid ${C.border}`,
                borderRadius: 6,
                cursor: streaming ? "not-allowed" : "pointer",
                fontWeight: 500,
              }}
              title="Clear conversation"
            >
              New chat
            </button>
          )}
        </div>
      </header>

      {/* ── Scrollable content ─────────────────────────────────────── */}
      <main
        ref={scrollRef}
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
          <MessageList messages={messages} streaming={streaming} />
        )}
      </main>

      {/* ── Error banner (floats above input) ──────────────────────── */}
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
            style={{
              float: "right",
              background: "transparent",
              border: "none",
              color: C.errorText,
              cursor: "pointer",
              fontSize: 14,
              padding: 0,
              marginLeft: 10,
            }}
          >
            ×
          </button>
        </div>
      )}

      {/* ── Input area (pinned) ────────────────────────────────────── */}
      <footer
        style={{
          flexShrink: 0,
          padding: "0 16px 16px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        {/* Compact chips row when populated (full hero handles empty-state chips) */}
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
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={streaming}
            placeholder={isEmpty ? "Ask me anything about blocks, slabs, cutting..." : "Reply..."}
            rows={1}
            style={{
              width: "100%",
              background: "transparent",
              border: "none",
              outline: "none",
              color: C.text,
              fontSize: 15,
              lineHeight: 1.5,
              resize: "none",
              fontFamily: "inherit",
              padding: "8px 10px 4px",
              minHeight: 36,
              maxHeight: 180,
            }}
          />

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            {/* Left: voice controls */}
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button
                type="button"
                onClick={() => setVoiceLang((l) => (l === "en-IN" ? "hi-IN" : "en-IN"))}
                title="Toggle voice input language"
                style={{
                  padding: "6px 10px",
                  fontSize: 11,
                  fontWeight: 700,
                  background: "transparent",
                  color: C.textMuted,
                  border: `1px solid ${C.border}`,
                  borderRadius: 8,
                  cursor: "pointer",
                  minWidth: 46,
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
                  padding: "6px 10px",
                  fontSize: 15,
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

            {/* Right: send */}
            <button
              type="submit"
              disabled={streaming || !input.trim()}
              style={{
                width: 36,
                height: 36,
                borderRadius: "50%",
                border: "none",
                background: streaming || !input.trim() ? "rgba(255,255,255,0.08)" : C.accent,
                color: streaming || !input.trim() ? C.textDim : "#1a1a1a",
                cursor: streaming || !input.trim() ? "not-allowed" : "pointer",
                fontSize: 18,
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

        <div style={{ fontSize: 11, color: C.textDim, textAlign: "center", marginTop: 10 }}>
          MTCPL AI can make mistakes — verify anything important.
        </div>
      </footer>

      {/* Animations */}
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
        /* Override the app's global scrollbar for this page only */
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
          fontSize: 34,
          fontWeight: 500,
          letterSpacing: "-0.5px",
          color: C.text,
          marginBottom: 8,
          textAlign: "center",
        }}
      >
        {greeting}, <span style={{ color: C.accent }}>{userName}</span>.
      </div>
      <div
        style={{
          fontSize: 17,
          color: C.textMuted,
          marginBottom: 32,
          textAlign: "center",
          fontWeight: 400,
        }}
      >
        How can I help today?
      </div>

      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          justifyContent: "center",
          maxWidth: 640,
        }}
      >
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
        fontSize: compact ? 11 : 13,
        padding: compact ? "6px 11px" : "8px 14px",
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

function MessageList({ messages, streaming }: { messages: Msg[]; streaming: boolean }) {
  return (
    <div
      className="ask-ai-scroll"
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
      {messages.map((m, i) => (
        <MessageBubble
          key={i}
          role={m.role}
          content={m.content}
          isStreaming={streaming && i === messages.length - 1 && m.role === "assistant"}
        />
      ))}
    </div>
  );
}

function MessageBubble({ role, content, isStreaming }: { role: "user" | "assistant"; content: string; isStreaming: boolean }) {
  const isUser = role === "user";

  if (isUser) {
    return (
      <div style={{ display: "flex", justifyContent: "flex-end", animation: "ask-ai-fade-in 0.25s ease-out" }}>
        <div
          style={{
            maxWidth: "82%",
            padding: "11px 16px",
            borderRadius: 18,
            background: C.userBubble,
            color: C.text,
            fontSize: 15,
            lineHeight: 1.55,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {content}
        </div>
      </div>
    );
  }

  // Assistant: no bubble, just text flowing full-width
  return (
    <div style={{ display: "flex", gap: 12, animation: "ask-ai-fade-in 0.25s ease-out" }}>
      <div
        aria-hidden
        style={{
          flexShrink: 0,
          width: 28,
          height: 28,
          borderRadius: "50%",
          background: `linear-gradient(135deg, ${C.accent} 0%, ${C.accentDark} 100%)`,
          color: "#1a1a1a",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 14,
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
          fontSize: 15,
          lineHeight: 1.65,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          paddingTop: 3,
        }}
      >
        {content || (isStreaming ? <ThinkingDots /> : null)}
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
      </div>
    </div>
  );
}

// ─── Thinking dots (used in send button while streaming, and as assistant placeholder) ─

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
