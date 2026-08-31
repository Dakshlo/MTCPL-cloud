"use client";

/**
 * Server-time check — developer only (Daksh, Aug 2026).
 *
 * "Give a real clock so if any time the time goes wrong I can report
 * it to you."
 *
 * The hero clock reads `new Date()` in the browser, so it shows the
 * viewer's own laptop and would look perfectly correct while the app
 * was wrong. That is exactly what happened on 27 Aug 2026: the
 * dashboard said "Friday, 28 August" because a date helper applied the
 * +5:30 IST offset twice, and nothing on screen gave it away.
 *
 * So this card shows the SERVER's clock beside the browser's, the drift
 * between them, and the values the app actually derives from that
 * clock — today's IST date, the IST hour, and the 10 AM→10 AM window
 * the daily report is dated by. If a date goes wrong again, this card
 * says which of those is lying.
 *
 * How the sync works (small NTP, same idea): note t0, call the route,
 * note t1. Round-trip is t1−t0, so the server's instant corresponds to
 * roughly the midpoint — offset = serverNow − (t0+t1)/2. The seconds
 * then tick locally off that offset, and it re-syncs every 60 s, so one
 * slow response can never leave the clock permanently skewed.
 */

import { useCallback, useEffect, useRef, useState } from "react";

type Payload = {
  ok: true;
  now: number;
  istYmd: string;
  istHour: number;
  istLabel: string;
  reportWindow: string;
  serverTz: string;
  serverOffsetMin: number;
};

/** IST wall clock straight from Intl — never the string round-trip that
 *  caused the original bug (see lib/ist.ts). */
const IST_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});
const IST_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
});

export function TimeCheckCard() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, force] = useState(0);
  // Milliseconds to ADD to the browser clock to get the server's.
  const offset = useRef<number | null>(null);
  const rtt = useRef<number>(0);

  const sync = useCallback(async () => {
    const t0 = Date.now();
    try {
      const r = await fetch("/api/time-check", { cache: "no-store" });
      const t1 = Date.now();
      const j = (await r.json()) as Payload | { ok: false; error: string };
      if (!("ok" in j) || !j.ok) {
        setError("error" in j ? j.error : "Could not read the server clock.");
        return;
      }
      rtt.current = t1 - t0;
      offset.current = j.now - (t0 + t1) / 2;
      setData(j);
      setError(null);
    } catch {
      setError("Could not reach the server clock.");
    }
  }, []);

  useEffect(() => {
    void sync();
    const resync = setInterval(() => void sync(), 60_000);
    const tick = setInterval(() => force((n) => n + 1), 1000);
    return () => { clearInterval(resync); clearInterval(tick); };
  }, [sync]);

  const browserNow = new Date();
  const serverNow = offset.current == null ? null : new Date(Date.now() + offset.current);
  const drift = offset.current == null ? null : Math.round(offset.current / 1000);
  // Under a minute of drift is normal clock wander; past that the two
  // machines genuinely disagree and dates near midnight can flip.
  const driftBad = drift != null && Math.abs(drift) >= 60;

  // The browser's own IST date vs the server's — the check that would
  // have caught the 28-August bug on sight.
  const browserYmd = IST_DATE.format(browserNow);
  const ymdMismatch = data != null && browserYmd !== data.istYmd;

  const bad = driftBad || ymdMismatch || error != null;

  const row = (label: string, value: string, mono = true, warn = false) => (
    <div style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "5px 0", borderBottom: "1px solid var(--border)" }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", minWidth: 132 }}>{label}</span>
      <span style={{
        fontSize: 12.5, fontWeight: 800, marginLeft: "auto", textAlign: "right",
        fontFamily: mono ? "ui-monospace, SFMono-Regular, monospace" : undefined,
        color: warn ? "#b91c1c" : "var(--text)",
      }}>
        {value}
      </span>
    </div>
  );

  return (
    <section
      className="page-card"
      style={{ borderColor: bad ? "rgba(220,38,38,0.55)" : undefined }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <h2 style={{ margin: 0, fontSize: 15 }}>🕐 Server time check</h2>
        <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted)", border: "1px solid var(--border)", borderRadius: 999, padding: "2px 8px" }}>
          developer only
        </span>
        <button
          type="button"
          onClick={() => void sync()}
          style={{ marginLeft: "auto", fontSize: 11.5, fontWeight: 700, padding: "5px 11px", borderRadius: 8, border: "1.5px solid var(--border)", background: "var(--bg)", color: "var(--text)", cursor: "pointer" }}
        >
          Re-sync
        </button>
      </div>

      {/* The two clocks, side by side — this is the whole point of the
          card: the app runs on the server's, not on yours. */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        {[
          { k: "SERVER (what the app uses)", v: serverNow, strong: true },
          { k: "THIS BROWSER", v: browserNow, strong: false },
        ].map((c) => (
          <div key={c.k} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: "10px 12px", background: c.strong ? "var(--bg)" : "transparent" }}>
            <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.07em", color: "var(--muted)" }}>{c.k}</div>
            <div style={{ fontSize: 26, fontWeight: 900, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.5px", marginTop: 4 }}>
              {c.v ? IST_TIME.format(c.v) : "--:--:--"}
            </div>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--muted)" }}>
              {c.v ? IST_DATE.format(c.v) : "—"} IST
            </div>
          </div>
        ))}
      </div>

      {error && (
        <div style={{ fontSize: 12, color: "#b91c1c", background: "rgba(220,38,38,0.07)", border: "1px solid rgba(220,38,38,0.3)", borderRadius: 8, padding: "8px 11px", marginBottom: 10 }}>
          {error}
        </div>
      )}

      {row(
        "Drift",
        drift == null ? "—" : `${drift > 0 ? "+" : ""}${drift}s  (±${Math.round(rtt.current / 2)}ms)`,
        true, driftBad,
      )}
      {row("Server IST date", data?.istYmd ?? "—", true, ymdMismatch)}
      {row("Browser IST date", browserYmd, true, ymdMismatch)}
      {row("Server IST hour", data ? `${data.istHour}:00` : "—")}
      {row("Reads as", data?.istLabel ?? "—", false)}
      {row("Daily-report window", data?.reportWindow ?? "—")}
      {row("Server timezone", data ? `${data.serverTz} (UTC${data.serverOffsetMin >= 0 ? "+" : ""}${(data.serverOffsetMin / 60).toFixed(1)})` : "—", false)}

      <p className="muted" style={{ fontSize: 11.5, lineHeight: 1.6, marginTop: 10, marginBottom: 0 }}>
        {bad ? (
          <strong style={{ color: "#b91c1c" }}>
            Something is off — screenshot this card and send it to me.
          </strong>
        ) : (
          <>Everything agrees. The server clock is the one the app runs on; yours is only shown to compare against it.</>
        )}{" "}
        The server timezone being UTC is normal on Vercel — the IST values above are what must be right.
      </p>
    </section>
  );
}
