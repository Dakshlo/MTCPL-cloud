"use client";

/**
 * Client-side chat UI for /ask-ai.
 *
 * Features:
 *  - Streaming assistant replies via SSE from /api/ask-ai.
 *  - 6 preset question chips above the input (Hindi/English bilingual).
 *  - Voice-to-text via the browser Web Speech API, with a language toggle
 *    (en-IN / hi-IN). On unsupported browsers the mic is greyed-out with
 *    an explanatory tooltip.
 *  - Local message history (no DB persistence — cleared on page reload).
 *  - Auto-scroll to newest message.
 *  - Rate-limit message shown when the server returns 429.
 */

import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

type Msg = { role: "user" | "assistant"; content: string };

const PRESET_QUESTIONS = [
  "आज का काम क्या हुआ? / What happened today?",
  "कल की पूरी रिपोर्ट दो / Give me yesterday's full report",
  "कितने blocks available हैं? / How many blocks are available?",
  "Urgent slabs कौन-कौन से हैं? / What are the urgent slabs?",
  "Aasta Temple के लिए कितने blocks चाहिए? / How many blocks for Aasta Temple?",
  "पिछले हफ्ते कितनी cutting हुई? / How much cutting last week?",
];

// Minimal type for the browser SpeechRecognition API so we don't pull in libs
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

  // Detect Web Speech API availability once
  const speechSupported = useMemo(() => {
    if (typeof window === "undefined") return false;
    const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
    return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
  }, []);

  // Auto-scroll on new content
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streaming]);

  // Abort in-flight fetch on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      try { recognitionRef.current?.stop(); } catch { /* noop */ }
    };
  }, []);

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;

    setError(null);
    const nextMessages: Msg[] = [...messages, { role: "user", content: trimmed }, { role: "assistant", content: "" }];
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
        } catch { /* leave msg as HTTP N */ }
        setError(msg);
        setStreaming(false);
        // Drop the empty assistant placeholder
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

        // SSE events are delimited by \n\n
        let sepIdx;
        while ((sepIdx = buffer.indexOf("\n\n")) !== -1) {
          const raw = buffer.slice(0, sepIdx);
          buffer = buffer.slice(sepIdx + 2);

          // Very small SSE parser — good enough for our two event types
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
          // Default: message event with text delta (we used `\n` escape server-side)
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
    // Enter sends, Shift+Enter inserts newline
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  function handlePreset(text: string) {
    if (streaming) return;
    sendMessage(text);
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
    <div style={{ display: "flex", flexDirection: "column", gap: 14, height: "calc(100vh - 220px)", minHeight: 480 }}>
      {/* Message list */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: "auto",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: "16px 18px",
        }}
      >
        {messages.length === 0 ? (
          <div style={{ padding: "40px 10px", textAlign: "center", color: "var(--muted)" }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>👋</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>
              नमस्ते {userName}!
            </div>
            <div style={{ fontSize: 12 }}>
              Ask me anything about your stock, slabs, or cutting — type, tap a suggestion, or use the mic.
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {messages.map((m, i) => (
              <MessageBubble key={i} role={m.role} content={m.content} isStreaming={streaming && i === messages.length - 1 && m.role === "assistant"} />
            ))}
          </div>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div style={{ padding: "10px 14px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, fontSize: 12, color: "#991b1b" }}>
          {error}
        </div>
      )}

      {/* Preset question chips */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {PRESET_QUESTIONS.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => handlePreset(q)}
            disabled={streaming}
            style={{
              fontSize: 11,
              padding: "6px 11px",
              borderRadius: 20,
              border: "1px solid var(--border)",
              background: "var(--bg)",
              color: "var(--muted)",
              cursor: streaming ? "not-allowed" : "pointer",
              opacity: streaming ? 0.5 : 1,
              fontWeight: 500,
            }}
          >
            {q}
          </button>
        ))}
      </div>

      {/* Input row */}
      <form onSubmit={handleSubmit} style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={streaming}
          placeholder="Ask me anything…"
          rows={2}
          style={{
            flex: 1,
            padding: "10px 12px",
            fontSize: 14,
            border: "1px solid var(--border)",
            borderRadius: 8,
            background: "var(--bg)",
            color: "var(--text)",
            resize: "none",
            fontFamily: "inherit",
            lineHeight: 1.4,
          }}
        />

        {/* Voice lang toggle */}
        <button
          type="button"
          onClick={() => setVoiceLang((l) => (l === "en-IN" ? "hi-IN" : "en-IN"))}
          title="Switch voice input language"
          style={{
            padding: "8px 10px",
            fontSize: 11,
            fontWeight: 700,
            border: "1px solid var(--border)",
            borderRadius: 8,
            background: "var(--bg)",
            color: "var(--muted)",
            cursor: "pointer",
            whiteSpace: "nowrap",
            minWidth: 52,
          }}
        >
          {voiceLang === "hi-IN" ? "हिं" : "EN"}
        </button>

        {/* Mic button */}
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
            padding: "8px 12px",
            fontSize: 16,
            border: `1px solid ${listening ? "#dc2626" : "var(--border)"}`,
            borderRadius: 8,
            background: listening ? "#fef2f2" : "var(--bg)",
            color: speechSupported ? (listening ? "#dc2626" : "var(--text)") : "var(--muted)",
            cursor: !speechSupported ? "not-allowed" : "pointer",
            opacity: speechSupported ? 1 : 0.4,
          }}
        >
          {listening ? "● " : ""}🎤
        </button>

        {/* Send */}
        <button
          type="submit"
          disabled={streaming || !input.trim()}
          className="primary-button"
          style={{ padding: "10px 18px" }}
        >
          {streaming ? "…" : "Send"}
        </button>
      </form>

      <div style={{ fontSize: 10, color: "var(--muted)", textAlign: "center" }}>
        Replies are generated by Claude · they can occasionally make mistakes — verify anything important.
      </div>
    </div>
  );
}

// ─── Message bubble ──────────────────────────────────────────────────────────

function MessageBubble({ role, content, isStreaming }: { role: "user" | "assistant"; content: string; isStreaming: boolean }) {
  const isUser = role === "user";
  return (
    <div style={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start" }}>
      <div
        style={{
          maxWidth: "80%",
          padding: "10px 14px",
          borderRadius: 12,
          background: isUser ? "var(--gold)" : "var(--bg)",
          color: isUser ? "#fff" : "var(--text)",
          border: isUser ? "none" : "1px solid var(--border)",
          fontSize: 14,
          lineHeight: 1.55,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {content}
        {isStreaming && (
          <span
            aria-label="thinking"
            style={{
              display: "inline-block",
              width: 6,
              height: 14,
              marginLeft: 2,
              background: "var(--gold-dark)",
              verticalAlign: "middle",
              animation: "ask-ai-blink 1s step-end infinite",
            }}
          />
        )}
      </div>
      <style>{`@keyframes ask-ai-blink { 50% { opacity: 0; } }`}</style>
    </div>
  );
}
