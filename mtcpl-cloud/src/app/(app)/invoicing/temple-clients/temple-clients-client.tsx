"use client";

/**
 * Temple → Client (billing) map — client picker (Mig 154 relocated).
 *
 * One row per temple with a customer (invoice party) dropdown. Changing a
 * row auto-saves via setTempleInvoicePartyAction and shows a per-row
 * status. The chosen party drives the auto dispatch→invoicing challan.
 */

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { setTempleInvoicePartyAction } from "../actions";

export type PartyOpt = { id: string; name: string };
export type TempleRow = {
  id: string;
  name: string;
  code_prefix: string;
  is_active: boolean;
  invoice_party_id: string | null;
};

type Status = { state: "idle" | "saving" | "saved" | "error"; msg?: string };

const inp = { padding: "8px 10px", fontSize: 13, border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg)", color: "var(--text)" } as const;

export function TempleClientsClient({ temples, parties }: { temples: TempleRow[]; parties: PartyOpt[] }) {
  const [map, setMap] = useState<Record<string, string>>(
    () => Object.fromEntries(temples.map((t) => [t.id, t.invoice_party_id ?? ""])),
  );
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [query, setQuery] = useState("");
  const [, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return temples;
    return temples.filter((t) => t.name.toLowerCase().includes(q) || t.code_prefix.toLowerCase().includes(q));
  }, [temples, query]);

  const mappedCount = useMemo(() => Object.values(map).filter(Boolean).length, [map]);

  function save(templeId: string, partyId: string) {
    const prev = map[templeId] ?? "";
    setMap((m) => ({ ...m, [templeId]: partyId }));
    setStatus((s) => ({ ...s, [templeId]: { state: "saving" } }));
    const fd = new FormData();
    fd.set("temple_id", templeId);
    fd.set("invoice_party_id", partyId);
    startTransition(async () => {
      const res = await setTempleInvoicePartyAction(fd);
      if (res.ok) {
        setStatus((s) => ({ ...s, [templeId]: { state: "saved" } }));
      } else {
        // Revert the optimistic change on failure.
        setMap((m) => ({ ...m, [templeId]: prev }));
        setStatus((s) => ({ ...s, [templeId]: { state: "error", msg: res.error } }));
      }
    });
  }

  if (parties.length === 0) {
    return (
      <div style={{ background: "rgba(234,179,8,0.08)", border: "1px solid rgba(234,179,8,0.4)", borderRadius: 12, padding: "16px 18px", fontSize: 13.5, lineHeight: 1.6 }}>
        <strong>No customer parties yet.</strong> Add at least one client in{" "}
        <Link href="/invoicing/parties" style={{ color: "var(--gold-dark)", fontWeight: 700 }}>👤 Parties</Link>{" "}
        before mapping temples to clients.
      </div>
    );
  }

  const th = { fontSize: 10, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: "0.05em", color: "var(--muted)", textAlign: "left" as const, padding: "8px 10px", whiteSpace: "nowrap" as const };
  const td = { padding: "8px 10px", fontSize: 13, verticalAlign: "middle" as const } as const;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 14 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="🔍 Search temple or code…"
          style={{ ...inp, flex: "1 1 260px", maxWidth: 360 }}
        />
        <div style={{ fontSize: 12.5, color: "var(--muted)", fontWeight: 600 }}>
          {mappedCount} of {temples.length} temple{temples.length === 1 ? "" : "s"} mapped
        </div>
      </div>

      <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 620 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              <th style={th}>Temple</th>
              <th style={th}>Code</th>
              <th style={th}>💳 Client (billing)</th>
              <th style={{ ...th, width: 110 }}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => {
              const st = status[t.id]?.state ?? "idle";
              return (
                <tr key={t.id} style={{ borderBottom: "1px solid var(--border)", opacity: t.is_active ? 1 : 0.6 }}>
                  <td style={{ ...td, fontWeight: 600 }}>
                    {t.name}
                    {!t.is_active && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase" }}>inactive</span>}
                  </td>
                  <td style={{ ...td, fontFamily: "ui-monospace, monospace", color: "var(--muted)" }}>{t.code_prefix}</td>
                  <td style={td}>
                    <select
                      value={map[t.id] ?? ""}
                      onChange={(e) => save(t.id, e.target.value)}
                      style={{ ...inp, width: "100%", maxWidth: 320, fontWeight: (map[t.id] ? 700 : 400) }}
                    >
                      <option value="">— None —</option>
                      {parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </td>
                  <td style={{ ...td, textAlign: "right" }}>
                    {st === "saving" && <span style={{ fontSize: 12, color: "var(--muted)" }}>Saving…</span>}
                    {st === "saved" && <span style={{ fontSize: 12, fontWeight: 700, color: "#15803d" }}>✓ Saved</span>}
                    {st === "error" && <span style={{ fontSize: 12, fontWeight: 700, color: "#991b1b" }} title={status[t.id]?.msg}>✕ Failed</span>}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={4} style={{ ...td, textAlign: "center", color: "var(--muted)", padding: "20px 10px" }}>No temples match “{query}”.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: 12, color: "var(--muted)", margin: "2px 2px 0", lineHeight: 1.6 }}>
        When a dispatch for a temple is approved, its invoicing challan is auto-created billed to the client set here. A temple left on <strong>None</strong> won&apos;t auto-create a challan (you can still make one by hand on the Challans page).
      </p>
    </div>
  );
}
