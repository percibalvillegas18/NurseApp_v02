-- ============================================================================
-- V3_1__seed_nursing_demo.sql - Demo nursing data
-- Purpose: Seed demo nurses (linked to V2_3 users), credentials, and a few
--          roster assignments so NurseMaster/Roster pages show real data.
-- Notes:
--  - Idempotent: nurses/credentials/roster use ON CONFLICT DO NOTHING.
--  - Roster rows are dated CURRENT_DATE + N; re-running tomorrow inserts new
--    rows (by design for demo freshness).
--  - All lookups resolved by code/username via JOINs (no hard-coded IDs);
--    rows whose lookup target is missing are skipped by the inner JOINs.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Demo nurses: link to existing login users, roles & units resolved by code
-- ----------------------------------------------------------------------------
INSERT INTO nursing.nurses (
  employee_number, user_id, first_name, last_name, email, hire_date,
  employment_type, primary_role_id, home_unit_id, status, created_by, updated_by
)
SELECT
  s.employee_number,
  u.id AS user_id,
  s.first_name,
  s.last_name,
  s.email,
  s.hire_date,
  s.employment_type,
  r.id AS primary_role_id,
  nu.id AS home_unit_id,
  'Active',
  1,
  1
FROM (
  SELECT
    'EMP-1001' AS employee_number, 'maria.garcia' AS username,
    'Maria' AS first_name, 'Garcia' AS last_name,
    'maria.garcia@hospital.local' AS email, DATE '2019-03-01' AS hire_date,
    'FullTime'::nursing.employment_type AS employment_type,
    'RN' AS role_code, 'ICU_A' AS unit_code
  UNION ALL
  SELECT 'EMP-1002', 'ahmed.hassan', 'Ahmed', 'Hassan',
    'ahmed.hassan@hospital.local', DATE '2020-06-15',
    'FullTime'::nursing.employment_type, 'RN', 'ICU_A'
  UNION ALL
  SELECT 'EMP-1003', 'jennifer.smith', 'Jennifer', 'Smith',
    'jennifer.smith@hospital.local', DATE '2021-09-01',
    'PartTime'::nursing.employment_type, 'LPN', 'ICU_A'
  UNION ALL
  SELECT 'EMP-1004', 'david.kim', 'David', 'Kim',
    'david.kim@hospital.local', DATE '2022-01-10',
    'FullTime'::nursing.employment_type, 'CNA', 'ICU_B'
) s
JOIN auth.users            u  ON u.username = s.username
JOIN system.hospital_roles r  ON r.code     = s.role_code
JOIN rbac.nursing_units    nu ON nu.code    = s.unit_code
ON CONFLICT (employee_number) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Demo credentials (SCFHS = Saudi Commission for Health Specialties)
-- Jennifer's BLS expires in ~20 days (shows up on the compliance radar)
-- ----------------------------------------------------------------------------
INSERT INTO nursing.credentials (
  nurse_id, credential_type, name, issuing_authority, credential_number,
  issued_date, expiry_date, status, verified_by, verified_at, created_by, updated_by
)
SELECT
  n.id AS nurse_id,
  s.credential_type,
  s.name,
  s.issuing_authority,
  s.credential_number,
  s.issued_date,
  s.expiry_date,
  s.status,
  v.id AS verified_by,
  CASE WHEN v.id IS NULL THEN NULL ELSE CURRENT_TIMESTAMP END AS verified_at,
  1,
  1
