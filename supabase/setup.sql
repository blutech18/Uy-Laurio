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
-- ============================================================================
-- Uy-Laurio Legal Portal — Row Level Security
-- ----------------------------------------------------------------------------
-- Security is enforced at the database layer. The frontend uses the public
-- anon key (safe to expose); every table below denies access by default and
-- only grants the minimum each role needs.
--   * Clients  -> may read/write only rows tied to their own account.
--   * Admins   -> may read all rows and manage operational data.
-- ============================================================================

alter table public.profiles          enable row level security;
alter table public.cases             enable row level security;
alter table public.documents         enable row level security;
alter table public.case_requirements enable row level security;
alter table public.notifications     enable row level security;
alter table public.appointments      enable row level security;
alter table public.schedule_overrides enable row level security;

-- ─── profiles ───────────────────────────────────────────────────────────────

create policy "profiles_select_self_or_admin"
  on public.profiles for select
  using (id = auth.uid() or public.is_admin());

create policy "profiles_update_self"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid() and role = 'user');

create policy "profiles_admin_update_all"
  on public.profiles for update
  using (public.is_admin());

-- ─── cases ────────────────────────────────────────────────────────────────--

create policy "cases_select_own_or_admin"
  on public.cases for select
  using (client_id = auth.uid() or public.is_admin());

create policy "cases_insert_own"
  on public.cases for insert
  with check (client_id = auth.uid());

create policy "cases_admin_write"
  on public.cases for update
  using (public.is_admin());

create policy "cases_admin_delete"
  on public.cases for delete
  using (public.is_admin());

-- ─── documents ──────────────────────────────────────────────────────────────

create policy "documents_select_own_or_admin"
  on public.documents for select
  using (owner_id = auth.uid() or public.is_admin());

create policy "documents_insert_own"
  on public.documents for insert
  with check (
    owner_id = auth.uid()
    and exists (
      select 1 from public.cases c
      where c.id = case_id and c.client_id = auth.uid()
    )
  );

-- Only admins change a document's review status.
create policy "documents_admin_update"
  on public.documents for update
  using (public.is_admin());

create policy "documents_delete_own_or_admin"
  on public.documents for delete
  using (owner_id = auth.uid() or public.is_admin());

-- ─── case_requirements ────────────────────────────────────────────────────--

create policy "requirements_select_own_or_admin"
  on public.case_requirements for select
  using (
    public.is_admin()
    or exists (
      select 1 from public.cases c
      where c.id = case_id and c.client_id = auth.uid()
    )
  );

-- Clients may tick off their own checklist items; admins manage everything.
create policy "requirements_update_own_or_admin"
  on public.case_requirements for update
  using (
    public.is_admin()
    or exists (
      select 1 from public.cases c
      where c.id = case_id and c.client_id = auth.uid()
    )
  );

create policy "requirements_admin_insert"
  on public.case_requirements for insert
  with check (public.is_admin());

create policy "requirements_admin_delete"
  on public.case_requirements for delete
  using (public.is_admin());

-- ─── notifications ──────────────────────────────────────────────────────────

create policy "notifications_select_own_or_admin"
  on public.notifications for select
  using (
    public.is_admin()
    or exists (
      select 1 from public.cases c
      where c.id = case_id and c.client_id = auth.uid()
    )
  );

create policy "notifications_admin_insert"
  on public.notifications for insert
  with check (public.is_admin());

create policy "notifications_admin_update"
  on public.notifications for update
  using (public.is_admin());

-- ─── appointments ───────────────────────────────────────────────────────────

create policy "appointments_select_own_or_admin"
  on public.appointments for select
  using (client_id = auth.uid() or public.is_admin());

create policy "appointments_insert_own"
  on public.appointments for insert
  with check (client_id = auth.uid());

create policy "appointments_update_own_or_admin"
  on public.appointments for update
  using (client_id = auth.uid() or public.is_admin());

create policy "appointments_delete_own_or_admin"
  on public.appointments for delete
  using (client_id = auth.uid() or public.is_admin());

