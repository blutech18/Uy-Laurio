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
