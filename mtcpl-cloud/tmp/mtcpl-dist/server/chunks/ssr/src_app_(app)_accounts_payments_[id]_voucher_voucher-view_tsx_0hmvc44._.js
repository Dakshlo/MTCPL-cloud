;!function(){try { var e="undefined"!=typeof globalThis?globalThis:"undefined"!=typeof global?global:"undefined"!=typeof window?window:"undefined"!=typeof self?self:{},n=(new e.Error).stack;n&&((e._debugIds|| (e._debugIds={}))[n]="e55fef7d-37f4-9422-d358-491a5ea9ff8f")}catch(e){}}();
module.exports=[757711,a=>{"use strict";var b=a.i(187924),c=a.i(238246);let d=["","One","Two","Three","Four","Five","Six","Seven","Eight","Nine","Ten","Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen","Seventeen","Eighteen","Nineteen"],e=["","","Twenty","Thirty","Forty","Fifty","Sixty","Seventy","Eighty","Ninety"];function f(a){if(a<20)return d[a];let b=Math.floor(a/10),c=a%10;return 0===c?e[b]:`${e[b]}-${d[c]}`}let g="MATESHWARI TEMPLE CONSTRUCTION PVT LTD";function h({k:a,v:c,mono:d,highlight:e}){return(0,b.jsxs)(b.Fragment,{children:[(0,b.jsx)("dt",{children:a}),(0,b.jsx)("dd",{className:"sep",children:":"}),(0,b.jsx)("dd",{style:{fontFamily:d?"ui-monospace, SFMono-Regular, Menlo, monospace":void 0,background:e?"#fff3cd":void 0,padding:e?"2px 8px":void 0,borderRadius:e?4:void 0,display:e?"inline-block":void 0,justifySelf:"start"},children:c})]})}function i({label:a,name:c,companySuffix:d}){return(0,b.jsxs)("div",{children:[(0,b.jsx)("div",{className:"voucher-sig-spacer",style:{fontSize:10,fontWeight:800,color:"#666",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:32},children:a}),(0,b.jsxs)("div",{style:{borderTop:"1px solid #444",paddingTop:6,fontSize:12,fontWeight:700,color:"#222"},children:[c,d&&(0,b.jsx)("em",{style:{fontStyle:"normal"},children:g})]})]})}a.s(["VoucherView",0,function({payment:a,bill:e,vendor:j}){var k,l;let m,n,o,p,q=a.paidAt?new Date(a.paidAt):new Date,r=(k=a.id,m=String((l=q).getDate()).padStart(2,"0"),n=String(l.getMonth()+1).padStart(2,"0"),o=String(l.getFullYear()).slice(2),p=k.replace(/-/g,"").slice(-6).toUpperCase(),`MTCPL/${m}${n}${o}/${p}`),s=function(a){if(!Number.isFinite(a))return"—";let b=a<0?"Minus ":"",c=Math.abs(a),e=Math.floor(c),g=Math.round((c-e)*100),h=function(a){let b=Math.floor(Math.abs(a));if(0===b)return"Zero";let c=Math.floor(b/1e7),e=Math.floor(b%1e7/1e5),g=Math.floor(b%1e5/1e3),h=b%1e3,i=[];return c&&i.push(`${f(c)} Crore`),e&&i.push(`${f(e)} Lakh`),g&&i.push(`${f(g)} Thousand`),h&&i.push(function(a){if(0===a)return"";if(a<100)return f(a);let b=Math.floor(a/100),c=a%100;return`${d[b]} Hundred${c?` ${f(c)}`:""}`}(h)),i.join(" ")}(e)||"Zero";if(0===g)return`${b}${h} Rupees`;let i=f(g);return`${b}${h} Rupees and ${i} Paise`}(a.paidAmount);return(0,b.jsxs)(b.Fragment,{children:[(0,b.jsx)("style",{children:`
        @media print {
          @page { size: A4; margin: 0; }
          .voucher-screen-chrome { display: none !important; }
          body, .page-content { background: #fff !important; }
          .voucher-page {
            box-shadow: none !important;
            margin: 0 !important;
            padding: 10mm 14mm !important;
            max-width: none !important;
            border: none !important;
            font-size: 12px !important;
            page-break-inside: avoid !important;
          }
          .voucher-kv { gap: 3px 12px !important; font-size: 11.5px !important; }
          .voucher-letterhead-header { padding-bottom: 8px !important; }
          .voucher-title-pill { padding: 5px 14px !important; font-size: 11.5px !important; }
          .voucher-print-title-wrap { margin: 12px 0 14px !important; }
          .voucher-salutation { margin: 14px 0 0 !important; font-size: 11.5px !important; line-height: 1.5 !important; }
          .voucher-description { margin-top: 10px !important; padding: 7px 12px !important; font-size: 11px !important; }
          .voucher-signatures { margin-top: 22px !important; gap: 28px !important; }
          .voucher-sig-spacer { margin-bottom: 22px !important; }
          .voucher-letterhead-footer { margin-top: 14px !important; padding-top: 7px !important; font-size: 9.5px !important; }
          .voucher-letterhead-footer .gen-note { margin-top: 3px !important; }
        }
        .voucher-page {
          background: #fff;
          color: #111;
          max-width: 820px;
          margin: 0 auto;
          padding: 32px 40px 40px;
          border: 1px solid #d8d4c7;
          border-radius: 8px;
          box-shadow: 0 2px 12px rgba(0,0,0,0.06);
          font-family: ui-sans-serif, system-ui, "Helvetica Neue", Arial, sans-serif;
          position: relative;
        }
        /* Letterhead chrome — logo top-left + gold accent line. */
        .voucher-letterhead-header {
          display: flex;
          align-items: center;
          padding-bottom: 14px;
          border-bottom: 1px solid #222;
          margin-bottom: 0;
        }
        .voucher-letterhead-header img {
          height: 56px;
          width: auto;
        }
        .voucher-title-pill {
          display: inline-block;
          padding: 7px 18px;
          background: var(--gold-dark, #b87333);
          color: #fff;
          font-size: 13px;
          font-weight: 800;
          letter-spacing: 0.08em;
          border-radius: 4px;
        }
        /* Letterhead footer — address + phones + websites. */
        .voucher-letterhead-footer {
          margin-top: 28px;
          padding-top: 10px;
          border-top: 1px solid #222;
          text-align: center;
          font-size: 10.5px;
          color: #555;
          line-height: 1.55;
        }
        .voucher-letterhead-footer .gen-note {
          font-size: 9px;
          font-style: italic;
          color: #888;
          margin-top: 6px;
        }
        .voucher-kv { display: grid; grid-template-columns: 200px auto 1fr; gap: 6px 12px; font-size: 13px; }
        .voucher-kv dt { color: #555; font-weight: 600; }
        .voucher-kv dd { margin: 0; color: #111; font-weight: 600; }
        .voucher-kv .sep { color: #888; }
      `}),(0,b.jsxs)("div",{className:"voucher-screen-chrome",style:{maxWidth:780,margin:"0 auto 14px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap"},children:[(0,b.jsxs)(c.default,{href:`/accounts/bills/${e.id}`,style:{fontSize:13,fontWeight:600,color:"var(--muted)",textDecoration:"none"},children:["← Back to bill ",e.token]}),(0,b.jsx)("button",{type:"button",onClick:()=>window.print(),style:{padding:"9px 18px",fontSize:13,fontWeight:700,background:"var(--gold)",color:"#fff",border:"1px solid var(--gold-dark)",borderRadius:8,cursor:"pointer"},children:"🖨 Print / Save as PDF"})]}),(0,b.jsxs)("article",{className:"voucher-page",children:[(0,b.jsx)("header",{className:"voucher-letterhead-header",children:(0,b.jsx)("img",{src:"/logo-dark.png",alt:"MTCPL"})}),(0,b.jsx)("div",{className:"voucher-print-title-wrap",style:{textAlign:"center",margin:"20px 0 22px"},children:(0,b.jsx)("span",{className:"voucher-title-pill",children:"PAYMENT VOUCHER"})}),(0,b.jsxs)("dl",{className:"voucher-kv",children:[(0,b.jsx)(h,{k:"Voucher No",v:r,mono:!0}),(0,b.jsx)(h,{k:"Voucher Date",v:q.toLocaleDateString("en-IN",{timeZone:"Asia/Kolkata",day:"2-digit",month:"2-digit",year:"numeric"})}),(0,b.jsx)(h,{k:"Remitter Name",v:g}),(0,b.jsx)(h,{k:"Beneficiary Name",v:j.name.toUpperCase()}),j.bank_account&&(0,b.jsx)(h,{k:"Beneficiary A/c No",v:j.bank_account,mono:!0}),j.ifsc&&(0,b.jsx)(h,{k:"Beneficiary IFSC",v:j.ifsc,mono:!0}),j.gstin&&(0,b.jsx)(h,{k:"Beneficiary GSTIN",v:j.gstin,mono:!0}),j.pan&&(0,b.jsx)(h,{k:"Beneficiary PAN",v:j.pan,mono:!0}),(0,b.jsx)(h,{k:"Bill Token",v:e.token,mono:!0,highlight:!0}),(0,b.jsx)(h,{k:"Vendor's Bill No",v:e.vendorBillNo,mono:!0}),(0,b.jsx)(h,{k:"Bill Date",v:new Date(e.billDate).toLocaleDateString("en-IN",{timeZone:"Asia/Kolkata",day:"2-digit",month:"2-digit",year:"numeric"})}),e.costHead&&(0,b.jsx)(h,{k:"Cost Head",v:e.costHead}),(0,b.jsx)(h,{k:"Payment Mode",v:(a.paymentMethod??"—").toUpperCase(),mono:!0}),a.paymentReference&&(0,b.jsx)(h,{k:"cheque"===a.paymentMethod?"Cheque No":"upi"===a.paymentMethod?"UPI Txn Ref":"UTR / Reference",v:a.paymentReference,mono:!0,highlight:!0}),a.paymentNote&&(0,b.jsx)(h,{k:"Payment Note",v:a.paymentNote}),(0,b.jsx)(h,{k:"Amount",v:`₹${a.paidAmount.toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2})}`,mono:!0,highlight:!0}),(0,b.jsx)(h,{k:"Amount in Words",v:`${s} Only`}),e.amountTds>0&&(0,b.jsx)(h,{k:"TDS deducted (info only)",v:`₹${e.amountTds.toLocaleString("en-IN",{minimumFractionDigits:2})}`,mono:!0}),e.amountTcs>0&&(0,b.jsx)(h,{k:"TCS in total (info only)",v:`₹${e.amountTcs.toLocaleString("en-IN",{minimumFractionDigits:2})}`,mono:!0})]}),(0,b.jsxs)("p",{className:"voucher-salutation",style:{margin:"22px 0 0",fontSize:13,lineHeight:1.6,color:"#222"},children:["Dear Sir / Madam,",(0,b.jsx)("br",{}),"We are pleased to credit your account",j.bank_account?` (${j.bank_account})`:""," with us for",(0,b.jsxs)("strong",{children:[" ","₹",a.paidAmount.toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2})," "]}),"(",s," Only) against bill"," ",(0,b.jsx)("strong",{children:e.token})," ","(",e.vendorBillNo,") dated"," ",new Date(e.billDate).toLocaleDateString("en-IN",{timeZone:"Asia/Kolkata",day:"2-digit",month:"long",year:"numeric"}),"."]}),e.description&&(0,b.jsxs)("div",{className:"voucher-description",style:{marginTop:18,padding:"10px 14px",background:"#f9f7f1",border:"1px solid #ddd6c2",borderRadius:6,fontSize:12,color:"#333",lineHeight:1.6},children:[(0,b.jsx)("div",{style:{fontSize:10,fontWeight:800,color:"#666",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:4},children:"Bill description"}),e.description]}),(0,b.jsxs)("div",{className:"voucher-signatures",style:{marginTop:56,display:"grid",gridTemplateColumns:"1fr 1fr",gap:36},children:[(0,b.jsx)(i,{label:"Prepared by",name:a.paidByName??"Accountant"}),(0,b.jsx)(i,{label:"Authorised signatory",name:"For ",companySuffix:!0})]}),(0,b.jsxs)("footer",{className:"voucher-letterhead-footer",children:[(0,b.jsx)("div",{children:"Mateshwari Temples Construction Pvt. Ltd. · Nh-27, Opposite Ajari Gate, Pindwara, Dist-Sirohi, Rajasthan"}),(0,b.jsx)("div",{children:"☎ +91 9414152740 / +91 9414374979 · 🌐 Mtcpl.org · mateshwaritemples.com"}),(0,b.jsxs)("div",{className:"gen-note",children:["Computer-generated voucher · ",new Date().toLocaleString("en-IN",{timeZone:"Asia/Kolkata",day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"})]})]})]})]})}],757711)}];

//# debugId=e55fef7d-37f4-9422-d358-491a5ea9ff8f
//# sourceMappingURL=src_app_%28app%29_accounts_payments_%5Bid%5D_voucher_voucher-view_tsx_0hmvc44._.js.map