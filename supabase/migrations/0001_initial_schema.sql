-- ============================================================================
-- Uy-Laurio Legal Portal — Initial Schema
-- ----------------------------------------------------------------------------
-- Defines the core domain tables, enums, and helper functions.
-- Row Level Security policies live in 0002_rls_policies.sql.
-- Storage buckets/policies live in 0003_storage.sql.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ─── Enums ──────────────────────────────────────────────────────────────────

do $$ begin
  create type user_role as enum ('user', 'admin');
exception when duplicate_object then null; end $$;

-- Mirrors the StatusKey union used by the UI.
do $$ begin
  create type case_status as enum ('pending', 'progress', 'waiting', 'done');
exception when duplicate_object then null; end $$;

do $$ begin
  create type case_phase as enum (
    'Submitted',
    'Under Review',
    'In Progress',
    'Requirement Verification',
    'Final Sign-off / Execution'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type service_module as enum ('notarization', 'deed', 'ejs');
exception when duplicate_object then null; end $$;

do $$ begin
  create type notification_channel as enum ('email', 'sms');
exception when duplicate_object then null; end $$;

do $$ begin
  create type notification_status as enum ('pending', 'confirmed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type appointment_status as enum ('booked', 'cancelled', 'completed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type override_type as enum ('closed', 'halfday', 'custom');
exception when duplicate_object then null; end $$;

-- ─── updated_at helper ──────────────────────────────────────────────────────

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ─── profiles (extends auth.users) ──────────────────────────────────────────

create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text        not null default '',
  email       text        not null,
  phone       text,
  role        user_role   not null default 'user',
  avatar_initials text generated always as (
    upper(left(coalesce(nullif(full_name, ''), email), 2))
  ) stored,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Create a profile automatically whenever an auth user is created.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, phone, role)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''),
    new.raw_user_meta_data ->> 'phone',
    'user'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Role lookup used by RLS policies (security definer avoids recursive RLS).
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- ─── cases ──────────────────────────────────────────────────────────────────

create sequence if not exists public.case_reference_seq;

create table if not exists public.cases (
  id            uuid primary key default gen_random_uuid(),
  reference     text unique not null default (
    'UL-' || to_char(now(), 'YYYY') || '-'
    || lpad(nextval('public.case_reference_seq')::text, 3, '0')
  ),
  client_id     uuid not null references public.profiles (id) on delete cascade,
  module        service_module not null,
  module_detail text,
  status        case_status not null default 'pending',
  phase         case_phase  not null default 'Submitted',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_cases_client on public.cases (client_id);
create index if not exists idx_cases_status on public.cases (status);

create trigger trg_cases_updated_at
  before update on public.cases
  for each row execute function public.set_updated_at();

-- ─── documents ──────────────────────────────────────────────────────────────

create table if not exists public.documents (
  id           uuid primary key default gen_random_uuid(),
  case_id      uuid not null references public.cases (id) on delete cascade,
  owner_id     uuid not null references public.profiles (id) on delete cascade,
  name         text not null,
  storage_path text not null,
  size_bytes   bigint not null default 0,
  mime_type    text,
  status       case_status not null default 'pending',
  submitted_at timestamptz not null default now()
);

create index if not exists idx_documents_case on public.documents (case_id);
create index if not exists idx_documents_owner on public.documents (owner_id);

-- ─── case_requirements (per-case checklist) ─────────────────────────────────

create table if not exists public.case_requirements (
  id          uuid primary key default gen_random_uuid(),
  case_id     uuid not null references public.cases (id) on delete cascade,
  name        text not null,
  note        text,
  urgent      boolean not null default false,
  fulfilled   boolean not null default false,
  document_id uuid references public.documents (id) on delete set null,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists idx_requirements_case on public.case_requirements (case_id);

-- ─── notifications ──────────────────────────────────────────────────────────

create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  case_id    uuid references public.cases (id) on delete cascade,
  recipient  text not null,
  channel    notification_channel not null,
  message    text not null,
  status     notification_status not null default 'pending',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_case on public.notifications (case_id);

-- ─── appointments ───────────────────────────────────────────────────────────

create table if not exists public.appointments (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references public.profiles (id) on delete cascade,
  appointment_date date not null,
  time_slot        text not null,
  status           appointment_status not null default 'booked',
  created_at       timestamptz not null default now(),
  unique (appointment_date, time_slot)
);

create index if not exists idx_appointments_client on public.appointments (client_id);
create index if not exists idx_appointments_date on public.appointments (appointment_date);

-- ─── schedule_overrides (office closures / custom hours) ─────────────────────

create table if not exists public.schedule_overrides (
  id            uuid primary key default gen_random_uuid(),
  override_date date not null unique,
  type          override_type not null,
  open_time     text,
  close_time    text,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists idx_overrides_date on public.schedule_overrides (override_date);
