# 01 · The user and the business

## The user — Daksh

- **Daksh** owns / runs MTCPL alongside his father.
- Communication style: fast, conversational English mixed with Hindi terms (कटना, slabs, etc).
- He's the developer-of-record on the system — uses the `developer` role, has full god-mode access. Treats himself as the product owner.
- He's not a programmer — he describes outcomes, not implementations. ("make this look better", "fix the bug", "add a search bar").
- He uses Vercel + Supabase Pro. Pushes to `main`, Vercel auto-deploys.
- He has people IRL who use the system: his father (owner), Naresh (owner / friend), Rajesh (team_head), CNC supervisors (Vivek, Manthan, Mohit, Alkesh), cutting operators, slab-entry staff.

### Voice / style preferences

- He likes inline code commentary that explains *why* (this codebase has a lot of those — keep that style).
- He likes commit messages that read like product notes, not changelogs.
- He prefers center-peek modals over full-page navigation wherever it makes sense.
- He likes the gold/maroon palette (`var(--gold-dark)` is the brand colour).
- Bilingual UI: Hindi headings + English subtitles for floor staff. Devanagari script.

### What pisses him off

- Silent failures. If a server action errors, surface the error in the toast or inline.
- Schema drift between code and prod (his prod DB doesn't always have the latest migration). Always use `select("*")` over enumerated columns when possible, or guard with `IF NOT EXISTS` in DDL.
- Cards that are too big or too small. He calibrates often — if he says "shrink", actually shrink it.
- Multi-step approval flows when one step would do. He's pushed me to collapse the carving approve → ready-for-dispatch into a single click.

---

## The business — MTCPL

**Maheshwari Temple Construction Pvt Ltd** (per the printed reports). Based in Pindwara, Sirohi (Rajasthan, India). They build stone temples.

### What they make

Custom-cut stone slabs and carved pieces for Hindu temples. Pillars, beams, panels, flooring, decorative carvings. Every piece is destined for a specific temple project (the system tracks this as `slab_requirements.temple` — e.g. "AASTHALAXMI TEMPLE AGROHA", "MAHAKALI TEMPLE AHMEDABAD", "SHRI BABA MASTNATH ROHTAK HARYANA").

### Material flow

```
RAW BLOCK            →  CUT SLABS              →  CARVING            →  DISPATCH
(blocks table)       →  (slab_requirements)    →  (carving_items)    →  (dispatches)
```

1. **Blocks** are bought from quarries. Have stone type (PinkStone / WhiteStone / RedStone / YellowMarble / etc), yard location (1–9), dimensions (L × W × H in inches), grade (A / B), category (Fresh / Reused).

2. **Cutting** — a "cut session" (`cut_sessions`) plans how to slice one or more blocks into slab pieces. The CUTTER (saw operator) executes the plan, marks slabs cut, records remainder pieces, and notes the stock location.

3. **Carving** — slabs that need carving (CNC or manual) are assigned to a vendor (an in-house CNC supervisor, one per `vendors` row). The vendor loads slabs onto specific machines, marks them complete, and the carving head approves.

4. **Dispatch** — approved slabs flow to the dispatch station, get added to a `dispatches` row (with vehicle, driver, challan number), and ship out to the temple site.

### People (roles)

| Role | Who | What they see |
|---|---|---|
| `developer` | Daksh | Everything. God mode. |
| `owner` | Naresh, Daksh's father | Almost everything. Dashboard, blocks, slabs, cutting, carving, dispatch. |
| `team_head` | Rajesh + similar | Cutting + slabs + ready sizes. Daily-ops manager. |
| `carving_head` | dedicated role | Ready Sizes + Carving Jobs + Dispatch. Runs the carving floor. |
| `vendor` | Vivek, Manthan, Mohit (CNC supervisors) | Their own cockpit at `/vendor`. Load/unload their machines, flag maintenance. |
| `cutting_operator` | saw operators | Cutting page only. |
| `block_entry` | yard staff | Add blocks. |
| `slab_entry` | office staff | Add slab requirements. |
| `block_slab_entry` | combined entry role | Both blocks + slabs. |
| `worker` | newly created profile | Pending approval — sees `/pending` only. |

### Specific people Daksh has mentioned

- **Naresh** — co-owner, name-matched in `canTransferPlannedSlabs` for slab claim permissions. Matched by substring in `full_name`.
- **Rajesh** — team_head, but stripped-down dashboard (Block Journey only). Substring-matched as `RAJESH`.
- **Paresh Kumar** — appears as a planner in cut session printouts.
- **CNC supervisors**: Vivek, Manthan, Mohit, Alkesh (the printed reports show all four).
- **Daksh's dad** — the wall TV in his home / office is the audience for the TV-mode carving floor view.

---

## Operating context

- **Languages on the floor**: Hindi (primary spoken / written), English (system + office). Bilingual UI everywhere floor staff touch the system.
- **Time zone**: IST (Asia/Kolkata). Always normalise to IST for date boundaries (most code uses `Date#setHours(0,0,0,0)` for "today" — close enough but technically not IST-perfect; we accept this).
- **Scale**: ~250 blocks, 1500+ slab requirements, 50 CNC machines today, growing to 100. Always design for the bigger end of that range.
- **Connectivity**: floor users are on phones over patchy mobile data. Mobile-first wherever vendors / operators touch the system.
