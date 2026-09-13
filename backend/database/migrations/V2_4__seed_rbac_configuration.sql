-- ============================================================================
-- V2_4__seed_rbac_configuration.sql - Real RBAC Configuration for Hospital Roles
-- Configures menus and permissions for each role based on least privilege
-- ============================================================================

-- Clear existing role_menu_access and role_permissions for clean seed (dev only)
-- In production, use upsert logic
TRUNCATE rbac.role_menu_access, rbac.role_permissions RESTART IDENTITY CASCADE;

-- Helper: Get menu IDs
-- We'll insert using SELECT from menus

-- ============================================================================
-- ROLE MENU ACCESS CONFIGURATION
-- ============================================================================

-- SYSTEM_ADMIN: Full access to all menus
INSERT INTO rbac.role_menu_access (role_code, menu_id, visible, enabled, assignment_source, override_flag, status, created_by, updated_by)
SELECT 'SYSTEM_ADMIN', m.id, true, true, 'SystemDefault', false, 'Active', 1, 1 FROM rbac.menus m WHERE m.status = 'Active'
ON CONFLICT (role_code, menu_id) DO UPDATE SET visible = true, enabled = true, updated_at = CURRENT_TIMESTAMP;

-- NURSE_MANAGER: All except system settings manage? Actually broad access
INSERT INTO rbac.role_menu_access (role_code, menu_id, visible, enabled, assignment_source, status, created_by, updated_by)
SELECT 'NURSE_MANAGER', m.id, true, true, 'AccessLevelDefault', 'Active', 1, 1 FROM rbac.menus m 
WHERE m.code IN ('DASHBOARD', 'NURSING_WORKFORCE', 'NURSE_MASTER', 'CREDENTIALS', 'CERTIFICATIONS', 'SCHEDULING', 'NURSE_ROSTER', 'LEAVE_MANAGEMENT', 'WORKFORCE_ANALYTICS', 'ADMINISTRATION', 'USER_MANAGEMENT', 'AUDIT_LOGS')
ON CONFLICT (role_code, menu_id) DO UPDATE SET visible = true, enabled = true;

-- CHARGE_NURSE: Clinical + scheduling, no admin
INSERT INTO rbac.role_menu_access (role_code, menu_id, visible, enabled, assignment_source, status, created_by, updated_by)
SELECT 'CHARGE_NURSE', m.id, true, true, 'AccessLevelDefault', 'Active', 1, 1 FROM rbac.menus m 
WHERE m.code IN ('DASHBOARD', 'NURSING_WORKFORCE', 'NURSE_MASTER', 'CREDENTIALS', 'CERTIFICATIONS', 'SCHEDULING', 'NURSE_ROSTER', 'LEAVE_MANAGEMENT', 'WORKFORCE_ANALYTICS')
ON CONFLICT (role_code, menu_id) DO UPDATE SET visible = true, enabled = true;

-- RN: Limited clinical
INSERT INTO rbac.role_menu_access (role_code, menu_id, visible, enabled, assignment_source, status, created_by, updated_by)
SELECT 'RN', m.id, true, true, 'AccessLevelDefault', 'Active', 1, 1 FROM rbac.menus m 
WHERE m.code IN ('DASHBOARD', 'NURSING_WORKFORCE', 'NURSE_MASTER', 'SCHEDULING', 'NURSE_ROSTER', 'LEAVE_MANAGEMENT')
ON CONFLICT (role_code, menu_id) DO UPDATE SET visible = true, enabled = true;

-- LPN: Similar to RN but less
INSERT INTO rbac.role_menu_access (role_code, menu_id, visible, enabled, assignment_source, status, created_by, updated_by)
SELECT 'LPN', m.id, true, true, 'AccessLevelDefault', 'Active', 1, 1 FROM rbac.menus m 
WHERE m.code IN ('DASHBOARD', 'NURSING_WORKFORCE', 'NURSE_MASTER', 'SCHEDULING', 'NURSE_ROSTER', 'LEAVE_MANAGEMENT')
ON CONFLICT (role_code, menu_id) DO UPDATE SET visible = true, enabled = true;

