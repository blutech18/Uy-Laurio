-- ═══════════════════════════════════════════════════════════════════════════
-- 0013 — Slot occupancy for the client booking calendar
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The client asked for fully-booked dates to be shown as having no slots left.
-- That was impossible for the portal to know: `appointments_select_own_or_admin`
-- restricts a client to their own rows, so a client's calendar saw an empty day
-- no matter how many other people had booked it. Every slot looked free, and the
-- only feedback was a unique-violation error from `uq_appointments_live_slot`
-- when they tried to take one that was gone.
--
-- Exposing the appointments table more widely would leak who is consulting the
-- office, which is exactly the kind of thing a law office must not disclose. So
-- this function returns *only* the date and slot label of live bookings — enough
-- to grey out a slot, and nothing that identifies a client.

create or replace function public.booked_slots(p_from date, p_to date)
returns table (
  appointment_date date,
  time_slot        text
)
language sql
stable
security definer
set search_path = public
as $$
  select a.appointment_date, a.time_slot
    from public.appointments a
   where a.status <> 'cancelled'
     and a.appointment_date >= p_from
     and a.appointment_date <= p_to;
$$;

revoke all on function public.booked_slots(date, date) from public;
grant execute on function public.booked_slots(date, date) to authenticated;

comment on function public.booked_slots(date, date) is
  'Live bookings in a date range as (date, slot) pairs only. Deliberately '
  'returns no client identity so the booking calendar can show occupancy '
  'without disclosing who holds an appointment.';
