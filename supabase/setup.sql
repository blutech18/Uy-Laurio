-- ============================================================================
-- Uy-Laurio Legal Portal - FULL SETUP BUNDLE (generated file, do not edit)
-- ----------------------------------------------------------------------------
-- Concatenation of supabase/migrations/*.sql in order.
-- Preferred: 'supabase db push' with the individual migrations.
-- Alternative: paste this bundle into the Supabase SQL editor once.
-- Regenerate with: powershell -NoProfile -File supabase/build-setup.ps1
-- ============================================================================

-- >>>>>>>>>>>>>>>>>>>> 0001_initial_schema.sql <<<<<<<<<<<<<<<<<<<<

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

drop trigger if exists trg_profiles_updated_at on public.profiles;
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

drop trigger if exists trg_cases_updated_at on public.cases;
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


-- >>>>>>>>>>>>>>>>>>>> 0002_rls_policies.sql <<<<<<<<<<<<<<<<<<<<

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

drop policy if exists "profiles_select_self_or_admin" on public.profiles;
create policy "profiles_select_self_or_admin"
  on public.profiles for select
  using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid() and role = 'user');

drop policy if exists "profiles_admin_update_all" on public.profiles;
create policy "profiles_admin_update_all"
  on public.profiles for update
  using (public.is_admin());

-- ─── cases ────────────────────────────────────────────────────────────────--

drop policy if exists "cases_select_own_or_admin" on public.cases;
create policy "cases_select_own_or_admin"
  on public.cases for select
  using (client_id = auth.uid() or public.is_admin());

drop policy if exists "cases_insert_own" on public.cases;
create policy "cases_insert_own"
  on public.cases for insert
  with check (client_id = auth.uid());

drop policy if exists "cases_admin_write" on public.cases;
create policy "cases_admin_write"
  on public.cases for update
  using (public.is_admin());

drop policy if exists "cases_admin_delete" on public.cases;
create policy "cases_admin_delete"
  on public.cases for delete
  using (public.is_admin());

-- ─── documents ──────────────────────────────────────────────────────────────

drop policy if exists "documents_select_own_or_admin" on public.documents;
create policy "documents_select_own_or_admin"
  on public.documents for select
  using (owner_id = auth.uid() or public.is_admin());

drop policy if exists "documents_insert_own" on public.documents;
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
drop policy if exists "documents_admin_update" on public.documents;
create policy "documents_admin_update"
  on public.documents for update
  using (public.is_admin());

drop policy if exists "documents_delete_own_or_admin" on public.documents;
create policy "documents_delete_own_or_admin"
  on public.documents for delete
  using (owner_id = auth.uid() or public.is_admin());

-- ─── case_requirements ────────────────────────────────────────────────────--

drop policy if exists "requirements_select_own_or_admin" on public.case_requirements;
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
drop policy if exists "requirements_update_own_or_admin" on public.case_requirements;
create policy "requirements_update_own_or_admin"
  on public.case_requirements for update
  using (
    public.is_admin()
    or exists (
      select 1 from public.cases c
      where c.id = case_id and c.client_id = auth.uid()
    )
  );

drop policy if exists "requirements_admin_insert" on public.case_requirements;
create policy "requirements_admin_insert"
  on public.case_requirements for insert
  with check (public.is_admin());

drop policy if exists "requirements_admin_delete" on public.case_requirements;
create policy "requirements_admin_delete"
  on public.case_requirements for delete
  using (public.is_admin());

-- ─── notifications ──────────────────────────────────────────────────────────

drop policy if exists "notifications_select_own_or_admin" on public.notifications;
create policy "notifications_select_own_or_admin"
  on public.notifications for select
  using (
    public.is_admin()
    or exists (
      select 1 from public.cases c
      where c.id = case_id and c.client_id = auth.uid()
    )
  );

drop policy if exists "notifications_admin_insert" on public.notifications;
create policy "notifications_admin_insert"
  on public.notifications for insert
  with check (public.is_admin());

drop policy if exists "notifications_admin_update" on public.notifications;
create policy "notifications_admin_update"
  on public.notifications for update
  using (public.is_admin());

-- ─── appointments ───────────────────────────────────────────────────────────

drop policy if exists "appointments_select_own_or_admin" on public.appointments;
create policy "appointments_select_own_or_admin"
  on public.appointments for select
  using (client_id = auth.uid() or public.is_admin());

drop policy if exists "appointments_insert_own" on public.appointments;
create policy "appointments_insert_own"
  on public.appointments for insert
  with check (client_id = auth.uid());

drop policy if exists "appointments_update_own_or_admin" on public.appointments;
create policy "appointments_update_own_or_admin"
  on public.appointments for update
  using (client_id = auth.uid() or public.is_admin());

drop policy if exists "appointments_delete_own_or_admin" on public.appointments;
create policy "appointments_delete_own_or_admin"
  on public.appointments for delete
  using (client_id = auth.uid() or public.is_admin());

-- ─── schedule_overrides ─────────────────────────────────────────────────────

-- Any authenticated user can read office hours; only admins can change them.
drop policy if exists "overrides_select_all_authenticated" on public.schedule_overrides;
create policy "overrides_select_all_authenticated"
  on public.schedule_overrides for select
  using (auth.role() = 'authenticated');

drop policy if exists "overrides_admin_insert" on public.schedule_overrides;
create policy "overrides_admin_insert"
  on public.schedule_overrides for insert
  with check (public.is_admin());

drop policy if exists "overrides_admin_update" on public.schedule_overrides;
create policy "overrides_admin_update"
  on public.schedule_overrides for update
  using (public.is_admin());

drop policy if exists "overrides_admin_delete" on public.schedule_overrides;
create policy "overrides_admin_delete"
  on public.schedule_overrides for delete
  using (public.is_admin());


-- >>>>>>>>>>>>>>>>>>>> 0003_storage.sql <<<<<<<<<<<<<<<<<<<<

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
drop policy if exists "documents_read_own_or_admin" on storage.objects;
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
drop policy if exists "documents_insert_own" on storage.objects;
create policy "documents_insert_own"
  on storage.objects for insert
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "documents_update_own" on storage.objects;
create policy "documents_update_own"
  on storage.objects for update
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "documents_delete_own_or_admin" on storage.objects;
create policy "documents_delete_own_or_admin"
  on storage.objects for delete
  using (
    bucket_id = 'documents'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_admin()
    )
  );


-- >>>>>>>>>>>>>>>>>>>> 0004_default_requirements.sql <<<<<<<<<<<<<<<<<<<<

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


-- >>>>>>>>>>>>>>>>>>>> 0005_backend_completion.sql <<<<<<<<<<<<<<<<<<<<

-- ============================================================================
-- Uy-Laurio Legal Portal — Backend completion (schema)
-- ----------------------------------------------------------------------------
-- Phase 1 of docs/BACKEND-COMPLETION-ANALYSIS.md.
--
-- Adds the structures the client requirements need but the initial schema
-- lacked: the full status vocabulary, case assignment, account deactivation,
-- document<->requirement linkage, a real notification queue, admin-editable
-- reference data (requirement checklists, office hours, time slots), and the
-- audit trail used by reports and the client tracking timeline.
--
-- Additive and idempotent. New enum labels are never referenced as literals in
-- this file so the whole migration stays safe inside a single transaction.
-- ============================================================================

-- ─── 1. Status vocabulary ───────────────────────────────────────────────────
-- Client spec: Pending, Under Review, In Progress, Waiting for Requirements,
-- Completed, Cancelled. The UI keeps its four presentation keys; the service
-- layer maps DB -> UI (see src/types/models.ts -> toUiStatus).

alter type case_status add value if not exists 'review' after 'pending';
alter type case_status add value if not exists 'cancelled' after 'done';

-- ─── 2. profiles: lifecycle + staff notes ───────────────────────────────────

alter table public.profiles
  add column if not exists is_active boolean not null default true,
  add column if not exists notes text;

create index if not exists idx_profiles_role on public.profiles (role);
create index if not exists idx_profiles_active on public.profiles (is_active);

-- Keep profiles.email aligned when the auth email changes.
create or replace function public.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = coalesce(new.email, '') where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.sync_profile_email();

-- ─── 3. cases: assignment, cancellation, completion ─────────────────────────

alter table public.cases
  add column if not exists assigned_to uuid references public.profiles (id) on delete set null,
  add column if not exists assigned_at timestamptz,
  add column if not exists cancelled_reason text,
  add column if not exists completed_at timestamptz,
  add column if not exists created_by uuid references public.profiles (id) on delete set null;

create index if not exists idx_cases_assigned on public.cases (assigned_to);
create index if not exists idx_cases_created_at on public.cases (created_at desc);

-- ─── 4. documents: verification trail + requirement linkage ─────────────────

alter table public.documents
  add column if not exists requirement_id uuid references public.case_requirements (id) on delete set null,
  add column if not exists verified_by uuid references public.profiles (id) on delete set null,
  add column if not exists verified_at timestamptz,
  add column if not exists rejection_reason text;

create index if not exists idx_documents_requirement on public.documents (requirement_id);

-- ─── 5. case_requirements: who verified it ──────────────────────────────────

alter table public.case_requirements
  add column if not exists verified_by uuid references public.profiles (id) on delete set null,
  add column if not exists verified_at timestamptz;

-- ─── 6. notifications: queue + read state ───────────────────────────────────

alter table public.notifications
  add column if not exists recipient_id uuid references public.profiles (id) on delete cascade,
  add column if not exists read_at timestamptz,
  add column if not exists kind text not null default 'manual',
  add column if not exists delivery_status text not null default 'queued',
  add column if not exists attempts int not null default 0,
  add column if not exists sent_at timestamptz,
  add column if not exists provider_message_id text,
  add column if not exists error text;

do $$ begin
  alter table public.notifications
    add constraint notifications_delivery_status_check
    check (delivery_status in ('queued', 'sending', 'sent', 'failed', 'skipped'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.notifications
    add constraint notifications_kind_check
    check (kind in (
      'manual', 'case_created', 'status_update', 'phase_update',
      'requirement_request', 'document_verified', 'document_rejected',
      'case_completed', 'case_cancelled', 'appointment_reminder',
      'appointment_booked', 'announcement'
    ));
exception when duplicate_object then null; end $$;

create index if not exists idx_notifications_recipient on public.notifications (recipient_id);
create index if not exists idx_notifications_unread on public.notifications (recipient_id, read_at);
create index if not exists idx_notifications_queue on public.notifications (delivery_status, created_at);

-- Backfill recipient_id from the case owner so existing rows stay visible.
update public.notifications n
set recipient_id = c.client_id
from public.cases c
where n.case_id = c.id and n.recipient_id is null;

-- ─── 7. appointments: tie to a case, allow cancellation reasons ─────────────

alter table public.appointments
  add column if not exists case_id uuid references public.cases (id) on delete set null,
  add column if not exists purpose text,
  add column if not exists cancelled_reason text,
  add column if not exists reminder_sent_at timestamptz;

create index if not exists idx_appointments_date_status
  on public.appointments (appointment_date, status);

-- A cancelled slot must be re-bookable, so the old global unique constraint on
-- (date, slot) is replaced by a partial unique index over live bookings only.
alter table public.appointments
  drop constraint if exists appointments_appointment_date_time_slot_key;

create unique index if not exists uq_appointments_live_slot
  on public.appointments (appointment_date, time_slot)
  where status <> 'cancelled';

-- ─── 8. requirement_templates (admin-editable checklists) ───────────────────
-- module = null  ->  applies to every service module.

create table if not exists public.requirement_templates (
  id         uuid primary key default gen_random_uuid(),
  module     service_module,
  name       text not null,
  note       text,
  urgent     boolean not null default false,
  sort_order int not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Two partial indexes rather than one expression index: casting an enum to text
-- is only STABLE, so coalesce(module::text, '*') cannot be indexed.
create unique index if not exists uq_requirement_templates_module_name
  on public.requirement_templates (module, name)
  where module is not null;

create unique index if not exists uq_requirement_templates_common_name
  on public.requirement_templates (name)
  where module is null;

drop trigger if exists trg_requirement_templates_updated_at on public.requirement_templates;
create trigger trg_requirement_templates_updated_at
  before update on public.requirement_templates
  for each row execute function public.set_updated_at();

-- Seed with the checklists previously hard-coded in 0004.
insert into public.requirement_templates (module, name, note, urgent, sort_order) values
  (null, 'Government-Issued Photo ID', 'Both sides, clear scan', true, 1),
  (null, 'Proof of Address', 'Utility bill or bank statement, within 3 months', true, 2),

  ('notarization', 'Document to be Notarized', 'Original, fully signed in black or blue ink', true, 3),
  ('notarization', 'Tax Identification Number', 'BIR TIN of the signatory', false, 4),

  ('deed', 'Signed Deed of Sale', 'Original, fully signed document', true, 3),
  ('deed', 'Certificate of Title (TCT/OCT)', 'Owner''s duplicate copy', true, 4),
  ('deed', 'Latest Tax Declaration', 'From the local assessor''s office', false, 5),
  ('deed', 'Real Property Tax Clearance', 'Current year, from the treasurer', false, 6),

  ('ejs', 'Death Certificate of the deceased', 'PSA-authenticated original', true, 3),
  ('ejs', 'Birth Certificates of all heirs', 'PSA copies for each heir', true, 4),
  ('ejs', 'Marriage Certificate (if applicable)', 'PSA-authenticated', false, 5),
  ('ejs', 'Title of the property (TCT/OCT)', 'Original owner''s copy', true, 6),
  ('ejs', 'Latest Tax Declaration', 'From the local assessor''s office', false, 7),
  ('ejs', 'Real Property Tax Clearance', 'Current year, from the treasurer', false, 8),
  ('ejs', 'Tax Identification Numbers of all heirs', 'BIR TIN for each heir', false, 9)
on conflict do nothing;

-- ─── 9. office_hours + office_time_slots (data-driven schedule) ──────────────

create table if not exists public.office_hours (
  day_of_week int primary key check (day_of_week between 0 and 6), -- 0 = Sunday
  is_open     boolean not null default true,
  open_time   text not null default '08:00',
  close_time  text not null default '17:00',
  updated_at  timestamptz not null default now()
);

drop trigger if exists trg_office_hours_updated_at on public.office_hours;
create trigger trg_office_hours_updated_at
  before update on public.office_hours
  for each row execute function public.set_updated_at();

insert into public.office_hours (day_of_week, is_open, open_time, close_time) values
  (0, false, '00:00', '00:00'),
  (1, true,  '08:00', '17:00'),
  (2, true,  '08:00', '17:00'),
  (3, true,  '08:00', '17:00'),
  (4, true,  '08:00', '17:00'),
  (5, true,  '08:00', '17:00'),
  (6, true,  '08:00', '17:00')
on conflict (day_of_week) do nothing;

-- Slot labels are stored exactly as the UI renders them ("9:00 AM").
create table if not exists public.office_time_slots (
  id         uuid primary key default gen_random_uuid(),
  slot_label text not null unique,
  ordinal    int not null,
  halfday    boolean not null default false, -- available on half-day operations
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.office_time_slots (slot_label, ordinal, halfday) values
  ('9:00 AM',  1, true),
  ('10:00 AM', 2, true),
  ('11:00 AM', 3, true),
  ('1:00 PM',  4, false),
  ('2:00 PM',  5, false),
  ('3:00 PM',  6, false),
  ('4:00 PM',  7, false)
on conflict (slot_label) do nothing;

-- ─── 10. case_status_history (client-facing timeline + reports) ─────────────

create table if not exists public.case_status_history (
  id         uuid primary key default gen_random_uuid(),
  case_id    uuid not null references public.cases (id) on delete cascade,
  from_status case_status,
  to_status   case_status not null,
  from_phase  case_phase,
  to_phase    case_phase not null,
  note        text,
  changed_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_case_history_case on public.case_status_history (case_id, created_at desc);

-- ─── 11. activity_log (system activity reports) ─────────────────────────────

create table if not exists public.activity_log (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references public.profiles (id) on delete set null,
  actor_email text,
  action      text not null,
  entity_type text not null,
  entity_id   uuid,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists idx_activity_created on public.activity_log (created_at desc);
create index if not exists idx_activity_actor on public.activity_log (actor_id);
create index if not exists idx_activity_entity on public.activity_log (entity_type, entity_id);

-- ─── 12. Storage hardening ──────────────────────────────────────────────────
-- 10 MB cap, and only the document formats the office actually accepts.

-- Wrapped because older Storage releases lack these columns.
do $$ begin
  update storage.buckets
  set file_size_limit = 10485760,
      allowed_mime_types = array[
        'application/pdf',
        'image/jpeg',
        'image/png',
        'image/heic',
        'image/webp'
      ]
  where id = 'documents';
exception
  when undefined_column then
    raise notice 'storage.buckets limits not supported on this version — set them in the dashboard.';
  when insufficient_privilege then
    raise notice 'no privilege to update storage.buckets — set the 10MB limit and MIME list in the dashboard.';
end $$;


-- >>>>>>>>>>>>>>>>>>>> 0006_rls_updates.sql <<<<<<<<<<<<<<<<<<<<

-- ============================================================================
-- Uy-Laurio Legal Portal — RLS for the completed schema
-- ----------------------------------------------------------------------------
-- Phase 2 of docs/BACKEND-COMPLETION-ANALYSIS.md.
--
--   * Deactivated accounts lose access to operational data.
--   * Staff may record cases on behalf of walk-in clients.
--   * Clients may cancel their own open case (column-level rules enforced by
--     triggers in 0007).
--   * Office-wide notifications (case_id null) reach their recipient.
--   * New reference/audit tables get least-privilege policies.
--
-- New enum labels are compared as text so this file remains transaction-safe
-- immediately after 0005.
-- ============================================================================

-- ─── Helper predicates ──────────────────────────────────────────────────────

-- An admin must also be an active account.
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and is_active
  );
$$;

create or replace function public.is_active_user()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
  );
$$;

/**
 * True when the statement is *not* running on behalf of an end user: internal
 * trigger logic (security-definer functions run as the table owner), the
 * service role used by Edge Functions, or direct SQL access.
 *
 * The column-level guards in 0007 use this so server-side automation is not
 * blocked by rules that exist to constrain clients. It must stay
 * SECURITY INVOKER — current_user is only meaningful in the caller's context.
 */