-- ─── schedule_overrides ─────────────────────────────────────────────────────

-- Any authenticated user can read office hours; only admins can change them.
create policy "overrides_select_all_authenticated"
  on public.schedule_overrides for select
  using (auth.role() = 'authenticated');

create policy "overrides_admin_insert"
  on public.schedule_overrides for insert
  with check (public.is_admin());

create policy "overrides_admin_update"
  on public.schedule_overrides for update
  using (public.is_admin());

create policy "overrides_admin_delete"
  on public.schedule_overrides for delete
  using (public.is_admin());
-- ============================================================================
-- Uy-Laurio Legal Portal — Storage
-- ----------------------------------------------------------------------------
-- Private bucket for uploaded legal documents. Objects are namespaced by the
-- owner's user id (first path segment), so clients can only touch their own
-- files while admins can read everything for review.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

-- Clients read their own files; admins read all.
create policy "documents_read_own_or_admin"
  on storage.objects for select
  using (
    bucket_id = 'documents'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_admin()
    )
  );

-- Clients may upload only into their own folder.
create policy "documents_insert_own"
  on storage.objects for insert
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "documents_update_own"
  on storage.objects for update
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "documents_delete_own_or_admin"
  on storage.objects for delete
  using (
    bucket_id = 'documents'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_admin()
    )
  );
-- ============================================================================
-- Uy-Laurio Legal Portal — Default case requirements
-- ----------------------------------------------------------------------------
-- When a case is created, seed its document checklist based on the selected
-- service module. These are the real document requirements for each service
-- (previously hard-coded in the UI), now generated server-side so every case
-- starts with an accurate, dynamic checklist.
--
-- SECURITY DEFINER lets the trigger insert requirement rows regardless of the
-- caller's RLS scope (clients create the case; the office defines the list).
-- ============================================================================

create or replace function public.seed_case_requirements()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Common to every service.
  insert into public.case_requirements (case_id, name, note, urgent, sort_order) values
    (new.id, 'Government-Issued Photo ID', 'Both sides, clear scan', true, 1),
    (new.id, 'Proof of Address', 'Utility bill or bank statement, within 3 months', true, 2);

  if new.module = 'notarization' then
    insert into public.case_requirements (case_id, name, note, urgent, sort_order) values
      (new.id, 'Document to be Notarized', 'Original, fully signed in black or blue ink', true, 3),
      (new.id, 'Tax Identification Number', 'BIR TIN of the signatory', false, 4);

  elsif new.module = 'deed' then
    insert into public.case_requirements (case_id, name, note, urgent, sort_order) values
      (new.id, 'Signed Deed of Sale', 'Original, fully signed document', true, 3),
      (new.id, 'Certificate of Title (TCT/OCT)', 'Owner''s duplicate copy', true, 4),
      (new.id, 'Latest Tax Declaration', 'From the local assessor''s office', false, 5),
      (new.id, 'Real Property Tax Clearance', 'Current year, from the treasurer', false, 6);

  elsif new.module = 'ejs' then
    insert into public.case_requirements (case_id, name, note, urgent, sort_order) values
      (new.id, 'Death Certificate of the deceased', 'PSA-authenticated original', true, 3),
      (new.id, 'Birth Certificates of all heirs', 'PSA copies for each heir', true, 4),
      (new.id, 'Marriage Certificate (if applicable)', 'PSA-authenticated', false, 5),
      (new.id, 'Title of the property (TCT/OCT)', 'Original owner''s copy', true, 6),
      (new.id, 'Latest Tax Declaration', 'From the local assessor''s office', false, 7),
      (new.id, 'Real Property Tax Clearance', 'Current year, from the treasurer', false, 8),
      (new.id, 'Tax Identification Numbers of all heirs', 'BIR TIN for each heir', false, 9);
  end if;

  return new;
end;
$$;

drop trigger if exists on_case_created on public.cases;
create trigger on_case_created
  after insert on public.cases
  for each row execute function public.seed_case_requirements();
