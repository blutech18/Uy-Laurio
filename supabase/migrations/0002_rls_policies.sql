-- ============================================================================
-- Uy-Laurio Legal Portal — Row Level Security
-- ----------------------------------------------------------------------------
-- Security is enforced at the database layer. The frontend uses the public
-- anon key (safe to expose); every table below denies access by default and
-- only grants the minimum each role needs.
--   * Clients  -> may read/write only rows tied to their own account.
--   * Admins   -> may read all rows and manage operational data.
-- ============================================================================

alter table public.profiles          enable row level security;
alter table public.cases             enable row level security;
alter table public.documents         enable row level security;
alter table public.case_requirements enable row level security;
alter table public.notifications     enable row level security;
alter table public.appointments      enable row level security;
alter table public.schedule_overrides enable row level security;

-- ─── profiles ───────────────────────────────────────────────────────────────

drop policy if exists "profiles_select_self_or_admin" on public.profiles;
create policy "profiles_select_self_or_admin"
  on public.profiles for select
  using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid() and role = 'user');

drop policy if exists "profiles_admin_update_all" on public.profiles;
create policy "profiles_admin_update_all"
  on public.profiles for update
  using (public.is_admin());

-- ─── cases ────────────────────────────────────────────────────────────────--

drop policy if exists "cases_select_own_or_admin" on public.cases;
create policy "cases_select_own_or_admin"
  on public.cases for select
  using (client_id = auth.uid() or public.is_admin());

drop policy if exists "cases_insert_own" on public.cases;
create policy "cases_insert_own"
  on public.cases for insert
  with check (client_id = auth.uid());

drop policy if exists "cases_admin_write" on public.cases;
create policy "cases_admin_write"
  on public.cases for update
  using (public.is_admin());

drop policy if exists "cases_admin_delete" on public.cases;
create policy "cases_admin_delete"
  on public.cases for delete
  using (public.is_admin());

-- ─── documents ──────────────────────────────────────────────────────────────

drop policy if exists "documents_select_own_or_admin" on public.documents;
create policy "documents_select_own_or_admin"
  on public.documents for select
  using (owner_id = auth.uid() or public.is_admin());

drop policy if exists "documents_insert_own" on public.documents;
create policy "documents_insert_own"
  on public.documents for insert
  with check (
    owner_id = auth.uid()
    and exists (
      select 1 from public.cases c
      where c.id = case_id and c.client_id = auth.uid()
    )
  );

-- Only admins change a document's review status.
drop policy if exists "documents_admin_update" on public.documents;
create policy "documents_admin_update"
  on public.documents for update
  using (public.is_admin());

drop policy if exists "documents_delete_own_or_admin" on public.documents;
create policy "documents_delete_own_or_admin"
  on public.documents for delete
  using (owner_id = auth.uid() or public.is_admin());

-- ─── case_requirements ────────────────────────────────────────────────────--

drop policy if exists "requirements_select_own_or_admin" on public.case_requirements;
create policy "requirements_select_own_or_admin"
  on public.case_requirements for select
  using (
    public.is_admin()
    or exists (
      select 1 from public.cases c
      where c.id = case_id and c.client_id = auth.uid()
    )
  );

-- Clients may tick off their own checklist items; admins manage everything.
drop policy if exists "requirements_update_own_or_admin" on public.case_requirements;
create policy "requirements_update_own_or_admin"
  on public.case_requirements for update
  using (
    public.is_admin()
    or exists (
      select 1 from public.cases c
      where c.id = case_id and c.client_id = auth.uid()
    )
  );

drop policy if exists "requirements_admin_insert" on public.case_requirements;
create policy "requirements_admin_insert"
  on public.case_requirements for insert
  with check (public.is_admin());

drop policy if exists "requirements_admin_delete" on public.case_requirements;
create policy "requirements_admin_delete"
  on public.case_requirements for delete
  using (public.is_admin());

-- ─── notifications ──────────────────────────────────────────────────────────

drop policy if exists "notifications_select_own_or_admin" on public.notifications;
create policy "notifications_select_own_or_admin"
  on public.notifications for select
  using (
    public.is_admin()
    or exists (
      select 1 from public.cases c
      where c.id = case_id and c.client_id = auth.uid()
    )
  );

drop policy if exists "notifications_admin_insert" on public.notifications;
create policy "notifications_admin_insert"
  on public.notifications for insert
  with check (public.is_admin());

drop policy if exists "notifications_admin_update" on public.notifications;
create policy "notifications_admin_update"
  on public.notifications for update
  using (public.is_admin());

-- ─── appointments ───────────────────────────────────────────────────────────

drop policy if exists "appointments_select_own_or_admin" on public.appointments;
create policy "appointments_select_own_or_admin"
  on public.appointments for select
  using (client_id = auth.uid() or public.is_admin());

drop policy if exists "appointments_insert_own" on public.appointments;
create policy "appointments_insert_own"
  on public.appointments for insert
  with check (client_id = auth.uid());

drop policy if exists "appointments_update_own_or_admin" on public.appointments;
create policy "appointments_update_own_or_admin"
  on public.appointments for update
  using (client_id = auth.uid() or public.is_admin());

drop policy if exists "appointments_delete_own_or_admin" on public.appointments;
create policy "appointments_delete_own_or_admin"
  on public.appointments for delete
  using (client_id = auth.uid() or public.is_admin());

-- ─── schedule_overrides ─────────────────────────────────────────────────────

-- Any authenticated user can read office hours; only admins can change them.
drop policy if exists "overrides_select_all_authenticated" on public.schedule_overrides;
create policy "overrides_select_all_authenticated"
  on public.schedule_overrides for select
  using (auth.role() = 'authenticated');

drop policy if exists "overrides_admin_insert" on public.schedule_overrides;
create policy "overrides_admin_insert"
  on public.schedule_overrides for insert
  with check (public.is_admin());

drop policy if exists "overrides_admin_update" on public.schedule_overrides;
create policy "overrides_admin_update"
  on public.schedule_overrides for update
  using (public.is_admin());

drop policy if exists "overrides_admin_delete" on public.schedule_overrides;
create policy "overrides_admin_delete"
  on public.schedule_overrides for delete
  using (public.is_admin());
