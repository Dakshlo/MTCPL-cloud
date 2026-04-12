# MTCPL Cloud Starter

This project is the cloud-ready version of the offline `index.html` prototype.

## Recommended stack

- Frontend and app server: Next.js App Router
- Auth and database: Supabase
- Hosting: Vercel
- Shared data: PostgreSQL on Supabase

This stack is a good fit because:

- Users can access the app from any phone or computer
- You get real login and session management
- You can use mobile number or email authentication
- Row Level Security can restrict what each role can read or update
- Vercel is optimized for Next.js deployment

## User roles

- `owner`: full visibility and control
- `planner`: planning and inventory management
- `block_entry`: only stock blocks
- `slab_entry`: only slab requirements
- `worker`: only cutting workflow
- `carving_assigner`: only vendor assignment
- `dispatch`: carving visibility and dispatch
- `vendor`: only their own assigned carving jobs

## What is already scaffolded

- Next.js project structure under `src/`
- Supabase browser and server clients
- Login page for mobile or email based auth
- Authenticated app layout with sidebar
- Role-aware routes:
  - `/dashboard`
  - `/blocks`
  - `/slabs`
  - `/cutting`
  - `/carving-assign`
  - `/carving`
- Database schema and RLS starter SQL in `supabase/schema.sql`

## Setup

1. Install Node.js 20 or newer.
2. In this folder, run:

```bash
npm install
```

3. Create a Supabase project.
4. Copy `.env.example` to `.env.local` and fill in the real values.
5. Open the Supabase SQL editor and run `supabase/schema.sql`.
6. Start the app:

```bash
npm run dev
```

## Supabase auth setup

Recommended production setup:

- Office users: email and password
- Workers and vendors: mobile number with OTP or phone plus password
- Enable MFA for users relying on phone numbers
- Turn on CAPTCHA protection for auth forms

Important note from Supabase docs: phone numbers can be recycled by telecom providers, so phone-plus-password should be protected with MFA.

## Role assignment

New users are created in `profiles` automatically by the trigger in the SQL file.

After a user signs up, the owner should update their `profiles.role`:

```sql
update public.profiles
set role = 'owner'
where phone = '+91XXXXXXXXXX';
```

For a vendor login, also assign the matching `vendor_id`.

## Deployment

Recommended path:

1. Push this project to GitHub
2. Import the repo into Vercel
3. Add the same Supabase environment variables in Vercel
4. Deploy
5. Set your production URL in Supabase Auth redirect settings

## Next build steps

These pieces are still to be implemented:

- CRUD forms and server actions for blocks and slabs
- The guillotine optimizer ported from the offline prototype
- Session approval actions
- Carving assignment form actions
- Dispatch logging actions
- Audit trail and activity history
- File upload for drawings and vendor notes
- SMS provider configuration for production OTP
