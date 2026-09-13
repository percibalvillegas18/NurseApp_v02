-- ============================================================================
-- V2_3__seed_hospital_roles_and_users.sql - Real Hospital Seed Data
-- Note: Password hashes are bcrypt of 'Password123!' with 12 rounds
-- Generated via: bcrypt.hashSync('Password123!', 12)
-- For production, replace with real passwords or use seed script
-- ============================================================================

-- Insert hospital roles
INSERT INTO system.hospital_roles (code, name, description, category, department, assignable_by_roles, is_exclusive, status, created_by, updated_by)
VALUES
  ('RN', 'Registered Nurse', 'Licensed RN providing direct patient care, medication administration, patient assessment, care planning, and clinical decision-making', 'Clinical', 'Nursing', ARRAY['CHARGE_NURSE', 'NURSE_MANAGER', 'SYSTEM_ADMIN'], TRUE, 'Active', 1, 1),
  ('LPN', 'Licensed Practical Nurse', 'Licensed LPN providing supporting patient care under RN supervision, vital signs, hygiene, comfort measures', 'Clinical', 'Nursing', ARRAY['CHARGE_NURSE', 'NURSE_MANAGER', 'SYSTEM_ADMIN'], TRUE, 'Active', 1, 1),
  ('CNA', 'Certified Nursing Assistant', 'Certified assistant providing patient hygiene, mobility assistance, vital signs support under nursing supervision', 'Clinical', 'Nursing', ARRAY['CHARGE_NURSE', 'NURSE_MANAGER', 'SYSTEM_ADMIN'], TRUE, 'Active', 1, 1),
  ('CHARGE_NURSE', 'Charge Nurse', 'Unit-level clinical leader responsible for daily operations, staff coordination, patient assignments, unit scheduling, quality assurance', 'Clinical', 'Nursing', ARRAY['NURSE_MANAGER', 'SYSTEM_ADMIN'], TRUE, 'Active', 1, 1),
  ('NURSE_MANAGER', 'Nurse Manager', 'Department-level manager responsible for unit operations, budget, staffing, performance, compliance, strategic planning', 'Administrative', 'Nursing', ARRAY['SYSTEM_ADMIN'], TRUE, 'Active', 1, 1),
  ('SCHEDULER', 'Workforce Scheduler', 'Responsible for creating duty rosters, managing leave requests, float pool assignments, schedule compliance', 'Administrative', 'Nursing', ARRAY['NURSE_MANAGER', 'SYSTEM_ADMIN'], TRUE, 'Active', 1, 1),
  ('HR_ADMIN', 'HR Administrator', 'Human resources administration including hiring, onboarding, compliance documentation, credential verification', 'Administrative', 'Human Resources', ARRAY['SYSTEM_ADMIN'], TRUE, 'Active', 1, 1),
  ('COMPLIANCE_OFFICER', 'Compliance Officer', 'Regulatory compliance, policy enforcement, audit coordination, reporting to external bodies', 'Administrative', 'Compliance', ARRAY['SYSTEM_ADMIN'], TRUE, 'Active', 1, 1),
  ('SYSTEM_ADMIN', 'System Administrator', 'Full system administration, RBAC configuration, user management, system configuration, access control', 'System', 'IT', ARRAY['SYSTEM_ADMIN'], FALSE, 'Active', 1, 1),
  ('READONLY_USER', 'Read-Only User', 'View-only access to assigned areas. No create, edit, delete, or administrative functions', 'System', 'IT', ARRAY['SYSTEM_ADMIN'], FALSE, 'Active', 1, 1)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  department = EXCLUDED.department,
  assignable_by_roles = EXCLUDED.assignable_by_roles,
  is_exclusive = EXCLUDED.is_exclusive,
  status = EXCLUDED.status,
  updated_at = CURRENT_TIMESTAMP;

