;!function(){try { var e="undefined"!=typeof globalThis?globalThis:"undefined"!=typeof global?global:"undefined"!=typeof window?window:"undefined"!=typeof self?self:{},n=(new e.Error).stack;n&&((e._debugIds|| (e._debugIds={}))[n]="ea522663-f77d-259f-9c9a-a6d4271387b8")}catch(e){}}();
module.exports=[301669,a=>{"use strict";var b=a.i(907997);a.i(570396);var c=a.i(673727),d=a.i(109307),e=a.i(220539),f=a.i(807542),g=a.i(98673),h=a.i(311182),i=a.i(805204),j=a.i(567);let k=["#D85A30","#378ADD","#1D9E75","#7F77DD","#BA7517","#639922","#D4537E","#E24B4A","#5F5E5A","#0F6E56"];function l(a){let b=parseInt(String(a||"").replace(/\D/g,""),10);return!b||Number.isNaN(b)?k[0]:k[(b-1)%k.length]}async function m({params:a}){await (0,d.requireAuth)(["owner","team_head","senior_incharge","cutting_operator"]);let{id:k}=await a,n=(0,e.createAdminSupabaseClient)(),{data:o,error:p}=await n.from("cut_session_blocks").select("id, status, block_id, largest_remainder, layout, cut_session_id, operator_id, operators(id, name), cut_sessions(id, session_code, kerf_mm, created_at, planned_by), cut_session_slabs(id, slab_requirement_id, is_filler)").eq("id",k).single();(p||!o)&&(0,c.notFound)();let[q,{data:r}]=await Promise.all([(0,f.getProfilesMap)(),n.from("stone_types").select("id, name, color_top, color_front, color_side").order("sort_order").order("name")]),s=o.layout,t=s?.blk,u=s?.placed??[],v=new Set(o.cut_session_slabs.filter(a=>a.is_filler).map(a=>a.slab_requirement_id)),w=o.cut_sessions,x=o.operators??null,y=x?.name??null,z=w?.planned_by?q[w.planned_by]??"Unknown":null,A=new Date().toLocaleDateString("en-IN",{timeZone:"Asia/Kolkata",day:"numeric",month:"long",year:"numeric"}),B=(()=>{if(!t||0===u.length)return null;let a=Math.min(316/t.l,256/t.w,6),b=t.l*a+24,c=t.w*a+24;return{sc:a,PAD:12,svgW:b,svgH:c}})(),C=(()=>{if(!t||0===u.length)return[];let a=new Map;for(let b of u){let c=b.zTop??t.h,d=b.zBot??0,e=`${d.toFixed(2)}_${c.toFixed(2)}`;a.has(e)||a.set(e,{zBot:d,zTop:c,slabs:[]}),a.get(e).slabs.push(b)}return[...a.values()].sort((a,b)=>b.zTop-a.zTop)})(),D=t?(t.l*t.w*t.h/1728).toFixed(2):null;return(0,b.jsxs)(b.Fragment,{children:[(0,b.jsx)("style",{children:`
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

        /* Screen-only print button bar */
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

        /* Typography */
        .doc-eyebrow {
          font-size: 10px;
          font-weight: 700;
          color: #888;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          margin-bottom: 6px;
        }
        .doc-title {
          font-size: 22px;
          font-weight: 700;
          color: #1a1a1a;
          font-family: ui-monospace, monospace;
          margin-bottom: 3px;
        }
        .doc-sub { font-size: 13px; color: #555; }
        .doc-date { font-size: 11px; color: #888; text-align: right; line-height: 1.6; }

        /* Section headings */
        .section-head {
          font-size: 11px;
          font-weight: 700;
          color: #666;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          border-bottom: 2px solid #1a1a1a;
          padding-bottom: 4px;
          margin: 20px 0 10px;
        }

        /* Meta grid */
        .meta-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
          gap: 12px 20px;
        }
        .meta-label {
          font-size: 9px;
          font-weight: 700;
          color: #999;
          text-transform: uppercase;
          letter-spacing: 0.07em;
          margin-bottom: 2px;
        }
        .meta-val {
          font-size: 14px;
          font-weight: 600;
          color: #1a1a1a;
        }
        .meta-val.mono { font-family: ui-monospace, monospace; }

        /* 3D + 2D Views */
        .views-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 14px;
          align-items: start;
        }
        .view-card {
          border: 1px solid #ddd;
          border-radius: 6px;
          padding: 8px 8px 4px;
          background: #fafafa;
        }
        .view-lbl {
          font-size: 9px;
          font-weight: 700;
          color: #888;
          text-align: center;
          text-transform: uppercase;
          letter-spacing: 0.07em;
          margin-top: 4px;
        }

        /* Planned slabs table */
        table.slab-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 12px;
        }
        table.slab-table th {
          background: #f5f5f5;
          padding: 5px 8px;
          text-align: left;
          font-size: 10px;
          font-weight: 700;
          color: #666;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          border-bottom: 2px solid #ddd;
        }
        table.slab-table td {
          padding: 6px 8px;
          border-bottom: 1px solid #f0f0f0;
          vertical-align: middle;
        }
        table.slab-table tr:last-child td { border-bottom: none; }

        .color-dot {
          display: inline-block;
          width: 9px;
          height: 9px;
          border-radius: 2px;
          margin-right: 5px;
          vertical-align: middle;
          flex-shrink: 0;
        }
        .slab-code { font-family: ui-monospace, monospace; font-weight: 700; }

        /* Layer-by-layer guide grid */
        .layer-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
          gap: 10px;
          margin-bottom: 4px;
        }
        .layer-card {
          border: 1px solid #ddd;
          border-radius: 6px;
          padding: 6px 6px 4px;
          background: #fafafa;
          page-break-inside: avoid;
        }
        .layer-lbl {
          font-size: 8px;
          font-weight: 700;
          color: #555;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          text-align: center;
          margin-bottom: 3px;
        }
        .layer-depth {
          font-size: 8px;
          color: #888;
          text-align: center;
          margin-top: 3px;
          font-family: ui-monospace, monospace;
        }

        /* Primary slab views — each slab is a fully bounded section */
        .prim-slab-block {
          page-break-inside: avoid;
          border: 2px solid #1a1a1a;
          border-radius: 6px;
          margin: 16px 0;
          overflow: hidden;
        }
        .prim-slab-block + .prim-slab-block {
          page-break-before: always;
        }
        /* Dark header banner */
        .prim-slab-banner {
          background: #1a1a1a;
          color: #fff;
          padding: 10px 16px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
        }
        .prim-slab-banner-title {
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .prim-slab-banner-dims {
          font-size: 11px;
          opacity: 0.8;
          font-family: ui-monospace, monospace;
        }
        .prim-slab-body {
          padding: 14px 16px 16px;
        }
        /* Color legend grid */
        .prim-legend {
          background: #f8f8f3;
          border: 1px solid #ccc;
          border-radius: 4px;
          padding: 10px 12px;
          margin-bottom: 12px;
        }
        .prim-legend-title {
          font-size: 10px;
          font-weight: 700;
          color: #555;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          margin-bottom: 7px;
        }
        .prim-legend-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
          gap: 6px 14px;
        }
        .prim-legend-row {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 11px;
          font-family: ui-monospace, monospace;
        }
        .prim-legend-badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 18px;
          height: 18px;
          border-radius: 4px;
          color: #fff;
          font-size: 11px;
          font-weight: 800;
          font-family: ui-monospace, monospace;
          flex-shrink: 0;
        }
        .prim-view-card {
          border: 1px solid #ccc;
          border-radius: 4px;
          padding: 10px;
          background: #fafafa;
          margin-bottom: 12px;
        }
        .prim-view-head {
          font-size: 10px;
          font-weight: 700;
          color: #555;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          margin-bottom: 6px;
        }
        .prim-table-head {
          font-size: 10px;
          font-weight: 700;
          color: #555;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          margin-bottom: 6px;
        }

        /* ─── MANUAL ENTRY SECTION ─────────────────────────── */
        .manual-section {
          margin-top: 24px;
          border: 2px dashed #bbb;
          border-radius: 8px;
          padding: 16px 20px 20px;
          page-break-inside: avoid;
        }
        .manual-title {
          font-size: 12px;
          font-weight: 700;
          color: #444;
          text-transform: uppercase;
          letter-spacing: 0.07em;
          margin-bottom: 4px;
        }
        .manual-hint {
          font-size: 10px;
          color: #888;
          margin-bottom: 14px;
        }

        /* Slab checklist in manual section */
        .slab-checklist {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
          gap: 6px 16px;
          margin-bottom: 18px;
        }
        .slab-check-row {
          display: flex;
          align-items: center;
          gap: 7px;
          font-size: 12px;
        }
        .check-box {
          width: 14px;
          height: 14px;
          border: 1.5px solid #555;
          border-radius: 3px;
          flex-shrink: 0;
          display: inline-block;
        }

        /* Waste block form lines */
        .waste-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 12px;
          margin-bottom: 16px;
        }
        .waste-table th {
          background: #f5f5f5;
          padding: 5px 10px;
          text-align: left;
          font-size: 10px;
          font-weight: 700;
          color: #666;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          border-bottom: 2px solid #ddd;
        }
        .waste-table td {
          padding: 0;
          border-bottom: 1px solid #eee;
          height: 34px;
        }
        .write-line {
          display: block;
          width: 100%;
          height: 100%;
          border-bottom: 1.5px solid #ccc;
          margin: 0 8px;
          width: calc(100% - 16px);
        }

        /* Sign-off row */
        .signoff-row {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 20px;
          margin-top: 12px;
        }
        .signoff-field { display: flex; flex-direction: column; gap: 4px; }
        .signoff-label { font-size: 9px; color: #888; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; }
        .signoff-line { border-bottom: 1.5px solid #888; height: 28px; width: 100%; }

        /* Footer */
        .doc-footer {
          margin-top: 20px;
          padding-top: 10px;
          border-top: 1px solid #e0e0e0;
          display: flex;
          justify-content: space-between;
          font-size: 10px;
          color: #aaa;
        }

        @media print {
          body { background: #fff; }
          .screen-bar { display: none !important; }
          .print-wrap { max-width: none; padding: 10mm 12mm; margin: 0; }
          .section-head { margin-top: 14px; }
          @page { margin: 10mm; }
          /* "Compact" print — single-tap on the print button sets
             body.print-compact, which collapses ONLY the Primary Slab
             Cutting Guide (one full page per primary slab — the real
             page-eater). The Layer-by-Layer guide is kept (it's small
             and cutters want the cut-order overview), plus the tick
             sheet. Long-press leaves the class off and prints
             everything. */
          body.print-compact .skip-on-compact { display: none !important; }
        }

        @media screen {
          body { padding: 0; }
        }
      `}),(0,b.jsxs)("div",{className:"screen-bar",children:[(0,b.jsxs)("span",{className:"screen-bar-title",children:["Cutting Plan — ",o.block_id," · ",w?.session_code??""]}),(0,b.jsx)(h.PrintBtn,{})]}),(0,b.jsxs)("div",{className:"print-wrap",children:[(0,b.jsxs)("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:18},children:[(0,b.jsxs)("div",{children:[(0,b.jsx)("div",{className:"doc-eyebrow",children:"MTCPL · Cutting Plan"}),(0,b.jsx)("div",{className:"doc-title",children:o.block_id}),(0,b.jsxs)("div",{className:"doc-sub",children:["Session: ",(0,b.jsx)("strong",{children:w?.session_code??"—"}),z&&(0,b.jsxs)(b.Fragment,{children:["  ·  Plan by ",(0,b.jsx)("strong",{style:{color:"#b87333"},children:z})]}),y&&(0,b.jsxs)(b.Fragment,{children:["  ·  👷 Operator ",(0,b.jsx)("strong",{style:{color:"#15803d"},children:y})]})]})]}),(0,b.jsxs)("div",{className:"doc-date",children:[(0,b.jsxs)("div",{children:["Printed: ",A]}),w?.created_at&&(0,b.jsxs)("div",{children:["Plan date: ",new Date(w.created_at).toLocaleDateString("en-IN",{timeZone:"Asia/Kolkata",day:"numeric",month:"short",year:"numeric"})]})]})]}),(0,b.jsx)("div",{className:"section-head",children:"Block Information"}),(0,b.jsxs)("div",{className:"meta-grid",children:[(0,b.jsxs)("div",{children:[(0,b.jsx)("div",{className:"meta-label",children:"Block ID"}),(0,b.jsx)("div",{className:"meta-val mono",children:o.block_id})]}),(0,b.jsxs)("div",{children:[(0,b.jsx)("div",{className:"meta-label",children:"Stone"}),(0,b.jsx)("div",{className:"meta-val",children:t?.stone??"—"})]}),(0,b.jsxs)("div",{children:[(0,b.jsx)("div",{className:"meta-label",children:"Yard"}),(0,b.jsx)("div",{className:"meta-val",children:t?.yard!=null?(0,j.yardLabel)(t.yard):"—"})]}),(0,b.jsxs)("div",{children:[(0,b.jsx)("div",{className:"meta-label",children:"Dimensions (in)"}),(0,b.jsxs)("div",{className:"meta-val mono",children:[t?`${t.l} \xd7 ${t.w} \xd7 ${t.h}`:"—"," in"]})]}),D&&(0,b.jsxs)("div",{children:[(0,b.jsx)("div",{className:"meta-label",children:"Volume"}),(0,b.jsxs)("div",{className:"meta-val",children:[D," CFT"]})]}),(0,b.jsxs)("div",{children:[(0,b.jsx)("div",{className:"meta-label",children:"Kerf"}),(0,b.jsxs)("div",{className:"meta-val",children:[w?.kerf_mm??"—"," mm"]})]}),y&&(0,b.jsxs)("div",{children:[(0,b.jsx)("div",{className:"meta-label",children:"Cutter Operator"}),(0,b.jsxs)("div",{className:"meta-val",style:{color:"#15803d",fontWeight:700},children:["👷 ",y]})]}),t?.quality&&(0,b.jsxs)("div",{children:[(0,b.jsx)("div",{className:"meta-label",children:"Quality"}),(0,b.jsxs)("div",{className:"meta-val",children:["Grade ",t.quality]})]}),s?.biggest&&(0,b.jsxs)("div",{children:[(0,b.jsx)("div",{className:"meta-label",children:"Expected Remainder (in)"}),(0,b.jsxs)("div",{className:"meta-val mono",children:[s.biggest.l," × ",s.biggest.w," × ",s.biggest.h," in"]})]})]}),(()=>{let a=(0,i.computeCutEfficiency)(t,u,s?.biggest??null);if(!a)return null;let c=a.slabPct,d=a.restockPct,e=Math.max(0,100-c-d);return(0,b.jsxs)(b.Fragment,{children:[(0,b.jsx)("div",{className:"section-head",children:"Block Utilisation"}),(0,b.jsxs)("div",{style:{marginBottom:14},children:[(0,b.jsxs)("div",{style:{display:"flex",height:14,borderRadius:3,overflow:"hidden",border:"1px solid #999"},children:[(0,b.jsx)("div",{style:{width:`${c}%`,background:"#15803d"}}),(0,b.jsx)("div",{style:{width:`${d}%`,background:"#b45309"}}),(0,b.jsx)("div",{style:{width:`${e}%`,background:"#b91c1c"}})]}),(0,b.jsxs)("div",{style:{display:"flex",flexWrap:"wrap",gap:14,marginTop:8,fontSize:11,fontFamily:"ui-monospace, monospace"},children:[(0,b.jsxs)("span",{style:{display:"inline-flex",alignItems:"center",gap:6},children:[(0,b.jsx)("span",{style:{width:11,height:11,background:"#15803d",borderRadius:2}}),(0,b.jsxs)("strong",{children:[c,"%"]}),(0,b.jsxs)("span",{style:{color:"#555"},children:["slabs · ",(0,i.toCFT)(a.slabVol).toFixed(2)," CFT"]})]}),d>0&&(0,b.jsxs)("span",{style:{display:"inline-flex",alignItems:"center",gap:6},children:[(0,b.jsx)("span",{style:{width:11,height:11,background:"#b45309",borderRadius:2}}),(0,b.jsxs)("strong",{children:[d,"%"]}),(0,b.jsxs)("span",{style:{color:"#555"},children:["restockable · ",(0,i.toCFT)(a.restockVol).toFixed(2)," CFT"]})]}),(0,b.jsxs)("span",{style:{display:"inline-flex",alignItems:"center",gap:6},children:[(0,b.jsx)("span",{style:{width:11,height:11,background:"#b91c1c",borderRadius:2}}),(0,b.jsxs)("strong",{children:[e,"%"]}),(0,b.jsxs)("span",{style:{color:"#555"},children:["waste · ",(0,i.toCFT)(a.wasteVol).toFixed(2)," CFT"]})]}),(0,b.jsxs)("span",{style:{color:"#888",fontFamily:"-apple-system,Arial,sans-serif"},children:["Total block: ",(0,i.toCFT)(a.blockVol).toFixed(2)," CFT"]})]}),s?.biggest&&(0,b.jsx)("p",{style:{margin:"6px 0 0",fontSize:10,color:"#888",fontStyle:"italic"},children:"Restockable piece (largest remainder) is counted as recovered — not waste."})]})]})})(),t&&u.length>0&&(0,b.jsxs)(b.Fragment,{children:[(0,b.jsxs)("div",{className:"section-head",children:["Block Layout — ",u.length," slab",1!==u.length?"s":""," planned"]}),(0,b.jsxs)("div",{className:"views-row",children:[(0,b.jsxs)("div",{className:"view-card",children:[(0,b.jsx)(g.IsoBlockStaticSVG,{block:{l:t.l,w:t.w,h:t.h,stone:t.stone},placed:u,az:.25*Math.PI,size:300,stoneTypes:r??void 0}),(0,b.jsx)("div",{className:"view-lbl",children:"Isometric View"})]}),B&&(0,b.jsxs)("div",{className:"view-card",children:[(0,b.jsxs)("svg",{viewBox:`0 0 ${B.svgW.toFixed(1)} ${B.svgH.toFixed(1)}`,style:{width:"100%",display:"block"},xmlns:"http://www.w3.org/2000/svg",children:[(0,b.jsx)("rect",{x:B.PAD,y:B.PAD,width:t.l*B.sc,height:t.w*B.sc,fill:"none",stroke:"#888",strokeWidth:"1.5",strokeDasharray:"4 2"}),(0,b.jsxs)("text",{x:B.PAD+t.l*B.sc/2,y:B.PAD-4,textAnchor:"middle",fill:"#666",fontSize:8,fontFamily:"ui-monospace,monospace",children:[t.l,'" L']}),(0,b.jsxs)("text",{x:B.PAD-4,y:B.PAD+t.w*B.sc/2,textAnchor:"middle",dominantBaseline:"middle",fill:"#666",fontSize:8,transform:`rotate(-90,${B.PAD-4},${B.PAD+t.w*B.sc/2})`,fontFamily:"ui-monospace,monospace",children:[t.w,'" W']}),u.map(a=>{let c=v.has(a.id),d=c?"#7c3aed":l(a.id),e=B.PAD+a.px*B.sc,f=B.PAD+a.py*B.sc,g=a.pw*B.sc,h=a.ph*B.sc,i=e+g/2,j=f+h/2,k=Math.min(g,h)>18;return(0,b.jsxs)("g",{children:[(0,b.jsx)("rect",{x:e,y:f,width:g,height:h,fill:d,fillOpacity:c?.42:.28,stroke:d,strokeWidth:"1.2"}),k&&(0,b.jsxs)("text",{x:i,y:j,textAnchor:"middle",dominantBaseline:"middle",fill:"#1a1a1a",fontSize:8,fontWeight:700,fontFamily:"ui-monospace,monospace",children:[a.id,c?"*":""]})]},a.id)})]}),(0,b.jsx)("div",{className:"view-lbl",children:"Top-Down Layout Plan (L × W)"})]})]})]}),t&&C.length>1&&(0,b.jsxs)(b.Fragment,{children:[(0,b.jsxs)("div",{className:"section-head",children:["Layer-by-Layer Cutting Guide (",C.length," layers — cut top to bottom)"]}),(0,b.jsx)("div",{style:{display:"grid",gridTemplateColumns:C.length<=2?"1fr 1fr":C.length<=3?"1fr 1fr 1fr":"repeat(auto-fill, minmax(180px, 1fr))",gap:12,marginBottom:4},children:C.map((a,c)=>{let d=C.length<=2?320:C.length<=3?240:170,e=Math.min((d-16)/t.l,(d-16)/t.w,5),f=t.l*e+16,g=t.w*e+16;return(0,b.jsxs)("div",{className:"layer-card",children:[(0,b.jsxs)("div",{className:"layer-lbl",children:["Layer ",c+1]}),(0,b.jsxs)("svg",{viewBox:`0 0 ${f.toFixed(1)} ${g.toFixed(1)}`,style:{width:"100%",display:"block"},xmlns:"http://www.w3.org/2000/svg",children:[(0,b.jsx)("rect",{x:8,y:8,width:t.l*e,height:t.w*e,fill:"#f0f0f0",stroke:"#aaa",strokeWidth:"0.8",strokeDasharray:"3 2"}),u.map(c=>{let d=a.slabs.some(a=>a.id===c.id),f=v.has(c.id),g=f?"#7c3aed":l(c.id),h=8+c.px*e,i=8+c.py*e,j=c.pw*e,k=c.ph*e;return(0,b.jsxs)("g",{children:[(0,b.jsx)("rect",{x:h,y:i,width:j,height:k,fill:d?g:"#e0e0e0",fillOpacity:d?.55:.25,stroke:d?g:"#bbb",strokeWidth:d?"1.2":"0.4"}),d&&Math.min(j,k)>12&&(0,b.jsxs)("text",{x:h+j/2,y:i+k/2,textAnchor:"middle",dominantBaseline:"middle",fill:"#1a1a1a",fontSize:7,fontWeight:700,fontFamily:"ui-monospace,monospace",children:[c.id,f?"*":""]})]},c.id)})]}),(0,b.jsxs)("div",{className:"layer-depth",children:["depth ",a.zBot.toFixed(1),"″ – ",a.zTop.toFixed(1),"″"]})]},c)})})]}),t&&u.length>0&&(()=>{let a=new Map;for(let b of u){let c=b.zTop??t.h,d=b.zBot??0,e=`${d.toFixed(2)}_${c.toFixed(2)}`;a.has(e)||a.set(e,{zBot:d,zTop:c,slabs:[]}),a.get(e).slabs.push(b)}let c=[...a.values()].sort((a,b)=>b.zTop-a.zTop),d=Math.min(700/Math.max(t.l,1),480/Math.max(t.w,1),14),e=32+t.l*d+14,f=22+t.w*d+12;return(0,b.jsxs)("div",{className:"skip-on-compact",children:[(0,b.jsxs)("div",{className:"section-head",children:["Primary Slab Cutting Guide — ",c.length," ",1===c.length?"slab":"slabs"]}),c.map((a,h)=>{let i=a.zTop-a.zBot,j=i.toFixed(1),k=a.slabs.map(a=>({...a,zBot:0,zTop:i})),m=new Map;return a.slabs.forEach((a,b)=>m.set(a.id,b+1)),(0,b.jsxs)("div",{className:"prim-slab-block",children:[(0,b.jsxs)("div",{className:"prim-slab-banner",children:[(0,b.jsxs)("div",{children:[(0,b.jsxs)("span",{className:"prim-slab-banner-title",children:["Primary Slab ",h+1,c.length>1?` of ${c.length}`:""]}),(0,b.jsxs)("span",{className:"prim-slab-banner-dims",style:{marginLeft:14},children:[t.l,"″ L × ",t.w,"″ W × ",j,"″ thick"]})]}),c.length>1&&(0,b.jsxs)("span",{className:"prim-slab-banner-dims",children:["depth ",a.zBot.toFixed(1),"″ – ",a.zTop.toFixed(1),"″"]})]}),(0,b.jsxs)("div",{className:"prim-slab-body",children:[(0,b.jsxs)("div",{className:"prim-legend",children:[(0,b.jsxs)("div",{className:"prim-legend-title",children:["Cut list — ",a.slabs.length," ",1===a.slabs.length?"piece":"pieces"," from this slab"]}),(0,b.jsx)("div",{className:"prim-legend-grid",children:a.slabs.map((a,c)=>{let d=l(a.id);return(0,b.jsxs)("div",{className:"prim-legend-row",children:[(0,b.jsx)("span",{className:"prim-legend-badge",style:{background:d},children:c+1}),(0,b.jsx)("span",{style:{fontWeight:700},children:a.id}),(0,b.jsxs)("span",{style:{color:"#666"},children:[a.sw,"×",a.sh,null!=a.sd?`\xd7${a.sd}`:"","″"]}),a.temple&&(0,b.jsxs)("span",{style:{color:"#888",fontFamily:"-apple-system,Arial,sans-serif"},children:["· ",a.temple]})]},a.id)})})]}),(0,b.jsxs)("div",{className:"prim-view-card",children:[(0,b.jsx)("div",{className:"prim-view-head",children:"3D Isometric View"}),(0,b.jsx)(g.IsoBlockStaticSVG,{block:{l:t.l,w:t.w,h:i,stone:t.stone},placed:k,size:560,stoneTypes:r??void 0})]}),(0,b.jsxs)("div",{className:"prim-view-card",children:[(0,b.jsx)("div",{className:"prim-view-head",children:"Top-down Cutting Layout"}),(0,b.jsxs)("svg",{viewBox:`0 0 ${e.toFixed(1)} ${f.toFixed(1)}`,style:{width:"100%",display:"block"},xmlns:"http://www.w3.org/2000/svg",children:[(0,b.jsx)("rect",{x:32,y:22,width:t.l*d,height:t.w*d,fill:"#f5f5f0",stroke:"#999",strokeWidth:"1.2",strokeDasharray:"5 3"}),(0,b.jsx)("line",{x1:32,y1:14,x2:32+t.l*d,y2:14,stroke:"#bbb",strokeWidth:"0.8"}),(0,b.jsx)("line",{x1:32,y1:10,x2:32,y2:18,stroke:"#bbb",strokeWidth:"0.8"}),(0,b.jsx)("line",{x1:32+t.l*d,y1:10,x2:32+t.l*d,y2:18,stroke:"#bbb",strokeWidth:"0.8"}),(0,b.jsxs)("text",{x:32+t.l*d/2,y:12,textAnchor:"middle",fill:"#777",fontSize:9,fontFamily:"ui-monospace,monospace",children:[t.l,'" L']}),(0,b.jsx)("line",{x1:24,y1:22,x2:24,y2:22+t.w*d,stroke:"#bbb",strokeWidth:"0.8"}),(0,b.jsx)("line",{x1:20,y1:22,x2:28,y2:22,stroke:"#bbb",strokeWidth:"0.8"}),(0,b.jsx)("line",{x1:20,y1:22+t.w*d,x2:28,y2:22+t.w*d,stroke:"#bbb",strokeWidth:"0.8"}),(0,b.jsxs)("text",{x:17,y:22+t.w*d/2,textAnchor:"middle",dominantBaseline:"middle",fill:"#777",fontSize:9,fontFamily:"ui-monospace,monospace",transform:`rotate(-90,17,${22+t.w*d/2})`,children:[t.w,'" W']}),u.map(a=>{let c,e,f,g=m.get(a.id),h=null!=g,i=l(a.id),j=32+a.px*d,k=22+a.py*d,n=a.pw*d,o=a.ph*d,p=j+n/2,q=k+o/2,r=Math.min(n,o);return(0,b.jsxs)("g",{children:[(0,b.jsx)("rect",{x:j,y:k,width:n,height:o,fill:i,fillOpacity:h?.38:.06,stroke:i,strokeWidth:h?"1.6":"0.5",strokeOpacity:h?1:.2}),h&&r>9&&(c=Math.min(10,Math.max(5,.22*r)),f=(e=r>36)?q-c-2:q,(0,b.jsxs)(b.Fragment,{children:[(0,b.jsx)("circle",{cx:p,cy:f,r:c,fill:"#1a1a1a",stroke:"#fff",strokeWidth:"1.2"}),(0,b.jsx)("text",{x:p,y:f,textAnchor:"middle",dominantBaseline:"middle",fill:"#fff",fontSize:1.2*c,fontWeight:800,fontFamily:"ui-monospace,monospace",children:g}),e&&(0,b.jsxs)(b.Fragment,{children:[(0,b.jsx)("text",{x:p,y:q+c-1,textAnchor:"middle",dominantBaseline:"middle",stroke:"#fff",strokeWidth:"3",paintOrder:"stroke",fill:"#1a1a1a",fontSize:r>60?9:7.5,fontWeight:700,fontFamily:"ui-monospace,monospace",children:a.id}),r>52&&(0,b.jsxs)("text",{x:p,y:q+c+10,textAnchor:"middle",dominantBaseline:"middle",stroke:"#fff",strokeWidth:"2.5",paintOrder:"stroke",fill:"#555",fontSize:7,fontFamily:"ui-monospace,monospace",children:[a.sw,"×",a.sh,"″"]})]})]}))]},a.id)})]}),(0,b.jsx)("div",{style:{fontSize:9,color:"#aaa",textAlign:"center",marginTop:4,fontFamily:"ui-monospace, monospace"},children:"Numbered badges match the cut-list above · dimmed pieces = other primary slabs"})]})]})]},h)})]})})(),(0,b.jsxs)("div",{className:"section-head",children:["Slabs to Cut (",u.length,")"]}),u.length>0&&(0,b.jsx)("div",{style:{fontSize:14,fontWeight:700,color:"#1a1a1a",margin:"-4px 0 8px",padding:"6px 10px",background:"#fffbeb",border:"1.5px dashed #d97706",borderRadius:4,lineHeight:1.3},children:"✓ हर slab कटने के बाद tick करें · Tick each slab as you finish cutting it"}),0===u.length?(0,b.jsx)("p",{style:{color:"#888",fontSize:12},children:"No slabs planned."}):(0,b.jsxs)("table",{className:"slab-table",children:[(0,b.jsx)("thead",{children:(0,b.jsxs)("tr",{children:[(0,b.jsx)("th",{style:{width:28},children:"✓"}),(0,b.jsx)("th",{style:{width:24},children:"#"}),(0,b.jsx)("th",{children:"Slab ID"}),(0,b.jsx)("th",{children:"Temple"}),(0,b.jsx)("th",{children:"Label"}),(0,b.jsx)("th",{children:"W × H (in)"}),(0,b.jsx)("th",{children:"Thickness (in)"}),(0,b.jsx)("th",{children:"Position X, Y (in)"}),(0,b.jsx)("th",{children:"Rotated"}),(0,b.jsx)("th",{children:"Layer Depth (in)"})]})}),(0,b.jsx)("tbody",{children:u.map((a,c)=>{let d=v.has(a.id),e=d?"#7c3aed":l(a.id);return(0,b.jsxs)("tr",{style:d?{background:"#f5f0ff"}:void 0,children:[(0,b.jsx)("td",{style:{textAlign:"center",verticalAlign:"middle"},children:(0,b.jsx)("span",{className:"check-box",style:{width:16,height:16,verticalAlign:"middle"}})}),(0,b.jsx)("td",{style:{color:"#999"},children:c+1}),(0,b.jsxs)("td",{children:[(0,b.jsx)("span",{className:"color-dot",style:{background:e}}),(0,b.jsx)("span",{className:"slab-code",children:a.id}),d&&(0,b.jsx)("span",{style:{marginLeft:6,fontSize:9,fontWeight:700,padding:"1px 5px",borderRadius:3,background:"#7c3aed",color:"#fff",letterSpacing:"0.04em"},children:"EXTRA"})]}),(0,b.jsx)("td",{children:a.temple??"—"}),(0,b.jsx)("td",{style:{color:"#555"},children:a.label??"—"}),(0,b.jsxs)("td",{style:{fontFamily:"ui-monospace, monospace"},children:[a.sw," × ",a.sh]}),(0,b.jsx)("td",{style:{fontFamily:"ui-monospace, monospace"},children:a.sd??"—"}),(0,b.jsx)("td",{style:{fontFamily:"ui-monospace, monospace"},children:null!=a.px?`${Number(a.px).toFixed(1)}, ${Number(a.py).toFixed(1)}`:"—"}),(0,b.jsx)("td",{style:{textAlign:"center"},children:a.rot?"↻":"—"}),(0,b.jsx)("td",{style:{fontFamily:"ui-monospace, monospace",color:"#888"},children:null!=a.zBot&&null!=a.zTop?`${Number(a.zBot).toFixed(1)} – ${Number(a.zTop).toFixed(1)}`:"—"})]},a.id)})})]}),(0,b.jsxs)("div",{className:"manual-section",children:[(0,b.jsx)("div",{className:"manual-title",children:"✍ After Cutting — Fill in Manually & Return to Office"}),(0,b.jsx)("div",{className:"manual-hint",children:"Cutter fills this section. Office staff enters into system after receiving."}),u.some(a=>v.has(a.id))&&(0,b.jsxs)("div",{style:{fontSize:10,color:"#666",marginBottom:12,fontStyle:"italic"},children:[(0,b.jsx)("span",{style:{display:"inline-block",width:8,height:8,borderRadius:2,background:"#7c3aed",marginRight:4,verticalAlign:"middle"}}),(0,b.jsx)("strong",{children:"EXTRA"})," = filler / cut-ahead inventory (not for current order). Marked with * in 2D layouts."]}),(0,b.jsxs)("div",{style:{marginTop:16,marginBottom:6},children:[(0,b.jsx)("div",{style:{fontSize:18,fontWeight:800,color:"#1a1a1a",lineHeight:1.2},children:"✏️ Extra kata hua size"}),(0,b.jsx)("div",{style:{fontSize:12,color:"#444",marginTop:3,fontWeight:500},children:"जो slabs plan में नहीं थीं पर inventory से काट दी गयीं — उनकी detail यहाँ भरें"})]}),(0,b.jsxs)("table",{className:"waste-table",children:[(0,b.jsx)("thead",{children:(0,b.jsxs)("tr",{children:[(0,b.jsx)("th",{style:{width:28},children:"#"}),(0,b.jsx)("th",{children:"Slab ID / Size"}),(0,b.jsx)("th",{children:"Length (in)"}),(0,b.jsx)("th",{children:"Width (in)"}),(0,b.jsx)("th",{children:"Thickness (in)"}),(0,b.jsx)("th",{children:"Notes"})]})}),(0,b.jsx)("tbody",{children:[1,2,3,4].map(a=>(0,b.jsxs)("tr",{children:[(0,b.jsx)("td",{style:{padding:"0 8px",color:"#999",textAlign:"center",verticalAlign:"middle"},children:a}),(0,b.jsx)("td",{children:(0,b.jsx)("span",{className:"write-line"})}),(0,b.jsx)("td",{children:(0,b.jsx)("span",{className:"write-line"})}),(0,b.jsx)("td",{children:(0,b.jsx)("span",{className:"write-line"})}),(0,b.jsx)("td",{children:(0,b.jsx)("span",{className:"write-line"})}),(0,b.jsx)("td",{children:(0,b.jsx)("span",{className:"write-line"})})]},`extra-${a}`))})]}),(0,b.jsxs)("div",{style:{marginTop:16,marginBottom:6},children:[(0,b.jsx)("div",{style:{fontSize:18,fontWeight:800,color:"#1a1a1a",lineHeight:1.2},children:"♻️ बचा हुआ block / निकले हुए block"}),(0,b.jsx)("div",{style:{fontSize:12,color:"#444",marginTop:3,fontWeight:500},children:"अगर block का कोई हिस्सा बच गया हो तो नीचे लिखें — कुछ नहीं बचा तो खाली छोड़ दें"})]}),(0,b.jsxs)("table",{className:"waste-table",children:[(0,b.jsx)("thead",{children:(0,b.jsxs)("tr",{children:[(0,b.jsx)("th",{style:{width:28},children:"#"}),(0,b.jsx)("th",{children:"Length (in)"}),(0,b.jsx)("th",{children:"Width (in)"}),(0,b.jsx)("th",{children:"Height (in)"}),(0,b.jsx)("th",{children:"Notes"})]})}),(0,b.jsx)("tbody",{children:[1,2,3,4].map(a=>(0,b.jsxs)("tr",{children:[(0,b.jsx)("td",{style:{padding:"0 8px",color:"#999",textAlign:"center",verticalAlign:"middle"},children:a}),(0,b.jsx)("td",{children:(0,b.jsx)("span",{className:"write-line"})}),(0,b.jsx)("td",{children:(0,b.jsx)("span",{className:"write-line"})}),(0,b.jsx)("td",{children:(0,b.jsx)("span",{className:"write-line"})}),(0,b.jsx)("td",{children:(0,b.jsx)("span",{className:"write-line"})})]},a))})]}),(0,b.jsxs)("div",{style:{marginTop:18,padding:"10px 12px",border:"2px solid #b87333",borderRadius:6,background:"#fffaf0"},children:[(0,b.jsx)("div",{style:{fontSize:14,fontWeight:800,color:"#1a1a1a",lineHeight:1.2},children:"📍 Stock location · slabs कहाँ रखीं?"}),(0,b.jsx)("div",{style:{fontSize:11,color:"#444",marginTop:2,fontWeight:500},children:"जहाँ saw से उठाकर slabs रखी गयीं — yard / area / pickup point का नाम लिखें"}),(0,b.jsx)("div",{style:{borderBottom:"2px solid #1a1a1a",height:30,marginTop:8}})]}),(0,b.jsxs)("div",{className:"signoff-row",children:[(0,b.jsxs)("div",{className:"signoff-field",children:[(0,b.jsx)("div",{className:"signoff-label",children:"Cutting Operator"}),y?(0,b.jsx)("div",{className:"signoff-line",style:{display:"flex",alignItems:"flex-end",paddingBottom:2,fontWeight:700,color:"#15803d",fontSize:14},children:y}):(0,b.jsx)("div",{className:"signoff-line"})]}),(0,b.jsxs)("div",{className:"signoff-field",children:[(0,b.jsx)("div",{className:"signoff-label",children:"Date Completed"}),(0,b.jsx)("div",{className:"signoff-line"})]}),(0,b.jsxs)("div",{className:"signoff-field",children:[(0,b.jsx)("div",{className:"signoff-label",children:"Checked By (Office)"}),(0,b.jsx)("div",{className:"signoff-line"})]})]})]}),u.length>0&&(0,b.jsxs)("div",{style:{pageBreakBefore:"always",paddingTop:12},children:[(0,b.jsx)("div",{className:"section-head",children:"⏳ Pre-Cut Log · रोज़ की कटाई"}),(0,b.jsxs)("div",{style:{fontSize:11,color:"#555",margin:"4px 0 10px",lineHeight:1.5},children:["जो slab आज कटे, उसका ",(0,b.jsx)("strong",{children:"code, size, तारीख़ खुद लिखें और sign करें"})," — sheet office को दें। Office उन्हें system में ",(0,b.jsx)("strong",{children:"Pre-Cut"})," करेगा (carving तुरंत शुरू हो सकती है) और sheet वापस देगा। पूरा block कटने के बाद ही final Cutting Done होगा।"]}),(0,b.jsxs)("table",{style:{width:"100%",borderCollapse:"collapse",fontSize:11.5},children:[(0,b.jsx)("thead",{children:(0,b.jsx)("tr",{children:["#","Slab Code","Size (in)","कटने की तारीख़","Operator Sign","Office Entry ✓"].map((a,c)=>(0,b.jsx)("th",{style:{border:"1px solid #1a1a1a",padding:"6px 8px",textAlign:c<=2?"left":"center",background:"#f0ece4",fontWeight:800,fontSize:10.5,textTransform:"uppercase",letterSpacing:"0.03em"},children:a},a))})}),(0,b.jsx)("tbody",{children:Array.from({length:Math.max(u.length+4,14)}).map((a,c)=>(0,b.jsxs)("tr",{children:[(0,b.jsx)("td",{style:{border:"1px solid #444",padding:"12px 8px",width:28,color:"#666",fontFamily:"ui-monospace, monospace"},children:c+1}),(0,b.jsx)("td",{style:{border:"1px solid #444",padding:"12px 8px"}}),(0,b.jsx)("td",{style:{border:"1px solid #444",padding:"12px 8px"}}),(0,b.jsx)("td",{style:{border:"1px solid #444",padding:"12px 8px",width:110}}),(0,b.jsx)("td",{style:{border:"1px solid #444",padding:"12px 8px",width:110}}),(0,b.jsx)("td",{style:{border:"1px solid #444",padding:"12px 8px",width:90}})]},`pc-${c}`))})]}),(0,b.jsx)("div",{style:{fontSize:10,color:"#777",marginTop:6},children:"हर slab का code खुद लिखें — जो भी आज कटे (plan के अंदर या बाहर / दूसरे block से आया size भी यहीं लिखें)."})]}),(0,b.jsxs)("div",{className:"doc-footer",children:[(0,b.jsxs)("span",{children:["MTCPL · Cutting Plan · ",o.block_id]}),(0,b.jsxs)("span",{children:[w?.session_code??"",z?` \xb7 Plan by ${z}`:""]})]})]})]})}a.s(["default",0,m])},124211,a=>{a.n(a.i(301669))}];

//# debugId=ea522663-f77d-259f-9c9a-a6d4271387b8
//# sourceMappingURL=src_app_%28print%29_cutting_%5Bid%5D_print_page_tsx_0jbh5-1._.js.map