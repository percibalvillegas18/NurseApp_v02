-- ============================================================================
-- V1_1__system_tables.sql - System reference tables
-- ============================================================================

CREATE TABLE IF NOT EXISTS system.user_roles (
  code VARCHAR(50) PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive')),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO system.user_roles (code, name, description, status) VALUES
  ('Administrator', 'Administrator', 'Full system administration access', 'Active'),
  ('Moderator', 'Moderator', 'Management and supervision access', 'Active'),
  ('User-01', 'User-01', 'Standard operational user 1', 'Active'),
  ('User-02', 'User-02', 'Standard operational user 2', 'Active'),
  ('User-03', 'User-03', 'Standard operational user 3', 'Active'),
  ('Guest', 'Guest', 'Read-only guest access', 'Active')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS system.error_codes (
  code VARCHAR(50) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  http_status INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO system.error_codes (code, name, description, http_status) VALUES
  ('UNAUTHORIZED', 'Unauthorized', 'Authentication required or invalid', 401),
  ('FORBIDDEN', 'Forbidden', 'User lacks necessary permissions', 403),
  ('NOT_FOUND', 'Not Found', 'Resource not found', 404),
  ('CONFLICT', 'Conflict', 'Resource conflict or duplicate', 409),
  ('VALIDATION_ERROR', 'Validation Error', 'Input validation failed', 400),
  ('INTERNAL_SERVER_ERROR', 'Internal Server Error', 'Unexpected server error', 500),
  ('SERVICE_UNAVAILABLE', 'Service Unavailable', 'Service temporarily unavailable', 503)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS system.audit_event_types (
  code VARCHAR(50) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(50) NOT NULL,
  risk_level VARCHAR(50) DEFAULT 'Medium' CHECK (risk_level IN ('Low', 'Medium', 'High', 'Critical')),
  description TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO system.audit_event_types (code, name, category, risk_level, description) VALUES
  ('CONFIGURATION_CHANGE', 'Configuration Change', 'RBAC', 'High', 'Access control configuration changed'),
  ('PERMISSION_GRANTED', 'Permission Granted', 'RBAC', 'High', 'Permission granted to a role'),
  ('PERMISSION_REVOKED', 'Permission Revoked', 'RBAC', 'High', 'Permission removed from a role'),
  ('ACCESS_DENIED', 'Access Denied', 'SECURITY', 'High', 'Unauthorized access attempt'),
  ('DELETE_EXECUTED', 'Delete Executed', 'DATA', 'Critical', 'Record deleted'),
  ('MANAGE_EXECUTED', 'Manage Executed', 'RBAC', 'Critical', 'Management action executed'),
  ('LOGIN_SUCCESS', 'Login Success', 'AUTHENTICATION', 'Low', 'User logged in'),
  ('LOGIN_FAILURE', 'Login Failure', 'AUTHENTICATION', 'Medium', 'Login attempt failed'),
  ('PASSWORD_CHANGED', 'Password Changed', 'AUTHENTICATION', 'Medium', 'User password changed'),
  ('ROLE_CHANGED', 'Role Changed', 'RBAC', 'High', 'User role assignment changed'),
  ('USER_CREATED', 'User Created', 'USER_MANAGEMENT', 'Medium', 'New user account created'),
  ('USER_ACTIVATED', 'User Activated', 'USER_MANAGEMENT', 'Medium', 'User account activated'),
  ('USER_DEACTIVATED', 'User Deactivated', 'USER_MANAGEMENT', 'Medium', 'User account deactivated')
ON CONFLICT (code) DO NOTHING;

-- Seed organizations
INSERT INTO rbac.organizations (name, code, city, country, status) VALUES
  ('Central Hospital', 'CENTRAL_HOSP', 'Riyadh', 'SA', 'Active'),
  ('North Medical Center', 'NORTH_MED', 'Riyadh', 'SA', 'Active')
ON CONFLICT (code) DO NOTHING;

-- Seed departments
INSERT INTO rbac.departments (organization_id, name, code, status)
SELECT o.id, 'Intensive Care Unit', 'ICU', 'Active' FROM rbac.organizations o WHERE o.code = 'CENTRAL_HOSP'
UNION ALL
SELECT o.id, 'Emergency Department', 'ER', 'Active' FROM rbac.organizations o WHERE o.code = 'CENTRAL_HOSP'
UNION ALL
SELECT o.id, 'Medical Ward', 'MED_WARD', 'Active' FROM rbac.organizations o WHERE o.code = 'CENTRAL_HOSP'
ON CONFLICT DO NOTHING;

-- Seed nursing units
INSERT INTO rbac.nursing_units (department_id, name, code, unit_type, capacity, status)
SELECT d.id, 'ICU Unit A', 'ICU_A', 'Critical Care', 20, 'Active' FROM rbac.departments d WHERE d.code = 'ICU'
UNION ALL
SELECT d.id, 'ICU Unit B', 'ICU_B', 'Critical Care', 15, 'Active' FROM rbac.departments d WHERE d.code = 'ICU'
UNION ALL
SELECT d.id, 'ER Triage', 'ER_TRIAGE', 'Emergency', 10, 'Active' FROM rbac.departments d WHERE d.code = 'ER'
ON CONFLICT DO NOTHING;

-- Seed posts
INSERT INTO rbac.posts (nursing_unit_id, name, code, post_type, status)
SELECT nu.id, 'Bed 01-10', 'ICU_A_BED_01_10', 'Bed', 'Active' FROM rbac.nursing_units nu WHERE nu.code = 'ICU_A'
ON CONFLICT DO NOTHING;

-- Seed shifts
INSERT INTO rbac.shifts (name, code, start_time, end_time, description, status) VALUES
  ('Morning Shift', 'MORNING', '07:00:00', '15:00:00', 'Morning duty 7AM-3PM', 'Active'),
  ('Evening Shift', 'EVENING', '15:00:00', '23:00:00', 'Evening duty 3PM-11PM', 'Active'),
  ('Night Shift', 'NIGHT', '23:00:00', '07:00:00', 'Night duty 11PM-7AM', 'Active')
ON CONFLICT (code) DO NOTHING;

-- Seed menus - Root and children
INSERT INTO rbac.menus (code, name, description, parent_menu_id, display_order, route, icon, is_functional, status, created_by, updated_by) VALUES
  ('DASHBOARD', 'Dashboard', 'Main dashboard', NULL, 1, '/dashboard', 'dashboard', true, 'Active', 1, 1),
  ('NURSING_WORKFORCE', 'Nursing Workforce', 'Nursing workforce management', NULL, 2, '/nursing', 'people', false, 'Active', 1, 1),
  ('SCHEDULING', 'Scheduling', 'Workforce scheduling', NULL, 3, '/scheduling', 'calendar', false, 'Active', 1, 1),
  ('WORKFORCE_ANALYTICS', 'Workforce Analytics', 'Analytics and reports', NULL, 4, '/analytics', 'analytics', false, 'Active', 1, 1),
  ('ADMINISTRATION', 'Administration', 'System administration', NULL, 5, '/admin', 'settings', false, 'Active', 1, 1)
ON CONFLICT (code) DO NOTHING;

INSERT INTO rbac.menus (code, name, description, parent_menu_id, display_order, route, icon, is_functional, status, created_by, updated_by)
SELECT 'NURSE_MASTER', 'Nurse Master', 'Master list of nurses', m.id, 1, '/nursing/master', 'badge', true, 'Active', 1, 1 FROM rbac.menus m WHERE m.code = 'NURSING_WORKFORCE'
UNION ALL
SELECT 'CREDENTIALS', 'Credentials', 'Nurse credentials', m.id, 2, '/nursing/credentials', 'verified', true, 'Active', 1, 1 FROM rbac.menus m WHERE m.code = 'NURSING_WORKFORCE'
UNION ALL
SELECT 'CERTIFICATIONS', 'Certifications', 'Certifications tracking', m.id, 3, '/nursing/certifications', 'certificate', true, 'Active', 1, 1 FROM rbac.menus m WHERE m.code = 'NURSING_WORKFORCE'
UNION ALL
SELECT 'NURSE_ROSTER', 'Nurse Roster', 'Daily roster', m.id, 1, '/scheduling/roster', 'list', true, 'Active', 1, 1 FROM rbac.menus m WHERE m.code = 'SCHEDULING'
UNION ALL
SELECT 'LEAVE_MANAGEMENT', 'Leave Management', 'Leave requests', m.id, 2, '/scheduling/leave', 'time_off', true, 'Active', 1, 1 FROM rbac.menus m WHERE m.code = 'SCHEDULING'
UNION ALL
SELECT 'USER_MANAGEMENT', 'User Management', 'Manage users', m.id, 1, '/admin/users', 'users', true, 'Active', 1, 1 FROM rbac.menus m WHERE m.code = 'ADMINISTRATION'
UNION ALL
SELECT 'ROLES_PERMISSIONS', 'Roles & Permissions', 'RBAC configuration', m.id, 2, '/admin/rbac', 'shield', true, 'Active', 1, 1 FROM rbac.menus m WHERE m.code = 'ADMINISTRATION'
UNION ALL
SELECT 'ACCESS_LEVEL_MASTER', 'Access Level Master', 'Access levels', m.id, 3, '/admin/access-levels', 'key', true, 'Active', 1, 1 FROM rbac.menus m WHERE m.code = 'ADMINISTRATION'
UNION ALL
SELECT 'MENU_MASTER', 'Menu Master', 'Menu configuration', m.id, 4, '/admin/menus', 'menu', true, 'Active', 1, 1 FROM rbac.menus m WHERE m.code = 'ADMINISTRATION'
UNION ALL
SELECT 'AUDIT_LOGS', 'Audit Logs', 'Audit trail', m.id, 5, '/admin/audit', 'audit', true, 'Active', 1, 1 FROM rbac.menus m WHERE m.code = 'ADMINISTRATION'
UNION ALL
SELECT 'SYSTEM_SETTINGS', 'System Settings', 'System configuration', m.id, 6, '/admin/settings', 'settings', true, 'Active', 1, 1 FROM rbac.menus m WHERE m.code = 'ADMINISTRATION'
ON CONFLICT (code) DO NOTHING;

SELECT 'V1_1__system_tables completed' as status;
