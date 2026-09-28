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
