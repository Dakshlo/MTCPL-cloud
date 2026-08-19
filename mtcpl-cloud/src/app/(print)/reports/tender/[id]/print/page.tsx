/**
 * Rate-breakup QUOTATION (Daksh, Aug 2026) — the printable letter the office
 * already sends by hand, generated straight from a Tender / Price-Breakdown
 * sheet. A4 portrait, MTCPL letterhead, addressee block, one
 * "Rate Breakup for <work>" table (Sr. / Particulars / Uom. / Rate) closing on
 * "Total Rate Per <Uom>.", then Terms & Conditions and the signature block —
 * the same shape, in the same order, as the paper copy.
 *
 * Rates come from the sheet's own maths (tender-model), so the printed
 * quotation and the on-screen sheet can never drift:
 *   • a ₹/unit line prints its rate as typed
 *   • a ₹ fixed line spreads over the project quantity
 *   • a % line spreads its share of the ₹ subtotal
 * A sheet with no quantity therefore has no per-unit rates — the page says so
 * instead of printing zeros.
 *
 * ?amounts=1 adds the ₹ Amount column (internal estimate view). The default,
 * like the paper quotation, shows rates only.
 *
 * DEVELOPER ONLY — same gate as the Temple P&L page this belongs to.
 */

import { notFound, redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  TENDER_KEY, computeSheetTotal, quoteTables,
  type TenderAnalysis,
} from "@/app/(app)/reports/temple-pnl/tender-model";
import { PrintBtn } from "./print-btn";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;
type Search = Promise<{ amounts?: string }>;

const rupees = (n: number) => Math.round(n).toLocaleString("en-IN");

/** "1200/-" — the rate style the company's own quotations use. */
const rateCell = (n: number | null) => (n == null ? "—" : `${rupees(n)}/-`);

