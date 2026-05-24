/**
 * Server-side tool definitions and handlers for the Ask AI chatbot.
 *
 * Each tool is:
 *   1. A JSON schema Claude sees (`.schema`),
 *   2. A handler that executes against Supabase and returns a plain JSON
 *      string Claude parses as `tool_result.content`.
 *
 * All tools are READ-ONLY. None of them mutate any row. Auth is enforced at
 * the /api/ask-ai route level before any tool can run.
 */

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { runOptimization, type BlockRow, type SlabRow } from "@/lib/planning/packing";
import { facilityOfYard, YARDS_BY_FACILITY, type Facility } from "@/lib/yards";
import { POST_CUT_STATUSES } from "@/lib/slab-statuses";
import {
  buildLineages,
  aggregateLineages,
  type BjBlockRow,
  type BjSlabRow,
  type BjCsbRow,
} from "@/app/(app)/block-journey/build-lineages";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toCFT(cubicInches: number): number {
  return cubicInches / 1728;
}

function istRange(key: "today" | "yesterday" | "this_week" | "this_month") {
  const DAY = 24 * 60 * 60 * 1000;
  const IST = 5.5 * 60 * 60 * 1000;
  const nowMs = Date.now();
  const todayMidnight = Math.floor((nowMs + IST) / DAY) * DAY - IST;
  const weekStart = todayMidnight - 6 * DAY;
  const month = new Date(new Date(nowMs + IST).toISOString());
  const monthStartMs = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1)).getTime() - IST;

  if (key === "today") return { from: new Date(todayMidnight).toISOString(), to: new Date(todayMidnight + DAY).toISOString() };
  if (key === "yesterday") return { from: new Date(todayMidnight - DAY).toISOString(), to: new Date(todayMidnight).toISOString() };
  if (key === "this_week") return { from: new Date(weekStart).toISOString(), to: new Date(todayMidnight + DAY).toISOString() };
  return { from: new Date(monthStartMs).toISOString(), to: new Date(todayMidnight + DAY).toISOString() };
}

/** Build a time window from "N hours ago up to now". Used by
 *  get_user_activity / get_audit_trail when the model passes
 *  hours_ago instead of a day-level range. Clamped to [0.1, 168]
 *  hours so a runaway value can't pull half a year of audit logs. */
function istHoursWindow(hoursAgo: number) {
  const HOUR = 60 * 60 * 1000;
  const clamped = Math.max(0.1, Math.min(168, hoursAgo));
  const now = Date.now();
  return {
    from: new Date(now - clamped * HOUR).toISOString(),
    to: new Date(now).toISOString(),
    hours: clamped,
  };
}

// ─── Tool schemas (what Claude sees) ─────────────────────────────────────────