create or replace function public.is_privileged_context()
returns boolean
language sql
stable
as $$
  select current_user::text not in ('authenticated', 'anon');
$$;

-- Does the caller own this case?
create or replace function public.owns_case(p_case_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.cases
    where id = p_case_id and client_id = auth.uid()
  );
$$;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_active_user() to authenticated;
grant execute on function public.is_privileged_context() to authenticated;
grant execute on function public.owns_case(uuid) to authenticated;

-- ─── cases ──────────────────────────────────────────────────────────────────

drop policy if exists "cases_select_own_or_admin" on public.cases;
create policy "cases_select_own_or_admin"
  on public.cases for select
  using (
    (client_id = auth.uid() and public.is_active_user())
    or assigned_to = auth.uid()
    or public.is_admin()
  );

drop policy if exists "cases_insert_own" on public.cases;
create policy "cases_insert_own"
  on public.cases for insert
  with check (client_id = auth.uid() and public.is_active_user());

-- Staff record transactions for walk-in clients.
drop policy if exists "cases_admin_insert" on public.cases;
create policy "cases_admin_insert"
  on public.cases for insert
  with check (public.is_admin());

-- Clients may only touch their own case while it is still open; the trigger
-- enforce_client_case_update (0007) limits them to cancelling it.
drop policy if exists "cases_client_update_own" on public.cases;
create policy "cases_client_update_own"
  on public.cases for update
  using (
    client_id = auth.uid()
    and public.is_active_user()
    and status::text not in ('done', 'cancelled')
  )
  with check (client_id = auth.uid());

-- ─── documents ──────────────────────────────────────────────────────────────

drop policy if exists "documents_insert_own" on public.documents;
create policy "documents_insert_own"
  on public.documents for insert
  with check (
    owner_id = auth.uid()
    and public.is_active_user()
    and public.owns_case(case_id)
  );

