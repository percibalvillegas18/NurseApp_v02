-- Additive migration: existing assignments and access roles are preserved.
ALTER TABLE nursing.nurses ADD COLUMN IF NOT EXISTS position_code VARCHAR(10)
  CHECK (position_code IN ('HN', 'AHN', 'CI', 'SN', 'PCT', 'TEC', 'CN', 'HCA', 'MW'));
CREATE INDEX IF NOT EXISTS idx_nurses_position ON nursing.nurses(position_code);

INSERT INTO nursing.positions (code, name, category, status) VALUES
  ('HN', 'Head Nurse', 'Nursing', 'Active'),
  ('AHN', 'Asst. Head Nurse', 'Nursing', 'Active'),
  ('CI', 'Clinical Instructor', 'Nursing', 'Active'),
  ('SN', 'Staff Nurse', 'Nursing', 'Active'),
  ('PCT', 'Patient Care Tech', 'Nursing', 'Active'),
  ('TEC', 'ECG Technician', 'Nursing', 'Active'),
  ('CN', 'Charge Nurse', 'Nursing', 'Active'),
  ('HCA', 'Health Care Asst.', 'Nursing', 'Active'),
  ('MW', 'Midwife', 'Nursing', 'Active')
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name;

-- Seed the supplied hierarchy into the repository's existing Central Hospital.
-- Do not move or rename legacy units, since they are referenced by rosters/scopes.
INSERT INTO rbac.departments (organization_id, code, name, status)
SELECT o.id, v.code, v.name, 'Active'
FROM rbac.organizations o CROSS JOIN (VALUES
  ('EMERGENCY_ACUTE', 'EMERGENCY & ACUTE CARE'),
  ('SURGICAL_PERIOP', 'SURGICAL & PERIOPERATIVE SERVICES'),
  ('CRITICAL_INTENSIVE', 'CRITICAL CARE & INTENSIVE SERVICES'),
  ('GENERAL_SPECIALTY', 'GENERAL & SPECIALTY SERVICES')
) AS v(code, name)
WHERE o.code = 'CENTRAL_HOSP'
ON CONFLICT (organization_id, code) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO rbac.nursing_units (department_id, code, name, status)
SELECT d.id, v.code, v.name, 'Active'
FROM (VALUES
  ('EMERGENCY_ACUTE', 'EMERGENCY_ACUTE_01', 'ED Resuscitation Area'),
  ('EMERGENCY_ACUTE', 'EMERGENCY_ACUTE_02', 'ED Fastrack/Observation Area'),
  ('EMERGENCY_ACUTE', 'EMERGENCY_ACUTE_03', 'ED Maternal & Child'),
  ('EMERGENCY_ACUTE', 'EMERGENCY_ACUTE_04', 'ED Navigation'),
  ('EMERGENCY_ACUTE', 'EMERGENCY_ACUTE_05', 'ED Administration & Support'),
  ('SURGICAL_PERIOP', 'SURGICAL_PERIOP_01', 'Operation Room (OR) Suites'),
  ('SURGICAL_PERIOP', 'SURGICAL_PERIOP_02', 'Recovery/PACU (Post-Op)'),
  ('SURGICAL_PERIOP', 'SURGICAL_PERIOP_03', 'Plaster Unit'),
  ('SURGICAL_PERIOP', 'SURGICAL_PERIOP_04', 'OR Administration & Support'),
  ('CRITICAL_INTENSIVE', 'CRITICAL_INTENSIVE_01', 'Intensive Care Unit (ICU) Main'),
  ('CRITICAL_INTENSIVE', 'CRITICAL_INTENSIVE_02', 'ICU Extension'),
  ('CRITICAL_INTENSIVE', 'CRITICAL_INTENSIVE_03', 'High Dependency Unit (HDU)'),
  ('GENERAL_SPECIALTY', 'GENERAL_SPECIALTY_01', 'ACUTE GENERAL CARE/Ward 3A/General Acute'),
  ('GENERAL_SPECIALTY', 'GENERAL_SPECIALTY_02', 'ACUTE GENERAL CARE/Ward 4A/Acute Specialized'),
  ('GENERAL_SPECIALTY', 'GENERAL_SPECIALTY_03', 'ACUTE GENERAL CARE/Ward 4B/Acute Specialized'),
  ('GENERAL_SPECIALTY', 'GENERAL_SPECIALTY_04', 'ACUTE GENERAL CARE/Ward 5B/Acute Specialized'),
  ('GENERAL_SPECIALTY', 'GENERAL_SPECIALTY_05', 'ACUTE GENERAL CARE/Rehabilitation Ward'),
  ('GENERAL_SPECIALTY', 'GENERAL_SPECIALTY_06', 'ACUTE GENERAL CARE/Pediatric Ward'),
  ('GENERAL_SPECIALTY', 'GENERAL_SPECIALTY_07', 'ACUTE GENERAL CARE/Labor & Delivery'),
  ('GENERAL_SPECIALTY', 'GENERAL_SPECIALTY_08', 'ACUTE GENERAL CARE/Obgyne Ward'),
  ('GENERAL_SPECIALTY', 'GENERAL_SPECIALTY_09', 'ACUTE GENERAL CARE/AKU/Allergy/Kidney Unit'),
  ('GENERAL_SPECIALTY', 'GENERAL_SPECIALTY_10', 'ACUTE GENERAL CARE/Newborn Screening Unit'),
  ('GENERAL_SPECIALTY', 'GENERAL_SPECIALTY_11', 'SPECIALIZED & DIAGNOSTIC/Day Surgery Unit'),
  ('GENERAL_SPECIALTY', 'GENERAL_SPECIALTY_12', 'SPECIALIZED & DIAGNOSTIC/Day Care Unit'),
  ('GENERAL_SPECIALTY', 'GENERAL_SPECIALTY_13', 'SPECIALIZED & DIAGNOSTIC/Outpatient Department (OPD)'),
  ('GENERAL_SPECIALTY', 'GENERAL_SPECIALTY_14', 'SPECIALIZED & DIAGNOSTIC/Jail Ward'),
  ('GENERAL_SPECIALTY', 'GENERAL_SPECIALTY_15', 'SPECIALIZED & DIAGNOSTIC/Respiratory Rehab Therapy (RRT)'),
  ('GENERAL_SPECIALTY', 'GENERAL_SPECIALTY_16', 'SPECIALIZED & DIAGNOSTIC/Plaster Unit (2nd Location)'),
  ('GENERAL_SPECIALTY', 'GENERAL_SPECIALTY_17', 'SPECIALIZED & DIAGNOSTIC/Urgent Care Center (UCC)'),
  ('GENERAL_SPECIALTY', 'GENERAL_SPECIALTY_18', 'SPECIALIZED & DIAGNOSTIC/Electroencephalogram (EEG) Unit'),
  ('GENERAL_SPECIALTY', 'GENERAL_SPECIALTY_19', 'SPECIALIZED & DIAGNOSTIC/Specialty Clinics (Multiple)'),
  ('GENERAL_SPECIALTY', 'GENERAL_SPECIALTY_20', 'DIAGNOSTIC & SPECIALTY/Endoscopy Unit'),
  ('GENERAL_SPECIALTY', 'GENERAL_SPECIALTY_21', 'DIAGNOSTIC & SPECIALTY/Blood Collection Unit'),
  ('GENERAL_SPECIALTY', 'GENERAL_SPECIALTY_22', 'DIAGNOSTIC & SPECIALTY/Radiology Department'),
  ('GENERAL_SPECIALTY', 'GENERAL_SPECIALTY_23', 'DIAGNOSTIC & SPECIALTY/Diabetic Center'),
  ('GENERAL_SPECIALTY', 'GENERAL_SPECIALTY_24', 'DIAGNOSTIC & SPECIALTY/ICU Extension (2nd Location)'),
  ('GENERAL_SPECIALTY', 'GENERAL_SPECIALTY_25', 'DIAGNOSTIC & SPECIALTY/Discharge Unit'),
  ('GENERAL_SPECIALTY', 'GENERAL_SPECIALTY_26', 'DIAGNOSTIC & SPECIALTY/ED Navigator (2nd Location)'),
  ('GENERAL_SPECIALTY', 'GENERAL_SPECIALTY_27', 'SUPPORT & ADMINISTRATIVE SERVICES/Non-Invasive Laboratory'),
  ('GENERAL_SPECIALTY', 'GENERAL_SPECIALTY_28', 'SUPPORT & ADMINISTRATIVE SERVICES/Orthopedic/Tech Services'),
  ('GENERAL_SPECIALTY', 'GENERAL_SPECIALTY_29', 'SUPPORT & ADMINISTRATIVE SERVICES/Administrative Support Areas'),
  ('GENERAL_SPECIALTY', 'GENERAL_SPECIALTY_30', 'SUPPORT & ADMINISTRATIVE SERVICES/Non-Maternal & Child Health Coord'),
  ('GENERAL_SPECIALTY', 'GENERAL_SPECIALTY_31', 'SUPPORT & ADMINISTRATIVE SERVICES/General Support Services')
) AS v(department_code, code, name)
JOIN rbac.departments d ON d.code = v.department_code
JOIN rbac.organizations o ON o.id = d.organization_id AND o.code = 'CENTRAL_HOSP'
ON CONFLICT (department_id, code) DO UPDATE SET name = EXCLUDED.name;

