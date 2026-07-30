-- ============================================================================
-- Post-migration verification
-- ----------------------------------------------------------------------------
-- ONE query on purpose: the Supabase SQL editor only shows the result of the
-- last statement, so every check is unioned into a single result set.
-- Read-only. Look at the "00_summary" row first: issues = 0 means all good.
-- ============================================================================

with expected(kind, name) as (
  values
    ('1_table',    'requirement_templates'),
    ('1_table',    'office_hours'),
    ('1_table',    'office_time_slots'),
    ('1_table',    'case_status_history'),
    ('1_table',    'activity_log'),

    ('2_function', 'is_privileged_context'),
    ('2_function', 'is_active_user'),
    ('2_function', 'owns_case'),
    ('2_function', 'enqueue_notification'),
    ('2_function', 'log_activity'),
    ('2_function', 'seed_case_requirements'),
    ('2_function', 'validate_appointment'),
    ('2_function', 'admin_dashboard_stats'),
    ('2_function', 'list_cases'),
    ('2_function', 'admin_list_clients'),
    ('2_function', 'report_service_summary'),
    ('2_function', 'report_transaction_log'),
    ('2_function', 'report_activity_log'),
    ('2_function', 'report_notification_log'),
    ('2_function', 'client_case_history'),
    ('2_function', 'case_timeline'),
    ('2_function', 'queue_requirement_reminders'),
    ('2_function', 'queue_appointment_reminders'),

    ('3_trigger',  'on_case_created'),
    ('3_trigger',  'on_case_created_notify'),
    ('3_trigger',  'on_case_status_change'),
    ('3_trigger',  'on_document_insert'),
    ('3_trigger',  'on_document_verified'),
    ('3_trigger',  'on_appointment_insert'),
    ('3_trigger',  'trg_appointments_validate'),
    ('3_trigger',  'trg_cases_completion'),
    ('3_trigger',  'trg_cases_client_guard'),
    ('3_trigger',  'trg_requirements_client_guard'),
    ('3_trigger',  'trg_notifications_update_guard'),
    ('3_trigger',  'trg_profiles_update_guard'),
    ('3_trigger',  'on_auth_user_email_changed')
),

objects as (
  select e.kind as category, e.name as item,
         case when f.found then 'ok' else 'MISSING' end as result
  from expected e
  cross join lateral (
    select case e.kind
      when '1_table' then exists (
        select 1 from pg_tables where schemaname = 'public' and tablename = e.name)
      when '2_function' then exists (
        select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = e.name)
      when '3_trigger' then exists (
        select 1 from pg_trigger where not tgisinternal and tgname = e.name)
    end as found
  ) f
),

status_enum as (
  select '4_enum' as category, 'case_status labels' as item,
         coalesce((
           select string_agg(enumlabel, ', ' order by enumsortorder)
           from pg_enum where enumtypid = 'case_status'::regtype
         ), 'MISSING') as result
),

notif_cols as (
  select '5_column' as category, 'notifications.' || c.name as item,
         case when exists (
           select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'notifications'
             and column_name = c.name
         ) then 'ok' else 'MISSING' end as result
  from (values ('recipient_id'), ('read_at'), ('kind'), ('delivery_status'),
               ('attempts'), ('sent_at'), ('provider_message_id'), ('error')) as c(name)
),

seeds as (
  select '6_seed' as category, s.item,
         case when s.n = s.want then 'ok (' || s.n || ')'
              when s.n = 0 then 'EMPTY — expected ' || s.want
              else 'ok? ' || s.n || ' rows (expected ' || s.want || ')' end as result
  from (
    select 'requirement_templates' as item,
           (select count(*) from public.requirement_templates) as n, 15 as want
    union all select 'office_hours',
           (select count(*) from public.office_hours), 7
    union all select 'office_time_slots',
           (select count(*) from public.office_time_slots), 7
  ) s
),

storage_check as (
  select '7_storage' as category, 'documents bucket' as item,
         coalesce(
           (select coalesce(file_size_limit::text, 'NO SIZE LIMIT') || ' bytes / ' ||
                   coalesce(array_to_string(allowed_mime_types, ' '), 'ANY MIME TYPE')
            from storage.buckets where id = 'documents'),
           'BUCKET MISSING') as result
),

realtime as (
  select '8_realtime' as category, t.name as item,
         case when exists (
           select 1 from pg_publication_tables
           where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t.name
         ) then 'ok' else 'NOT PUBLISHED — enable in Database > Replication' end as result
  from (values ('cases'), ('documents'), ('case_requirements'),
               ('notifications'), ('appointments'), ('schedule_overrides')) as t(name)
),

rls as (
  select '9_rls' as category, tablename as item,
         case when rowsecurity then 'ok' else 'RLS DISABLED' end as result
  from pg_tables
  where schemaname = 'public'
    and tablename in ('profiles','cases','documents','case_requirements','notifications',
                      'appointments','schedule_overrides','requirement_templates',
                      'office_hours','office_time_slots','case_status_history','activity_log')
),

admins as (
  select 'a_accounts' as category, 'admin profiles' as item,
         case when count(*) = 0
              then 'NONE — run: update public.profiles set role = ''admin'' where email = ''you@example.com'''
              else 'ok (' || count(*) || ')' end as result
  from public.profiles where role = 'admin'
),

queue as (
  select 'b_queue' as category,
         'notifications ' || delivery_status as item,
         count(*)::text || ' row(s)' as result
  from public.notifications group by delivery_status
),

checks as (
  select * from objects
  union all select * from status_enum
  union all select * from notif_cols
  union all select * from seeds
  union all select * from storage_check
  union all select * from realtime
  union all select * from rls
  union all select * from admins
  union all select * from queue
)

select category, item, result from (
  select '00_summary' as category, 'issues' as item,
         count(*)::text as result
  from checks
  where result not like 'ok%'
    and category not in ('4_enum', '7_storage', 'b_queue')
  union all
  select * from checks
) x
order by category, item;
