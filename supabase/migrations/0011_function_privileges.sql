-- ============================================================================
-- Uy-Laurio Legal Portal — Lock down server-only functions
-- ----------------------------------------------------------------------------
-- Found by supabase/tests/rls_matrix.sql: every helper below was callable by
-- `anon` and `authenticated`.
--
-- `revoke ... from public` (used in 0007 and 0010) is NOT sufficient on
-- Supabase, because the platform sets default privileges that grant EXECUTE on
-- new functions to anon, authenticated and service_role. The grant has to be
-- revoked from those roles by name.
--
-- Why it matters: these are SECURITY DEFINER and therefore bypass RLS.
--   * enqueue_notification  -> anyone could send Email/SMS to any client in the
--                              office's name, and burn SMS credits doing it
--   * log_activity          -> anyone could forge audit-trail entries
--   * queue_*_reminders     -> anyone could mass-queue messages
--   * claim_notification    -> anyone could stall or sabotage delivery
--
-- Left callable by authenticated on purpose: is_admin(), is_active_user(),
-- owns_case() and is_privileged_context() are evaluated inside RLS policies
-- with the caller's privileges, so revoking them would break every policy.
-- The report/listing RPCs also stay callable: each one guards itself with an
-- is_admin() check and returns nothing to a client.
-- ============================================================================

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.claim_notification(uuid)',
    'public.enqueue_notification(uuid, uuid, text, text)',
    'public.log_activity(text, text, uuid, jsonb)',
    'public.queue_requirement_reminders()',
    'public.queue_appointment_reminders()'
  ]
  loop
    execute format('revoke all on function %s from public', fn);
    execute format('revoke all on function %s from anon', fn);
    execute format('revoke all on function %s from authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;

-- Guard against the same mistake for functions added later: stop the platform
-- default from handing EXECUTE to the browser-facing roles automatically.
-- New RPCs the app needs must now be granted explicitly, which is the safer
-- default for a system holding legal documents.
alter default privileges in schema public revoke execute on functions from anon;
alter default privileges in schema public revoke execute on functions from authenticated;
