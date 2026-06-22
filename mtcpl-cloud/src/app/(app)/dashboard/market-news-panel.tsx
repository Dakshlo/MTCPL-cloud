"use client";

// Owner-only "Today's News" panel. Bilingual market brief (English ⟷ हिंदी
// toggle), icon + source cards, a "cost to generate" line, history browsing,
// and an owner "Generate now" button. Data comes from the server card; types
// are imported type-only so no server code lands in the client bundle.

import { useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import type { DailyNews, NewsItem } from "@/lib/market-news";
import { getMarketNewsByDateAction } from "./market-news-actions";

const USD_TO_INR = 86; // display-only ₹ conversion (kept in sync with lib)

function fmtDate(d: string): string {
  const dt = new Date(`${d}T00:00:00`);
  return dt.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}
function fmtTime(iso: string): string {
  const dt = new Date(new Date(iso).getTime() + 5.5 * 3600 * 1000);
  return `${String(dt.getUTCHours()).padStart(2, "0")}:${String(dt.getUTCMinutes()).padStart(2, "0")} IST`;
}

const SENTIMENT: Record<NewsItem["sentiment"], { bg: string; fg: string; label: string }> = {
  positive: { bg: "rgba(22,163,74,0.12)", fg: "#15803d", label: "▲" },
  negative: { bg: "rgba(220,38,38,0.12)", fg: "#b91c1c", label: "▼" },
  neutral: { bg: "rgba(100,116,139,0.12)", fg: "#475569", label: "•" },
};

const cardStyle: CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: "20px 22px",
};

