/**
 * Employees dept — Register of Wages (Form 11) PREVIEW page. Opens the register
 * in-app in the same statutory layout (cream "register paper", landscape-wide);
 * a Download-Excel button gives the .xlsx. Reached from the Pay-salary page's
 * "Register (Form 11)" control. Scope via ?organizations= / ?designations=.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canUseSalary } from "@/lib/salary-permissions";
import { loadWageRegister, type WageRegRow } from "../_data";

export const dynamic = "force-dynamic";

const inr = (n: number) => (Number(n) || 0).toLocaleString("en-IN");
const dmy = (iso: string | null): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const ist = new Date(d.getTime() + 5.5 * 3600 * 1000);
  return `${String(ist.getUTCDate()).padStart(2, "0")}-${String(ist.getUTCMonth() + 1).padStart(2, "0")}-${ist.getUTCFullYear()}`;
};

// ── Cream "register paper" palette (matches the physical book + the Excel). ──
const PAPER = "#FBF7E2", PAPER_ALT = "#F6F0D2", MAROON = "#9C5F6E", MAROON_DK = "#6B4652", INK = "#2A1720", RULE = "#9C7A86";

const th: React.CSSProperties = { background: MAROON_DK, color: "#fff", fontSize: 10.5, fontWeight: 800, padding: "6px 6px", border: `1px solid ${RULE}`, textAlign: "center", lineHeight: 1.25, whiteSpace: "pre-line" };
const td: React.CSSProperties = { fontSize: 11, color: INK, padding: "5px 7px", border: `1px solid ${RULE}`, verticalAlign: "middle" };
const tdR: React.CSSProperties = { ...td, textAlign: "right", fontFamily: "ui-monospace, monospace" };
const tdC: React.CSSProperties = { ...td, textAlign: "center" };

export default async function WageRegisterPage({ searchParams }: { searchParams: Promise<{ month?: string; organizations?: string; designations?: string }> }) {
  const { profile } = await requireAuth();
  if (!canUseSalary(profile)) redirect("/");
  const sp = await searchParams;
  const month = /^\d{4}-\d{2}/.test(sp.month ?? "") ? (sp.month as string).slice(0, 7) : "";
  if (!month) redirect("/salary/pay");
  const admin = createAdminSupabaseClient();
  const reg = await loadWageRegister(admin, month, {
    organizations: sp.organizations ? sp.organizations.split(",").map((s) => s.trim()).filter(Boolean) : null,
    designations: sp.designations ? sp.designations.split(",").map((s) => s.trim()).filter(Boolean) : null,
  });

  const qs = new URLSearchParams({ month });
  if (sp.organizations) qs.set("organizations", sp.organizations);
  if (sp.designations) qs.set("designations", sp.designations);
  const xlsxHref = `/api/salary/wage-register-export?${qs.toString()}`;

  const groupHeaders: { label: string; span?: number }[] = [
    { label: "Sl. No.\nक्र.सं." }, { label: "Name of worker\nकर्मचारी का नाम" }, { label: "Wages Period\nवेतन अवधि" },
    { label: "Min. Rate of Wages (A)\nन्यूनतम वेतन दर" }, { label: "Actual Rate of Wages Paid (B)\nवास्तविक वेतन दर" },
    { label: "Days Worked\nकार्य दिवस" }, { label: "Actual Wages\nवास्तविक वेतन" }, { label: "Any other Allowance\nअन्य भत्ते" },
    { label: "Gross Wages (6+7)\nकुल वेतन" }, { label: "Kind of Deduction — कटौती की विवरण", span: 4 },
    { label: "Actual Net Wages Paid\nवास्तविक शुद्ध वेतन" }, { label: "Date of Payment\nभुगतान तिथि" }, { label: "Signature / thumb\nहस्ताक्षर / अंगूठा" },
  ];
  const colNums = ["1", "2", "3", "3(अ)", "4", "5(ब)", "6", "7", "8", "9", "9", "9", "9", "10", "11", "12"];

  return (
    <section className="page-card">
      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <Link href="/salary/pay" style={{ fontSize: 13, fontWeight: 700, color: "var(--muted)", textDecoration: "none" }}>← Back to Pay salary</Link>
        <h1 style={{ margin: 0, fontSize: 19, fontWeight: 900 }}>📋 Register of Wages — Form 11</h1>
        <a href={xlsxHref} target="_blank" rel="noopener noreferrer" style={{ marginLeft: "auto", fontSize: 13, fontWeight: 800, padding: "10px 18px", borderRadius: 10, border: "none", color: "#fff", background: "#15803d", textDecoration: "none", cursor: "pointer", pointerEvents: reg.ok && reg.rows.length ? "auto" : "none", opacity: reg.ok && reg.rows.length ? 1 : 0.5 }}>⬇ Download Excel</a>
      </div>

      {!reg.ok ? (
        <div style={{ border: "1px dashed var(--border)", borderRadius: 12, padding: "30px 20px", textAlign: "center", color: "var(--muted)" }}>{reg.error}</div>
      ) : reg.rows.length === 0 ? (
        <div style={{ border: "1px dashed var(--border)", borderRadius: 12, padding: "30px 20px", textAlign: "center", color: "var(--muted)" }}>No PAID employees match this month / selection — mark a batch paid first.</div>
      ) : (
        <div style={{ overflowX: "auto", border: `1px solid ${RULE}`, borderRadius: 8 }}>
          <div style={{ minWidth: 1180, background: PAPER, padding: "14px 16px 22px" }}>
            {/* Title band */}
            <div style={{ background: MAROON, color: "#fff", fontWeight: 900, fontSize: 15, textAlign: "center", padding: "8px", borderTopLeftRadius: 4, borderTopRightRadius: 4 }}>MATESHWARI TEMPLE CONSTRUCTION PVT. LTD.</div>
            <div style={{ background: MAROON_DK, color: "#fff", fontWeight: 800, fontSize: 12, textAlign: "center", padding: "5px" }}>REGISTER OF WAGES — Form No. 11, Rule 27(1)</div>
            <div style={{ background: PAPER_ALT, color: "#5C3A44", fontWeight: 800, fontSize: 11, textAlign: "center", padding: "5px", borderBottom: `1px solid ${RULE}` }}>
              Wages Period: {reg.periodStr}{reg.scope ? ` · ${reg.scope}` : ""}
            </div>

            <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
              <colgroup>
                {[36, 150, 78, 74, 88, 52, 72, 66, 78, 58, 58, 56, 64, 82, 78, 96].map((w, i) => <col key={i} style={{ width: w }} />)}
              </colgroup>
              <thead>
                <tr>
                  {groupHeaders.map((h, i) => (
                    <th key={i} style={th} rowSpan={h.span ? 1 : 2} colSpan={h.span ?? 1}>{h.label}</th>
                  ))}
                </tr>
                <tr>
                  {["E.S.I.", "P.F.", "TDS", "Total"].map((s) => <th key={s} style={th}>{s}</th>)}
                </tr>
                <tr>
                  {colNums.map((c, i) => <td key={i} style={{ ...tdC, background: PAPER_ALT, fontSize: 9, fontStyle: "italic", color: "#6B7280", padding: "2px" }}>{c}</td>)}
                </tr>
              </thead>
              <tbody>
                {reg.rows.map((r: WageRegRow) => {
                  const bg = r.sr % 2 === 0 ? PAPER_ALT : PAPER;
                  return (
                    <tr key={r.sr}>
                      <td style={{ ...tdC, background: bg }}>{r.sr}</td>
                      <td style={{ ...td, background: bg }}><strong>{r.name}</strong>{r.father ? <span style={{ display: "block", fontSize: 10, color: "#6B5560" }}>s/o {r.father}</span> : null}</td>
                      <td style={{ ...tdC, background: bg }}>{reg.monthName} {reg.year}</td>
                      <td style={{ ...tdC, background: bg }}>{r.minWage > 0 ? inr(r.minWage) : "—"}</td>
                      <td style={{ ...tdC, background: bg }}>{r.rate > 0 ? `${inr(r.rate)} / ${r.variable ? "day" : "month"}` : "—"}</td>
                      <td style={{ ...tdC, background: bg }}>{r.attendance != null ? r.attendance : "—"}</td>
                      <td style={{ ...tdR, background: bg }}>{inr(r.basic)}</td>
                      <td style={{ ...tdR, background: bg }}>{r.allow > 0 ? inr(r.allow) : "—"}</td>
                      <td style={{ ...tdR, background: bg, fontWeight: 800 }}>{inr(r.gross)}</td>
                      <td style={{ ...tdR, background: bg }}>{r.esi > 0 ? inr(r.esi) : "—"}</td>
                      <td style={{ ...tdR, background: bg }}>{r.pf > 0 ? inr(r.pf) : "—"}</td>
                      <td style={{ ...tdR, background: bg }}>{r.tds > 0 ? inr(r.tds) : "—"}</td>
                      <td style={{ ...tdR, background: bg }}>{r.ded > 0 ? inr(r.ded) : "—"}</td>
                      <td style={{ ...tdR, background: bg, fontWeight: 800 }}>{inr(r.net)}</td>
                      <td style={{ ...tdC, background: bg, fontSize: 10 }}>{dmy(r.paidAt)}</td>
                      <td style={{ ...td, background: bg }}></td>
                    </tr>
                  );
                })}
                <tr>
                  <td style={{ ...td, background: "#EAD9B0", fontWeight: 900, borderTop: `2px double ${MAROON}` }} colSpan={2}>TOTAL</td>
                  <td style={{ ...td, background: "#EAD9B0", borderTop: `2px double ${MAROON}` }} colSpan={4}></td>
                  <td style={{ ...tdR, background: "#EAD9B0", fontWeight: 900, borderTop: `2px double ${MAROON}` }}>{inr(reg.totals.basic)}</td>
                  <td style={{ ...tdR, background: "#EAD9B0", fontWeight: 900, borderTop: `2px double ${MAROON}` }}>{inr(reg.totals.allow)}</td>
                  <td style={{ ...tdR, background: "#EAD9B0", fontWeight: 900, borderTop: `2px double ${MAROON}` }}>{inr(reg.totals.gross)}</td>
                  <td style={{ ...tdR, background: "#EAD9B0", fontWeight: 900, borderTop: `2px double ${MAROON}` }}>{inr(reg.totals.esi)}</td>
                  <td style={{ ...tdR, background: "#EAD9B0", fontWeight: 900, borderTop: `2px double ${MAROON}` }}>{inr(reg.totals.pf)}</td>
                  <td style={{ ...tdR, background: "#EAD9B0", fontWeight: 900, borderTop: `2px double ${MAROON}` }}>{inr(reg.totals.tds)}</td>
                  <td style={{ ...tdR, background: "#EAD9B0", fontWeight: 900, borderTop: `2px double ${MAROON}` }}>{inr(reg.totals.ded)}</td>
                  <td style={{ ...tdR, background: "#EAD9B0", fontWeight: 900, borderTop: `2px double ${MAROON}` }}>{inr(reg.totals.net)}</td>
                  <td style={{ ...td, background: "#EAD9B0", borderTop: `2px double ${MAROON}` }} colSpan={2}></td>
                </tr>
              </tbody>
            </table>

            <div style={{ display: "flex", justifyContent: "space-between", gap: 20, marginTop: 14, alignItems: "flex-end" }}>
              <div style={{ fontSize: 9.5, fontStyle: "italic", color: "#6B7280", maxWidth: 720, lineHeight: 1.5 }}>
                (अ) न्यूनतम वेतन अधिनियम 1948 के अधीन निर्धारित वेतन दर।　(ब) यदि कार्य दिन संख्या तथा वेतन की गई भिन्न-भिन्न हो तो बाद वाली दिन संख्या कारण 6 में दर्शाया जावे।
              </div>
              <div style={{ fontSize: 11, fontWeight: 800, color: INK, textAlign: "center" }}>Signature of the employer<br />or person authorised by him</div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