FROM (
  SELECT
    'EMP-1001' AS nurse_emp,
    'License'::nursing.credential_type AS credential_type,
    'RN_LICENSE' AS name, 'SCFHS' AS issuing_authority, 'RN-88231' AS credential_number,
    DATE '2023-01-15' AS issued_date, CURRENT_DATE + INTERVAL '400 days' AS expiry_date,
    'Valid'::nursing.credential_status AS status, 'patricia.johnson' AS verifier_username
  UNION ALL
  SELECT 'EMP-1002', 'License'::nursing.credential_type, 'RN_LICENSE', 'SCFHS', 'RN-90417',
    DATE '2022-06-01', CURRENT_DATE + INTERVAL '300 days',
    'Valid'::nursing.credential_status, 'patricia.johnson'
  UNION ALL
  SELECT 'EMP-1003', 'Certification'::nursing.credential_type, 'BLS',
    'American Heart Association', 'BLS-44520',
    CURRENT_DATE - INTERVAL '340 days', CURRENT_DATE + INTERVAL '20 days',
    'Valid'::nursing.credential_status, 'patricia.johnson'
  UNION ALL
  SELECT 'EMP-1003', 'License'::nursing.credential_type, 'LPN_LICENSE', 'SCFHS', 'LPN-55201',
    DATE '2021-09-15', CURRENT_DATE + INTERVAL '500 days',
    'Valid'::nursing.credential_status, 'patricia.johnson'
  UNION ALL
  SELECT 'EMP-1004', 'Certification'::nursing.credential_type, 'CNA_CERT', 'TVTC', 'CNA-77812',
    DATE '2022-01-05', CURRENT_DATE + INTERVAL '200 days',
    'Valid'::nursing.credential_status, NULL
  UNION ALL
  SELECT 'EMP-1001', 'Certification'::nursing.credential_type, 'ACLS',
    'American Heart Association', 'ACLS-99871',
    CURRENT_DATE - INTERVAL '180 days', CURRENT_DATE + INTERVAL '185 days',
    'PendingVerification'::nursing.credential_status, NULL
) s
JOIN nursing.nurses n ON n.employee_number = s.nurse_emp
LEFT JOIN auth.users v ON v.username = s.verifier_username
ON CONFLICT (nurse_id, credential_type, name) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Demo roster assignments for the coming week (relative dates keep demo fresh)
-- ----------------------------------------------------------------------------
INSERT INTO nursing.roster_assignments (
  nurse_id, nursing_unit_id, shift_id, post_id, assignment_date, status, notes, created_by, updated_by
)
SELECT
  n.id AS nurse_id,
  nu.id AS nursing_unit_id,
  sh.id AS shift_id,
  p.id AS post_id,
  s.assignment_date,
  s.status,
  s.notes,
  1,
  1
FROM (
  SELECT
    'EMP-1001' AS nurse_emp, 'ICU_A' AS unit_code, 'MORNING' AS shift_code,
    'ICU_A_BED_01_10' AS post_code, CURRENT_DATE + 1 AS assignment_date,
    'Confirmed'::nursing.roster_status AS status, 'Charge relief coverage' AS notes
  UNION ALL
  SELECT 'EMP-1001', 'ICU_A', 'NIGHT', 'ICU_A_BED_01_10', CURRENT_DATE + 3,
    'Scheduled'::nursing.roster_status, NULL
  UNION ALL
  SELECT 'EMP-1002', 'ICU_A', 'EVENING', NULL, CURRENT_DATE + 1,
    'Confirmed'::nursing.roster_status, NULL
  UNION ALL
  SELECT 'EMP-1002', 'ICU_A', 'MORNING', NULL, CURRENT_DATE + 4,
    'Scheduled'::nursing.roster_status, NULL
  UNION ALL
  SELECT 'EMP-1003', 'ICU_A', 'NIGHT', NULL, CURRENT_DATE + 2,
    'Scheduled'::nursing.roster_status, 'Part-time: nights only'
  UNION ALL
  SELECT 'EMP-1003', 'ICU_A', 'NIGHT', NULL, CURRENT_DATE + 5,
    'Scheduled'::nursing.roster_status, 'Part-time: nights only'
  UNION ALL
  SELECT 'EMP-1004', 'ICU_B', 'MORNING', NULL, CURRENT_DATE + 1,
    'Confirmed'::nursing.roster_status, NULL
  UNION ALL
  SELECT 'EMP-1004', 'ICU_B', 'EVENING', NULL, CURRENT_DATE + 2,
    'Scheduled'::nursing.roster_status, NULL
) s
JOIN nursing.nurses     n  ON n.employee_number = s.nurse_emp
JOIN rbac.nursing_units nu ON nu.code           = s.unit_code
JOIN rbac.shifts        sh ON sh.code           = s.shift_code
LEFT JOIN rbac.posts    p  ON p.code            = s.post_code
ON CONFLICT (nurse_id, assignment_date, shift_id) DO NOTHING;
