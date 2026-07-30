-- Removes the temporary test helpers installed by rls_matrix.sql and
-- client_flow.sql. Safe to run any time; the test files recreate them.

drop function if exists public.__rls_matrix();
drop function if exists public.__client_flow_test();

select count(*) as leftover_test_functions
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like '\_\_%';
