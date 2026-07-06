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

create policy "profiles_select_self_or_admin"
  on public.profiles for select
  using (id = auth.uid() or public.is_admin());

create policy "profiles_update_self"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid() and role = 'user');

create policy "profiles_admin_update_all"
  on public.profiles for update
  using (public.is_admin());

-- ─── cases ────────────────────────────────────────────────────────────────--

create policy "cases_select_own_or_admin"
  on public.cases for select
  using (client_id = auth.uid() or public.is_admin());

create policy "cases_insert_own"
  on public.cases for insert
  with check (client_id = auth.uid());

create policy "cases_admin_write"
  on public.cases for update
  using (public.is_admin());

create policy "cases_admin_delete"
  on public.cases for delete
  using (public.is_admin());

-- ─── documents ──────────────────────────────────────────────────────────────

create policy "documents_select_own_or_admin"
  on public.documents for select
  using (owner_id = auth.uid() or public.is_admin());

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
create policy "documents_admin_update"
  on public.documents for update
  using (public.is_admin());

create policy "documents_delete_own_or_admin"
  on public.documents for delete
  using (owner_id = auth.uid() or public.is_admin());

-- ─── case_requirements ────────────────────────────────────────────────────--

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
create policy "requirements_update_own_or_admin"
  on public.case_requirements for update
  using (
    public.is_admin()
    or exists (
      select 1 from public.cases c
      where c.id = case_id and c.client_id = auth.uid()
    )
  );

create policy "requirements_admin_insert"
  on public.case_requirements for insert
  with check (public.is_admin());

create policy "requirements_admin_delete"
  on public.case_requirements for delete
  using (public.is_admin());

-- ─── notifications ──────────────────────────────────────────────────────────

create policy "notifications_select_own_or_admin"
  on public.notifications for select
  using (
    public.is_admin()
    or exists (
      select 1 from public.cases c
      where c.id = case_id and c.client_id = auth.uid()
    )
  );

create policy "notifications_admin_insert"
  on public.notifications for insert
  with check (public.is_admin());

create policy "notifications_admin_update"
  on public.notifications for update
  using (public.is_admin());

-- ─── appointments ───────────────────────────────────────────────────────────

create policy "appointments_select_own_or_admin"
  on public.appointments for select
  using (client_id = auth.uid() or public.is_admin());

create policy "appointments_insert_own"
  on public.appointments for insert
  with check (client_id = auth.uid());

create policy "appointments_update_own_or_admin"
  on public.appointments for update
  using (client_id = auth.uid() or public.is_admin());

create policy "appointments_delete_own_or_admin"
  on public.appointments for delete
  using (client_id = auth.uid() or public.is_admin());

-- ─── schedule_overrides ─────────────────────────────────────────────────────

-- Any authenticated user can read office hours; only admins can change them.
create policy "overrides_select_all_authenticated"
  on public.schedule_overrides for select
  using (auth.role() = 'authenticated');

create policy "overrides_admin_insert"
  on public.schedule_overrides for insert
  with check (public.is_admin());

create policy "overrides_admin_update"
  on public.schedule_overrides for update
  using (public.is_admin());

create policy "overrides_admin_delete"
  on public.schedule_overrides for delete
  using (public.is_admin());
