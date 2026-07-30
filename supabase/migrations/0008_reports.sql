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
