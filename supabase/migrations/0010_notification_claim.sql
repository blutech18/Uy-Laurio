-- ============================================================================
-- Uy-Laurio Legal Portal — Atomic notification claim
-- ----------------------------------------------------------------------------
-- The delivery function must never send the same message twice: a duplicate
-- email is noise, a duplicate SMS costs money.
--
-- Claiming over PostgREST (`update ... .in('delivery_status', [...]).select()`)
-- is unreliable, because the filter is re-evaluated against the *updated* row,
-- so the representation comes back empty even when the update applied. The
-- function then cannot tell "someone else claimed it" from "I claimed it".
--
-- Postgres RETURNING has no such ambiguity, so the claim happens here instead.
-- ============================================================================

create or replace function public.claim_notification(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed uuid;
begin
  update public.notifications
  set delivery_status = 'sending',
      attempts = attempts + 1
  where id = p_id
    and delivery_status in ('queued', 'failed')
    and attempts < 3
  returning id into v_claimed;

  return v_claimed is not null;
end;
$$;

-- Delivery is a server-side job only: the browser must never claim a row.
revoke execute on function public.claim_notification(uuid) from public;
grant execute on function public.claim_notification(uuid) to service_role;

comment on function public.claim_notification(uuid) is
  'Atomically marks one queued/failed notification as sending. Returns false when another worker already took it.';
