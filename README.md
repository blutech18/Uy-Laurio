# Uy-Laurio Legal & Notarial Portal

A client and admin portal for tracking legal document submissions, case
verification, notifications, and appointment scheduling.

**Stack:** React 18 + TypeScript + Vite + Tailwind CSS v4, backed by
**Supabase** (Postgres, Auth, Storage) with Row Level Security.

## Architecture

Security is enforced at the database layer, so the browser talks to Supabase
directly using the public anon key while Row Level Security (RLS) restricts
every query to the rows the signed-in user is allowed to see.

```
src/
  lib/        env validation, Supabase client, formatting helpers
  types/      domain models (mirror the DB schema)
  services/   data-access layer (one module per resource)
  hooks/      React data hooks (loading / error / reload state)
  context/    AuthContext (session + profile + role)
  app/        UI (App.tsx)
supabase/
  migrations/ SQL schema, RLS policies, storage, triggers
```

Data flow: **UI → hooks → services → Supabase (RLS) → Postgres**.

## Prerequisites

- Node.js 18+
- A Supabase project (free tier works)

## 1. Configure environment

Copy the example env file and fill in your project values from
**Supabase → Project Settings → API**:

```bash
cp .env.example .env
```

```
VITE_SUPABASE_URL=https://<your-project>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-key>
```

The anon key is safe to expose in the client — access is controlled by RLS.

## 2. Apply the database schema

Run the migrations in order against your Supabase project. Either paste each
file into the **Supabase SQL Editor**, or use the Supabase CLI:

```bash
supabase db push        # if using the Supabase CLI with this repo linked
```

Migration order:

1. `0001_initial_schema.sql` — tables, enums, profile auto-creation
2. `0002_rls_policies.sql` — row level security policies
3. `0003_storage.sql` — private `documents` bucket + storage policies
4. `0004_default_requirements.sql` — auto-seed per-service checklists

## 3. Enable auth providers

- **Email/Password** is on by default.
- For **Continue with Google**, enable the Google provider under
  **Supabase → Authentication → Providers** and add your OAuth credentials.

New users are created with the `user` role. To promote an account to admin,
run this once in the SQL editor after the person has signed up:

```sql
update public.profiles set role = 'admin' where email = 'admin@example.com';
```

## 4. Install and run

```bash
npm install
npm run dev        # start the dev server
```

## Build process

```bash
npm run typecheck  # TypeScript type-check only
npm run build      # type-check, then production build (fails on type errors)
npm run preview    # preview the production build locally
```

The build runs `tsc --noEmit` before `vite build`, so type errors block a
release.

## What each role sees

- **Client:** dashboard with live document checklist and progress, new
  submission flow (uploads to private storage + creates a case), submission
  history, appointment booking, and profile editing.
- **Admin:** case metrics and worklist, per-case verification with phase
  updates and approve/flag actions, client notifications, and an office
  schedule manager (closures / half-days / custom hours).
