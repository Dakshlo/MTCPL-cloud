;!function(){try { var e="undefined"!=typeof globalThis?globalThis:"undefined"!=typeof global?global:"undefined"!=typeof window?window:"undefined"!=typeof self?self:{},n=(new e.Error).stack;n&&((e._debugIds|| (e._debugIds={}))[n]="6b8681e0-712f-08cd-7849-507abb558cc9")}catch(e){}}();
module.exports=[807542,a=>{"use strict";var b=a.i(220539);async function c(){let a=(0,b.createAdminSupabaseClient)(),{data:c}=await a.from("profiles").select("id, full_name, phone"),d={};for(let a of c??[])d[a.id]=a.full_name||a.phone||"Unknown";return d}a.s(["getProfilesMap",0,c])},950640,(a,b,c)=>{"use strict";Object.defineProperty(c,"__esModule",{value:!0}),Object.defineProperty(c,"InvariantError",{enumerable:!0,get:function(){return d}});class d extends Error{constructor(a,b){super(`Invariant: ${a.endsWith(".")?a:a+"."} This is a bug in Next.js.`,b),this.name="InvariantError"}}},164240,(a,b,c)=>{"use strict";function d(a){if("function"!=typeof WeakMap)return null;var b=new WeakMap,c=new WeakMap;return(d=function(a){return a?c:b})(a)}c._=function(a,b){if(!b&&a&&a.__esModule)return a;if(null===a||"object"!=typeof a&&"function"!=typeof a)return{default:a};var c=d(b);if(c&&c.has(a))return c.get(a);var e={__proto__:null},f=Object.defineProperty&&Object.getOwnPropertyDescriptor;for(var g in a)if("default"!==g&&Object.prototype.hasOwnProperty.call(a,g)){var h=f?Object.getOwnPropertyDescriptor(a,g):null;h&&(h.get||h.set)?Object.defineProperty(e,g,h):e[g]=a[g]}return e.default=a,c&&c.set(a,e),e}},193695,(a,b,c)=>{b.exports=a.x("next/dist/shared/lib/no-fallback-error.external.js",()=>require("next/dist/shared/lib/no-fallback-error.external.js"))},971306,(a,b,c)=>{b.exports=a.r(918622)},179847,a=>{a.n(a.i(403343))},9185,a=>{a.n(a.i(729432))},872842,a=>{a.n(a.i(275164))},454897,a=>{a.n(a.i(330106))},856157,a=>{a.n(a.i(118970))},594331,a=>{a.n(a.i(860644))},715988,a=>{a.n(a.i(856952))},625766,a=>{a.n(a.i(777341))},529725,a=>{a.n(a.i(994290))},605785,a=>{a.n(a.i(790588))},874793,a=>{a.n(a.i(633169))},285826,a=>{a.n(a.i(437111))},721565,a=>{a.n(a.i(741763))},465911,a=>{a.n(a.i(708950))},225128,a=>{a.n(a.i(891562))},740781,a=>{a.n(a.i(449670))},69411,a=>{a.n(a.i(675700))},263081,a=>{a.n(a.i(200276))},862837,a=>{a.n(a.i(640795))},134607,a=>{a.n(a.i(611614))},296338,a=>{a.n(a.i(521751))},550642,a=>{a.n(a.i(512213))},232242,a=>{a.n(a.i(22693))},988530,a=>{a.n(a.i(10531))},508583,a=>{a.n(a.i(901082))},38534,a=>{a.n(a.i(698175))},670408,a=>{a.n(a.i(409095))},722922,a=>{a.n(a.i(496772))},578294,a=>{a.n(a.i(971717))},216625,a=>{a.n(a.i(585034))},488648,a=>{a.n(a.i(368113))},451914,a=>{a.n(a.i(466482))},725466,a=>{a.n(a.i(91505))},567,a=>{"use strict";let b=[1,2,3,4,5,6,7,8,9];a.s(["ALLOWED_YARDS",0,b,"FACILITIES",0,["mtcpl","riico"],"YARDS_BY_FACILITY",0,{mtcpl:[1,2,3,4,5,6,9],riico:[7,8]},"facilityLabel",0,function(a){return"riico"===a?"RIICO":"MTCPL"},"facilityOfYard",0,function(a){let b=Number(a);return 7===b||8===b?"riico":"mtcpl"},"isAllowedYard",0,function(a){let c=Number(a);return b.includes(c)},"yardLabel",0,function(a){let b=Number(a);return Number.isFinite(b)?7===b?"Yard 7 (RIICO)":8===b?"Yard 8 (RIICO)":9===b?"Open Yard":`Yard ${b}`:"—"}])},744568,a=>{"use strict";a.s(["PrintBtn",()=>b]);let b=(0,a.i(211857).registerClientReference)(function(){throw Error("Attempted to call PrintBtn() from the server but PrintBtn is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.")},"[project]/src/app/(print)/cutting/[id]/print/print-btn.tsx <module evaluation>","PrintBtn")},307354,a=>{"use strict";a.s(["PrintBtn",()=>b]);let b=(0,a.i(211857).registerClientReference)(function(){throw Error("Attempted to call PrintBtn() from the server but PrintBtn is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.")},"[project]/src/app/(print)/cutting/[id]/print/print-btn.tsx","PrintBtn")},311182,a=>{"use strict";a.i(744568);var b=a.i(307354);a.n(b)},525333,a=>{a.v("/_next/static/media/icon.0wj421ot_5pyb.png"+(globalThis.NEXT_CLIENT_ASSET_SUFFIX||""))},821646,a=>{"use strict";let b={src:a.i(525333).default,width:512,height:512};a.s(["default",0,b])},737769,a=>{a.v("/_next/static/media/apple-icon.0wm865rwiu5ix.png"+(globalThis.NEXT_CLIENT_ASSET_SUFFIX||""))},809361,a=>{"use strict";let b={src:a.i(737769).default,width:180,height:180};a.s(["default",0,b])},558525,a=>{"use strict";var b=a.i(907997);a.i(570396);var c=a.i(673727),d=a.i(109307),e=a.i(220539),f=a.i(807542),g=a.i(567),h=a.i(311182);let i={pending:"Pending Approval",in_progress:"In Progress",done:"Done Today"},j={pending:["pending_worker"],in_progress:["cutting","done_prompt"],done:["done"]};function k(a){return"both"===a?"All Facilities (MTCPL + RIICO)":(0,g.facilityLabel)(a)}async function l({searchParams:a}){let n;await (0,d.requireAuth)(["owner","team_head","senior_incharge","cutting_operator"]);let{facility:o,tab:p,blocks:q}=await a,r="mtcpl"===o||"riico"===o?o:"both",s="pending"===p||"done"===p?p:"in_progress",t=(q??"").split(",").map(a=>a.trim()).filter(Boolean),u=t.length>0,v=(0,e.createAdminSupabaseClient)(),w=j[s],{todayStartIso:x,tomorrowStartIso:y}={todayStartIso:new Date(n=864e5*Math.floor((Date.now()+198e5)/864e5)-198e5).toISOString(),tomorrowStartIso:new Date(n+864e5).toISOString()},z=v.from("cut_session_blocks").select("id, block_id, status, updated_at, cut_session_id, layout, cut_sessions(session_code, kerf_mm, planned_by), cut_session_slabs(slab_requirement_id)");u?z=z.in("id",t):(z=z.in("status",w),"done"===s&&(z=z.gte("updated_at",x).lt("updated_at",y)));let{data:A,error:B}=await z.order("updated_at",{ascending:"done"!==s});B&&(0,c.notFound)();let C=await (0,f.getProfilesMap)(),D=(A??[]).filter(a=>"both"===r||(0,g.facilityOfYard)(a.layout?.blk?.yard)===r),{data:E}=await v.from("slab_requirements").select("id").eq("priority",!0).in("status",["open","planned","cutting"]),F=new Set((E??[]).map(a=>a.id)),G={mtcpl:[],riico:[]};for(let a of D)G[(0,g.facilityOfYard)(a.layout?.blk?.yard)].push(a);let H=D.length,I=D.reduce((a,b)=>a+(b.layout?.placed?.length??0),0),J=new Set;for(let a of D)for(let b of a.layout?.placed??[])b.temple&&J.add(b.temple);let K=new Date().toLocaleString("en-IN",{timeZone:"Asia/Kolkata",day:"numeric",month:"long",year:"numeric",hour:"2-digit",minute:"2-digit"}),L="both"===r?[...g.FACILITIES]:[r],M=u?`${H} Selected Block${1!==H?"s":""}`:i[s];return(0,b.jsxs)(b.Fragment,{children:[(0,b.jsx)("style",{children:`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
               font-size: 12px; color: #1a1a1a; background: #f0f0f0; }

        .print-wrap { max-width: 900px; margin: 0 auto; background: #fff;
                      padding: 24px 28px 32px; }

        .screen-bar { background: #1a1a1a; color: #fff; padding: 10px 28px;
                      display: flex; align-items: center; justify-content: space-between;
                      gap: 12px; max-width: 900px; margin: 0 auto; }
        .screen-bar-title { font-size: 13px; color: rgba(255,255,255,0.8); }
        .print-action-btn { background: #b87333; color: #fff; border: none;
                            padding: 8px 22px; border-radius: 6px; font-size: 13px;
                            font-weight: 600; cursor: pointer; letter-spacing: 0.02em; }
        .print-action-btn:hover { background: #a06428; }

        .doc-eyebrow { font-size: 10px; font-weight: 700; color: #888;
                       text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 6px; }
        .doc-title { font-size: 22px; font-weight: 700; color: #1a1a1a; margin-bottom: 3px; }
        .doc-sub { font-size: 12px; color: #555; }
        .doc-date { font-size: 10px; color: #888; text-align: right; line-height: 1.6; }

        /* Summary tiles */
        .summary { display: grid; grid-template-columns: repeat(3, 1fr);
                   gap: 10px; margin: 16px 0 22px; }
        .tile { padding: 10px 12px; background: #fafafa;
                border: 1px solid #ddd; border-radius: 6px; }
        .tile-label { font-size: 9px; font-weight: 700; color: #999;
                      text-transform: uppercase; letter-spacing: 0.07em; margin-bottom: 3px; }
        .tile-value { font-size: 18px; font-weight: 700; color: #1a1a1a;
                      font-family: ui-monospace, monospace; }

        /* Facility headings */
        .facility-head { display: flex; align-items: center; gap: 10px;
                         margin: 20px 0 10px; padding-bottom: 6px;
                         border-bottom: 2px solid #1a1a1a; }
        .facility-pill { font-size: 11px; font-weight: 700; letter-spacing: 0.05em;
                         padding: 3px 10px; border-radius: 4px; }
        .facility-pill.mtcpl { background: rgba(184,115,51,0.12);
                               color: #a06428;
                               border: 1px solid rgba(184,115,51,0.3); }
        .facility-pill.riico { background: rgba(124,58,237,0.12);
                               color: #6d28d9;
                               border: 1px solid rgba(124,58,237,0.3); }
        .facility-scope { font-size: 10px; color: #999; font-weight: 500; }

        /* Block row */
        .block-row { border: 1px solid #ddd; border-radius: 6px;
                     padding: 10px 12px; margin-bottom: 8px;
                     page-break-inside: avoid; background: #fff; }
        .block-row.urgent { border-left: 4px solid #dc2626;
                            background: rgba(220,38,38,0.04); }
        .block-header { display: flex; justify-content: space-between;
                        flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
        .block-id { font-family: ui-monospace, monospace; font-size: 14px;
                    font-weight: 700; color: #1a1a1a; }
        .block-urgent-badge { font-size: 9px; font-weight: 700; color: #dc2626;
                              background: rgba(220,38,38,0.1); padding: 1px 7px;
                              border-radius: 3px; margin-left: 6px; }
        .block-meta { font-size: 11px; color: #666; line-height: 1.5; }
        .block-meta strong { color: #333; }

        /* Slab list within a block */
        .slab-list { margin-top: 6px; padding-top: 6px;
                     border-top: 1px solid #eee;
                     display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
                     gap: 4px 10px; }
        .slab-item { font-size: 11px; color: #444; line-height: 1.4;
                     font-family: ui-monospace, monospace; }
        .slab-item .slab-id { color: #1a1a1a; font-weight: 700; }
        .slab-item .slab-dims { color: #666; }
        .slab-item .slab-temple { font-family: -apple-system, Arial, sans-serif;
                                  color: #888; }

        .empty { padding: 14px; text-align: center; color: #999;
                 font-size: 12px; background: #fafafa;
                 border: 1px dashed #ddd; border-radius: 6px; }

        .doc-footer { margin-top: 24px; padding-top: 10px;
                      border-top: 1px solid #e0e0e0;
                      display: flex; justify-content: space-between;
                      font-size: 10px; color: #aaa; }

        @media print {
          body { background: #fff; }
          .screen-bar { display: none !important; }
          .print-wrap { max-width: none; padding: 10mm 12mm; margin: 0; }
          @page { margin: 10mm; }
        }

        @media screen { body { padding: 0; } }
      `}),(0,b.jsxs)("div",{className:"screen-bar",children:[(0,b.jsxs)("span",{className:"screen-bar-title",children:[M," — ",k(r)," · ",H," block",1!==H?"s":""]}),(0,b.jsx)(h.PrintBtn,{})]}),(0,b.jsxs)("div",{className:"print-wrap",children:[(0,b.jsxs)("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12},children:[(0,b.jsxs)("div",{children:[(0,b.jsx)("div",{className:"doc-eyebrow",children:"MTCPL · Cutting Report"}),(0,b.jsx)("div",{className:"doc-title",children:M}),(0,b.jsx)("div",{className:"doc-sub",children:k(r)})]}),(0,b.jsx)("div",{className:"doc-date",children:(0,b.jsxs)("div",{children:["Printed: ",K]})})]}),(0,b.jsxs)("div",{className:"summary",children:[(0,b.jsxs)("div",{className:"tile",children:[(0,b.jsx)("div",{className:"tile-label",children:"Blocks"}),(0,b.jsx)("div",{className:"tile-value",children:H})]}),(0,b.jsxs)("div",{className:"tile",children:[(0,b.jsx)("div",{className:"tile-label",children:"Slabs"}),(0,b.jsx)("div",{className:"tile-value",children:I})]}),(0,b.jsxs)("div",{className:"tile",children:[(0,b.jsx)("div",{className:"tile-label",children:"Temples"}),(0,b.jsx)("div",{className:"tile-value",children:J.size})]})]}),0===H&&(0,b.jsx)("div",{className:"empty",children:u?`None of the ${t.length} selected block${1!==t.length?"s":""} are in ${k(r)}.`:`No ${i[s].toLowerCase()} blocks for ${k(r)}.`}),L.map(a=>{let c=G[a];return 0===c.length?null:(0,b.jsxs)("section",{children:[(0,b.jsxs)("div",{className:"facility-head",children:[(0,b.jsx)("span",{className:`facility-pill ${a}`,children:(0,g.facilityLabel)(a)}),(0,b.jsxs)("span",{style:{fontSize:11,color:"#555",fontWeight:600},children:[c.length," block",1!==c.length?"s":""]}),(0,b.jsxs)("span",{className:"facility-scope",children:["· Yards ",g.YARDS_BY_FACILITY[a].join(", ")]})]}),c.map(a=>(0,b.jsx)(m,{block:a,profilesMap:C,isUrgent:a.cut_session_slabs.some(a=>F.has(a.slab_requirement_id))},a.id))]},a)}),(0,b.jsxs)("div",{className:"doc-footer",children:[(0,b.jsxs)("span",{children:["MTCPL · ",M," · ",k(r)]}),(0,b.jsxs)("span",{children:[H," block",1!==H?"s":""," · ",I," slab",1!==I?"s":""]})]})]})]})}function m({block:a,profilesMap:c,isUrgent:d}){let e=a.layout?.blk,f=a.layout?.placed??[],h=a.cut_sessions,i=h?.planned_by?c[h.planned_by]??null:null;return(0,b.jsxs)("div",{className:`block-row${d?" urgent":""}`,children:[(0,b.jsxs)("div",{className:"block-header",children:[(0,b.jsxs)("div",{children:[(0,b.jsx)("span",{className:"block-id",children:a.block_id}),d&&(0,b.jsx)("span",{className:"block-urgent-badge",children:"⚡ URGENT"})]}),(0,b.jsx)("div",{style:{fontSize:10,color:"#888",fontFamily:"ui-monospace, monospace"},children:h?.session_code??"—"})]}),(0,b.jsxs)("div",{className:"block-meta",children:[e?(0,b.jsxs)(b.Fragment,{children:[(0,b.jsx)("strong",{children:e.stone})," · ",(0,g.yardLabel)(e.yard)," · ",(0,b.jsxs)("span",{style:{fontFamily:"ui-monospace, monospace"},children:[e.l,"×",e.w,"×",e.h,"″"]})]}):"Block data unavailable",h?.kerf_mm?(0,b.jsxs)(b.Fragment,{children:[" · Kerf ",h.kerf_mm," mm"]}):null,i?(0,b.jsxs)(b.Fragment,{children:[" · Plan by ",(0,b.jsx)("strong",{children:i})]}):null]}),f.length>0?(0,b.jsx)("div",{className:"slab-list",children:f.map(a=>{let c;return(0,b.jsxs)("div",{className:"slab-item",children:[(0,b.jsx)("span",{className:"slab-id",children:a.id})," ",(0,b.jsx)("span",{className:"slab-dims",children:(c=[a.sw,a.sh,a.sd].map(a=>null!=a?String(a):"—"),`${c[0]}\xd7${c[1]}\xd7${c[2]}″`)}),a.temple?(0,b.jsxs)(b.Fragment,{children:[" ",(0,b.jsxs)("span",{className:"slab-temple",children:["· ",a.temple]})]}):null]},a.id)})}):(0,b.jsx)("div",{style:{marginTop:6,fontSize:11,color:"#999",fontStyle:"italic"},children:"No slabs in this plan."})]})}a.s(["default",0,l])},775800,a=>{a.n(a.i(558525))}];

//# debugId=6b8681e0-712f-08cd-7849-507abb558cc9
//# sourceMappingURL=%5Broot-of-the-server%5D__0p9tjl8._.js.map