-- Staff may attach documents captured over the counter.
drop policy if exists "documents_admin_insert" on public.documents;
create policy "documents_admin_insert"
  on public.documents for insert
  with check (public.is_admin());

-- ─── case_requirements ──────────────────────────────────────────────────────
-- Clients tick their own checklist; verification columns are admin-only
-- (enforced by enforce_client_requirement_update in 0007).

drop policy if exists "requirements_select_own_or_admin" on public.case_requirements;
create policy "requirements_select_own_or_admin"
  on public.case_requirements for select
  using (public.is_admin() or public.owns_case(case_id));

drop policy if exists "requirements_update_own_or_admin" on public.case_requirements;
create policy "requirements_update_own_or_admin"
  on public.case_requirements for update
  using (
    public.is_admin()
    or (public.owns_case(case_id) and public.is_active_user())
  );

-- ─── notifications ──────────────────────────────────────────────────────────

drop policy if exists "notifications_select_own_or_admin" on public.notifications;
create policy "notifications_select_own_or_admin"
  on public.notifications for select
  using (
    public.is_admin()
    or recipient_id = auth.uid()
    or (case_id is not null and public.owns_case(case_id))
  );

-- Recipients may only stamp read_at (enforce_notification_update in 0007).
drop policy if exists "notifications_recipient_update" on public.notifications;
create policy "notifications_recipient_update"
  on public.notifications for update
  using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

-- ─── appointments ───────────────────────────────────────────────────────────

drop policy if exists "appointments_insert_own" on public.appointments;
create policy "appointments_insert_own"
  on public.appointments for insert
  with check (client_id = auth.uid() and public.is_active_user());

drop policy if exists "appointments_admin_insert" on public.appointments;
create policy "appointments_admin_insert"
  on public.appointments for insert
  with check (public.is_admin());

-- ─── requirement_templates ──────────────────────────────────────────────────

alter table public.requirement_templates enable row level security;

drop policy if exists "templates_select_authenticated" on public.requirement_templates;
create policy "templates_select_authenticated"
  on public.requirement_templates for select
  using (auth.role() = 'authenticated');

drop policy if exists "templates_admin_write" on public.requirement_templates;
create policy "templates_admin_write"
  on public.requirement_templates for all
  using (public.is_admin())
  with check (public.is_admin());

-- ─── office_hours ───────────────────────────────────────────────────────────

alter table public.office_hours enable row level security;

drop policy if exists "office_hours_select_authenticated" on public.office_hours;
create policy "office_hours_select_authenticated"
  on public.office_hours for select
  using (auth.role() = 'authenticated');

drop policy if exists "office_hours_admin_write" on public.office_hours;
create policy "office_hours_admin_write"
  on public.office_hours for all
  using (public.is_admin())
  with check (public.is_admin());

-- ─── office_time_slots ──────────────────────────────────────────────────────

alter table public.office_time_slots enable row level security;

drop policy if exists "time_slots_select_authenticated" on public.office_time_slots;
create policy "time_slots_select_authenticated"
  on public.office_time_slots for select
  using (auth.role() = 'authenticated');

drop policy if exists "time_slots_admin_write" on public.office_time_slots;
create policy "time_slots_admin_write"
  on public.office_time_slots for all
  using (public.is_admin())
  with check (public.is_admin());

-- ─── case_status_history ────────────────────────────────────────────────────
-- Read-only to users; rows are written exclusively by the 0007 trigger.

alter table public.case_status_history enable row level security;

drop policy if exists "history_select_own_or_admin" on public.case_status_history;
create policy "history_select_own_or_admin"
  on public.case_status_history for select
  using (public.is_admin() or public.owns_case(case_id));

-- ─── activity_log ───────────────────────────────────────────────────────────
-- Admin-visible only; written by security-definer helpers.

alter table public.activity_log enable row level security;

drop policy if exists "activity_select_admin" on public.activity_log;
create policy "activity_select_admin"
  on public.activity_log for select
  using (public.is_admin());


-- >>>>>>>>>>>>>>>>>>>> 0007_automation.sql <<<<<<<<<<<<<<<<<<<<

-- ============================================================================
-- Uy-Laurio Legal Portal — Automation, guards and audit
-- ----------------------------------------------------------------------------
-- Phase 3 of docs/BACKEND-COMPLETION-ANALYSIS.md.
--
--   * Requirement checklists are generated from requirement_templates.
--   * Uploading a document fulfils the requirement it was filed against.
--   * Every status/phase change is recorded and queues client notifications.
--   * Appointments are validated against real office hours and closures.
--   * Column-level guards back the permissive RLS policies from 0006.
--
-- Automated notifications are queued only; delivery is the Edge Function's job
-- (supabase/functions/send-notification).
-- ============================================================================

-- ─── Audit helper ───────────────────────────────────────────────────────────

