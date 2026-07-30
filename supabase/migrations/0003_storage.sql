-- ============================================================================
-- Uy-Laurio Legal Portal — Storage
-- ----------------------------------------------------------------------------
-- Private bucket for uploaded legal documents. Objects are namespaced by the
-- owner's user id (first path segment), so clients can only touch their own
-- files while admins can read everything for review.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

-- Clients read their own files; admins read all.
drop policy if exists "documents_read_own_or_admin" on storage.objects;
create policy "documents_read_own_or_admin"
  on storage.objects for select
  using (
    bucket_id = 'documents'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_admin()
    )
  );

-- Clients may upload only into their own folder.
drop policy if exists "documents_insert_own" on storage.objects;
create policy "documents_insert_own"
  on storage.objects for insert
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "documents_update_own" on storage.objects;
create policy "documents_update_own"
  on storage.objects for update
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "documents_delete_own_or_admin" on storage.objects;
create policy "documents_delete_own_or_admin"
  on storage.objects for delete
  using (
    bucket_id = 'documents'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_admin()
    )
  );
