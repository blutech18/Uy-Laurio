-- Shows only the failing checks from the RLS matrix (run rls_matrix.sql first,
-- which installs the helper function).
select check_name, expectation, observed
from public.__rls_matrix()
where status <> 'PASS';