-- CNA: Minimal
INSERT INTO rbac.role_menu_access (role_code, menu_id, visible, enabled, assignment_source, status, created_by, updated_by)
SELECT 'CNA', m.id, true, true, 'AccessLevelDefault', 'Active', 1, 1 FROM rbac.menus m 
WHERE m.code IN ('DASHBOARD', 'NURSE_ROSTER', 'LEAVE_MANAGEMENT')
ON CONFLICT (role_code, menu_id) DO UPDATE SET visible = true, enabled = true;

-- SCHEDULER: Scheduling focused
INSERT INTO rbac.role_menu_access (role_code, menu_id, visible, enabled, assignment_source, status, created_by, updated_by)
SELECT 'SCHEDULER', m.id, true, true, 'AccessLevelDefault', 'Active', 1, 1 FROM rbac.menus m 
WHERE m.code IN ('DASHBOARD', 'NURSING_WORKFORCE', 'NURSE_MASTER', 'SCHEDULING', 'NURSE_ROSTER', 'LEAVE_MANAGEMENT', 'WORKFORCE_ANALYTICS')
ON CONFLICT (role_code, menu_id) DO UPDATE SET visible = true, enabled = true;

-- HR_ADMIN: User management + credentials
INSERT INTO rbac.role_menu_access (role_code, menu_id, visible, enabled, assignment_source, status, created_by, updated_by)
SELECT 'HR_ADMIN', m.id, true, true, 'AccessLevelDefault', 'Active', 1, 1 FROM rbac.menus m 
WHERE m.code IN ('DASHBOARD', 'NURSING_WORKFORCE', 'NURSE_MASTER', 'CREDENTIALS', 'CERTIFICATIONS', 'ADMINISTRATION', 'USER_MANAGEMENT', 'AUDIT_LOGS')
ON CONFLICT (role_code, menu_id) DO UPDATE SET visible = true, enabled = true;

-- COMPLIANCE_OFFICER: Audit + read-only workforce
INSERT INTO rbac.role_menu_access (role_code, menu_id, visible, enabled, assignment_source, status, created_by, updated_by)
SELECT 'COMPLIANCE_OFFICER', m.id, true, true, 'AccessLevelDefault', 'Active', 1, 1 FROM rbac.menus m 
WHERE m.code IN ('DASHBOARD', 'NURSING_WORKFORCE', 'NURSE_MASTER', 'CREDENTIALS', 'CERTIFICATIONS', 'WORKFORCE_ANALYTICS', 'ADMINISTRATION', 'AUDIT_LOGS')
ON CONFLICT (role_code, menu_id) DO UPDATE SET visible = true, enabled = true;

-- READONLY_USER: Only dashboard + roster view
INSERT INTO rbac.role_menu_access (role_code, menu_id, visible, enabled, assignment_source, status, created_by, updated_by)
SELECT 'READONLY_USER', m.id, true, true, 'AccessLevelDefault', 'Active', 1, 1 FROM rbac.menus m 
WHERE m.code IN ('DASHBOARD', 'NURSE_ROSTER')
ON CONFLICT (role_code, menu_id) DO UPDATE SET visible = true, enabled = true;

-- ============================================================================
-- ROLE PERMISSIONS CONFIGURATION
-- ============================================================================

-- SYSTEM_ADMIN: All permissions on all accessible menus
INSERT INTO rbac.role_permissions (role_code, menu_id, permission_id, allowed, source, status, created_by, updated_by)
SELECT 'SYSTEM_ADMIN', m.id, p.id, true, 'SystemDefault', 'Active', 1, 1
FROM rbac.menus m CROSS JOIN rbac.permissions p WHERE m.status = 'Active' AND p.status = 'Active'
ON CONFLICT (role_code, menu_id, permission_id) DO UPDATE SET allowed = true;

-- NURSE_MANAGER: VIEW, CREATE, EDIT, APPROVE, ASSIGN, EXPORT, REVIEW on clinical; no DELETE/MANAGE except user management
INSERT INTO rbac.role_permissions (role_code, menu_id, permission_id, allowed, source, status, created_by, updated_by)
SELECT 'NURSE_MANAGER', m.id, p.id, true, 'AccessLevelDefault', 'Active', 1, 1
FROM rbac.menus m CROSS JOIN rbac.permissions p
WHERE m.code IN ('DASHBOARD', 'NURSING_WORKFORCE', 'NURSE_MASTER', 'CREDENTIALS', 'CERTIFICATIONS', 'SCHEDULING', 'NURSE_ROSTER', 'LEAVE_MANAGEMENT', 'WORKFORCE_ANALYTICS')
AND p.code IN ('VIEW', 'CREATE', 'EDIT', 'APPROVE', 'ASSIGN', 'EXPORT', 'REVIEW', 'SUBMIT', 'VERIFY')
ON CONFLICT (role_code, menu_id, permission_id) DO UPDATE SET allowed = true;

