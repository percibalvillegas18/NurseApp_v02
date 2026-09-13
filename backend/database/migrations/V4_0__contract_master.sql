-- =============================================================================
-- V4_0__contract_master.sql
-- Contract Master & Employment Contract Management
-- Chain: Nurse → Job No. → Position → Dept/Unit → Contract → Credentials → Roster
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS nursing;

-- Agencies that supply / employ nursing staff at the hospital
DO $$ BEGIN
  CREATE TYPE nursing.contract_agency_type AS ENUM (
    'Government',      -- e.g. MOH civil service
    'HospitalDirect',  -- e.g. SOP self-operating program
    'ThirdParty',      -- e.g. HCC / HHC manpower contractors
    'Other'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE nursing.employment_contract_type AS ENUM (
    'Permanent',
    'FixedTerm',
    'Temporary',
    'Locum',
    'Other'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE nursing.employment_contract_status AS ENUM (
    'Draft',
    'PendingApproval',
    'Active',
    'Suspended',
    'Expired',
    'Terminated',
    'Superseded'  -- replaced by a renewal contract
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Contract agencies (MOH, SOP, HCC, HHC, ...)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nursing.contract_agencies (
  id           BIGSERIAL PRIMARY KEY,
  code         VARCHAR(50)  NOT NULL UNIQUE,
  name         VARCHAR(255) NOT NULL,
  name_ar      VARCHAR(255),
  description  TEXT,
  agency_type  VARCHAR(50)  NOT NULL DEFAULT 'Other',
  status       VARCHAR(50)  NOT NULL DEFAULT 'Active',
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO nursing.contract_agencies (code, name, name_ar, description, agency_type, status) VALUES
  ('MOH', 'Ministry of Health', 'وزارة الصحة',
   'Staff directly employed by the government as civil servants under the Saudi Ministry of Health.',
   'Government', 'Active'),
  ('SOP', 'Self-Operating Program', 'برنامج التشغيل الذاتي',
   'Staff employed under the hospital direct hiring program (SOP). Standard model in Saudi government hospitals: hospital-specific contracts outside the civil service registry.',
   'HospitalDirect', 'Active'),
  ('HCC', 'HCC Contracting', NULL,
   'Third-party medical manpower contracting company / budget used to outsource specialized staffing to the hospital.',
   'ThirdParty', 'Active'),
  ('HHC', 'HHC Contracting', NULL,
   'Third-party medical manpower contracting company / budget used to outsource specialized staffing (e.g. ECG technicians, certain nursing staff).',
   'ThirdParty', 'Active')
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  agency_type = EXCLUDED.agency_type,
  updated_at = CURRENT_TIMESTAMP;

-- ---------------------------------------------------------------------------
-- Positions (Position Code → Position title, optional unit/dept link)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nursing.positions (
  id               BIGSERIAL PRIMARY KEY,
  code             VARCHAR(50)  NOT NULL UNIQUE,
  name             VARCHAR(255) NOT NULL,
  description      TEXT,
  department_id    BIGINT REFERENCES rbac.departments(id) ON DELETE SET NULL,
  nursing_unit_id  BIGINT REFERENCES rbac.nursing_units(id) ON DELETE SET NULL,
  category         VARCHAR(100),
  status           VARCHAR(50) NOT NULL DEFAULT 'Active',
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_positions_status ON nursing.positions(status);
CREATE INDEX IF NOT EXISTS idx_positions_unit ON nursing.positions(nursing_unit_id);

INSERT INTO nursing.positions (code, name, category, status)
VALUES
  ('RN-ICU', 'Registered Nurse - ICU', 'Nursing', 'Active'),
  ('RN-ER', 'Registered Nurse - Emergency', 'Nursing', 'Active'),
  ('LPN-GEN', 'Licensed Practical Nurse - General', 'Nursing', 'Active'),
  ('CNA-GEN', 'Certified Nursing Assistant - General', 'Nursing', 'Active'),
  ('CN-ICU', 'Charge Nurse - ICU', 'Nursing', 'Active'),
  ('NM-ICU', 'Nurse Manager - ICU', 'Nursing', 'Active')
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Employment contracts (authoritative contract record per engagement)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nursing.employment_contracts (
  id                    BIGSERIAL PRIMARY KEY,
  contract_number       VARCHAR(50)  NOT NULL UNIQUE,
  nurse_id              BIGINT       NOT NULL REFERENCES nursing.nurses(id) ON DELETE RESTRICT,
  job_no                VARCHAR(50),  -- denormalized from nurse for historical accuracy
  position_id           BIGINT       REFERENCES nursing.positions(id) ON DELETE SET NULL,
  agency_id             BIGINT       NOT NULL REFERENCES nursing.contract_agencies(id) ON DELETE RESTRICT,
  nursing_unit_id       BIGINT       REFERENCES rbac.nursing_units(id) ON DELETE SET NULL,
  department_id         BIGINT       REFERENCES rbac.departments(id) ON DELETE SET NULL,
  contract_type         VARCHAR(50)  NOT NULL DEFAULT 'FixedTerm',
  status                VARCHAR(50)  NOT NULL DEFAULT 'Draft',
  start_date            DATE         NOT NULL,
  end_date              DATE,         -- NULL = open-ended / permanent
  probation_end_date    DATE,
  renewal_of_id         BIGINT       REFERENCES nursing.employment_contracts(id) ON DELETE SET NULL,
  notes                 TEXT,
  activated_at          TIMESTAMP,
  activated_by          BIGINT,
  terminated_at         TIMESTAMP,
  terminated_by         BIGINT,
  termination_reason    TEXT,
  approved_at           TIMESTAMP,
  approved_by           BIGINT,
  created_by            BIGINT,
  updated_by            BIGINT,
  created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_contract_dates CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_emp_contracts_nurse ON nursing.employment_contracts(nurse_id);
CREATE INDEX IF NOT EXISTS idx_emp_contracts_status ON nursing.employment_contracts(status);
CREATE INDEX IF NOT EXISTS idx_emp_contracts_agency ON nursing.employment_contracts(agency_id);
CREATE INDEX IF NOT EXISTS idx_emp_contracts_end ON nursing.employment_contracts(end_date);
CREATE INDEX IF NOT EXISTS idx_emp_contracts_job_no ON nursing.employment_contracts(job_no);

COMMENT ON TABLE nursing.employment_contracts IS
  'Authoritative employment contract per nurse engagement. Status lifecycle: Draft → PendingApproval → Active → Expired/Terminated/Superseded.';

-- ---------------------------------------------------------------------------
-- Status history (audit of lifecycle transitions)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nursing.contract_status_history (
  id           BIGSERIAL PRIMARY KEY,
  contract_id  BIGINT NOT NULL REFERENCES nursing.employment_contracts(id) ON DELETE CASCADE,
  from_status  VARCHAR(50),
  to_status    VARCHAR(50) NOT NULL,
  reason       TEXT,
  changed_by   BIGINT,
  changed_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_contract_hist_contract ON nursing.contract_status_history(contract_id);

-- ---------------------------------------------------------------------------
-- Contract documents (metadata; binary storage is external / future)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nursing.contract_documents (
  id            BIGSERIAL PRIMARY KEY,
  contract_id   BIGINT NOT NULL REFERENCES nursing.employment_contracts(id) ON DELETE CASCADE,
  doc_type      VARCHAR(100) NOT NULL DEFAULT 'SignedContract',
  title         VARCHAR(255),
  file_name     VARCHAR(255),
  storage_ref   VARCHAR(500),  -- path or object key; not the file bytes
  mime_type     VARCHAR(100),
  notes         TEXT,
  uploaded_by   BIGINT,
  uploaded_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status        VARCHAR(50) NOT NULL DEFAULT 'Active'
);

CREATE INDEX IF NOT EXISTS idx_contract_docs_contract ON nursing.contract_documents(contract_id);

-- ---------------------------------------------------------------------------
-- Helper: does nurse have an Active contract covering a given date?
-- Used by roster to block deployment without valid contract.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION nursing.nurse_has_valid_contract(
  p_nurse_id BIGINT,
  p_on_date  DATE DEFAULT CURRENT_DATE
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM nursing.employment_contracts c
    WHERE c.nurse_id = p_nurse_id
      AND c.status = 'Active'
      AND c.start_date <= p_on_date
      AND (c.end_date IS NULL OR c.end_date >= p_on_date)
  );
$$;

COMMENT ON FUNCTION nursing.nurse_has_valid_contract IS
  'True if the nurse has at least one Active employment contract covering p_on_date.';

-- ---------------------------------------------------------------------------
-- RBAC: ensure CONTRACT menu exists and grant common roles
-- ---------------------------------------------------------------------------
INSERT INTO rbac.menus (code, name, description, parent_menu_id, display_order, route, icon, is_functional, status, created_by, updated_by)
SELECT 'CONTRACT', 'Contract', 'Employment contract master',
       m.id, 3, '/nursing/contract', 'file', true, 'Active', 1, 1
FROM rbac.menus m
WHERE m.code = 'NURSING_WORKFORCE'
  AND NOT EXISTS (SELECT 1 FROM rbac.menus WHERE code = 'CONTRACT');

-- Role menu access: admin / HR / nurse manager / compliance can manage; clinical view limited
INSERT INTO rbac.role_menu_access (role_code, menu_id, visible, enabled, assignment_source, status, created_by, updated_by)
SELECT r.code, m.id, true, true, 'SystemDefault', 'Active', 1, 1
FROM rbac.menus m
CROSS JOIN (VALUES
  ('SYSTEM_ADMIN'), ('HR_ADMIN'), ('NURSE_MANAGER'), ('COMPLIANCE_OFFICER'),
  ('SCHEDULER'), ('CHARGE_NURSE'), ('RN'), ('LPN'), ('CNA')
) AS r(code)
WHERE m.code = 'CONTRACT'
ON CONFLICT (role_code, menu_id) DO NOTHING;

-- Permissions VIEW/CREATE/EDIT/DELETE/APPROVE on CONTRACT for key roles
INSERT INTO rbac.role_permissions (role_code, menu_id, permission_id, allowed, source, status, created_by, updated_by)
SELECT x.role_code, m.id, p.id, true, 'SystemDefault', 'Active', 1, 1
FROM rbac.menus m
CROSS JOIN rbac.permissions p
CROSS JOIN (VALUES
  ('SYSTEM_ADMIN', 'VIEW'), ('SYSTEM_ADMIN', 'CREATE'), ('SYSTEM_ADMIN', 'EDIT'),
  ('SYSTEM_ADMIN', 'DELETE'), ('SYSTEM_ADMIN', 'APPROVE'), ('SYSTEM_ADMIN', 'MANAGE'),
  ('HR_ADMIN', 'VIEW'), ('HR_ADMIN', 'CREATE'), ('HR_ADMIN', 'EDIT'),
  ('HR_ADMIN', 'DELETE'), ('HR_ADMIN', 'APPROVE'),
  ('NURSE_MANAGER', 'VIEW'), ('NURSE_MANAGER', 'CREATE'), ('NURSE_MANAGER', 'EDIT'), ('NURSE_MANAGER', 'APPROVE'),
  ('COMPLIANCE_OFFICER', 'VIEW'), ('COMPLIANCE_OFFICER', 'REVIEW'),
  ('SCHEDULER', 'VIEW'),
  ('CHARGE_NURSE', 'VIEW'),
  ('RN', 'VIEW'), ('LPN', 'VIEW'), ('CNA', 'VIEW')
) AS x(role_code, perm_code)
WHERE m.code = 'CONTRACT' AND p.code = x.perm_code
ON CONFLICT (role_code, menu_id, permission_id) DO NOTHING;

-- Demo contracts for seeded nurses (idempotent by contract_number)
INSERT INTO nursing.employment_contracts (
  contract_number, nurse_id, job_no, position_id, agency_id, nursing_unit_id,
  contract_type, status, start_date, end_date, activated_at, created_by, updated_by
)
SELECT
  'CTR-MOH-1001', n.id, n.job_no, p.id, a.id, n.home_unit_id,
  'Permanent', 'Active', CURRENT_DATE - INTERVAL '2 years', NULL,
  CURRENT_TIMESTAMP, 1, 1
FROM nursing.nurses n
JOIN nursing.contract_agencies a ON a.code = 'MOH'
LEFT JOIN nursing.positions p ON p.code = 'RN-ICU'
WHERE n.employee_number = 'EMP-1001'
  AND NOT EXISTS (SELECT 1 FROM nursing.employment_contracts WHERE contract_number = 'CTR-MOH-1001');

INSERT INTO nursing.employment_contracts (
  contract_number, nurse_id, job_no, position_id, agency_id, nursing_unit_id,
  contract_type, status, start_date, end_date, activated_at, created_by, updated_by
)
SELECT
  'CTR-SOP-1002', n.id, n.job_no, p.id, a.id, n.home_unit_id,
  'FixedTerm', 'Active', CURRENT_DATE - INTERVAL '6 months', CURRENT_DATE + INTERVAL '6 months',
  CURRENT_TIMESTAMP, 1, 1
FROM nursing.nurses n
JOIN nursing.contract_agencies a ON a.code = 'SOP'
LEFT JOIN nursing.positions p ON p.code = 'RN-ICU'
WHERE n.employee_number = 'EMP-1002'
  AND NOT EXISTS (SELECT 1 FROM nursing.employment_contracts WHERE contract_number = 'CTR-SOP-1002');

INSERT INTO nursing.employment_contracts (
  contract_number, nurse_id, job_no, position_id, agency_id, nursing_unit_id,
  contract_type, status, start_date, end_date, activated_at, created_by, updated_by
)
SELECT
  'CTR-HCC-1003', n.id, n.job_no, p.id, a.id, n.home_unit_id,
  'Temporary', 'Active', CURRENT_DATE - INTERVAL '30 days', CURRENT_DATE + INTERVAL '60 days',
  CURRENT_TIMESTAMP, 1, 1
FROM nursing.nurses n
JOIN nursing.contract_agencies a ON a.code = 'HCC'
LEFT JOIN nursing.positions p ON p.code = 'LPN-GEN'
WHERE n.employee_number = 'EMP-1003'
  AND NOT EXISTS (SELECT 1 FROM nursing.employment_contracts WHERE contract_number = 'CTR-HCC-1003');

SELECT 'V4_0__contract_master completed' AS status;
