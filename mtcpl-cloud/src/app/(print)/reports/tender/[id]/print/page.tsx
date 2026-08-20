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
 * Developer + owner — the same gate as the workspace it prints from.
 */

import { Fragment } from "react";
import { notFound, redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  TENDER_KEY, canUseTender, computeSheetTotal, quoteTables,
  type TenderAnalysis,
} from "@/app/(app)/reports/temple-pnl/tender-model";
import { FitToPage } from "./fit-to-page";
import { PrintBtn } from "./print-btn";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;
type Search = Promise<{ amounts?: string; fit?: string }>;

const rupees = (n: number) => Math.round(n).toLocaleString("en-IN");

/** "1200/-" — the rate style the company's own quotations use. */
const rateCell = (n: number | null) => (n == null ? "—" : `${rupees(n)}/-`);

/** Keep both switches in the URL when either one is flipped. */
function href(id: string, amounts: boolean, fit: boolean): string {
  const q = [amounts ? "amounts=1" : "", fit ? "fit=1" : ""].filter(Boolean).join("&");
  return `/reports/tender/${id}/print${q ? `?${q}` : ""}`;
}

const pageBtn = (on: boolean): React.CSSProperties => ({
  padding: "4px 11px",
  fontSize: 11,
  fontWeight: 800,
  textDecoration: "none",
  background: on ? "#fff" : "transparent",
  color: on ? "#1a1a1a" : "rgba(255,255,255,0.7)",
});

