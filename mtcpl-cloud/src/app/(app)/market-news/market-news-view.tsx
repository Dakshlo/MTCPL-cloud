"use client";

// "Today's News" — iOS-style frosted glass (Daksh, Jun 2026). A FIXED, vibrant
// "heat" background sits behind a scroll layer; the frosted cards scroll over
// it, so the blur refracts a shifting band of colour as you scroll (the real
// iOS glass effect). News in a 2-up grid; tap a card for a centre-peek detail.
// Plus a daily stock / F&O ideas desk (buy/sell/watch + conviction).
// Developer + owner Naresh only.

import { useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { DailyNews, NewsItem, StockPick } from "@/lib/market-news";
import { getMarketNewsByDateAction, askMarketQuestionAction } from "./actions";

const USD_TO_INR = 86;

function fmtDate(d: string): string {
  return new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
  });
}
function fmtTime(iso: string): string {
  const dt = new Date(new Date(iso).getTime() + 5.5 * 3600 * 1000);
  return `${String(dt.getUTCHours()).padStart(2, "0")}:${String(dt.getUTCMinutes()).padStart(2, "0")} IST`;
}

// Dark frosted glass — translucent enough to refract the bright colours
// behind, dark enough to keep white text readable over them.
const glass: CSSProperties = {
  background: "rgba(20,13,38,0.52)",
  backdropFilter: "blur(26px) saturate(190%)",
  WebkitBackdropFilter: "blur(26px) saturate(190%)",
  border: "1px solid rgba(255,255,255,0.3)",
  borderRadius: 22,
  boxShadow: "0 12px 38px rgba(40,18,64,0.26), inset 0 1px 0 rgba(255,255,255,0.34)",
};

// Text that sits DIRECTLY on the bright background (titles, labels, footer)
// — must be dark to stay readable; white only lives inside the glass cards.
const INK = "#2a1145";
const INK_MUTED = "rgba(42,17,69,0.66)";

const STANCE: Record<
  NonNullable<DailyNews["stance"]>,
  { label: string; labelHi: string; icon: string; accent: string; glow: string }
> = {
  bullish: { label: "Bullish", labelHi: "तेज़ी", icon: "🐂", accent: "#34d399", glow: "rgba(52,211,153,0.5)" },
  bearish: { label: "Bearish", labelHi: "मंदी", icon: "🐻", accent: "#f87171", glow: "rgba(248,113,113,0.5)" },
  neutral: { label: "Mixed / Cautious", labelHi: "मिला-जुला", icon: "⚖️", accent: "#fbbf24", glow: "rgba(251,191,36,0.45)" },
};

const SENT: Record<NewsItem["sentiment"], { fg: string; bg: string; mark: string }> = {
  positive: { fg: "#6ee7b7", bg: "rgba(16,185,129,0.18)", mark: "▲" },
  negative: { fg: "#fca5a5", bg: "rgba(239,68,68,0.18)", mark: "▼" },
  neutral: { fg: "rgba(255,255,255,0.7)", bg: "rgba(255,255,255,0.1)", mark: "•" },
};

