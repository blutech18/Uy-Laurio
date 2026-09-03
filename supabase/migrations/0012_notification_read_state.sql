-- ═══════════════════════════════════════════════════════════════════════════
-- 0012 — Notification read state and per-item actions
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Fixes the reported bug "the notification count never clears even after the
-- client has seen them".
--
-- Cause: the SELECT policy lets a client see a notification either because they
-- are the named recipient *or* because it belongs to one of their cases:
--
--     using ( is_admin()
--             or recipient_id = auth.uid()
--             or (case_id is not null and owns_case(case_id)) )
--
-- but the UPDATE policy only covered `recipient_id = auth.uid()`. Automated
-- notifications raised by the case triggers are attached to the case and can
-- leave `recipient_id` null, so those rows were visible-but-unwritable: the
-- client could see them, the unread badge counted them, and `read_at` could
-- never be stamped. The badge therefore stuck permanently.
--
-- This migration aligns write access with read access, and adds the DELETE
-- access the per-notification menu needs. The existing
-- `enforce_notification_update` trigger still restricts recipients to changing
-- the read state only, so widening the policy does not let a client rewrite a
-- message, channel or delivery status.

-- ─── Recipients may mark anything they can see as read ──────────────────────

drop policy if exists "notifications_recipient_update" on public.notifications;
create policy "notifications_recipient_update"
  on public.notifications for update
  using (
    recipient_id = auth.uid()
    or (case_id is not null and public.owns_case(case_id))
  )
  with check (
    recipient_id = auth.uid()
    or (case_id is not null and public.owns_case(case_id))
  );

-- ─── Recipients may dismiss their own notifications ─────────────────────────
-- Deleting only removes the client's copy of an already-delivered message; the
-- outbound audit trail admins report on lives in `notification_log`.

drop policy if exists "notifications_recipient_delete" on public.notifications;
create policy "notifications_recipient_delete"
  on public.notifications for delete
  using (
    recipient_id = auth.uid()
    or (case_id is not null and public.owns_case(case_id))
  );

drop policy if exists "notifications_admin_delete" on public.notifications;
create policy "notifications_admin_delete"
  on public.notifications for delete
  using (public.is_admin());

-- ─── Mark-all-read helper ───────────────────────────────────────────────────
-- Doing this in one statement keeps the "seen" sweep atomic and means the client
-- does not have to replicate the visibility rules above in TypeScript.

create or replace function public.mark_my_notifications_read()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  touched integer;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  with updated as (
    update public.notifications n
       set read_at = now()
     where n.read_at is null
       and (
         n.recipient_id = auth.uid()
         or (n.case_id is not null and exists (
              select 1 from public.cases c
               where c.id = n.case_id
                 and c.client_id = auth.uid()
            ))
       )
    returning 1
  )
  select count(*) into touched from updated;

  return touched;
end;
$$;

revoke all on function public.mark_my_notifications_read() from public;
grant execute on function public.mark_my_notifications_read() to authenticated;

comment on function public.mark_my_notifications_read() is
  'Stamps read_at on every unread notification the caller can see (named '
  'recipient or owner of the linked case). Returns the number of rows touched.';