export const AI_TOOLS = [
  {
    name: "list_temples",
    description:
      "List every temple in the system with its count of open slab requirements. Use this first when the user mentions a temple whose exact spelling or casing you are unsure of.",
    input_schema: {
      type: "object" as const,
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "get_inventory_snapshot",
    description:
      "Current block inventory. Returns counts + total CFT grouped by stone, yard, and facility (MTCPL/RIICO). Use for 'how many blocks do we have' style questions.",
    input_schema: {
      type: "object" as const,
      properties: {
        stone: { type: "string", description: "Filter to a stone type e.g. 'PinkStone'. Omit for all." },
        facility: { type: "string", enum: ["mtcpl", "riico"], description: "Filter to one facility. Omit for both." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_temple_requirements",
    description:
      "Open slab_requirements for a specific temple. Returns total slab count, unique size list, and grouped counts by size. Pass 'all' to get the top 10 temples ranked by open slab count.",
    input_schema: {
      type: "object" as const,
      properties: {
        temple: {
          type: "string",
          description:
            "Temple name (fuzzy-matched — 'umia mata' resolves to 'UMIYA MATAJI TEMPLE AHMEDABAD'). Pass 'all' for the top 10. If the tool returns error.availableTemples, the name didn't resolve — pick one from that list and retry.",
        },
      },
      required: ["temple"],
      additionalProperties: false,
    },
  },
  {
    name: "get_cutting_activity",
    description:
      "Cutting activity in a time window, covering BOTH cutting paths: (1) Planned cuts — sandstone blocks routed through the Plan Generator + cut_session_blocks (has efficiency %). (2) Manual cuts — marble blocks cut via the Manual Cut modal on /blocks (tonnes → 8 CFT/tonne equivalence), plus any sandstone manually cut. Top-level `blocksCut` / `slabsCut` are COMBINED totals across both paths so 'how many blocks cut today' never silently omits marble work. Sub-objects `plannedCutting` and `manualCutting` (with `manualCutting.marble` / `manualCutting.sandstone` breakdown) let you narrate the split. Use this for 'today's cutting report', 'what happened today', 'how many blocks cut this week' — and mention both streams when both are non-zero.",
    input_schema: {
      type: "object" as const,
      properties: {
        range: {
          type: "string",
          enum: ["today", "yesterday", "this_week", "this_month"],
          description: "Time window in IST.",
        },
      },
      required: ["range"],
      additionalProperties: false,
    },
  },
  {
    name: "run_plan_simulation",
    description:
      "Run the real cut-planning algorithm for a temple's open slabs against available blocks in the specified facility. Returns the minimum number of blocks needed and which blocks they are. ALWAYS use this for 'how many blocks do I need' questions — never estimate.",
    input_schema: {
      type: "object" as const,
      properties: {
        temple: {
          type: "string",
          description:
            "Temple name whose open slabs to plan for (fuzzy-matched — partial names like 'umia' or 'mahakali' resolve fine).",
        },
        facility: {
          type: "string",
          enum: ["mtcpl", "riico"],
          description: "Facility whose blocks can be used. Defaults to MTCPL.",
        },
        kerf_mm: { type: "number", description: "Cutter kerf width in mm. Defaults to 6." },
      },
      required: ["temple"],
      additionalProperties: false,
    },
  },
  {
    name: "suggest_blocks_to_buy",
    description:
      "Answers 'how many more blocks do I need to buy to fulfil the remaining slabs?' by simulating the cut-planning algorithm with HYPOTHETICAL blocks sized from historical inventory median. Computes the typical block size vendors supply for this stone (median L/W/H across every block ever logged for this stone + quality), then greedily adds one synthetic block of that size at a time, re-runs the packer, and tracks how coverage climbs. Stops when 95%+ of unmet slabs are placed, or when a round adds zero new placements (remaining slabs are bigger than the typical block and need custom procurement). Trigger phrases: 'kitne blocks khareedne padenge', 'how many blocks to buy', 'block suggestion', 'smart suggestion', 'unmet slabs ke liye blocks', 'if I buy X blocks will I be done'.",
    input_schema: {
      type: "object" as const,
      properties: {
        stone: {
          type: "string",
          description: "Stone type for the analysis (e.g. 'PinkStone', 'WhiteMarble'). Required — each stone has its own typical block size.",
        },
        quality: {
          type: "string",
          enum: ["A", "B"],
          description: "Optional — restrict simulation to one quality grade. Omit to include both A and B.",
        },
        facility: {
          type: "string",
          enum: ["mtcpl", "riico"],
          description: "Facility where new blocks would be placed. Defaults to MTCPL.",
        },
        temple: {
          type: "string",
          description: "Optional — scope unmet slabs to one temple (fuzzy-matched). Omit to consider unmet slabs across all temples.",
        },
      },
      required: ["stone"],
      additionalProperties: false,
    },
  },
  {
    name: "get_watchdog_alerts",
    description:
      "Scan the system for operational issues the user should know about RIGHT NOW: blocks that have been cutting longer than 24 hours, urgent slabs whose deadline has passed, and blocks rejected in the last 48 hours. Use this ONCE at the START of a fresh conversation (first user message) so you can proactively flag anything critical at the end of your reply. Do not call repeatedly within the same chat.",
    input_schema: {
      type: "object" as const,
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "get_live_cutting_status",
    description:
      "Current IN-PROGRESS cutting snapshot (not historical). Returns blocks currently on the machine (status=cutting), blocks approved and waiting to start (status=pending_worker), and blocks cut but awaiting slab recording (status=done_prompt). Use this whenever the user asks 'what's happening right now', 'live status', 'current cutting', 'any blocks on the machine', 'which blocks are in progress', or 'which temple's blocks are being cut now'. Separate from get_cutting_activity (that one counts COMPLETED cuts over a date range).",
    input_schema: {
      type: "object" as const,
      properties: {
        facility: { type: "string", enum: ["mtcpl", "riico"], description: "Filter to one facility. Omit for both." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_user_activity",
    description:
      "Count and summarise what each user has done (added / updated / deleted / cut / approved etc.) in a time range. Use for questions like 'how many blocks did Rajesh add today?', 'who added the most slabs this week?', 'what did the team do today?', 'what happened in the last 2 hours?'. Reads from the audit_logs table + resolves user IDs to names.",
    input_schema: {
      type: "object" as const,
      properties: {
        user_name: { type: "string", description: "Optional — filter to users whose full_name contains this substring (case-insensitive)." },
        action: { type: "string", description: "Optional — filter by action: 'create', 'update', 'delete', 'manual_cut_block', 'cutting_started', 'cutting_undo_approve', 'plan_approved', 'block_rejected', etc. (Carving / dispatch actions are out of scope for this assistant.)" },
        entity_type: {
          type: "string",
          enum: ["block", "slab", "cut_session", "cut_session_block"],
          description: "Optional — filter to one entity type. (carving_item is intentionally not supported — the assistant cannot answer carving/dispatch questions.)",
        },
        range: {
          type: "string",
          enum: ["today", "yesterday", "this_week", "this_month"],
          description: "Day-level time window in IST. Default: today. Ignored when hours_ago is set.",
        },
        hours_ago: {
          type: "number",
          description: "OPTIONAL sub-day window — events from the last N hours up to NOW. Use this for 'last 2 hours', 'last 30 minutes' (pass 0.5), 'last 6 hours' etc. Overrides `range` when both are set. Range: 0.1 to 168 (one week).",
        },
        limit: { type: "number", description: "Max sample events to return alongside the count summary. Default 20, max 50." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "list_users",
    description:
      "List system users with their role, online status (based on last_seen_at), and today's screen-time minutes. Use for 'who is online?', 'what is Rajesh's role?', 'show all operators', 'team list'.",
    input_schema: {
      type: "object" as const,
      properties: {
        role: { type: "string", description: "Optional — filter to one role (owner / team_head / slab_entry / block_entry / block_slab_entry / cutting_operator / developer)." },
        online_only: { type: "boolean", description: "Optional — only users seen in the last 5 minutes." },
        name_contains: { type: "string", description: "Optional — filter users whose name contains this substring." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_audit_trail",
    description:
      "Chronological activity log — every create / update / delete / cutting action across the system in a time window, with user names resolved. Use for 'what happened today?', 'recent activity', 'activity log', 'what happened in the last N hours'. For user-specific counts use get_user_activity instead.",
    input_schema: {
      type: "object" as const,
      properties: {
        range: { type: "string", enum: ["today", "yesterday", "this_week", "this_month"], description: "Day-level window in IST. Default: today. Ignored when hours_ago is set." },
        hours_ago: {
          type: "number",
          description: "OPTIONAL sub-day window — events from the last N hours up to NOW. Use for 'last 2 hours', 'last 30 minutes' (pass 0.5), 'last 6 hours'. Overrides `range` when both are set. Range: 0.1 to 168.",
        },
        limit: { type: "number", description: "Max events to return, newest first. Default 30, max 100." },
        entity_type: {
          type: "string",
          enum: ["block", "slab", "cut_session", "cut_session_block"],
          description: "Optional — filter to one entity type. (carving_item is intentionally out of scope.)",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "list_vendors",
    description:
      "List vendors with their type (CNC / Manual / Outsource) and active status. Use for 'vendor directory', 'how many vendors', 'Outsource vendors list'.",
    input_schema: {
      type: "object" as const,
      properties: {
        type: { type: "string", enum: ["CNC", "Manual", "Outsource"], description: "Filter by vendor type." },
        active_only: { type: "boolean", description: "Only active vendors. Default true." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_block_journey",
    description:
      "Full lifecycle / timeline for a single block — when it was added (and by whom), every cut plan it appeared in, who approved it, who completed the cut, how many slabs were cut, and what remainder pieces got restocked. Use this whenever the user asks about the 'journey', 'history', 'timeline', 'flow', 'story', 'सफर', 'इतिहास' of a specific block id. Returns a chronological event list ready to render as a vertical timeline ([[TIMELINE:...]] marker).",
    input_schema: {
      type: "object" as const,
      properties: {
        block_id: {
          type: "string",
          description: "The block id to trace — e.g. 'MT-B-039' or 'RC-B-012'. Use the exact id as shown in the app.",
        },
      },
      required: ["block_id"],
      additionalProperties: false,
    },
  },
  {
    name: "get_stone_efficiency",
    description:
      "Aggregate REAL efficiency across every Fresh block that has been cut at least once, rolled up across the full descendant tree. Returns BOTH framings side-by-side: yield % (slabs only — conservative, use for pricing) and recovered % (slabs + still-live restocks — optimistic). Filterable by stone / facility / quality / resolved-only. Use when the user asks aggregate questions like 'PinkStone की real efficiency kya hai', 'Grade A waste kitna hua?', 'what's our average yield?', 'कुल waste percentage बताओ'. Same data source that powers the /block-journey page.",
    input_schema: {
      type: "object" as const,
      properties: {
        stone: { type: "string", description: "Filter to a stone type e.g. 'PinkStone'." },
        facility: { type: "string", enum: ["mtcpl", "riico"], description: "Filter by facility." },
        quality: { type: "string", enum: ["A", "B"], description: "Filter by quality grade." },
        resolved_only: {
          type: "boolean",
          description: "If true, only count lineages whose descendants have all finished (no live restocks). Gives the most definitive number for tender pricing. Default false.",
        },
      },
      additionalProperties: false,
    },
  },
  // get_dispatch_status was removed — AI is restricted from answering
  // carving / dispatch questions per business decision. The /carving
  // and /dispatch UIs remain fully functional; the assistant just
  // refuses to surface that data through chat.
  // ── Finance department tools (Mig 028 / 037 / 042 / 043) ──────────
  //
  // The AI can now answer "kitna outstanding hai?", "T-2026-15 ka
  // status kya hai?", "Naresh ka vendor account dikhao", "aaj kya
  // pay karna hai?", "TDS deduct kitna hua year-to-date?".
  // INVOICING is intentionally NOT exposed — Daksh asked to keep
  // invoicing entirely out of scope (it's outgoing customer
  // invoices, a separate workflow).
  {
    name: "get_finance_snapshot",
    description:
      "Finance department headline. Returns total outstanding (sum of every approved bill's amount_outstanding), due-bills count, pending-audit count, pay-today queue size + total, paid-today count + total, lifetime TDS deducted, lifetime TCS collected, and top 3 vendors by outstanding. **Use for any 'finance overview', 'how much do we owe right now', 'kya status hai accounts ka', 'pending kitna hai' question.** Pair with a STATS widget on the way out.",
    input_schema: {
      type: "object" as const,
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "list_due_bills",
    description:
      "List approved bills with amount_outstanding > 0. Default sort: oldest first by bill_date. Each row: token, vendor name, vendor's bill no, bill date, days since bill, amount_total, amount_tax (CGST+SGST+IGST), amount_tds, amount_tcs, amount_outstanding, AND (mig 072) held_amount + held_reason + amount_proposable (= outstanding − held). Use for 'show me due bills', 'overdue bills', '90+ day bills', 'bills for vendor X', 'which bills are on hold', or any 'which bills' / 'kitna pay kar sakte' question. Pass `vendor` for fuzzy vendor match; pass `age_bucket` to filter by aging window (0_30 / 31_60 / 61_90 / 90_plus); pass `token` for a substring token search.",
    input_schema: {
      type: "object" as const,
      properties: {
        vendor: { type: "string", description: "Optional — vendor name (fuzzy-matched against bill_vendors.name)." },
        age_bucket: {
          type: "string",
          enum: ["0_30", "31_60", "61_90", "90_plus"],
          description: "Optional — restrict to bills in this aging bucket (days since bill_date).",
        },
        token: { type: "string", description: "Optional — substring search on the bill token (e.g. '2026-1' matches T-2026-1, T-2026-10, etc.)." },
        limit: { type: "number", description: "Default 25, max 200." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_bill_detail",
    description:
      "Full detail of one bill: identity (token, vendor, bill_no, bill_date, cost_head, description), the complete tax breakdown (subtotal, CGST/SGST/IGST + their amounts, TDS%/TCS% + amounts, bill_total, payable_to_vendor), payment status (amount_paid, amount_outstanding, fully_paid flag), every payment row (proposed / confirmed / paid timestamps + amounts + method + reference), and audit trail (submitted / approved / rejected timestamps + names). **Use for any single-bill question** — 'show T-2026-15', 'iss bill ki details', 'kitne payment hue is bill ke'.",
    input_schema: {
      type: "object" as const,
      properties: {
        token: { type: "string", description: "Bill token (e.g. 'T-2026-15'). Case-insensitive. Either `token` or `id` is required." },
        id: { type: "string", description: "Bill UUID (alternative to token)." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_vendor_finance",
    description:
      "Vendor profile from the finance side. Returns identity (name, GSTIN, PAN, phone, email, address), bank details (bank_name, bank_account, IFSC, UPI ID), payment terms (days after bill date), TDS/TCS applicability flags, lifetime totals (bills count, total billed, paid, outstanding, TDS deducted, TCS collected), and the 10 most recent bills. **Use for 'show me vendor X account', 'X ka account dikhao', 'how much do we owe X', 'X ka TDS kitna deduct hua', 'X ka bank account number'.** Vendor name is fuzzy-matched.",
    input_schema: {
      type: "object" as const,
      properties: {
        vendor: { type: "string", description: "Vendor name (fuzzy-matched against bill_vendors.name). Partial names like 'shree cement' work." },
      },
      required: ["vendor"],
      additionalProperties: false,
    },
  },
  {
    name: "list_bill_vendors",
    description:
      "Master list of bill vendors (suppliers). Returns each vendor's name, category, GSTIN, payment_terms_days, TDS/TCS flags, current outstanding, and bills count. Use for 'list of vendors', 'kitne vendors hain', 'show all TDS-flagged vendors', 'who do we buy cement from'.",
    input_schema: {
      type: "object" as const,
      properties: {
        active_only: { type: "boolean", description: "Default true. Pass false to include archived vendors." },
        name_contains: { type: "string", description: "Optional — case-insensitive substring search on vendor name." },
        tds_only: { type: "boolean", description: "Optional — only vendors flagged tds_applicable=true." },
        tcs_only: { type: "boolean", description: "Optional — only vendors flagged tcs_applicable=true." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_pay_today_status",
    description:
      "Snapshot of the current pay-today queue, grouped by stage: PROPOSED (accountant proposed, awaiting owner confirm), CONFIRMED (owner ticked, accountant ready to mark paid), PAID TODAY (already settled today). Each list carries token, vendor, proposed_amount, age. Use for 'aaj kya pay karna hai', 'pending payments to confirm', 'paid today total', 'pay today status'.",
    input_schema: {
      type: "object" as const,
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "get_finance_activity",
    description:
      "Recent finance audit log (bill_submitted, bill_approved, bill_rejected, payment_proposed, payment_confirmed, payment_paid, payment_cancelled, bill_vendor_created/updated/archived). Use for 'what happened in accounts today', 'who approved which bill', 'recent finance actions', 'accountant ki activity'. Pass `hours_ago` for sub-day windows (e.g. 2 for last 2 hours).",
    input_schema: {
      type: "object" as const,
      properties: {
        range: { type: "string", enum: ["today", "yesterday", "this_week", "this_month"], description: "Day-level window in IST." },
        hours_ago: { type: "number", description: "Sub-day window from now (e.g. 2 = last 2 hours). Overrides range." },
        action: { type: "string", description: "Optional — filter to a specific action like 'payment_paid' or 'bill_approved'." },
        limit: { type: "number", description: "Default 30, max 200." },
      },
      additionalProperties: false,
    },
  },

  // ── Inventory department tools (Mig 041 / 044) ─────────────────────
  //
  // Scaffolding inventory — Standard, Ledger, Transom, Jali. Storekeeper
  // proposes movements (Buy / Issue / Return / Destroyed); Mafat +
  // owner approve. Stock derives from approved movements.
  {
    name: "get_inventory_scaffolding_snapshot",
    description:
      "Scaffolding inventory headline. Returns total stock per component (Standard, Ledger, Transom, Jali, etc.) split between Plant warehouse and project sites. Includes pending movement count (awaiting audit). If `site` is passed, narrows to that one site's holdings. **Use for 'kitna scaffolding hai', 'plant pe kitne standards hain', 'show inventory', 'Site Alpha pe kya hai'.**",
    input_schema: {
      type: "object" as const,
      properties: {
        site: { type: "string", description: "Optional — site code (PLANT, ALPHA, etc.) or fuzzy site name. Omit for global breakdown." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "list_inventory_sites",
    description:
      "List of every site where scaffolding can sit. Returns each site's code, name, manager, address, is_plant flag, is_active flag, started_on, plus the total piece count currently at that site. Use for 'how many sites do we have', 'list project sites', 'site list', 'which sites are active'.",
    input_schema: {
      type: "object" as const,
      properties: {
        active_only: { type: "boolean", description: "Default true. Pass false to include archived sites." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_inventory_movements_recent",
    description:
      "Recent scaffolding stock movements (issue / return / buy / destroyed). Returns batches with type, status (pending_approval / approved / rejected / cancelled), from/to sites, total qty, total component count, proposer name, timestamps. Use for 'recent stock movements', 'what scaffolding moved today', 'kya issue hua last week', 'storekeeper ki activity'. Pass `hours_ago` for sub-day windows.",
    input_schema: {
      type: "object" as const,
      properties: {
        range: { type: "string", enum: ["today", "yesterday", "this_week", "this_month"], description: "Day-level window in IST." },
        hours_ago: { type: "number", description: "Sub-day window (e.g. 2 = last 2 hours). Overrides range." },
        status: {
          type: "string",
          enum: ["pending_approval", "approved", "rejected", "cancelled"],
          description: "Optional — filter to one status. Omit for all.",
        },
        type: {
          type: "string",
          enum: ["issue", "return", "receive", "writeoff"],
          description: "Optional — filter to one movement type. Note 'receive' is the DB enum value; user-facing label is 'Buy'. 'writeoff' is user-facing 'Destroyed'.",
        },
        site: { type: "string", description: "Optional — only batches touching this site (fuzzy match)." },
        limit: { type: "number", description: "Default 25, max 200." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_inventory_audit_queue",
    description:
      "Inventory movement batches awaiting crosscheck / owner approval (status='pending_approval'). Returns each batch with type, from/to sites, total qty, components involved, proposed_by name, age in hours. Use for 'pending inventory audits', 'kya inventory mein audit pending hai', 'how many batches awaiting Mafat'.",
    input_schema: {
      type: "object" as const,
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "list_scaffolding_components",
    description:
      "Master list of scaffolding component types currently in the catalog (Standard, Ledger, Transom, Jali + any custom types added later). Each row: name, component_type, size_spec, unit, current total quantity (across all sites), is_active flag. Use for 'list of scaffolding parts', 'kya components hain', 'find a component by name'.",
    input_schema: {
      type: "object" as const,
      properties: {
        active_only: { type: "boolean", description: "Default true. Pass false to include archived components." },
        name_contains: { type: "string", description: "Optional — case-insensitive substring on the component name." },
      },
      additionalProperties: false,
    },
  },

  {
    name: "list_blocks",
    description:
      "List individual block records with their exact dimensions (L×W×H), CFT, stone, yard, facility, quality, status, and category. Use this whenever the user asks about specific blocks, the biggest/smallest blocks, newest/oldest blocks, blocks in a particular yard, or details of a block by ID. Complements get_inventory_snapshot (which only returns aggregates).",
    input_schema: {
      type: "object" as const,
      properties: {
        stone: { type: "string", description: "Filter to a stone type (e.g. 'PinkStone')." },
        facility: { type: "string", enum: ["mtcpl", "riico"], description: "Filter by facility." },
        yard: { type: "number", description: "Filter to a specific yard number (1-9)." },
        status: {
          type: "string",
          enum: ["available", "reserved", "consumed", "discarded"],
          description: "Filter by block status. Defaults to 'available' if not specified.",
        },
        quality: { type: "string", enum: ["A", "B"], description: "Filter by quality grade." },
        sort_by: {
          type: "string",
          enum: ["volume_desc", "volume_asc", "newest", "oldest"],
          description: "How to sort the result. Default: volume_desc (biggest first).",
        },
        limit: { type: "number", description: "Max blocks to return. Default 20, max 50." },
        id_contains: { type: "string", description: "Substring match on the block id (e.g. '042' matches 'MT-B-042')." },
      },
      additionalProperties: false,
    },
  },
];

// ─── Tool handler dispatcher ─────────────────────────────────────────────────

export async function runTool(name: string, input: Record<string, unknown>): Promise<string> {
  try {
    switch (name) {
      case "list_temples":
        return JSON.stringify(await listTemples());
      case "get_inventory_snapshot":
        return JSON.stringify(await getInventorySnapshot(input));
      case "get_temple_requirements":
        return JSON.stringify(await getTempleRequirements(input));
      case "get_cutting_activity":
        return JSON.stringify(await getCuttingActivity(input));
      case "run_plan_simulation":
        return JSON.stringify(await runPlanSimulation(input));
      case "suggest_blocks_to_buy":
        return JSON.stringify(await suggestBlocksToBuy(input));
      case "list_blocks":
        return JSON.stringify(await listBlocks(input));
      case "get_block_journey":
        return JSON.stringify(await getBlockJourney(input));
      case "get_stone_efficiency":
        return JSON.stringify(await getStoneEfficiency(input));
      case "get_live_cutting_status":
        return JSON.stringify(await getLiveCuttingStatus(input));
      case "get_watchdog_alerts":
        return JSON.stringify(await getWatchdogAlerts());
      case "get_user_activity":
        return JSON.stringify(await getUserActivity(input));
      case "list_users":
        return JSON.stringify(await listUsers(input));
      case "get_audit_trail":
        return JSON.stringify(await getAuditTrail(input));
      case "list_vendors":
        return JSON.stringify(await listVendors(input));
      // Finance
      case "get_finance_snapshot":
        return JSON.stringify(await getFinanceSnapshot());
      case "list_due_bills":
        return JSON.stringify(await listDueBills(input));
      case "get_bill_detail":
        return JSON.stringify(await getBillDetail(input));
      case "get_vendor_finance":
        return JSON.stringify(await getVendorFinance(input));
      case "list_bill_vendors":
        return JSON.stringify(await listBillVendors(input));
      case "get_pay_today_status":
        return JSON.stringify(await getPayTodayStatus());
      case "get_finance_activity":
        return JSON.stringify(await getFinanceActivity(input));
      // Inventory
      case "get_inventory_scaffolding_snapshot":
        return JSON.stringify(await getInventoryScaffoldingSnapshot(input));
      case "list_inventory_sites":
        return JSON.stringify(await listInventorySites(input));
      case "get_inventory_movements_recent":
        return JSON.stringify(await getInventoryMovementsRecent(input));
      case "get_inventory_audit_queue":
        return JSON.stringify(await getInventoryAuditQueue());
      case "list_scaffolding_components":
        return JSON.stringify(await listScaffoldingComponents(input));
      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return JSON.stringify({ error: `Tool failed: ${msg}` });
  }
}

// ─── temple name resolver ────────────────────────────────────────────────────
//
// Users / LLMs rarely type the full canonical temple name.
// e.g. "umia mata" → "UMIYA MATAJI TEMPLE AHMEDABAD"
//      "aasta"    → "AASTHALAXMI TEMPLE AGROHA"
//
// Without this, an .eq("temple", "umia mata") returns zero rows and the
// calling LLM reads that as "all work done" instead of "name didn't match."
// This helper normalises + fuzzy-matches, and returns an explicit error
// (with the full available list) when nothing resolves — so tool output
// never silently looks like "nothing to do here."
async function resolveTempleName(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  input: string
): Promise<
  | { kind: "resolved"; temple: string }
  | { kind: "ambiguous"; candidates: string[] }
  | { kind: "not_found"; available: string[] }
> {
  // Pull every distinct temple that has ever had a slab requirement
  // (any status — otherwise a delivered-only temple wouldn't resolve).
  const { data } = await admin.from("slab_requirements").select("temple");
  const all = [...new Set((data ?? []).map((r) => r.temple).filter(Boolean) as string[])];

  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const needle = norm(input);
  if (!needle) return { kind: "not_found", available: all };

  // 1. Exact case-insensitive match
  const exact = all.find((t) => norm(t) === needle);
  if (exact) return { kind: "resolved", temple: exact };

  // 2. Substring either way — user substring inside temple, or temple inside user text
  let matches = all.filter((t) => {
    const hay = norm(t);
    return hay.includes(needle) || needle.includes(hay);
  });

  // 3. Token-overlap fallback ("umia mata" → "UMIYA MATAJI …"):
  //    if any user token is a substring of any temple token, count it a hit.
  //    This catches "umia" → "umiya", "mata" → "mataji", etc.
  if (matches.length === 0) {
    const userTokens = input.toLowerCase().split(/\s+/).map(norm).filter(Boolean);
    matches = all.filter((t) => {
      const templeTokens = t.toLowerCase().split(/\s+/).map(norm).filter(Boolean);
      return userTokens.some((u) =>
        templeTokens.some((tk) => tk.includes(u) || u.includes(tk))
      );
    });
  }

  if (matches.length === 1) return { kind: "resolved", temple: matches[0] };
  if (matches.length > 1) return { kind: "ambiguous", candidates: matches };
  return { kind: "not_found", available: all };
}

// ─── list_temples ────────────────────────────────────────────────────────────

async function listTemples() {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("slab_requirements")
    .select("temple")
    .in("status", ["open", "planned"]);
  if (error) throw new Error(error.message);

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    if (!row.temple) continue;
    counts.set(row.temple, (counts.get(row.temple) ?? 0) + 1);
  }
  const temples = [...counts.entries()]
    .map(([temple, openSlabCount]) => ({ temple, openSlabCount }))
    .sort((a, b) => b.openSlabCount - a.openSlabCount);
  return { temples, totalTemples: temples.length };
}

// ─── get_inventory_snapshot ──────────────────────────────────────────────────

async function getInventorySnapshot(input: Record<string, unknown>) {
  const admin = createAdminSupabaseClient();
  const stoneFilter = typeof input.stone === "string" ? input.stone : undefined;
  const facilityFilter = input.facility === "mtcpl" || input.facility === "riico" ? (input.facility as Facility) : undefined;

  let query = admin
    .from("blocks")
    .select("id, stone, yard, category, length_ft, width_ft, height_ft, status")
    .in("status", ["available", "reserved"]);
  if (stoneFilter) query = query.eq("stone", stoneFilter);
  if (facilityFilter) query = query.in("yard", YARDS_BY_FACILITY[facilityFilter] as unknown as number[]);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  type Row = { stone: string | null; yard: number; category: string | null; length_ft: number; width_ft: number; height_ft: number; status: string };
  const blocks = (data ?? []) as Row[];

  const byStone: Record<string, { count: number; cft: number }> = {};
  const byYard: Record<string, { count: number; cft: number }> = {};
  const byFacility: Record<Facility, { count: number; cft: number }> = {
    mtcpl: { count: 0, cft: 0 },
    riico: { count: 0, cft: 0 },
  };
  let totalCount = 0;
  let totalCft = 0;
  let availableCount = 0;
  let reservedCount = 0;

  for (const b of blocks) {
    const cft = toCFT(Number(b.length_ft) * Number(b.width_ft) * Number(b.height_ft));
    const stone = b.stone ?? "Unknown";
    byStone[stone] ??= { count: 0, cft: 0 };
    byStone[stone].count++;
    byStone[stone].cft += cft;

    const yardKey = `yard_${b.yard}`;
    byYard[yardKey] ??= { count: 0, cft: 0 };
    byYard[yardKey].count++;
    byYard[yardKey].cft += cft;

    const fac = facilityOfYard(b.yard);
    byFacility[fac].count++;
    byFacility[fac].cft += cft;

    totalCount++;
    totalCft += cft;
    if (b.status === "available") availableCount++;
    else if (b.status === "reserved") reservedCount++;
  }

  // Round CFT values for readability
  const round = (obj: Record<string, { count: number; cft: number }>) =>
    Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, { count: v.count, cft: Number(v.cft.toFixed(2)) }]));

  return {
    total: { count: totalCount, availableCount, reservedCount, cft: Number(totalCft.toFixed(2)) },
    byStone: round(byStone),
    byYard: round(byYard),
    byFacility: {
      mtcpl: { count: byFacility.mtcpl.count, cft: Number(byFacility.mtcpl.cft.toFixed(2)) },
      riico: { count: byFacility.riico.count, cft: Number(byFacility.riico.cft.toFixed(2)) },
    },
    filters: { stone: stoneFilter ?? "all", facility: facilityFilter ?? "all" },
  };
}

// ─── get_temple_requirements ─────────────────────────────────────────────────

async function getTempleRequirements(input: Record<string, unknown>) {
  const temple = typeof input.temple === "string" ? input.temple : "all";
  const admin = createAdminSupabaseClient();

  if (temple === "all") {
    const { data, error } = await admin
      .from("slab_requirements")
      .select("temple")
      .in("status", ["open", "planned"]);
    if (error) throw new Error(error.message);
    const counts = new Map<string, number>();
    for (const r of data ?? []) {
      if (!r.temple) continue;
      counts.set(r.temple, (counts.get(r.temple) ?? 0) + 1);
    }
    const topTemples = [...counts.entries()]
      .map(([temple, count]) => ({ temple, openSlabCount: count }))
      .sort((a, b) => b.openSlabCount - a.openSlabCount)
      .slice(0, 10);
    return { topTemples };
  }

  // Resolve user-provided temple name to its canonical DB form.
  const resolution = await resolveTempleName(admin, temple);
  if (resolution.kind === "not_found") {
    return {
      error: `No temple matches "${temple}". The name might be spelled differently.`,
      availableTemples: resolution.available,
      hint: "Call list_temples to see the canonical names, then retry with one of them.",
    };
  }
  if (resolution.kind === "ambiguous") {
    return {
      ambiguous: true,
      error: `"${temple}" could mean any of ${resolution.candidates.length} temples.`,
      candidates: resolution.candidates,
      hint: "Ask the user which one they meant, or retry with the exact name.",
    };
  }
  const canonicalTemple = resolution.temple;

  const { data, error } = await admin
    .from("slab_requirements")
    .select("id, label, stone, quality, priority, length_ft, width_ft, thickness_ft, status, deadline")
    .eq("temple", canonicalTemple)
    .in("status", ["open", "planned"])
    .order("priority", { ascending: false });
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  // Group by size signature for a compact summary
  const sizeGroups = new Map<string, { count: number; stone: string | null; quality: string | null; priorityCount: number }>();
  let priorityCount = 0;
  for (const r of rows) {
    const key = `${r.length_ft}×${r.width_ft}×${r.thickness_ft}|${r.stone ?? "any"}|${r.quality ?? "any"}`;
    const existing = sizeGroups.get(key);
    if (existing) {
      existing.count++;
      if (r.priority) existing.priorityCount++;
    } else {
      sizeGroups.set(key, { count: 1, stone: r.stone, quality: r.quality, priorityCount: r.priority ? 1 : 0 });
    }
    if (r.priority) priorityCount++;
  }

  const uniqueSizes = [...sizeGroups.entries()].map(([k, v]) => {
    const [dims] = k.split("|");
    return { size: dims + " in", ...v };
  });

  return {
    temple: canonicalTemple,
    resolvedFrom: temple !== canonicalTemple ? temple : undefined,
    openSlabCount: rows.length,
    priorityCount,
    uniqueSizes: uniqueSizes.sort((a, b) => b.count - a.count).slice(0, 20),
    slabs: rows.slice(0, 30).map((r) => ({
      id: r.id,
      label: r.label,
      size: `${r.length_ft} × ${r.width_ft} × ${r.thickness_ft} in`,
      stone: r.stone,
      quality: r.quality,
      priority: r.priority,
      status: r.status,
      deadline: r.deadline,
    })),
    note: rows.length > 30 ? `Showing 30 of ${rows.length} slabs — use uniqueSizes for a compact summary.` : undefined,
  };
}

// ─── get_cutting_activity ────────────────────────────────────────────────────
//
// Covers BOTH cutting paths:
//
//   1. Planned cuts (sandstone, mostly) — flow through cut_session_blocks;
//      we count rows where status='done' in the time window. Has
//      meaningful L×W×H block dims → efficiency % is calculable.
//
//   2. Manual cuts (marble, mostly — but any block can be manually cut) —
//      flow through manualCutBlockAction which emits an audit_log with
//      action='manual_cut_block'. No cut_session_blocks row. Marble
//      blocks have tonnes instead of L×W×H, so we report tonnes + the
//      CFT-equivalent (8 CFT/tonne) alongside slabs produced.
//
// Top-level `blocksCut` / `slabsCut` are COMBINED totals across both
// paths. The `plannedCutting` / `manualCutting` sub-objects let the
// LLM narrate the breakdown ("3 blocks cut today — 2 sandstone via
// plan, 1 marble via manual step").

async function getCuttingActivity(input: Record<string, unknown>) {
  const range = (input.range === "today" || input.range === "yesterday" || input.range === "this_week" || input.range === "this_month")
    ? input.range
    : "today";
  const { from, to } = istRange(range);
  const admin = createAdminSupabaseClient();

  // ── Path 1: Planned cutting (cut_session_blocks) ────────────────────
  const { data: plannedRows, error: plannedErr } = await admin
    .from("cut_session_blocks")
    .select("id, block_id, updated_at, layout")
    .eq("status", "done")
    .gte("updated_at", from)
    .lt("updated_at", to);
  if (plannedErr) throw new Error(plannedErr.message);

  const plannedList = plannedRows ?? [];
  let plannedSlabsCut = 0;
  let plannedSlabCft = 0;
  let plannedBlockCft = 0;

  for (const r of plannedList) {
    const layout = r.layout as { blk?: { l?: number; w?: number; h?: number }; placed?: Array<{ sw?: number; sh?: number; sd?: number }> } | null;
    const placed = layout?.placed ?? [];
    plannedSlabsCut += placed.length;
    for (const s of placed) {
      if (s.sw && s.sh && s.sd) plannedSlabCft += toCFT(s.sw * s.sh * s.sd);
    }
    if (layout?.blk) {
      plannedBlockCft += toCFT((layout.blk.l ?? 0) * (layout.blk.w ?? 0) * (layout.blk.h ?? 0));
    }
  }

  const plannedEfficiencyPct = plannedBlockCft > 0 ? Math.round((plannedSlabCft / plannedBlockCft) * 100) : 0;

  // ── Path 2: Manual cutting (audit_logs) ─────────────────────────────
  // manualCutBlockAction logs with entity_type='block', entity_id=blockId,
  // metadata={ slabs: [slabIds], restocked_blocks, restock }. Join back
  // to blocks for stone + tonnes so we can break down marble vs sandstone.
  const { data: manualAudit } = await admin
    .from("audit_logs")
    .select("entity_id, metadata, created_at")
    .eq("action", "manual_cut_block")
    .gte("created_at", from)
    .lt("created_at", to);

  const manualList = manualAudit ?? [];
  const manualBlockIds = [...new Set(manualList.map((a) => a.entity_id).filter(Boolean))] as string[];
  let manualBlockRows: Array<{ id: string; stone: string | null; tonnes: number | null; length_ft: number | null; width_ft: number | null; height_ft: number | null; category: string | null }> = [];
  if (manualBlockIds.length > 0) {
    const { data } = await admin
      .from("blocks")
      .select("id, stone, tonnes, length_ft, width_ft, height_ft, category")
      .in("id", manualBlockIds);
    manualBlockRows = data ?? [];
  }
  const manualBlockMap = new Map(manualBlockRows.map((b) => [b.id, b] as const));

  // Stone category map so we can split marble vs sandstone in the breakdown
  const { data: stoneTypes } = await admin.from("stone_types").select("name, stone_category");
  const stoneCategoryMap: Record<string, string> = {};
  for (const st of stoneTypes ?? []) {
    stoneCategoryMap[st.name as string] = (st as { stone_category?: string }).stone_category ?? "sandstone";
  }

  let manualSlabsCut = 0;
  let manualBlocksCut = 0;
  let manualMarbleBlocks = 0;
  let manualMarbleSlabs = 0;
  let manualMarbleTonnes = 0;
  let manualSandstoneBlocks = 0;
  let manualSandstoneSlabs = 0;
  let manualSandstoneBlockCft = 0;
  const manualByStone: Record<string, { blocks: number; slabs: number; tonnes?: number; blockCft?: number }> = {};

  for (const a of manualList) {
    manualBlocksCut += 1;
    const meta = a.metadata as { slabs?: string[] } | null;
    const slabCount = Array.isArray(meta?.slabs) ? meta!.slabs.length : 0;
    manualSlabsCut += slabCount;

    const block = manualBlockMap.get(a.entity_id);
    if (!block) continue;
    const stone = block.stone ?? "Unknown";
    const cat = stoneCategoryMap[stone] ?? "sandstone";

    if (!manualByStone[stone]) manualByStone[stone] = { blocks: 0, slabs: 0 };
    manualByStone[stone].blocks += 1;
    manualByStone[stone].slabs += slabCount;

    if (cat === "marble") {
      manualMarbleBlocks += 1;
      manualMarbleSlabs += slabCount;
      const t = Number(block.tonnes ?? 0);
      if (t > 0) {
        manualMarbleTonnes += t;
        manualByStone[stone].tonnes = (manualByStone[stone].tonnes ?? 0) + t;
      }
    } else {
      manualSandstoneBlocks += 1;
      manualSandstoneSlabs += slabCount;
      const blockCft = toCFT((Number(block.length_ft) || 0) * (Number(block.width_ft) || 0) * (Number(block.height_ft) || 0));
      if (blockCft > 0) {
        manualSandstoneBlockCft += blockCft;
        manualByStone[stone].blockCft = (manualByStone[stone].blockCft ?? 0) + blockCft;
      }
    }
  }

  // 8 CFT/tonne marble equivalence (matches cftEquivFromTonnes in
  // src/lib/stone-categories.ts). Inlined here to keep the tool file
  // self-contained.
  const manualMarbleCftEquiv = manualMarbleTonnes * 8;

  return {
    range,
    from,
    to,

    // COMBINED TOTALS — what "how many blocks/slabs were cut" really means.
    // These sum BOTH the planned (cut_session_blocks) and manual
    // (audit-logged) cutting paths so no marble work gets silently omitted.
    blocksCut: plannedList.length + manualBlocksCut,
    slabsCut: plannedSlabsCut + manualSlabsCut,

    // Sandstone-style efficiency — only computed on the planned-cutting
    // side since that's the only path with real block L×W×H vs slab
    // volumes. Manual sandstone cuts also contribute block CFT, but
    // without a per-cut slab-dims layout we can't re-derive efficiency
    // from audit meta alone. Leave that unsplit.
    plannedCutting: {
      blocksCut: plannedList.length,
      slabsCut: plannedSlabsCut,
      totalSlabCft: Number(plannedSlabCft.toFixed(2)),
      totalBlockCft: Number(plannedBlockCft.toFixed(2)),
      efficiencyPct: plannedEfficiencyPct,
      wasteCft: Number(Math.max(0, plannedBlockCft - plannedSlabCft).toFixed(2)),
    },

    manualCutting: {
      blocksCut: manualBlocksCut,
      slabsCut: manualSlabsCut,
      marble: {
        blocksCut: manualMarbleBlocks,
        slabsCut: manualMarbleSlabs,
        totalTonnes: Number(manualMarbleTonnes.toFixed(3)),
        cftEquiv: Number(manualMarbleCftEquiv.toFixed(2)),
      },
      sandstone: {
        blocksCut: manualSandstoneBlocks,
        slabsCut: manualSandstoneSlabs,
        totalBlockCft: Number(manualSandstoneBlockCft.toFixed(2)),
      },
      byStone: Object.fromEntries(
        Object.entries(manualByStone).map(([stone, v]) => [
          stone,
          {
            blocks: v.blocks,
            slabs: v.slabs,
            tonnes: v.tonnes != null ? Number(v.tonnes.toFixed(3)) : undefined,
            blockCft: v.blockCft != null ? Number(v.blockCft.toFixed(2)) : undefined,
          },
        ])
      ),
    },

    // Legacy top-level fields — kept for any callers expecting the old
    // shape. Now represent COMBINED totals, same as blocksCut/slabsCut above.
    totalSlabCft: Number(plannedSlabCft.toFixed(2)),
    totalBlockCft: Number(plannedBlockCft.toFixed(2)),
    efficiencyPct: plannedEfficiencyPct,
    wasteCft: Number(Math.max(0, plannedBlockCft - plannedSlabCft).toFixed(2)),
  };
}

// ─── run_plan_simulation ─────────────────────────────────────────────────────

async function runPlanSimulation(input: Record<string, unknown>) {
  const temple = typeof input.temple === "string" ? input.temple : "";
  const facility: Facility = input.facility === "riico" ? "riico" : "mtcpl";
  const kerfMm = typeof input.kerf_mm === "number" ? input.kerf_mm : 6;

  if (!temple || temple === "all") {
    return { error: "Specify an exact temple name. Use list_temples to see options." };
  }

  const admin = createAdminSupabaseClient();

  // Resolve user-provided temple name to its canonical DB form.
  const resolution = await resolveTempleName(admin, temple);
  if (resolution.kind === "not_found") {
    return {
      error: `No temple matches "${temple}".`,
      availableTemples: resolution.available,
      hint: "Call list_temples to see the canonical names, then retry.",
    };
  }
  if (resolution.kind === "ambiguous") {
    return {
      ambiguous: true,
      error: `"${temple}" could mean any of ${resolution.candidates.length} temples.`,
      candidates: resolution.candidates,
      hint: "Ask the user to clarify.",
    };
  }
  const canonicalTemple = resolution.temple;

  // Fetch open slab_requirements for this temple
  const slabsRes = await admin
    .from("slab_requirements")
    .select("id, label, temple, stone, length_ft, width_ft, thickness_ft, status, quality, priority")
    .eq("temple", canonicalTemple)
    .in("status", ["open", "planned"]);
  if (slabsRes.error) throw new Error(slabsRes.error.message);

  const slabs = (slabsRes.data ?? []) as SlabRow[];
  if (slabs.length === 0) {
    return {
      temple: canonicalTemple,
      openSlabCount: 0,
      message: `Temple "${canonicalTemple}" currently has no open or planned slab requirements. All its work is either completed or dispatched.`,
    };
  }

  // Fetch available blocks in the facility
  const yardList = YARDS_BY_FACILITY[facility] as unknown as number[];
  const blocksRes = await admin
    .from("blocks")
    .select("id, stone, yard, category, length_ft, width_ft, height_ft, status, quality")
    .in("status", ["available", "reserved"])
    .in("yard", yardList);
  if (blocksRes.error) throw new Error(blocksRes.error.message);

  const blocks = (blocksRes.data ?? []) as BlockRow[];
  if (blocks.length === 0) {
    return { error: `No available blocks in facility ${facility.toUpperCase()}.` };
  }

  // Run the real algorithm
  const result = runOptimization(blocks, slabs, kerfMm);

  return {
    temple: canonicalTemple,
    resolvedFrom: temple !== canonicalTemple ? temple : undefined,
    facility,
    kerfMm,
    blocksNeeded: result.plan.length,
    blockIds: result.plan.map((p) => p.blk.id),
    slabsPlaced: result.plan.reduce((sum, p) => sum + p.placed.length, 0),
    totalSlabsRequested: slabs.length,
    unmetSlabCount: result.unmet.length,
    unmetSlabIds: result.unmet.slice(0, 10).map((u) => u.id),
    avgEfficiencyPct: result.plan.length > 0
      ? Math.round(result.plan.reduce((sum, p) => sum + p.eff, 0) / result.plan.length)
      : 0,
    totalWasteCuFt: Number(toCFT(result.totalWaste).toFixed(2)),
    planSummary: result.plan.slice(0, 10).map((p) => ({
      blockId: p.blk.id,
      blockSize: `${p.blk.l} × ${p.blk.w} × ${p.blk.h} in`,
      stone: p.blk.stone,
      slabsPlacedHere: p.placed.length,
      efficiencyPct: p.eff,
      hasRestockableRemainder: !!p.biggest,
    })),
  };
}

// ─── suggest_blocks_to_buy ───────────────────────────────────────────────────
// Unlike run_plan_simulation (which only works with real DB blocks), this
// tool simulates procurement: "if I bought N more blocks of the typical
// size we usually get, would all the open slabs fit?" Median historical
// block dims drive the hypothetical size. Greedy add-one-at-a-time loop
// re-runs the packer each round and stops when coverage stabilises or
// hits 95%. Remaining-too-large slabs are flagged separately so the user
// knows which ones need oversized custom blocks vs ordinary stock.

async function suggestBlocksToBuy(input: Record<string, unknown>) {
  const stone = typeof input.stone === "string" ? input.stone : "";
  const quality = input.quality === "A" || input.quality === "B" ? (input.quality as "A" | "B") : undefined;
  const facility: Facility = input.facility === "riico" ? "riico" : "mtcpl";
  const rawTempleFilter = typeof input.temple === "string" ? input.temple : undefined;
  const KERF_MM = 6;
  const MAX_HYPOTHETICAL = 30;
  const COVERAGE_TARGET = 0.95;

  if (!stone) {
    return { error: "Specify a stone (e.g. PinkStone, WhiteMarble)." };
  }

  const admin = createAdminSupabaseClient();

  // Optional temple filter — reuses the fuzzy resolver so 'umia mata'
  // becomes 'UMIYA MATAJI TEMPLE AHMEDABAD' automatically.
  let templeFilter: string | undefined = undefined;
  if (rawTempleFilter) {
    const resolution = await resolveTempleName(admin, rawTempleFilter);
    if (resolution.kind === "not_found") {
      return {
        error: `No temple matches "${rawTempleFilter}".`,
        availableTemples: resolution.available,
      };
    }
    if (resolution.kind === "ambiguous") {
      return {
        ambiguous: true,
        error: `"${rawTempleFilter}" could mean any of ${resolution.candidates.length} temples.`,
        candidates: resolution.candidates,
      };
    }
    templeFilter = resolution.temple;
  }

  // ── 1. Fetch the slab set we're trying to cover ────────────────────
  let slabQ = admin
    .from("slab_requirements")
    .select("id, label, temple, stone, length_ft, width_ft, thickness_ft, status, quality, priority")
    .in("status", ["open", "planned"])
    .eq("stone", stone);
  if (quality) slabQ = slabQ.eq("quality", quality);
  if (templeFilter) slabQ = slabQ.eq("temple", templeFilter);

  const slabsRes = await slabQ;
  if (slabsRes.error) throw new Error(slabsRes.error.message);
  const slabs = (slabsRes.data ?? []) as SlabRow[];

  if (slabs.length === 0) {
    return {
      stone,
      quality: quality ?? "any",
      facility,
      temple: templeFilter ?? "all",
      message: "No open or planned slabs found for this stone/quality/temple. Nothing to buy blocks for.",
    };
  }

  // ── 2. Current live inventory for the starting simulation ──────────
  const yardList = YARDS_BY_FACILITY[facility] as unknown as number[];
  let invQ = admin
    .from("blocks")
    .select("id, stone, yard, category, length_ft, width_ft, height_ft, status, quality")
    .eq("stone", stone)
    .in("status", ["available", "reserved"])
    .in("yard", yardList);
  if (quality) invQ = invQ.eq("quality", quality);
  const invRes = await invQ;
  if (invRes.error) throw new Error(invRes.error.message);
  const currentBlocks = (invRes.data ?? []) as BlockRow[];

  // ── 3. Historical dims for the typical-block calculation ───────────
  // Median of every block ever logged for this stone — available,
  // reserved, consumed, discarded. This is what the vendor tends to
  // send you, so it's the most honest baseline for "if I order more
  // blocks, what size will they actually show up as."
  const { data: histRows, error: histErr } = await admin
    .from("blocks")
    .select("length_ft, width_ft, height_ft, quality")
    .eq("stone", stone);
  if (histErr) throw new Error(histErr.message);
  const histBlocks = (histRows ?? []).filter((b) => !quality || b.quality === quality);

  if (histBlocks.length === 0) {
    return {
      error: `No historical blocks for stone "${stone}"${quality ? ` grade ${quality}` : ""}. Cannot compute a typical block size without precedent.`,
      suggestion: "Log at least a few blocks of this stone first, then retry.",
    };
  }

  const median = (arr: number[]): number => {
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  const medL = median(histBlocks.map((b) => Number(b.length_ft)));
  const medW = median(histBlocks.map((b) => Number(b.width_ft)));
  const medH = median(histBlocks.map((b) => Number(b.height_ft)));
  // Round to whole inches — procurement dims don't need decimals
  const typicalL = Math.round(medL);
  const typicalW = Math.round(medW);
  const typicalH = Math.round(medH);
  const typicalCft = Number(((typicalL * typicalW * typicalH) / 1728).toFixed(2));

  // ── 4. Baseline: run the packer against CURRENT inventory alone ────
  const baseline = runOptimization(currentBlocks, slabs, KERF_MM);
  const baselinePlaced = baseline.plan.reduce((sum, p) => sum + p.placed.length, 0);
  const baselineUnmet = baseline.unmet.length;

  if (baselineUnmet === 0) {
    return {
      stone,
      quality: quality ?? "any",
      facility,
      temple: templeFilter ?? "all",
      totalSlabs: slabs.length,
      currentInventoryBlocks: currentBlocks.length,
      message: `Current inventory of ${currentBlocks.length} ${stone} block${currentBlocks.length !== 1 ? "s" : ""} already covers every open slab. No new blocks needed.`,
      typicalBlockSize: { length_ft: typicalL, width_ft: typicalW, height_ft: typicalH, cft: typicalCft, basedOnBlocks: histBlocks.length },
    };
  }

  // ── 5. Greedy hypothetical-block loop ──────────────────────────────
  // Each iteration adds ONE synthetic block of typical size and re-runs.
  // Stop when we've covered 95% or a round adds no new placements.
  const workingBlocks: BlockRow[] = [...currentBlocks];
  const trace: Array<{
    blocksAdded: number;
    cumulativePlaced: number;
    newThisRound: number;
    remainingUnmet: number;
    cumulativeEffPct: number;
  }> = [];
  let lastPlaced = baselinePlaced;
  let converged = false;

  for (let i = 1; i <= MAX_HYPOTHETICAL; i++) {
    workingBlocks.push({
      id: `HYPOTHETICAL-${i}`,
      stone,
      yard: yardList[0],
      category: "Fresh",
      length_ft: typicalL,
      width_ft: typicalW,
      height_ft: typicalH,
      status: "available",
      quality: quality ?? "A",
    });

    const res = runOptimization(workingBlocks, slabs, KERF_MM);
    const placed = res.plan.reduce((sum, p) => sum + p.placed.length, 0);
    const newThisRound = placed - lastPlaced;
    const cumEffPct = res.plan.length > 0
      ? Math.round(res.plan.reduce((s, p) => s + p.eff, 0) / res.plan.length)
      : 0;

    trace.push({
      blocksAdded: i,
      cumulativePlaced: placed,
      newThisRound,
      remainingUnmet: res.unmet.length,
      cumulativeEffPct: cumEffPct,
    });

    if (res.unmet.length === 0 || placed / slabs.length >= COVERAGE_TARGET) {
      converged = true;
      break;
    }
    if (newThisRound === 0) {
      // Adding another typical block buys zero new slabs — remaining
      // slabs exceed typical block size on some axis, nothing more to do.
      break;
    }
    lastPlaced = placed;
  }

  const final = trace[trace.length - 1];
  const newSlabsCovered = final.cumulativePlaced - baselinePlaced;

  // Sweet spot = first block where marginal value drops off or coverage
  // reaches 90%. This is what the interactive slider defaults to so the
  // user lands on a sensible recommendation before dragging.
  const sweetSpotIdx = (() => {
    for (let i = 0; i < trace.length; i++) {
      const t = trace[i];
      if (t.cumulativePlaced / slabs.length >= 0.9) return i + 1;
      if (i > 0 && t.newThisRound <= 1) return i; // the PREVIOUS block was the last high-value buy
    }
    return trace.length;
  })();

  // ── 6. Flag slabs too big for the typical block ────────────────────
  // Compare slab L×W (rotation allowed) and thickness vs typical block
  // L×W×H. Anything that won't fit even in isolation needs a bigger block.
  const tooLarge = slabs.filter((s) => {
    const sL = Number(s.length_ft);
    const sW = Number(s.width_ft);
    const sT = Number(s.thickness_ft);
    const fitsFlat = Math.max(sL, sW) <= Math.max(typicalL, typicalW) && Math.min(sL, sW) <= Math.min(typicalL, typicalW);
    const fitsThickness = sT <= typicalH;
    return !(fitsFlat && fitsThickness);
  });

  return {
    stone,
    quality: quality ?? "any",
    facility,
    temple: templeFilter ?? "all",
    resolvedTempleFrom: rawTempleFilter && rawTempleFilter !== templeFilter ? rawTempleFilter : undefined,

    totalSlabsConsidered: slabs.length,
    currentInventoryBlocks: currentBlocks.length,
    coveredByCurrentInventory: baselinePlaced,
    unmetAfterCurrentInventory: baselineUnmet,

    typicalBlockSize: {
      length_ft: typicalL,
      width_ft: typicalW,
      height_ft: typicalH,
      cft: typicalCft,
      basedOnBlocks: histBlocks.length,
      note: `Median of all ${histBlocks.length} ${stone}${quality ? ` grade-${quality}` : ""} blocks ever logged — what your vendors typically supply.`,
    },

    recommendation: {
      blocksToBuy: trace.length,
      totalCftToBuy: Number((trace.length * typicalCft).toFixed(2)),
      newSlabsCovered,
      finalUnmet: final.remainingUnmet,
      avgEfficiencyPct: final.cumulativeEffPct,
      converged,
      summary: converged
        ? `Buy ${trace.length} typical block${trace.length !== 1 ? "s" : ""} (~${typicalL}×${typicalW}×${typicalH} in, ${typicalCft} CFT each) → covers ${final.cumulativePlaced}/${slabs.length} slabs at ${final.cumulativeEffPct}% avg efficiency.`
        : `Adding ${trace.length} typical blocks takes us from ${baselinePlaced} to ${final.cumulativePlaced}/${slabs.length} placed. The remaining ${final.remainingUnmet} slab${final.remainingUnmet !== 1 ? "s" : ""} won't fit in a typical block — see slabsTooLargeForTypicalBlock.`,
    },

    iterationTrace: trace,

    /**
     * Widget payload — drop this into a [[PROCUREMENT:...]] marker to
     * render the interactive slider chart in the chat panel.
     */
    widget: {
      stone,
      quality: quality ?? undefined,
      temple: templeFilter ?? undefined,
      totalSlabs: slabs.length,
      baselineCovered: baselinePlaced,
      typicalBlock: {
        l: typicalL,
        w: typicalW,
        h: typicalH,
        cft: typicalCft,
        basedOnBlocks: histBlocks.length,
      },
      trace: trace.map((t) => ({
        blocks: t.blocksAdded,
        placed: t.cumulativePlaced,
        newlyPlaced: t.newThisRound,
        unmet: t.remainingUnmet,
        effPct: t.cumulativeEffPct,
      })),
      sweetSpot: sweetSpotIdx,
      tooLargeCount: tooLarge.length,
      converged,
    },

    slabsTooLargeForTypicalBlock: tooLarge.slice(0, 20).map((s) => ({
      id: s.id,
      label: s.label,
      dimensions: `${s.length_ft} × ${s.width_ft} × ${s.thickness_ft} in`,
      reason:
        Number(s.thickness_ft) > typicalH
          ? `thickness ${s.thickness_ft} > typical height ${typicalH}`
          : `footprint ${s.length_ft}×${s.width_ft} exceeds ${typicalL}×${typicalW}`,
    })),
    slabsTooLargeCount: tooLarge.length,

    limits: {
      maxHypotheticalBlocksEvaluated: MAX_HYPOTHETICAL,
      coverageTargetPct: Math.round(COVERAGE_TARGET * 100),
      kerfMm: KERF_MM,
    },
  };
}

// ─── list_blocks ─────────────────────────────────────────────────────────────

async function listBlocks(input: Record<string, unknown>) {
  const admin = createAdminSupabaseClient();

  const stone = typeof input.stone === "string" ? input.stone : undefined;
  const facility = input.facility === "mtcpl" || input.facility === "riico" ? (input.facility as Facility) : undefined;
  const yard = typeof input.yard === "number" ? input.yard : undefined;
  const status = typeof input.status === "string" ? input.status : "available"; // default: only in-yard stock
  const quality = input.quality === "A" || input.quality === "B" ? input.quality : undefined;
  const idContains = typeof input.id_contains === "string" ? input.id_contains : undefined;
  const sortBy = (typeof input.sort_by === "string" && ["volume_desc", "volume_asc", "newest", "oldest"].includes(input.sort_by))
    ? (input.sort_by as "volume_desc" | "volume_asc" | "newest" | "oldest")
    : "volume_desc";
  const rawLimit = typeof input.limit === "number" ? input.limit : 20;
  const limit = Math.max(1, Math.min(50, rawLimit));

  let query = admin
    .from("blocks")
    .select("id, stone, yard, category, length_ft, width_ft, height_ft, status, quality, created_at, updated_at");

  if (stone) query = query.eq("stone", stone);
  if (typeof yard === "number") query = query.eq("yard", yard);
  if (quality) query = query.eq("quality", quality);
  if (idContains) query = query.ilike("id", `%${idContains}%`);
  if (facility) query = query.in("yard", YARDS_BY_FACILITY[facility] as unknown as number[]);
  // status: accept "any" to opt out of the default available-only filter
  if (status && status !== "any") query = query.eq("status", status);

  // For volume sorts we need to compute CFT per row, so fetch a generous
  // slice and sort in JS. For recency sorts we can use the DB index.
  if (sortBy === "newest") query = query.order("created_at", { ascending: false }).limit(limit);
  else if (sortBy === "oldest") query = query.order("created_at", { ascending: true }).limit(limit);
  else query = query.order("created_at", { ascending: false }).limit(200);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  type Row = {
    id: string;
    stone: string | null;
    yard: number;
    category: string | null;
    length_ft: number;
    width_ft: number;
    height_ft: number;
    status: string;
    quality: string | null;
    created_at: string | null;
    updated_at: string | null;
  };

  const rows = (data ?? []) as Row[];

  let shaped = rows.map((b) => {
    const L = Number(b.length_ft);
    const W = Number(b.width_ft);
    const H = Number(b.height_ft);
    const cft = toCFT(L * W * H);
    return {
      id: b.id,
      dimensions: `${L} × ${W} × ${H} in`,
      cft: Number(cft.toFixed(2)),
      stone: b.stone,
      yard: b.yard,
      facility: facilityOfYard(b.yard),
      status: b.status,
      category: b.category,
      quality: b.quality,
      addedAt: b.created_at,
    };
  });

  if (sortBy === "volume_desc") shaped.sort((a, b) => b.cft - a.cft);
  else if (sortBy === "volume_asc") shaped.sort((a, b) => a.cft - b.cft);

  shaped = shaped.slice(0, limit);

  return {
    count: shaped.length,
    totalCft: Number(shaped.reduce((sum, b) => sum + b.cft, 0).toFixed(2)),
    filters: { stone: stone ?? "any", facility: facility ?? "any", yard: yard ?? "any", status, quality: quality ?? "any", sortBy, idContains: idContains ?? null },
    blocks: shaped,
    note: rows.length === 200 && (sortBy === "volume_desc" || sortBy === "volume_asc")
      ? "More than 200 matches exist — volume-sorted result is approximate across the most-recent 200."
      : undefined,
  };
}

// ─── get_live_cutting_status ─────────────────────────────────────────────────

async function getLiveCuttingStatus(input: Record<string, unknown>) {
  const admin = createAdminSupabaseClient();
  const facilityFilter = input.facility === "mtcpl" || input.facility === "riico"
    ? (input.facility as Facility)
    : undefined;

  const { data, error } = await admin
    .from("cut_session_blocks")
    .select(
      "id, block_id, status, updated_at, layout, cut_sessions(session_code, planned_by)",
    )
    .in("status", ["pending_worker", "cutting", "done_prompt"])
    .order("updated_at", { ascending: true });
  if (error) throw new Error(error.message);

  type Row = {
    id: string;
    block_id: string;
    status: "pending_worker" | "cutting" | "done_prompt";
    updated_at: string;
    layout: { blk?: { stone?: string; yard?: number; l?: number; w?: number; h?: number }; placed?: Array<{ sw?: number; sh?: number; sd?: number }> } | null;
    cut_sessions: { session_code: string | null } | null;
  };
  const rows = (data ?? []) as unknown as Row[];

  // Optional facility filter via layout.blk.yard (facility is derived)
  const filtered = facilityFilter
    ? rows.filter((r) => {
        const y = r.layout?.blk?.yard;
        return typeof y === "number" && facilityOfYard(y) === facilityFilter;
      })
    : rows;

  const byStatus = { pending_worker: 0, cutting: 0, done_prompt: 0 };
  const live: Array<{ blockId: string; sessionCode: string | null; stone: string | null; yard: number | null; facility: Facility; dimensions: string; slabCount: number; elapsedMinutes: number }> = [];
  const pending: Array<{ blockId: string; sessionCode: string | null; stone: string | null; yard: number | null; facility: Facility; waitingMinutes: number }> = [];
  const donePrompt: Array<{ blockId: string; sessionCode: string | null; stone: string | null; yard: number | null; facility: Facility; waitingMinutes: number }> = [];

  const now = Date.now();

  for (const r of filtered) {
    byStatus[r.status]++;

    const blk = r.layout?.blk;
    const yard = typeof blk?.yard === "number" ? blk.yard : null;
    const fac = yard != null ? facilityOfYard(yard) : "mtcpl";
    const elapsedMinutes = Math.max(0, Math.floor((now - new Date(r.updated_at).getTime()) / 60000));
    const slabCount = (r.layout?.placed ?? []).length;
    const sessionCode = r.cut_sessions?.session_code ?? null;
    const dimensions = blk && blk.l != null ? `${blk.l} × ${blk.w} × ${blk.h} in` : "";

    if (r.status === "cutting") {
      live.push({ blockId: r.block_id, sessionCode, stone: blk?.stone ?? null, yard, facility: fac, dimensions, slabCount, elapsedMinutes });
    } else if (r.status === "pending_worker") {
      pending.push({ blockId: r.block_id, sessionCode, stone: blk?.stone ?? null, yard, facility: fac, waitingMinutes: elapsedMinutes });
    } else if (r.status === "done_prompt") {
      donePrompt.push({ blockId: r.block_id, sessionCode, stone: blk?.stone ?? null, yard, facility: fac, waitingMinutes: elapsedMinutes });
    }
  }

  // Disambiguated counts so the AI can't accidentally narrate
  // "78 blocks cutting" when 77 of them are actually approved-but-not-started.
  // ONLY `activelyCutting` means a saw is running. pending_worker = waiting,
  // done_prompt = saw finished, slab record pending. Use the right one.
  const activelyCutting = byStatus.cutting;
  const approvedWaiting = byStatus.pending_worker;
  const awaitingSlabRecord = byStatus.done_prompt;
  const onTheFloorRightNow = activelyCutting + awaitingSlabRecord; // "in cutting" lifecycle
  const totalInPipeline = filtered.length;

  const summaryParts: string[] = [];
  summaryParts.push(`${activelyCutting} block${activelyCutting === 1 ? "" : "s"} actively cutting (saw running)`);
  summaryParts.push(`${approvedWaiting} approved & waiting to start (NOT yet cutting)`);
  summaryParts.push(`${awaitingSlabRecord} cut, awaiting slab record`);

  return {
    // Disambiguated counts — prefer these in narration over `total*`.
    activelyCutting,
    approvedWaiting,
    awaitingSlabRecord,
    onTheFloorRightNow,
    totalInPipeline,
    breakdown: byStatus,
    summary: summaryParts.join(" · "),
    narrationGuide:
      "When the user asks how many blocks are cutting NOW, use `activelyCutting` (saw running) — NOT `totalInPipeline` and NOT `approvedWaiting`. Approved-but-not-started blocks are queued, not cutting.",
    filters: { facility: facilityFilter ?? "any" },
    liveBlocks: live.slice(0, 30),
    pendingBlocks: pending.slice(0, 30),
    donePromptBlocks: donePrompt.slice(0, 30),
  };
}

// ─── get_watchdog_alerts ─────────────────────────────────────────────────────

async function getWatchdogAlerts() {
  const admin = createAdminSupabaseClient();
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
  const twoDaysAgo = new Date(now.getTime() - 48 * 3600 * 1000).toISOString();
  const nowIso = now.toISOString();

  const [longCutsRes, overdueRes, rejectedRes] = await Promise.all([
    admin
      .from("cut_session_blocks")
      .select("id, block_id, updated_at")
      .eq("status", "cutting")
      .lt("updated_at", dayAgo)
      .order("updated_at", { ascending: true }),
    admin
      .from("slab_requirements")
      .select("id, temple, label, deadline")
      .eq("priority", true)
      .in("status", ["open", "planned"])
      .not("deadline", "is", null)
      .lt("deadline", nowIso)
      .order("deadline", { ascending: true }),
    admin
      .from("cut_session_blocks")
      .select("id, block_id, updated_at")
      .eq("status", "rejected")
      .gte("updated_at", twoDaysAgo)
      .order("updated_at", { ascending: false }),
  ]);

  type Alert = {
    kind: "long_cut" | "overdue_slab" | "rejected_cut";
    severity: "warn" | "bad";
    title: string;
    detail: string;
    href: string;
    count: number;
  };

  const alerts: Alert[] = [];

  const longCuts = longCutsRes.data ?? [];
  if (longCuts.length > 0) {
    const blockIds = longCuts.slice(0, 3).map((b) => b.block_id).join(", ");
    const oldest = longCuts[0];
    const hoursOldest = oldest?.updated_at
      ? Math.round((Date.now() - new Date(oldest.updated_at).getTime()) / 3600000)
      : null;
    alerts.push({
      kind: "long_cut",
      severity: "warn",
      title: `${longCuts.length} block${longCuts.length > 1 ? "s" : ""} cutting for over 24 hours`,
      detail: hoursOldest
        ? `Oldest: ${oldest.block_id} (${hoursOldest}h). Others: ${blockIds}.`
        : `${blockIds}`,
      href: "/cutting",
      count: longCuts.length,
    });
  }

  const overdue = overdueRes.data ?? [];
  if (overdue.length > 0) {
    const head = overdue.slice(0, 3).map((s) => `${s.id} (${s.temple})`).join(", ");
    alerts.push({
      kind: "overdue_slab",
      severity: "bad",
      title: `${overdue.length} urgent slab${overdue.length > 1 ? "s" : ""} past deadline`,
      detail: head + (overdue.length > 3 ? ` + ${overdue.length - 3} more` : ""),
      href: "/slabs",
      count: overdue.length,
    });
  }

  const rejected = rejectedRes.data ?? [];
  if (rejected.length > 0) {
    const head = rejected.slice(0, 3).map((r) => r.block_id).join(", ");
    alerts.push({
      kind: "rejected_cut",
      severity: "bad",
      title: `${rejected.length} block${rejected.length > 1 ? "s" : ""} rejected in the last 48h`,
      detail: head + (rejected.length > 3 ? ` + ${rejected.length - 3} more` : ""),
      href: "/cutting?tab=done",
      count: rejected.length,
    });
  }

  return {
    checkedAt: nowIso,
    alertCount: alerts.length,
    alerts,
    summary: alerts.length === 0
      ? "All clear — no operational issues detected."
      : `${alerts.length} alert${alerts.length > 1 ? "s" : ""} need attention.`,
  };
}

// ─── get_user_activity ───────────────────────────────────────────────────────

async function getUserActivity(input: Record<string, unknown>) {
  const admin = createAdminSupabaseClient();
  // Sub-day window takes precedence over the day-level range so the
  // model can ask "last 2 hours" cleanly. Day-level range stays as
  // the fallback for "today" / "this_week" etc.
  const hoursAgoRaw = typeof input.hours_ago === "number" ? input.hours_ago : null;
  const range = input.range === "today" || input.range === "yesterday" || input.range === "this_week" || input.range === "this_month"
    ? input.range
    : "today";
  const hoursWindow = hoursAgoRaw != null ? istHoursWindow(hoursAgoRaw) : null;
  const window = hoursWindow ?? istRange(range);
  const from = window.from;
  const to = window.to;
  const windowLabel = hoursWindow
    ? `last ${hoursWindow.hours} hour(s)`
    : range;
  const userNameFilter = typeof input.user_name === "string" ? input.user_name.trim().toLowerCase() : null;
  const actionFilter = typeof input.action === "string" ? input.action : null;
  const entityFilter = typeof input.entity_type === "string" ? input.entity_type : null;
  const limit = Math.max(1, Math.min(50, typeof input.limit === "number" ? input.limit : 20));

  // Fetch audit logs in the window
  let q = admin
    .from("audit_logs")
    .select("id, user_id, action, entity_type, entity_id, details, created_at")
    .gte("created_at", from)
    .lt("created_at", to)
    .order("created_at", { ascending: false });
  if (actionFilter) q = q.eq("action", actionFilter);
  if (entityFilter) q = q.eq("entity_type", entityFilter);
  const { data: logs, error } = await q.limit(1000);
  if (error) throw new Error(error.message);

  // Resolve user_ids to names
  const userIds = [...new Set((logs ?? []).map((l) => l.user_id).filter(Boolean))];
  let profileMap = new Map<string, { name: string; role: string | null }>();
  if (userIds.length > 0) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, full_name, role")
      .in("id", userIds);
    for (const p of profiles ?? []) {
      profileMap.set(p.id, { name: p.full_name || "Unknown", role: p.role ?? null });
    }
  }

  // Apply user_name filter after we have profiles
  const filtered = (logs ?? []).filter((l) => {
    if (!userNameFilter) return true;
    const name = profileMap.get(l.user_id)?.name?.toLowerCase() ?? "";
    return name.includes(userNameFilter);
  });

  // Group by user, then by action:entity
  type Bucket = { userId: string; name: string; role: string | null; total: number; byAction: Record<string, number> };
  const byUser = new Map<string, Bucket>();
  for (const l of filtered) {
    const prof = profileMap.get(l.user_id);
    const bucket: Bucket = byUser.get(l.user_id) ?? {
      userId: l.user_id,
      name: prof?.name ?? "Unknown",
      role: prof?.role ?? null,
      total: 0,
      byAction: {} as Record<string, number>,
    };
    bucket.total++;
    const key = `${l.action}:${l.entity_type}`;
    bucket.byAction[key] = (bucket.byAction[key] ?? 0) + 1;
    byUser.set(l.user_id, bucket);
  }

  const summary = [...byUser.values()]
    .sort((a, b) => b.total - a.total)
    .map((b) => ({
      name: b.name,
      role: b.role,
      total: b.total,
      breakdown: b.byAction,
    }));

  const samples = filtered.slice(0, limit).map((l) => ({
    at: l.created_at,
    user: profileMap.get(l.user_id)?.name ?? "Unknown",
    action: l.action,
    entity_type: l.entity_type,
    entity_id: l.entity_id,
    details: l.details,
  }));

  return {
    range: windowLabel,
    windowFromIso: from,
    windowToIso: to,
    totalEvents: filtered.length,
    filters: {
      userNameFilter: userNameFilter ?? "any",
      action: actionFilter ?? "any",
      entityType: entityFilter ?? "any",
    },
    byUser: summary,
    recentEvents: samples,
    note: filtered.length === 0 ? "No matching activity in the selected window." : undefined,
  };
}

// ─── list_users ──────────────────────────────────────────────────────────────

async function listUsers(input: Record<string, unknown>) {
  const admin = createAdminSupabaseClient();
  const roleFilter = typeof input.role === "string" ? input.role : null;
  const onlineOnly = input.online_only === true;
  const nameContains = typeof input.name_contains === "string" ? input.name_contains.trim().toLowerCase() : null;

  let q = admin
    .from("profiles")
    .select("id, full_name, phone, role, is_active, last_seen_at")
    .eq("is_active", true);
  if (roleFilter) q = q.eq("role", roleFilter);
  const { data: profiles, error } = await q;
  if (error) throw new Error(error.message);

  // Pull today's heartbeat counts for screen time (2-min ping interval → minutes = pings × 2)
  const { from: todayFrom, to: todayTo } = istRange("today");
  const { data: pings } = await admin
    .from("heartbeat_log")
    .select("user_id")
    .gte("created_at", todayFrom)
    .lt("created_at", todayTo);
  const pingMap = new Map<string, number>();
  for (const p of pings ?? []) pingMap.set(p.user_id, (pingMap.get(p.user_id) ?? 0) + 1);

  const fiveMinAgo = Date.now() - 5 * 60 * 1000;

  const rows = (profiles ?? [])
    .filter((p) => {
      if (nameContains && !(p.full_name || "").toLowerCase().includes(nameContains)) return false;
      if (onlineOnly) {
        const seen = p.last_seen_at ? new Date(p.last_seen_at).getTime() : 0;
        if (seen < fiveMinAgo) return false;
      }
      return true;
    })
    .map((p) => {
      const seen = p.last_seen_at ? new Date(p.last_seen_at).getTime() : 0;
      const isOnline = seen >= fiveMinAgo;
      const screenMinutes = (pingMap.get(p.id) ?? 0) * 2;
      return {
        id: p.id,
        name: p.full_name || p.phone || "Unknown",
        role: p.role,
        isOnline,
        lastSeenAt: p.last_seen_at,
        screenMinutesToday: screenMinutes,
      };
    })
    .sort((a, b) => (b.isOnline ? 1 : 0) - (a.isOnline ? 1 : 0) || b.screenMinutesToday - a.screenMinutesToday);

  return {
    totalUsers: rows.length,
    onlineCount: rows.filter((r) => r.isOnline).length,
    filters: { role: roleFilter ?? "any", onlineOnly, nameContains: nameContains ?? null },
    users: rows,
  };
}

// ─── get_audit_trail ─────────────────────────────────────────────────────────

async function getAuditTrail(input: Record<string, unknown>) {
  const admin = createAdminSupabaseClient();
  // Sub-day window takes precedence — "last 2 hours" must not get
  // silently widened to "today".
  const hoursAgoRaw = typeof input.hours_ago === "number" ? input.hours_ago : null;
  const range = input.range === "today" || input.range === "yesterday" || input.range === "this_week" || input.range === "this_month"
    ? input.range
    : "today";
  const hoursWindow = hoursAgoRaw != null ? istHoursWindow(hoursAgoRaw) : null;
  const window = hoursWindow ?? istRange(range);
  const from = window.from;
  const to = window.to;
  const windowLabel = hoursWindow
    ? `last ${hoursWindow.hours} hour(s)`
    : range;
  const limit = Math.max(1, Math.min(100, typeof input.limit === "number" ? input.limit : 30));
  const entityFilter = typeof input.entity_type === "string" ? input.entity_type : null;

  let q = admin
    .from("audit_logs")
    .select("id, user_id, action, entity_type, entity_id, details, created_at")
    .gte("created_at", from)
    .lt("created_at", to)
    .order("created_at", { ascending: false });
  if (entityFilter) q = q.eq("entity_type", entityFilter);
  const { data: logs, error } = await q.limit(limit);
  if (error) throw new Error(error.message);

  // Resolve users
  const userIds = [...new Set((logs ?? []).map((l) => l.user_id).filter(Boolean))];
  const nameMap = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, full_name")
      .in("id", userIds);
    for (const p of profiles ?? []) nameMap.set(p.id, p.full_name || "Unknown");
  }

  const events = (logs ?? []).map((l) => ({
    at: l.created_at,
    user: nameMap.get(l.user_id) || "Unknown",
    action: l.action,
    entity_type: l.entity_type,
    entity_id: l.entity_id,
    details: l.details,
  }));

  return {
    range: windowLabel,
    windowFromIso: from,
    windowToIso: to,
    totalEvents: events.length,
    filters: { entityType: entityFilter ?? "any" },
    events,
    note: events.length === 0 ? "No activity in the selected window." : undefined,
  };
}

// ─── list_vendors ────────────────────────────────────────────────────────────

async function listVendors(input: Record<string, unknown>) {
  const admin = createAdminSupabaseClient();
  const typeFilter = typeof input.type === "string" ? input.type : null;
  const activeOnly = input.active_only !== false; // default true

  let q = admin.from("vendors").select("id, name, vendor_type, is_active, created_at");
  if (activeOnly) q = q.eq("is_active", true);
  if (typeFilter) q = q.eq("vendor_type", typeFilter);
  const { data, error } = await q.order("name", { ascending: true });
  if (error) throw new Error(error.message);

  const vendors = (data ?? []).map((v) => ({
    id: v.id,
    name: v.name,
    type: v.vendor_type,
    active: v.is_active,
    createdAt: v.created_at,
  }));

  const countsByType: Record<string, number> = {};
  for (const v of vendors) countsByType[v.type] = (countsByType[v.type] ?? 0) + 1;

  return {
    totalVendors: vendors.length,
    countsByType,
    filters: { type: typeFilter ?? "any", activeOnly },
    vendors,
  };
}

// ─── get_block_journey ───────────────────────────────────────────────────────
// Reconstructs the full lifecycle of a block — added, planned, approved,
// cut, remaindered — by stitching together the blocks / cut_session_blocks
// / cut_sessions / audit_logs tables and resolving user ids to names.

async function getBlockJourney(input: Record<string, unknown>) {
  const admin = createAdminSupabaseClient();
  const blockId = String(input.block_id || "").trim();
  if (!blockId) return { error: "block_id is required" };

  // 1. Block itself
  const { data: block, error: blockErr } = await admin
    .from("blocks")
    .select(
      "id, stone, yard, category, length_ft, width_ft, height_ft, status, quality, created_at, created_by, updated_at, updated_by",
    )
    .eq("id", blockId)
    .maybeSingle();
  if (blockErr) throw new Error(blockErr.message);
  if (!block) return { error: `Block ${blockId} not found.` };

  // 2. All cut_session_blocks that ever touched this block (retries + past rejects)
  const { data: csbs } = await admin
    .from("cut_session_blocks")
    .select(
      "id, status, layout, restocked_block_id, created_at, updated_at, cut_session_id, " +
      "cut_sessions(session_code, kerf_mm, planned_by, created_at)",
    )
    .eq("block_id", blockId)
    .order("created_at", { ascending: true });

  type CsbRow = {
    id: string;
    status: string;
    layout: { placed?: Array<{ id: string; sw?: number; sh?: number; sd?: number; temple?: string }> } | null;
    restocked_block_id: string | null;
    created_at: string | null;
    updated_at: string | null;
    cut_session_id: string;
    cut_sessions: { session_code: string; kerf_mm: number; planned_by: string | null; created_at: string } | null;
  };
  const csbRows = (csbs ?? []) as unknown as CsbRow[];
  const csbIds = csbRows.map(c => c.id);

  // 3. Audit events — block-level + per-cut_session_block
  const blockAuditsQ = admin
    .from("audit_logs")
    .select("user_id, action, entity_type, entity_id, details, created_at")
    .eq("entity_type", "block")
    .eq("entity_id", blockId)
    .order("created_at", { ascending: true });
  const csbAuditsQ = csbIds.length > 0
    ? admin
        .from("audit_logs")
        .select("user_id, action, entity_type, entity_id, details, created_at")
        .eq("entity_type", "cut_session_block")
        .in("entity_id", csbIds)
        .order("created_at", { ascending: true })
    : Promise.resolve({ data: [] as AuditRow[], error: null });

  // 4. Remainder children (blocks with id like 'MT-B-039-%' and category Reused)
  const remaindersQ = admin
    .from("blocks")
    .select("id, length_ft, width_ft, height_ft, status, category, created_at")
    .like("id", `${blockId}-%`)
    .eq("category", "Reused")
    .order("id", { ascending: true });

  type AuditRow = {
    user_id: string;
    action: string;
    entity_type: string;
    entity_id: string;
    details: Record<string, unknown> | null;
    created_at: string;
  };
  type RemainderRow = {
    id: string;
    length_ft: number;
    width_ft: number;
    height_ft: number;
    status: string;
    category: string | null;
    created_at: string | null;
  };

  const [blockAuditsR, csbAuditsR, remaindersR] = await Promise.all([blockAuditsQ, csbAuditsQ, remaindersQ]);
  const blockAudits = (blockAuditsR.data ?? []) as AuditRow[];
  const csbAudits = (csbAuditsR.data ?? []) as AuditRow[];
  const remainders = (remaindersR.data ?? []) as RemainderRow[];

  // 5. Resolve user ids → names. Fetch only the profiles we need.
  const userIds = new Set<string>();
  if (block.created_by) userIds.add(block.created_by);
  if (block.updated_by) userIds.add(block.updated_by);
  for (const c of csbRows) if (c.cut_sessions?.planned_by) userIds.add(c.cut_sessions.planned_by);
  for (const a of blockAudits) if (a.user_id) userIds.add(a.user_id);
  for (const a of csbAudits) if (a.user_id) userIds.add(a.user_id);

  const nameOf = new Map<string, string>();
  if (userIds.size > 0) {
    const { data: profs } = await admin
      .from("profiles")
      .select("id, full_name, phone")
      .in("id", [...userIds]);
    for (const p of profs ?? []) {
      nameOf.set(p.id, p.full_name || p.phone || "Unknown");
    }
  }
  const who = (uid: string | null | undefined) => (uid ? (nameOf.get(uid) || "Unknown") : null);

  // Build the chronological event list
  type Ev = { icon: string; at: string; title: string; by?: string | null; details?: string };
  const events: Ev[] = [];

  // 📦 Added
  const cft = toCFT(Number(block.length_ft) * Number(block.width_ft) * Number(block.height_ft));
  events.push({
    icon: "📦",
    at: block.created_at || new Date(0).toISOString(),
    title: "Added to inventory",
    by: who(block.created_by),
    details: `${block.stone ?? "—"} · Yard ${block.yard} · ${block.length_ft}×${block.width_ft}×${block.height_ft} in · ${cft.toFixed(2)} CFT${block.category ? ` · ${block.category}` : ""}${block.quality ? ` · Grade ${block.quality}` : ""}`,
  });

  // 📋 Planned (for each cut session block)
  for (const csb of csbRows) {
    const s = csb.cut_sessions;
    const placedCount = csb.layout?.placed?.length ?? 0;
    events.push({
      icon: "📋",
      at: (s?.created_at || csb.created_at) ?? new Date(0).toISOString(),
      title: placedCount > 0
        ? `Planned for cutting — ${placedCount} slab${placedCount !== 1 ? "s" : ""}`
        : "Planned for cutting",
      by: who(s?.planned_by),
      details: s ? `Session ${s.session_code}${s.kerf_mm ? ` · Kerf ${s.kerf_mm} mm` : ""}` : undefined,
    });
  }

  // Audit events on the cut session blocks
  for (const a of csbAudits) {
    const byName = who(a.user_id);
    const details = (a.details ?? {}) as Record<string, unknown>;
    if (a.action === "cutting_started") {
      events.push({ icon: "▶️", at: a.created_at, title: "Cutting approved & started", by: byName });
    } else if (a.action === "cutting_done" || a.action === "cutting_done_with_deviation") {
      const cutSlabs = Array.isArray(details.cut_slabs) ? (details.cut_slabs as string[]) : [];
      const notCutSlabs = Array.isArray(details.not_cut_slabs) ? (details.not_cut_slabs as string[]) : [];
      const restocked = Array.isArray(details.restocked_blocks) ? (details.restocked_blocks as string[]) : [];
      const extra = Array.isArray(details.extra_slabs) ? (details.extra_slabs as string[]) : [];
      const parts: string[] = [];
      parts.push(`${cutSlabs.length} slab${cutSlabs.length !== 1 ? "s" : ""} cut${cutSlabs.length > 0 ? ` (${cutSlabs.join(", ")})` : ""}`);
      if (notCutSlabs.length > 0) parts.push(`${notCutSlabs.length} not cut`);
      if (extra.length > 0) parts.push(`+${extra.length} unplanned (${extra.join(", ")})`);
      if (restocked.length > 0) parts.push(`${restocked.length} remainder piece${restocked.length !== 1 ? "s" : ""} restocked`);
      events.push({
        icon: "🔪",
        at: a.created_at,
        title: a.action === "cutting_done_with_deviation" ? "Cutting completed (with deviation)" : "Cutting completed",
        by: byName,
        details: parts.join(" · "),
      });
    } else if (a.action === "block_rejected") {
      events.push({ icon: "❌", at: a.created_at, title: "Block rejected", by: byName });
    } else if (a.action === "cutting_undo_approve") {
      events.push({ icon: "↩️", at: a.created_at, title: "Approval reverted", by: byName });
    } else if (a.action === "cutting_undo_done") {
      events.push({ icon: "↩️", at: a.created_at, title: "Cutting un-done", by: byName });
    }
  }

  // Audit events on the block itself (skip 'create' — already covered by the 📦 row)
  for (const a of blockAudits) {
    if (a.action === "create") continue;
    const byName = who(a.user_id);
    const details = (a.details ?? {}) as Record<string, unknown>;
    if (a.action === "update") {
      const newStatus = typeof details.status === "string" ? (details.status as string) : null;
      events.push({
        icon: "✏️",
        at: a.created_at,
        title: "Block updated",
        by: byName,
        details: newStatus ? `Status → ${newStatus}` : undefined,
      });
    } else if (a.action === "delete") {
      events.push({ icon: "🗑️", at: a.created_at, title: "Block discarded", by: byName });
    } else if (a.action === "manual_cut_block") {
      events.push({ icon: "✂️", at: a.created_at, title: "Manually cut", by: byName });
    }
  }

  // ♻️ Remainders created — all from the same cutting event typically
  if (remainders.length > 0) {
    const rDetails = remainders
      .map(r => `${r.id} (${r.length_ft}×${r.width_ft}×${r.height_ft}")`)
      .join(", ");
    events.push({
      icon: "♻️",
      at: remainders[0].created_at ?? new Date().toISOString(),
      title: `${remainders.length} remainder piece${remainders.length !== 1 ? "s" : ""} added to inventory`,
      details: rDetails,
    });
  }

  // Sort chronologically, stable by original order within same timestamp
  events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  return {
    blockId: block.id,
    currentState: {
      stone: block.stone,
      yard: block.yard,
      facility: facilityOfYard(block.yard),
      dimensions: `${block.length_ft}×${block.width_ft}×${block.height_ft} in`,
      cft: Number(cft.toFixed(2)),
      status: block.status,
      category: block.category,
      quality: block.quality ?? null,
      lastUpdatedBy: who(block.updated_by),
      lastUpdatedAt: block.updated_at,
    },
    totalCutAttempts: csbRows.length,
    events,
    remainders: remainders.map(r => {
      const rcft = toCFT(Number(r.length_ft) * Number(r.width_ft) * Number(r.height_ft));
      return {
        id: r.id,
        dimensions: `${r.length_ft}×${r.width_ft}×${r.height_ft} in`,
        cft: Number(rcft.toFixed(2)),
        status: r.status,
      };
    }),
  };
}

// ─── get_stone_efficiency ────────────────────────────────────────────────
// Reuses the buildLineages() pure function that powers the /block-journey
// page. Returns BOTH yield and recovered framings plus the top/bottom
// lineages so the AI can answer "why is PinkStone underperforming" style
// follow-ups without another tool call.

async function getStoneEfficiency(input: Record<string, unknown>) {
  const admin = createAdminSupabaseClient();
  const stone = typeof input.stone === "string" ? input.stone : undefined;
  const facility = input.facility === "mtcpl" || input.facility === "riico" ? (input.facility as Facility) : undefined;
  const quality = input.quality === "A" || input.quality === "B" ? input.quality : undefined;
  const resolvedOnly = input.resolved_only === true;

  const [freshR, reusedR, cutDoneR, doneCsbR] = await Promise.all([
    admin
      .from("blocks")
      .select("id, stone, yard, quality, category, length_ft, width_ft, height_ft, status, created_at, created_by")
      .eq("category", "Fresh"),
    admin
      .from("blocks")
      .select("id, stone, yard, quality, category, length_ft, width_ft, height_ft, status, created_at, created_by")
      .eq("category", "Reused"),
    // Match /block-journey/page.tsx — credit each block for every slab
    // that came out of it, regardless of where the slab is now (carving
    // / completed / dispatched / rejected). cut_done-only is the
    // MT-B-246 bug. POST_CUT_STATUSES is the shared canonical set.
    admin
      .from("slab_requirements")
      .select("id, length_ft, width_ft, thickness_ft, source_block_id, label, temple, status")
      .not("source_block_id", "is", null)
      .in("status", POST_CUT_STATUSES),
    admin.from("cut_session_blocks").select("block_id, status").eq("status", "done"),
  ]);

  const all = buildLineages(
    (freshR.data ?? []) as BjBlockRow[],
    (reusedR.data ?? []) as BjBlockRow[],
    (cutDoneR.data ?? []) as BjSlabRow[],
    (doneCsbR.data ?? []) as BjCsbRow[],
  );

  const filtered = all.filter((l) => {
    if (stone && l.rootStone !== stone) return false;
    if (facility && l.rootFacility !== facility) return false;
    if (quality && l.rootQuality !== quality) return false;
    if (resolvedOnly && !l.isResolved) return false;
    return true;
  });

  const agg = aggregateLineages(filtered);

  // Top / bottom 3 — sandstone uses slabPct, marble uses cftPerTonne.
  // Each gets its own best/worst list so the AI can cite them separately.
  const sandstoneFiltered = filtered.filter((l): l is import("@/app/(app)/block-journey/build-lineages").SandstoneLineage => l.category === "sandstone");
  const marbleFiltered = filtered.filter((l): l is import("@/app/(app)/block-journey/build-lineages").MarbleLineage => l.category === "marble");

  const sandstoneByYield = [...sandstoneFiltered].sort((a, b) => a.slabPct - b.slabPct);
  const marbleByYield = [...marbleFiltered].sort((a, b) => a.cftPerTonne - b.cftPerTonne);

  const worst = [
    ...sandstoneByYield.slice(0, 3).map((l) => ({
      id: l.rootId,
      stone: l.rootStone,
      originalCft: Number(l.originalCft.toFixed(2)),
      slabPct: l.slabPct,
      wastePct: l.wastePct,
      resolved: l.isResolved,
    })),
    ...marbleByYield.slice(0, 3).map((l) => ({
      id: l.rootId,
      stone: l.rootStone,
      tonnes: Number(l.tonnes.toFixed(3)),
      slabCft: Number(l.slabCft.toFixed(2)),
      cftPerTonne: Number(l.cftPerTonne.toFixed(2)),
      resolved: l.isResolved,
    })),
  ];
  const best = [
    ...sandstoneByYield.slice(-3).reverse().map((l) => ({
      id: l.rootId,
      stone: l.rootStone,
      originalCft: Number(l.originalCft.toFixed(2)),
      slabPct: l.slabPct,
      wastePct: l.wastePct,
      resolved: l.isResolved,
    })),
    ...marbleByYield.slice(-3).reverse().map((l) => ({
      id: l.rootId,
      stone: l.rootStone,
      tonnes: Number(l.tonnes.toFixed(3)),
      slabCft: Number(l.slabCft.toFixed(2)),
      cftPerTonne: Number(l.cftPerTonne.toFixed(2)),
      resolved: l.isResolved,
    })),
  ];

  return {
    filters: { stone: stone ?? "all", facility: facility ?? "all", quality: quality ?? "all", resolvedOnly },
    lineagesAnalyzed: agg.totalLineages,
    resolvedCount: agg.resolvedCount,
    inProgressCount: agg.inProgressCount,
    totalOriginalCft: round2(agg.totalOriginalCft),
    totalSlabCft: round2(agg.totalSlabCft),
    totalLiveCft: round2(agg.totalLiveCft),
    totalWasteCft: round2(agg.totalWasteCft),
    yieldFraming: {
      weightedSlabPct: agg.weightedSlabPct,
      weightedLivePct: agg.weightedLivePct,
      simpleSlabPctAvg: agg.simpleSlabPctAvg,
      note: "Conservative. Sandstone-only. Use this for tender pricing — only counts what actually became sellable slabs.",
    },
    recoveredFraming: {
      weightedRecoveredPct: agg.weightedRecoveredPct,
      weightedWastePct: agg.weightedWastePct,
      simpleRecoveredPctAvg: agg.simpleRecoveredPctAvg,
      note: "Optimistic. Sandstone-only. Credits in-inventory restocks as recovered. Use for judging single-cut performance.",
    },
    marble: {
      lineageCount: agg.marble.lineageCount,
      totalTonnes: agg.marble.totalTonnes,
      totalSlabCft: agg.marble.totalSlabCft,
      weightedCftPerTonne: agg.marble.weightedCftPerTonne,
      simpleCftPerTonneAvg: agg.marble.simpleCftPerTonneAvg,
      truckCount: agg.marble.truckCount,
      note: "Marble uses CFT-per-tonne instead of % yield. If you bought marble at ₹X/tonne and weightedCftPerTonne is Y, your effective raw-stone cost per sellable CFT is ₹X/Y.",
    },
    topWastefulLineages: worst,
    topEfficientLineages: best,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}


// ════════════════════════════════════════════════════════════════════════════
// Finance department handlers (Mig 028 / 037 / 042 / 043)
// ════════════════════════════════════════════════════════════════════════════
//
// All read-only. Bills go pending_approval → approved → fully_paid /
// cancelled / rejected. Payments per bill: proposed → confirmed → paid
// (or cancelled). Tax columns added by mig 042 (cgst/sgst/igst/tds/tcs
// + their amount_* generated columns + amount_payable_to_vendor).
// Bill-number deduplication is leading-zero-insensitive thanks to
// vendor_bill_no_normalized (mig 043). All sums round to two decimals.

/** Format ₹ amounts in Indian numbering for narration. */
function inr(n: number): string {
  return `₹${(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

/** Fuzzy-resolve a vendor name against bill_vendors.name. Mirrors the
 *  resolveTempleName pattern. Returns the canonical name on hit, or
 *  a not-found / ambiguous shape so the caller can narrate properly. */
async function resolveBillVendor(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  input: string,
): Promise<
  | { kind: "resolved"; name: string; id: string }
  | { kind: "ambiguous"; candidates: Array<{ id: string; name: string }> }
  | { kind: "not_found"; available: string[] }
> {
  const { data } = await admin
    .from("bill_vendors")
    .select("id, name, is_active")
    .order("name");
  const all = (data ?? []) as Array<{ id: string; name: string; is_active: boolean }>;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const needle = norm(input);
  if (!needle) return { kind: "not_found", available: all.map((v) => v.name) };

  const exact = all.find((v) => norm(v.name) === needle);
  if (exact) return { kind: "resolved", name: exact.name, id: exact.id };

  const matches = all.filter((v) => {
    const hay = norm(v.name);
    return hay.includes(needle) || needle.includes(hay);
  });
  if (matches.length === 1) return { kind: "resolved", name: matches[0].name, id: matches[0].id };
  if (matches.length > 1) {
    return {
      kind: "ambiguous",
      candidates: matches.map((m) => ({ id: m.id, name: m.name })),
    };
  }
  return { kind: "not_found", available: all.map((v) => v.name) };
}

async function getFinanceSnapshot() {
  const admin = createAdminSupabaseClient();

  const [
    { data: dueRows },
    { count: pendingAuditCount },
    { data: payTodayRows, count: payTodayCount },
    { data: paidTodayRows },
    { data: allBillsForTax },
  ] = await Promise.all([
    admin
      .from("bills")
      .select(
        "id, amount_outstanding, amount_total, amount_tds, amount_tcs, bill_vendor_id, bill_vendors(name)",
      )
      .eq("status", "approved")
      .gt("amount_outstanding", 0),
    admin
      .from("bills")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending_approval"),
    admin
      .from("bill_payments")
      .select("proposed_amount, status", { count: "exact" })
      .in("status", ["proposed", "confirmed"]),
    admin
      .from("bill_payments")
      .select("paid_amount, paid_at")
      .eq("status", "paid")
      .gte("paid_at", istRange("today").from)
      .lt("paid_at", istRange("today").to),
    admin
      .from("bills")
      .select("amount_tds, amount_tcs, status")
      .neq("status", "cancelled"),
  ]);

  type DueRow = {
    id: string;
    amount_outstanding: number;
    amount_total: number;
    amount_tds: number | null;
    amount_tcs: number | null;
    bill_vendor_id: string;
    bill_vendors: { name: string } | { name: string }[] | null;
  };
  const due = ((dueRows ?? []) as unknown) as DueRow[];
  const totalOutstanding = due.reduce((s, b) => s + Number(b.amount_outstanding), 0);

  const payToday = payTodayRows ?? [];
  const payTodayTotal = payToday.reduce((s, b) => s + Number(b.proposed_amount), 0);
  const proposedCount = payToday.filter((p) => p.status === "proposed").length;
  const confirmedCount = payToday.filter((p) => p.status === "confirmed").length;

  const paidToday = paidTodayRows ?? [];
  const paidTodayTotal = paidToday.reduce((s, b) => s + Number(b.paid_amount ?? 0), 0);

  const allBills = allBillsForTax ?? [];
  const totalTds = allBills.reduce((s, b) => s + Number((b as { amount_tds?: number }).amount_tds ?? 0), 0);
  const totalTcs = allBills.reduce((s, b) => s + Number((b as { amount_tcs?: number }).amount_tcs ?? 0), 0);

  // Top vendors by outstanding
  const byVendor = new Map<string, { name: string; outstanding: number; bills: number }>();
  for (const b of due) {
    const v = Array.isArray(b.bill_vendors) ? b.bill_vendors[0] : b.bill_vendors;
    const name = v?.name ?? "Unknown";
    const cur = byVendor.get(name) ?? { name, outstanding: 0, bills: 0 };
    cur.outstanding += Number(b.amount_outstanding);
    cur.bills += 1;
    byVendor.set(name, cur);
  }
  const topVendors = Array.from(byVendor.values())
    .sort((a, b) => b.outstanding - a.outstanding)
    .slice(0, 5)
    .map((v) => ({ ...v, outstandingFmt: inr(v.outstanding) }));

  return {
    totalOutstandingInr: round2(totalOutstanding),
    totalOutstandingFmt: inr(totalOutstanding),
    dueBillsCount: due.length,
    pendingAuditCount: pendingAuditCount ?? 0,
    payToday: {
      total: payTodayCount ?? 0,
      proposed: proposedCount,
      confirmed: confirmedCount,
      totalInr: round2(payTodayTotal),
      totalFmt: inr(payTodayTotal),
    },
    paidToday: {
      count: paidToday.length,
      totalInr: round2(paidTodayTotal),
      totalFmt: inr(paidTodayTotal),
    },
    lifetimeTdsDeductedInr: round2(totalTds),
    lifetimeTdsDeductedFmt: inr(totalTds),
    lifetimeTcsCollectedInr: round2(totalTcs),
    lifetimeTcsCollectedFmt: inr(totalTcs),
    topVendorsByOutstanding: topVendors,
  };
}

async function listDueBills(input: Record<string, unknown>) {
  const admin = createAdminSupabaseClient();
  const limit = Math.min(200, Math.max(1, Number(input.limit) || 25));
  const tokenSubstr = typeof input.token === "string" ? input.token.trim() : "";
  const ageBucket =
    typeof input.age_bucket === "string" ? input.age_bucket : null;
  const vendorInput = typeof input.vendor === "string" ? input.vendor.trim() : "";

  let vendorId: string | null = null;
  let vendorResolved: string | null = null;
  if (vendorInput) {
    const r = await resolveBillVendor(admin, vendorInput);
    if (r.kind === "ambiguous") {
      return {
        ambiguous: true,
        candidates: r.candidates.map((c) => c.name),
      };
    }
    if (r.kind === "not_found") {
      return {
        error: `Vendor "${vendorInput}" not found.`,
        availableVendors: r.available.slice(0, 30),
      };
    }
    vendorId = r.id;
    vendorResolved = r.name;
  }

  let q = admin
    .from("bills")
    .select(
      "id, token, vendor_bill_no, bill_date, cost_head, amount_subtotal, amount_gst, amount_tds, amount_tcs, amount_total, amount_payable_to_vendor, amount_paid, amount_outstanding, held_amount, held_reason, bill_vendor_id, bill_vendors(name)",
    )
    .eq("status", "approved")
    .gt("amount_outstanding", 0)
    .order("bill_date", { ascending: true })
    .limit(limit);
  if (vendorId) q = q.eq("bill_vendor_id", vendorId);
  if (tokenSubstr) {
    const escaped = tokenSubstr.replace(/[%_]/g, (m) => `\\${m}`);
    q = q.ilike("token", `%${escaped}%`);
  }

  const { data, error } = await q;
  if (error) throw new Error(error.message);

  const todayMs = Date.now();
  type DueRow = {
    id: string;
    token: string;
    vendor_bill_no: string;
    bill_date: string;
    cost_head: string | null;
    amount_subtotal: number;
    amount_gst: number | null;
    amount_tds: number | null;
    amount_tcs: number | null;
    amount_total: number;
    amount_payable_to_vendor: number | null;
    amount_paid: number;
    amount_outstanding: number;
    held_amount: number | string | null;
    held_reason: string | null;
    bill_vendor_id: string;
    bill_vendors: { name: string } | { name: string }[] | null;
  };

  const rows = ((data ?? []) as unknown as DueRow[]).map((b) => {
    const v = Array.isArray(b.bill_vendors) ? b.bill_vendors[0] : b.bill_vendors;
    const days = Math.floor((todayMs - new Date(b.bill_date).getTime()) / 86_400_000);
    const bucket: "0_30" | "31_60" | "61_90" | "90_plus" =
      days <= 30 ? "0_30" : days <= 60 ? "31_60" : days <= 90 ? "61_90" : "90_plus";
    // Mig 072 — proposable = outstanding − held. Surface both so the
    // assistant can answer "how much can I actually propose?" cleanly.
    const heldAmt = Number(b.held_amount ?? 0);
    const outstandingAmt = Number(b.amount_outstanding);
    const proposable = Math.max(0, outstandingAmt - heldAmt);
    return {
      token: b.token,
      vendor: v?.name ?? "Unknown",
      vendorBillNo: b.vendor_bill_no,
      billDate: b.bill_date,
      daysSinceBill: days,
      ageBucket: bucket,
      costHead: b.cost_head,
      amountSubtotalInr: round2(Number(b.amount_subtotal)),
      amountGstInr: round2(Number(b.amount_gst ?? 0)),
      amountTdsInr: round2(Number(b.amount_tds ?? 0)),
      amountTcsInr: round2(Number(b.amount_tcs ?? 0)),
      amountTotalInr: round2(Number(b.amount_total)),
      amountPayableToVendorInr: round2(Number(b.amount_payable_to_vendor ?? b.amount_total)),
      amountPaidInr: round2(Number(b.amount_paid)),
      amountOutstandingInr: round2(outstandingAmt),
      heldAmountInr: round2(heldAmt),
      heldReason: b.held_reason ?? null,
      amountProposableInr: round2(proposable),
    };
  });

  const filtered = ageBucket
    ? rows.filter((r) => r.ageBucket === ageBucket)
    : rows;
  const totalOutstanding = filtered.reduce((s, r) => s + r.amountOutstandingInr, 0);

  return {
    filters: {
      vendor: vendorResolved,
      tokenSubstr: tokenSubstr || null,
      ageBucket,
      limit,
    },
    totalOutstandingInr: round2(totalOutstanding),
    totalOutstandingFmt: inr(totalOutstanding),
    count: filtered.length,
    bills: filtered,
  };
}

async function getBillDetail(input: Record<string, unknown>) {
  const admin = createAdminSupabaseClient();
  const token = typeof input.token === "string" ? input.token.trim().toUpperCase() : "";
  const id = typeof input.id === "string" ? input.id.trim() : "";
  if (!token && !id) return { error: "Pass either `token` or `id`." };

  let q = admin
    .from("bills")
    .select(
      "id, token, vendor_bill_no, bill_date, description, cost_head, status, " +
        "amount_subtotal, gst_percent, cgst_percent, sgst_percent, igst_percent, tds_percent, tcs_percent, " +
        "amount_gst, amount_cgst, amount_sgst, amount_igst, amount_tds, amount_tcs, amount_total, " +
        "amount_payable_to_vendor, amount_paid, amount_outstanding, rejection_note, " +
        "partial_rejection_amount, partial_rejection_note, partial_rejection_at, " +
        "submitted_at, approved_at, rejected_at, cancelled_at, " +
        "bill_vendor_id, bill_vendors(id, name, gstin, pan, bank_name, bank_account, ifsc, tds_applicable, tcs_applicable)",
    );
  q = id ? q.eq("id", id) : q.eq("token", token);
  const { data: rawData, error } = await q.maybeSingle();
  if (error) throw new Error(error.message);
  if (!rawData) return { error: `Bill ${token || id} not found.` };

  // PostgREST embedded-relation typing is too loose for TS, hand-shape it.
  type BillVendorEmbed = {
    id: string;
    name: string;
    gstin?: string | null;
    pan?: string | null;
    bank_name?: string | null;
    bank_account?: string | null;
    ifsc?: string | null;
    tds_applicable?: boolean;
    tcs_applicable?: boolean;
  };
  type BillFull = {
    id: string;
    token: string;
    vendor_bill_no: string;
    bill_date: string;
    description: string;
    cost_head: string | null;
    status: string;
    amount_subtotal: number;
    gst_percent: number;
    cgst_percent: number | null;
    sgst_percent: number | null;
    igst_percent: number | null;
    tds_percent: number | null;
    tcs_percent: number | null;
    amount_gst: number;
    amount_cgst: number | null;
    amount_sgst: number | null;
    amount_igst: number | null;
    amount_tds: number | null;
    amount_tcs: number | null;
    amount_total: number;
    amount_payable_to_vendor: number | null;
    amount_paid: number;
    amount_outstanding: number;
    rejection_note: string | null;
    partial_rejection_amount: number | null;
    partial_rejection_note: string | null;
    partial_rejection_at: string | null;
    submitted_at: string | null;
    approved_at: string | null;
    rejected_at: string | null;
    cancelled_at: string | null;
    bill_vendor_id: string;
    bill_vendors: BillVendorEmbed | BillVendorEmbed[] | null;
  };
  const data = rawData as unknown as BillFull;
  const v = Array.isArray(data.bill_vendors) ? data.bill_vendors[0] : data.bill_vendors;

  // Payment history
  const { data: pays } = await admin
    .from("bill_payments")
    .select(
      "id, status, proposed_amount, paid_amount, payment_method, payment_reference, payment_note, proposed_at, confirmed_at, paid_at, cancelled_at, cancel_reason",
    )
    .eq("bill_id", data.id as string)
    .order("proposed_at", { ascending: true });

  return {
    bill: {
      token: data.token,
      vendorName: v?.name ?? "Unknown",
      vendorBillNo: data.vendor_bill_no,
      billDate: data.bill_date,
      description: data.description,
      costHead: data.cost_head,
      status: data.status,
      submittedAt: data.submitted_at,
      approvedAt: data.approved_at,
      rejectedAt: data.rejected_at,
      rejectionNote: data.rejection_note,
      cancelledAt: data.cancelled_at,
    },
    vendor: v
      ? {
          name: v.name,
          gstin: (v as { gstin?: string | null }).gstin ?? null,
          pan: (v as { pan?: string | null }).pan ?? null,
          bankName: (v as { bank_name?: string | null }).bank_name ?? null,
          bankAccount: (v as { bank_account?: string | null }).bank_account ?? null,
          ifsc: (v as { ifsc?: string | null }).ifsc ?? null,
          tdsApplicable: (v as { tds_applicable?: boolean }).tds_applicable ?? false,
          tcsApplicable: (v as { tcs_applicable?: boolean }).tcs_applicable ?? false,
        }
      : null,
    amounts: {
      subtotalInr: round2(Number(data.amount_subtotal)),
      cgstPercent: Number(data.cgst_percent ?? 0),
      cgstInr: round2(Number(data.amount_cgst ?? 0)),
      sgstPercent: Number(data.sgst_percent ?? 0),
      sgstInr: round2(Number(data.amount_sgst ?? 0)),
      igstPercent: Number(data.igst_percent ?? 0),
      igstInr: round2(Number(data.amount_igst ?? 0)),
      totalGstPercent: Number(data.gst_percent),
      gstInr: round2(Number(data.amount_gst)),
      tdsPercent: Number(data.tds_percent ?? 0),
      tdsInr: round2(Number(data.amount_tds ?? 0)),
      tcsPercent: Number(data.tcs_percent ?? 0),
      tcsInr: round2(Number(data.amount_tcs ?? 0)),
      totalInr: round2(Number(data.amount_total)),
      // Mig 045 — partial rejection deducts from payable. The
      // assistant should report BOTH the vendor's invoice total
      // (totalInr) and what we actually pay
      // (payableToVendorInr). If partialRejectionAmountInr > 0,
      // the two will differ.
      partialRejectionAmountInr: round2(Number(data.partial_rejection_amount ?? 0)),
      partialRejectionNote: data.partial_rejection_note,
      partialRejectionAt: data.partial_rejection_at,
      payableToVendorInr: round2(Number(data.amount_payable_to_vendor ?? data.amount_total)),
      paidInr: round2(Number(data.amount_paid)),
      outstandingInr: round2(Number(data.amount_outstanding)),
    },
    payments: (pays ?? []).map((p) => ({
      status: p.status,
      proposedAmountInr: round2(Number(p.proposed_amount)),
      paidAmountInr: p.paid_amount != null ? round2(Number(p.paid_amount)) : null,
      paymentMethod: p.payment_method,
      paymentReference: p.payment_reference,
      paymentNote: p.payment_note,
      proposedAt: p.proposed_at,
      confirmedAt: p.confirmed_at,
      paidAt: p.paid_at,
      cancelledAt: p.cancelled_at,
      cancelReason: p.cancel_reason,
    })),
  };
}

async function getVendorFinance(input: Record<string, unknown>) {
  const admin = createAdminSupabaseClient();
  const name = typeof input.vendor === "string" ? input.vendor.trim() : "";
  if (!name) return { error: "Pass a vendor name." };

  const r = await resolveBillVendor(admin, name);
  if (r.kind === "ambiguous") {
    return { ambiguous: true, candidates: r.candidates.map((c) => c.name) };
  }
  if (r.kind === "not_found") {
    return {
      error: `Vendor "${name}" not found.`,
      availableVendors: r.available.slice(0, 30),
    };
  }

  const { data: vendor } = await admin
    .from("bill_vendors")
    .select("*")
    .eq("id", r.id)
    .maybeSingle();
  if (!vendor) return { error: "Vendor disappeared mid-query." };

  const { data: bills } = await admin
    .from("bills")
    .select(
      "token, vendor_bill_no, bill_date, status, amount_total, amount_tds, amount_tcs, amount_paid, amount_outstanding",
    )
    .eq("bill_vendor_id", r.id)
    .order("bill_date", { ascending: false });
  const allBills = bills ?? [];

  const lifetimeBilled = allBills.reduce((s, b) => s + Number(b.amount_total), 0);
  const lifetimePaid = allBills.reduce((s, b) => s + Number(b.amount_paid), 0);
  const lifetimeOutstanding = allBills
    .filter((b) => b.status === "approved")
    .reduce((s, b) => s + Number(b.amount_outstanding), 0);
  const lifetimeTds = allBills
    .filter((b) => b.status !== "cancelled" && b.status !== "rejected")
    .reduce((s, b) => s + Number(b.amount_tds ?? 0), 0);
  const lifetimeTcs = allBills
    .filter((b) => b.status !== "cancelled" && b.status !== "rejected")
    .reduce((s, b) => s + Number(b.amount_tcs ?? 0), 0);

  return {
    vendor: {
      name: vendor.name,
      category: vendor.category,
      gstin: vendor.gstin,
      pan: vendor.pan,
      phone: vendor.phone,
      email: vendor.email,
      address: vendor.address,
      bankName: vendor.bank_name,
      bankAccount: vendor.bank_account,
      ifsc: vendor.ifsc,
      upiId: vendor.upi_id,
      paymentTermsDays: vendor.payment_terms_days,
      tdsApplicable: vendor.tds_applicable ?? false,
      tcsApplicable: vendor.tcs_applicable ?? false,
      isActive: vendor.is_active,
    },
    lifetime: {
      billsCount: allBills.length,
      billedInr: round2(lifetimeBilled),
      billedFmt: inr(lifetimeBilled),
      paidInr: round2(lifetimePaid),
      paidFmt: inr(lifetimePaid),
      outstandingInr: round2(lifetimeOutstanding),
      outstandingFmt: inr(lifetimeOutstanding),
      tdsDeductedInr: round2(lifetimeTds),
      tdsDeductedFmt: inr(lifetimeTds),
      tcsCollectedInr: round2(lifetimeTcs),
      tcsCollectedFmt: inr(lifetimeTcs),
    },
    recentBills: allBills.slice(0, 10).map((b) => ({
      token: b.token,
      vendorBillNo: b.vendor_bill_no,
      billDate: b.bill_date,
      status: b.status,
      amountTotalInr: round2(Number(b.amount_total)),
      amountOutstandingInr: round2(Number(b.amount_outstanding)),
    })),
  };
}

async function listBillVendors(input: Record<string, unknown>) {
  const admin = createAdminSupabaseClient();
  const activeOnly = input.active_only !== false;
  const nameContains = typeof input.name_contains === "string" ? input.name_contains.trim() : "";
  const tdsOnly = input.tds_only === true;
  const tcsOnly = input.tcs_only === true;

  let q = admin
    .from("bill_vendors")
    .select(
      "id, name, category, gstin, payment_terms_days, tds_applicable, tcs_applicable, is_active",
    )
    .order("name");
  if (activeOnly) q = q.eq("is_active", true);
  if (tdsOnly) q = q.eq("tds_applicable", true);
  if (tcsOnly) q = q.eq("tcs_applicable", true);
  if (nameContains) q = q.ilike("name", `%${nameContains}%`);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const vendors = data ?? [];

  // Per-vendor outstanding + bill count via aggregate of bills.
  const ids = vendors.map((v) => v.id);
  const billsByVendor = new Map<string, { outstanding: number; bills: number }>();
  if (ids.length > 0) {
    const { data: agg } = await admin
      .from("bills")
      .select("bill_vendor_id, amount_outstanding, status")
      .in("bill_vendor_id", ids);
    for (const r of agg ?? []) {
      const id = r.bill_vendor_id as string;
      const cur = billsByVendor.get(id) ?? { outstanding: 0, bills: 0 };
      cur.bills += 1;
      if (r.status === "approved") cur.outstanding += Number(r.amount_outstanding);
      billsByVendor.set(id, cur);
    }
  }

  return {
    count: vendors.length,
    filters: { activeOnly, nameContains: nameContains || null, tdsOnly, tcsOnly },
    vendors: vendors.map((v) => {
      const stats = billsByVendor.get(v.id) ?? { outstanding: 0, bills: 0 };
      return {
        name: v.name,
        category: v.category,
        gstin: v.gstin,
        paymentTermsDays: v.payment_terms_days,
        tdsApplicable: v.tds_applicable ?? false,
        tcsApplicable: v.tcs_applicable ?? false,
        active: v.is_active,
        billsCount: stats.bills,
        outstandingInr: round2(stats.outstanding),
      };
    }),
  };
}

async function getPayTodayStatus() {
  const admin = createAdminSupabaseClient();
  const today = istRange("today");

  const [{ data: openRows }, { data: paidRows }] = await Promise.all([
    admin
      .from("bill_payments")
      .select(
        "id, status, proposed_amount, proposed_at, bill_id, bills(token, bill_vendors(name))",
      )
      .in("status", ["proposed", "confirmed"])
      .order("proposed_at", { ascending: true }),
    admin
      .from("bill_payments")
      .select(
        "id, paid_amount, payment_method, payment_reference, paid_at, bill_id, bills(token, bill_vendors(name))",
      )
      .eq("status", "paid")
      .gte("paid_at", today.from)
      .lt("paid_at", today.to)
      .order("paid_at", { ascending: true }),
  ]);

  type Row = {
    id: string;
    status?: string;
    proposed_amount?: number;
    proposed_at?: string;
    paid_amount?: number;
    payment_method?: string;
    payment_reference?: string;
    paid_at?: string;
    bills: {
      token: string;
      bill_vendors: { name: string } | { name: string }[] | null;
    } | { token: string; bill_vendors: { name: string } | { name: string }[] | null }[] | null;
  };

  function vendorOf(row: Row): string {
    const bill = Array.isArray(row.bills) ? row.bills[0] : row.bills;
    if (!bill) return "Unknown";
    const v = Array.isArray(bill.bill_vendors) ? bill.bill_vendors[0] : bill.bill_vendors;
    return v?.name ?? "Unknown";
  }
  function tokenOf(row: Row): string {
    const bill = Array.isArray(row.bills) ? row.bills[0] : row.bills;
    return bill?.token ?? "—";
  }

  const open = ((openRows ?? []) as unknown) as Row[];
  const proposed = open
    .filter((r) => r.status === "proposed")
    .map((r) => ({
      token: tokenOf(r),
      vendor: vendorOf(r),
      proposedAmountInr: round2(Number(r.proposed_amount)),
      proposedAt: r.proposed_at,
    }));
  const confirmed = open
    .filter((r) => r.status === "confirmed")
    .map((r) => ({
      token: tokenOf(r),
      vendor: vendorOf(r),
      proposedAmountInr: round2(Number(r.proposed_amount)),
      proposedAt: r.proposed_at,
    }));

  const paid = (((paidRows ?? []) as unknown) as Row[]).map((r) => ({
    token: tokenOf(r),
    vendor: vendorOf(r),
    paidAmountInr: round2(Number(r.paid_amount ?? 0)),
    paymentMethod: r.payment_method ?? null,
    paymentReference: r.payment_reference ?? null,
    paidAt: r.paid_at,
  }));

  return {
    proposed: {
      count: proposed.length,
      totalInr: round2(proposed.reduce((s, r) => s + r.proposedAmountInr, 0)),
      rows: proposed,
    },
    confirmed: {
      count: confirmed.length,
      totalInr: round2(confirmed.reduce((s, r) => s + r.proposedAmountInr, 0)),
      rows: confirmed,
    },
    paidToday: {
      count: paid.length,
      totalInr: round2(paid.reduce((s, r) => s + r.paidAmountInr, 0)),
      rows: paid,
    },
  };
}

async function getFinanceActivity(input: Record<string, unknown>) {
  const admin = createAdminSupabaseClient();
  const limit = Math.min(200, Math.max(1, Number(input.limit) || 30));
  const actionFilter = typeof input.action === "string" ? input.action.trim() : "";

  let window: { from: string; to: string; label: string };
  if (typeof input.hours_ago === "number") {
    const w = istHoursWindow(input.hours_ago);
    window = { from: w.from, to: w.to, label: `last ${w.hours} hr` };
  } else {
    const r = typeof input.range === "string"
      ? (input.range as "today" | "yesterday" | "this_week" | "this_month")
      : "today";
    const w = istRange(r);
    window = { from: w.from, to: w.to, label: r };
  }

  // Finance-domain action prefixes. We pull all and filter for these.
  const FINANCE_PREFIXES = [
    "bill_",
    "payment_",
  ];

  let q = admin
    .from("audit_logs")
    .select("user_id, action, entity_type, entity_id, details, created_at")
    .gte("created_at", window.from)
    .lt("created_at", window.to)
    .order("created_at", { ascending: false })
    .limit(limit * 3); // pull extra so filtering doesn't undercut
  if (actionFilter) q = q.eq("action", actionFilter);

  const { data, error } = await q;
  if (error) throw new Error(error.message);

  const events = (data ?? []).filter((e) =>
    FINANCE_PREFIXES.some((p) => (e.action as string).startsWith(p)),
  ).slice(0, limit);

  const userIds = [...new Set(events.map((e) => e.user_id).filter(Boolean))];
  const profMap = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: profs } = await admin
      .from("profiles")
      .select("id, full_name")
      .in("id", userIds as string[]);
    for (const p of profs ?? []) {
      profMap.set((p as { id: string }).id, (p as { full_name?: string }).full_name ?? "Unknown");
    }
  }

  const byAction: Record<string, number> = {};
  for (const e of events) byAction[e.action as string] = (byAction[e.action as string] ?? 0) + 1;

  return {
    window: window.label,
    count: events.length,
    byAction,
    events: events.map((e) => ({
      at: e.created_at,
      action: e.action,
      who: profMap.get(e.user_id as string) ?? null,
      entityType: e.entity_type,
      entityId: e.entity_id,
      details: e.details,
    })),
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Inventory department handlers (Mig 041 / 044)
// ════════════════════════════════════════════════════════════════════════════

/** Resolve a site by code or fuzzy name. Sites are scoped tightly so
 *  the resolver is simpler than for temples / vendors. */
async function resolveSite(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  input: string,
): Promise<
  | { kind: "resolved"; id: string; code: string; name: string; is_plant: boolean }
  | { kind: "not_found"; available: Array<{ code: string; name: string }> }
> {
  const { data } = await admin
    .from("sites")
    .select("id, code, name, is_plant, is_active")
    .order("is_plant", { ascending: false })
    .order("name");
  const all = (data ?? []) as Array<{
    id: string;
    code: string;
    name: string;
    is_plant: boolean;
    is_active: boolean;
  }>;
  const needle = input.toLowerCase().trim();
  // Exact code match (PLANT, ALPHA…)
  const byCode = all.find((s) => s.code.toLowerCase() === needle);
  if (byCode) return { kind: "resolved", id: byCode.id, code: byCode.code, name: byCode.name, is_plant: byCode.is_plant };
  // Substring on name
  const byName = all.find((s) => s.name.toLowerCase().includes(needle));
  if (byName) return { kind: "resolved", id: byName.id, code: byName.code, name: byName.name, is_plant: byName.is_plant };
  return {
    kind: "not_found",
    available: all.map((s) => ({ code: s.code, name: s.name })),
  };
}

/** Pull every site, every active component, and every approved /
 *  pending_approval movement. Build the (component × site → qty)
 *  map in JS. Mirrors the dashboard's `loadInventorySnapshot`. */
async function loadInventorySnapshotForAi() {
  const admin = createAdminSupabaseClient();
  const [sitesRes, compRes, movRes] = await Promise.all([
    admin
      .from("sites")
      .select("id, code, name, is_plant, is_active, manager_name")
      .order("is_plant", { ascending: false })
      .order("name"),
    admin
      .from("scaffolding_components")
      .select("id, name, component_type, size_spec, unit, is_active, display_order")
      .order("display_order"),
    admin
      .from("inventory_movements")
      .select(
        "component_id, qty, status, from_site_id, to_site_id, movement_type, proposed_at",
      )
      .in("status", ["approved", "pending_approval"]),
  ]);

  type Site = { id: string; code: string; name: string; is_plant: boolean; is_active: boolean; manager_name: string | null };
  type Comp = { id: string; name: string; component_type: string; size_spec: string | null; unit: string; is_active: boolean; display_order: number };
  type Mov = { component_id: string; qty: number; status: string; from_site_id: string | null; to_site_id: string | null; movement_type: string; proposed_at: string };

  const sites = (sitesRes.data ?? []) as Site[];
  const comps = (compRes.data ?? []) as Comp[];
  const movs = (movRes.data ?? []) as Mov[];

  // Per-(comp, site) on-hand + pending-out
  type StockEntry = { onHand: number; pendingOut: number };
  const stock = new Map<string, StockEntry>();
  function key(compId: string, siteId: string) { return `${compId}::${siteId}`; }
  function cell(compId: string, siteId: string): StockEntry {
    const k = key(compId, siteId);
    const cur = stock.get(k) ?? { onHand: 0, pendingOut: 0 };
    stock.set(k, cur);
    return cur;
  }
  for (const m of movs) {
    const qty = Number(m.qty);
    if (m.status === "approved") {
      if (m.to_site_id) cell(m.component_id, m.to_site_id).onHand += qty;
      if (m.from_site_id) cell(m.component_id, m.from_site_id).onHand -= qty;
    } else if (m.status === "pending_approval") {
      if (m.from_site_id) cell(m.component_id, m.from_site_id).pendingOut += qty;
    }
  }

  return { sites, comps, movs, stock, key };
}

async function getInventoryScaffoldingSnapshot(input: Record<string, unknown>) {
  const admin = createAdminSupabaseClient();
  const siteInput = typeof input.site === "string" ? input.site.trim() : "";

  const snap = await loadInventorySnapshotForAi();
  const { sites, comps, movs, stock, key } = snap;
  const plant = sites.find((s) => s.is_plant);
  if (!plant) {
    return {
      error: "Plant site missing — run migration 041 + 044.",
    };
  }

  let scopedSite: typeof sites[number] | null = null;
  if (siteInput) {
    const r = await resolveSite(admin, siteInput);
    if (r.kind === "not_found") {
      return {
        error: `Site "${siteInput}" not found.`,
        availableSites: r.available,
      };
    }
    scopedSite = sites.find((s) => s.id === r.id) ?? null;
  }

  // Component rows: each tells how much is at plant + summed across sites + (if scoped) at the scoped site
  const activeComps = comps.filter((c) => c.is_active);
  const componentRows = activeComps.map((c) => {
    const atPlant = stock.get(key(c.id, plant.id))?.onHand ?? 0;
    const outAtSites = sites
      .filter((s) => !s.is_plant)
      .reduce((sum, s) => sum + (stock.get(key(c.id, s.id))?.onHand ?? 0), 0);
    const pendingOutOfPlant = stock.get(key(c.id, plant.id))?.pendingOut ?? 0;
    const atScopedSite = scopedSite
      ? stock.get(key(c.id, scopedSite.id))?.onHand ?? 0
      : null;
    return {
      name: c.name,
      type: c.component_type,
      sizeSpec: c.size_spec,
      unit: c.unit,
      atPlant,
      outAtSites,
      pendingOutOfPlant,
      totalInPipeline: atPlant + outAtSites,
      atScopedSite,
    };
  });

  // Pending audit batches count
  const pendingBatchIds = new Set<string>();
  for (const m of movs) {
    if (m.status === "pending_approval") {
      pendingBatchIds.add(`${m.proposed_at}::${m.from_site_id ?? ""}::${m.to_site_id ?? ""}`);
    }
  }

  // Per-site totals (active sites + plant)
  const siteTotals = sites
    .filter((s) => s.is_plant || s.is_active)
    .map((s) => {
      let total = 0;
      for (const c of activeComps) {
        total += stock.get(key(c.id, s.id))?.onHand ?? 0;
      }
      return { code: s.code, name: s.name, is_plant: s.is_plant, total };
    });

  return {
    plant: { code: plant.code, name: plant.name },
    scopedSite: scopedSite ? { code: scopedSite.code, name: scopedSite.name } : null,
    totals: {
      atPlant: componentRows.reduce((s, r) => s + r.atPlant, 0),
      outAtSites: componentRows.reduce((s, r) => s + r.outAtSites, 0),
      totalInPipeline: componentRows.reduce((s, r) => s + r.totalInPipeline, 0),
      activeSites: siteTotals.filter((s) => !s.is_plant).length,
      activeComponents: activeComps.length,
      pendingAuditBatches: pendingBatchIds.size,
    },
    components: componentRows,
    siteTotals,
  };
}

async function listInventorySites(input: Record<string, unknown>) {
  const admin = createAdminSupabaseClient();
  const activeOnly = input.active_only !== false;
  const snap = await loadInventorySnapshotForAi();
  const { sites, comps, stock, key } = snap;

  const activeComps = comps.filter((c) => c.is_active);
  const filtered = activeOnly ? sites.filter((s) => s.is_active) : sites;
  return {
    count: filtered.length,
    sites: filtered.map((s) => {
      let total = 0;
      for (const c of activeComps) {
        total += stock.get(key(c.id, s.id))?.onHand ?? 0;
      }
      return {
        code: s.code,
        name: s.name,
        isPlant: s.is_plant,
        isActive: s.is_active,
        managerName: s.manager_name,
        totalPieces: total,
      };
    }),
  };
}

async function getInventoryMovementsRecent(input: Record<string, unknown>) {
  const admin = createAdminSupabaseClient();
  const limit = Math.min(200, Math.max(1, Number(input.limit) || 25));
  const statusFilter = typeof input.status === "string" ? input.status : null;
  const typeFilter = typeof input.type === "string" ? input.type : null;
  const siteInput = typeof input.site === "string" ? input.site.trim() : "";

  let window: { from: string; to: string; label: string };
  if (typeof input.hours_ago === "number") {
    const w = istHoursWindow(input.hours_ago);
    window = { from: w.from, to: w.to, label: `last ${w.hours} hr` };
  } else {
    const r = typeof input.range === "string"
      ? (input.range as "today" | "yesterday" | "this_week" | "this_month")
      : "today";
    const w = istRange(r);
    window = { from: w.from, to: w.to, label: r };
  }

  let siteIdFilter: string | null = null;
  if (siteInput) {
    const r = await resolveSite(admin, siteInput);
    if (r.kind === "not_found") {
      return { error: `Site "${siteInput}" not found.`, availableSites: r.available };
    }
    siteIdFilter = r.id;
  }

  let q = admin
    .from("inventory_movements")
    .select(
      "id, batch_id, movement_type, status, from_site_id, to_site_id, component_id, qty, " +
        "proposed_by, proposed_at, batch_note, approved_at, rejected_at, cancelled_at, " +
        "sites!inventory_movements_from_site_id_fkey(code, name), " +
        "scaffolding_components(name, component_type)",
    )
    .gte("proposed_at", window.from)
    .lt("proposed_at", window.to)
    .order("proposed_at", { ascending: false })
    .limit(limit * 6);
  if (statusFilter) q = q.eq("status", statusFilter);
  if (typeFilter) q = q.eq("movement_type", typeFilter);
  if (siteIdFilter) q = q.or(`from_site_id.eq.${siteIdFilter},to_site_id.eq.${siteIdFilter}`);

  const { data: rawMov, error } = await q;
  if (error) throw new Error(error.message);

  // Hand-typed shape — PostgREST joined-row typing widens to a union
  // including GenericStringError, which TS won't index into safely.
  type MovRow = {
    id: string;
    batch_id: string;
    movement_type: string;
    status: string;
    from_site_id: string | null;
    to_site_id: string | null;
    component_id: string;
    qty: number;
    proposed_by: string;
    proposed_at: string;
    batch_note: string | null;
    scaffolding_components: { name: string } | { name: string }[] | null;
  };
  const movRows = (rawMov ?? []) as unknown as MovRow[];

  // Resolve site names via a second tiny lookup (the embedded join above
  // only covers from_site_id; we want both sides for narration).
  const allSiteIds = new Set<string>();
  for (const m of movRows) {
    if (m.from_site_id) allSiteIds.add(m.from_site_id);
    if (m.to_site_id) allSiteIds.add(m.to_site_id);
  }
  const siteMap = new Map<string, { code: string; name: string }>();
  if (allSiteIds.size > 0) {
    const { data: siteRows } = await admin
      .from("sites")
      .select("id, code, name")
      .in("id", Array.from(allSiteIds));
    for (const s of siteRows ?? []) {
      siteMap.set((s as { id: string }).id, { code: (s as { code: string }).code, name: (s as { name: string }).name });
    }
  }

  // Group by batch_id
  type Batch = {
    batchId: string;
    type: string;
    status: string;
    fromSite: string | null;
    toSite: string | null;
    totalQty: number;
    components: Array<{ name: string; qty: number }>;
    proposedBy: string | null;
    proposedAt: string;
    batchNote: string | null;
  };
  const batches = new Map<string, Batch>();
  const proposerIds = new Set<string>();
  for (const m of movRows) {
    proposerIds.add(m.proposed_by);
    const fromSite = m.from_site_id ? siteMap.get(m.from_site_id)?.name ?? null : null;
    const toSite = m.to_site_id ? siteMap.get(m.to_site_id)?.name ?? null : null;
    const compInfo = Array.isArray(m.scaffolding_components)
      ? m.scaffolding_components[0]
      : m.scaffolding_components;
    const compName = compInfo?.name ?? "Unknown";
    const existing = batches.get(m.batch_id);
    if (existing) {
      existing.totalQty += Number(m.qty);
      existing.components.push({ name: compName, qty: Number(m.qty) });
    } else {
      batches.set(m.batch_id, {
        batchId: m.batch_id,
        type: m.movement_type,
        status: m.status,
        fromSite,
        toSite,
        totalQty: Number(m.qty),
        components: [{ name: compName, qty: Number(m.qty) }],
        proposedBy: null,
        proposedAt: m.proposed_at,
        batchNote: m.batch_note,
      });
    }
  }

  // Resolve proposer names
  if (proposerIds.size > 0) {
    const { data: profs } = await admin
      .from("profiles")
      .select("id, full_name")
      .in("id", Array.from(proposerIds));
    const nameMap = new Map<string, string>();
    for (const p of profs ?? []) {
      nameMap.set((p as { id: string }).id, (p as { full_name?: string }).full_name ?? "Unknown");
    }
    for (const m of movRows) {
      const b = batches.get(m.batch_id);
      if (b && !b.proposedBy) {
        b.proposedBy = nameMap.get(m.proposed_by) ?? "Unknown";
      }
    }
  }

  const list = Array.from(batches.values())
    .sort((a, b) => new Date(b.proposedAt).getTime() - new Date(a.proposedAt).getTime())
    .slice(0, limit);

  // User-facing label remapping: receive→Buy, writeoff→Destroyed.
  function userLabel(t: string) {
    if (t === "receive") return "Buy";
    if (t === "writeoff") return "Destroyed";
    if (t === "issue") return "Issue";
    if (t === "return") return "Return";
    return t;
  }

  return {
    window: window.label,
    count: list.length,
    batches: list.map((b) => ({
      batchId: b.batchId,
      type: b.type,
      typeLabel: userLabel(b.type),
      status: b.status,
      fromSite: b.fromSite,
      toSite: b.toSite,
      totalQty: b.totalQty,
      componentsCount: b.components.length,
      components: b.components,
      proposedBy: b.proposedBy,
      proposedAt: b.proposedAt,
      batchNote: b.batchNote,
    })),
  };
}

async function getInventoryAuditQueue() {
  const admin = createAdminSupabaseClient();
  const { data: rawData, error } = await admin
    .from("inventory_movements")
    .select(
      "id, batch_id, movement_type, from_site_id, to_site_id, component_id, qty, proposed_by, proposed_at, batch_note, scaffolding_components(name)",
    )
    .eq("status", "pending_approval")
    .order("proposed_at", { ascending: true });
  if (error) throw new Error(error.message);

  type MovRow = {
    id: string;
    batch_id: string;
    movement_type: string;
    from_site_id: string | null;
    to_site_id: string | null;
    component_id: string;
    qty: number;
    proposed_by: string;
    proposed_at: string;
    batch_note: string | null;
    scaffolding_components: { name: string } | { name: string }[] | null;
  };
  const movRows = (rawData ?? []) as unknown as MovRow[];

  const allSiteIds = new Set<string>();
  const proposerIds = new Set<string>();
  for (const m of movRows) {
    if (m.from_site_id) allSiteIds.add(m.from_site_id);
    if (m.to_site_id) allSiteIds.add(m.to_site_id);
    proposerIds.add(m.proposed_by);
  }

  const [siteRes, profRes] = await Promise.all([
    allSiteIds.size > 0
      ? admin.from("sites").select("id, code, name").in("id", Array.from(allSiteIds))
      : Promise.resolve({ data: [] as Array<{ id: string; code: string; name: string }> }),
    proposerIds.size > 0
      ? admin.from("profiles").select("id, full_name").in("id", Array.from(proposerIds))
      : Promise.resolve({ data: [] as Array<{ id: string; full_name: string | null }> }),
  ]);
  const siteMap = new Map<string, string>();
  for (const s of (siteRes as { data: Array<{ id: string; name: string }> }).data ?? []) {
    siteMap.set(s.id, s.name);
  }
  const nameMap = new Map<string, string>();
  for (const p of (profRes as { data: Array<{ id: string; full_name: string | null }> }).data ?? []) {
    nameMap.set(p.id, p.full_name ?? "Unknown");
  }

  type Batch = {
    batchId: string;
    type: string;
    fromSite: string | null;
    toSite: string | null;
    totalQty: number;
    components: Array<{ name: string; qty: number }>;
    proposedBy: string;
    proposedAt: string;
    ageHours: number;
    batchNote: string | null;
  };
  const now = Date.now();
  const batches = new Map<string, Batch>();
  for (const m of movRows) {
    const comp = Array.isArray(m.scaffolding_components)
      ? m.scaffolding_components[0]
      : m.scaffolding_components;
    const compName = comp?.name ?? "Unknown";
    const existing = batches.get(m.batch_id);
    if (existing) {
      existing.totalQty += Number(m.qty);
      existing.components.push({ name: compName, qty: Number(m.qty) });
    } else {
      const proposedAtIso = m.proposed_at;
      const ageHours = Math.round((now - new Date(proposedAtIso).getTime()) / 3_600_000);
      batches.set(m.batch_id, {
        batchId: m.batch_id,
        type: m.movement_type,
        fromSite: m.from_site_id ? siteMap.get(m.from_site_id) ?? null : null,
        toSite: m.to_site_id ? siteMap.get(m.to_site_id) ?? null : null,
        totalQty: Number(m.qty),
        components: [{ name: compName, qty: Number(m.qty) }],
        proposedBy: nameMap.get(m.proposed_by) ?? "Unknown",
        proposedAt: proposedAtIso,
        ageHours,
        batchNote: m.batch_note,
      });
    }
  }

  function userLabel(t: string) {
    if (t === "receive") return "Buy";
    if (t === "writeoff") return "Destroyed";
    if (t === "issue") return "Issue";
    if (t === "return") return "Return";
    return t;
  }

  return {
    count: batches.size,
    batches: Array.from(batches.values()).map((b) => ({
      batchId: b.batchId,
      type: b.type,
      typeLabel: userLabel(b.type),
      fromSite: b.fromSite,
      toSite: b.toSite,
      totalQty: b.totalQty,
      components: b.components,
      proposedBy: b.proposedBy,
      proposedAt: b.proposedAt,
      ageHours: b.ageHours,
      batchNote: b.batchNote,
    })),
  };
}

async function listScaffoldingComponents(input: Record<string, unknown>) {
  const admin = createAdminSupabaseClient();
  const activeOnly = input.active_only !== false;
  const nameContains = typeof input.name_contains === "string" ? input.name_contains.trim() : "";

  const snap = await loadInventorySnapshotForAi();
  let comps = snap.comps;
  if (activeOnly) comps = comps.filter((c) => c.is_active);
  if (nameContains) {
    const needle = nameContains.toLowerCase();
    comps = comps.filter((c) => c.name.toLowerCase().includes(needle));
  }

  return {
    count: comps.length,
    components: comps.map((c) => {
      let total = 0;
      for (const s of snap.sites) {
        total += snap.stock.get(snap.key(c.id, s.id))?.onHand ?? 0;
      }
      return {
        name: c.name,
        type: c.component_type,
        sizeSpec: c.size_spec,
        unit: c.unit,
        active: c.is_active,
        totalQuantity: total,
      };
    }),
  };
}
