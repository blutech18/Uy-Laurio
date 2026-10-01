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