create or replace function public.log_activity(
  p_action      text,
  p_entity_type text,
  p_entity_id   uuid,
  p_metadata    jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  select email into v_email from public.profiles where id = auth.uid();

  insert into public.activity_log (actor_id, actor_email, action, entity_type, entity_id, metadata)
  values (auth.uid(), v_email, p_action, p_entity_type, p_entity_id, coalesce(p_metadata, '{}'::jsonb));
end;
$$;

-- ─── Notification queue helper ──────────────────────────────────────────────
-- Queues one row per channel the recipient can actually be reached on.

create or replace function public.enqueue_notification(
  p_case_id      uuid,
  p_recipient_id uuid,
  p_kind         text,
  p_message      text
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_phone text;
  v_queued int := 0;
begin
  select email, phone into v_email, v_phone
  from public.profiles
  where id = p_recipient_id;

  if v_email is not null and v_email <> '' then
    insert into public.notifications
      (case_id, recipient_id, recipient, channel, message, kind, created_by)
    values
      (p_case_id, p_recipient_id, v_email, 'email', p_message, p_kind, auth.uid());
    v_queued := v_queued + 1;
  end if;

  if v_phone is not null and v_phone <> '' then
    insert into public.notifications
      (case_id, recipient_id, recipient, channel, message, kind, created_by)
    values
      (p_case_id, p_recipient_id, v_phone, 'sms', p_message, p_kind, auth.uid());
    v_queued := v_queued + 1;
  end if;

  return v_queued;
end;
$$;

-- Human-readable status text used in outbound messages.
create or replace function public.status_label(p_status case_status)
returns text
language sql
immutable
as $$
  select case p_status::text
    when 'pending'   then 'Pending'
    when 'review'    then 'Under Review'
    when 'progress'  then 'In Progress'
    when 'waiting'   then 'Waiting for Requirements'
    when 'done'      then 'Completed'
    when 'cancelled' then 'Cancelled'
    else p_status::text
  end;
$$;

create or replace function public.module_label(p_module service_module)
returns text
language sql
immutable
as $$
  select case p_module::text
    when 'notarization' then 'Notarization'
    when 'deed'         then 'Deed of Sale'
    when 'ejs'          then 'Extra-Judicial Settlement'
    else p_module::text
  end;
$$;

-- ─── Requirement checklists from templates ──────────────────────────────────

create or replace function public.seed_case_requirements()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.case_requirements (case_id, name, note, urgent, sort_order)
  select new.id, t.name, t.note, t.urgent, t.sort_order
  from public.requirement_templates t
  where t.active
    and (t.module is null or t.module = new.module)
  order by t.sort_order, t.name;

  return new;
end;
$$;

drop trigger if exists on_case_created on public.cases;
create trigger on_case_created
  after insert on public.cases
  for each row execute function public.seed_case_requirements();

-- ─── Case created: audit + acknowledgement ──────────────────────────────────

create or replace function public.after_case_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.case_status_history (case_id, to_status, to_phase, changed_by, note)
  values (new.id, new.status, new.phase, auth.uid(), 'Case filed');

  perform public.log_activity(
    'case.created', 'case', new.id,
    jsonb_build_object('reference', new.reference, 'module', new.module::text)
  );

  perform public.enqueue_notification(
    new.id, new.client_id, 'case_created',
    format(
      'Your %s request has been received. Reference %s. We will notify you as it progresses.',
      public.module_label(new.module), new.reference
    )
  );

  return new;
end;
$$;

drop trigger if exists on_case_created_notify on public.cases;
create trigger on_case_created_notify
  after insert on public.cases
  for each row execute function public.after_case_created();

-- ─── Case completion stamp ──────────────────────────────────────────────────

create or replace function public.stamp_case_completion()
returns trigger
language plpgsql
as $$
begin
  if new.status::text = 'done' and old.status::text <> 'done' then
    new.completed_at := now();
  elsif new.status::text <> 'done' then
    new.completed_at := null;
  end if;

  if new.assigned_to is distinct from old.assigned_to and new.assigned_to is not null then
    new.assigned_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists trg_cases_completion on public.cases;
create trigger trg_cases_completion
  before update on public.cases
  for each row execute function public.stamp_case_completion();

-- ─── Client update guard (backs cases_client_update_own) ────────────────────

-- NOTE: the four *_guard functions below are deliberately SECURITY INVOKER.
-- They must see the caller's real role so that internal trigger logic (which
-- runs as the table owner) and the service role are not blocked by rules meant
-- for client accounts.
create or replace function public.enforce_client_case_update()
returns trigger
language plpgsql
as $$
begin
  if public.is_privileged_context() or public.is_admin() then
    return new;
  end if;

  -- A client may only cancel their own case, nothing else.
  if new.status::text <> 'cancelled' then
    raise exception 'Clients may only cancel their own case.' using errcode = '42501';
  end if;

  if new.client_id     is distinct from old.client_id
     or new.module     is distinct from old.module
     or new.reference  is distinct from old.reference
     or new.phase      is distinct from old.phase
     or new.assigned_to is distinct from old.assigned_to then
    raise exception 'Only the case status may be changed by a client.' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_cases_client_guard on public.cases;
create trigger trg_cases_client_guard
  before update on public.cases
  for each row execute function public.enforce_client_case_update();

-- ─── Status / phase change: history, audit, notification ────────────────────

create or replace function public.after_case_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text;
  v_msg  text;
begin
  if new.status = old.status and new.phase = old.phase then
    return new;
  end if;

  insert into public.case_status_history
    (case_id, from_status, to_status, from_phase, to_phase, changed_by, note)
  values
    (new.id, old.status, new.status, old.phase, new.phase, auth.uid(), new.cancelled_reason);

  perform public.log_activity(
    'case.status_changed', 'case', new.id,
    jsonb_build_object(
      'reference', new.reference,
      'from_status', old.status::text, 'to_status', new.status::text,
      'from_phase', old.phase::text,  'to_phase', new.phase::text
    )
  );

  if new.status <> old.status then
    v_kind := case new.status::text
      when 'done'      then 'case_completed'
      when 'cancelled' then 'case_cancelled'
      when 'waiting'   then 'requirement_request'
      else 'status_update'
    end;

    v_msg := case new.status::text
      when 'done' then format(
        'Good news — your %s request (%s) is now complete. You may coordinate with the office for release.',
        public.module_label(new.module), new.reference)
      when 'cancelled' then format(
        'Your %s request (%s) has been cancelled.%s',
        public.module_label(new.module), new.reference,
        coalesce(' Reason: ' || new.cancelled_reason, ''))
      when 'waiting' then format(
        'Action needed on %s: some documentary requirements are still missing. Please upload them in your portal.',
        new.reference)
      else format(
        'Update on %s: status is now %s (%s).',
        new.reference, public.status_label(new.status), new.phase::text)
    end;
  else
    v_kind := 'phase_update';
    v_msg  := format('Update on %s: your case moved to the "%s" stage.', new.reference, new.phase::text);
  end if;

  perform public.enqueue_notification(new.id, new.client_id, v_kind, v_msg);

  return new;
end;
$$;

drop trigger if exists on_case_status_change on public.cases;
create trigger on_case_status_change
  after update of status, phase on public.cases
  for each row execute function public.after_case_status_change();

-- ─── Document upload: fulfil the linked requirement ─────────────────────────

create or replace function public.after_document_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_open int;
begin
  if new.requirement_id is not null then
    update public.case_requirements
    set fulfilled = true,
        document_id = new.id
    where id = new.requirement_id
      and case_id = new.case_id;
  end if;

  perform public.log_activity(
    'document.uploaded', 'document', new.id,
    jsonb_build_object('case_id', new.case_id, 'name', new.name, 'size_bytes', new.size_bytes)
  );

  -- If the checklist is now complete, lift the case out of "waiting".
  select count(*) into v_open
  from public.case_requirements
  where case_id = new.case_id and not fulfilled;

  if v_open = 0 then
    update public.cases
    set status = 'review'
    where id = new.case_id and status::text = 'waiting';
  end if;

  return new;
end;
$$;

drop trigger if exists on_document_insert on public.documents;
create trigger on_document_insert
  after insert on public.documents
  for each row execute function public.after_document_insert();

-- ─── Document verification: stamp + notify ──────────────────────────────────

create or replace function public.stamp_document_verification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    new.verified_by := auth.uid();
    new.verified_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_documents_verification on public.documents;
create trigger trg_documents_verification
  before update of status on public.documents
  for each row execute function public.stamp_document_verification();

create or replace function public.after_document_verified()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = old.status then
    return new;
  end if;

  perform public.log_activity(
    'document.status_changed', 'document', new.id,
    jsonb_build_object('from', old.status::text, 'to', new.status::text, 'case_id', new.case_id)
  );

  if new.status::text = 'done' then
    perform public.enqueue_notification(
      new.case_id, new.owner_id, 'document_verified',
      format('Your document "%s" has been verified and accepted.', new.name)
    );
  elsif new.status::text = 'waiting' then
    update public.case_requirements
    set fulfilled = false
    where document_id = new.id;

    perform public.enqueue_notification(
      new.case_id, new.owner_id, 'document_rejected',
      format(
        'Your document "%s" needs to be re-submitted.%s',
        new.name, coalesce(' Reason: ' || new.rejection_reason, '')
      )
    );
  end if;

  return new;
end;
$$;

drop trigger if exists on_document_verified on public.documents;
create trigger on_document_verified
  after update of status on public.documents
  for each row execute function public.after_document_verified();

-- ─── Requirement guard: clients may only tick evidence-backed items ─────────

create or replace function public.enforce_client_requirement_update()
returns trigger
language plpgsql
as $$
begin
  if public.is_privileged_context() or public.is_admin() then
    return new;
  end if;

  if new.name       is distinct from old.name
     or new.note    is distinct from old.note
     or new.urgent  is distinct from old.urgent
     or new.case_id is distinct from old.case_id
     or new.sort_order  is distinct from old.sort_order
     or new.verified_by is distinct from old.verified_by
     or new.verified_at is distinct from old.verified_at then
    raise exception 'Clients may only update the fulfilment of a requirement.' using errcode = '42501';
  end if;

  if new.fulfilled and new.document_id is null then
    raise exception 'Upload the supporting document before marking this requirement as complete.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_requirements_client_guard on public.case_requirements;
create trigger trg_requirements_client_guard
  before update on public.case_requirements
  for each row execute function public.enforce_client_requirement_update();

-- ─── Notification guard: recipients may only mark as read ───────────────────

create or replace function public.enforce_notification_update()
returns trigger
language plpgsql
as $$
begin
  if public.is_privileged_context() or public.is_admin() then
    return new;
  end if;

  if new.message   is distinct from old.message
     or new.recipient is distinct from old.recipient
     or new.channel is distinct from old.channel
     or new.case_id is distinct from old.case_id
     or new.kind    is distinct from old.kind
     or new.delivery_status is distinct from old.delivery_status
     or new.status  is distinct from old.status then
    raise exception 'Only the read state of a notification may be changed.' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_notifications_update_guard on public.notifications;
create trigger trg_notifications_update_guard
  before update on public.notifications
  for each row execute function public.enforce_notification_update();

-- ─── Profile guard: clients edit contact details only ───────────────────────

create or replace function public.enforce_profile_update()
returns trigger
language plpgsql
as $$
begin
  if public.is_privileged_context() or public.is_admin() then
    return new;
  end if;

  if new.role      is distinct from old.role
     or new.is_active is distinct from old.is_active
     or new.email   is distinct from old.email
     or new.notes   is distinct from old.notes then
    raise exception 'Only your name and phone number can be changed here.' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_profiles_update_guard on public.profiles;
create trigger trg_profiles_update_guard
  before update on public.profiles
  for each row execute function public.enforce_profile_update();

-- ─── Appointment validation against real office availability ────────────────

create or replace function public.validate_appointment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_override    public.schedule_overrides;
  v_hours       public.office_hours;
  v_slot        public.office_time_slots;
  v_has_override boolean := false;
  v_has_hours    boolean := false;
  v_has_slot     boolean := false;
  v_is_halfday  boolean := false;
begin
  if new.status::text = 'cancelled' then
    return new;
  end if;

  if new.appointment_date < current_date then
    raise exception 'Appointments cannot be booked on a past date.' using errcode = '22007';
  end if;

  select * into v_override
  from public.schedule_overrides
  where override_date = new.appointment_date;
  v_has_override := found;

  if v_has_override and v_override.type::text = 'closed' then
    raise exception 'The office is closed on %.', new.appointment_date using errcode = '22007';
  end if;

  if not v_has_override then
    select * into v_hours
    from public.office_hours
    where day_of_week = extract(dow from new.appointment_date)::int;
    v_has_hours := found;

    if v_has_hours and not v_hours.is_open then
      raise exception 'The office is closed on %.', new.appointment_date using errcode = '22007';
    end if;
  end if;

  v_is_halfday := v_has_override and v_override.type::text = 'halfday';

  select * into v_slot
  from public.office_time_slots
  where slot_label = new.time_slot and active;
  v_has_slot := found;

  if not v_has_slot then
    raise exception 'Invalid time slot "%".', new.time_slot using errcode = '22023';
  end if;

  if v_is_halfday and not v_slot.halfday then
    raise exception 'Only morning slots are available on half-day operations.' using errcode = '22007';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_appointments_validate on public.appointments;
create trigger trg_appointments_validate
  before insert or update of appointment_date, time_slot, status on public.appointments
  for each row execute function public.validate_appointment();

create or replace function public.after_appointment_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.log_activity(
    'appointment.booked', 'appointment', new.id,
    jsonb_build_object('date', new.appointment_date, 'slot', new.time_slot)
  );

  perform public.enqueue_notification(
    new.case_id, new.client_id, 'appointment_booked',
    format(
      'Your appointment is confirmed for %s at %s. Please bring your original documents.',
      to_char(new.appointment_date, 'FMMonth FMDD, YYYY'), new.time_slot
    )
  );

  return new;
end;
$$;

drop trigger if exists on_appointment_insert on public.appointments;
create trigger on_appointment_insert
  after insert on public.appointments
  for each row execute function public.after_appointment_insert();

-- ─── Reminder sweeps (called by cron or the Edge Function) ──────────────────

-- Nudges clients whose cases still have unfulfilled, urgent requirements.
create or replace function public.queue_requirement_reminders()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_count int := 0;
begin
  for r in
    select c.id, c.reference, c.client_id, count(*) as missing
    from public.cases c
    join public.case_requirements q on q.case_id = c.id and not q.fulfilled
    where c.status::text not in ('done', 'cancelled')
      and not exists (
        select 1 from public.notifications n
        where n.case_id = c.id
          and n.kind = 'requirement_request'
          and n.created_at > now() - interval '3 days'
      )
    group by c.id, c.reference, c.client_id
  loop
    perform public.enqueue_notification(
      r.id, r.client_id, 'requirement_request',
      format('Reminder: %s documentary requirement(s) are still pending for case %s.', r.missing, r.reference)
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- Reminds clients about tomorrow's appointments, once each.
create or replace function public.queue_appointment_reminders()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_count int := 0;
begin
  for r in
    select * from public.appointments
    where status::text = 'booked'
      and appointment_date = current_date + 1
      and reminder_sent_at is null
  loop
    perform public.enqueue_notification(
      r.case_id, r.client_id, 'appointment_reminder',
      format('Reminder: you have an appointment tomorrow at %s.', r.time_slot)
    );
    update public.appointments set reminder_sent_at = now() where id = r.id;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- These are privileged helpers: trigger-internal or scheduled only. Clients and
-- signed-in users must never call them directly.
revoke execute on function public.enqueue_notification(uuid, uuid, text, text) from public;
revoke execute on function public.log_activity(text, text, uuid, jsonb) from public;
revoke execute on function public.queue_requirement_reminders() from public;
revoke execute on function public.queue_appointment_reminders() from public;

grant execute on function public.queue_requirement_reminders() to service_role;
grant execute on function public.queue_appointment_reminders() to service_role;
grant execute on function public.enqueue_notification(uuid, uuid, text, text) to service_role;


-- >>>>>>>>>>>>>>>>>>>> 0008_reports.sql <<<<<<<<<<<<<<<<<<<<

-- ============================================================================
-- Uy-Laurio Legal Portal — Aggregates, listings and reports
-- ----------------------------------------------------------------------------
-- Phase 4 of docs/BACKEND-COMPLETION-ANALYSIS.md.
--
-- All admin functions are SECURITY DEFINER and start with an explicit
-- public.is_admin() guard, so RLS cannot be side-stepped by calling them
-- directly. Enum inputs are accepted as text and cast inside, keeping the
-- client-side contract simple and transaction-safe.
-- ============================================================================

-- ─── Administrative dashboard ───────────────────────────────────────────────

create or replace function public.admin_dashboard_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'total_open', (
      select count(*) from public.cases where status::text not in ('done', 'cancelled')
    ),
    'pending_verification', (
      select count(*) from public.cases where status::text in ('pending', 'review')
    ),
    'missing_requirements', (
      select count(*) from public.cases where status::text = 'waiting'
    ),
    'daily_completed', (
      select count(*) from public.cases
      where status::text = 'done' and completed_at >= date_trunc('day', now())
    ),
    'cancelled', (
      select count(*) from public.cases where status::text = 'cancelled'
    ),
    'unverified_documents', (
      select count(*) from public.documents where status::text in ('pending', 'progress')
    ),
    'upcoming_appointments', (
      select count(*) from public.appointments
      where status::text = 'booked' and appointment_date >= current_date
    ),
    'clients_total', (
      select count(*) from public.profiles where role = 'user'
    ),
    'notifications_queued', (
      select count(*) from public.notifications where delivery_status in ('queued', 'sending')
    )
  ) into v;

  return v;
end;
$$;

-- ─── Paginated, filtered case listing (replaces unbounded listAll) ──────────

create or replace function public.list_cases(
  p_search  text default null,
  p_status  text default null,
  p_module  text default null,
  p_from    date default null,
  p_to      date default null,
  p_limit   int  default 50,
  p_offset  int  default 0
)
returns table (
  id            uuid,
  reference     text,
  client_id     uuid,
  module        service_module,
  module_detail text,
  status        case_status,
  phase         case_phase,
  assigned_to   uuid,
  created_at    timestamptz,
  updated_at    timestamptz,
  completed_at  timestamptz,
  client_name   text,
  client_email  text,
  client_phone  text,
  assignee_name text,
  open_requirements bigint,
  total_count   bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  return query
  with filtered as (
    select c.*, p.full_name as client_name, p.email as client_email, p.phone as client_phone,
           a.full_name as assignee_name
    from public.cases c
    left join public.profiles p on p.id = c.client_id
    left join public.profiles a on a.id = c.assigned_to
    where (p_status is null or c.status::text = p_status)
      and (p_module is null or c.module::text = p_module)
      and (p_from   is null or c.created_at >= p_from)
      and (p_to     is null or c.created_at < (p_to + 1))
      and (
        p_search is null or p_search = ''
        or c.reference ilike '%' || p_search || '%'
        or p.full_name ilike '%' || p_search || '%'
        or p.email     ilike '%' || p_search || '%'
      )
  )
  select f.id, f.reference, f.client_id, f.module, f.module_detail, f.status, f.phase,
         f.assigned_to, f.created_at, f.updated_at, f.completed_at,
         f.client_name, f.client_email, f.client_phone, f.assignee_name,
         (select count(*) from public.case_requirements q
           where q.case_id = f.id and not q.fulfilled) as open_requirements,
         (select count(*) from filtered) as total_count
  from filtered f
  order by f.updated_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200))
  offset greatest(0, coalesce(p_offset, 0));