export default async function TenderQuotationPrint({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { profile } = await requireAuth();
  if (profile.role !== "developer") redirect("/dashboard");

  const { id } = await params;
  const { amounts: amountsParam } = await searchParams;
  const showAmounts = amountsParam === "1";

  const admin = createAdminSupabaseClient();
  const { data } = await admin.from("app_settings").select("value").eq("key", TENDER_KEY).maybeSingle();
  const v = data?.value as { analyses?: TenderAnalysis[] } | null;
  const sheet = (v?.analyses ?? []).find((a) => a.id === id);
  if (!sheet) notFound();

  const calc = computeSheetTotal(sheet);
  const q = sheet.quote;

  const letterDate = q?.date
    ? new Date(`${q.date}T00:00:00+05:30`)
    : new Date();
  const dateStr = letterDate.toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "2-digit", year: "numeric" });

  const work = (q?.work || "").trim() || sheet.name || "the work";
  // One table per master group — exactly like the paper quotation, which
  // carries a sandstone-carving breakup and a marble-slab breakup side by side.
  const tables = quoteTables(sheet, work);
  const multi = tables.length > 1;
  const noQty = tables.filter((t) => t.qty == null || t.qty <= 0);
  const intro = (q?.intro || "").trim()
    || `We are submitting to you the rate breakup analysis for ${work}${q?.toPlace ? ` at ${q.toPlace}` : ""}.`;
  const terms = (q?.terms || "").split("\n").map((t) => t.trim()).filter(Boolean);
  const toLines = [q?.toOrg, q?.toPlace].map((t) => (t || "").trim()).filter(Boolean);

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; font-size: 12px; color: #1a1a1a; background: #f0f0f0; }
        * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .wrap { max-width: 820px; margin: 0 auto; background: #fff; padding: 26px 40px 34px; position: relative; min-height: 1120px; display: flex; flex-direction: column; }
        .screen-bar { background: #1a1a1a; color: #fff; padding: 9px 28px; display: flex; align-items: center; justify-content: space-between; gap: 12px; max-width: 1180px; margin: 0 auto; }
        .screen-bar-title { font-size: 12px; color: rgba(255,255,255,0.65); }
        .screen-bar a { color: rgba(255,255,255,0.75); font-size: 11.5px; font-weight: 700; text-decoration: none; }

        /* ── letterhead: the company's own, in its own red ── */
        .lh { text-align: center; }
        .lh-name { font-size: 25px; font-weight: 800; color: #c0392b; letter-spacing: 0.01em; line-height: 1.12; }
        .lh-addr { font-size: 11px; font-weight: 700; color: #c0392b; margin-top: 6px; }
        .lh-contact { font-size: 10.5px; color: #c0392b; margin-top: 2px; }
        .lh-rule { border-bottom: 1.5px dashed #c0392b; margin: 7px 0 0; }

        .letter-meta { display: flex; justify-content: flex-end; gap: 22px; margin-top: 14px; font-size: 11.5px; font-weight: 700; }
        .to { margin-top: 4px; font-size: 12px; line-height: 1.55; }
        .to-k { font-weight: 700; }
        .salut { margin-top: 14px; font-size: 12px; font-weight: 700; }
        .intro { margin-top: 12px; font-size: 12px; line-height: 1.75; text-align: justify; text-indent: 34px; }

        /* ── the rate table ── */
        .tbl-wrap { margin: 20px auto 0; width: 92%; }
        table.rb { width: 100%; border-collapse: collapse; font-size: 12px; }
        table.rb caption { caption-side: top; font-size: 12.5px; font-weight: 800; color: #c0392b; padding: 5px 6px; border: 1px solid #1a1a1a; border-bottom: none; text-align: center; }
        table.rb th, table.rb td { border: 1px solid #1a1a1a; padding: 3.5px 8px; }
        table.rb th { font-size: 11.5px; font-weight: 800; text-align: center; }
        table.rb td.sr { text-align: center; width: 38px; }
        table.rb td.pt { text-align: left; }
        table.rb td.uom { text-align: center; width: 74px; }
        table.rb td.rate { text-align: right; width: 108px; font-variant-numeric: tabular-nums; }
        table.rb td.amt { text-align: right; width: 118px; font-variant-numeric: tabular-nums; }
        table.rb tfoot td { font-weight: 800; color: #c0392b; }
        table.rb tfoot td.lbl { text-align: left; }
        .grp { font-size: 9px; font-weight: 800; letter-spacing: 0.07em; text-transform: uppercase; color: #999; }

        .noqty { margin: 18px auto 0; width: 92%; border: 1px solid #e0c39a; background: #fdf6ec; border-radius: 5px; padding: 9px 12px; font-size: 11.5px; color: #8a5a17; line-height: 1.6; }

        .terms { margin-top: 22px; }
        .terms-h { font-size: 12.5px; font-weight: 800; text-decoration: underline; }
        .terms ol { margin: 7px 0 0 20px; font-size: 12px; line-height: 1.8; }
        .thanks { margin-top: 22px; font-size: 12px; }
        .sign { margin-top: 30px; font-size: 12px; }
        .sign-for { font-weight: 700; }
        .sign-line { margin-top: 42px; font-weight: 700; }
        .foot-note { margin-top: auto; padding-top: 18px; font-size: 8.5px; color: #b0b0b0; text-align: center; }

        @media print {
          body { background: #fff; }
          .screen-bar { display: none; }
          .wrap { max-width: none; padding: 12mm 14mm; min-height: 0; box-shadow: none; }
          @page { size: A4 portrait; margin: 0; }
        }
      `}</style>

      <div className="screen-bar">
        <span className="screen-bar-title">
          Rate breakup quotation — {sheet.name} · A4 portrait
          {showAmounts && " · with amounts (internal)"}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <a href={`/reports/tender/${sheet.id}/print${showAmounts ? "" : "?amounts=1"}`}>
            {showAmounts ? "Rates only (client copy)" : "Show ₹ amounts (internal)"}
          </a>
          <PrintBtn />
        </span>
      </div>

      <div className="wrap">
        {/* Letterhead */}
        <div className="lh">
          <div className="lh-name">MATESHWARI<br />TEMPLE CONSTRUCTION PVT. LTD.</div>
          <div className="lh-addr">G-109, RIICO INDUSTRIAL AREA, SIROHI ROAD, PINDWARA, DISTT- SIROHI (RAJ) 307022</div>
          <div className="lh-contact">Contact No. – 9414152740 · Email- mtcplg109@yahoo.in · Website- www.mateshwaritemples.com</div>
          <div className="lh-rule" />
        </div>

        <div className="letter-meta">
          {q?.refNo ? <span>Ref: {q.refNo}</span> : null}
          <span>Date: {dateStr}</span>
        </div>

        {/* Addressee */}
        <div className="to">
          <div className="to-k">To,</div>
          {q?.toName ? <div>{q.toName},</div> : null}
          {toLines.map((l, i) => <div key={i}>{l}{i < toLines.length - 1 ? "," : ""}</div>)}
        </div>

        <div className="salut">Dear Respected Sir,</div>
        <div className="intro">{intro}</div>

        {/* Rate breakup — one table per master group */}
        {tables.map((t) => (
          <div className="tbl-wrap" key={t.id}>
            <table className="rb">
              <caption>Rate Breakup for {t.title}</caption>
              <thead>
                <tr>
                  <th>Sr.</th>
                  <th>Particulars</th>
                  <th>Uom.</th>
                  <th>Rate</th>
                  {showAmounts && <th>Amount ₹</th>}
                </tr>
              </thead>
              <tbody>
                {t.rows.length === 0 && (
                  <tr><td className="pt" colSpan={showAmounts ? 5 : 4} style={{ textAlign: "center", color: "#999" }}>No priced lines in this section yet.</td></tr>
                )}
                {t.rows.map((r) => (
                  <tr key={r.sr}>
                    <td className="sr">{r.sr}</td>
                    <td className="pt">
                      {r.particulars}
                      {/* Internal group names never go out on the client copy —
                          their paper quotation is a flat list of particulars. */}
                      {showAmounts && r.group ? <span className="grp"> · {r.group}</span> : null}
                    </td>
                    <td className="uom">{t.uom}</td>
                    <td className="rate">{rateCell(r.rate)}</td>
                    {showAmounts && <td className="amt">{rupees(r.amount)}</td>}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="lbl" colSpan={3}>Total Rate Per {t.uom}</td>
                  <td className="rate">{rateCell(t.totalRate)}</td>
                  {showAmounts && <td className="amt">{rupees(t.totalAmount)}</td>}
                </tr>
              </tfoot>
            </table>
          </div>
        ))}

        {/* Only a multi-table quotation needs a combined figure — a single
            breakup already closes on its own Total Rate row. */}
        {multi && showAmounts && (
          <div className="tbl-wrap">
            <table className="rb">
              <tfoot>
                <tr>
                  <td className="lbl" colSpan={3}>Total estimate — all sections</td>
                  <td className="amt">{rupees(calc.grand)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {noQty.length > 0 ? (
          <div className="noqty">
            {noQty.length === tables.length ? "This quotation" : `"${noQty.map((t) => t.title).join('", "')}"`} has no
            project quantity, so lump-sum (₹ fixed) and % lines cannot be expressed as a per-unit
            rate. Set the quantity on the breakdown and reopen this quotation for a complete rate column.
          </div>
        ) : null}

        {terms.length > 0 && (
          <div className="terms">
            <div className="terms-h">Terms &amp; Condition:-</div>
            <ol>{terms.map((t, i) => <li key={i}>{t}</li>)}</ol>
          </div>
        )}

        <div className="thanks">Thank you,</div>
        <div className="sign">
          <div className="sign-for">For: Mateshwari Temple Construction Pvt. Ltd.</div>
          <div className="sign-line">Authorised Signatory</div>
        </div>

        <div className="foot-note">
          Rate breakup generated from the internal price-breakdown sheet
          {tables.filter((t) => t.qty).map((t) => ` · ${t.qty!.toLocaleString("en-IN")} ${t.uom} ${multi ? t.title : "project quantity"}`).join("")}
          {" · "}{new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })}
        </div>
      </div>
    </>
  );
}
