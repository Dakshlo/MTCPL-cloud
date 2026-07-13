;!function(){try { var e="undefined"!=typeof globalThis?globalThis:"undefined"!=typeof global?global:"undefined"!=typeof window?window:"undefined"!=typeof self?self:{},n=(new e.Error).stack;n&&((e._debugIds|| (e._debugIds={}))[n]="cfff77c2-5907-5fc6-0023-c4e8ff17301b")}catch(e){}}();
(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,574168,e=>{"use strict";var t=e.i(843476),o=e.i(522016);let i=["","One","Two","Three","Four","Five","Six","Seven","Eight","Nine","Ten","Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen","Seventeen","Eighteen","Nineteen"],n=["","","Twenty","Thirty","Forty","Fifty","Sixty","Seventy","Eighty","Ninety"];function r(e){if(e<20)return i[e];let t=Math.floor(e/10),o=e%10;return 0===o?n[t]:`${n[t]}-${i[o]}`}let a="MATESHWARI TEMPLE CONSTRUCTION PVT LTD";function s({k:e,v:o,mono:i,highlight:n}){return(0,t.jsxs)(t.Fragment,{children:[(0,t.jsx)("dt",{children:e}),(0,t.jsx)("dd",{className:"sep",children:":"}),(0,t.jsx)("dd",{style:{fontFamily:i?"ui-monospace, SFMono-Regular, Menlo, monospace":void 0,background:n?"#fff3cd":void 0,padding:n?"2px 8px":void 0,borderRadius:n?4:void 0,display:n?"inline-block":void 0,justifySelf:"start"},children:o})]})}function l({label:e,name:o,companySuffix:i}){return(0,t.jsxs)("div",{children:[(0,t.jsx)("div",{className:"voucher-sig-spacer",style:{fontSize:10,fontWeight:800,color:"#666",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:32},children:e}),(0,t.jsxs)("div",{style:{borderTop:"1px solid #444",paddingTop:6,fontSize:12,fontWeight:700,color:"#222"},children:[o,i&&(0,t.jsx)("em",{style:{fontStyle:"normal"},children:a})]})]})}e.s(["VoucherView",0,function({payment:e,bill:n,vendor:d}){var p,c;let m,h,u,g,x=e.paidAt?new Date(e.paidAt):new Date,f=(p=e.id,m=String((c=x).getDate()).padStart(2,"0"),h=String(c.getMonth()+1).padStart(2,"0"),u=String(c.getFullYear()).slice(2),g=p.replace(/-/g,"").slice(-6).toUpperCase(),`MTCPL/${m}${h}${u}/${g}`),v=function(e){if(!Number.isFinite(e))return"—";let t=e<0?"Minus ":"",o=Math.abs(e),n=Math.floor(o),a=Math.round((o-n)*100),s=function(e){let t=Math.floor(Math.abs(e));if(0===t)return"Zero";let o=Math.floor(t/1e7),n=Math.floor(t%1e7/1e5),a=Math.floor(t%1e5/1e3),s=t%1e3,l=[];return o&&l.push(`${r(o)} Crore`),n&&l.push(`${r(n)} Lakh`),a&&l.push(`${r(a)} Thousand`),s&&l.push(function(e){if(0===e)return"";if(e<100)return r(e);let t=Math.floor(e/100),o=e%100;return`${i[t]} Hundred${o?` ${r(o)}`:""}`}(s)),l.join(" ")}(n)||"Zero";if(0===a)return`${t}${s} Rupees`;let l=r(a);return`${t}${s} Rupees and ${l} Paise`}(e.paidAmount);return(0,t.jsxs)(t.Fragment,{children:[(0,t.jsx)("style",{children:`
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
      `}),(0,t.jsxs)("div",{className:"voucher-screen-chrome",style:{maxWidth:780,margin:"0 auto 14px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap"},children:[(0,t.jsxs)(o.default,{href:`/accounts/bills/${n.id}`,style:{fontSize:13,fontWeight:600,color:"var(--muted)",textDecoration:"none"},children:["← Back to bill ",n.token]}),(0,t.jsx)("button",{type:"button",onClick:()=>window.print(),style:{padding:"9px 18px",fontSize:13,fontWeight:700,background:"var(--gold)",color:"#fff",border:"1px solid var(--gold-dark)",borderRadius:8,cursor:"pointer"},children:"🖨 Print / Save as PDF"})]}),(0,t.jsxs)("article",{className:"voucher-page",children:[(0,t.jsx)("header",{className:"voucher-letterhead-header",children:(0,t.jsx)("img",{src:"/logo-dark.png",alt:"MTCPL"})}),(0,t.jsx)("div",{className:"voucher-print-title-wrap",style:{textAlign:"center",margin:"20px 0 22px"},children:(0,t.jsx)("span",{className:"voucher-title-pill",children:"PAYMENT VOUCHER"})}),(0,t.jsxs)("dl",{className:"voucher-kv",children:[(0,t.jsx)(s,{k:"Voucher No",v:f,mono:!0}),(0,t.jsx)(s,{k:"Voucher Date",v:x.toLocaleDateString("en-IN",{timeZone:"Asia/Kolkata",day:"2-digit",month:"2-digit",year:"numeric"})}),(0,t.jsx)(s,{k:"Remitter Name",v:a}),(0,t.jsx)(s,{k:"Beneficiary Name",v:d.name.toUpperCase()}),d.bank_account&&(0,t.jsx)(s,{k:"Beneficiary A/c No",v:d.bank_account,mono:!0}),d.ifsc&&(0,t.jsx)(s,{k:"Beneficiary IFSC",v:d.ifsc,mono:!0}),d.gstin&&(0,t.jsx)(s,{k:"Beneficiary GSTIN",v:d.gstin,mono:!0}),d.pan&&(0,t.jsx)(s,{k:"Beneficiary PAN",v:d.pan,mono:!0}),(0,t.jsx)(s,{k:"Bill Token",v:n.token,mono:!0,highlight:!0}),(0,t.jsx)(s,{k:"Vendor's Bill No",v:n.vendorBillNo,mono:!0}),(0,t.jsx)(s,{k:"Bill Date",v:new Date(n.billDate).toLocaleDateString("en-IN",{timeZone:"Asia/Kolkata",day:"2-digit",month:"2-digit",year:"numeric"})}),n.costHead&&(0,t.jsx)(s,{k:"Cost Head",v:n.costHead}),(0,t.jsx)(s,{k:"Payment Mode",v:(e.paymentMethod??"—").toUpperCase(),mono:!0}),e.paymentReference&&(0,t.jsx)(s,{k:"cheque"===e.paymentMethod?"Cheque No":"upi"===e.paymentMethod?"UPI Txn Ref":"UTR / Reference",v:e.paymentReference,mono:!0,highlight:!0}),e.paymentNote&&(0,t.jsx)(s,{k:"Payment Note",v:e.paymentNote}),(0,t.jsx)(s,{k:"Amount",v:`₹${e.paidAmount.toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2})}`,mono:!0,highlight:!0}),(0,t.jsx)(s,{k:"Amount in Words",v:`${v} Only`}),n.amountTds>0&&(0,t.jsx)(s,{k:"TDS deducted (info only)",v:`₹${n.amountTds.toLocaleString("en-IN",{minimumFractionDigits:2})}`,mono:!0}),n.amountTcs>0&&(0,t.jsx)(s,{k:"TCS in total (info only)",v:`₹${n.amountTcs.toLocaleString("en-IN",{minimumFractionDigits:2})}`,mono:!0})]}),(0,t.jsxs)("p",{className:"voucher-salutation",style:{margin:"22px 0 0",fontSize:13,lineHeight:1.6,color:"#222"},children:["Dear Sir / Madam,",(0,t.jsx)("br",{}),"We are pleased to credit your account",d.bank_account?` (${d.bank_account})`:""," with us for",(0,t.jsxs)("strong",{children:[" ","₹",e.paidAmount.toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2})," "]}),"(",v," Only) against bill"," ",(0,t.jsx)("strong",{children:n.token})," ","(",n.vendorBillNo,") dated"," ",new Date(n.billDate).toLocaleDateString("en-IN",{timeZone:"Asia/Kolkata",day:"2-digit",month:"long",year:"numeric"}),"."]}),n.description&&(0,t.jsxs)("div",{className:"voucher-description",style:{marginTop:18,padding:"10px 14px",background:"#f9f7f1",border:"1px solid #ddd6c2",borderRadius:6,fontSize:12,color:"#333",lineHeight:1.6},children:[(0,t.jsx)("div",{style:{fontSize:10,fontWeight:800,color:"#666",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:4},children:"Bill description"}),n.description]}),(0,t.jsxs)("div",{className:"voucher-signatures",style:{marginTop:56,display:"grid",gridTemplateColumns:"1fr 1fr",gap:36},children:[(0,t.jsx)(l,{label:"Prepared by",name:e.paidByName??"Accountant"}),(0,t.jsx)(l,{label:"Authorised signatory",name:"For ",companySuffix:!0})]}),(0,t.jsxs)("footer",{className:"voucher-letterhead-footer",children:[(0,t.jsx)("div",{children:"Mateshwari Temples Construction Pvt. Ltd. · Nh-27, Opposite Ajari Gate, Pindwara, Dist-Sirohi, Rajasthan"}),(0,t.jsx)("div",{children:"☎ +91 9414152740 / +91 9414374979 · 🌐 Mtcpl.org · mateshwaritemples.com"}),(0,t.jsxs)("div",{className:"gen-note",children:["Computer-generated voucher · ",new Date().toLocaleString("en-IN",{timeZone:"Asia/Kolkata",day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"})]})]})]})]})}],574168)}]);

//# debugId=cfff77c2-5907-5fc6-0023-c4e8ff17301b