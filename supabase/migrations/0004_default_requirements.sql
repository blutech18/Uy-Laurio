-- ============================================================================
-- Uy-Laurio Legal Portal — Default case requirements
-- ----------------------------------------------------------------------------
-- When a case is created, seed its document checklist based on the selected
-- service module. These are the real document requirements for each service
-- (previously hard-coded in the UI), now generated server-side so every case
-- starts with an accurate, dynamic checklist.
--
-- SECURITY DEFINER lets the trigger insert requirement rows regardless of the
-- caller's RLS scope (clients create the case; the office defines the list).
-- ============================================================================

create or replace function public.seed_case_requirements()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Common to every service.
  insert into public.case_requirements (case_id, name, note, urgent, sort_order) values
    (new.id, 'Government-Issued Photo ID', 'Both sides, clear scan', true, 1),
    (new.id, 'Proof of Address', 'Utility bill or bank statement, within 3 months', true, 2);

  if new.module = 'notarization' then
    insert into public.case_requirements (case_id, name, note, urgent, sort_order) values
      (new.id, 'Document to be Notarized', 'Original, fully signed in black or blue ink', true, 3),
      (new.id, 'Tax Identification Number', 'BIR TIN of the signatory', false, 4);

  elsif new.module = 'deed' then
    insert into public.case_requirements (case_id, name, note, urgent, sort_order) values
      (new.id, 'Signed Deed of Sale', 'Original, fully signed document', true, 3),
      (new.id, 'Certificate of Title (TCT/OCT)', 'Owner''s duplicate copy', true, 4),
      (new.id, 'Latest Tax Declaration', 'From the local assessor''s office', false, 5),
      (new.id, 'Real Property Tax Clearance', 'Current year, from the treasurer', false, 6);

  elsif new.module = 'ejs' then
    insert into public.case_requirements (case_id, name, note, urgent, sort_order) values
      (new.id, 'Death Certificate of the deceased', 'PSA-authenticated original', true, 3),
      (new.id, 'Birth Certificates of all heirs', 'PSA copies for each heir', true, 4),
      (new.id, 'Marriage Certificate (if applicable)', 'PSA-authenticated', false, 5),
      (new.id, 'Title of the property (TCT/OCT)', 'Original owner''s copy', true, 6),
      (new.id, 'Latest Tax Declaration', 'From the local assessor''s office', false, 7),
      (new.id, 'Real Property Tax Clearance', 'Current year, from the treasurer', false, 8),
      (new.id, 'Tax Identification Numbers of all heirs', 'BIR TIN for each heir', false, 9);
  end if;

  return new;
end;
$$;

drop trigger if exists on_case_created on public.cases;
create trigger on_case_created
  after insert on public.cases
  for each row execute function public.seed_case_requirements();
