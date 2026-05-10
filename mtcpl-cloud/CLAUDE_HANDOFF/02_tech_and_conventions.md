# 02 · Tech stack and code conventions

## Stack

- **Next.js 15** with the App Router. Server components by default; `"use client"` only where state / event handlers / browser APIs need it.
- **TypeScript strict** mode.
- **Supabase** — Postgres (with RLS), Auth (phone OTP + email), Storage (vendor photos), Realtime (heartbeat / refresh trigger).
- **Tailwind-style CSS variables** (`var(--gold-dark)`, `var(--surface)`, `var(--muted)` etc) defined in `src/app/globals.css`. Inline styles preferred over class names — most components use inline `style={{}}`.
- **xlsx** package (already a dep) for Excel exports.
- **Vercel** hosting. `main` branch auto-deploys.

## Repo layout

```
mtcpl-cloud/
├─ src/
│  ├─ app/
│  │  ├─ (app)/                 # logged-in app shell with sidebar + topbar
│  │  │  ├─ blocks/             # block inventory
│  │  │  ├─ slabs/              # slab requirements
│  │  │  ├─ slabs/ready/        # ready sizes
│  │  │  ├─ slabs/view/         # plan generator
│  │  │  ├─ planning/           # planning workbench
│  │  │  ├─ cutting/            # cutting sessions + Done flow
│  │  │  ├─ carving/            # carving jobs (carving head's surface)
│  │  │  ├─ carving/floor/      # floor view + TV mode
│  │  │  ├─ carving/reports/    # CNC monthly report (HTML view)
│  │  │  ├─ carving/vendors/    # vendor management
│  │  │  ├─ vendor/             # vendor cockpit (vendor role's home page)
│  │  │  ├─ dispatch/           # dispatch station
│  │  │  ├─ challan/            # challan archive
│  │  │  ├─ dashboard/          # owner dashboard (greeting + push panel + entry cards)
│  │  │  ├─ settings/           # users, temples, stones, audit log, backup
│  │  │  ├─ ask-ai/             # AI chat surface (Anthropic API)
│  │  │  ├─ profile/            # user profile edits
│  │  ├─ (print)/               # print-only routes (no app chrome)
│  │  │  ├─ cutting/[id]/print/  # cutting plan sheet
│  │  │  ├─ cutting/[id]/labels/ # post-cut slab labels (CFT/SQFT, write IDs on physical slabs)
│  │  ├─ (embed)/               # iframe-embeddable routes (peek modals)
│  │  ├─ api/
│  │  │  ├─ reports/cnc-monthly.xlsx/   # XLSX route handler
│  │  │  ├─ ai/                          # AI tool endpoints
│  │  ├─ login/, pending/                # auth + holding pages
│  ├─ components/                # shared UI: peek-section, peek-iframe, sidebar, etc
│  ├─ lib/                       # auth, supabase clients, types, helpers, AI tools
├─ supabase/
│  ├─ migrations/                # numbered SQL files (00X_…sql)
│  ├─ schema.sql                 # initial schema dump
├─ CLAUDE_HANDOFF/               # ← you are here
```

## Auth & roles

- `src/lib/auth.ts` — `requireAuth(roles?)` is the gate. Use it in every server component / server action.
- `developer` is a superuser — bypasses all role checks (line ~130 in `auth.ts`).
- Profiles live in `public.profiles`. Auth users in `auth.users`. They share `id`.
- `getDefaultRouteForRole(role)` — landing page after login. Vendor → `/vendor`, carving_head → `/slabs/ready`, etc.

## Server actions pattern

Every mutation lives in a `actions.ts` file inside the relevant route folder:

```ts
"use server";

export async function someAction(formData: FormData) {
  const { profile } = await requireAuth(["developer", "owner", ...]);
  const admin = createAdminSupabaseClient(); // bypasses RLS
  // ... do work ...
  await logAudit(profile.id, "event_name", "entity_type", entity_id, { ...details });
  refreshAll();
  redirect("/somewhere?toast=Success");
}
```