export default async function TenderQuotationPrint({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { profile } = await requireAuth();
  if (!canUseTender(profile.role)) redirect("/dashboard");

  const { id } = await params;
  const { amounts: amountsParam, fit: fitParam } = await searchParams;
  const showAmounts = amountsParam === "1";
  // Long breakups run to two sheets; the office would rather hand over one.
  const fitOnePage = fitParam === "1";

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
        .wrap { max-width: 820px; margin: 0 auto; background: #fff; padding: 22px 40px 26px; position: relative; min-height: 1120px; display: flex; flex-direction: column; }
        .screen-bar { background: #1a1a1a; color: #fff; padding: 9px 28px; display: flex; align-items: center; justify-content: space-between; gap: 12px; max-width: 1180px; margin: 0 auto; }
        .screen-bar-title { font-size: 12px; color: rgba(255,255,255,0.65); }
        .screen-bar a { color: rgba(255,255,255,0.75); font-size: 11.5px; font-weight: 700; text-decoration: none; }

        /* ── letterhead: identical to the invoicing documents ── */
        /* The logo is taken OUT of the flow so the company block can centre on
           the page's own axis. As a grid cell it stole width and pushed the
           details a dozen pixels right of centre — visible, and wrong. */
        .head { position: relative; min-height: 62px; display: flex; align-items: center; justify-content: center; border-bottom: 2.5px double #1e3a5f; padding-bottom: 5px; }
        .brand-logo { position: absolute; left: 0; top: 50%; transform: translateY(-50%); height: 62px; width: auto; }
        .company-block { text-align: center; min-width: 0; padding: 0 96px; }
        .cn { font-size: 16px; font-weight: 800; color: #0f2540; }
        .cl { font-size: 10.5px; color: #666; margin-top: 1px; line-height: 1.35; }

        .letter-meta { display: flex; justify-content: flex-end; gap: 22px; margin-top: 9px; font-size: 11.5px; font-weight: 700; color: #0f2540; }
        .to { margin-top: 2px; font-size: 12px; line-height: 1.45; }
        .to-k { font-weight: 700; }
        .salut { margin-top: 9px; font-size: 12px; font-weight: 700; }
        .intro { margin-top: 7px; font-size: 12px; line-height: 1.6; text-align: justify; text-indent: 34px; }
        .qty-line { margin-top: 3px; font-size: 10.5px; color: #666; font-weight: 700; text-align: right; }

        /* ── the rate table ── */
        .tbl-wrap { margin: 11px auto 0; width: 92%; }
        table.rb { width: 100%; border-collapse: collapse; font-size: 12px; }
        table.rb caption { caption-side: top; font-size: 12px; font-weight: 800; color: #0f2540; background: #eef2f7; padding: 5px 6px; border: 1px solid #1e3a5f; border-bottom: none; text-align: center; text-transform: uppercase; letter-spacing: 0.04em; }
        table.rb th, table.rb td { border: 1px solid #d3dae3; padding: 4px 8px; }
        table.rb th { background: #eef2f7; color: #444; text-transform: uppercase; letter-spacing: 0.04em; }
        table.rb th { font-size: 11.5px; font-weight: 800; text-align: center; }
        table.rb td.sr { text-align: center; width: 38px; color: #777; }
        table.rb td.pt { text-align: left; }
        /* Cost-head band — the group's name on the left, its own rate on the right. */
        table.rb tr.band td { background: #f4f7fb; font-weight: 800; font-size: 10px; color: #4a5a70; text-transform: uppercase; letter-spacing: 0.09em; padding: 3px 8px; }
        table.rb td.uom { text-align: center; width: 74px; }
        table.rb td.rate { text-align: right; width: 108px; font-variant-numeric: tabular-nums; }
        table.rb td.amt { text-align: right; width: 118px; font-variant-numeric: tabular-nums; }
        table.rb tfoot td { font-weight: 800; background: #f3f6fa; border: 1px solid #d3dae3; color: #0f2540; }
        table.rb tfoot td.lbl { text-align: left; }
        .grp { font-size: 9px; font-weight: 800; letter-spacing: 0.07em; text-transform: uppercase; color: #999; }

        .noqty { margin: 11px auto 0; width: 92%; border: 1px solid #e0c39a; background: #fdf6ec; border-radius: 5px; padding: 9px 12px; font-size: 11.5px; color: #8a5a17; line-height: 1.6; }

        .sum { margin: 10px auto 0; width: 92%; display: flex; justify-content: flex-end; }
        .sum table { border-collapse: collapse; font-size: 11.5px; }
        .sum td { border: 1px solid #d3dae3; padding: 4px 12px; }
        .sum td.k { background: #eef2f7; font-weight: 700; color: #444; }
        .sum td.v { font-weight: 800; text-align: right; font-variant-numeric: tabular-nums; color: #0f2540; }
        .terms { margin-top: 13px; }
        .terms-h { font-size: 12.5px; font-weight: 800; text-decoration: underline; }
        .terms ol { margin: 4px 0 0 20px; font-size: 12px; line-height: 1.6; }
        .thanks { margin-top: 13px; font-size: 12px; }
        .sign { margin-top: 16px; font-size: 12px; }
        .sign-for { font-weight: 700; }
        .sign-line { margin-top: 34px; font-weight: 700; }
        .foot-note { margin-top: auto; padding-top: 12px; font-size: 8.5px; color: #b0b0b0; text-align: center; }

        /* Fit mode: the preview IS the page — true A4 width and print padding,
           with FitToPage setting the zoom that makes it end before the sheet
           does. Nothing here changes the normal (multi-page) view. */
        .wrap.fit { width: 794px; max-width: none; padding: 12mm 14mm; min-height: 0; }
        /* In normal mode, never let a table or the signature straddle a seam. */
        .tbl-wrap, .sum, .terms, .sign { break-inside: avoid; page-break-inside: avoid; }

        @media print {
          body { background: #fff; }
          .screen-bar { display: none; }
          .wrap { max-width: none; padding: 12mm 14mm; min-height: 0; box-shadow: none; }
          .wrap.fit { width: auto; }
          @page { size: A4 portrait; margin: 0; }
        }
      `}</style>

      <div className="screen-bar">
        <span className="screen-bar-title">
          Rate breakup quotation — {sheet.name} · A4 portrait
          {showAmounts && " · with amounts (internal)"}
          <span id="fit-note" style={{ marginLeft: 10, color: "rgba(255,255,255,0.5)" }} />
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <a href={href(sheet.id, !showAmounts, fitOnePage)}>
            {showAmounts ? "Rates only (client copy)" : "Show ₹ amounts (internal)"}
          </a>
          {/* Two ways to print it: let it flow, or squeeze it onto one sheet. */}
          <span style={{ display: "inline-flex", border: "1px solid rgba(255,255,255,0.22)", borderRadius: 7, overflow: "hidden" }}>
            <a href={href(sheet.id, showAmounts, false)} style={pageBtn(!fitOnePage)}>Normal</a>
            <a href={href(sheet.id, showAmounts, true)} style={pageBtn(fitOnePage)}>Fit to one page</a>
          </span>
          <PrintBtn />
        </span>
      </div>

      <FitToPage enabled={fitOnePage} />

      <div className={fitOnePage ? "wrap fit" : "wrap"}>
        {/* Letterhead — the same block every MTCPL document carries. */}
        <div className="head">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mtcpl.png" alt="MTCPL" className="brand-logo" />
          <div className="company-block">
            <div className="cn">MATESHWARI TEMPLE CONSTRUCTION PVT LTD</div>
            <div className="cl">G-109, RIICO Ind. Area, Sirohi Road, Teh. Pindwara, Dist. Sirohi, Rajasthan</div>
            <div className="cl">GSTIN: 08AAFCM15Q1ZA · ☎ 759 759 1188 · temple@mtcpl.co</div>
          </div>
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
            {t.qty ? <div className="qty-line">Quantity: {t.qty.toLocaleString("en-IN")} {t.uom}</div> : null}
            <table className="rb">
              {/* The caption supplies "Rate Breakup for"; a master group named
                  "Rate Breakup for Sandstone Carving Work" would otherwise print
                  it twice. Strip the prefix rather than make them rename. */}
              <caption>Rate Breakup for {t.title.replace(/^\s*rate\s*break-?up\s*(for\s*)?/i, "") || t.title}</caption>
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
                {t.groups.length === 0 && (
                  <tr><td className="pt" colSpan={showAmounts ? 5 : 4} style={{ textAlign: "center", color: "#999" }}>No priced lines in this section yet.</td></tr>
                )}
                {t.groups.map((g) => (
                  <Fragment key={g.id}>
                    {g.title && (
                      <tr className="band">
                        <td colSpan={showAmounts ? 5 : 4}>{g.title}</td>
                      </tr>
                    )}
                    {g.rows.map((r) => (
                      <tr key={r.sr}>
                        <td className="sr">{r.sr}</td>
                        <td className="pt">{r.particulars}</td>
                        <td className="uom">{t.uom}</td>
                        <td className="rate">{rateCell(r.rate)}</td>
                        {showAmounts && <td className="amt">{rupees(r.amount)}</td>}
                      </tr>
                    ))}
                  </Fragment>
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
          <div className="sum">
            <table>
              <tbody>
                {tables.map((t) => (
                  <tr key={t.id}>
                    <td className="k">{t.title}</td>
                    <td className="v">{rupees(t.totalAmount)}</td>
                  </tr>
                ))}
                <tr>
                  <td className="k" style={{ fontWeight: 800 }}>Total estimate</td>
                  <td className="v">{rupees(calc.grand)}</td>
                </tr>
              </tbody>
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
