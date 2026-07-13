;!function(){try { var e="undefined"!=typeof globalThis?globalThis:"undefined"!=typeof global?global:"undefined"!=typeof window?window:"undefined"!=typeof self?self:{},n=(new e.Error).stack;n&&((e._debugIds|| (e._debugIds={}))[n]="6ada8246-32e4-9405-2960-991d7c2681f1")}catch(e){}}();
module.exports=[950640,(a,b,c)=>{"use strict";Object.defineProperty(c,"__esModule",{value:!0}),Object.defineProperty(c,"InvariantError",{enumerable:!0,get:function(){return d}});class d extends Error{constructor(a,b){super(`Invariant: ${a.endsWith(".")?a:a+"."} This is a bug in Next.js.`,b),this.name="InvariantError"}}},164240,(a,b,c)=>{"use strict";function d(a){if("function"!=typeof WeakMap)return null;var b=new WeakMap,c=new WeakMap;return(d=function(a){return a?c:b})(a)}c._=function(a,b){if(!b&&a&&a.__esModule)return a;if(null===a||"object"!=typeof a&&"function"!=typeof a)return{default:a};var c=d(b);if(c&&c.has(a))return c.get(a);var e={__proto__:null},f=Object.defineProperty&&Object.getOwnPropertyDescriptor;for(var g in a)if("default"!==g&&Object.prototype.hasOwnProperty.call(a,g)){var h=f?Object.getOwnPropertyDescriptor(a,g):null;h&&(h.get||h.set)?Object.defineProperty(e,g,h):e[g]=a[g]}return e.default=a,c&&c.set(a,e),e}},193695,(a,b,c)=>{b.exports=a.x("next/dist/shared/lib/no-fallback-error.external.js",()=>require("next/dist/shared/lib/no-fallback-error.external.js"))},971306,(a,b,c)=>{b.exports=a.r(918622)},179847,a=>{a.n(a.i(403343))},9185,a=>{a.n(a.i(729432))},872842,a=>{a.n(a.i(275164))},454897,a=>{a.n(a.i(330106))},856157,a=>{a.n(a.i(118970))},594331,a=>{a.n(a.i(860644))},715988,a=>{a.n(a.i(856952))},625766,a=>{a.n(a.i(777341))},529725,a=>{a.n(a.i(994290))},605785,a=>{a.n(a.i(790588))},874793,a=>{a.n(a.i(633169))},285826,a=>{a.n(a.i(437111))},721565,a=>{a.n(a.i(741763))},465911,a=>{a.n(a.i(708950))},225128,a=>{a.n(a.i(891562))},740781,a=>{a.n(a.i(449670))},69411,a=>{a.n(a.i(675700))},263081,a=>{a.n(a.i(200276))},862837,a=>{a.n(a.i(640795))},134607,a=>{a.n(a.i(611614))},296338,a=>{a.n(a.i(521751))},550642,a=>{a.n(a.i(512213))},232242,a=>{a.n(a.i(22693))},988530,a=>{a.n(a.i(10531))},508583,a=>{a.n(a.i(901082))},38534,a=>{a.n(a.i(698175))},670408,a=>{a.n(a.i(409095))},722922,a=>{a.n(a.i(496772))},578294,a=>{a.n(a.i(971717))},216625,a=>{a.n(a.i(585034))},488648,a=>{a.n(a.i(368113))},451914,a=>{a.n(a.i(466482))},725466,a=>{a.n(a.i(91505))},567,a=>{"use strict";let b=[1,2,3,4,5,6,7,8,9];a.s(["ALLOWED_YARDS",0,b,"FACILITIES",0,["mtcpl","riico"],"YARDS_BY_FACILITY",0,{mtcpl:[1,2,3,4,5,6,9],riico:[7,8]},"facilityLabel",0,function(a){return"riico"===a?"RIICO":"MTCPL"},"facilityOfYard",0,function(a){let b=Number(a);return 7===b||8===b?"riico":"mtcpl"},"isAllowedYard",0,function(a){let c=Number(a);return b.includes(c)},"yardLabel",0,function(a){let b=Number(a);return Number.isFinite(b)?7===b?"Yard 7 (RIICO)":8===b?"Yard 8 (RIICO)":9===b?"Open Yard":`Yard ${b}`:"—"}])},744568,a=>{"use strict";a.s(["PrintBtn",()=>b]);let b=(0,a.i(211857).registerClientReference)(function(){throw Error("Attempted to call PrintBtn() from the server but PrintBtn is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.")},"[project]/src/app/(print)/cutting/[id]/print/print-btn.tsx <module evaluation>","PrintBtn")},307354,a=>{"use strict";a.s(["PrintBtn",()=>b]);let b=(0,a.i(211857).registerClientReference)(function(){throw Error("Attempted to call PrintBtn() from the server but PrintBtn is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.")},"[project]/src/app/(print)/cutting/[id]/print/print-btn.tsx","PrintBtn")},311182,a=>{"use strict";a.i(744568);var b=a.i(307354);a.n(b)},737769,a=>{a.v("/_next/static/media/apple-icon.0wm865rwiu5ix.png"+(globalThis.NEXT_CLIENT_ASSET_SUFFIX||""))},809361,a=>{"use strict";let b={src:a.i(737769).default,width:180,height:180};a.s(["default",0,b])},525333,a=>{a.v("/_next/static/media/icon.0wj421ot_5pyb.png"+(globalThis.NEXT_CLIENT_ASSET_SUFFIX||""))},821646,a=>{"use strict";let b={src:a.i(525333).default,width:512,height:512};a.s(["default",0,b])},969350,a=>{"use strict";var b=a.i(907997);a.i(570396);var c=a.i(673727),d=a.i(109307),e=a.i(220539),f=a.i(567),g=a.i(311182);async function h({params:a}){let i;await (0,d.requireAuth)(["owner","team_head","senior_incharge","cutting_operator","developer"]);let{id:j}=await a,k=(0,e.createAdminSupabaseClient)(),{data:l}=await k.from("cut_session_blocks").select("id, status, block_id, cut_session_id, updated_at").eq("id",j).maybeSingle(),m=null;if(l)i=(m=l).block_id;else{let{data:a}=await k.from("blocks").select("id, updated_at").eq("id",j).maybeSingle();a||(0,c.notFound)(),i=a.id}let n=m?.cut_session_id?k.from("cut_sessions").select("session_code, kerf_mm").eq("id",m.cut_session_id).maybeSingle():Promise.resolve({data:null}),[{data:o},{data:p},{data:q}]=await Promise.all([n,k.from("blocks").select("id, stone, yard, length_ft, width_ft, height_ft, quality").eq("id",i).maybeSingle(),k.from("slab_requirements").select("id, label, temple, stone, length_ft, width_ft, thickness_ft, status, stock_location, priority").eq("source_block_id",i).order("temple").order("id")]),r=q??[],s=new Date().toLocaleString("en-IN",{timeZone:"Asia/Kolkata",day:"numeric",month:"long",year:"numeric",hour:"2-digit",minute:"2-digit"}),t=new Map;for(let a of r){let b=a.temple||"(no temple)";t.has(b)||t.set(b,[]),t.get(b).push(a)}let u=[...t.entries()].sort(([a],[b])=>a.localeCompare(b)),v=[...new Set(r.map(a=>a.stock_location).filter(Boolean))];return(0,b.jsxs)(b.Fragment,{children:[(0,b.jsx)("style",{children:`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
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
          font-family: ui-monospace, monospace;
          margin-bottom: 4px;
        }
        .doc-sub { font-size: 13px; color: #555; }
        .doc-date { font-size: 11px; color: #888; text-align: right; line-height: 1.6; }

        .meta-row {
          display: flex;
          flex-wrap: wrap;
          gap: 12px 20px;
          padding: 10px 0 12px;
          border-bottom: 2px solid #1a1a1a;
          margin-bottom: 18px;
        }
        .meta-cell { display: flex; flex-direction: column; gap: 2px; }
        .meta-label {
          font-size: 9px;
          font-weight: 700;
          color: #999;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }
        .meta-val { font-size: 14px; font-weight: 600; color: #1a1a1a; }
        .meta-val.mono { font-family: ui-monospace, monospace; }

        .temple-block { page-break-inside: avoid; margin-bottom: 18px; }
        .temple-head {
          font-size: 13px;
          font-weight: 700;
          color: #555;
          background: #f5f5f0;
          padding: 6px 10px;
          border-left: 4px solid #b87333;
          margin-bottom: 6px;
          letter-spacing: 0.02em;
        }

        .label-row {
          display: grid;
          grid-template-columns: 36px 22px 1.2fr 1fr 0.9fr 1.1fr 30px;
          gap: 0;
          align-items: stretch;
          border: 1.5px solid #1a1a1a;
          margin-bottom: -1.5px;
          background: #fff;
          page-break-inside: avoid;
        }
        .label-row > div {
          padding: 8px 10px;
          border-right: 1px solid #ccc;
          display: flex;
          flex-direction: column;
          justify-content: center;
        }
        .label-row > div:last-child { border-right: none; }

        .label-row.head {
          background: #1a1a1a;
          color: #fff;
        }
        .label-row.head > div {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.07em;
          text-transform: uppercase;
          color: rgba(255,255,255,0.85);
          padding: 7px 10px;
        }
        .label-row.head > div { border-right: 1px solid rgba(255,255,255,0.15); }

        .label-row .num { text-align: center; font-family: ui-monospace, monospace; color: #888; font-weight: 700; }
        .label-row .tick {
          width: 22px; height: 22px; border: 1.5px solid #555; border-radius: 4px;
          align-self: center; margin: 0 auto;
        }
        .label-row .id {
          font-family: ui-monospace, monospace;
          font-weight: 800;
          font-size: 14px;
          color: #1a1a1a;
        }
        .label-row .lbl { font-size: 11px; color: #666; }
        .label-row .dims { font-family: ui-monospace, monospace; font-weight: 700; font-size: 13px; }
        .label-row .stone { font-size: 11px; color: #666; }
        .label-row .loc {
          font-size: 12px;
          font-weight: 700;
          color: #15803d;
          text-transform: uppercase;
          letter-spacing: 0.03em;
        }
        .label-row .priority-tag {
          font-size: 9px;
          font-weight: 800;
          padding: 1px 6px;
          background: #dc2626;
          color: #fff;
          border-radius: 999px;
          width: fit-content;
          margin-top: 3px;
          letter-spacing: 0.05em;
        }
        .label-row .status-tag {
          font-size: 9px;
          font-weight: 700;
          color: #888;
          font-family: ui-monospace, monospace;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          margin-top: 3px;
        }

        .signoff-row {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 22px;
          margin-top: 22px;
          padding-top: 12px;
          border-top: 1px solid #ccc;
        }
        .signoff-cell { display: flex; flex-direction: column; gap: 6px; }
        .signoff-label { font-size: 10px; color: #888; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; }
        .signoff-line { border-bottom: 1.5px solid #888; height: 32px; width: 100%; }

        .doc-footer {
          margin-top: 22px;
          padding-top: 8px;
          border-top: 1px solid #ddd;
          font-size: 10px;
          color: #aaa;
          display: flex;
          justify-content: space-between;
        }

        .empty-state {
          padding: 32px 20px;
          text-align: center;
          color: #999;
          font-size: 13px;
          border: 1px dashed #ccc;
          border-radius: 8px;
        }

        @media print {
          body { background: #fff; }
          .screen-bar { display: none !important; }
          .print-wrap { max-width: none; padding: 8mm 10mm; margin: 0; }
          @page { margin: 8mm; size: A4 portrait; }
        }
        @media screen {
          body { padding: 0; }
        }
      `}),(0,b.jsxs)("div",{className:"screen-bar",children:[(0,b.jsxs)("span",{className:"screen-bar-title",children:["Slab Labels — ",i," · ",o?.session_code??""]}),(0,b.jsx)(g.PrintBtn,{})]}),(0,b.jsxs)("div",{className:"print-wrap",children:[(0,b.jsxs)("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"flex-start"},children:[(0,b.jsxs)("div",{children:[(0,b.jsx)("div",{className:"doc-eyebrow",children:"MTCPL · Slab Labels (post-cut)"}),(0,b.jsx)("div",{className:"doc-title",children:i}),(0,b.jsxs)("div",{className:"doc-sub",children:[r.length," slab",1!==r.length?"s":""," attributed to this block · cutter writes each ID on the physical slab"]})]}),(0,b.jsxs)("div",{className:"doc-date",children:[(0,b.jsxs)("div",{children:["Printed: ",s]}),o?.session_code&&(0,b.jsxs)("div",{children:["Session: ",o.session_code]})]})]}),(0,b.jsxs)("div",{className:"meta-row",children:[(0,b.jsxs)("div",{className:"meta-cell",children:[(0,b.jsx)("div",{className:"meta-label",children:"Block"}),(0,b.jsx)("div",{className:"meta-val mono",children:i})]}),p&&(0,b.jsxs)(b.Fragment,{children:[(0,b.jsxs)("div",{className:"meta-cell",children:[(0,b.jsx)("div",{className:"meta-label",children:"Stone"}),(0,b.jsx)("div",{className:"meta-val",children:p.stone})]}),(0,b.jsxs)("div",{className:"meta-cell",children:[(0,b.jsx)("div",{className:"meta-label",children:"Yard"}),(0,b.jsx)("div",{className:"meta-val",children:(0,f.yardLabel)(p.yard)})]}),p.quality&&(0,b.jsxs)("div",{className:"meta-cell",children:[(0,b.jsx)("div",{className:"meta-label",children:"Grade"}),(0,b.jsx)("div",{className:"meta-val",children:p.quality})]})]}),1===v.length&&(0,b.jsxs)("div",{className:"meta-cell",children:[(0,b.jsx)("div",{className:"meta-label",children:"Stock location"}),(0,b.jsxs)("div",{className:"meta-val",style:{color:"#15803d"},children:["📍 ",v[0]]})]}),v.length>1&&(0,b.jsxs)("div",{className:"meta-cell",children:[(0,b.jsx)("div",{className:"meta-label",children:"Stock locations"}),(0,b.jsxs)("div",{className:"meta-val",style:{color:"#15803d"},children:[v.length," different — see rows"]})]})]}),0===r.length?(0,b.jsxs)("div",{className:"empty-state",children:["No slabs found for this block yet.",(0,b.jsx)("br",{}),"If you cut manual slabs, ask the office team to add them in the system first — then come back to print this sheet."]}):u.map(([a,c])=>(0,b.jsxs)("div",{className:"temple-block",children:[(0,b.jsxs)("div",{className:"temple-head",children:["🏛 ",a," · ",c.length," slab",1!==c.length?"s":""]}),(0,b.jsxs)("div",{className:"label-row head",children:[(0,b.jsx)("div",{children:"#"}),(0,b.jsx)("div",{children:"✓"}),(0,b.jsx)("div",{children:"Slab ID"}),(0,b.jsx)("div",{children:"W × H × T"}),(0,b.jsx)("div",{children:"Stone"}),(0,b.jsx)("div",{children:"Stock location"}),(0,b.jsx)("div",{})]}),c.map((a,c)=>{let d=Number(a.length_ft),e=Number(a.width_ft),f=Number(a.thickness_ft);return(0,b.jsxs)("div",{className:"label-row",children:[(0,b.jsx)("div",{className:"num",children:c+1}),(0,b.jsx)("div",{children:(0,b.jsx)("span",{className:"tick"})}),(0,b.jsxs)("div",{children:[(0,b.jsx)("span",{className:"id",children:a.id}),a.label&&(0,b.jsx)("span",{className:"lbl",children:a.label}),a.priority&&(0,b.jsx)("span",{className:"priority-tag",children:"⚡ PRIORITY"}),a.status&&"cut_done"!==a.status&&(0,b.jsx)("span",{className:"status-tag",children:a.status.replace(/_/g," ")})]}),(0,b.jsx)("div",{children:(0,b.jsxs)("span",{className:"dims",children:[d,"×",e,"×",f,"″"]})}),(0,b.jsx)("div",{children:(0,b.jsx)("span",{className:"stone",children:a.stone??"—"})}),(0,b.jsx)("div",{children:(0,b.jsxs)("span",{className:"loc",children:["📍 ",a.stock_location??"—"]})}),(0,b.jsx)("div",{})]},a.id)})]},a)),(0,b.jsxs)("div",{className:"signoff-row",children:[(0,b.jsxs)("div",{className:"signoff-cell",children:[(0,b.jsx)("div",{className:"signoff-label",children:"Cutter"}),(0,b.jsx)("div",{className:"signoff-line"})]}),(0,b.jsxs)("div",{className:"signoff-cell",children:[(0,b.jsx)("div",{className:"signoff-label",children:"Date written on slabs"}),(0,b.jsx)("div",{className:"signoff-line"})]}),(0,b.jsxs)("div",{className:"signoff-cell",children:[(0,b.jsx)("div",{className:"signoff-label",children:"Office check"}),(0,b.jsx)("div",{className:"signoff-line"})]})]}),(0,b.jsxs)("div",{className:"doc-footer",children:[(0,b.jsxs)("span",{children:["MTCPL · Slab labels · ",i]}),(0,b.jsxs)("span",{children:[r.length," rows"]})]})]})]})}a.s(["default",0,h])},699888,a=>{a.n(a.i(969350))}];

//# debugId=6ada8246-32e4-9405-2960-991d7c2681f1
//# sourceMappingURL=%5Broot-of-the-server%5D__0h5quw4._.js.map