end;
$$;

-- ─── Client account management listing ──────────────────────────────────────

create or replace function public.admin_list_clients(
  p_search text default null,
  p_active boolean default null,
  p_limit  int default 50,
  p_offset int default 0
)
returns table (
  id           uuid,
  full_name    text,
  email        text,
  phone        text,
  role         user_role,
  is_active    boolean,
  notes        text,
  created_at   timestamptz,
  case_count   bigint,
  open_cases   bigint,
  last_activity timestamptz,
  total_count  bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  return query
  with filtered as (
    select p.* from public.profiles p
    where (p_active is null or p.is_active = p_active)
      and (
        p_search is null or p_search = ''
        or p.full_name ilike '%' || p_search || '%'
        or p.email     ilike '%' || p_search || '%'
        or coalesce(p.phone, '') ilike '%' || p_search || '%'
      )
  )
  select f.id, f.full_name, f.email, f.phone, f.role, f.is_active, f.notes, f.created_at,
         (select count(*) from public.cases c where c.client_id = f.id) as case_count,
         (select count(*) from public.cases c
           where c.client_id = f.id and c.status::text not in ('done', 'cancelled')) as open_cases,
         (select max(c.updated_at) from public.cases c where c.client_id = f.id) as last_activity,
         (select count(*) from filtered) as total_count
  from filtered f
  order by f.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200))
  offset greatest(0, coalesce(p_offset, 0));
end;
$$;

-- ─── Report: service summary ────────────────────────────────────────────────

