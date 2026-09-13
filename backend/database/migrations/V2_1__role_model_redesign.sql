-- ============================================================================
-- V2_1__role_model_redesign.sql - Hospital Roles & Many-to-Many Assignments
-- ============================================================================

-- Create hospital_roles table
CREATE TABLE IF NOT EXISTS system.hospital_roles (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT NOT NULL,
  category VARCHAR(50) NOT NULL CHECK (category IN ('Clinical', 'Administrative', 'System', 'Support')),
  department VARCHAR(100),
  assignable_by_roles VARCHAR(50)[] DEFAULT ARRAY['SYSTEM_ADMIN'],
  is_exclusive BOOLEAN DEFAULT TRUE,
  status VARCHAR(50) DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive', 'Deprecated')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by BIGINT,
  updated_by BIGINT
);

CREATE INDEX IF NOT EXISTS idx_hospital_roles_code ON system.hospital_roles(code);
CREATE INDEX IF NOT EXISTS idx_hospital_roles_category ON system.hospital_roles(category);
CREATE INDEX IF NOT EXISTS idx_hospital_roles_status ON system.hospital_roles(status);

-- Create user_role_assignments table
CREATE TABLE IF NOT EXISTS auth.user_role_assignments (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role_id BIGINT NOT NULL REFERENCES system.hospital_roles(id) ON DELETE RESTRICT,
  assigned_by BIGINT NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  effective_from TIMESTAMP,
  effective_to TIMESTAMP,
  reason TEXT,
  status VARCHAR(50) DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive', 'Pending', 'Rejected')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uk_user_role_assignments UNIQUE (user_id, role_id),
  CONSTRAINT chk_user_role_effective_dates CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_from <= effective_to)
);

CREATE INDEX IF NOT EXISTS idx_user_role_assignments_user ON auth.user_role_assignments(user_id, status);
CREATE INDEX IF NOT EXISTS idx_user_role_assignments_role ON auth.user_role_assignments(role_id, status);
CREATE INDEX IF NOT EXISTS idx_user_role_assignments_effective ON auth.user_role_assignments(effective_from, effective_to);
CREATE INDEX IF NOT EXISTS idx_user_role_assignments_active ON auth.user_role_assignments(user_id, status, effective_from, effective_to);

-- Update users table - add primary_role_id, keep old columns for migration phase
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS primary_role_id BIGINT REFERENCES system.hospital_roles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_users_primary_role ON auth.users(primary_role_id);

-- Create views
CREATE OR REPLACE VIEW auth.vw_user_current_roles AS
SELECT 
  u.id as user_id,
  u.username,
  u.email,
  u.full_name,
  hr.id as role_id,
  hr.code as role_code,
  hr.name as role_name,
  hr.category as role_category,
  hr.department,
  ura.assigned_by,
  ura.reason,
  ura.effective_from,
  ura.effective_to,
  (u.primary_role_id = hr.id) as is_primary,
  (ura.status = 'Active' 
    AND (ura.effective_from IS NULL OR ura.effective_from <= CURRENT_TIMESTAMP)
    AND (ura.effective_to IS NULL OR ura.effective_to >= CURRENT_TIMESTAMP)) as is_currently_active,
  u.status as user_status,
  hr.status as role_status
FROM auth.users u
LEFT JOIN auth.user_role_assignments ura ON ura.user_id = u.id
LEFT JOIN system.hospital_roles hr ON hr.id = ura.role_id
WHERE u.status = 'Active';

-- Helper functions
CREATE OR REPLACE FUNCTION auth.get_user_primary_role(p_user_id BIGINT)
RETURNS VARCHAR(50) AS $$
DECLARE
  v_role_code VARCHAR(50);
BEGIN
  SELECT hr.code INTO v_role_code
  FROM auth.users u
  LEFT JOIN system.hospital_roles hr ON hr.id = u.primary_role_id
  WHERE u.id = p_user_id AND u.status = 'Active'
  LIMIT 1;
  RETURN COALESCE(v_role_code, 'READONLY_USER');
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION auth.get_user_all_roles(p_user_id BIGINT)
RETURNS TABLE (
  role_id BIGINT,
  role_code VARCHAR(50),
  role_name VARCHAR(100),
  category VARCHAR(50),
  is_primary BOOLEAN,
  effective_from TIMESTAMP,
  effective_to TIMESTAMP
) AS $$
DECLARE
  v_now TIMESTAMP := CURRENT_TIMESTAMP;