const ACTION: Record<StockPick["action"], { label: string; labelHi: string; fg: string; bg: string; bar: string; icon: string }> = {
  buy: { label: "BUY", labelHi: "ख़रीदें", fg: "#6ee7b7", bg: "rgba(16,185,129,0.2)", bar: "#34d399", icon: "▲" },
  sell: { label: "SELL", labelHi: "बेचें", fg: "#fca5a5", bg: "rgba(239,68,68,0.2)", bar: "#f87171", icon: "▼" },
  watch: { label: "WATCH", labelHi: "नज़र", fg: "#fcd34d", bg: "rgba(251,191,36,0.18)", bar: "#fbbf24", icon: "•" },
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
  const [peek, setPeek] = useState<NewsItem | null>(null);

  // Chat
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [asking, setAsking] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat, asking]);

  useEffect(() => {
    if (!peek) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setPeek(null); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [peek]);

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
  const picks = current?.picks ?? [];

  const pill = (active: boolean): CSSProperties => ({
    fontSize: 13, fontWeight: 800, padding: "7px 16px", border: "none", cursor: "pointer",
    background: active ? "#fff" : "transparent",
    color: active ? "#1a1030" : "#ffffff",
    minWidth: 44,
  });

  return (
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        borderRadius: 24,
        height: "calc(100dvh - 92px)",
        minHeight: 540,
        background: "#f4e9ff",
      }}
    >
      <style>{`
        @keyframes mn-pulse{0%,100%{opacity:.55}50%{opacity:1}}
        @keyframes mn-dots{0%,20%{opacity:.2}50%{opacity:1}80%,100%{opacity:.2}}
        @keyframes mn-f1{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(46px,34px) scale(1.08)}}
        @keyframes mn-f2{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(-54px,40px) scale(1.12)}}
        @keyframes mn-f3{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(34px,-44px) scale(1.1)}}
        @keyframes mn-f4{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(-30px,-30px) scale(1.06)}}
        .mn-card{transition:transform .14s ease, box-shadow .14s ease, border-color .14s ease}
        .mn-card:hover{transform:translateY(-2px);border-color:rgba(255,255,255,0.34)!important;box-shadow:0 16px 44px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.28)!important}
      `}</style>

      {/* ── FIXED bright "wallpaper" — does NOT scroll; the frosted cards
           cross it as you scroll, so the blur refracts a shifting band of
           vivid colour (the iOS glass effect). Light + high-variety on
           purpose, so the glass actually reads. ── */}
      <div aria-hidden style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg, #fef3c7 0%, #fbcfe8 22%, #ddd6fe 44%, #bfdbfe 64%, #a7f3d0 84%, #fde68a 100%)", pointerEvents: "none" }}>
        <div style={{ position: "absolute", top: "-12%", left: "-8%", width: 460, height: 460, borderRadius: "50%", background: "radial-gradient(circle, rgba(251,146,60,0.72), transparent 66%)", filter: "blur(54px)", animation: "mn-f1 16s ease-in-out infinite" }} />
        <div style={{ position: "absolute", bottom: "-16%", right: "-6%", width: 520, height: 520, borderRadius: "50%", background: "radial-gradient(circle, rgba(217,70,239,0.6), transparent 66%)", filter: "blur(58px)", animation: "mn-f2 19s ease-in-out infinite" }} />
        <div style={{ position: "absolute", top: "30%", right: "24%", width: 430, height: 430, borderRadius: "50%", background: "radial-gradient(circle, rgba(34,211,238,0.55), transparent 68%)", filter: "blur(56px)", animation: "mn-f3 22s ease-in-out infinite" }} />
        <div style={{ position: "absolute", top: "6%", right: "0%", width: 360, height: 360, borderRadius: "50%", background: "radial-gradient(circle, rgba(139,92,246,0.55), transparent 68%)", filter: "blur(52px)", animation: "mn-f4 17s ease-in-out infinite" }} />
        <div style={{ position: "absolute", bottom: "4%", left: "14%", width: 380, height: 380, borderRadius: "50%", background: "radial-gradient(circle, rgba(244,63,94,0.5), transparent 70%)", filter: "blur(56px)", animation: "mn-f1 21s ease-in-out infinite" }} />
        <div style={{ position: "absolute", top: "46%", left: "1%", width: 300, height: 300, borderRadius: "50%", background: "radial-gradient(circle, rgba(16,185,129,0.46), transparent 70%)", filter: "blur(52px)", animation: "mn-f2 18s ease-in-out infinite" }} />
      </div>

      {/* ── SCROLL LAYER — transparent so cards frost the fixed bg ── */}
      <div style={{ position: "relative", height: "100%", overflowY: "auto", padding: "clamp(14px, 2.6vw, 24px)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16, color: "#fff", maxWidth: 980, margin: "0 auto" }}>
          {/* Header — title, then the three controls in a full-width
              horizontal row of their own (so they never clip or stack). */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <Link href="/dashboard" style={{ fontSize: 13, fontWeight: 700, color: INK_MUTED, textDecoration: "none" }}>← {t("Dashboard", "डैशबोर्ड")}</Link>
              <h1 style={{ margin: 0, fontSize: 24, fontWeight: 900, letterSpacing: "-0.02em", color: INK }}>📰 {t("Today's News", "आज की ख़बरें")}</h1>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {/* Language toggle — EN / हिंदी */}
              <div style={{ display: "flex", borderRadius: 10, overflow: "hidden", border: "1px solid rgba(255,255,255,0.45)", background: "rgba(24,15,44,0.9)", flexShrink: 0 }}>
                {(["en", "hi"] as const).map((l) => (
                  <button key={l} type="button" onClick={() => setLang(l)} style={pill(lang === l)}>
                    {l === "en" ? "EN" : "हिंदी"}
                  </button>
                ))}
              </div>
              {dates.length > 0 && (
                <select
                  value={activeDate}
                  onChange={(e) => switchDate(e.target.value)}
                  disabled={busy}
                  style={{ fontSize: 12.5, padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.28)", background: "rgba(24,15,44,0.82)", color: "#fff", fontWeight: 600 }}
                >
                  {dates.map((d) => (
                    <option key={d} value={d} style={{ color: "#111" }}>{fmtDate(d)}</option>
                  ))}
                </select>
              )}
              <button type="button" onClick={generateNow} disabled={generating} style={{ fontSize: 12.5, fontWeight: 800, padding: "8px 14px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.28)", background: "rgba(24,15,44,0.82)", color: "#fff", cursor: "pointer", whiteSpace: "nowrap" }}>
                {generating ? "⏳ …" : "↻ " + t("Generate now", "अभी बनाएँ")}
              </button>
            </div>
          </div>

          {msg && <div style={{ fontSize: 13, fontWeight: 800, color: "#047857" }}>{msg}</div>}
          {err && <div style={{ fontSize: 13, fontWeight: 800, color: "#b91c1c" }}>⚠ {err}</div>}

          {!configured ? (
            <div style={{ ...glass, padding: 22, fontSize: 14, color: "rgba(255,255,255,0.85)" }}>
              Run <code>migrations 152 + 153 + 156</code> and set <code>MTCPL_DAILY_NEWS</code> to enable the market brief.
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
                  <div aria-hidden style={{ position: "absolute", top: -40, right: -20, width: 220, height: 220, borderRadius: "50%", background: `radial-gradient(circle, ${stance.glow}, transparent 70%)`, filter: "blur(34px)", pointerEvents: "none" }} />
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

              {/* ── IDEAS DESK (stock / F&O picks) ── */}
              {picks.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ fontSize: 16, fontWeight: 900, letterSpacing: "-0.01em", color: INK }}>💹 {t("Today's Ideas", "आज के आइडिया")}</div>
                    <div style={{ fontSize: 11.5, color: INK_MUTED, fontWeight: 600 }}>{t("Stock / F&O focus — ideas only, can be wrong. Not advice.", "स्टॉक / F&O फोकस — सिर्फ़ आइडिया, ग़लत हो सकते हैं। सलाह नहीं।")}</div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 320px), 1fr))", gap: 12 }}>
                    {picks.map((p, i) => {
                      const a = ACTION[p.action] ?? ACTION.watch;
                      return (
                        <div key={i} style={{ ...glass, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8, borderLeft: `3px solid ${a.bar}` }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 11.5, fontWeight: 900, letterSpacing: "0.04em", color: a.fg, background: a.bg, borderRadius: 8, padding: "3px 9px" }}>{a.icon} {lang === "en" ? a.label : a.labelHi}</span>
                            <span style={{ fontSize: 15, fontWeight: 800, color: "#fff" }}>{p.symbol}</span>
                            <span style={{ fontSize: 9.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "rgba(255,255,255,0.6)", border: "1px solid rgba(255,255,255,0.22)", borderRadius: 6, padding: "1px 6px" }}>{p.segment === "fno" ? "F&O" : t("Equity", "इक्विटी")}</span>
                            <span style={{ marginLeft: "auto", fontSize: 11, color: "rgba(255,255,255,0.55)" }}>{p.horizon}</span>
                          </div>
                          {p.name && p.name !== p.symbol && (
                            <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.72)", marginTop: -2 }}>{p.name}</div>
                          )}
                          {/* conviction bar */}
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ flex: 1, height: 7, borderRadius: 999, background: "rgba(255,255,255,0.14)", overflow: "hidden" }}>
                              <div style={{ width: `${Math.max(3, p.conviction)}%`, height: "100%", borderRadius: 999, background: a.bar }} />
                            </div>
                            <span style={{ fontSize: 12.5, fontWeight: 900, color: a.fg, minWidth: 38, textAlign: "right" }}>{p.conviction}%</span>
                          </div>
                          <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.85)", lineHeight: 1.5 }}>{lang === "en" ? p.reason_en : p.reason_hi}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ── NEWS CARDS — 2 per row, click for centre-peek ── */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 340px), 1fr))", gap: 14 }}>
                {current.items.map((it, i) => {
                  const tone = SENT[it.sentiment] ?? SENT.neutral;
                  const summary = lang === "en" ? it.summary_en : it.summary_hi;
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setPeek(it)}
                      className="mn-card"
                      style={{ ...glass, padding: "15px 17px", borderLeft: `3px solid ${tone.fg}`, textAlign: "left", cursor: "pointer", color: "#fff", display: "flex", flexDirection: "column" }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                        <span style={{ fontSize: 16 }}>{it.icon}</span>
                        <span style={{ fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: "rgba(255,255,255,0.62)" }}>{it.category}</span>
                        <span style={{ fontSize: 11, fontWeight: 800, color: tone.fg, background: tone.bg, borderRadius: 999, padding: "1px 8px" }}>{tone.mark}</span>
                        {it.source_name && <span style={{ marginLeft: "auto", fontSize: 11, color: "rgba(255,255,255,0.5)" }}>{it.source_name}</span>}
                      </div>
                      <div style={{ fontSize: 15.5, fontWeight: 800, color: "#fff", lineHeight: 1.35 }}>
                        {lang === "en" ? it.headline_en : it.headline_hi}
                      </div>
                      {summary && (
                        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.78)", marginTop: 5, lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                          {summary}
                        </div>
                      )}
                      <div style={{ marginTop: "auto", paddingTop: 8, fontSize: 11.5, fontWeight: 700, color: tone.fg }}>{t("Tap for detail", "विवरण देखें")} →</div>
                    </button>
                  );
                })}
              </div>

              {/* footer — generated time + cost */}
              <div style={{ fontSize: 11.5, color: INK_MUTED, fontWeight: 600, display: "flex", gap: 10, flexWrap: "wrap" }}>
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
                          fontSize: 13.5, lineHeight: 1.55, padding: "10px 13px", borderRadius: 14,
                          whiteSpace: "pre-wrap", color: "#fff",
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

              <form onSubmit={(e) => { e.preventDefault(); ask(input); }} style={{ display: "flex", gap: 8 }}>
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={t("Ask anything about the market…", "बाज़ार के बारे में कुछ भी पूछें…")}
                  disabled={asking}
                  style={{ flex: 1, fontSize: 14, padding: "11px 14px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(20,16,40,0.5)", color: "#fff", outline: "none" }}
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

      {/* ── CENTRE-PEEK detail for a tapped news card ── */}
      {peek && (
        <div
          onMouseDown={(e) => { if (e.target === e.currentTarget) setPeek(null); }}
          style={{ position: "fixed", inset: 0, left: "var(--content-left, 0px)", background: "rgba(6,4,12,0.62)", backdropFilter: "blur(6px)", zIndex: 1300, display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}
        >
          {(() => {
            const tone = SENT[peek.sentiment] ?? SENT.neutral;
            return (
              <div role="dialog" aria-modal="true" style={{ background: "rgba(20,15,34,0.86)", backdropFilter: "blur(30px) saturate(180%)", WebkitBackdropFilter: "blur(30px) saturate(180%)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 22, boxShadow: "0 24px 70px rgba(0,0,0,0.55)", width: "100%", maxWidth: 560, maxHeight: "86vh", overflowY: "auto", padding: 24, color: "#fff", borderLeft: `3px solid ${tone.fg}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                  <span style={{ fontSize: 22 }}>{peek.icon}</span>
                  <span style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: "rgba(255,255,255,0.65)" }}>{peek.category}</span>
                  <span style={{ fontSize: 12, fontWeight: 800, color: tone.fg, background: tone.bg, borderRadius: 999, padding: "2px 10px" }}>{tone.mark} {peek.sentiment}</span>
                  <button type="button" onClick={() => setPeek(null)} style={{ marginLeft: "auto", fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.7)", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 8, padding: "5px 11px", cursor: "pointer" }}>✕</button>
                </div>
                <div style={{ fontSize: 20, fontWeight: 900, lineHeight: 1.3, letterSpacing: "-0.01em" }}>
                  {lang === "en" ? peek.headline_en : peek.headline_hi}
                </div>
                {(lang === "en" ? peek.summary_en : peek.summary_hi) && (
                  <div style={{ fontSize: 14.5, color: "rgba(255,255,255,0.88)", marginTop: 12, lineHeight: 1.6 }}>
                    {lang === "en" ? peek.summary_en : peek.summary_hi}
                  </div>
                )}
                {(lang === "en" ? peek.impact_en : peek.impact_hi) && (
                  <div style={{ marginTop: 14, padding: "12px 14px", borderRadius: 14, background: tone.bg, border: `1px solid ${tone.fg}33` }}>
                    <div style={{ fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: tone.fg, marginBottom: 3 }}>{t("Why it matters", "क्यों मायने रखता है")}</div>
                    <div style={{ fontSize: 14, color: "#fff", fontWeight: 600, lineHeight: 1.5 }}>↳ {lang === "en" ? peek.impact_en : peek.impact_hi}</div>
                  </div>
                )}
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
                  {peek.source_name && <span style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>📄 {peek.source_name}</span>}
                  {peek.source_url && (
                    <a href={peek.source_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, fontWeight: 700, color: "#93c5fd", textDecoration: "none", marginLeft: "auto" }}>
                      {t("Read full source", "पूरा स्रोत पढ़ें")} ↗
                    </a>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
