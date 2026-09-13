-- ============================================================================
-- V3_2__nurse_personal_fields.sql - Nurse personal-info fields
-- Purpose: NurseMaster entry form switched to personal data:
--          middle_name, gender (Male/Female), date_of_birth, nationality.
--          Employment Type / Hire Date / Home Unit leave this form (they stay
--          in the table - they move to a separate "employment" group later),
--          so hire_date becomes nullable to allow personal-info-only creation.
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE nursing.gender AS ENUM ('Male', 'Female');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

ALTER TABLE nursing.nurses ADD COLUMN IF NOT EXISTS middle_name    VARCHAR(100);
ALTER TABLE nursing.nurses ADD COLUMN IF NOT EXISTS gender         nursing.gender;
ALTER TABLE nursing.nurses ADD COLUMN IF NOT EXISTS date_of_birth  DATE;
ALTER TABLE nursing.nurses ADD COLUMN IF NOT EXISTS nationality    VARCHAR(100);

-- personal-info-only creation must not require hire_date
ALTER TABLE nursing.nurses ALTER COLUMN hire_date DROP NOT NULL;

COMMENT ON COLUMN nursing.nurses.middle_name   IS 'Optional middle name; full_name reported as First + Middle + Last.';
COMMENT ON COLUMN nursing.nurses.gender        IS 'Male | Female';
COMMENT ON COLUMN nursing.nurses.date_of_birth IS 'Date of birth.';
COMMENT ON COLUMN nursing.nurses.nationality   IS 'Country of nationality (display name).';

-- ----------------------------------------------------------------------------
-- Backfill personal data for the V3_1 demo nurses (idempotent: keyed on
-- employee_number; only fills rows that exist)
-- ----------------------------------------------------------------------------
UPDATE nursing.nurses SET middle_name = 'Josefa', gender = 'Female', date_of_birth = DATE '1990-04-12', nationality = 'Filipino'     WHERE employee_number = 'EMP-1001';
UPDATE nursing.nurses SET middle_name = NULL,     gender = 'Male',   date_of_birth = DATE '1988-11-03', nationality = 'Saudi'        WHERE employee_number = 'EMP-1002';
UPDATE nursing.nurses SET middle_name = 'Anne',   gender = 'Female', date_of_birth = DATE '1993-07-22', nationality = 'American'     WHERE employee_number = 'EMP-1003';
UPDATE nursing.nurses SET middle_name = NULL,     gender = 'Male',   date_of_birth = DATE '1991-02-14', nationality = 'South Korean' WHERE employee_number = 'EMP-1004';