-- Insert users with bcrypt hash for 'Password123!' = $2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj6ukPqZ6a2m
-- For dev only - in production use proper password setup flow
INSERT INTO auth.users (username, email, password_hash, full_name, status, email_verified, created_by, updated_by)
VALUES
  ('admin.system', 'admin@hospital.local', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj6ukPqZ6a2m', 'System Administrator', 'Active', TRUE, 1, 1),
  ('susan.lee', 'susan.lee@hospital.local', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj6ukPqZ6a2m', 'Susan Lee - Nurse Manager, ICU', 'Active', TRUE, 1, 1),
  ('james.wilson', 'james.wilson@hospital.local', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj6ukPqZ6a2m', 'James Wilson - Charge Nurse, ICU', 'Active', TRUE, 1, 1),
  ('maria.garcia', 'maria.garcia@hospital.local', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj6ukPqZ6a2m', 'Maria Garcia - Registered Nurse, ICU', 'Active', TRUE, 1, 1),
  ('ahmed.hassan', 'ahmed.hassan@hospital.local', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj6ukPqZ6a2m', 'Ahmed Hassan - Registered Nurse, ICU', 'Active', TRUE, 1, 1),
  ('jennifer.smith', 'jennifer.smith@hospital.local', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj6ukPqZ6a2m', 'Jennifer Smith - Licensed Practical Nurse, ICU', 'Active', TRUE, 1, 1),
  ('david.kim', 'david.kim@hospital.local', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj6ukPqZ6a2m', 'David Kim - Nursing Assistant, ICU', 'Active', TRUE, 1, 1),
  ('rachel.brown', 'rachel.brown@hospital.local', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj6ukPqZ6a2m', 'Rachel Brown - Workforce Scheduler', 'Active', TRUE, 1, 1),
  ('patricia.johnson', 'patricia.johnson@hospital.local', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj6ukPqZ6a2m', 'Patricia Johnson - HR Administrator', 'Active', TRUE, 1, 1),
  ('michael.wong', 'michael.wong@hospital.local', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj6ukPqZ6a2m', 'Michael Wong - Compliance Officer', 'Active', TRUE, 1, 1)
ON CONFLICT (username) DO UPDATE SET
  email = EXCLUDED.email,
  full_name = EXCLUDED.full_name,
  status = EXCLUDED.status,
  email_verified = EXCLUDED.email_verified,
  updated_at = CURRENT_TIMESTAMP;

-- Assign roles to users
WITH user_ids AS (SELECT id, username FROM auth.users),
role_ids AS (SELECT id, code FROM system.hospital_roles)
INSERT INTO auth.user_role_assignments (user_id, role_id, assigned_by, reason, status)
VALUES
  ((SELECT id FROM user_ids WHERE username = 'admin.system'), (SELECT id FROM role_ids WHERE code = 'SYSTEM_ADMIN'), 1, 'System Administrator - Full access', 'Active'),
  ((SELECT id FROM user_ids WHERE username = 'susan.lee'), (SELECT id FROM role_ids WHERE code = 'NURSE_MANAGER'), 1, 'Nurse Manager - ICU Department', 'Active'),
  ((SELECT id FROM user_ids WHERE username = 'james.wilson'), (SELECT id FROM role_ids WHERE code = 'CHARGE_NURSE'), 1, 'Charge Nurse - ICU Unit', 'Active'),
  ((SELECT id FROM user_ids WHERE username = 'maria.garcia'), (SELECT id FROM role_ids WHERE code = 'RN'), 1, 'Registered Nurse - ICU', 'Active'),
  ((SELECT id FROM user_ids WHERE username = 'ahmed.hassan'), (SELECT id FROM role_ids WHERE code = 'RN'), 1, 'Registered Nurse - ICU', 'Active'),
  ((SELECT id FROM user_ids WHERE username = 'jennifer.smith'), (SELECT id FROM role_ids WHERE code = 'LPN'), 1, 'Licensed Practical Nurse - ICU', 'Active'),
  ((SELECT id FROM user_ids WHERE username = 'david.kim'), (SELECT id FROM role_ids WHERE code = 'CNA'), 1, 'Nursing Assistant - ICU', 'Active'),
  ((SELECT id FROM user_ids WHERE username = 'rachel.brown'), (SELECT id FROM role_ids WHERE code = 'SCHEDULER'), 1, 'Workforce Scheduler', 'Active'),
  ((SELECT id FROM user_ids WHERE username = 'patricia.johnson'), (SELECT id FROM role_ids WHERE code = 'HR_ADMIN'), 1, 'HR Administrator', 'Active'),
  ((SELECT id FROM user_ids WHERE username = 'michael.wong'), (SELECT id FROM role_ids WHERE code = 'COMPLIANCE_OFFICER'), 1, 'Compliance Officer', 'Active')
ON CONFLICT (user_id, role_id) DO UPDATE SET status = 'Active', reason = EXCLUDED.reason, updated_at = CURRENT_TIMESTAMP;

-- Set primary roles
UPDATE auth.users u
SET primary_role_id = (
  SELECT ura.role_id FROM auth.user_role_assignments ura WHERE ura.user_id = u.id ORDER BY ura.created_at DESC LIMIT 1
)
WHERE u.status = 'Active' AND u.primary_role_id IS NULL;

-- Validate FK constraints now that data exists
ALTER TABLE rbac.role_menu_access VALIDATE CONSTRAINT fk_role_menu_access_hospital_roles;
ALTER TABLE rbac.role_permissions VALIDATE CONSTRAINT fk_role_permissions_hospital_roles;

-- Verify
SELECT 'Users: ' || COUNT(*) FROM auth.users WHERE status = 'Active'
UNION ALL
SELECT 'Roles: ' || COUNT(*) FROM system.hospital_roles WHERE status = 'Active'
UNION ALL
SELECT 'Assignments: ' || COUNT(*) FROM auth.user_role_assignments WHERE status = 'Active';

SELECT 'V2_3__seed_hospital_roles_and_users completed' as status;