INSERT INTO rbac.role_permissions (role_code, menu_id, permission_id, allowed, source, status, created_by, updated_by)
SELECT 'NURSE_MANAGER', m.id, p.id, true, 'AccessLevelDefault', 'Active', 1, 1
FROM rbac.menus m CROSS JOIN rbac.permissions p
WHERE m.code = 'USER_MANAGEMENT' AND p.code IN ('VIEW', 'CREATE', 'EDIT')
ON CONFLICT (role_code, menu_id, permission_id) DO UPDATE SET allowed = true;

-- CHARGE_NURSE: VIEW, CREATE, EDIT, ASSIGN, EXPORT, SUBMIT on roster and nurse master; no DELETE, no MANAGE
INSERT INTO rbac.role_permissions (role_code, menu_id, permission_id, allowed, source, status, created_by, updated_by)
SELECT 'CHARGE_NURSE', m.id, p.id, true, 'AccessLevelDefault', 'Active', 1, 1
FROM rbac.menus m CROSS JOIN rbac.permissions p
WHERE m.code IN ('NURSE_MASTER', 'NURSE_ROSTER', 'LEAVE_MANAGEMENT') AND p.code IN ('VIEW', 'CREATE', 'EDIT', 'ASSIGN', 'EXPORT', 'SUBMIT', 'REVIEW')
ON CONFLICT (role_code, menu_id, permission_id) DO UPDATE SET allowed = true;

INSERT INTO rbac.role_permissions (role_code, menu_id, permission_id, allowed, source, status, created_by, updated_by)
SELECT 'CHARGE_NURSE', m.id, p.id, true, 'AccessLevelDefault', 'Active', 1, 1
FROM rbac.menus m CROSS JOIN rbac.permissions p
WHERE m.code IN ('DASHBOARD', 'CREDENTIALS', 'CERTIFICATIONS', 'WORKFORCE_ANALYTICS') AND p.code = 'VIEW'
ON CONFLICT (role_code, menu_id, permission_id) DO UPDATE SET allowed = true;

-- RN: VIEW roster, CREATE/EDIT leave request, VIEW nurse master
INSERT INTO rbac.role_permissions (role_code, menu_id, permission_id, allowed, source, status, created_by, updated_by)
SELECT 'RN', m.id, p.id, true, 'AccessLevelDefault', 'Active', 1, 1
FROM rbac.menus m CROSS JOIN rbac.permissions p
WHERE m.code = 'NURSE_ROSTER' AND p.code IN ('VIEW', 'EXPORT')
ON CONFLICT (role_code, menu_id, permission_id) DO UPDATE SET allowed = true;

INSERT INTO rbac.role_permissions (role_code, menu_id, permission_id, allowed, source, status, created_by, updated_by)
SELECT 'RN', m.id, p.id, true, 'AccessLevelDefault', 'Active', 1, 1
FROM rbac.menus m CROSS JOIN rbac.permissions p
WHERE m.code = 'LEAVE_MANAGEMENT' AND p.code IN ('VIEW', 'CREATE', 'EDIT', 'SUBMIT')
ON CONFLICT (role_code, menu_id, permission_id) DO UPDATE SET allowed = true;

INSERT INTO rbac.role_permissions (role_code, menu_id, permission_id, allowed, source, status, created_by, updated_by)
SELECT 'RN', m.id, p.id, true, 'AccessLevelDefault', 'Active', 1, 1
FROM rbac.menus m CROSS JOIN rbac.permissions p
WHERE m.code IN ('DASHBOARD', 'NURSE_MASTER') AND p.code = 'VIEW'
ON CONFLICT (role_code, menu_id, permission_id) DO UPDATE SET allowed = true;

-- LPN: Similar to RN
INSERT INTO rbac.role_permissions (role_code, menu_id, permission_id, allowed, source, status, created_by, updated_by)
SELECT 'LPN', m.id, p.id, true, 'AccessLevelDefault', 'Active', 1, 1
FROM rbac.menus m CROSS JOIN rbac.permissions p
WHERE m.code = 'NURSE_ROSTER' AND p.code IN ('VIEW')
ON CONFLICT (role_code, menu_id, permission_id) DO UPDATE SET allowed = true;

