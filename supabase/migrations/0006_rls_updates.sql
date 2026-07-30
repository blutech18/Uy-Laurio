-- ============================================================================
-- Uy-Laurio Legal Portal — RLS for the completed schema
-- ----------------------------------------------------------------------------
-- Phase 2 of docs/BACKEND-COMPLETION-ANALYSIS.md.
--
--   * Deactivated accounts lose access to operational data.
--   * Staff may record cases on behalf of walk-in clients.
--   * Clients may cancel their own open case (column-level rules enforced by
--     triggers in 0007).
--   * Office-wide notifications (case_id null) reach their recipient.
--   * New reference/audit tables get least-privilege policies.
--
-- New enum labels are compared as text so this file remains transaction-safe
-- immediately after 0005.
-- ============================================================================

-- ─── Helper predicates ──────────────────────────────────────────────────────

-- An admin must also be an active account.
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and is_active
  );
$$;

create or replace function public.is_active_user()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
  );
$$;

/**
 * True when the statement is *not* running on behalf of an end user: internal
 * trigger logic (security-definer functions run as the table owner), the
 * service role used by Edge Functions, or direct SQL access.
 *
 * The column-level guards in 0007 use this so server-side automation is not
 * blocked by rules that exist to constrain clients. It must stay
 * SECURITY INVOKER — current_user is only meaningful in the caller's context.
 */
create or replace function public.is_privileged_context()
returns boolean
language sql
stable
as $$
  select current_user::text not in ('authenticated', 'anon');
$$;

-- Does the caller own this case?
create or replace function public.owns_case(p_case_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.cases
    where id = p_case_id and client_id = auth.uid()
  );
$$;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_active_user() to authenticated;
grant execute on function public.is_privileged_context() to authenticated;
grant execute on function public.owns_case(uuid) to authenticated;

-- ─── cases ──────────────────────────────────────────────────────────────────

drop policy if exists "cases_select_own_or_admin" on public.cases;
create policy "cases_select_own_or_admin"
  on public.cases for select
  using (
    (client_id = auth.uid() and public.is_active_user())
    or assigned_to = auth.uid()
    or public.is_admin()
  );

drop policy if exists "cases_insert_own" on public.cases;
create policy "cases_insert_own"
  on public.cases for insert
  with check (client_id = auth.uid() and public.is_active_user());

-- Staff record transactions for walk-in clients.
drop policy if exists "cases_admin_insert" on public.cases;
create policy "cases_admin_insert"
  on public.cases for insert
  with check (public.is_admin());

-- Clients may only touch their own case while it is still open; the trigger
-- enforce_client_case_update (0007) limits them to cancelling it.
drop policy if exists "cases_client_update_own" on public.cases;
create policy "cases_client_update_own"
  on public.cases for update
  using (
    client_id = auth.uid()
    and public.is_active_user()
    and status::text not in ('done', 'cancelled')
  )
  with check (client_id = auth.uid());

-- ─── documents ──────────────────────────────────────────────────────────────

drop policy if exists "documents_insert_own" on public.documents;
create policy "documents_insert_own"
  on public.documents for insert
  with check (
    owner_id = auth.uid()
    and public.is_active_user()
    and public.owns_case(case_id)
  );

-- Staff may attach documents captured over the counter.
drop policy if exists "documents_admin_insert" on public.documents;
create policy "documents_admin_insert"
  on public.documents for insert
  with check (public.is_admin());

-- ─── case_requirements ──────────────────────────────────────────────────────
-- Clients tick their own checklist; verification columns are admin-only
-- (enforced by enforce_client_requirement_update in 0007).

drop policy if exists "requirements_select_own_or_admin" on public.case_requirements;
create policy "requirements_select_own_or_admin"
  on public.case_requirements for select
  using (public.is_admin() or public.owns_case(case_id));

drop policy if exists "requirements_update_own_or_admin" on public.case_requirements;
create policy "requirements_update_own_or_admin"
  on public.case_requirements for update
  using (
    public.is_admin()
    or (public.owns_case(case_id) and public.is_active_user())
  );

-- ─── notifications ──────────────────────────────────────────────────────────

drop policy if exists "notifications_select_own_or_admin" on public.notifications;
create policy "notifications_select_own_or_admin"
  on public.notifications for select
  using (
    public.is_admin()
    or recipient_id = auth.uid()
    or (case_id is not null and public.owns_case(case_id))
  );

-- Recipients may only stamp read_at (enforce_notification_update in 0007).
drop policy if exists "notifications_recipient_update" on public.notifications;
create policy "notifications_recipient_update"
  on public.notifications for update
  using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

-- ─── appointments ───────────────────────────────────────────────────────────

drop policy if exists "appointments_insert_own" on public.appointments;
create policy "appointments_insert_own"
  on public.appointments for insert
  with check (client_id = auth.uid() and public.is_active_user());

drop policy if exists "appointments_admin_insert" on public.appointments;
create policy "appointments_admin_insert"
  on public.appointments for insert
  with check (public.is_admin());

-- ─── requirement_templates ──────────────────────────────────────────────────

alter table public.requirement_templates enable row level security;

drop policy if exists "templates_select_authenticated" on public.requirement_templates;
create policy "templates_select_authenticated"
  on public.requirement_templates for select
  using (auth.role() = 'authenticated');

drop policy if exists "templates_admin_write" on public.requirement_templates;
create policy "templates_admin_write"
  on public.requirement_templates for all
  using (public.is_admin())
  with check (public.is_admin());

-- ─── office_hours ───────────────────────────────────────────────────────────

alter table public.office_hours enable row level security;

drop policy if exists "office_hours_select_authenticated" on public.office_hours;
create policy "office_hours_select_authenticated"
  on public.office_hours for select
  using (auth.role() = 'authenticated');

drop policy if exists "office_hours_admin_write" on public.office_hours;
create policy "office_hours_admin_write"
  on public.office_hours for all
  using (public.is_admin())
  with check (public.is_admin());

-- ─── office_time_slots ──────────────────────────────────────────────────────

alter table public.office_time_slots enable row level security;

drop policy if exists "time_slots_select_authenticated" on public.office_time_slots;
create policy "time_slots_select_authenticated"
  on public.office_time_slots for select
  using (auth.role() = 'authenticated');

drop policy if exists "time_slots_admin_write" on public.office_time_slots;
create policy "time_slots_admin_write"
  on public.office_time_slots for all
  using (public.is_admin())
  with check (public.is_admin());

-- ─── case_status_history ────────────────────────────────────────────────────
-- Read-only to users; rows are written exclusively by the 0007 trigger.

alter table public.case_status_history enable row level security;

drop policy if exists "history_select_own_or_admin" on public.case_status_history;
create policy "history_select_own_or_admin"
  on public.case_status_history for select
  using (public.is_admin() or public.owns_case(case_id));

-- ─── activity_log ───────────────────────────────────────────────────────────
-- Admin-visible only; written by security-definer helpers.

alter table public.activity_log enable row level security;

drop policy if exists "activity_select_admin" on public.activity_log;
create policy "activity_select_admin"
  on public.activity_log for select
  using (public.is_admin());