- Actions take `FormData` (so `<form action={...}>` works directly).
- Surface errors: don't redirect with a generic toast on a Supabase error — embed the error message: `redirect(\`/page?toast=\${encodeURIComponent('Failed: ' + err.message)}\`)`. The user has been bitten by silent failures.
- Many actions support `stay=1` form field — when set, return instead of redirect (used by peek modals that close themselves).
- `refreshAll()` revalidates a known set of paths so caches don't go stale. Add new paths to it when you create a new section.
- Audit + recordEvent calls go AFTER the actual work, not before.

## Server-action gotchas (learned the hard way)

1. **`maxDuration` cannot live in `actions.ts`** — only async function exports allowed in `"use server"`. Put `export const maxDuration = 60;` on the related `page.tsx` instead.
2. **Schema cache stale after migration** — Supabase's PostgREST caches the schema. After a column add, run `NOTIFY pgrst, 'reload schema';` at the end of the migration. Already in the migration template.
3. **`select("*")` is safer than enumerating columns** — if a column doesn't exist on prod (because a migration wasn't run yet), Supabase returns the whole row as null with `.single()`/`.maybeSingle()`. Better to `select("*")` and read what you need.
4. **`.maybeSingle()` over `.single()`** — `.single()` errors on 0 rows, `.maybeSingle()` returns null. Use the latter for "find the row if it exists".
5. **PostgREST 1000-row cap** — single `.select()` returns at most 1000 rows. For tables that can grow large (`slab_requirements`), paginate with `.range(offset, offset+999)` in a loop.
6. **Server action returning a redirect throws `NEXT_REDIRECT`**. If you wrap an action call in try/catch, re-throw the redirect digest. `finish-block-form.tsx` has the canonical pattern.

## Patterns we use a lot

### Center-peek modals

- **Click a card → modal opens centered over the working area** (skips the sidebar). Esc / click-outside closes.
- The modal's left edge is `var(--content-left)` (= sidebar width on desktop, 0 on mobile).
- Two flavours:
  - `<PeekSection>` (`src/components/peek-section.tsx`) — for content already server-rendered as JSX children
  - `<PeekIframe>` (`src/components/peek-iframe.tsx`) — embeds an `/embed/...` route inside an iframe (heavier; for full pages)
- Bespoke modals (e.g. `JobDetailPeek`, `TempleSlabsPeek`, `MachineHistoryModal`) use the same overlay pattern inline.

### Toast pattern

URL-driven: `?toast=Some+text` → the `<Toast>` component reads it and shows it. Server actions redirect with toasts. No client-side toast library.

### Print-only routes

Live under `(print)/...`. No sidebar, no topbar. Use `@media print` CSS to drop the print button bar when actually printing. `<PrintBtn>` triggers `window.print()`.

### Live ticking timers

- Set up a `now` state at the top of a client component: `const [now, setNow] = useState(Date.now());`
- 30s `setInterval` updates it (carving runs are hours-long, so 30s is plenty).
- Compute durations from event timestamps: `(now - new Date(loaded_at).getTime()) / 60000`.
- Format with the standard `fmtDuration` helper (minutes → days/hours).

### Heartbeat for online users

- `<Heartbeat>` component pings `profiles.last_seen_at` every minute.
- Used for "online users" pill on the dashboard.

## Things we don't do

- **No Tailwind class strings** for major styling — inline `style={{}}` is the convention. Tailwind's there but used sparingly.
- **No client-side data libraries** (no react-query, swr). Server components fetch; server actions mutate; `router.refresh()` invalidates.
- **No state machines / zustand / redux**. Component-local `useState` is enough for everything we've built.
- **No new dependencies without asking**. The deps list is intentionally small.
- **No emojis added unilaterally**. Use them where Daksh has already established a pattern (📋 for queues, ✓ for done, ⚡ for urgent, 🚚 for dispatch, 📺 for TV, etc).

## Coding style

- Comments explain *why*, not *what*. Lots of "Why this matters: …" notes.
- Variables are descriptive (`carvingItemId`, not `id` when context is ambiguous).
- Component names PascalCase. Server actions camelCase ending in `Action`. Server-action types explicit (`type FormData = ...`).
- Cast Supabase rows with explicit shape types — `select("*")` returns `Record<string, unknown>` with our usage.
- `if (!something) redirect/throw` early-return pattern. No deeply nested ifs.
