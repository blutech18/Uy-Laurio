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
