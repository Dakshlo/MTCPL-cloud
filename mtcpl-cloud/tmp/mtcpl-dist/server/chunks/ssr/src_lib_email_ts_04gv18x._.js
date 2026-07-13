;!function(){try { var e="undefined"!=typeof globalThis?globalThis:"undefined"!=typeof global?global:"undefined"!=typeof window?window:"undefined"!=typeof self?self:{},n=(new e.Error).stack;n&&((e._debugIds|| (e._debugIds={}))[n]="6151c337-7b7e-dea6-a90a-721e984b9d49")}catch(e){}}();
module.exports=[428725,a=>{"use strict";async function b(a){let b=process.env.RESEND_API_KEY;if(!b)return console.warn("[email] RESEND_API_KEY not set — skipping email to",a.to),{ok:!1,skipped:!0,error:"RESEND_API_KEY not configured"};let c=process.env.EMAIL_FROM||"MTCPL Accounts <account@mtcpl.co>";try{let d={from:c,to:[a.to],subject:a.subject,html:a.html};a.text&&(d.text=a.text),a.replyTo&&(d.reply_to=a.replyTo),a.attachments&&a.attachments.length>0&&(d.attachments=a.attachments.map(a=>{let b={filename:a.filename,content:a.content};return a.contentId&&(b.content_id=a.contentId),b}));let e=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${b}`,"Content-Type":"application/json"},body:JSON.stringify(d)});if(!e.ok){let a=await e.text().catch(()=>"");return{ok:!1,error:`Resend HTTP ${e.status}: ${a.slice(0,200)}`}}let f=await e.json().catch(()=>null);return{ok:!0,id:f?.id??"unknown"}}catch(a){return{ok:!1,error:a instanceof Error?a.message:"Unknown email error"}}}function c(a,b,e=!1){let f=e?"#f8fafc":"#ffffff";return`<tr>
    <td style="padding:10px 14px;color:#64748b;width:200px;background:${f};font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;">${d(a)}</td>
    <td style="padding:10px 14px;background:${f};">${b}</td>
  </tr>`}function d(a){return a.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}a.s(["buildVoucherEmailHtml",0,function(a){let b=a.paidAtIso?new Date(new Date(a.paidAtIso).getTime()+198e5).toISOString().slice(0,10).split("-").reverse().join("/"):"—",e=a.paidAmount.toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2}),f=`INR ${e}`,g=`&#8377; ${e}`,h=a.logoCid?`<img src="cid:${d(a.logoCid)}" alt="${d(a.companyName)}" width="42" height="42" style="display:block;border-radius:8px;background:#ffffff;padding:6px;">`:`<div style="width:42px;height:42px;border-radius:8px;background:#ffffff;color:#0f172a;display:inline-block;line-height:42px;text-align:center;font-weight:800;font-size:18px;">${d(a.companyName.slice(0,1))}</div>`;return`<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;color:#1f2937;background:#f1f5f9;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 4px 16px rgba(15,23,42,0.06);">

          <!-- Dark header band: logo + company -->
          <tr>
            <td style="padding:22px 28px;background:#0f172a;color:#ffffff;">
              <table cellpadding="0" cellspacing="0" style="width:100%;">
                <tr>
                  <td style="vertical-align:middle;width:54px;">${h}</td>
                  <td style="vertical-align:middle;padding-left:14px;">
                    <div style="font-size:15px;font-weight:800;color:#ffffff;letter-spacing:-0.005em;">${d(a.companyName)}</div>
                    <div style="font-size:11px;color:#94a3b8;margin-top:3px;">${a.companyAddressLines.map(d).join(" · ")}</div>
                  </td>
                  <td style="vertical-align:middle;text-align:right;font-size:10px;font-weight:700;color:#fbbf24;letter-spacing:0.1em;text-transform:uppercase;">
                    Payment<br/>Notification
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- HERO amount band -->
          <tr>
            <td style="padding:28px 28px 18px;background:linear-gradient(180deg,#fffbeb 0%,#ffffff 100%);border-bottom:1px solid #f1f5f9;">
              <div style="font-size:11px;font-weight:800;color:#92400e;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:6px;">Amount transferred</div>
              <div style="font-family:'Courier New',monospace;font-size:38px;font-weight:800;color:#0f172a;letter-spacing:-0.02em;line-height:1.1;">
                ${g}
              </div>
              <div style="font-size:12px;color:#78350f;font-style:italic;margin-top:6px;">
                ${d(a.amountInWords)}
              </div>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:24px 28px 4px;">
              <h1 style="margin:0 0 12px;font-size:18px;color:#0f172a;font-weight:700;">Dear ${d(a.vendorName)},</h1>
              <p style="font-size:14px;line-height:1.65;color:#334155;margin:0 0 22px;">
                We have transferred <strong style="color:#0f172a;">${f}</strong> against your bill
                <code style="background:#fef3c7;color:#78350f;padding:2px 8px;border-radius:5px;font-family:'Courier New',monospace;font-weight:700;">${d(a.vendorBillNo)}</code>
                on <strong style="color:#0f172a;">${b}</strong>.
              </p>

              <!-- Details -->
              <table cellpadding="0" cellspacing="0" style="width:100%;font-size:13px;margin-bottom:22px;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
                ${c("Amount paid",`<strong style="font-family:'Courier New',monospace;color:#0f172a;">${d(f)}</strong>`,!0)}
                ${c("Payment method",`<span style="font-weight:700;color:#0f172a;">${d((a.paymentMethod??"—").toUpperCase())}</span>`)}
                ${c("UTR / Reference",`<span style="background:#fef3c7;color:#78350f;padding:2px 8px;border-radius:5px;font-family:'Courier New',monospace;font-weight:700;">${d(a.paymentReference??"—")}</span>`,!0)}
                ${c("Bill token (our ref)",`<span style="background:#dbeafe;color:#1e40af;padding:2px 8px;border-radius:5px;font-family:'Courier New',monospace;font-weight:700;">${d(a.billToken)}</span>`)}
                ${c("Vendor bill no.",`<span style="background:#fef3c7;color:#78350f;padding:2px 8px;border-radius:5px;font-family:'Courier New',monospace;font-weight:700;">${d(a.vendorBillNo)}</span>`,!0)}
                ${c("Payment date",`<strong style="color:#0f172a;">${b}</strong>`)}
              </table>

              <!-- Reassurance -->
              <div style="padding:14px 16px;background:#f1f5f9;border-left:3px solid #4f46e5;border-radius:6px;margin-bottom:8px;">
                <div style="font-size:13px;line-height:1.6;color:#334155;">
                  A formal payment voucher PDF is attached for your records. If you spot any discrepancy,
                  reply to this email and we'll reconcile.
                </div>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:18px 28px;background:#0f172a;color:#94a3b8;font-size:11px;line-height:1.6;">
              <strong style="color:#ffffff;">${d(a.companyName)}</strong><br/>
              ${a.companyAddressLines.map(d).join(", ")}<br/>
              <a href="mailto:account@mtcpl.co" style="color:#fbbf24;text-decoration:none;">account@mtcpl.co</a> \xb7 automated payment notification
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`},"buildVoucherEmailText",0,function(a){let b=`INR ${a.paidAmount.toLocaleString("en-IN")}`;return`Dear ${a.vendorName},

We have transferred ${b} against your bill ${a.vendorBillNo}.

Amount paid:     ${b}
In words:        ${a.amountInWords}
Method:          ${a.paymentMethod??"—"}
UTR / Ref:       ${a.paymentReference??"—"}
Bill token:      ${a.billToken}
Vendor bill no.: ${a.vendorBillNo}
Payment date:    ${a.paidAtIso?a.paidAtIso.slice(0,10):"—"}

Voucher PDF attached. Reply to this email if anything looks off.

— ${a.companyName}`},"sendEmail",0,b])}];

//# debugId=6151c337-7b7e-dea6-a90a-721e984b9d49
//# sourceMappingURL=src_lib_email_ts_04gv18x._.js.map