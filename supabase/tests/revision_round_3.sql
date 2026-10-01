-- Round-3 rule checks. Runs entirely inside one transaction and ends by raising
-- an exception that carries the results, so nothing is ever persisted and no
-- notification can leave the database (pg_net queues are transactional too).
--
--   powershell -NoProfile -File supabase/query.ps1 -File supabase/tests/revision_round_3.sql
do $$
declare
  out        text := '';
  c1         uuid;
  c2         uuid;
  d_weekday  date;
  d_thu      date;
  d_sun      date;
  d_today    date := (now() at time zone 'Asia/Manila')::date;
  appt       uuid;
  k          uuid;
  n_admin    int;
begin
  select id into c1 from public.profiles where role = 'user' order by created_at limit 1;
  select id into c2 from public.profiles where role = 'user' order by created_at offset 1 limit 1;

  -- a future Wednesday, Thursday and Sunday
  d_weekday := current_date + ((3 - extract(dow from current_date)::int + 7) % 7) + 14;
  d_thu     := d_weekday + 1;
  d_sun     := current_date + ((0 - extract(dow from current_date)::int + 7) % 7) + 14;

  -- T1 normal booking
  begin
    insert into public.appointments (client_id, appointment_date, time_slot)
    values (c1, d_weekday, '10:00 AM') returning id into appt;
    out := out || E'T1 normal booking: OK\n';
  exception when others then out := out || E'T1 normal booking: FAIL ' || sqlerrm || E'\n'; end;

  -- T2 second booking for same client must be refused
  begin
    insert into public.appointments (client_id, appointment_date, time_slot)
    values (c1, d_weekday + 7, '2:00 PM');
    out := out || E'T2 one booking per client: FAIL (second booking allowed)\n';
  exception when others then out := out || E'T2 one booking per client: OK (' || sqlerrm || E')\n'; end;

  -- T3 outside normal hours
  begin
    insert into public.appointments (client_id, appointment_date, time_slot)
    values (c2, d_weekday, '6:00 PM');
    out := out || E'T3 outside office hours: FAIL (accepted)\n';
  exception when others then out := out || E'T3 outside office hours: OK (' || sqlerrm || E')\n'; end;

  -- T4 Sunday closed (from office_hours)
  begin
    insert into public.appointments (client_id, appointment_date, time_slot)
    values (c2, d_sun, '10:00 AM');
    out := out || E'T4 Sunday closed: FAIL (accepted)\n';
  exception when others then out := out || E'T4 Sunday closed: OK (' || sqlerrm || E')\n'; end;

  -- T5 custom 7 AM - 9 PM override accepts 7:00 AM and 8:00 PM, refuses 9:00 PM
  insert into public.schedule_overrides (override_date, type, open_time, close_time)
  values (d_thu, 'custom', '07:00', '21:00');
  begin
    insert into public.appointments (client_id, appointment_date, time_slot)
    values (c2, d_thu, '7:00 AM');
    out := out || E'T5a custom 7:00 AM: OK\n';
  exception when others then out := out || E'T5a custom 7:00 AM: FAIL ' || sqlerrm || E'\n'; end;
  begin
    select id into k from public.profiles where role = 'user' order by created_at offset 2 limit 1;
    insert into public.appointments (client_id, appointment_date, time_slot)
    values (k, d_thu, '8:00 PM');
    out := out || E'T5b custom 8:00 PM: OK\n';
  exception when others then out := out || E'T5b custom 8:00 PM: FAIL ' || sqlerrm || E'\n'; end;
  begin
    select id into k from public.profiles where role = 'user' order by created_at offset 3 limit 1;
    insert into public.appointments (client_id, appointment_date, time_slot)
    values (k, d_thu, '9:00 PM');
    out := out || E'T5c custom 9:00 PM: FAIL (accepted)\n';
  exception when others then out := out || E'T5c custom 9:00 PM refused: OK (' || sqlerrm || E')\n'; end;

  -- T6 a time that already passed today is refused
  insert into public.schedule_overrides (override_date, type, open_time, close_time)
  values (d_today, 'custom', '00:00', '23:00')
  on conflict (override_date) do update set type = 'custom', open_time = '00:00', close_time = '23:00';
  begin
    select id into k from public.profiles where role = 'user' order by created_at offset 4 limit 1;
    insert into public.appointments (client_id, appointment_date, time_slot)
    values (k, d_today, '1:00 AM');
    out := out || E'T6 past time today: FAIL (accepted)\n';
  exception when others then out := out || E'T6 past time today refused: OK (' || sqlerrm || E')\n'; end;

  -- T7 cancelling notifies admins
  update public.appointments set status = 'cancelled' where id = appt;
  select count(*) into n_admin from public.notifications where kind = 'appointment_admin';
  out := out || format(E'T7 admin notifications queued (booking + cancel): %s\n', n_admin);

  -- T8 approval blocked while required documents are missing
  declare
    new_case uuid;
  begin
    insert into public.cases (client_id, module, created_by)
    values (c1, 'deed', c1) returning id into new_case;
    out := out || format(E'T8 deed checklist seeded: %s rows\n',
      (select count(*) from public.case_requirements where case_id = new_case));
    begin
      update public.cases set status = 'done' where id = new_case;
      out := out || E'T8 approve with missing docs: FAIL (allowed)\n';
    exception when others then out := out || E'T8 approve with missing docs refused: OK (' || sqlerrm || E')\n'; end;
  exception when others then out := out || E'T8 setup: FAIL ' || sqlerrm || E'\n'; end;

  raise exception E'\n%', out;
end
$$;
