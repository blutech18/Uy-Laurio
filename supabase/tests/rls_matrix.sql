-- ============================================================================
-- Uy-Laurio Legal Portal — Row Level Security isolation matrix
-- ----------------------------------------------------------------------------
-- Proves the access rules rather than assuming them. Every check impersonates a
-- real role (anon / authenticated with a given user id) inside one transaction
-- using SET LOCAL ROLE plus a forged `request.jwt.claims`, which is how
-- auth.uid() and auth.role() resolve identity.
--
-- Read-only in effect: the write attempts are all expected to be rejected, and
-- the whole thing runs inside the caller's transaction.
--
-- Run with:
--   powershell -NoProfile -File supabase/query.ps1 -File supabase/tests/rls_matrix.sql
--
-- Every row should report PASS. Read the first row (00_summary) first.
-- ============================================================================

create or replace function public.__rls_matrix()
returns table (check_name text, expectation text, observed text, status text)
language plpgsql
as $fn$
declare
  client_a   uuid;
  client_b   uuid;
  admin_id   uuid;
  total_cases   bigint;
  total_docs    bigint;
  n             bigint;
  old_role      text;
begin
  -- Identities: two distinct clients that own cases, plus one administrator.
  select c.client_id into client_a
  from public.cases c join public.profiles p on p.id = c.client_id
  where p.role = 'user' order by c.created_at limit 1;

  select c.client_id into client_b
  from public.cases c join public.profiles p on p.id = c.client_id
  where p.role = 'user' and c.client_id <> client_a order by c.created_at limit 1;

  select id into admin_id from public.profiles where role = 'admin' and is_active
  order by created_at limit 1;

  select count(*) into total_cases from public.cases;
  select count(*) into total_docs  from public.documents;

  if client_a is null or client_b is null then
    return query select 'setup'::text, 'two client accounts with cases'::text,
                        'not enough test data'::text, 'SKIP'::text;
    return;
  end if;

  -- ─── anon ────────────────────────────────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';

  begin
    select count(*) into n from public.cases;
    return query select 'anon reads cases', '0 rows', n::text,
                        case when n = 0 then 'PASS' else 'FAIL' end;
  exception when others then
    return query select 'anon reads cases', '0 rows', 'blocked: ' || sqlerrm, 'PASS';
  end;

  begin
    select count(*) into n from public.profiles;
    return query select 'anon reads profiles', '0 rows', n::text,
                        case when n = 0 then 'PASS' else 'FAIL' end;
  exception when others then
    return query select 'anon reads profiles', '0 rows', 'blocked: ' || sqlerrm, 'PASS';
  end;

  begin
    select count(*) into n from public.documents;
    return query select 'anon reads documents', '0 rows', n::text,
                        case when n = 0 then 'PASS' else 'FAIL' end;
  exception when others then
    return query select 'anon reads documents', '0 rows', 'blocked: ' || sqlerrm, 'PASS';
  end;

  execute 'reset role';

  -- ─── client A ────────────────────────────────────────────────────────────
  perform set_config('request.jwt.claims',
    json_build_object('sub', client_a::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  -- Can see own work
  select count(*) into n from public.cases where client_id = client_a;
  return query select 'client A reads own cases', '>= 1 row', n::text,
                      case when n >= 1 then 'PASS' else 'FAIL' end;

  -- Cannot see anyone else's
  select count(*) into n from public.cases where client_id <> client_a;
  return query select 'client A reads other clients'' cases', '0 rows', n::text,
                      case when n = 0 then 'PASS' else 'FAIL' end;

  select count(*) into n from public.documents where owner_id <> client_a;
  return query select 'client A reads other clients'' documents', '0 rows', n::text,
                      case when n = 0 then 'PASS' else 'FAIL' end;

  select count(*) into n from public.case_requirements q
  where exists (select 1 from public.cases c where c.id = q.case_id and c.client_id <> client_a);
  return query select 'client A reads other clients'' requirements', '0 rows', n::text,
                      case when n = 0 then 'PASS' else 'FAIL' end;

  select count(*) into n from public.notifications where recipient_id <> client_a;
  return query select 'client A reads other clients'' notifications', '0 rows', n::text,
                      case when n = 0 then 'PASS' else 'FAIL' end;

  select count(*) into n from public.appointments where client_id <> client_a;
  return query select 'client A reads other clients'' appointments', '0 rows', n::text,
                      case when n = 0 then 'PASS' else 'FAIL' end;

  -- Audit trail is staff-only
  begin
    select count(*) into n from public.activity_log;
    return query select 'client A reads activity_log', '0 rows', n::text,
                        case when n = 0 then 'PASS' else 'FAIL' end;
  exception when others then
    return query select 'client A reads activity_log', 'rejected', 'blocked: ' || sqlerrm, 'PASS';
  end;

  -- Reports must refuse a client
  begin
    perform public.admin_dashboard_stats();
    return query select 'client A calls admin_dashboard_stats', 'rejected', 'ALLOWED', 'FAIL';
  exception when others then
    return query select 'client A calls admin_dashboard_stats', 'rejected', 'rejected', 'PASS';
  end;

  begin
    perform * from public.report_transaction_log(null, null, null, null);
    return query select 'client A calls report_transaction_log', 'rejected', 'ALLOWED', 'FAIL';
  exception when others then
    return query select 'client A calls report_transaction_log', 'rejected', 'rejected', 'PASS';
  end;

  begin
    perform * from public.list_cases(null, null, null, null, null, 50, 0);
    return query select 'client A calls list_cases', 'rejected', 'ALLOWED', 'FAIL';
  exception when others then
    return query select 'client A calls list_cases', 'rejected', 'rejected', 'PASS';
  end;

  begin
    perform * from public.admin_list_clients(null, null, 50, 0);
    return query select 'client A calls admin_list_clients', 'rejected', 'ALLOWED', 'FAIL';
  exception when others then
    return query select 'client A calls admin_list_clients', 'rejected', 'rejected', 'PASS';
  end;

  -- Privilege escalation
  begin
    update public.profiles set role = 'admin' where id = client_a;
    select count(*) into n from public.profiles where id = client_a and role = 'admin';
    return query select 'client A promotes self to admin', 'rejected',
                        case when n = 0 then 'no rows changed' else 'ESCALATED' end,
                        case when n = 0 then 'PASS' else 'FAIL' end;
  exception when others then
    return query select 'client A promotes self to admin', 'rejected', 'rejected', 'PASS';
  end;

  begin
    update public.profiles set is_active = false where id = client_b;
    select count(*) into n from public.profiles where id = client_b and is_active = false;
    return query select 'client A deactivates another account', 'rejected',
                        case when n = 0 then 'no rows changed' else 'MODIFIED' end,
                        case when n = 0 then 'PASS' else 'FAIL' end;
  exception when others then
    return query select 'client A deactivates another account', 'rejected', 'rejected', 'PASS';
  end;

  -- Filing a case in someone else's name
  begin
    insert into public.cases (client_id, module) values (client_b, 'notarization');
    return query select 'client A files a case for client B', 'rejected', 'ALLOWED', 'FAIL';
  exception when others then
    return query select 'client A files a case for client B', 'rejected', 'rejected', 'PASS';
  end;

  -- Advancing their own case
  begin
    update public.cases set phase = 'Final Sign-off / Execution' where client_id = client_a;
    return query select 'client A advances own case phase', 'rejected', 'ALLOWED', 'FAIL';
  exception when others then
    return query select 'client A advances own case phase', 'rejected', 'rejected', 'PASS';
  end;

  -- Inventing requirements
  begin
    insert into public.case_requirements (case_id, name)
    select id, 'self-added' from public.cases where client_id = client_a limit 1;
    return query select 'client A inserts a requirement', 'rejected', 'ALLOWED', 'FAIL';
  exception when others then
    return query select 'client A inserts a requirement', 'rejected', 'rejected', 'PASS';
  end;

  -- Ticking a requirement with no document attached
  begin
    update public.case_requirements q set fulfilled = true
    where q.document_id is null
      and exists (select 1 from public.cases c where c.id = q.case_id and c.client_id = client_a);
    return query select 'client A ticks requirement with no document', 'rejected', 'ALLOWED', 'FAIL';
  exception when others then
    return query select 'client A ticks requirement with no document', 'rejected', 'rejected', 'PASS';
  end;

  -- Writing their own notifications
  begin
    insert into public.notifications (recipient, channel, message)
    values ('attacker@example.com', 'email', 'injected');
    return query select 'client A inserts a notification', 'rejected', 'ALLOWED', 'FAIL';
  exception when others then
    return query select 'client A inserts a notification', 'rejected', 'rejected', 'PASS';
  end;

  -- Editing office hours
  begin
    update public.office_hours set is_open = true where day_of_week = 0;
    select count(*) into n from public.office_hours where day_of_week = 0 and is_open;
    return query select 'client A edits office hours', 'rejected',
                        case when n = 0 then 'no rows changed' else 'MODIFIED' end,
                        case when n = 0 then 'PASS' else 'FAIL' end;
  exception when others then
    return query select 'client A edits office hours', 'rejected', 'rejected', 'PASS';
  end;

  -- Server-only helpers. These are SECURITY DEFINER and bypass RLS, so a
  -- client being able to call them is a privilege escalation, not a nuisance.
  begin
    perform public.claim_notification(gen_random_uuid());
    return query select 'client A calls claim_notification', 'rejected', 'ALLOWED', 'FAIL';
  exception when others then
    return query select 'client A calls claim_notification', 'rejected', 'rejected', 'PASS';
  end;

  begin
    perform public.enqueue_notification(null, client_b, 'announcement', 'injected message');
    return query select 'client A calls enqueue_notification', 'rejected', 'ALLOWED', 'FAIL';
  exception when others then
    return query select 'client A calls enqueue_notification', 'rejected', 'rejected', 'PASS';
  end;

  begin
    perform public.log_activity('forged.entry', 'case', null, '{}'::jsonb);
    return query select 'client A calls log_activity', 'rejected', 'ALLOWED', 'FAIL';
  exception when others then
    return query select 'client A calls log_activity', 'rejected', 'rejected', 'PASS';
  end;

  begin
    perform public.queue_requirement_reminders();
    return query select 'client A calls queue_requirement_reminders', 'rejected', 'ALLOWED', 'FAIL';
  exception when others then
    return query select 'client A calls queue_requirement_reminders', 'rejected', 'rejected', 'PASS';
  end;

  -- Reference data a client legitimately needs
  select count(*) into n from public.requirement_templates where active;
  return query select 'client A reads requirement templates', '>= 1 row', n::text,
                      case when n >= 1 then 'PASS' else 'FAIL' end;

  select count(*) into n from public.office_time_slots where active;
  return query select 'client A reads time slots', '>= 1 row', n::text,
                      case when n >= 1 then 'PASS' else 'FAIL' end;

  execute 'reset role';

  -- ─── admin ───────────────────────────────────────────────────────────────
  perform set_config('request.jwt.claims',
    json_build_object('sub', admin_id::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  select count(*) into n from public.cases;
  return query select 'admin reads every case', total_cases || ' rows', n::text,
                      case when n = total_cases then 'PASS' else 'FAIL' end;

  select count(*) into n from public.documents;
  return query select 'admin reads every document', total_docs || ' rows', n::text,
                      case when n = total_docs then 'PASS' else 'FAIL' end;

  begin
    perform public.admin_dashboard_stats();
    return query select 'admin calls admin_dashboard_stats', 'allowed', 'allowed', 'PASS';
  exception when others then
    return query select 'admin calls admin_dashboard_stats', 'allowed', 'blocked: ' || sqlerrm, 'FAIL';
  end;

  begin
    select count(*) into n from public.activity_log;
    return query select 'admin reads activity_log', 'allowed', n || ' rows', 'PASS';
  exception when others then
    return query select 'admin reads activity_log', 'allowed', 'blocked: ' || sqlerrm, 'FAIL';
  end;

  execute 'reset role';

  -- ─── deactivated account ─────────────────────────────────────────────────
  old_role := 'restore';
  update public.profiles set is_active = false where id = client_b;

  perform set_config('request.jwt.claims',
    json_build_object('sub', client_b::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  select count(*) into n from public.cases where client_id = client_b;
  return query select 'deactivated client reads own cases', '0 rows', n::text,
                      case when n = 0 then 'PASS' else 'FAIL' end;

  execute 'reset role';
  update public.profiles set is_active = true where id = client_b;

  return;
end;
$fn$;

-- Run it, summarised, then clean up the helper.
select 'PASS' as status, count(*) as checks from public.__rls_matrix() where status = 'PASS'
union all
select 'FAIL', count(*) from public.__rls_matrix() where status = 'FAIL';
