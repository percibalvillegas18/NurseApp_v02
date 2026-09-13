-- ============================================================================
-- V3_0__nursing_domain.sql - Nursing Domain (Phase 1: master data)
-- Database: hospital_rbac_dev
-- Purpose: First nursing-domain tables the RBAC engine will protect:
--          nursing.nurses            - staff master records (links to auth.users)
--          nursing.credentials       - licenses & certifications with expiry
--          nursing.roster_assignments- planned shift assignments
-- Safe to re-run: uses IF NOT EXISTS everywhere.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Schema
-- ----------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS nursing;

-- ----------------------------------------------------------------------------
-- Enums (following V1_0 convention: CREATE TYPE guarded by DO blocks)
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE nursing.employment_type AS ENUM ('FullTime', 'PartTime', 'PRN', 'Contract');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE nursing.nurse_status AS ENUM ('Active', 'OnLeave', 'Suspended', 'Terminated');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE nursing.credential_type AS ENUM ('License', 'Certification');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE nursing.credential_status AS ENUM (
    'PendingVerification', 'Valid', 'ExpiringSoon', 'Expired', 'Suspended', 'Revoked'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE nursing.roster_status AS ENUM (
    'Scheduled', 'Confirmed', 'Completed', 'Cancelled', 'Swapped', 'NoShow'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ----------------------------------------------------------------------------
-- nursing.nurses - staff master record
-- One nurse MAY have one login account (auth.users), but a nurse record can
-- exist without a login (e.g. agency staff tracked for rostering only).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nursing.nurses (
  id                BIGSERIAL PRIMARY KEY,
  employee_number   VARCHAR(50)  NOT NULL UNIQUE,
  user_id           BIGINT       UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  first_name        VARCHAR(100) NOT NULL,
  last_name         VARCHAR(100) NOT NULL,
  email             VARCHAR(255),
  phone             VARCHAR(50),
  hire_date         DATE         NOT NULL,
  employment_type   nursing.employment_type NOT NULL DEFAULT 'FullTime',
  primary_role_id   BIGINT       REFERENCES system.hospital_roles(id) ON DELETE RESTRICT,
  home_unit_id      BIGINT       REFERENCES rbac.nursing_units(id)   ON DELETE SET NULL,
  status            nursing.nurse_status NOT NULL DEFAULT 'Active',
  created_by        BIGINT,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by        BIGINT,
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_nurses_user_id         ON nursing.nurses(user_id);
CREATE INDEX IF NOT EXISTS idx_nurses_primary_role_id ON nursing.nurses(primary_role_id);
CREATE INDEX IF NOT EXISTS idx_nurses_home_unit_id    ON nursing.nurses(home_unit_id);
CREATE INDEX IF NOT EXISTS idx_nurses_status          ON nursing.nurses(status);
CREATE INDEX IF NOT EXISTS idx_nurses_name            ON nursing.nurses(last_name, first_name);

COMMENT ON TABLE  nursing.nurses IS 'Nursing staff master records; user_id optionally links to a login account.';
COMMENT ON COLUMN nursing.nurses.employee_number IS 'HR-issued unique employee identifier.';

-- ----------------------------------------------------------------------------
-- nursing.credentials - licenses & certifications (RN license, BLS, ACLS, ...)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nursing.credentials (
  id                 BIGSERIAL PRIMARY KEY,
  nurse_id           BIGINT NOT NULL REFERENCES nursing.nurses(id) ON DELETE CASCADE,
  credential_type    nursing.credential_type NOT NULL,
  name               VARCHAR(100) NOT NULL,           -- e.g. RN_LICENSE, BLS, ACLS, PALS
  issuing_authority  VARCHAR(255),
  credential_number  VARCHAR(100),
  issued_date        DATE,
  expiry_date        DATE,
  status             nursing.credential_status NOT NULL DEFAULT 'PendingVerification',
  verified_by        BIGINT REFERENCES auth.users(id) ON DELETE SET NULL,
  verified_at        TIMESTAMPTZ,
  created_by         BIGINT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by         BIGINT,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at         TIMESTAMPTZ,
  CONSTRAINT uq_credentials_nurse_type_name UNIQUE (nurse_id, credential_type, name)
);

CREATE INDEX IF NOT EXISTS idx_credentials_nurse_id   ON nursing.credentials(nurse_id);
CREATE INDEX IF NOT EXISTS idx_credentials_status     ON nursing.credentials(status);
CREATE INDEX IF NOT EXISTS idx_credentials_expiry     ON nursing.credentials(expiry_date);

COMMENT ON TABLE nursing.credentials IS 'Nurse licenses/certifications with verification workflow and expiry tracking.';

-- ----------------------------------------------------------------------------
-- nursing.roster_assignments - planned shift assignments
-- UNIQUE (nurse_id, assignment_date, shift_id) prevents double-booking.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nursing.roster_assignments (
  id               BIGSERIAL PRIMARY KEY,
  nurse_id         BIGINT NOT NULL REFERENCES nursing.nurses(id)        ON DELETE CASCADE,
  nursing_unit_id  BIGINT NOT NULL REFERENCES rbac.nursing_units(id)    ON DELETE RESTRICT,
  shift_id         BIGINT NOT NULL REFERENCES rbac.shifts(id)           ON DELETE RESTRICT,
  post_id          BIGINT          REFERENCES rbac.posts(id)            ON DELETE SET NULL,
  assignment_date  DATE   NOT NULL,
  status           nursing.roster_status NOT NULL DEFAULT 'Scheduled',
  notes            TEXT,
  created_by       BIGINT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by       BIGINT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at       TIMESTAMPTZ,
  CONSTRAINT uq_roster_nurse_date_shift UNIQUE (nurse_id, assignment_date, shift_id)
);

CREATE INDEX IF NOT EXISTS idx_roster_nurse_id        ON nursing.roster_assignments(nurse_id);
CREATE INDEX IF NOT EXISTS idx_roster_assignment_date ON nursing.roster_assignments(assignment_date);
CREATE INDEX IF NOT EXISTS idx_roster_unit_date       ON nursing.roster_assignments(nursing_unit_id, assignment_date);
CREATE INDEX IF NOT EXISTS idx_roster_status          ON nursing.roster_assignments(status);

COMMENT ON TABLE nursing.roster_assignments IS 'Planned nurse shift assignments per unit/shift/date; protected by RBAC data scopes.';

-- ----------------------------------------------------------------------------
-- Useful view: credentials expiring within 30 days (for compliance dashboard)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW nursing.credentials_expiring_soon AS
SELECT
  c.id            AS credential_id,
  c.nurse_id,
  n.employee_number,
  n.first_name || ' ' || n.last_name AS nurse_name,
  c.name          AS credential_name,
  c.credential_type,
  c.expiry_date,
  c.expiry_date - CURRENT_DATE AS days_until_expiry,
  c.status
FROM nursing.credentials c
JOIN nursing.nurses n ON n.id = c.nurse_id
WHERE c.deleted_at IS NULL
  AND n.deleted_at IS NULL
  AND n.status = 'Active'
  AND c.status IN ('Valid', 'ExpiringSoon')
  -- NULL expiry is excluded implicitly: NULL <= anything evaluates to NULL (row dropped)
  AND c.expiry_date <= CURRENT_DATE + INTERVAL '30 days'
ORDER BY c.expiry_date ASC;

COMMENT ON VIEW nursing.credentials_expiring_soon IS 'Active nurses whose credentials expire within 30 days.';
