-- ============================================================================
-- V3_4__nurse_job_no.sql - Job No. on the nurse personal-info group
-- Purpose: Add nursing.nurses.job_no, a manually-entered job number that is
--          distinct from employee_number (which the personal-info form
--          auto-generates as EMP-YYYY-NNNNN and does not let the user type).
--          Required and unique: no two nurses may share a Job No.
--
-- Note on ordering: the column is added NULLABLE, backfilled, and only then
-- made NOT NULL. A single `ADD COLUMN ... NOT NULL` with no default would fail
-- outright on any database that already has nurse rows.
-- ============================================================================

ALTER TABLE nursing.nurses ADD COLUMN IF NOT EXISTS job_no VARCHAR(50);

-- ----------------------------------------------------------------------------
-- Backfill the V3_1 demo nurses (idempotent: keyed on employee_number, and
-- only fills rows that are still empty)
-- ----------------------------------------------------------------------------
UPDATE nursing.nurses SET job_no = 'JOB-1001' WHERE employee_number = 'EMP-1001' AND job_no IS NULL;
UPDATE nursing.nurses SET job_no = 'JOB-1002' WHERE employee_number = 'EMP-1002' AND job_no IS NULL;
UPDATE nursing.nurses SET job_no = 'JOB-1003' WHERE employee_number = 'EMP-1003' AND job_no IS NULL;
UPDATE nursing.nurses SET job_no = 'JOB-1004' WHERE employee_number = 'EMP-1004' AND job_no IS NULL;

-- ----------------------------------------------------------------------------
-- Any other pre-existing row (real records created before this migration)
-- still has no Job No. Derive one from the primary key so it is stable across
-- re-runs and cannot collide, rather than aborting the migration.
-- ----------------------------------------------------------------------------
UPDATE nursing.nurses
   SET job_no = 'JOB-' || substr(md5(id::text), 1, 8)
 WHERE job_no IS NULL;

ALTER TABLE nursing.nurses ALTER COLUMN job_no SET NOT NULL;

-- `ADD COLUMN IF NOT EXISTS` does not create the constraint, so guard it.
DO $$ BEGIN
  ALTER TABLE nursing.nurses ADD CONSTRAINT uq_nurses_job_no UNIQUE (job_no);
EXCEPTION WHEN duplicate_table THEN null;
END $$;

COMMENT ON COLUMN nursing.nurses.job_no IS
  'Manually-entered job number (HR/establishment no.). Unique per nurse; distinct from the auto-generated employee_number.';