ALTER TYPE nursing.credential_type ADD VALUE IF NOT EXISTS 'Identity';
ALTER TYPE nursing.credential_type ADD VALUE IF NOT EXISTS 'Contract';
ALTER TYPE nursing.credential_type ADD VALUE IF NOT EXISTS 'Insurance';
ALTER TYPE nursing.credential_type ADD VALUE IF NOT EXISTS 'Clearance';
ALTER TYPE nursing.credential_type ADD VALUE IF NOT EXISTS 'Competency';

ALTER TABLE nursing.credentials ADD COLUMN IF NOT EXISTS template_code VARCHAR(50);
ALTER TABLE nursing.credentials ADD COLUMN IF NOT EXISTS tracking_data JSONB NOT NULL DEFAULT '{}';
CREATE UNIQUE INDEX IF NOT EXISTS uq_credentials_nurse_template
  ON nursing.credentials(nurse_id, template_code) WHERE deleted_at IS NULL AND template_code IS NOT NULL;

-- Copies are held in the database and downloaded only through the guarded API.
CREATE TABLE IF NOT EXISTS nursing.credential_documents (
  credential_id BIGINT PRIMARY KEY REFERENCES nursing.credentials(id) ON DELETE CASCADE,
  file_name VARCHAR(255) NOT NULL,
  media_type VARCHAR(100) NOT NULL,
  content BYTEA NOT NULL CHECK (octet_length(content) <= 5242880),
  uploaded_by BIGINT NOT NULL REFERENCES auth.users(id),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