export function MarketNewsPanel({
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
    setMsg("Researching this morning's market news…");
    try {
      const res = await fetch("/api/market-news/generate", { method: "POST" });
      const data = (await res.json()) as { ok: boolean; newsDate?: string; count?: number; error?: string };
      if (!res.ok || !data.ok) {
        setErr(data.error || "Generation failed.");
        setMsg(null);
        return;
      }
      setMsg(`✓ ${data.count} stories for today.`);
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

  // ── Setup / empty states ──────────────────────────────────────────
  if (!configured) {
    return (
      <div style={cardStyle}>
        <Header lang={lang} setLang={setLang} />
        <p className="muted" style={{ fontSize: 13, margin: "10px 0 0" }}>
          Run <code>migration 152</code> (daily_news) and set <code>ANTHROPIC_API_KEY</code> to enable the morning market brief.
        </p>
      </div>
    );
  }

  return (
    <div style={cardStyle}>
      <Header lang={lang} setLang={setLang}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {dates.length > 0 && (
            <select
              value={activeDate}
              onChange={(e) => switchDate(e.target.value)}
              disabled={busy}
              style={{
                fontSize: 12.5,
                padding: "6px 10px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--bg)",
                color: "var(--text)",
              }}
            >
              {dates.map((d) => (
                <option key={d} value={d}>
                  {fmtDate(d)}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={generateNow}
            disabled={generating}
            className="ghost-button"
            style={{ fontSize: 12.5, padding: "6px 12px", minHeight: 34 }}
          >
            {generating ? "⏳ Generating…" : "↻ Generate now"}
          </button>
        </div>
      </Header>

      {msg && <div style={{ fontSize: 12.5, fontWeight: 700, color: "#15803d", marginTop: 8 }}>{msg}</div>}
      {err && <div style={{ fontSize: 12.5, fontWeight: 700, color: "#b91c1c", marginTop: 8 }}>⚠ {err}</div>}

      {!current ? (
        <p className="muted" style={{ fontSize: 13, margin: "12px 0 0" }}>
          {t("No brief yet — tap “Generate now”.", "अभी कोई ब्रीफ़ नहीं — “Generate now” दबाएँ।")}
        </p>
      ) : current.error && current.items.length === 0 ? (
        <p style={{ fontSize: 13, margin: "12px 0 0", color: "#b91c1c" }}>⚠ {current.error}</p>
      ) : (
        <>
          {/* Market mood */}
          {(lang === "en" ? current.overviewEn : current.overviewHi) && (
            <div
              style={{
                marginTop: 12,
                padding: "10px 14px",
                background: "rgba(180,115,51,0.07)",
                border: "1px solid rgba(180,115,51,0.25)",
                borderRadius: 10,
                fontSize: 13.5,
                fontWeight: 600,
                color: "var(--text)",
              }}
            >
              🧭 {lang === "en" ? current.overviewEn : current.overviewHi}
            </div>
          )}

          {/* Stories */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
            {current.items.map((it, i) => {
              const tone = SENTIMENT[it.sentiment] ?? SENTIMENT.neutral;
              return (
                <div
                  key={i}
                  style={{
                    border: "1px solid var(--border)",
                    borderLeft: `4px solid ${tone.fg}`,
                    borderRadius: 10,
                    padding: "12px 14px",
                    background: "var(--bg)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                    <span style={{ fontSize: 15 }}>{it.icon}</span>
                    <span
                      style={{
                        fontSize: 10.5,
                        fontWeight: 800,
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        color: "var(--muted)",
                      }}
                    >
                      {it.category}
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 800, color: tone.fg, background: tone.bg, borderRadius: 999, padding: "1px 8px" }}>
                      {tone.label}
                    </span>
                    {it.source_name && (
                      <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--muted)" }}>{it.source_name}</span>
                    )}
                  </div>
                  <div style={{ fontSize: 14.5, fontWeight: 800, color: "var(--text)", lineHeight: 1.35 }}>
                    {lang === "en" ? it.headline_en : it.headline_hi}
                  </div>
                  {(lang === "en" ? it.summary_en : it.summary_hi) && (
                    <div style={{ fontSize: 13, color: "var(--text)", marginTop: 4, lineHeight: 1.5 }}>
                      {lang === "en" ? it.summary_en : it.summary_hi}
                    </div>
                  )}
                  {(lang === "en" ? it.impact_en : it.impact_hi) && (
                    <div style={{ fontSize: 12, color: tone.fg, fontWeight: 700, marginTop: 5 }}>
                      ↳ {lang === "en" ? it.impact_en : it.impact_hi}
                    </div>
                  )}
                  {it.source_url && (
                    <a
                      href={it.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: 11.5, color: "#1d4ed8", textDecoration: "none", marginTop: 5, display: "inline-block" }}
                    >
                      {t("Read source", "स्रोत पढ़ें")} ↗
                    </a>
                  )}
                </div>
              );
            })}
          </div>

          {/* Footer — generated time + cost to generate */}
          <div style={{ marginTop: 14, paddingTop: 10, borderTop: "1px solid var(--border)", fontSize: 11, color: "var(--muted)", display: "flex", gap: 10, flexWrap: "wrap" }}>
            <span>🕒 {fmtTime(current.generatedAt)}</span>
            <span>· {current.model}</span>
            <span>· {current.webSearches} {t("searches", "खोज")}</span>
            <span style={{ marginLeft: "auto", fontWeight: 700, color: "var(--text)" }}>
              💸 {t("Cost to generate", "लागत")}: ${current.costUsd.toFixed(3)} (≈ ₹{Math.round(current.costUsd * USD_TO_INR)})
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function Header({
  lang,
  setLang,
  children,
}: {
  lang: "en" | "hi";
  setLang: (l: "en" | "hi") => void;
  children?: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>📰 Today&apos;s News</h2>
        <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
          {(["en", "hi"] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLang(l)}
              style={{
                fontSize: 12,
                fontWeight: 800,
                padding: "5px 11px",
                border: "none",
                cursor: "pointer",
                background: lang === l ? "#1d4ed8" : "transparent",
                color: lang === l ? "#fff" : "var(--muted)",
              }}
            >
              {l === "en" ? "EN" : "हिं"}
            </button>
          ))}
        </div>
      </div>
      {children}
    </div>
  );
}
