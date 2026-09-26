-- ============================================================================
-- 0014 — Filter unconfirmed accounts from Admin Clients list
-- ----------------------------------------------------------------------------
-- When a visitor initiates account registration with email & password but
-- does not click the email confirmation link, their account is not verified
-- and cannot sign in. This migration ensures only email-confirmed users
-- (or staff-created accounts which are pre-confirmed) appear in the admin
-- client account register.
-- ============================================================================

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
    join auth.users u on u.id = p.id
    where u.email_confirmed_at is not null
      and (p_active is null or p.is_active = p_active)
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
  limit p_limit offset p_offset;
end;
$$;

revoke all on function public.admin_list_clients(text, boolean, int, int) from public;
grant execute on function public.admin_list_clients(text, boolean, int, int) to authenticated;
