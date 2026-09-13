-- ============================================================================
-- V1_0__initial_schema.sql - Foundation Schema
-- Database: hospital_rbac_dev
-- Purpose: Create schemas, extensions, enums, and base tables
-- ============================================================================

-- Create schemas
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS rbac;
CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS system;

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Create types (enums)
DO $$ BEGIN
  CREATE TYPE auth.user_status AS ENUM ('Active', 'Inactive', 'Suspended', 'PendingVerification');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE auth.session_status AS ENUM ('Active', 'Expired', 'Revoked', 'Locked');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE rbac.access_level_status AS ENUM ('Active', 'Inactive');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE rbac.menu_behavior AS ENUM ('Visible', 'Hidden', 'Configurable');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE rbac.assignment_source AS ENUM ('AccessLevelDefault', 'ManualOverride', 'SystemDefault');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE rbac.permission_category AS ENUM ('Standard', 'Administrative', 'Workflow', 'Sensitive');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE rbac.permission_risk AS ENUM ('Low', 'Medium', 'High', 'Critical');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE rbac.scope_type AS ENUM ('Hospital', 'Department', 'NursingUnit', 'Post', 'Shift', 'Assigned', 'All');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE audit.audit_status AS ENUM ('Success', 'Failure', 'Denied');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ============================================================================
