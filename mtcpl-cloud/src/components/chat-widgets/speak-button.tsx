"use client";

/**
 * Text-to-speech button for an assistant reply. Uses the browser's Web
 * Speech API — same family as the mic input. Auto-detects Hindi (presence
 * of Devanagari) vs English (default) and picks a matching voice.
 *
 * Strips markdown formatting and widget markers before speaking so the
 * reader doesn't say "asterisk asterisk 45 asterisk asterisk blocks".
 */

import { useEffect, useRef, useState } from "react";

/** Crude but effective: removes markdown syntax + our widget markers. */
function toPlain(text: string): string {
  let s = text;
  // Remove all widget markers entirely (CHART / BLOCK / STATS / FOLLOWUPS / TEMPLE / LINK)
  s = s.replace(/\[\[(CHART|BLOCK|STATS|FOLLOWUPS|TEMPLE|LINK):[\s\S]*?\]\]/g, "");
  // Code fences
  s = s.replace(/```[\s\S]*?```/g, "");
  // Inline code `x` → x
  s = s.replace(/`([^`]+)`/g, "$1");
  // Bold/italic marks
  s = s.replace(/\*\*([^*]+)\*\*/g, "$1");
  s = s.replace(/\*([^*\n]+)\*/g, "$1");
  s = s.replace(/__([^_]+)__/g, "$1");
  // Markdown links [text](href) → text
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  // Heading hashes
  s = s.replace(/^\s*#+\s*/gm, "");
  // Blockquote prefix
  s = s.replace(/^\s*>\s*/gm, "");
  // List markers
  s = s.replace(/^\s*[-*+]\s+/gm, "");
  s = s.replace(/^\s*\d+\.\s+/gm, "");
  // Table pipes → spaces
  s = s.replace(/\|/g, " ");
  // Horizontal rules
  s = s.replace(/^\s*[-=]{3,}\s*$/gm, "");
  // Collapse whitespace
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function detectLang(text: string): "hi-IN" | "en-IN" {
  return /[\u0900-\u097F]/.test(text) ? "hi-IN" : "en-IN";
}

export function SpeakButton({ text }: { text: string }) {
  const [playing, setPlaying] = useState(false);
  const [supported, setSupported] = useState(false);
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    setSupported(typeof window !== "undefined" && "speechSynthesis" in window);
  }, []);

  // Stop on unmount
  useEffect(() => {
    return () => {
      try { window.speechSynthesis?.cancel(); } catch { /* noop */ }
    };
  }, []);

  if (!supported) return null;

  function handleClick() {
    const synth = window.speechSynthesis;
    if (!synth) return;

    if (playing) {
      synth.cancel();
      setPlaying(false);
      return;
    }

    const plain = toPlain(text);
    if (!plain) return;

    synth.cancel(); // clear any queued
    const u = new SpeechSynthesisUtterance(plain);
    u.lang = detectLang(plain);
    u.rate = 0.95;
    u.pitch = 1.0;

    // Pick a matching voice if available (voices may load async)
    const voices = synth.getVoices();
    const voice =
      voices.find((v) => v.lang === u.lang) ||
      voices.find((v) => v.lang.startsWith(u.lang.slice(0, 2)));
    if (voice) u.voice = voice;

    u.onend = () => setPlaying(false);
    u.onerror = () => setPlaying(false);

    utterRef.current = u;
    synth.speak(u);
    setPlaying(true);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      title={playing ? "Stop reading" : "Read aloud"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "4px 8px",
        marginTop: 10,
        fontSize: 12,
        background: playing ? "rgba(232,197,114,0.15)" : "transparent",
        color: playing ? "#E8C572" : "rgba(255,255,255,0.5)",
        border: `1px solid ${playing ? "rgba(232,197,114,0.4)" : "rgba(255,255,255,0.12)"}`,
        borderRadius: 6,
        cursor: "pointer",
        fontWeight: 500,
        transition: "all 0.15s",
      }}
      onMouseEnter={(e) => {
        if (!playing) {
          e.currentTarget.style.color = "rgba(255,255,255,0.85)";
          e.currentTarget.style.borderColor = "rgba(255,255,255,0.25)";
        }
      }}
      onMouseLeave={(e) => {
        if (!playing) {
          e.currentTarget.style.color = "rgba(255,255,255,0.5)";
          e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)";
        }
      }}
    >
      {playing ? (
        <>
          <span style={{ display: "inline-block", width: 6, height: 6, background: "currentColor", borderRadius: "50%", animation: "ask-ai-pulse 1.2s ease-in-out infinite" }} />
          Stop
        </>
      ) : (
        <>🔊 Read aloud</>
      )}
    </button>
  );
}
