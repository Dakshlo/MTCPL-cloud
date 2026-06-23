"use client";

/**
 * Dispatch incharges manager (Mig 159). Add/edit/remove incharges and link each
 * to its temples (one incharge → many temples; a temple has one incharge). When
 * a temple's dispatch is verified its linked incharge auto-prints on the challan.
 */

import {
  addInchargeAction,
  editInchargeAction,
  deleteInchargeAction,
  linkTempleInchargeAction,
} from "./actions";

type Incharge = { id: string; name: string; phone: string | null };
type TempleLink = { id: string; name: string; inchargeId: string | null };

const inp: React.CSSProperties = { padding: "8px 10px", fontSize: 13, border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg)", color: "var(--text)" };

export function IncharcesPanel({
  incharges,
  temples,
  onClose,
}: {
  incharges: Incharge[];
  temples: TempleLink[];
  onClose: () => void;
}) {
  const nameOf = (id: string | null) => (id ? incharges.find((i) => i.id === id)?.name ?? "?" : null);

  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, zIndex: 1600, background: "rgba(10,8,4,0.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 16px", overflowY: "auto" }}
    >
      <div role="dialog" aria-modal="true" aria-label="Dispatch incharges" style={{ width: "100%", maxWidth: 640, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, boxShadow: "0 24px 70px rgba(0,0,0,0.3)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 800 }}>🧑‍✈️ Dispatch incharges</div>
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>Add incharges and link each to its temples — printed automatically on that temple&apos;s challans.</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ marginLeft: "auto", background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "var(--muted)" }}>×</button>
        </div>

        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Add incharge */}
          <form action={addInchargeAction} style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", border: "1px dashed var(--border)", borderRadius: 10, padding: "12px 14px" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 160px" }}>
              <span style={{ fontSize: 11.5, fontWeight: 800, color: "var(--muted)" }}>NAME *</span>
              <input name="name" required placeholder="e.g. POSA RAM" style={inp} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 140px" }}>
              <span style={{ fontSize: 11.5, fontWeight: 800, color: "var(--muted)" }}>MOBILE</span>
              <input name="phone" type="tel" placeholder="e.g. 8949783579" style={inp} />
            </label>
            <button type="submit" className="primary-button" style={{ minHeight: 38, fontSize: 13.5 }}>+ Add incharge</button>
          </form>

          {incharges.length === 0 && (
            <div className="muted" style={{ fontSize: 13, textAlign: "center", padding: "8px 0" }}>No incharges yet — add one above.</div>
          )}

          {/* Each incharge + its temple links */}
          {incharges.map((ic) => {
            const linked = temples.filter((t) => t.inchargeId === ic.id);
            const addable = temples.filter((t) => t.inchargeId !== ic.id);
            return (
              <div key={ic.id} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: "12px 14px", background: "var(--bg)" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <form action={editInchargeAction} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", flex: 1 }}>
                    <input type="hidden" name="id" value={ic.id} />
                    <input name="name" defaultValue={ic.name} required style={{ ...inp, fontWeight: 800, flex: "1 1 130px" }} />
                    <input name="phone" type="tel" defaultValue={ic.phone ?? ""} placeholder="mobile" style={{ ...inp, flex: "1 1 120px" }} />
                    <button type="submit" className="ghost-button" style={{ fontSize: 12, padding: "7px 12px" }}>Save</button>
                  </form>
                  <form action={deleteInchargeAction} onSubmit={(e) => { if (!confirm(`Remove incharge ${ic.name}? Linked temples will fall back to the default.`)) e.preventDefault(); }}>
                    <input type="hidden" name="id" value={ic.id} />
                    <button type="submit" style={{ border: "none", background: "transparent", color: "#dc2626", cursor: "pointer", fontSize: 13, fontWeight: 700 }} title="Remove incharge">✕</button>
                  </form>
                </div>

                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Temples ({linked.length})</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    {linked.map((t) => (
                      <form key={t.id} action={linkTempleInchargeAction} style={{ display: "inline-flex", alignItems: "center", gap: 4, border: "1px solid var(--border)", borderRadius: 999, padding: "3px 6px 3px 10px", background: "var(--surface)" }}>
                        <input type="hidden" name="temple_id" value={t.id} />
                        <input type="hidden" name="incharge_id" value="" />
                        <span style={{ fontSize: 12, fontWeight: 700 }}>🛕 {t.name}</span>
                        <button type="submit" title="Unlink" style={{ border: "none", background: "transparent", color: "#dc2626", cursor: "pointer", fontSize: 12, fontWeight: 800 }}>✕</button>
                      </form>
                    ))}
                    {linked.length === 0 && <span className="muted" style={{ fontSize: 12 }}>No temples linked yet.</span>}
                  </div>
                  {addable.length > 0 && (
                    <form action={linkTempleInchargeAction} style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
                      <input type="hidden" name="incharge_id" value={ic.id} />
                      <select name="temple_id" defaultValue="" required style={{ ...inp, maxWidth: 280 }}>
                        <option value="" disabled>+ Link a temple…</option>
                        {addable.map((t) => (
                          <option key={t.id} value={t.id}>{t.name}{t.inchargeId ? ` (now: ${nameOf(t.inchargeId)})` : ""}</option>
                        ))}
                      </select>
                      <button type="submit" className="ghost-button" style={{ fontSize: 12.5, padding: "8px 14px" }}>Link →</button>
                    </form>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
