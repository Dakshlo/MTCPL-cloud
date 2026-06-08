"use client";

// Toolbar for the Push Urgent page: a temple dropdown (auto-loads that
// temple's slabs) + a text search. Both submit the same GET form, so the
// server loads only the picked temple / search matches — not the whole
// 5000+ backlog.
export function PushToolbar({
  temples,
  temple,
  q,
}: {
  temples: string[];
  temple: string;
  q: string;
}) {
  const sel: React.CSSProperties = {
    fontSize: 13,
    padding: "9px 12px",
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg)",
    color: "var(--text)",
  };
  return (
    <form method="get" action="/dashboard/push-urgent" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <select
        name="temple"
        defaultValue={temple}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        style={{ ...sel, flex: "1 1 220px", fontWeight: 700 }}
      >
        <option value="">🏛️ Pick a temple…</option>
        {temples.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>
      <input
        type="search"
        name="q"
        defaultValue={q}
        placeholder="…or search slab code / label / stone"
        style={{ ...sel, flex: "2 1 280px", minWidth: 0 }}
      />
      <button type="submit" style={{ padding: "9px 20px", fontSize: 13, fontWeight: 800, color: "#fff", background: "var(--gold-dark)", border: "none", borderRadius: 8, cursor: "pointer" }}>
        Search
      </button>
      {(q || temple) && (
        <a href="/dashboard/push-urgent" style={{ padding: "9px 14px", fontSize: 13, fontWeight: 700, color: "var(--text)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, textDecoration: "none" }}>
          Clear
        </a>
      )}
    </form>
  );
}
