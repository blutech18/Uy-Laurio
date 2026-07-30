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
