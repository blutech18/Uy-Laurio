-- ============================================================================
-- 0018 - Allow the 'appointment_admin' notification kind
-- ----------------------------------------------------------------------------
-- Migration 0016 started queuing 'appointment_admin' notifications for admins
-- when a client books or cancels, but notifications_kind_check did not list the
-- new kind. The insert raised inside the appointment trigger, so the booking
-- itself was rejected. Found by supabase/tests/revision_round_3.sql.
-- ============================================================================

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check check (kind in (
    'manual', 'case_created', 'status_update', 'phase_update',
    'requirement_request', 'document_verified', 'document_rejected',
    'case_completed', 'case_cancelled', 'appointment_reminder',
    'appointment_booked', 'appointment_admin', 'announcement'
  ));
