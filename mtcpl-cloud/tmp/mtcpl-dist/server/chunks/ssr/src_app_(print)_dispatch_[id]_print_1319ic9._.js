;!function(){try { var e="undefined"!=typeof globalThis?globalThis:"undefined"!=typeof global?global:"undefined"!=typeof window?window:"undefined"!=typeof self?self:{},n=(new e.Error).stack;n&&((e._debugIds|| (e._debugIds={}))[n]="b26ceeb2-0d00-6c85-cf35-2a15cb386462")}catch(e){}}();
module.exports=[294901,a=>{"use strict";a.s(["PrintBtn",()=>b]);let b=(0,a.i(211857).registerClientReference)(function(){throw Error("Attempted to call PrintBtn() from the server but PrintBtn is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.")},"[project]/src/app/(print)/dispatch/[id]/print/print-btn.tsx <module evaluation>","PrintBtn")},30852,a=>{"use strict";a.s(["PrintBtn",()=>b]);let b=(0,a.i(211857).registerClientReference)(function(){throw Error("Attempted to call PrintBtn() from the server but PrintBtn is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.")},"[project]/src/app/(print)/dispatch/[id]/print/print-btn.tsx","PrintBtn")},652262,a=>{"use strict";a.i(294901);var b=a.i(30852);a.n(b)},687385,a=>{"use strict";var b=a.i(907997);a.i(570396);var c=a.i(673727),d=a.i(109307),e=a.i(220539),f=a.i(807542),g=a.i(652262);async function h({params:a}){await (0,d.requireAuth)(["developer","owner","team_head","senior_incharge","cutting_operator"]);let{id:i}=await a,j=(0,e.createAdminSupabaseClient)(),{data:k,error:l}=await j.from("dispatches").select("id, challan_number, load_number, temple, vehicle_no, driver_name, driver_phone, expected_delivery_date, notes, dispatched_at, dispatched_by, delivered_at, delivered_by, receiver_name, delivery_note").eq("id",i).maybeSingle();(l||!k)&&(0,c.notFound)();let{data:m}=await j.from("dispatch_logs").select("slab_requirement_id, weight_tonnes").eq("dispatch_id",i),n=(m??[]).map(a=>a.slab_requirement_id).filter(Boolean),o=new Map;for(let a of m??[])a.slab_requirement_id&&null!=a.weight_tonnes&&Number(a.weight_tonnes)>0&&o.set(a.slab_requirement_id,Number(a.weight_tonnes));let p=[...o.values()].reduce((a,b)=>a+b,0),q=p>0,[{data:r},{data:s}]=await Promise.all([j.from("temples").select("site_location, site_incharge_name, site_incharge_phone, installer_name, installer_phone").eq("name",k.temple).maybeSingle(),j.from("app_settings").select("value").eq("key","dispatch_handling_man").maybeSingle()]),t=r??{},u=s?.value??null,v=k.load_number??null,w=[];if(n.length>0){let{data:a}=await j.from("slab_requirements").select("id, label, stone, length_ft, width_ft, thickness_ft").in("id",n);w=(a??[]).map(a=>({id:a.id,label:a.label,stone:a.stone,length_ft:Number(a.length_ft),width_ft:Number(a.width_ft),thickness_ft:Number(a.thickness_ft)}));let b=new Map(n.map((a,b)=>[a,b]));w.sort((a,c)=>(b.get(a.id)??0)-(b.get(c.id)??0))}let x=w.reduce((a,b)=>{var c;return a+(c=b.length_ft,c*b.width_ft*b.thickness_ft/1728)},0),y=await (0,f.getProfilesMap)(),z=k.dispatched_by?y[k.dispatched_by]??"—":"—",A=k.delivered_by?y[k.delivered_by]??"—":null,B=k.challan_number??null,C=null!=B?`CHLN-${String(B).padStart(4,"0")}`:`DISP-${String(k.id).slice(0,8).toUpperCase()}`,D=new Date(k.dispatched_at),E=k.expected_delivery_date?new Date(k.expected_delivery_date):null,F=new Date().toLocaleString("en-IN",{timeZone:"Asia/Kolkata",day:"numeric",month:"long",year:"numeric",hour:"2-digit",minute:"2-digit"});return(0,b.jsxs)(b.Fragment,{children:[(0,b.jsx)("style",{children:`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
          font-size: 13px;
          color: #1a1a1a;
          background: #f0f0f0;
        }
        .print-wrap {
          max-width: 900px;
          margin: 0 auto;
          background: #fff;
          padding: 28px 32px 36px;
        }
        .screen-bar {
          background: #1a1a1a;
          color: #fff;
          padding: 10px 32px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          max-width: 900px;
          margin: 0 auto;
        }
        .screen-bar-title { font-size: 13px; color: rgba(255,255,255,0.65); }
        .print-action-btn {
          background: #b87333;
          color: #fff;
          border: none;
          padding: 8px 22px;
          border-radius: 6px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          letter-spacing: 0.02em;
        }
        .print-action-btn:hover { background: #a06428; }

        /* ── MTCPL letterhead (matches the payment-voucher letterhead) ── */
        .letterhead {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 16px;
          border-bottom: 3px double #7c4a1e;
          padding-bottom: 12px;
        }
        .brand-logo {
          height: 52px;
          width: auto;
          display: block;
        }
        .company-block { text-align: right; }
        .company-name {
          font-size: 15px;
          font-weight: 800;
          color: #5b2e0a;
          letter-spacing: 0.03em;
        }
        .company-line {
          font-size: 10px;
          color: #666;
          margin-top: 2px;
          line-height: 1.5;
        }
        .title-row {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          gap: 16px;
          margin: 16px 0 18px;
        }
        .doc-title-pill {
          display: inline-block;
          font-size: 16px;
          font-weight: 800;
          color: #5b2e0a;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          border: 2px solid #7c4a1e;
          border-radius: 8px;
          padding: 7px 22px;
          background: #faf4ea;
        }
        .doc-sub { font-size: 12px; color: #666; margin-top: 6px; }
        .doc-ref { text-align: right; }
        .doc-ref-num {
          font-size: 22px; font-weight: 800; color: #1a1a1a;
          font-family: ui-monospace, monospace; letter-spacing: 0.02em;
        }
        .doc-ref-date { font-size: 11px; color: #888; margin-top: 4px; line-height: 1.5; }

        .section-title {
          font-size: 11px; font-weight: 700; color: #666;
          text-transform: uppercase; letter-spacing: 0.1em;
          margin: 18px 0 8px; padding-bottom: 5px;
          border-bottom: 1px solid #ddd;
        }

        .meta-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
          gap: 12px 24px;
        }
        .meta-label {
          font-size: 9px; font-weight: 700; color: #999;
          text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 3px;
        }
        .meta-val { font-size: 14px; font-weight: 600; color: #1a1a1a; }
        .meta-val.mono { font-family: ui-monospace, monospace; }

        table.slab-table {
          width: 100%; border-collapse: collapse; font-size: 12px;
          margin-top: 4px;
        }
        table.slab-table th {
          background: #f5f5f5; padding: 6px 10px; text-align: left;
          font-size: 10px; font-weight: 700; color: #555;
          text-transform: uppercase; letter-spacing: 0.05em;
          border-bottom: 2px solid #ccc;
        }
        table.slab-table td {
          padding: 6px 10px; border-bottom: 1px solid #eee;
          vertical-align: middle;
        }
        table.slab-table tr:last-child td { border-bottom: 2px solid #ccc; }
        table.slab-table tfoot td {
          padding: 8px 10px; font-weight: 700; font-size: 12px;
          background: #f8f8f3; border-top: 2px solid #ccc;
        }
        .slab-code { font-family: ui-monospace, monospace; font-weight: 700; }

        .delivered-banner {
          background: rgba(22,101,52,0.08);
          border: 1px solid rgba(22,101,52,0.3);
          color: #15803d;
          padding: 10px 14px;
          border-radius: 6px;
          margin-top: 14px;
          font-size: 12px;
          font-weight: 600;
        }

        .signoff-row {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 20px;
          margin-top: 46px;
        }
        .signoff-field {
          display: flex; flex-direction: column; gap: 38px;
          padding-top: 10px;
          border-top: 1.5px solid #888;
        }
        .signoff-label { font-size: 10px; color: #888; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; }
        .signoff-sub { font-size: 11px; color: #666; margin-top: 3px; }

        .doc-footer {
          margin-top: 28px; padding-top: 10px;
          border-top: 1px solid #e0e0e0;
          display: flex; justify-content: space-between;
          font-size: 9px; color: #aaa;
        }

        @media print {
          body { background: #fff; }
          .screen-bar { display: none !important; }
          .print-wrap { max-width: none; padding: 10mm 12mm; margin: 0; }
          table.slab-table, .signoff-row, .delivered-banner {
            page-break-inside: avoid;
          }
          @page { margin: 10mm; }
        }
        @media screen { body { padding: 0; } }
      `}),(0,b.jsxs)("div",{className:"screen-bar",children:[(0,b.jsxs)("span",{className:"screen-bar-title",children:["Dispatch Challan — ",C," · ",k.temple]}),(0,b.jsx)(g.PrintBtn,{})]}),(0,b.jsxs)("div",{className:"print-wrap",children:[(0,b.jsxs)("div",{className:"letterhead",children:[(0,b.jsx)("div",{children:(0,b.jsx)("img",{src:"/logo-dark.png",alt:"MTCPL",className:"brand-logo"})}),(0,b.jsxs)("div",{className:"company-block",children:[(0,b.jsx)("div",{className:"company-name",children:"MATESHWARI TEMPLE CONSTRUCTION PVT LTD"}),(0,b.jsx)("div",{className:"company-line",children:"NH-27, Opposite Ajari Gate, Pindwara, Dist. Sirohi, Rajasthan"}),(0,b.jsx)("div",{className:"company-line",children:"☎ +91 94141 52740 / +91 94143 74979 · 🌐 mtcpl.org · mateshwaritemples.com"})]})]}),(0,b.jsxs)("div",{className:"title-row",children:[(0,b.jsxs)("div",{children:[(0,b.jsx)("span",{className:"doc-title-pill",children:"Delivery Challan"}),(0,b.jsxs)("div",{className:"doc-sub",children:["Outgoing shipment to ",k.temple]})]}),(0,b.jsxs)("div",{className:"doc-ref",children:[(0,b.jsx)("div",{className:"doc-ref-num",children:C}),(0,b.jsxs)("div",{className:"doc-ref-date",children:[(0,b.jsxs)("div",{children:["Dispatched:"," ",D.toLocaleDateString("en-IN",{timeZone:"Asia/Kolkata",day:"numeric",month:"short",year:"numeric"})]}),(0,b.jsxs)("div",{children:[D.toLocaleTimeString("en-IN",{timeZone:"Asia/Kolkata",hour:"2-digit",minute:"2-digit"})," · by"," ",z]}),(0,b.jsxs)("div",{children:["Printed: ",F]})]})]})]}),(0,b.jsx)("div",{className:"section-title",children:"Bill To Party"}),(0,b.jsxs)("div",{style:{border:"1.5px solid #7c4a1e",borderRadius:8,padding:"10px 14px",display:"flex",justifyContent:"space-between",gap:14,flexWrap:"wrap",background:"#fdfaf4",marginBottom:4},children:[(0,b.jsxs)("div",{style:{minWidth:0},children:[(0,b.jsxs)("div",{style:{fontSize:17,fontWeight:800,color:"#1a1a1a"},children:["🏛 ",k.temple]}),t.site_location&&(0,b.jsxs)("div",{style:{fontSize:12.5,color:"#444",marginTop:3,fontWeight:600},children:["📍 ",t.site_location]}),(0,b.jsx)("div",{style:{fontSize:10.5,color:"#888",marginTop:4},children:"Site engineer / receiver to sign below upon receipt."})]}),null!=v&&(0,b.jsxs)("div",{style:{alignSelf:"center",textAlign:"center",border:"2px solid #1a1a1a",borderRadius:8,padding:"8px 18px",minWidth:120},children:[(0,b.jsx)("div",{style:{fontSize:9.5,fontWeight:800,color:"#666",letterSpacing:"0.1em"},children:"LOAD NO."}),(0,b.jsx)("div",{style:{fontSize:26,fontWeight:800,fontFamily:"ui-monospace, monospace",lineHeight:1.1},children:v}),(0,b.jsx)("div",{style:{fontSize:8.5,color:"#999",marginTop:1},children:"temple-wise"})]})]}),(t.site_incharge_name||t.installer_name||u?.name)&&(0,b.jsxs)(b.Fragment,{children:[(0,b.jsx)("div",{className:"section-title",children:"Site Contacts"}),(0,b.jsxs)("div",{className:"meta-grid",children:[t.site_incharge_name&&(0,b.jsxs)("div",{children:[(0,b.jsx)("div",{className:"meta-label",children:"Site Incharge (Client)"}),(0,b.jsx)("div",{className:"meta-val",children:t.site_incharge_name}),t.site_incharge_phone&&(0,b.jsx)("div",{style:{fontSize:11.5,color:"#555",fontFamily:"ui-monospace, monospace"},children:t.site_incharge_phone})]}),t.installer_name&&(0,b.jsxs)("div",{children:[(0,b.jsx)("div",{className:"meta-label",children:"Installation By"}),(0,b.jsx)("div",{className:"meta-val",children:t.installer_name}),t.installer_phone&&(0,b.jsx)("div",{style:{fontSize:11.5,color:"#555",fontFamily:"ui-monospace, monospace"},children:t.installer_phone})]}),u?.name&&(0,b.jsxs)("div",{children:[(0,b.jsx)("div",{className:"meta-label",children:"Dispatch Incharge (MTCPL)"}),(0,b.jsx)("div",{className:"meta-val",children:u.name}),u.phone&&(0,b.jsx)("div",{style:{fontSize:11.5,color:"#555",fontFamily:"ui-monospace, monospace"},children:u.phone})]})]})]}),(0,b.jsx)("div",{className:"section-title",children:"Transport"}),(0,b.jsxs)("div",{className:"meta-grid",children:[(0,b.jsxs)("div",{children:[(0,b.jsx)("div",{className:"meta-label",children:"Vehicle No."}),(0,b.jsx)("div",{className:"meta-val mono",children:k.vehicle_no??"—"})]}),(0,b.jsxs)("div",{children:[(0,b.jsx)("div",{className:"meta-label",children:"Driver"}),(0,b.jsx)("div",{className:"meta-val",children:k.driver_name??"—"})]}),(0,b.jsxs)("div",{children:[(0,b.jsx)("div",{className:"meta-label",children:"Driver Phone"}),(0,b.jsx)("div",{className:"meta-val",children:k.driver_phone??"—"})]}),q&&(0,b.jsxs)("div",{children:[(0,b.jsx)("div",{className:"meta-label",children:"Net Weight"}),(0,b.jsxs)("div",{className:"meta-val mono",children:[p.toFixed(3)," T"]})]}),E&&(0,b.jsxs)("div",{children:[(0,b.jsx)("div",{className:"meta-label",children:"Expected Delivery"}),(0,b.jsx)("div",{className:"meta-val",children:E.toLocaleDateString("en-IN",{timeZone:"Asia/Kolkata",day:"numeric",month:"short",year:"numeric"})})]})]}),(0,b.jsxs)("div",{className:"section-title",children:["Slabs in this dispatch (",w.length,")"]}),0===w.length?(0,b.jsx)("p",{style:{color:"#888",fontSize:12},children:"No slabs linked to this dispatch."}):(0,b.jsxs)("table",{className:"slab-table",children:[(0,b.jsx)("thead",{children:(0,b.jsxs)("tr",{children:[(0,b.jsx)("th",{style:{width:28},children:"#"}),(0,b.jsx)("th",{children:"Slab ID"}),(0,b.jsx)("th",{children:"Label"}),(0,b.jsx)("th",{children:"Stone"}),(0,b.jsx)("th",{children:"Dimensions (in)"}),(0,b.jsx)("th",{style:{textAlign:"right"},children:"CFT"}),q&&(0,b.jsx)("th",{style:{textAlign:"right"},children:"Weight (kg)"})]})}),(0,b.jsx)("tbody",{children:w.map((a,c)=>{var d;let e=(d=a.length_ft,d*a.width_ft*a.thickness_ft/1728),f=o.get(a.id);return(0,b.jsxs)("tr",{children:[(0,b.jsx)("td",{style:{color:"#999"},children:c+1}),(0,b.jsx)("td",{children:(0,b.jsx)("span",{className:"slab-code",children:a.id})}),(0,b.jsx)("td",{children:a.label??"—"}),(0,b.jsx)("td",{children:a.stone??"—"}),(0,b.jsxs)("td",{style:{fontFamily:"ui-monospace, monospace"},children:[a.length_ft," × ",a.width_ft," × ",a.thickness_ft]}),(0,b.jsx)("td",{style:{textAlign:"right",fontFamily:"ui-monospace, monospace"},children:e.toFixed(2)}),q&&(0,b.jsx)("td",{style:{textAlign:"right",fontFamily:"ui-monospace, monospace"},children:null!=f?Math.round(1e3*f).toLocaleString("en-IN"):"—"})]},a.id)})}),(0,b.jsx)("tfoot",{children:(0,b.jsxs)("tr",{children:[(0,b.jsx)("td",{colSpan:5,style:{textAlign:"right"},children:"Total"}),(0,b.jsx)("td",{style:{textAlign:"right",fontFamily:"ui-monospace, monospace"},children:x.toFixed(2)}),q&&(0,b.jsxs)("td",{style:{textAlign:"right",fontFamily:"ui-monospace, monospace"},children:[p.toFixed(3)," T"]})]})})]}),k.notes&&(0,b.jsxs)(b.Fragment,{children:[(0,b.jsx)("div",{className:"section-title",children:"Notes"}),(0,b.jsx)("p",{style:{fontSize:12,color:"#333",lineHeight:1.5},children:k.notes})]}),k.delivered_at&&(0,b.jsxs)("div",{className:"delivered-banner",children:["✓ Delivered on"," ",new Date(k.delivered_at).toLocaleDateString("en-IN",{timeZone:"Asia/Kolkata",day:"numeric",month:"long",year:"numeric"}),k.receiver_name?` \xb7 Received by ${k.receiver_name}`:"",A?` \xb7 Confirmed in system by ${A}`:"",k.delivery_note?` \xb7 "${k.delivery_note}"`:""]}),(0,b.jsxs)("div",{className:"signoff-row",children:[(0,b.jsx)("div",{className:"signoff-field",children:(0,b.jsxs)("div",{children:[(0,b.jsx)("div",{className:"signoff-label",children:"For MTCPL · Representative"}),(0,b.jsx)("div",{className:"signoff-sub",children:u?.name?u.name:"Authorised signatory"})]})}),(0,b.jsx)("div",{className:"signoff-field",children:(0,b.jsxs)("div",{children:[(0,b.jsx)("div",{className:"signoff-label",children:"Driver Signature"}),(0,b.jsx)("div",{className:"signoff-sub",children:k.driver_name??"Driver name"})]})}),(0,b.jsx)("div",{className:"signoff-field",children:(0,b.jsxs)("div",{children:[(0,b.jsx)("div",{className:"signoff-label",children:"Received · Site Engineer"}),(0,b.jsx)("div",{className:"signoff-sub",children:k.receiver_name||"Name & date of receipt"})]})})]}),(0,b.jsxs)("div",{className:"doc-footer",style:{flexDirection:"column",gap:2,textAlign:"center",alignItems:"center"},children:[(0,b.jsx)("span",{style:{fontWeight:700,color:"#7c4a1e"},children:"Mateshwari Temple Construction Pvt Ltd · NH-27, Opposite Ajari Gate, Pindwara, Dist. Sirohi, Rajasthan"}),(0,b.jsx)("span",{children:"☎ +91 94141 52740 / +91 94143 74979 · 🌐 mtcpl.org · mateshwaritemples.com"}),(0,b.jsxs)("span",{children:["Delivery Challan ",C," · ",w.length," slab",1!==w.length?"s":""," · ",x.toFixed(2)," CFT · Computer-generated document"]})]})]})]})}a.s(["default",0,h])},318411,a=>{a.n(a.i(687385))}];

//# debugId=b26ceeb2-0d00-6c85-cf35-2a15cb386462
//# sourceMappingURL=src_app_%28print%29_dispatch_%5Bid%5D_print_1319ic9._.js.map