create or replace function public.report_service_summary(
  p_from date default null,
  p_to   date default null
)
returns table (
  module          service_module,
  status          case_status,
  case_count      bigint,
  avg_days_to_complete numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  return query
  select c.module,
         c.status,
         count(*) as case_count,
         round(avg(
           case when c.completed_at is not null
             then extract(epoch from (c.completed_at - c.created_at)) / 86400.0
           end
         )::numeric, 2) as avg_days_to_complete
  from public.cases c
  where (p_from is null or c.created_at >= p_from)
    and (p_to   is null or c.created_at < (p_to + 1))
  group by c.module, c.status
  order by c.module, c.status;
end;
$$;

-- ─── Report: transaction log ────────────────────────────────────────────────

create or replace function public.report_transaction_log(
  p_from   date default null,
  p_to     date default null,
  p_module text default null,
  p_status text default null
)
returns table (
  reference     text,
  client_name   text,
  client_email  text,
  module        service_module,
  module_detail text,
  status        case_status,
  phase         case_phase,
  assignee_name text,
  documents     bigint,
  requirements_open bigint,
  filed_at      timestamptz,
  completed_at  timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  return query
  select c.reference,
         p.full_name, p.email,
         c.module, c.module_detail, c.status, c.phase,
         a.full_name,
         (select count(*) from public.documents d where d.case_id = c.id),
         (select count(*) from public.case_requirements q where q.case_id = c.id and not q.fulfilled),
         c.created_at, c.completed_at
  from public.cases c
  left join public.profiles p on p.id = c.client_id
  left join public.profiles a on a.id = c.assigned_to
  where (p_from   is null or c.created_at >= p_from)
    and (p_to     is null or c.created_at < (p_to + 1))
    and (p_module is null or c.module::text = p_module)
    and (p_status is null or c.status::text = p_status)
  order by c.created_at desc;
end;
$$;

-- ─── Report: system activity ────────────────────────────────────────────────

create or replace function public.report_activity_log(
  p_from   date default null,
  p_to     date default null,
  p_action text default null,
  p_limit  int  default 500
)
returns table (
  created_at  timestamptz,
  actor_email text,
  action      text,
  entity_type text,
  entity_id   uuid,
  metadata    jsonb
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  return query
  select l.created_at, l.actor_email, l.action, l.entity_type, l.entity_id, l.metadata
  from public.activity_log l
  where (p_from   is null or l.created_at >= p_from)
    and (p_to     is null or l.created_at < (p_to + 1))
    and (p_action is null or p_action = '' or l.action ilike p_action || '%')
  order by l.created_at desc
  limit greatest(1, least(coalesce(p_limit, 500), 5000));
end;
$$;

-- ─── Report: notification delivery ──────────────────────────────────────────

create or replace function public.report_notification_log(
  p_from date default null,
  p_to   date default null
)
returns table (
  created_at      timestamptz,
  channel         notification_channel,
  recipient       text,
  kind            text,
  delivery_status text,
  attempts        int,
  sent_at         timestamptz,
  case_reference  text,
  message         text,
  error           text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  return query
  select n.created_at, n.channel, n.recipient, n.kind, n.delivery_status, n.attempts,
         n.sent_at, c.reference, n.message, n.error
  from public.notifications n
  left join public.cases c on c.id = n.case_id
  where (p_from is null or n.created_at >= p_from)
    and (p_to   is null or n.created_at < (p_to + 1))
  order by n.created_at desc;
end;
$$;

-- ─── Client-facing: my transaction history ──────────────────────────────────

create or replace function public.client_case_history()
returns table (
  id            uuid,
  reference     text,
  module        service_module,
  module_detail text,
  status        case_status,
  phase         case_phase,
  created_at    timestamptz,
  updated_at    timestamptz,
  completed_at  timestamptz,
  document_count bigint,
  requirements_open bigint
)
language sql
security invoker
stable
set search_path = public
as $$
  -- RLS on public.cases already restricts this to the caller's own rows.
  select c.id, c.reference, c.module, c.module_detail, c.status, c.phase,
         c.created_at, c.updated_at, c.completed_at,
         (select count(*) from public.documents d where d.case_id = c.id),
         (select count(*) from public.case_requirements q where q.case_id = c.id and not q.fulfilled)
  from public.cases c
  where c.client_id = auth.uid()
  order by c.created_at desc;
$$;

-- ─── Shared: case timeline ──────────────────────────────────────────────────

create or replace function public.case_timeline(p_case_id uuid)
returns table (
  created_at  timestamptz,
  from_status case_status,
  to_status   case_status,
  from_phase  case_phase,
  to_phase    case_phase,
  note        text,
  changed_by_name text
)
language sql
security invoker
stable
set search_path = public
as $$
  -- RLS on case_status_history limits this to the owner or an admin.
  select h.created_at, h.from_status, h.to_status, h.from_phase, h.to_phase, h.note,
         p.full_name
  from public.case_status_history h
  left join public.profiles p on p.id = h.changed_by
  where h.case_id = p_case_id
  order by h.created_at asc;
$$;

-- ─── Grants ─────────────────────────────────────────────────────────────────

grant execute on function public.admin_dashboard_stats() to authenticated;
grant execute on function public.list_cases(text, text, text, date, date, int, int) to authenticated;
grant execute on function public.admin_list_clients(text, boolean, int, int) to authenticated;
grant execute on function public.report_service_summary(date, date) to authenticated;
grant execute on function public.report_transaction_log(date, date, text, text) to authenticated;
grant execute on function public.report_activity_log(date, date, text, int) to authenticated;
grant execute on function public.report_notification_log(date, date) to authenticated;
grant execute on function public.client_case_history() to authenticated;
grant execute on function public.case_timeline(uuid) to authenticated;


-- >>>>>>>>>>>>>>>>>>>> 0009_realtime_and_jobs.sql <<<<<<<<<<<<<<<<<<<<

-- ============================================================================
-- Uy-Laurio Legal Portal — Realtime + scheduled sweeps
-- ----------------------------------------------------------------------------
-- Real-time progress tracking is a stated client requirement, so the tables the
-- portal watches are published to Supabase Realtime. RLS still applies to every
-- change feed, so a client only receives events for their own rows.
--
-- The scheduled sweeps are optional: they are created only when pg_cron is
-- available in the project. Without pg_cron, call the same functions from the
-- send-notification Edge Function on a schedule instead.
-- ============================================================================

-- ─── Realtime publication ───────────────────────────────────────────────────

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime publication not found — skipping realtime setup.';
    return;
  end if;

  foreach t in array array[
    'cases', 'documents', 'case_requirements', 'notifications',
    'appointments', 'schedule_overrides'
  ]
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      begin
        execute format('alter publication supabase_realtime add table public.%I', t);
      exception when insufficient_privilege then
        -- Enable it from Dashboard -> Database -> Replication instead.
        raise notice 'no privilege to publish public.% — enable it in the dashboard.', t;
      end;
    end if;
  end loop;
end $$;

-- Realtime needs the full previous row to evaluate RLS on updates.
do $$
declare
  t text;
begin
  foreach t in array array[
    'cases', 'documents', 'case_requirements', 'notifications', 'appointments'
  ]
  loop
    begin
      execute format('alter table public.%I replica identity full', t);
    exception when insufficient_privilege then
      raise notice 'no privilege to set replica identity on public.%.', t;
    end;
  end loop;
end $$;

-- ─── Scheduled sweeps (optional) ────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron not installed — schedule the reminder sweeps externally.';
    return;
  end if;

  perform cron.unschedule('uy-laurio-requirement-reminders')
  where exists (select 1 from cron.job where jobname = 'uy-laurio-requirement-reminders');

  perform cron.unschedule('uy-laurio-appointment-reminders')
  where exists (select 1 from cron.job where jobname = 'uy-laurio-appointment-reminders');

  -- 09:00 Manila (01:00 UTC) daily.
  perform cron.schedule(
    'uy-laurio-requirement-reminders', '0 1 * * *',
    'select public.queue_requirement_reminders();'
  );

  -- 17:00 Manila (09:00 UTC) daily, for next-day appointments.
  perform cron.schedule(
    'uy-laurio-appointment-reminders', '0 9 * * *',
    'select public.queue_appointment_reminders();'
  );
end $$;


-- >>>>>>>>>>>>>>>>>>>> 0010_notification_claim.sql <<<<<<<<<<<<<<<<<<<<

-- ============================================================================
-- Uy-Laurio Legal Portal — Atomic notification claim
-- ----------------------------------------------------------------------------
-- The delivery function must never send the same message twice: a duplicate
-- email is noise, a duplicate SMS costs money.
--
-- Claiming over PostgREST (`update ... .in('delivery_status', [...]).select()`)
-- is unreliable, because the filter is re-evaluated against the *updated* row,
-- so the representation comes back empty even when the update applied. The
-- function then cannot tell "someone else claimed it" from "I claimed it".
--
-- Postgres RETURNING has no such ambiguity, so the claim happens here instead.
-- ============================================================================

create or replace function public.claim_notification(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed uuid;
begin
  update public.notifications
  set delivery_status = 'sending',
      attempts = attempts + 1
  where id = p_id
    and delivery_status in ('queued', 'failed')
    and attempts < 3
  returning id into v_claimed;

  return v_claimed is not null;
end;
$$;

-- Delivery is a server-side job only: the browser must never claim a row.
revoke execute on function public.claim_notification(uuid) from public;
grant execute on function public.claim_notification(uuid) to service_role;

comment on function public.claim_notification(uuid) is
  'Atomically marks one queued/failed notification as sending. Returns false when another worker already took it.';


-- >>>>>>>>>>>>>>>>>>>> 0011_function_privileges.sql <<<<<<<<<<<<<<<<<<<<

-- ============================================================================
-- Uy-Laurio Legal Portal — Lock down server-only functions
-- ----------------------------------------------------------------------------
-- Found by supabase/tests/rls_matrix.sql: every helper below was callable by
-- `anon` and `authenticated`.
--
-- `revoke ... from public` (used in 0007 and 0010) is NOT sufficient on
-- Supabase, because the platform sets default privileges that grant EXECUTE on
-- new functions to anon, authenticated and service_role. The grant has to be
-- revoked from those roles by name.
--
-- Why it matters: these are SECURITY DEFINER and therefore bypass RLS.
--   * enqueue_notification  -> anyone could send Email/SMS to any client in the
--                              office's name, and burn SMS credits doing it
--   * log_activity          -> anyone could forge audit-trail entries
--   * queue_*_reminders     -> anyone could mass-queue messages
--   * claim_notification    -> anyone could stall or sabotage delivery
--
-- Left callable by authenticated on purpose: is_admin(), is_active_user(),
-- owns_case() and is_privileged_context() are evaluated inside RLS policies
-- with the caller's privileges, so revoking them would break every policy.
-- The report/listing RPCs also stay callable: each one guards itself with an
-- is_admin() check and returns nothing to a client.
-- ============================================================================

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.claim_notification(uuid)',
    'public.enqueue_notification(uuid, uuid, text, text)',
    'public.log_activity(text, text, uuid, jsonb)',
    'public.queue_requirement_reminders()',
    'public.queue_appointment_reminders()'
  ]
  loop
    execute format('revoke all on function %s from public', fn);
    execute format('revoke all on function %s from anon', fn);
    execute format('revoke all on function %s from authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;

-- Guard against the same mistake for functions added later: stop the platform
-- default from handing EXECUTE to the browser-facing roles automatically.
-- New RPCs the app needs must now be granted explicitly, which is the safer
-- default for a system holding legal documents.
alter default privileges in schema public revoke execute on functions from anon;
alter default privileges in schema public revoke execute on functions from authenticated;


-- >>>>>>>>>>>>>>>>>>>> 0012_notification_read_state.sql <<<<<<<<<<<<<<<<<<<<

-- ═══════════════════════════════════════════════════════════════════════════
-- 0012 — Notification read state and per-item actions
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Fixes the reported bug "the notification count never clears even after the
-- client has seen them".
--
-- Cause: the SELECT policy lets a client see a notification either because they
-- are the named recipient *or* because it belongs to one of their cases:
--
--     using ( is_admin()
--             or recipient_id = auth.uid()
--             or (case_id is not null and owns_case(case_id)) )
--
-- but the UPDATE policy only covered `recipient_id = auth.uid()`. Automated
-- notifications raised by the case triggers are attached to the case and can
-- leave `recipient_id` null, so those rows were visible-but-unwritable: the
-- client could see them, the unread badge counted them, and `read_at` could
-- never be stamped. The badge therefore stuck permanently.
--
-- This migration aligns write access with read access, and adds the DELETE
-- access the per-notification menu needs. The existing
-- `enforce_notification_update` trigger still restricts recipients to changing
-- the read state only, so widening the policy does not let a client rewrite a
-- message, channel or delivery status.

-- ─── Recipients may mark anything they can see as read ──────────────────────

drop policy if exists "notifications_recipient_update" on public.notifications;
create policy "notifications_recipient_update"
  on public.notifications for update
  using (
    recipient_id = auth.uid()
    or (case_id is not null and public.owns_case(case_id))
  )
  with check (
    recipient_id = auth.uid()
    or (case_id is not null and public.owns_case(case_id))
  );

-- ─── Recipients may dismiss their own notifications ─────────────────────────
-- Deleting only removes the client's copy of an already-delivered message; the
-- outbound audit trail admins report on lives in `notification_log`.

drop policy if exists "notifications_recipient_delete" on public.notifications;
create policy "notifications_recipient_delete"
  on public.notifications for delete
  using (
    recipient_id = auth.uid()
    or (case_id is not null and public.owns_case(case_id))
  );

drop policy if exists "notifications_admin_delete" on public.notifications;
create policy "notifications_admin_delete"
  on public.notifications for delete
  using (public.is_admin());

-- ─── Mark-all-read helper ───────────────────────────────────────────────────
-- Doing this in one statement keeps the "seen" sweep atomic and means the client
-- does not have to replicate the visibility rules above in TypeScript.

create or replace function public.mark_my_notifications_read()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  touched integer;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  with updated as (
    update public.notifications n
       set read_at = now()
     where n.read_at is null
       and (
         n.recipient_id = auth.uid()
         or (n.case_id is not null and exists (
              select 1 from public.cases c
               where c.id = n.case_id
                 and c.client_id = auth.uid()
            ))
       )
    returning 1
  )
  select count(*) into touched from updated;

  return touched;
end;
$$;

revoke all on function public.mark_my_notifications_read() from public;
grant execute on function public.mark_my_notifications_read() to authenticated;

comment on function public.mark_my_notifications_read() is
  'Stamps read_at on every unread notification the caller can see (named '
  'recipient or owner of the linked case). Returns the number of rows touched.';


-- >>>>>>>>>>>>>>>>>>>> 0013_slot_availability.sql <<<<<<<<<<<<<<<<<<<<

-- ═══════════════════════════════════════════════════════════════════════════
-- 0013 — Slot occupancy for the client booking calendar
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The client asked for fully-booked dates to be shown as having no slots left.
-- That was impossible for the portal to know: `appointments_select_own_or_admin`
-- restricts a client to their own rows, so a client's calendar saw an empty day
-- no matter how many other people had booked it. Every slot looked free, and the
-- only feedback was a unique-violation error from `uq_appointments_live_slot`
-- when they tried to take one that was gone.
--
-- Exposing the appointments table more widely would leak who is consulting the
-- office, which is exactly the kind of thing a law office must not disclose. So
-- this function returns *only* the date and slot label of live bookings — enough
-- to grey out a slot, and nothing that identifies a client.

create or replace function public.booked_slots(p_from date, p_to date)
returns table (
  appointment_date date,
  time_slot        text
)
language sql
stable
security definer
set search_path = public
as $$
  select a.appointment_date, a.time_slot
    from public.appointments a
   where a.status <> 'cancelled'
     and a.appointment_date >= p_from
     and a.appointment_date <= p_to;
$$;

revoke all on function public.booked_slots(date, date) from public;
grant execute on function public.booked_slots(date, date) to authenticated;

comment on function public.booked_slots(date, date) is
  'Live bookings in a date range as (date, slot) pairs only. Deliberately '
  'returns no client identity so the booking calendar can show occupancy '
  'without disclosing who holds an appointment.';


-- >>>>>>>>>>>>>>>>>>>> 0014_filter_unconfirmed_clients.sql <<<<<<<<<<<<<<<<<<<<

-- ============================================================================
-- 0014 — Filter unconfirmed accounts from Admin Clients list
-- ----------------------------------------------------------------------------
-- When a visitor initiates account registration with email & password but
-- does not click the email confirmation link, their account is not verified
-- and cannot sign in. This migration ensures only email-confirmed users
-- (or staff-created accounts which are pre-confirmed) appear in the admin
-- client account register.
-- ============================================================================

create or replace function public.admin_list_clients(
  p_search text default null,
  p_active boolean default null,
  p_limit  int default 50,
  p_offset int default 0
)
returns table (
  id           uuid,
  full_name    text,
  email        text,
  phone        text,
  role         user_role,
  is_active    boolean,
  notes        text,
  created_at   timestamptz,
  case_count   bigint,
  open_cases   bigint,
  last_activity timestamptz,
  total_count  bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  return query
  with filtered as (
    select p.* from public.profiles p
    join auth.users u on u.id = p.id
    where u.email_confirmed_at is not null
      and (p_active is null or p.is_active = p_active)
      and (
        p_search is null or p_search = ''
        or p.full_name ilike '%' || p_search || '%'
        or p.email     ilike '%' || p_search || '%'
        or coalesce(p.phone, '') ilike '%' || p_search || '%'
      )
  )
  select f.id, f.full_name, f.email, f.phone, f.role, f.is_active, f.notes, f.created_at,
         (select count(*) from public.cases c where c.client_id = f.id) as case_count,
         (select count(*) from public.cases c
           where c.client_id = f.id and c.status::text not in ('done', 'cancelled')) as open_cases,
         (select max(c.updated_at) from public.cases c where c.client_id = f.id) as last_activity,
         (select count(*) from filtered) as total_count
  from filtered f
  order by f.created_at desc
  limit p_limit offset p_offset;
end;
$$;

revoke all on function public.admin_list_clients(text, boolean, int, int) from public;
grant execute on function public.admin_list_clients(text, boolean, int, int) to authenticated;


-- >>>>>>>>>>>>>>>>>>>> 0015_client_revision_fixes.sql <<<<<<<<<<<<<<<<<<<<

-- ============================================================================
-- 0015 - Client revision round 2 fixes
-- ----------------------------------------------------------------------------
-- 1. Repair mojibake in stored messages: an em dash written to setup.sql
--    through a Windows-1252 decode path was stored as "â€”" and reached the
--    client's notification feed ("may â€ hahaha" in the revision notes).
-- 2. Rebuild after_case_status_change() so future "case completed" messages
--    carry the clean template.
-- 3. Confirm existing accounts that were stuck waiting for a confirmation
--    email that the client never received.
-- 4. Auto-confirm future sign-ups. Walk-in legal clients must be able to sign
--    in immediately; flip "Confirm email" back on once a transactional SMTP
--    provider is configured (Authentication > Providers > Email).
-- ============================================================================

-- ── 1. Repair mojibake (U+2014/U+2013 mangled as UTF-8 read via CP1252) ─────
update public.notifications
set message = replace(replace(message, 'â€”', '—'), 'â€“', '–')
where message like '%â€%';

update public.case_requirements
set name  = replace(replace(name, 'â€”', '—'), 'â€“', '–'),
    note  = replace(replace(coalesce(note, ''), 'â€”', '—'), 'â€“', '–')
where name like '%â€%' or coalesce(note, '') like '%â€%';

update public.requirement_templates
set name  = replace(replace(name, 'â€”', '—'), 'â€“', '–'),
    note  = replace(replace(coalesce(note, ''), 'â€”', '—'), 'â€“', '–')
where name like '%â€%' or coalesce(note, '') like '%â€%';

-- ── 2. Rebuild the status-change notifier with the clean template ───────────

create or replace function public.after_case_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text;
  v_msg  text;
begin
  if new.status = old.status and new.phase = old.phase then
    return new;
  end if;

  insert into public.case_status_history
    (case_id, from_status, to_status, from_phase, to_phase, changed_by, note)
  values
    (new.id, old.status, new.status, old.phase, new.phase, auth.uid(), new.cancelled_reason);

  perform public.log_activity(
    'case.status_changed', 'case', new.id,
    jsonb_build_object(
      'reference', new.reference,
      'from_status', old.status::text, 'to_status', new.status::text,
      'from_phase', old.phase::text,  'to_phase', new.phase::text
    )
  );

  if new.status <> old.status then
    v_kind := case new.status::text
      when 'done'      then 'case_completed'
      when 'cancelled' then 'case_cancelled'
      when 'waiting'   then 'requirement_request'
      else 'status_update'
    end;

    v_msg := case new.status::text
      when 'done' then format(
        'Good news — your %s request (%s) is now complete. You may coordinate with the office for release.',
        public.module_label(new.module), new.reference)
      when 'cancelled' then format(
        'Your %s request (%s) has been cancelled.%s',
        public.module_label(new.module), new.reference,
        coalesce(' Reason: ' || new.cancelled_reason, ''))
      when 'waiting' then format(
        'Action needed on %s: some documentary requirements are still missing. Please upload them in your portal.',
        new.reference)
      else format(
        'Update on %s: status is now %s (%s).',
        new.reference, public.status_label(new.status), new.phase::text)
    end;
  else
    v_kind := 'phase_update';
    v_msg  := format('Update on %s: your case moved to the "%s" stage.', new.reference, new.phase::text);
  end if;

  perform public.enqueue_notification(new.id, new.client_id, v_kind, v_msg);

  return new;
end;
$$;

-- ── 3. Confirm accounts stuck waiting for a confirmation email ──────────────

update auth.users
set email_confirmed_at = coalesce(email_confirmed_at, now())
where email_confirmed_at is null;

-- ── 4. Auto-confirm future sign-ups ──────────────────────────────────────────
-- auth.config is a single-row table on the hosted platform. The exception
-- handler keeps this migration safe on versions where it does not exist; in
-- that case toggle "Confirm email" off in the dashboard instead.

do $$
begin
  update auth.config
  set mailer_autoconfirm = true
  where not coalesce(mailer_autoconfirm, false);
exception
  when undefined_table or undefined_column then
    raise notice 'auth.config unavailable here: turn off "Confirm email" under Authentication > Providers > Email.';
end
$$;


-- >>>>>>>>>>>>>>>>>>>> 0016_client_revision_round_3.sql <<<<<<<<<<<<<<<<<<<<

-- ============================================================================
-- 0016 - Client revision round 3
-- ----------------------------------------------------------------------------
--  1. Requirement checklists rewritten to the office's real lists
--     (no Proof of Address / TIN; Deed of Sale and EJS per the client's list).
--     EJS items are reminders only: originals are brought to the office, so
--     they must not appear as "pending" for the client.
--  2. Cases cannot be approved while a required (urgent) document is missing.
--  3. SMS removed: notifications are Email + in-portal only.
--  4. Appointments: slot must fall inside the day's real hours (custom
--     overrides included), cannot be in the past (Manila time), and a client
--     may hold only one upcoming booking. Admins are notified of new bookings
--     and cancellations.
--  5. Notifications are dispatched automatically (pg_net) once the project's
--     function URL and cron secret are stored in public.app_config. Nothing
--     drained the queue before, which is why no email was ever delivered.
-- ============================================================================

-- ── 1. Requirement templates ────────────────────────────────────────────────

alter table public.requirement_templates
  add column if not exists reminder_only boolean not null default false;

comment on column public.requirement_templates.reminder_only is
  'Shown to the client as a "bring this to the office" reminder, but never '
  'seeded into a case checklist, so it is never counted as pending.';

-- Notarization: valid ID + the document only.
delete from public.requirement_templates
 where name in ('Proof of Address', 'Tax Identification Number');

update public.requirement_templates
   set module = 'notarization'
 where module is null and name = 'Government-Issued Photo ID';

-- Deed of Sale and EJS: replaced wholesale by the client's lists.
delete from public.requirement_templates where module in ('deed', 'ejs');

insert into public.requirement_templates (module, name, note, urgent, sort_order, reminder_only) values
  ('deed', 'ID of Seller/s and Buyer/s', 'Valid government ID of every seller and buyer', true,  1, false),
  ('deed', 'Updated Tax Declaration',    'Latest copy from the local assessor''s office',  true,  2, false),
  ('deed', 'Title (if any)',             'Certificate of Title, if the property has one',  false, 3, false),
  ('deed', 'SPA (if any)',               'Special Power of Attorney, if a representative signs', false, 4, false),

  ('ejs', 'Death Certificate',                                  'Of the deceased',                              true,  1, true),
  ('ejs', 'ID of all heirs',                                    'If married, the ID of their spouse - or at least one ID', true, 2, true),
  ('ejs', 'Title (if any)',                                     'Certificate of Title, if the property has one', false, 3, true),
  ('ejs', 'Updated Tax Declaration',                            'Latest copy from the local assessor''s office', false, 4, true),
  ('ejs', 'SPA (if any)',                                       'Special Power of Attorney, if a representative acts', false, 5, true)
on conflict do nothing;

create or replace function public.seed_case_requirements()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.case_requirements (case_id, name, note, urgent, sort_order)
  select new.id, t.name, t.note, t.urgent, t.sort_order
  from public.requirement_templates t
  where t.active
    and not t.reminder_only
    and (t.module is null or t.module = new.module)
  order by t.sort_order, t.name;

  return new;
end;
$$;

-- Bring cases that are still open in line with the new lists. Rows that
-- already carry a document are left alone.
delete from public.case_requirements q
 using public.cases c
 where q.case_id = c.id
   and c.status::text not in ('done', 'cancelled')
   and not q.fulfilled
   and q.document_id is null
   and not exists (select 1 from public.documents d where d.requirement_id = q.id)
   and not exists (
     select 1 from public.requirement_templates t
      where t.active and not t.reminder_only
        and (t.module is null or t.module = c.module)
        and t.name = q.name
   );

insert into public.case_requirements (case_id, name, note, urgent, sort_order)
select c.id, t.name, t.note, t.urgent, t.sort_order
  from public.cases c
  join public.requirement_templates t
    on t.active and not t.reminder_only and t.module = c.module
 where c.status::text not in ('done', 'cancelled')
   and not exists (
     select 1 from public.case_requirements q
      where q.case_id = c.id and q.name = t.name
   );

-- ── 2. No approval while required documents are missing ─────────────────────

create or replace function public.guard_case_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_missing int;
begin
  if new.status::text = 'done' and old.status::text is distinct from 'done' then
    select count(*) into v_missing
      from public.case_requirements q
     where q.case_id = new.id and q.urgent and not q.fulfilled;

    if v_missing > 0 then
      raise exception
        'Cannot approve this case: % required document(s) are still missing.', v_missing
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_cases_guard_approval on public.cases;
create trigger trg_cases_guard_approval
  before update of status on public.cases
  for each row execute function public.guard_case_approval();

-- ── 3. Email only - drop SMS ────────────────────────────────────────────────

create or replace function public.enqueue_notification(
  p_case_id      uuid,
  p_recipient_id uuid,
  p_kind         text,
  p_message      text
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  select email into v_email from public.profiles where id = p_recipient_id;

  if v_email is not null and v_email <> '' then
    insert into public.notifications
      (case_id, recipient_id, recipient, channel, message, kind, created_by)
    values
      (p_case_id, p_recipient_id, v_email, 'email', p_message, p_kind, auth.uid());
    return 1;
  end if;
  return 0;
end;
$$;

delete from public.notifications where channel::text = 'sms';

-- ── 4. Appointment rules ────────────────────────────────────────────────────

create or replace function public.validate_appointment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_override  public.schedule_overrides;
  v_hours     public.office_hours;
  v_slot      public.office_time_slots;
  v_has_override boolean := false;
  v_has_hours    boolean := false;
  v_start     time;
  v_now_mnl   timestamp := (now() at time zone 'Asia/Manila');
begin
  if new.status::text in ('cancelled', 'completed') then
    return new;
  end if;

  -- Only re-validate when the booking itself moves, so closing out or editing
  -- an old appointment is never blocked by the "past" rules below.
  if tg_op = 'UPDATE'
     and new.appointment_date = old.appointment_date
     and new.time_slot = old.time_slot
     and old.status::text = 'booked' then
    return new;
  end if;

  if new.time_slot !~ '^(1[0-2]|[1-9]):[0-5][0-9] (AM|PM)$' then
    raise exception 'Invalid time slot "%".', new.time_slot using errcode = '22023';
  end if;
  v_start := to_timestamp(new.time_slot, 'HH12:MI AM')::time;

  if new.appointment_date < v_now_mnl::date then
    raise exception 'Appointments cannot be booked on a past date.' using errcode = '22007';
  end if;

  if new.appointment_date = v_now_mnl::date and v_start <= v_now_mnl::time then
    raise exception 'That time has already passed. Please choose a later slot.' using errcode = '22007';
  end if;

  select * into v_override
    from public.schedule_overrides
   where override_date = new.appointment_date;
  v_has_override := found;

  if v_has_override and v_override.type::text = 'closed' then
    raise exception 'The office is closed on %.', new.appointment_date using errcode = '22007';
  end if;

  if v_has_override and v_override.type::text = 'custom' then
    -- Custom hours: the hour must fit inside the override window.
    if v_start < v_override.open_time::time
       or v_start + interval '1 hour' > v_override.close_time::time then
      raise exception 'That time is outside the office hours for this date (% - %).',
        v_override.open_time, v_override.close_time using errcode = '22007';
    end if;
  else
    if not v_has_override then
      select * into v_hours
        from public.office_hours
       where day_of_week = extract(dow from new.appointment_date)::int;
      v_has_hours := found;

      if v_has_hours and not v_hours.is_open then
        raise exception 'The office is closed on %.', new.appointment_date using errcode = '22007';
      end if;

      if v_has_hours
         and (v_start < v_hours.open_time::time
              or v_start + interval '1 hour' > v_hours.close_time::time) then
        raise exception 'That time is outside the office hours (% - %).',
          v_hours.open_time, v_hours.close_time using errcode = '22007';
      end if;
    end if;

    select * into v_slot
      from public.office_time_slots
     where slot_label = new.time_slot and active;
    if not found then
      raise exception 'Invalid time slot "%".', new.time_slot using errcode = '22023';
    end if;

    if v_has_override and v_override.type::text = 'halfday' and not v_slot.halfday then
      raise exception 'Only morning slots are available on half-day operations.' using errcode = '22007';
    end if;
  end if;

  -- One upcoming booking per client (staff may book on a client's behalf).
  if tg_op = 'INSERT' and not public.is_admin() then
    if exists (
      select 1 from public.appointments a
       where a.client_id = new.client_id
         and a.status::text = 'booked'
         and a.appointment_date >= v_now_mnl::date
    ) then
      raise exception 'You already have an upcoming appointment. Cancel it before booking another.'
        using errcode = '23505';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_appointments_validate on public.appointments;
create trigger trg_appointments_validate
  before insert or update of appointment_date, time_slot, status on public.appointments
  for each row execute function public.validate_appointment();

-- Tell every active admin about new and cancelled bookings.
create or replace function public.notify_admins(p_kind text, p_message text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in select id from public.profiles where role = 'admin' and is_active loop
    perform public.enqueue_notification(null, r.id, p_kind, p_message);
  end loop;
end;
$$;

revoke all on function public.notify_admins(text, text) from public, anon, authenticated;

create or replace function public.after_appointment_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_when text := to_char(new.appointment_date, 'FMMonth FMDD, YYYY');
begin
  perform public.log_activity(
    'appointment.booked', 'appointment', new.id,
    jsonb_build_object('date', new.appointment_date, 'slot', new.time_slot)
  );

  perform public.enqueue_notification(
    new.case_id, new.client_id, 'appointment_booked',
    format('Your appointment is confirmed for %s at %s. Please bring your original documents.',
           v_when, new.time_slot)
  );

  select coalesce(nullif(full_name, ''), email, 'A client') into v_name
    from public.profiles where id = new.client_id;

  perform public.notify_admins(
    'appointment_admin',
    format('New appointment: %s booked %s at %s.', v_name, v_when, new.time_slot)
  );

  return new;
end;
$$;

create or replace function public.after_appointment_cancel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  if new.status::text = 'cancelled' and old.status::text = 'booked' then
    select coalesce(nullif(full_name, ''), email, 'A client') into v_name
      from public.profiles where id = new.client_id;

    perform public.notify_admins(
      'appointment_admin',
      format('Appointment cancelled: %s cancelled %s at %s.',
             v_name, to_char(new.appointment_date, 'FMMonth FMDD, YYYY'), new.time_slot)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists on_appointment_cancel on public.appointments;
create trigger on_appointment_cancel
  after update of status on public.appointments
  for each row execute function public.after_appointment_cancel();

-- ── 5. Automatic delivery of queued notifications ───────────────────────────
-- Configure once per project (SQL editor, values are NOT stored in git):
--   insert into public.app_config (key, value) values
--     ('functions_url', 'https://<project-ref>.supabase.co/functions/v1'),
--     ('cron_secret',   '<same value as the CRON_SECRET function secret>')
--   on conflict (key) do update set value = excluded.value;

do $$
begin
  create extension if not exists pg_net with schema extensions;
exception when others then
  raise notice 'pg_net unavailable - enable it under Database > Extensions.';
end $$;

create table if not exists public.app_config (
  key   text primary key,
  value text not null
);
alter table public.app_config enable row level security;
revoke all on public.app_config from anon, authenticated;

create or replace function public.dispatch_notification_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url    text;
  v_secret text;
begin
  select value into v_url    from public.app_config where key = 'functions_url';
  select value into v_secret from public.app_config where key = 'cron_secret';

  if v_url is null or v_secret is null then
    return new;
  end if;

  begin
    perform net.http_post(
      url     := v_url || '/send-notification',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
      body    := jsonb_build_object('id', new.id)
    );
  exception when others then
    -- Delivery is retried from the admin Notifications tab; never block the write.
    null;
  end;
  return new;
end;
$$;

drop trigger if exists trg_notifications_dispatch on public.notifications;
create trigger trg_notifications_dispatch
  after insert on public.notifications
  for each row execute function public.dispatch_notification_on_insert();