INSERT INTO rbac.role_permissions (role_code, menu_id, permission_id, allowed, source, status, created_by, updated_by)
SELECT 'LPN', m.id, p.id, true, 'AccessLevelDefault', 'Active', 1, 1
FROM rbac.menus m CROSS JOIN rbac.permissions p
WHERE m.code = 'LEAVE_MANAGEMENT' AND p.code IN ('VIEW', 'CREATE', 'SUBMIT')
ON CONFLICT (role_code, menu_id, permission_id) DO UPDATE SET allowed = true;

INSERT INTO rbac.role_permissions (role_code, menu_id, permission_id, allowed, source, status, created_by, updated_by)
SELECT 'LPN', m.id, p.id, true, 'AccessLevelDefault', 'Active', 1, 1
FROM rbac.menus m CROSS JOIN rbac.permissions p
WHERE m.code = 'DASHBOARD' AND p.code = 'VIEW'
ON CONFLICT (role_code, menu_id, permission_id) DO UPDATE SET allowed = true;

-- CNA: VIEW only
INSERT INTO rbac.role_permissions (role_code, menu_id, permission_id, allowed, source, status, created_by, updated_by)
SELECT 'CNA', m.id, p.id, true, 'AccessLevelDefault', 'Active', 1, 1
FROM rbac.menus m CROSS JOIN rbac.permissions p
WHERE m.code IN ('DASHBOARD', 'NURSE_ROSTER') AND p.code = 'VIEW'
ON CONFLICT (role_code, menu_id, permission_id) DO UPDATE SET allowed = true;

INSERT INTO rbac.role_permissions (role_code, menu_id, permission_id, allowed, source, status, created_by, updated_by)
SELECT 'CNA', m.id, p.id, true, 'AccessLevelDefault', 'Active', 1, 1
FROM rbac.menus m CROSS JOIN rbac.permissions p
WHERE m.code = 'LEAVE_MANAGEMENT' AND p.code IN ('VIEW', 'CREATE', 'SUBMIT')
ON CONFLICT (role_code, menu_id, permission_id) DO UPDATE SET allowed = true;

-- SCHEDULER: Full on scheduling
INSERT INTO rbac.role_permissions (role_code, menu_id, permission_id, allowed, source, status, created_by, updated_by)
SELECT 'SCHEDULER', m.id, p.id, true, 'AccessLevelDefault', 'Active', 1, 1
FROM rbac.menus m CROSS JOIN rbac.permissions p
WHERE m.code IN ('NURSE_ROSTER', 'LEAVE_MANAGEMENT') AND p.code IN ('VIEW', 'CREATE', 'EDIT', 'ASSIGN', 'APPROVE', 'REJECT', 'EXPORT')
ON CONFLICT (role_code, menu_id, permission_id) DO UPDATE SET allowed = true;

INSERT INTO rbac.role_permissions (role_code, menu_id, permission_id, allowed, source, status, created_by, updated_by)
SELECT 'SCHEDULER', m.id, p.id, true, 'AccessLevelDefault', 'Active', 1, 1
FROM rbac.menus m CROSS JOIN rbac.permissions p
WHERE m.code IN ('DASHBOARD', 'NURSE_MASTER', 'WORKFORCE_ANALYTICS') AND p.code IN ('VIEW', 'EXPORT')
ON CONFLICT (role_code, menu_id, permission_id) DO UPDATE SET allowed = true;

-- HR_ADMIN: User management + credentials
INSERT INTO rbac.role_permissions (role_code, menu_id, permission_id, allowed, source, status, created_by, updated_by)
SELECT 'HR_ADMIN', m.id, p.id, true, 'AccessLevelDefault', 'Active', 1, 1
FROM rbac.menus m CROSS JOIN rbac.permissions p
WHERE m.code IN ('USER_MANAGEMENT', 'CREDENTIALS', 'CERTIFICATIONS', 'NURSE_MASTER') AND p.code IN ('VIEW', 'CREATE', 'EDIT', 'VERIFY', 'EXPORT')
ON CONFLICT (role_code, menu_id, permission_id) DO UPDATE SET allowed = true;

