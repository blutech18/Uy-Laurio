-- ============================================================================
-- Regression test: a client can still file a case after 0011 revoked EXECUTE on
-- the server-only helpers. The trigger chain calls enqueue_notification and
-- log_activity internally, so this proves those calls still work when they run
-- as the function owner rather than as the client.
--
-- Everything happens inside a transaction that is rolled back, so no case,
-- document or notification survives the test.
--
--   powershell -NoProfile -File supabase/query.ps1 -File supabase/tests/client_flow.sql
-- ============================================================================

create or replace function public.__client_flow_test()
returns table (step text, expectation text, observed text, status text)
language plpgsql
as $fn$
declare
  client_a  uuid;
  new_case  uuid;
  reqs      bigint;
  notifs    bigint;
  audit     bigint;
  req_id    uuid;
begin
  select c.client_id into client_a
  from public.cases c join public.profiles p on p.id = c.client_id
  where p.role = 'user' and p.is_active order by c.created_at limit 1;

  perform set_config('request.jwt.claims',
    json_build_object('sub', client_a::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  -- 1. File a case as the client
  begin
    insert into public.cases (client_id, module, module_detail)
    values (client_a, 'notarization', 'RLS regression test - rolled back')
    returning id into new_case;
    return query select 'client files a case', 'allowed', 'created', 'PASS';
  exception when others then
    execute 'reset role';
    return query select 'client files a case', 'allowed', 'blocked: ' || sqlerrm, 'FAIL';
    return;
  end;

  execute 'reset role';

  -- 2. Checklist seeded from requirement_templates by trigger
  select count(*) into reqs from public.case_requirements where case_id = new_case;
  return query select 'checklist seeded from templates', '>= 3 items', reqs::text,
                      case when reqs >= 3 then 'PASS' else 'FAIL' end;

  -- 3. Acknowledgement queued by trigger (via enqueue_notification)
  select count(*) into notifs from public.notifications where case_id = new_case;
  return query select 'acknowledgement queued', '>= 1 message', notifs::text,
                      case when notifs >= 1 then 'PASS' else 'FAIL' end;

  -- 4. Audit entry written by trigger (via log_activity)
  select count(*) into audit from public.activity_log
  where entity_id = new_case and action = 'case.created';
  return query select 'audit entry written', '1 row', audit::text,
                      case when audit >= 1 then 'PASS' else 'FAIL' end;

  -- 5. Uploading against a checklist item fulfils it
  select id into req_id from public.case_requirements
  where case_id = new_case order by sort_order limit 1;

  perform set_config('request.jwt.claims',
    json_build_object('sub', client_a::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  begin
    insert into public.documents (case_id, owner_id, name, storage_path, size_bytes, mime_type, requirement_id)
    values (new_case, client_a, 'test.pdf', client_a || '/' || new_case || '/test.pdf',
            1024, 'application/pdf', req_id);
    execute 'reset role';
    return query select 'client uploads a document', 'allowed', 'created', 'PASS';
  exception when others then
    execute 'reset role';
    return query select 'client uploads a document', 'allowed', 'blocked: ' || sqlerrm, 'FAIL';
  end;

  select count(*) into reqs from public.case_requirements
  where id = req_id and fulfilled and document_id is not null;
  return query select 'requirement auto-fulfilled and linked', '1 row', reqs::text,
                      case when reqs = 1 then 'PASS' else 'FAIL' end;

  -- 6. Status history recorded when staff move the case
  update public.cases set status = 'progress', phase = 'In Progress' where id = new_case;
  select count(*) into reqs from public.case_status_history where case_id = new_case;
  return query select 'status history recorded', '>= 2 rows', reqs::text,
                      case when reqs >= 2 then 'PASS' else 'FAIL' end;

  return;
end;
$fn$;

begin;
select step, expectation, observed, status from public.__client_flow_test();
rollback;
