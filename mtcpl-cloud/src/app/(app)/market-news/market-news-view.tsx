"use client";

// Liquid-glass "Today's News" page (Daksh, Jun 2026). A rich gradient backdrop
// with frosted-glass cards (Apple-iOS feel), a big bull/bear verdict, the day's
// curated bilingual news, and a market chat box. High-contrast white text so
// it stays readable over the glass.

import { useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { DailyNews, NewsItem } from "@/lib/market-news";
import { getMarketNewsByDateAction, askMarketQuestionAction } from "./actions";

const USD_TO_INR = 86;

function fmtDate(d: string): string {
  return new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
function fmtTime(iso: string): string {
  const dt = new Date(new Date(iso).getTime() + 5.5 * 3600 * 1000);
  return `${String(dt.getUTCHours()).padStart(2, "0")}:${String(dt.getUTCMinutes()).padStart(2, "0")} IST`;
}

const glass: CSSProperties = {
  background: "rgba(255,255,255,0.07)",
  backdropFilter: "blur(22px) saturate(150%)",
  WebkitBackdropFilter: "blur(22px) saturate(150%)",
  border: "1px solid rgba(255,255,255,0.16)",
  borderRadius: 20,
  boxShadow: "0 8px 32px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.20)",
};

const STANCE: Record<
  NonNullable<DailyNews["stance"]>,
  { label: string; labelHi: string; icon: string; accent: string; glow: string }
> = {
  bullish: { label: "Bullish", labelHi: "तेज़ी", icon: "🐂", accent: "#34d399", glow: "rgba(52,211,153,0.45)" },
  bearish: { label: "Bearish", labelHi: "मंदी", icon: "🐻", accent: "#f87171", glow: "rgba(248,113,113,0.45)" },
  neutral: { label: "Mixed / Cautious", labelHi: "मिला-जुला", icon: "⚖️", accent: "#fbbf24", glow: "rgba(251,191,36,0.4)" },
};

const SENT: Record<NewsItem["sentiment"], { fg: string; bg: string; mark: string }> = {
  positive: { fg: "#6ee7b7", bg: "rgba(16,185,129,0.18)", mark: "▲" },
  negative: { fg: "#fca5a5", bg: "rgba(239,68,68,0.18)", mark: "▼" },
  neutral: { fg: "rgba(255,255,255,0.7)", bg: "rgba(255,255,255,0.1)", mark: "•" },
};

type ChatMsg = { role: "user" | "ai"; text: string };

export function MarketNewsView({
  configured,
  news,
  dates,
}: {
  configured: boolean;
  news: DailyNews | null;
  dates: string[];
}) {
  const router = useRouter();
  const [lang, setLang] = useState<"en" | "hi">("en");
  const [current, setCurrent] = useState<DailyNews | null>(news);
  const [activeDate, setActiveDate] = useState<string>(news?.newsDate ?? "");
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Chat
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [asking, setAsking] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat, asking]);

  const t = (en: string, hi: string) => (lang === "en" ? en : hi);

  async function switchDate(date: string) {
    setActiveDate(date);
    if (!date) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await getMarketNewsByDateAction(date);
      if (res.ok) setCurrent(res.news);
      else setErr(res.error);
    } catch {
      setErr("Failed to load that day.");
    } finally {
      setBusy(false);
    }
  }

  async function generateNow() {
    if (generating) return;
    setGenerating(true);
    setErr(null);
    setMsg(t("Researching this morning's market news…", "आज की बाज़ार ख़बरें खोजी जा रही हैं…"));
    try {
      const res = await fetch("/api/market-news/generate", { method: "POST" });
      const data = (await res.json()) as { ok: boolean; newsDate?: string; count?: number; error?: string };
      if (!res.ok || !data.ok) {
        setErr(data.error || "Generation failed.");
        setMsg(null);
        return;
      }
      setMsg(`✓ ${data.count} ${t("stories for today.", "ख़बरें आज की।")}`);
      if (data.newsDate) {
        const fresh = await getMarketNewsByDateAction(data.newsDate);
        if (fresh.ok && fresh.news) {
          setCurrent(fresh.news);
          setActiveDate(data.newsDate);
        }
      }
      router.refresh();
    } catch {
      setErr("Generation failed — check the connection / API key.");
      setMsg(null);
    } finally {
      setGenerating(false);
    }
  }

  async function ask(question: string) {
    const qq = question.trim();
    if (!qq || asking) return;
    setChat((c) => [...c, { role: "user", text: qq }]);
    setInput("");
    setAsking(true);
    try {
      const res = await askMarketQuestionAction(qq, activeDate || current?.newsDate || "", lang);
      setChat((c) => [...c, { role: "ai", text: res.ok ? res.answer : `⚠ ${res.error}` }]);
    } catch {
      setChat((c) => [...c, { role: "ai", text: "⚠ Something went wrong. Try again." }]);
    } finally {
      setAsking(false);
    }
  }

  const stance = current?.stance ? STANCE[current.stance] : null;
  const overview = current ? (lang === "en" ? current.overviewEn : current.overviewHi) : null;
  const stanceNote = current ? (lang === "en" ? current.stanceNoteEn : current.stanceNoteHi) : null;

  const pill = (active: boolean): CSSProperties => ({
    fontSize: 12,
    fontWeight: 800,
    padding: "6px 12px",
    border: "none",
    cursor: "pointer",
    background: active ? "rgba(255,255,255,0.92)" : "transparent",
    color: active ? "#0b1026" : "rgba(255,255,255,0.8)",
  });

  return (
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        borderRadius: 24,
        background: "linear-gradient(160deg, #0a0f24 0%, #141a3c 38%, #1b1442 72%, #0c1230 100%)",
        padding: "clamp(16px, 3vw, 26px)",
        minHeight: "calc(100vh - 110px)",
      }}
    >
      <style>{`@keyframes mn-pulse{0%,100%{opacity:.55}50%{opacity:1}}@keyframes mn-dots{0%,20%{opacity:.2}50%{opacity:1}80%,100%{opacity:.2}}`}</style>
      {/* colour blobs for depth */}
      <div aria-hidden style={{ position: "absolute", top: -90, left: -70, width: 360, height: 360, borderRadius: "50%", background: "radial-gradient(circle, rgba(99,102,241,0.55), transparent 70%)", filter: "blur(46px)", pointerEvents: "none" }} />
      <div aria-hidden style={{ position: "absolute", bottom: -110, right: -50, width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle, rgba(20,184,166,0.4), transparent 70%)", filter: "blur(54px)", pointerEvents: "none" }} />
      <div aria-hidden style={{ position: "absolute", top: "42%", right: "34%", width: 280, height: 280, borderRadius: "50%", background: "radial-gradient(circle, rgba(236,72,153,0.28), transparent 70%)", filter: "blur(54px)", pointerEvents: "none" }} />

      <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 16, color: "#fff", maxWidth: 920, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Link href="/dashboard" style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.75)", textDecoration: "none" }}>← {t("Dashboard", "डैशबोर्ड")}</Link>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, letterSpacing: "-0.02em" }}>📰 {t("Today's News", "आज की ख़बरें")}</h1>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div style={{ display: "flex", borderRadius: 10, overflow: "hidden", border: "1px solid rgba(255,255,255,0.25)" }}>
              {(["en", "hi"] as const).map((l) => (
                <button key={l} type="button" onClick={() => setLang(l)} style={pill(lang === l)}>
                  {l === "en" ? "EN" : "हिं"}
                </button>
              ))}
            </div>
            {dates.length > 0 && (
              <select
                value={activeDate}
                onChange={(e) => switchDate(e.target.value)}
                disabled={busy}
                style={{ fontSize: 12.5, padding: "7px 10px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.25)", background: "rgba(255,255,255,0.1)", color: "#fff" }}
              >
                {dates.map((d) => (
                  <option key={d} value={d} style={{ color: "#111" }}>
                    {fmtDate(d)}
                  </option>
                ))}
              </select>
            )}
            <button type="button" onClick={generateNow} disabled={generating} style={{ fontSize: 12.5, fontWeight: 800, padding: "7px 14px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.25)", background: "rgba(255,255,255,0.12)", color: "#fff", cursor: "pointer" }}>
              {generating ? "⏳ …" : "↻ " + t("Generate now", "अभी बनाएँ")}
            </button>
          </div>
        </div>

        {msg && <div style={{ fontSize: 13, fontWeight: 700, color: "#6ee7b7" }}>{msg}</div>}
        {err && <div style={{ fontSize: 13, fontWeight: 700, color: "#fca5a5" }}>⚠ {err}</div>}

        {!configured ? (
          <div style={{ ...glass, padding: 22, fontSize: 14, color: "rgba(255,255,255,0.85)" }}>
            Run <code>migrations 152 + 153</code> and set <code>MTCPL_DAILY_NEWS</code> to enable the market brief.
          </div>
        ) : !current ? (
          <div style={{ ...glass, padding: 22, fontSize: 14, color: "rgba(255,255,255,0.85)" }}>
            {t("No brief yet — tap “Generate now”.", "अभी कोई ब्रीफ़ नहीं — “अभी बनाएँ” दबाएँ।")}
          </div>
        ) : current.error && current.items.length === 0 ? (
          <div style={{ ...glass, padding: 22, fontSize: 14, color: "#fca5a5" }}>⚠ {current.error}</div>
        ) : (
          <>
            {/* ── STANCE HERO ── */}
            <div style={{ ...glass, padding: "22px 24px", position: "relative", overflow: "hidden" }}>
              {stance && (
                <div aria-hidden style={{ position: "absolute", top: -40, right: -20, width: 200, height: 200, borderRadius: "50%", background: `radial-gradient(circle, ${stance.glow}, transparent 70%)`, filter: "blur(30px)", pointerEvents: "none" }} />
              )}
              <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
                <div style={{ fontSize: 52, lineHeight: 1 }}>{stance?.icon ?? "📊"}</div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(255,255,255,0.6)" }}>
                    {t("Today's market read", "आज का बाज़ार रुख़")}
                  </div>
                  <div style={{ fontSize: 30, fontWeight: 900, letterSpacing: "-0.02em", color: stance?.accent ?? "#fff", lineHeight: 1.1, marginTop: 2 }}>
                    {stance ? (lang === "en" ? stance.label : stance.labelHi) : "—"}
                  </div>
                  {stanceNote && <div style={{ fontSize: 14, color: "rgba(255,255,255,0.85)", marginTop: 6, lineHeight: 1.5 }}>{stanceNote}</div>}
                </div>
              </div>
              {overview && (
                <div style={{ position: "relative", marginTop: 16, paddingTop: 14, borderTop: "1px solid rgba(255,255,255,0.14)", fontSize: 14.5, fontWeight: 600, color: "rgba(255,255,255,0.92)", lineHeight: 1.55 }}>
                  🧭 {overview}
                </div>
              )}
            </div>

            {/* ── NEWS CARDS ── */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {current.items.map((it, i) => {
                const tone = SENT[it.sentiment] ?? SENT.neutral;
                return (
                  <div key={i} style={{ ...glass, padding: "16px 18px", borderLeft: `3px solid ${tone.fg}` }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                      <span style={{ fontSize: 16 }}>{it.icon}</span>
                      <span style={{ fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: "rgba(255,255,255,0.62)" }}>{it.category}</span>
                      <span style={{ fontSize: 11, fontWeight: 800, color: tone.fg, background: tone.bg, borderRadius: 999, padding: "1px 8px" }}>{tone.mark}</span>
                      {it.source_name && <span style={{ marginLeft: "auto", fontSize: 11, color: "rgba(255,255,255,0.5)" }}>{it.source_name}</span>}
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: "#fff", lineHeight: 1.35 }}>
                      {lang === "en" ? it.headline_en : it.headline_hi}
                    </div>
                    {(lang === "en" ? it.summary_en : it.summary_hi) && (
                      <div style={{ fontSize: 13.5, color: "rgba(255,255,255,0.82)", marginTop: 5, lineHeight: 1.55 }}>
                        {lang === "en" ? it.summary_en : it.summary_hi}
                      </div>
                    )}
                    {(lang === "en" ? it.impact_en : it.impact_hi) && (
                      <div style={{ fontSize: 12.5, color: tone.fg, fontWeight: 700, marginTop: 6 }}>↳ {lang === "en" ? it.impact_en : it.impact_hi}</div>
                    )}
                    {it.source_url && (
                      <a href={it.source_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "#93c5fd", textDecoration: "none", marginTop: 6, display: "inline-block" }}>
                        {t("Read source", "स्रोत पढ़ें")} ↗
                      </a>
                    )}
                  </div>
                );
              })}
            </div>

            {/* footer — generated time + cost */}
            <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.5)", display: "flex", gap: 10, flexWrap: "wrap" }}>
              <span>🕒 {fmtTime(current.generatedAt)}</span>
              <span>· {current.model}</span>
              <span>· {current.webSearches} {t("searches", "खोज")}</span>
              <span style={{ marginLeft: "auto" }}>💸 {t("Cost", "लागत")}: ${current.costUsd.toFixed(3)} (≈ ₹{Math.round(current.costUsd * USD_TO_INR)})</span>
            </div>
          </>
        )}

        {/* ── CHAT ── */}
        {configured && (
          <div style={{ ...glass, padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 18 }}>💬</span>
              <div style={{ fontSize: 15, fontWeight: 800 }}>{t("Ask the market", "बाज़ार से पूछें")}</div>
            </div>

            {chat.length === 0 ? (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {[
                  t("Why might Nifty move today?", "आज निफ्टी क्यों हिल सकता है?"),
                  t("What is gold doing?", "सोना क्या कर रहा है?"),
                  t("How is the rupee vs dollar?", "रुपया डॉलर के मुक़ाबले कैसा है?"),
                ].map((s, i) => (
                  <button key={i} type="button" onClick={() => ask(s)} style={{ fontSize: 12.5, fontWeight: 600, padding: "8px 12px", borderRadius: 999, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.9)", cursor: "pointer" }}>
                    {s}
                  </button>
                ))}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 360, overflowY: "auto", paddingRight: 4 }}>
                {chat.map((m, i) => (
                  <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "88%" }}>
                    <div
                      style={{
                        fontSize: 13.5,
                        lineHeight: 1.55,
                        padding: "10px 13px",
                        borderRadius: 14,
                        whiteSpace: "pre-wrap",
                        color: "#fff",
                        background: m.role === "user" ? "rgba(99,102,241,0.45)" : "rgba(255,255,255,0.1)",
                        border: "1px solid rgba(255,255,255,0.14)",
                      }}
                    >
                      {m.text}
                    </div>
                  </div>
                ))}
                {asking && (
                  <div style={{ alignSelf: "flex-start", fontSize: 18, color: "rgba(255,255,255,0.8)" }}>
                    <span style={{ animation: "mn-dots 1.2s infinite" }}>•</span>
                    <span style={{ animation: "mn-dots 1.2s infinite .2s" }}>•</span>
                    <span style={{ animation: "mn-dots 1.2s infinite .4s" }}>•</span>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                ask(input);
              }}
              style={{ display: "flex", gap: 8 }}
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={t("Ask anything about the market…", "बाज़ार के बारे में कुछ भी पूछें…")}
                disabled={asking}
                style={{ flex: 1, fontSize: 14, padding: "11px 14px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.1)", color: "#fff", outline: "none" }}
              />
              <button type="submit" disabled={asking || !input.trim()} style={{ fontSize: 14, fontWeight: 800, padding: "0 18px", borderRadius: 12, border: "none", background: asking || !input.trim() ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.92)", color: asking || !input.trim() ? "rgba(255,255,255,0.6)" : "#0b1026", cursor: asking || !input.trim() ? "not-allowed" : "pointer" }}>
                {t("Ask", "पूछें")}
              </button>
            </form>
            <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.45)" }}>
              {t("AI can be wrong — not financial advice. It can search the web for current data.", "AI ग़लत हो सकता है — यह निवेश सलाह नहीं है।")}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