-- COMPLIANCE_OFFICER: VIEW + EXPORT + REVIEW
INSERT INTO rbac.role_permissions (role_code, menu_id, permission_id, allowed, source, status, created_by, updated_by)
SELECT 'COMPLIANCE_OFFICER', m.id, p.id, true, 'AccessLevelDefault', 'Active', 1, 1
FROM rbac.menus m CROSS JOIN rbac.permissions p
WHERE m.code IN ('DASHBOARD', 'NURSE_MASTER', 'CREDENTIALS', 'CERTIFICATIONS', 'WORKFORCE_ANALYTICS', 'AUDIT_LOGS') AND p.code IN ('VIEW', 'EXPORT', 'REVIEW')
ON CONFLICT (role_code, menu_id, permission_id) DO UPDATE SET allowed = true;

-- READONLY_USER: VIEW only on dashboard and roster
INSERT INTO rbac.role_permissions (role_code, menu_id, permission_id, allowed, source, status, created_by, updated_by)
SELECT 'READONLY_USER', m.id, p.id, true, 'AccessLevelDefault', 'Active', 1, 1
FROM rbac.menus m CROSS JOIN rbac.permissions p
WHERE m.code IN ('DASHBOARD', 'NURSE_ROSTER') AND p.code = 'VIEW'
ON CONFLICT (role_code, menu_id, permission_id) DO UPDATE SET allowed = true;

-- ============================================================================
-- DATA SCOPES - Assign realistic scopes
-- ============================================================================

-- Get IDs
-- All users get Hospital scope = Central Hospital
INSERT INTO rbac.user_data_scopes (user_id, scope_type, organization_id, status, created_by, updated_by)
SELECT u.id, 'Hospital', o.id, 'Active', 1, 1
FROM auth.users u CROSS JOIN rbac.organizations o WHERE o.code = 'CENTRAL_HOSP' AND u.username = 'admin.system'
ON CONFLICT DO NOTHING;

-- Nurse Manager gets Department scope (all ICU)
INSERT INTO rbac.user_data_scopes (user_id, scope_type, organization_id, department_id, status, created_by, updated_by)
SELECT u.id, 'Department', o.id, d.id, 'Active', 1, 1
FROM auth.users u, rbac.organizations o, rbac.departments d
WHERE u.username = 'susan.lee' AND o.code = 'CENTRAL_HOSP' AND d.code = 'ICU' AND d.organization_id = o.id
ON CONFLICT DO NOTHING;

-- Charge Nurse and clinical staff get NursingUnit scope ICU_A
INSERT INTO rbac.user_data_scopes (user_id, scope_type, organization_id, department_id, nursing_unit_id, status, created_by, updated_by)
SELECT u.id, 'NursingUnit', o.id, d.id, nu.id, 'Active', 1, 1
FROM auth.users u, rbac.organizations o, rbac.departments d, rbac.nursing_units nu
WHERE u.username IN ('james.wilson', 'maria.garcia', 'ahmed.hassan', 'jennifer.smith', 'david.kim')
AND o.code = 'CENTRAL_HOSP' AND d.code = 'ICU' AND nu.code = 'ICU_A'
AND d.organization_id = o.id AND nu.department_id = d.id
ON CONFLICT DO NOTHING;

-- Scheduler gets Hospital scope
INSERT INTO rbac.user_data_scopes (user_id, scope_type, organization_id, status, created_by, updated_by)
SELECT u.id, 'Hospital', o.id, 'Active', 1, 1
FROM auth.users u CROSS JOIN rbac.organizations o WHERE o.code = 'CENTRAL_HOSP' AND u.username = 'rachel.brown'
ON CONFLICT DO NOTHING;

-- HR and Compliance get All scope
INSERT INTO rbac.user_data_scopes (user_id, scope_type, status, created_by, updated_by)
SELECT u.id, 'All', 'Active', 1, 1 FROM auth.users u WHERE u.username IN ('patricia.johnson', 'michael.wong')
ON CONFLICT DO NOTHING;

-- Validation counts
SELECT 'Role Menu Access: ' || COUNT(*) FROM rbac.role_menu_access
UNION ALL
SELECT 'Role Permissions: ' || COUNT(*) FROM rbac.role_permissions
UNION ALL
SELECT 'Data Scopes: ' || COUNT(*) FROM rbac.user_data_scopes;

SELECT 'V2_4__seed_rbac_configuration completed' as status;