-- AUTH TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS auth.users (
  id BIGSERIAL PRIMARY KEY,
  username VARCHAR(100) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  status VARCHAR(50) DEFAULT 'Active',
  email_verified BOOLEAN DEFAULT FALSE,
  email_verified_at TIMESTAMP,
  last_login_at TIMESTAMP,
  last_password_change_at TIMESTAMP,
  failed_login_attempts INT DEFAULT 0,
  locked_until TIMESTAMP,
  created_by BIGINT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_by BIGINT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_username ON auth.users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON auth.users(email);
CREATE INDEX IF NOT EXISTS idx_users_status ON auth.users(status);

CREATE TABLE IF NOT EXISTS auth.sessions (
  id VARCHAR(100) PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ip_address VARCHAR(45) NOT NULL,
  user_agent VARCHAR(500),
  login_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_activity_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  absolute_timeout_at TIMESTAMP NOT NULL,
  status VARCHAR(50) DEFAULT 'Active',
  revoked_at TIMESTAMP,
  revoked_reason VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON auth.sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON auth.sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON auth.sessions(expires_at);

-- ============================================================================
-- RBAC TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS rbac.organizations (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(255) UNIQUE NOT NULL,
  code VARCHAR(50) UNIQUE NOT NULL,
  address TEXT,
  city VARCHAR(100),
  state VARCHAR(50),
  country VARCHAR(100),
  status VARCHAR(50) DEFAULT 'Active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rbac.departments (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES rbac.organizations(id),
  name VARCHAR(255) NOT NULL,
  code VARCHAR(50) NOT NULL,
  status VARCHAR(50) DEFAULT 'Active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uk_departments_org_code UNIQUE (organization_id, code)
);

CREATE TABLE IF NOT EXISTS rbac.nursing_units (
  id BIGSERIAL PRIMARY KEY,
  department_id BIGINT NOT NULL REFERENCES rbac.departments(id),
  name VARCHAR(255) NOT NULL,
  code VARCHAR(50) NOT NULL,
  unit_type VARCHAR(100),
  capacity INT,
  status VARCHAR(50) DEFAULT 'Active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uk_nursing_units_dept_code UNIQUE (department_id, code)
);

CREATE TABLE IF NOT EXISTS rbac.posts (
  id BIGSERIAL PRIMARY KEY,
  nursing_unit_id BIGINT NOT NULL REFERENCES rbac.nursing_units(id),
  name VARCHAR(255) NOT NULL,
  code VARCHAR(50) NOT NULL,
  post_type VARCHAR(100),
  status VARCHAR(50) DEFAULT 'Active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uk_posts_unit_code UNIQUE (nursing_unit_id, code)
);

CREATE TABLE IF NOT EXISTS rbac.shifts (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  code VARCHAR(50) UNIQUE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  description TEXT,
  status VARCHAR(50) DEFAULT 'Active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rbac.access_levels (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(255) UNIQUE NOT NULL,
  description TEXT NOT NULL,
  priority INT NOT NULL DEFAULT 50,
  auto_assign BOOLEAN DEFAULT FALSE,
  override_allowed BOOLEAN DEFAULT TRUE,
  default_menu_behavior VARCHAR(50) DEFAULT 'Configurable',
  default_permission_set JSONB,
  default_data_scope_rule JSONB,
  status VARCHAR(50) DEFAULT 'Active',
  created_by BIGINT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_by BIGINT NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rbac.menus (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(100) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  parent_menu_id BIGINT REFERENCES rbac.menus(id),
  display_order INT DEFAULT 0,
  route VARCHAR(500),
  icon VARCHAR(100),
  is_functional BOOLEAN DEFAULT TRUE,
  is_external_link BOOLEAN DEFAULT FALSE,
  external_url VARCHAR(500),
  access_level VARCHAR(50) DEFAULT 'Standard',
  auto_assign BOOLEAN DEFAULT FALSE,
  status VARCHAR(50) DEFAULT 'Active',
  created_by BIGINT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_by BIGINT NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_menu_not_own_parent CHECK (id != parent_menu_id)
);

CREATE INDEX IF NOT EXISTS idx_menus_parent ON rbac.menus(parent_menu_id);
CREATE INDEX IF NOT EXISTS idx_menus_code ON rbac.menus(code);
CREATE INDEX IF NOT EXISTS idx_menus_status ON rbac.menus(status);

CREATE TABLE IF NOT EXISTS rbac.permissions (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(255) UNIQUE NOT NULL,
  description TEXT NOT NULL,
  category VARCHAR(50) DEFAULT 'Standard',
  risk_level VARCHAR(50) DEFAULT 'Medium',
  status VARCHAR(50) DEFAULT 'Active',
  created_by BIGINT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_by BIGINT NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Legacy tables for V1 compatibility - will be migrated in V2
CREATE TABLE IF NOT EXISTS rbac.role_menu_access (
  id BIGSERIAL PRIMARY KEY,
  role_id VARCHAR(50) NOT NULL,
  menu_id BIGINT NOT NULL REFERENCES rbac.menus(id),
  visible BOOLEAN DEFAULT FALSE,
  enabled BOOLEAN DEFAULT FALSE,
  assignment_source VARCHAR(50) DEFAULT 'AccessLevelDefault',
  override_flag BOOLEAN DEFAULT FALSE,
  effective_from TIMESTAMP,
  effective_to TIMESTAMP,
  status VARCHAR(50) DEFAULT 'Active',
  created_by BIGINT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_by BIGINT NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uk_role_menu_access UNIQUE (role_id, menu_id),
  CONSTRAINT chk_role_menu_effective_dates CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_from <= effective_to)
);

CREATE TABLE IF NOT EXISTS rbac.role_permissions (
  id BIGSERIAL PRIMARY KEY,
  role_id VARCHAR(50) NOT NULL,
  menu_id BIGINT NOT NULL REFERENCES rbac.menus(id),
  permission_id BIGINT NOT NULL REFERENCES rbac.permissions(id),
  allowed BOOLEAN DEFAULT FALSE,
  source VARCHAR(50) DEFAULT 'AccessLevelDefault',
  override_flag BOOLEAN DEFAULT FALSE,
  effective_from TIMESTAMP,
  effective_to TIMESTAMP,
  status VARCHAR(50) DEFAULT 'Active',
  created_by BIGINT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_by BIGINT NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uk_role_permissions UNIQUE (role_id, menu_id, permission_id),
  CONSTRAINT chk_role_permissions_effective_dates CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_from <= effective_to)
);

CREATE TABLE IF NOT EXISTS rbac.user_data_scopes (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scope_type VARCHAR(50) NOT NULL,
  organization_id BIGINT REFERENCES rbac.organizations(id),
  department_id BIGINT REFERENCES rbac.departments(id),
  nursing_unit_id BIGINT REFERENCES rbac.nursing_units(id),
  post_id BIGINT REFERENCES rbac.posts(id),
  shift_id BIGINT REFERENCES rbac.shifts(id),
  assignment_rule VARCHAR(255),
  assignment_rule_config JSONB,
  effective_from TIMESTAMP,
  effective_to TIMESTAMP,
  status VARCHAR(50) DEFAULT 'Active',
  created_by BIGINT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_by BIGINT NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_user_data_scope_effective_dates CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_from <= effective_to)
);

CREATE INDEX IF NOT EXISTS idx_user_data_scopes_user ON rbac.user_data_scopes(user_id);
CREATE INDEX IF NOT EXISTS idx_user_data_scopes_active ON rbac.user_data_scopes(user_id, status) WHERE status = 'Active';

-- ============================================================================
-- AUDIT TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS audit.audit_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES auth.users(id),
  username VARCHAR(100),
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(100) NOT NULL,
  entity_id BIGINT,
  entity_code VARCHAR(255),
  description TEXT,
  changes JSONB,
  reason VARCHAR(500),
  ip_address VARCHAR(45),
  user_agent VARCHAR(500),
  session_id VARCHAR(100),
  request_id VARCHAR(100),
  status VARCHAR(50) DEFAULT 'Success',
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit.audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit.audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_type ON audit.audit_logs(entity_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit.audit_logs(created_at DESC);

-- Enable RLS for immutability
ALTER TABLE audit.audit_logs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY audit_logs_no_delete ON audit.audit_logs AS RESTRICTIVE FOR DELETE USING (FALSE);
EXCEPTION WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
  CREATE POLICY audit_logs_no_update ON audit.audit_logs AS RESTRICTIVE FOR UPDATE USING (FALSE);
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Seed initial access levels
INSERT INTO rbac.access_levels (code, name, description, priority, auto_assign, override_allowed, default_menu_behavior, status, created_by, updated_by)
VALUES
  ('FULL', 'Full', 'Complete system administration access', 1, FALSE, TRUE, 'Visible', 'Active', 1, 1),
  ('MGMT', 'Management', 'Management and supervision access', 2, FALSE, TRUE, 'Visible', 'Active', 1, 1),
  ('STD', 'Standard', 'Standard operational access', 3, TRUE, TRUE, 'Configurable', 'Active', 1, 1),
  ('READ', 'Read Only', 'View-only access', 4, TRUE, FALSE, 'Visible', 'Active', 1, 1),
  ('RESTRICTED', 'Restricted', 'Explicitly configured restricted access', 5, FALSE, TRUE, 'Hidden', 'Active', 1, 1)
ON CONFLICT (code) DO NOTHING;

-- Seed initial permissions
INSERT INTO rbac.permissions (code, name, description, category, risk_level, status, created_by, updated_by) VALUES
  ('VIEW', 'View', 'Read/view authorized records', 'Standard', 'Low', 'Active', 1, 1),
  ('CREATE', 'Create', 'Create new records', 'Standard', 'Medium', 'Active', 1, 1),
  ('EDIT', 'Edit', 'Modify existing records', 'Standard', 'Medium', 'Active', 1, 1),
  ('DELETE', 'Delete', 'Delete or logically remove records', 'Sensitive', 'High', 'Active', 1, 1),
  ('APPROVE', 'Approve', 'Approve workflow transactions', 'Workflow', 'High', 'Active', 1, 1),
  ('EXPORT', 'Export', 'Export authorized information', 'Standard', 'Medium', 'Active', 1, 1),
  ('MANAGE', 'Manage', 'Administrative/configuration-level control', 'Administrative', 'Critical', 'Active', 1, 1),
  ('ASSIGN', 'Assign', 'Assign resources to staff', 'Standard', 'Medium', 'Active', 1, 1),
  ('VERIFY', 'Verify', 'Verify credentials or qualifications', 'Workflow', 'High', 'Active', 1, 1),
  ('SUBMIT', 'Submit', 'Submit requests for processing', 'Standard', 'Low', 'Active', 1, 1),
  ('REJECT', 'Reject', 'Reject submitted requests', 'Workflow', 'Medium', 'Active', 1, 1),
  ('REVIEW', 'Review', 'Review submitted items', 'Standard', 'Medium', 'Active', 1, 1)
ON CONFLICT (code) DO NOTHING;

SELECT 'V1_0__initial_schema completed' as status;