BEGIN
  RETURN QUERY
  SELECT 
    hr.id,
    hr.code,
    hr.name,
    hr.category,
    (u.primary_role_id = hr.id),
    ura.effective_from,
    ura.effective_to
  FROM auth.users u
  LEFT JOIN auth.user_role_assignments ura ON ura.user_id = u.id AND ura.status = 'Active'
  LEFT JOIN system.hospital_roles hr ON hr.id = ura.role_id
  WHERE u.id = p_user_id
    AND u.status = 'Active'
    AND (ura.effective_from IS NULL OR ura.effective_from <= v_now)
    AND (ura.effective_to IS NULL OR ura.effective_to >= v_now)
    AND hr.status = 'Active';
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION auth.assign_role_to_user(
  p_user_id BIGINT,
  p_role_code VARCHAR(50),
  p_assigned_by BIGINT,
  p_reason TEXT,
  p_effective_from TIMESTAMP DEFAULT NULL,
  p_effective_to TIMESTAMP DEFAULT NULL
)
RETURNS TABLE (
  success BOOLEAN,
  message VARCHAR(500),
  assignment_id BIGINT
) AS $$
DECLARE
  v_role_id BIGINT;
  v_assignment_id BIGINT;
  v_assigner_role VARCHAR(50);
BEGIN
  SELECT id INTO v_role_id FROM system.hospital_roles WHERE code = p_role_code AND status = 'Active';
  IF v_role_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Role does not exist or is inactive'::VARCHAR(500), NULL::BIGINT;
    RETURN;
  END IF;

  SELECT hr.code INTO v_assigner_role FROM auth.users u LEFT JOIN system.hospital_roles hr ON hr.id = u.primary_role_id WHERE u.id = p_assigned_by;

  -- For initial setup, allow if assigner is SYSTEM_ADMIN or if assigning first admin (bootstrap)
  IF v_assigner_role IS NULL OR v_assigner_role != 'SYSTEM_ADMIN' THEN
    -- Allow bootstrap: if no SYSTEM_ADMIN exists yet, allow first assignment
    IF (SELECT COUNT(*) FROM auth.user_role_assignments ura JOIN system.hospital_roles hr ON hr.id = ura.role_id WHERE hr.code = 'SYSTEM_ADMIN' AND ura.status = 'Active') = 0 THEN
      -- Bootstrap allowed
      NULL;
    ELSE
      -- Check if assigner has SYSTEM_ADMIN role via assignments
      IF NOT EXISTS (
        SELECT 1 FROM auth.user_role_assignments ura JOIN system.hospital_roles hr ON hr.id = ura.role_id
        WHERE ura.user_id = p_assigned_by AND hr.code = 'SYSTEM_ADMIN' AND ura.status = 'Active'
      ) THEN
        RETURN QUERY SELECT FALSE, 'User is not authorized to assign roles'::VARCHAR(500), NULL::BIGINT;
        RETURN;
      END IF;
    END IF;
  END IF;

  INSERT INTO auth.user_role_assignments (user_id, role_id, assigned_by, reason, effective_from, effective_to, status)
  VALUES (p_user_id, v_role_id, p_assigned_by, p_reason, p_effective_from, p_effective_to, 'Active')
  ON CONFLICT (user_id, role_id) DO UPDATE SET status = 'Active', reason = EXCLUDED.reason, updated_at = CURRENT_TIMESTAMP
  RETURNING id INTO v_assignment_id;

  RETURN QUERY SELECT TRUE, 'Role assigned successfully'::VARCHAR(500), v_assignment_id;
END;
$$ LANGUAGE plpgsql;

GRANT SELECT ON system.hospital_roles TO PUBLIC;
GRANT SELECT ON auth.user_role_assignments TO PUBLIC;
GRANT SELECT ON auth.vw_user_current_roles TO PUBLIC;
GRANT EXECUTE ON FUNCTION auth.get_user_primary_role TO PUBLIC;
GRANT EXECUTE ON FUNCTION auth.get_user_all_roles TO PUBLIC;
GRANT EXECUTE ON FUNCTION auth.assign_role_to_user TO PUBLIC;

SELECT 'V2_1__role_model_redesign completed' as status;
