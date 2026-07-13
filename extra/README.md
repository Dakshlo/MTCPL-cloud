# Personal Ledger — extracted module

This folder is a self-contained copy of the **Personal Ledger** module
originally built inside `mtcpl-cloud`. It's been pulled out so it can
be dropped into a fresh Next.js project and worked on independently.

The original lives in MTCPL Cloud under
`src/app/(app)/personal-ledger/*` and was built as a **personal**
accounts-receivable scratchpad — *not* a company-books ledger. That
framing is intentional and worth preserving in the new project. See
"What this is / isn't" below.

---

## What this is

A small AR (accounts-receivable) tool for **one user** to track:

- **Parties** (informal counterparties — friends, side projects, etc.) — owner-scoped, PIN-locked.
- **Invoices** raised to each party, with line items measured in SFT or CFT, manual GST amount, computed total.
- **Receipts** received from each party, tagged with a *bucket* (e.g. ICICI, Cash) so you can see "₹X received via ICICI, ₹Y via Cash."
- **Outstanding** = total invoiced − total received, per party + across all.
- **Per-party styled Excel export** with three sheets (Summary / Invoices / Receipts).

## What this is NOT

- **Not company books.** Every row is scoped to one owner; another
  user signing in sees their own parties only. This is by design — if
  you bend it into a company-wide ledger, you're rebuilding something
  that should have proper accounting controls.
- **Not anonymous.** Every mutation (invoice added, receipt cancelled,
  PIN set/failed/unlocked) writes to an audit log. The 4-digit PIN
  locks *viewing*; it doesn't hide *traces*. If you remove the audit
  hook, do so deliberately — don't silently no-op it.
- **Not a fortress.** A 4-digit PIN is a casual-eyes speedbump, not a
  defence against motivated attack. The data is private to one user
  via `owner_profile_id` + RLS; the PIN is "don't show this to
  whoever's behind me on the train."

---

## Folder layout

```
extra/
├── README.md                          ← you are here
├── supabase/
│   └── migrations/
│       ├── 055_personal_ledger.sql      Four tables + RLS + indexes
│       └── 056_personal_ledger_party_pin.sql   Adds entry_pin_hash column
└── src/
    ├── app/
    │   ├── personal-ledger/             Route group (party list, detail, buckets)
    │   │   ├── page.tsx                 Party list (server)
    │   │   ├── personal-ledger-client.tsx
    │   │   ├── actions.ts               Server actions (add/rename/archive/PIN…)
    │   │   ├── _ui/center-modal.tsx     Reusable modal shell
    │   │   ├── [partyId]/
    │   │   │   ├── page.tsx             Party detail (server, PIN-gated)
    │   │   │   └── party-detail-client.tsx
    │   │   └── buckets/
    │   │       ├── page.tsx             Bucket admin (server)
    │   │       └── buckets-client.tsx
    │   └── api/personal-ledger/[partyId]/export.xlsx/route.ts   Styled XLSX export
    ├── components/
    │   └── loading-overlay.tsx          Generic spinning-circle overlay (replaces MTCPL logo overlay)
    └── lib/
        ├── auth.ts                      ⚠ STUB — wire to your auth provider
        ├── supabase-admin.ts            ⚠ STUB — wire to your Supabase service role
        ├── audit.ts                     ⚠ STUB — wire to your audit_logs table
        ├── personal-ledger-types.ts     Profile type
        ├── personal-ledger-permissions.ts   canUsePersonalLedger(profile)
        ├── personal-ledger-seed.ts      Idempotent "seed B + C buckets"
        ├── personal-ledger-party-auth.ts   scrypt PIN hashing + HMAC cookie sign
        └── personal-ledger-ui.tsx       UI tokens (palette, button styles, VendorAvatar)
```

---

## Setup (for the new Claude Code session)

### 1. Drop into a fresh Next.js 15 project

```bash
npx create-next-app@latest my-personal-ledger --typescript --app --no-tailwind
cd my-personal-ledger
# Copy the contents of this `extra/` folder INTO the new project,
# merging src/ and supabase/ into the existing layout.
```

If your `tsconfig.json` doesn't already have a `@/*` path alias, add:

