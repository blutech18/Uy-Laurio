-- ============================================================================
-- 0017 - Office hours become the single source of truth for the calendar
-- ----------------------------------------------------------------------------
-- The booking calendar used to hard-code "Sunday closed, Saturday half-day"
-- while the office_hours table held different values (Mon-Sat 08:00-17:00), so
-- the table the admin could edit was ignored. The calendar and the booking
-- validator now both read office_hours; this sets it to the office's real
-- hours. Admins change them from Schedule > Weekly Office Hours.
-- ============================================================================

update public.office_hours set is_open = true,  open_time = '09:00', close_time = '17:00'
 where day_of_week between 1 and 5;
update public.office_hours set is_open = true,  open_time = '09:00', close_time = '12:00'
 where day_of_week = 6;
update public.office_hours set is_open = false, open_time = '00:00', close_time = '00:00'
 where day_of_week = 0;
