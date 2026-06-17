"use client";

// Per-machine asset editor for the CNC vendor page. Edit purchase price /
// date / rate / salvage; "Closing value today" recomputes live (WDV to date,
// floored at salvage). Save one machine at a time OR "Save all" at once.

import { useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { updateMachineAssetAction, updateMachineAssetsBulkAction } from "../../expenses/actions";

export type AssetMachine = {
  id: string;
  machine_code: string;
  machine_type: string | null;
  purchase_price: number | string | null;
  purchase_date: string | null;
  current_book_value: number | string | null;
  book_value_as_of: string | null;
  depreciation_rate_pct: number | string | null;
  salvage_value: number | string | null;
};

type Row = {
  id: string; code: string; type: string | null;
  cbv: number | string | null; bvAsOf: string | null;
  purchase_price: string; purchase_date: string; rate: string; salvage: string;
  dirty: boolean;
};

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

// Same WDV math as lib/cnc-monthly-report.currentBookValueFor, ported here so
// the closing value updates live as you type (no server round-trip).
function closingValue(r: Row): number | null {
  let baseValue: number; let baseDate: Date;
  if (r.purchase_price !== "" && r.purchase_date) {
    baseValue = Number(r.purchase_price); baseDate = new Date(r.purchase_date);
  } else if (r.cbv != null && r.bvAsOf) {
    baseValue = Number(r.cbv); baseDate = new Date(r.bvAsOf);
  } else { return null; }
  if (!Number.isFinite(baseValue) || !Number.isFinite(baseDate.getTime())) return null;
  const rate = Math.max(0, Math.min(1, (Number(r.rate) || 0) / 100));
  const salvage = Math.max(0, Number(r.salvage) || 0);
  const years = Math.max(0, (Date.now() - baseDate.getTime()) / (365.25 * 86_400_000));
  return Math.max(salvage, baseValue * Math.pow(1 - rate, years));
}

const lbl: CSSProperties = { fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" };
const inp: CSSProperties = { padding: "8px 10px", fontSize: 13, fontFamily: "ui-monospace, monospace", border: "1px solid var(--border)", borderRadius: 7, background: "var(--bg)", color: "var(--text)" };

export function MachineAssetEditor({ machines }: { machines: AssetMachine[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(() => machines.map((m) => ({
    id: m.id, code: m.machine_code, type: m.machine_type,
    cbv: m.current_book_value, bvAsOf: m.book_value_as_of,
    purchase_price: m.purchase_price != null ? String(m.purchase_price) : "",
    purchase_date: m.purchase_date ?? "",
    rate: m.depreciation_rate_pct != null ? String(m.depreciation_rate_pct) : "15",
    salvage: m.salvage_value != null ? String(m.salvage_value) : "0",
    dirty: false,
  })));
  const [busy, setBusy] = useState<string | "all" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function patch(id: string, k: "purchase_price" | "purchase_date" | "rate" | "salvage", v: string) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, [k]: v, dirty: true } : r)));
    setMsg(null); setErr(null);
  }
  function fdFor(r: Row): FormData {
    const fd = new FormData();
    fd.set("machine_id", r.id);
    fd.set("purchase_price", r.purchase_price);
    fd.set("purchase_date", r.purchase_date);
    fd.set("depreciation_rate_pct", r.rate);
    fd.set("salvage_value", r.salvage);
    return fd;
  }

  async function saveOne(r: Row) {
    if (busy) return;
    if (r.purchase_price !== "" && !r.purchase_date) {
      setErr(`Purchase date is required for ${r.code} (you entered a purchase price).`);
      return;
    }
    setBusy(r.id); setMsg(null); setErr(null);
    try {
      const res = await updateMachineAssetAction(fdFor(r));
      if (!res.ok) { setErr(res.error); return; }
      setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, dirty: false } : x)));
      setMsg(`✓ Saved ${r.code}`);
      router.refresh();
    } catch { setErr("Save failed — check your connection."); }
    finally { setBusy(null); }
  }

  async function saveAll() {
    if (busy) return;
    const missing = rows.filter((r) => r.purchase_price !== "" && !r.purchase_date);
    if (missing.length) {
      setErr(`Purchase date is required for: ${missing.map((m) => m.code).join(", ")}.`);
      return;
    }
    setBusy("all"); setMsg(null); setErr(null);
    try {
      const fd = new FormData();
      fd.set("machines_json", JSON.stringify(rows.map((r) => ({
        machine_id: r.id, purchase_price: r.purchase_price, purchase_date: r.purchase_date,
        depreciation_rate_pct: r.rate, salvage_value: r.salvage,
      }))));
      const res = await updateMachineAssetsBulkAction(fd);
      if (!res.ok) { setErr(res.error); return; }
      setRows((rs) => rs.map((r) => ({ ...r, dirty: false })));
      setMsg(`✓ Saved all ${res.count} machine${res.count === 1 ? "" : "s"}`);
      router.refresh();
    } catch { setErr("Save failed — check your connection."); }
    finally { setBusy(null); }
  }

  const dirtyCount = rows.filter((r) => r.dirty).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Save-all bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 12, color: "var(--muted)" }}>
          {dirtyCount > 0 ? `${dirtyCount} machine${dirtyCount === 1 ? "" : "s"} edited — save individually or all at once.` : "Edit a machine, then Save it — or Save all."}
        </div>
        <button type="button" onClick={saveAll} disabled={busy != null} style={{ padding: "8px 16px", fontSize: 12.5, fontWeight: 800, color: "#fff", background: busy === "all" ? "var(--border)" : "var(--gold-dark)", border: "none", borderRadius: 8, cursor: busy ? "wait" : "pointer", whiteSpace: "nowrap" }}>
          {busy === "all" ? "Saving…" : `💾 Save all${dirtyCount > 0 ? ` (${dirtyCount})` : ""}`}
        </button>
      </div>

      {rows.map((r) => {
        const typeLabel = r.type === "lathe" ? "LATHE" : r.type === "multi_head_2" ? "2× HEAD" : "SINGLE HEAD";
        const closing = closingValue(r);
        return (
          <div key={r.id} style={{ padding: "12px 14px", background: "var(--surface-alt)", borderRadius: 10, border: `1px solid ${r.dirty ? "var(--gold-dark)" : "var(--border)"}`, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <span style={{ fontSize: 16, fontWeight: 800, fontFamily: "ui-monospace, monospace" }}>{r.code}</span>
                <span style={{ fontSize: 9.5, fontWeight: 800, color: "var(--muted)", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 999, padding: "2px 8px" }}>{typeLabel}</span>
                {r.dirty && <span style={{ fontSize: 9.5, fontWeight: 800, color: "#92400e" }}>● unsaved</span>}
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={lbl}>Closing value today</div>
                <div style={{ fontSize: 17, fontWeight: 800, color: closing != null ? "#15803d" : "var(--muted-light)", fontFamily: "ui-monospace, monospace" }}>
                  {closing != null ? inr(closing) : "—"}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 150px" }}>
                <span style={lbl}>Purchase price (₹)</span>
                <input type="number" step="1" min="0" inputMode="numeric" value={r.purchase_price} onChange={(e) => patch(r.id, "purchase_price", e.target.value)} placeholder="e.g. 1200000" style={inp} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 140px" }}>
                <span style={lbl}>Purchase date <span style={{ color: "#dc2626" }}>*</span></span>
                <input type="date" required value={r.purchase_date} onChange={(e) => patch(r.id, "purchase_date", e.target.value)} style={{ ...inp, ...(r.purchase_price !== "" && !r.purchase_date ? { borderColor: "#dc2626" } : {}) }} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "0 1 100px" }}>
                <span style={lbl}>Rate (%/yr)</span>
                <input type="number" step="0.5" min="0" max="100" inputMode="decimal" value={r.rate} onChange={(e) => patch(r.id, "rate", e.target.value)} style={inp} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "0 1 120px" }}>
                <span style={lbl}>Salvage (₹)</span>
                <input type="number" step="1" min="0" inputMode="numeric" value={r.salvage} onChange={(e) => patch(r.id, "salvage", e.target.value)} style={inp} />
              </label>
              <button type="button" onClick={() => saveOne(r)} disabled={busy != null} style={{ padding: "9px 18px", fontSize: 12.5, fontWeight: 800, background: r.dirty ? "var(--gold-dark)" : "var(--surface)", color: r.dirty ? "#fff" : "var(--muted)", border: r.dirty ? "none" : "1px solid var(--border)", borderRadius: 8, cursor: busy ? "wait" : "pointer", height: "fit-content" }}>
                {busy === r.id ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        );
      })}

      {msg && <div style={{ fontSize: 13, fontWeight: 700, color: "#15803d" }}>{msg}</div>}
      {err && <div style={{ fontSize: 13, fontWeight: 700, color: "#991b1b" }}>⚠ {err}</div>}
    </div>
  );
}