```json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

### 2. Install dependencies

```bash
npm install @supabase/supabase-js exceljs
```

Also add ExcelJS as a server-external package in `next.config.ts` so
Turbopack doesn't try to bundle its Node-only internals:

```ts
// next.config.ts
const nextConfig = {
  serverExternalPackages: ["exceljs"],
};
```

### 3. Set up Supabase

1. Create a new Supabase project.
2. Run the migrations IN ORDER, in the SQL editor:
   - `supabase/migrations/055_personal_ledger.sql`
   - `supabase/migrations/056_personal_ledger_party_pin.sql`
3. Add to `.env.local`:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=ey...
   SUPABASE_SERVICE_ROLE_KEY=ey...
   PERSONAL_LEDGER_PIN_SECRET=<long random string — used to HMAC-sign unlock cookies>
   ```

### 4. Wire the three stubs

These three files must be replaced before the module runs:

| File | What to do |
|---|---|
| `src/lib/auth.ts` | Return `{ profile: { id, role } }` for the signed-in user. Redirect to `/login` if not. The file has commented-out examples for Supabase Auth, NextAuth, and single-user mode. |
| `src/lib/supabase-admin.ts` | Return `createClient(URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })`. Example in the file. |
| `src/lib/audit.ts` | Insert a row into your `audit_logs` table. A minimum schema is in the file's comment. The default stub `console.warn`s — fine for local dev, NOT for prod. |

The original module also expected an `audit_logs` table in the same
Supabase project. If you're starting fresh, create one:

```sql
CREATE TABLE audit_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_profile_id UUID NOT NULL,
  action          TEXT NOT NULL,
  entity_kind     TEXT NOT NULL,
  entity_id       TEXT NOT NULL,
  details         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 5. Permission model

`src/lib/personal-ledger-permissions.ts` currently allows roles
`"developer"` and `"owner"`. Adjust to whatever your project uses, or
relax to "any signed-in user" if it's truly single-user.

### 6. Run

```bash
npm run dev
```

Navigate to `/personal-ledger`.

First visit: empty list. Click **+ Add party** → enter name + 4-digit
PIN → submit. The new party shows with blurred amounts and a 🔒 chip.
Click the row → PIN prompt → enter PIN → you're in.

The **buckets** at `/personal-ledger/buckets` auto-seed two default
buckets named "B" and "C" on first use. Rename them to "ICICI",
"Cash", etc. from that page (or use the direct URL).

---

## Things you'll probably want to change

The module was tailored to one user's preferences. The new session can
re-style freely. Most-likely customisations:

| What | Where |
|---|---|
| Brand colour (currently indigo) | `ACCOUNTS_TOKENS.accent` in `src/lib/personal-ledger-ui.tsx` |
| Currency symbol (₹) | Search-and-replace `₹` across `*.tsx` + `route.ts` |
| Locale for `toLocaleString` (currently `"en-IN"`) | Same |
| Stone-type presets (Pink Stone / White Stone / Marble / …) | `STONE_TYPE_PRESETS` constant in `party-detail-client.tsx` |
| SFT / CFT unit options | `unit: "sft" \| "cft"` in the invoice item type — found in `actions.ts` (`parseItems`) and `party-detail-client.tsx` |
| Default bucket labels ("B", "C") | `ensureDefaultBucketsForOwner` in `src/lib/personal-ledger-seed.ts` |
| Bucket pill palette (B=blue, C=grey, other=emerald) | `bucketPalette()` in `party-detail-client.tsx` AND `bucketColors()` in the Excel export route |
| PIN length (currently 4 digits) | Regex `/^\d{4}$/` in `actions.ts` + the input `maxLength={4}` in `personal-ledger-client.tsx` |
| Unlock cookie lifetime (currently browser-session) | Add `maxAge` to the `cookieStore.set(...)` calls in `actions.ts` |

Don't rip out:

- `owner_profile_id` filtering on every query — that's what keeps
  data scoped to one user.
- The `logAudit(...)` calls — that's the traceability the module was
  designed around.
- The "PERSONAL · NOT COMPANY BOOKS" framing if you'd otherwise tell
  yourself it's "fine for company use." If it really is fine for
  company use, you're building company books — use a proper
  accounting package, not this.

---

## Mig-prefixed comments (history)

You'll see comments like `// Mig 055 follow-on (Daksh: …)` throughout.
These reference the original MTCPL Cloud migration numbers and the
person who asked for each change. They're informational only — the
new session can leave them, edit them, or strip them. Leaving them
preserves the design history if you ever want to know why a
particular line exists.

---

## License / attribution

This is your code. Do what you want with it. No upstream license to
honour — it was written for one project, extracted for another.
