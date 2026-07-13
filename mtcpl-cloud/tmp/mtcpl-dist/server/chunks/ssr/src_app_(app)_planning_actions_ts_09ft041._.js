;!function(){try { var e="undefined"!=typeof globalThis?globalThis:"undefined"!=typeof global?global:"undefined"!=typeof window?window:"undefined"!=typeof self?self:{},n=(new e.Error).stack;n&&((e._debugIds|| (e._debugIds={}))[n]="85d6035a-9076-01f7-0ebd-ddccc364f8d5")}catch(e){}}();
module.exports=[26322,a=>{"use strict";var b=a.i(137936);a.i(570396);var c=a.i(673727),d=a.i(118558),e=a.i(109307),f=a.i(220539),g=a.i(863985);function h(a,b=0){let c=Number(a);return Number.isFinite(c)?c:b}function i(a){return Math.round(100*a)/100}function j(a,b,c){let d=h(a.length_ft),e=h(a.width_ft),f=h(a.height_ft);if(d<=.01||e<=.01||f<=.01)return{allPlaced:[],orient:null,lastSpaces:[],depthUsed:0};let g={allPlaced:[],orient:null,lastSpaces:[],depthUsed:0};for(let h of[{faceL:d,faceW:e,depth:f,label:"L×W face"}]){let d=0,e=[],f=[],j=b.filter(b=>(!b.stone||b.stone===a.stone)&&("B"!==a.quality||"A"!==b.quality));for(;j.length>0&&h.depth-d>.01;){let a=h.depth-d,b=[];for(let c of j){let d=function(a,b,c,d,e,f){let g=[{fw:a,fh:b,depth:c},{fw:a,fh:c,depth:b},{fw:b,fh:c,depth:a}].filter(a=>a.depth<=f+.001&&(a.fw<=d+.001&&a.fh<=e+.001||a.fh<=d+.001&&a.fw<=e+.001));return g.length?g.reduce((a,b)=>b.fw*b.fh>=a.fw*a.fh?b:a):null}(c.sl,c.sw,c.sd,h.faceL,h.faceW,a);d&&b.push({id:c.id,label:c.label,temple:c.temple,fw:d.fw,fh:d.fh,depth:d.depth,quality:c.quality})}if(!b.length)break;let g=new Map;for(let a of b){let b=Math.round(1e4*a.depth);g.has(b)||g.set(b,[]),g.get(b).push(a)}let k=null,l=0;for(let[a,b]of g){let d=a/1e4,e=b.map(a=>({id:a.id,label:a.label,temple:a.temple,sw:a.fw,sh:a.fh,sd:d})),f=function(a,b,c,d){let e=[{x:0,y:0,w:a,h:b}],f=[],g=[];for(let a of c.slice().sort((a,b)=>b.sw*b.sh-a.sw*a.sh)){let b;if(e.forEach((c,e)=>{[{aw:a.sw+d,ah:a.sh+d,pw:a.sw,ph:a.sh,rot:!1},{aw:a.sh+d,ah:a.sw+d,pw:a.sh,ph:a.sw,rot:!0}].forEach(a=>{if(a.aw<=c.w+1e-4&&a.ah<=c.h+1e-4){let d=c.w*c.h-a.aw*a.ah;(!b||d<b.waste||d===b.waste&&c.w*c.h<b.spaceArea)&&(b={index:e,aw:a.aw,ah:a.ah,pw:a.pw,ph:a.ph,rot:a.rot,waste:d,spaceArea:c.w*c.h})}})}),!b){g.push(a);continue}let c=e[b.index];f.push({id:a.id,label:a.label,temple:a.temple,sw:a.sw,sh:a.sh,sd:a.sd,px:i(c.x),py:i(c.y),pw:i(b.pw),ph:i(b.ph),aw:i(b.aw),ah:i(b.ah),rot:b.rot}),e.splice(b.index,1),e=e.concat(function(a,b,c){let d={x:a.x+b,y:a.y,w:a.w-b,h:c},e={x:a.x,y:a.y+c,w:a.w,h:a.h-c},f={x:a.x,y:a.y+c,w:b,h:a.h-c},g={x:a.x+b,y:a.y,w:a.w-b,h:a.h};return Math.max(Math.max(0,d.w)*Math.max(0,d.h),Math.max(0,e.w)*Math.max(0,e.h))>=Math.max(Math.max(0,f.w)*Math.max(0,f.h),Math.max(0,g.w)*Math.max(0,g.h))?[d,e]:[f,g]}(c,b.aw,b.ah)).filter(a=>a.w>.01&&a.h>.01).sort((a,b)=>b.w*b.h-a.w*a.h)}return{placed:f,spaces:e,unplaced:g}}(h.faceL,h.faceW,e,c);f.placed.length>(k?.placed.length??0)&&(k=f,l=d)}if(!k||!k.placed.length)break;let m=h.depth-d,n=Math.max(0,m-l);k.placed.forEach(a=>e.push({...a,zTop:m,zBot:n})),f=k.spaces,d+=l+c;let o=new Set(k.placed.map(a=>a.id));j=j.filter(a=>!o.has(a.id))}e.length>g.allPlaced.length&&(g={allPlaced:e,orient:h,lastSpaces:f,depthUsed:d})}return g}async function k(b){await (0,e.requireAuth)(["developer"]);let c=process.env.ANTHROPIC_API_KEY;if(!c)return{assignments:[],unassigned_slab_ids:[],unassigned_reason:"",strategy:"",error:"ANTHROPIC_API_KEY is not set in environment variables."};let{blocks:d,slabs:f,availableSlabs:g=[],kerfMm:h}=b;function i(a){return Math.round(a.length_ft*a.width_ft*a.height_ft)}let j=[...d].sort((a,b)=>a.stone!==b.stone?a.stone.localeCompare(b.stone):i(a)-i(b)).map(a=>{let b,c=Math.max(a.length_ft,a.width_ft,a.height_ft);return`  ${a.id} [${(b=Math.max(a.length_ft,a.width_ft,a.height_ft))<60?"SMALL":b<90?"MEDIUM":b<130?"LARGE":"BEAM"} \xb7 ${i(a).toLocaleString()}cu\xb7in \xb7 longest=${c}"]: ${a.stone} | ${a.length_ft}"L \xd7 ${a.width_ft}"W \xd7 ${a.height_ft}"H | quality:${a.quality??"standard"}`}).join("\n"),k=[...f].sort((a,b)=>{let c=Math.max(a.length_ft,a.width_ft),d=Math.max(b.length_ft,b.width_ft);return d!==c?d-c:a.priority!==b.priority?a.priority?-1:1:0}).map(a=>{let b=Math.max(a.length_ft,a.width_ft);return`  ${a.id}${a.priority?" ⚠PRIORITY":""} [anchor=${b}"]: ${a.temple} | ${a.stone??"any-stone"} | ${a.length_ft}"L \xd7 ${a.width_ft}"W \xd7 ${a.thickness_ft}"T | ${a.label}${a.quality?` | quality:${a.quality}`:""}`}).join("\n"),l=[...g].sort((a,b)=>Math.max(a.length_ft,a.width_ft)-Math.max(b.length_ft,b.width_ft)).slice(0,200),m=0===l.length?"  (none — every open slab is already in the user's selection)":l.map(a=>{let b=Math.max(a.length_ft,a.width_ft);return`  ${a.id}${a.priority?" ⚠PRIORITY":""} [anchor=${b}"]: ${a.temple} | ${a.stone??"any-stone"} | ${a.length_ft}"L \xd7 ${a.width_ft}"W \xd7 ${a.thickness_ft}"T | ${a.label}${a.quality?` | quality:${a.quality}`:""}`}).join("\n"),n=g.length>200?`
  …${g.length-200} more available slabs not shown (smallest-anchor shown first)`:"",o=`You are the cut planner for MTCPL, a stone-fabrication company.

Your output is consumed by a deterministic geometry engine that:
  • takes your {block_id, slab_ids[]} groupings as ground truth
  • computes the actual 3D layout, kerf math, and orientation
  • rejects any infeasible grouping and falls back to the algorithm

So your one job is to GROUP slabs into blocks. You don't compute coordinates.
The engine will figure out if the slabs physically fit; your task is to make
SMART choices about WHICH block holds WHICH slabs.

═══════════════════════════════════════════════════════════════════
ALGORITHM YOU'RE EMULATING (then improving)
═══════════════════════════════════════════════════════════════════

The deterministic algorithm does this for each slab (longest-first):
  1. Find candidate blocks where stone matches, quality matches, and
     max(block.L, block.W, block.H) ≥ max(slab.L, slab.W). The slab's
     longest dimension is the "anchor" — every block must be at least
     that long.
  2. Sort candidates by VOLUME ASCENDING (smallest sufficient block first).
  3. Try the smallest candidate. If the slab packs onto it, commit and
     pull every other compatible slab onto the same block before moving on.

This produces decent plans but treats all blocks the same size-wise. You
will improve on it with INVENTORY STRATEGY.

═══════════════════════════════════════════════════════════════════
THE IMPROVEMENT YOU MUST MAKE — INVENTORY STRATEGY
═══════════════════════════════════════════════════════════════════

Blocks are tagged by tier in the listing below:
  • SMALL   (longest < 60"):  USE AGGRESSIVELY. Hard to find a use for
                              later — clear them out first.
  • MEDIUM  (60–89"):         Bread and butter. Use freely.
  • LARGE   (90–129"):        Use only when no SMALL/MEDIUM fits the
                              anchor (anchor ≥ 60" requires at least
                              MEDIUM, anchor ≥ 90" requires LARGE).
  • BEAM    (≥ 130"):         RESERVE. Only use when:
                              (a) the slab itself is anchor ≥ 130", OR
                              (b) every smaller block has been tried
                                  and no LARGE-tier block of matching
                                  stone is left.

Long beam orders (10ft+ railings, lintels) come in regularly; we lose
those orders if we already cut a 12ft block into 4ft slabs we could
have made on a 4ft block.

═══════════════════════════════════════════════════════════════════
PACKING MECHANICS (so you know what's feasible)
═══════════════════════════════════════════════════════════════════

Block dimensions: L \xd7 W \xd7 H inches (cut face = L \xd7 W, depth = H).
Cuts go through H, producing horizontal layers.

Slab fits a block iff at least one of these orientations works:
  • slab.L ≤ blockface.X AND slab.W ≤ blockface.Y AND slab.T ≤ depth
  • (and rotations / face permutations of the same)

Multi-layer packing: each layer of cuts produces N slabs of the SAME
THICKNESS in that layer. Layers stack; total layer depth ≤ block H.
So one block holds many slabs:
  Block 84\xd728\xd760 with 24\xd724\xd70.25"-thick slabs:
  → ≈3 slabs per layer, ~200 layers ⇒ many hundreds in theory.

Group slabs of similar thickness so layers stay clean.

═══════════════════════════════════════════════════════════════════
HARD RULES (engine rejects violations)
═══════════════════════════════════════════════════════════════════

1. STONE: slab.stone must equal block.stone. (slab.stone="any" matches anything.)
2. QUALITY:
     - Grade-A slab REQUIRES Grade-A block.
     - Grade-B slab needs Grade-A or Grade-B block (NOT standard/null).
     - Standard slab works on any block.
3. ANCHOR: max(slab.L, slab.W) ≤ max(block.L, block.W, block.H).
4. UNIQUE: every block_id at most ONCE; every slab_id at most ONCE.
5. PRIORITY (⚠PRIORITY) slabs MUST be assigned if any block fits them.

═══════════════════════════════════════════════════════════════════
INPUT
═══════════════════════════════════════════════════════════════════

Blade kerf: ${h}mm per cut.

AVAILABLE BLOCKS (${d.length}, sorted smallest-volume first within each stone):
${j}

SLABS THE USER ASKED YOU TO PLAN (${f.length}, sorted longest-anchor first):
${k}

OTHER OPEN SLABS NOT IN THE USER'S SELECTION (${g.length}, sorted smallest-anchor first):
These are slabs the user did NOT pick this run — but they exist in the open
inventory. After you finalise the assignments below, you'll do a SECOND PASS
to suggest which of these would fit into LEFTOVER face-area or LEFTOVER depth
on the blocks you're already using, so the user can fill the block tighter
in one cutting session instead of starting it half-full.
${m}${n}

═══════════════════════════════════════════════════════════════════
DECISION PROCEDURE — follow exactly
═══════════════════════════════════════════════════════════════════

PHASE 1 — Plan the user's selection (the must-do work):

For each slab in the order shown (longest anchor first):
  IF already assigned: skip.
  Step 1: Determine min-tier needed by anchor:
     anchor < 60"   → start with SMALL
     anchor < 90"   → start with MEDIUM
     anchor < 130"  → start with LARGE
     anchor ≥ 130"  → start with BEAM
  Step 2: List all unassigned blocks of matching stone+quality at the
     min-tier or above. Sort by volume ASCENDING. Walk the list.
  Step 3: Take the FIRST candidate. Pull onto it any other unassigned
     compatible slabs (same stone, similar thickness preferred, same
     temple as a tiebreaker). Stop pulling when face area is ~85% full
     in 2D OR 4–8 slabs grouped (don't over-stuff — the engine will
     also reject infeasible packs).
  Step 4: If after Step 3 the chosen block has fewer than 2 slabs AND
     the next-smaller tier also has a fitting block, downgrade. (Avoid
     wasting a MEDIUM on a single small slab when SMALL was available.)
  Step 5: Commit and move to the next slab.

PHASE 2 — Suggest fillers from OTHER OPEN SLABS:

Once Phase 1 is complete, walk the blocks you've assigned. For each:
  a. Estimate the leftover face area on the cut face (block.faceL \xd7 faceW
     minus the area consumed by the selected slabs you packed onto it).
  b. Estimate the leftover depth budget (block.depth minus the layer
     depth your selected slabs already consumed, including kerf).
  c. Scan OTHER OPEN SLABS for any that:
     - share the block's stone (or have stone="any"),
     - quality compatibility holds,
     - their two face dims fit the leftover face area in some orientation,
     - their depth dim fits remaining depth budget.
  d. Pick the BEST candidates per block — at most 2 per block, at most 8
     total across the plan. Prefer slabs that:
     - share the same temple as slabs already on that block (one trip),
     - have small anchor dims (easier to fit — they slot into corners),
     - have the same thickness as one of the layers you already planned
       (no extra kerf cut needed).
  e. Skip a block entirely if leftover face area is < ~25% — not worth
     the planner's time to consider tiny scraps.

Quality of suggestions matters more than quantity. ZERO suggestions is a
valid answer if the assigned blocks are already tightly packed.

═══════════════════════════════════════════════════════════════════
OUTPUT — strict JSON, no markdown fences, no prose outside the JSON
═══════════════════════════════════════════════════════════════════

{
  "strategy": "2–4 sentences. Required content: how many blocks total, average slabs/block, how many SMALL vs MEDIUM vs LARGE vs BEAM blocks used, and which beams (if any) you preserved by escalating only when forced.",
  "assignments": [
    {
      "block_id": "MT-B-040",
      "slab_ids": ["MH-0001", "MH-0002", "MH-0003"],
      "reasoning": "One sentence. Mention the tier and why you picked this block over the next-smaller alternative (e.g. 'MEDIUM 78\\" was smallest fitting the 72\\" anchor; SMALL all under 60\\".')."
    }
  ],
  "unassigned_slab_ids": [],
  "unassigned_reason": "Empty string if all slabs assigned. Otherwise list each unassigned slab and the specific reason (no compatible stone block available, anchor too long, etc.).",
  "suggestions": [
    {
      "slab_id": "MH-0099",
      "block_id": "MT-B-040",
      "reasoning": "One sentence. Cite leftover space on the block and why this slab fills it (e.g. 'leaves ~28\xd716\\" of free face after MH-0001/2/3; this slab is 24\xd714\xd70.5\\" and shares the same 0.5\\" thickness layer — fills without an extra cut.')."
    }
  ]
}

(suggestions[] may be an empty array. If you cannot identify any worthwhile
filler, return suggestions: [] — do NOT invent low-quality suggestions to
hit a count.)`;try{let b=new(await a.A(890298)).default({apiKey:c}),d=await b.messages.create({model:"claude-sonnet-4-5",max_tokens:12288,temperature:.2,messages:[{role:"user",content:o}]}),e=("text"===d.content[0].type?d.content[0].text.trim():"").replace(/^```(?:json)?\n?/i,"").replace(/\n?```$/i,"").trim(),f=e.indexOf("{"),g=e.lastIndexOf("}");return -1!==f&&-1!==g&&(e=e.slice(f,g+1)),JSON.parse(e)}catch(b){let a=b instanceof Error?b.message:"Unknown error";return{assignments:[],unassigned_slab_ids:[],unassigned_reason:"",strategy:"",error:`AI call failed: ${a}`}}}async function l(b){await (0,e.requireAuth)(["developer"]);let c=process.env.ANTHROPIC_API_KEY;if(!c)return{strategy:"",fillerSuggestions:[],procurementSuggestions:[],error:"ANTHROPIC_API_KEY is not set in environment variables."};let{plan:d,unfittableSlabs:f,availableSlabs:g,kerfMm:h}=b;if(0===d.length&&0===f.length)return{strategy:"Nothing to suggest — no planned blocks and no unfittable slabs.",fillerSuggestions:[],procurementSuggestions:[]};let i=0===d.length?"  (no planned blocks — every selected slab was unfittable)":d.map(a=>{let b=a.placed.map(a=>`${a.id} (${a.length_ft}\xd7${a.width_ft}\xd7${a.thickness_ft}″)`).join(", "),c=a.biggest_leftover?`${a.biggest_leftover.length}\xd7${a.biggest_leftover.width}\xd7${a.biggest_leftover.height}″`:"≈0";return`  ${a.block.id} [${a.block.stone}, ${a.block.length_ft}\xd7${a.block.width_ft}\xd7${a.block.height_ft}″, quality:${a.block.quality??"standard"}, ${a.efficiency_pct}% used]
    placed:   ${b||"(none)"}
    leftover: ${c}`}).join("\n"),j=0===f.length?"  (none — every selected slab was placed)":f.map(a=>{let b=Math.max(a.length_ft,a.width_ft);return`  ${a.id}${a.priority?" ⚠PRIORITY":""} [anchor=${b}″]: ${a.temple} | ${a.stone??"any-stone"} | ${a.length_ft}\xd7${a.width_ft}\xd7${a.thickness_ft}″ | ${a.label}${a.quality?` | quality:${a.quality}`:""}`}).join("\n"),k=`You are a procurement advisor for MTCPL, a stone-fabrication company.

The deterministic cut-planning algorithm has just produced a plan from
the user's selection. Some selected slabs may have been UNFITTABLE —
they don't fit any block in current stock. Your job: recommend block
dimensions to procure / source so the company can cut these slabs.

(There used to be a second job — proposing other open slabs to fill
leftover space on planned blocks — but that's now handled by an
in-app deterministic geometry fitter. Don't propose fillers here.)

═══════════════════════════════════════════════════════════════════
INPUT
═══════════════════════════════════════════════════════════════════

Blade kerf: ${h}mm per cut.

PLANNED BLOCKS (${d.length}) — each line shows the block, slabs
already cut from it, and the largest leftover space the engine measured:
${i}

UNFITTABLE SLABS (${f.length}) — slabs the algorithm
could NOT place anywhere in current stock (no compatible block long enough):
${j}

═══════════════════════════════════════════════════════════════════
PROCUREMENT SUGGESTIONS  (your only job)
═══════════════════════════════════════════════════════════════════

NOTE: The "filler suggestions" job (proposing other open slabs to slot
into leftover space on planned blocks) has moved to a deterministic
in-app fitter — fitBlockToFillAction — which runs the same geometry
engine the planner uses. Don't propose fillers here; return an empty
fillerSuggestions array.

Your only job is procurement.

⚠ HARD RULE — STONE MUST MATCH ⚠
Each procurement entry MUST have a "stone" field that matches the
stone of the slabs it claims to unblock. Never put a PinkStone slab in
the unblocks_slab_ids of a WhiteStone procurement entry. Mixed-stone
entries will be silently dropped by the client filter.

If the UNFITTABLE list is empty, return procurementSuggestions: [].
Otherwise:

For each STONE that has unfittable slabs:
  a. Find the largest unfittable slab of that stone (by anchor dim).
  b. Recommend a block size:
     • length ≥ slab.anchor + 4″ (safety margin for kerf + clamp),
     • width  ≥ second slab dim + 2″,
     • height ≥ slab.thickness \xd7 (number of unfittable slabs of similar
       size, capped at 8 layers; min 4″).
  c. Quantity: ceil(total unfittable area of this stone / face area
     of one recommended block). Never less than 1.
  d. List which unfittable slab IDs this would unblock.
  e. If different unfittable slabs of the same stone are wildly
     different in size (e.g. 145″ + 70″), output TWO procurement
     entries — one tall one for the 145″, one shorter one for the 70″.

═══════════════════════════════════════════════════════════════════
OUTPUT — strict JSON, no markdown fences, no prose outside the JSON
═══════════════════════════════════════════════════════════════════

{
  "strategy": "1–3 sentences. Required: number of procurement entries, total slabs unblocked.",
  "fillerSuggestions": [],
  "procurementSuggestions": [
    {
      "stone": "PinkStone",
      "recommended": { "length": 150, "width": 30, "height": 24 },
      "quality": "A",
      "quantity": 1,
      "unblocks_slab_ids": ["MH-0142"],
      "reasoning": "One sentence. Cite the largest unfittable slab and why these dims."
    }
  ]
}

procurementSuggestions may be []. Quality of reasoning matters more than
quantity — DO NOT invent low-quality entries to hit a count. Always
return fillerSuggestions: [] (empty) since fillers are handled elsewhere.`;try{let b=new(await a.A(890298)).default({apiKey:c}),d=await b.messages.create({model:"claude-sonnet-4-5",max_tokens:8192,temperature:.2,messages:[{role:"user",content:k}]}),e=("text"===d.content[0].type?d.content[0].text.trim():"").replace(/^```(?:json)?\n?/i,"").replace(/\n?```$/i,"").trim(),f=e.indexOf("{"),g=e.lastIndexOf("}");-1!==f&&-1!==g&&(e=e.slice(f,g+1));let h=JSON.parse(e);return{strategy:h.strategy??"",fillerSuggestions:Array.isArray(h.fillerSuggestions)?h.fillerSuggestions:[],procurementSuggestions:Array.isArray(h.procurementSuggestions)?h.procurementSuggestions:[]}}catch(b){let a=b instanceof Error?b.message:"Unknown error";return{strategy:"",fillerSuggestions:[],procurementSuggestions:[],error:`AI call failed: ${a}`}}}async function m(b){let{canTransferPlannedSlabs:c}=await a.A(90150),{profile:d}=await (0,e.requireAuth)();if(!c(d))return{strategy:"Not authorised — Fit-to-Fill is restricted to developers, team heads, and the named owners (Naresh / Rajesh).",fillSuggestions:[],expansionSuggestions:[],previews:[],diagnostics:[],error:"Not authorised"};let{plan:f,availableSlabs:g,availableBlocks:h,kerfMm:i}=b,k=i/25.4,l=[],m=[],n=[],o=new Set;function p(a){return{id:a.id,stone:a.stone,yard:a.yard??1,category:"Fresh",length_ft:a.length_ft,width_ft:a.width_ft,height_ft:a.height_ft,status:"available",quality:a.quality}}for(let a of f){let{block:b,placed:c}=a,d=g.filter(a=>!a.stone||a.stone===b.stone),e=d.filter(a=>"B"!==b.quality||"A"!==a.quality);function q(a,c,f){n.push({block_id:b.id,pool_total:g.length,matched_stone:d.length,matched_quality:e.length,fits:a,suggested:c,reason:f})}if(0===e.length){q(0,0,0===d.length?`no other open ${b.stone} slabs in inventory`:`${d.length} ${b.stone} slab(s) in pool but none meet this block's quality (${b.quality??"standard"})`);continue}let f=c.map(a=>({id:a.id,label:a.label,temple:a.temple,stone:b.stone,quality:null,sl:a.length_ft,sw:a.width_ft,sd:a.thickness_ft})),h=e.map(a=>({id:a.id,label:a.label,temple:a.temple,stone:a.stone,quality:a.quality,sl:a.length_ft,sw:a.width_ft,sd:a.thickness_ft})),i=new Set(j(p(b),f,k).allPlaced.map(a=>a.id));if(!f.every(a=>i.has(a.id))){q(0,0,"engine couldn't reproduce the original placement of the existing slabs on this block — geometry rounding edge case");continue}let s=new Set,t=!0;for(let a of c){let b=function(a){if(null==a.z_top||null==a.z_bot)return null;let b=a=>Math.round(1e3*a)/1e3;return`${b(a.z_bot)}|${b(a.z_top)}`}(a);if(null==b){t=!1;break}s.add(b)}let u=t&&1===s.size&&c.length>0,v=new Set(c.map(a=>Math.round(1e3*a.thickness_ft)/1e3)),w=new Set(c.map(a=>a.temple));function r(a,b,c){let d=a=>Math.round(1e3*a)/1e3;return[d(a),d(b),d(c)].sort((a,b)=>a-b).join("|")}let x=new Set(c.map(a=>r(a.length_ft,a.width_ft,a.thickness_ft))),y=b.length_ft*b.width_ft,z=new Map;for(let a of v){let b=c.filter(b=>Math.round(1e3*b.thickness_ft)/1e3===a).reduce((a,b)=>a+b.length_ft*b.width_ft,0);z.set(a,Math.max(0,y-b))}let A=e.map(a=>{let b=0,c=Math.round(1e3*a.thickness_ft)/1e3,d=r(a.length_ft,a.width_ft,a.thickness_ft),e=x.has(d),f=v.has(c),g=w.has(a.temple);if(e&&(b+=150),f?b+=50:u&&(b+=35),g&&(b+=20),f){let a=z.get(c)??0;b+=Math.round(50*(y>0?a/y:0))}return b+=Math.min(a.length_ft*a.width_ft*a.thickness_ft/1e3,15),{c:a,score:b,sharesDims:e,sharesThickness:f,sharesTemple:g}}).sort((a,b)=>b.score-a.score),B=Math.max(b.length_ft,b.width_ft),C=b.height_ft,D=A.filter(({c:a})=>{let b=Math.max(a.length_ft,a.width_ft),c=Math.min(a.length_ft,a.width_ft,a.thickness_ft);return b<=B+.001&&c<=C+.001}),E=[],F=[],G=u,H=new Set(v);for(let a of D.slice(0,250)){if(E.length>=5)break;if(o.has(a.c.id))continue;let c=h.find(b=>b.id===a.c.id);if(!c)continue;let d=Math.round(1e3*c.sd)/1e3,e=!H.has(d);if(e&&!G)continue;let g=new Set(j(p(b),[...f,...E,c],k).allPlaced.map(a=>a.id));f.every(a=>g.has(a.id))&&E.every(a=>g.has(a.id))&&g.has(c.id)&&(E.push(c),F.push(a),H.add(d),e&&(G=!1))}if(0===E.length){q(0,0,0===D.length?`${e.length} compatible candidate(s) but none fit dimensionally — too long or too tall for this block`:`${e.length} compatible candidate(s); tried top ${Math.min(250,D.length)} but none fit alongside the existing slabs without displacing them`);continue}let I=[];for(let a=0;a<E.length;a++){let c=E[a],d=F[a],e=[];d.sharesDims?e.push("exact dim duplicate of an existing slab — fills the same layer perfectly"):d.sharesThickness?e.push(`shares ${c.sd}″ thickness layer (no extra kerf)`):u&&e.push(`adds a ${c.sd}″ layer to this single-layer block (cutter-feasible: 2 layers max)`),d.sharesTemple&&e.push(`same temple (${c.temple})`),e.push(`fits alongside the existing slab(s) on ${b.id}`),l.push({block_id:b.id,slab_id:c.id,score:Math.round(100*d.score)/100,reasoning:e.join(" · ")}),o.add(c.id),I.push(c.id)}if(I.length>0){let a=[...f,...h.filter(a=>I.includes(a.id))],c=j(p(b),a,k);if(c.allPlaced.length>0&&c.orient){let a=c.orient,d=a.faceL,e=a.faceW,f=a.depth,g=d*e*f,h=c.allPlaced.reduce((a,b)=>a+b.pw*b.ph*b.sd,0),i=c.allPlaced.reduce((a,b)=>a+(b.aw*b.ah-b.pw*b.ph)*b.sd,0),j=a=>Math.round(100*a)/100,k=Math.max(0,f-c.depthUsed),l=null;if(k>.05)l={l:j(d),w:j(e),h:j(k)};else for(let a of c.lastSpaces)(!l||a.w*a.h>l.l*l.w)&&(l={l:j(a.w),w:j(a.h),h:j(f)});let n={blk:{id:b.id,stone:b.stone,yard:1,quality:b.quality??null,l:j(d),w:j(e),h:j(f),orient:a.label},placed:c.allPlaced,spaces:c.lastSpaces,ua:j(h),ka:j(i),ba:j(g),eff:g>0?Math.min(99,Math.round(h/g*100)):0,biggest:l};m.push({block_id:b.id,planBlock:n,suggested_slab_ids:I})}}q(E.length,I.length,`${E.length} candidate(s) packed alongside existing slabs; surfaced ${I.length} top suggestion(s)`)}let s=new Set(l.map(a=>a.block_id)).size,t=[];if(l.length>0)t.push(`Found ${l.length} slab${1===l.length?"":"s"} that fit alongside your existing slabs across ${s} of ${f.length} planned block${1===f.length?"":"s"}.`);else if(f.length>0){let a=new Map;for(let b of n)a.set(b.reason,(a.get(b.reason)??0)+1);let b=[...a.entries()].sort((a,b)=>b[1]-a[1])[0];b?t.push(`No fillers found — ${b[0]} (across ${b[1]}/${f.length} planned block${1===f.length?"":"s"}). Expand the diagnostic list below for per-block details.`):t.push("No fillers found.")}return{fillSuggestions:l,expansionSuggestions:[],previews:m,diagnostics:n,strategy:t.join(" ")||"Nothing to suggest."}}function n(a,b){let c=`/planning?err=${encodeURIComponent(a)}`;return b?`${c}&slabs=${encodeURIComponent(b)}`:c}async function o(a){let b=a.get("slab_ids")??"";try{let h,{profile:i}=await (0,e.requireAuth)(["owner","team_head","senior_incharge"]),j=(0,f.createAdminSupabaseClient)(),k=Number(a.get("kerf_mm")),l=a.get("plan_json"),m=a.get("extra_slab_ids"),o=new Set;if("string"==typeof m&&m.length>0)try{let a=JSON.parse(m);Array.isArray(a)&&(o=new Set(a.map(String)))}catch{}"string"==typeof l&&l||(0,c.redirect)(n("Plan payload missing",b));try{h=JSON.parse(l)}catch{(0,c.redirect)(n("Invalid plan data",b))}h.length||(0,c.redirect)(n("No blocks in plan",b));let p=Array.from(new Set(h.map(a=>a.blk.id))),q=Array.from(new Set(h.flatMap(a=>a.placed.map(a=>a.id)))),[{data:r,error:s},{data:t,error:u}]=await Promise.all([j.from("blocks").select("id, status, stone").in("id",p),j.from("slab_requirements").select("id, status, stone").in("id",q)]);s&&(0,c.redirect)(n(s.message,b)),u&&(0,c.redirect)(n(u.message,b));let v=(r??[]).find(a=>"available"!==a.status);v&&(0,c.redirect)(n(`Block ${v.id} is no longer available — refresh and regenerate.`,b));let w=(t??[]).find(a=>"open"!==a.status);w&&(0,c.redirect)(n(`Slab ${w.id} is no longer open — refresh and regenerate.`,b));let x=Object.fromEntries((t??[]).map(a=>[a.id,a.stone])),y=Object.fromEntries((r??[]).map(a=>[a.id,a.stone]));for(let a of h){let d=y[a.blk.id];for(let e of a.placed){let f=x[e.id];f&&d&&f!==d&&(0,c.redirect)(n(`Stone mismatch: slab ${e.id} is ${f} but block ${a.blk.id} is ${d}`,b))}}let z="CUT-"+new Date().toISOString().replace(/[-:TZ.]/g,"").slice(0,12),{data:A,error:B}=await j.from("cut_sessions").insert({session_code:z,kerf_mm:Number.isFinite(k)?k:4,status:"approved",planned_by:i.id,approved_by:i.id,approved_at:new Date().toISOString()}).select("id").single();for(let a of((B||!A)&&(0,c.redirect)(n(B?.message??"Unable to create cut session",b)),h)){let{data:d,error:e}=await j.from("cut_session_blocks").insert({cut_session_id:A.id,block_id:a.blk.id,status:"pending_worker",layout:a,largest_remainder:a.biggest}).select("id").single();(e||!d)&&(0,c.redirect)(n(e?.message??"Unable to create session block",b));let f=await j.from("blocks").update({status:"reserved",updated_by:i.id,updated_at:new Date().toISOString()}).eq("id",a.blk.id).eq("status","available").select("id");for(let e of(f.error&&(0,c.redirect)(n(f.error.message,b)),f.data?.length||(0,c.redirect)(n(`Block ${a.blk.id} was already reserved — refresh and try again.`,b)),a.placed)){let{error:f}=await j.from("cut_session_slabs").insert({cut_session_block_id:d.id,slab_requirement_id:e.id,placed_width_ft:e.pw,placed_height_ft:e.ph,pos_x_ft:e.px,pos_y_ft:e.py,rotated:e.rot,is_filler:o.has(e.id)});f&&(0,c.redirect)(n(f.message,b));let g=await j.from("slab_requirements").update({status:"planned",source_block_id:a.blk.id,stone:a.blk.stone,updated_by:i.id,updated_at:new Date().toISOString()}).eq("id",e.id).eq("status","open").select("id");g.error&&(0,c.redirect)(n(g.error.message,b)),g.data?.length||(0,c.redirect)(n(`Slab ${e.id} was already used — refresh and try again.`,b))}}await (0,g.logAudit)(i.id,"plan_approved","cut_session",A.id,{session_code:z,kerf_mm:k,blocks:p,slabs:q,block_count:p.length,slab_count:q.length}),(0,d.revalidatePath)("/planning"),(0,d.revalidatePath)("/cutting"),(0,d.revalidatePath)("/dashboard"),(0,d.revalidatePath)("/blocks"),(0,d.revalidatePath)("/slabs"),(0,c.redirect)("/cutting")}catch(d){if(null!==d&&"object"==typeof d&&"digest"in d)throw d;let a=d instanceof Error?d.message:"Unexpected error — please try again.";console.error("[approvePlanAction] unhandled error:",d),(0,c.redirect)(n(a,b))}}(0,a.i(713095).ensureServerEntryExports)([k,l,m,o]),(0,b.registerServerReference)(k,"406489817fa68335e1f79d935148b86aaf5b034b5b",null),(0,b.registerServerReference)(l,"40937124de3544075ee21fdf427d5ac9fc240bbd72",null),(0,b.registerServerReference)(m,"40db716700691f8552e0f938fb42e5efb772cae78e",null),(0,b.registerServerReference)(o,"4000168c3a6ef29b9f400da0f09c4f6f0e8bd340d9",null),a.s(["aiSuggestionsAction",0,l,"approvePlanAction",0,o,"fitBlockToFillAction",0,m,"generateAIPlanAction",0,k],26322)}];

//# debugId=85d6035a-9076-01f7-0ebd-ddccc364f8d5
//# sourceMappingURL=src_app_%28app%29_planning_actions_ts_09ft041._.js.map