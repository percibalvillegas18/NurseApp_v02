-- ============================================================================
-- V2_0__effective_access_function.sql - Initial Effective Access Implementation
-- This is the V1 version from spec, will be FIXED in V2_5
-- ============================================================================

DROP FUNCTION IF EXISTS rbac.get_access_decision CASCADE;
DROP FUNCTION IF EXISTS rbac.get_user_effective_access CASCADE;
DROP VIEW IF EXISTS rbac.vw_user_effective_access CASCADE;
DROP MATERIALIZED VIEW IF EXISTS rbac.mv_user_effective_access CASCADE;
DROP VIEW IF EXISTS rbac.vw_current_access_decisions CASCADE;
DROP FUNCTION IF EXISTS rbac.evaluate_access CASCADE;
DROP FUNCTION IF EXISTS rbac.get_user_full_access CASCADE;
DROP FUNCTION IF EXISTS rbac.preview_access_change CASCADE;

-- ============================================================================
-- FUNCTION 1: PRIMARY AUTHORIZATION DECISION ENGINE (V2 initial)
-- ============================================================================

CREATE OR REPLACE FUNCTION rbac.evaluate_access(
  p_user_id BIGINT,
  p_menu_code VARCHAR(100),
  p_permission_code VARCHAR(50),
  p_resource_id BIGINT DEFAULT NULL
)
RETURNS TABLE (
  decision VARCHAR(50),
  reason VARCHAR(500),
  menu_accessible BOOLEAN,
  permission_granted BOOLEAN,
  data_scope_valid BOOLEAN,
  cache_ttl INT,
  evaluated_at TIMESTAMP,
  user_role VARCHAR(50)
) AS $$
DECLARE
  v_user_status VARCHAR(50);
  v_user_primary_role_id BIGINT;
  v_user_primary_role_code VARCHAR(50);
  v_now TIMESTAMP := CURRENT_TIMESTAMP;
  v_menu_id BIGINT;
  v_menu_status VARCHAR(50);
  v_menu_visible BOOLEAN := FALSE;
  v_menu_enabled BOOLEAN := FALSE;
  v_menu_effective_from TIMESTAMP;
  v_menu_effective_to TIMESTAMP;
  v_menu_found BOOLEAN := FALSE;
  v_perm_id BIGINT;
  v_perm_status VARCHAR(50);
  v_perm_allowed BOOLEAN := FALSE;
  v_perm_effective_from TIMESTAMP;
  v_perm_effective_to TIMESTAMP;
  v_perm_found BOOLEAN := FALSE;
  v_scope_valid BOOLEAN := FALSE;
  v_scope_count INT := 0;
  v_decision VARCHAR(50) := 'DENY';
  v_reason VARCHAR(500) := 'Authorization check failed';
  v_cache_ttl INT := 300;
BEGIN
  -- STEP 1: VALIDATE USER
  SELECT u.status, u.primary_role_id, hr.code
  INTO v_user_status, v_user_primary_role_id, v_user_primary_role_code
  FROM auth.users u
  LEFT JOIN system.hospital_roles hr ON hr.id = u.primary_role_id
  WHERE u.id = p_user_id;

  IF v_user_status IS NULL THEN
    RETURN QUERY SELECT 'DENY'::VARCHAR(50), 'User not found'::VARCHAR(500), FALSE, FALSE, FALSE, 300, v_now, NULL::VARCHAR(50);
    RETURN;
  END IF;

  IF v_user_status != 'Active' THEN
    RETURN QUERY SELECT 'DENY'::VARCHAR(50), ('User status is ' || v_user_status || ', not Active')::VARCHAR(500), FALSE, FALSE, FALSE, 300, v_now, v_user_primary_role_code;
    RETURN;
  END IF;

  IF v_user_primary_role_code IS NULL THEN
    -- Try to get from assignments if primary_role_id not set yet (backward compat)
    SELECT hr.code INTO v_user_primary_role_code
    FROM auth.user_role_assignments ura
    JOIN system.hospital_roles hr ON hr.id = ura.role_id
    WHERE ura.user_id = p_user_id AND ura.status = 'Active'
    LIMIT 1;

    IF v_user_primary_role_code IS NULL THEN
      RETURN QUERY SELECT 'DENY'::VARCHAR(50), 'User has no assigned primary role'::VARCHAR(500), FALSE, FALSE, FALSE, 300, v_now, NULL::VARCHAR(50);
      RETURN;
    END IF;
  END IF;

  -- STEP 2: VALIDATE MENU
  SELECT id, status INTO v_menu_id, v_menu_status FROM rbac.menus WHERE code = p_menu_code;

  IF v_menu_id IS NULL THEN
    RETURN QUERY SELECT 'DENY'::VARCHAR(50), ('Menu "' || p_menu_code || '" not found')::VARCHAR(500), FALSE, FALSE, FALSE, 300, v_now, v_user_primary_role_code;
    RETURN;
  END IF;

  IF v_menu_status != 'Active' THEN
    RETURN QUERY SELECT 'DENY'::VARCHAR(50), 'Menu is inactive'::VARCHAR(500), FALSE, FALSE, FALSE, 300, v_now, v_user_primary_role_code;
    RETURN;
  END IF;

  -- STEP 3: CHECK ROLE-MENU ACCESS
  SELECT rma.visible, rma.enabled, rma.effective_from, rma.effective_to
  INTO v_menu_visible, v_menu_enabled, v_menu_effective_from, v_menu_effective_to
  FROM rbac.role_menu_access rma
  WHERE rma.role_code = v_user_primary_role_code AND rma.menu_id = v_menu_id AND rma.status = 'Active';

  IF FOUND THEN
    v_menu_found := TRUE;
    IF v_menu_effective_from IS NOT NULL AND v_now < v_menu_effective_from THEN
      v_menu_visible := FALSE; v_menu_enabled := FALSE;
    END IF;
    IF v_menu_effective_to IS NOT NULL AND v_now > v_menu_effective_to THEN
      v_menu_visible := FALSE; v_menu_enabled := FALSE;
    END IF;
  ELSE
    v_menu_found := FALSE; v_menu_visible := FALSE; v_menu_enabled := FALSE;
  END IF;

  IF NOT (v_menu_visible AND v_menu_enabled) THEN
    RETURN QUERY SELECT 'DENY'::VARCHAR(50), ('Menu not accessible (visible=' || v_menu_visible::TEXT || ', enabled=' || v_menu_enabled::TEXT || ')')::VARCHAR(500), v_menu_visible, FALSE, FALSE, 1800, v_now, v_user_primary_role_code;
    RETURN;
  END IF;

  -- STEP 4: VALIDATE PERMISSION
  SELECT id, status INTO v_perm_id, v_perm_status FROM rbac.permissions WHERE code = p_permission_code;

  IF v_perm_id IS NULL THEN
    RETURN QUERY SELECT 'DENY'::VARCHAR(50), ('Permission "' || p_permission_code || '" not found')::VARCHAR(500), TRUE, FALSE, FALSE, 1800, v_now, v_user_primary_role_code;
    RETURN;
  END IF;

  IF v_perm_status != 'Active' THEN
    RETURN QUERY SELECT 'DENY'::VARCHAR(50), 'Permission is inactive'::VARCHAR(500), TRUE, FALSE, FALSE, 1800, v_now, v_user_primary_role_code;
    RETURN;
  END IF;

  -- STEP 5: CHECK ROLE-PERMISSION
  SELECT rp.allowed, rp.effective_from, rp.effective_to
  INTO v_perm_allowed, v_perm_effective_from, v_perm_effective_to
  FROM rbac.role_permissions rp
  WHERE rp.role_code = v_user_primary_role_code AND rp.menu_id = v_menu_id AND rp.permission_id = v_perm_id AND rp.status = 'Active';

  IF FOUND THEN
    v_perm_found := TRUE;
    IF v_perm_effective_from IS NOT NULL AND v_now < v_perm_effective_from THEN v_perm_allowed := FALSE; END IF;
    IF v_perm_effective_to IS NOT NULL AND v_now > v_perm_effective_to THEN v_perm_allowed := FALSE; END IF;
  ELSE
    v_perm_found := FALSE; v_perm_allowed := FALSE;
  END IF;

  IF NOT v_perm_allowed THEN
    RETURN QUERY SELECT 'DENY'::VARCHAR(50), ('Permission "' || p_permission_code || '" not granted')::VARCHAR(500), TRUE, FALSE, FALSE, 1800, v_now, v_user_primary_role_code;
    RETURN;
  END IF;

  -- STEP 6: CHECK DATA SCOPE
  v_scope_valid := TRUE;
  IF p_resource_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_scope_count FROM rbac.user_data_scopes uds
    WHERE uds.user_id = p_user_id AND uds.status = 'Active'
      AND (uds.effective_from IS NULL OR uds.effective_from <= v_now)
      AND (uds.effective_to IS NULL OR uds.effective_to >= v_now);
    IF v_scope_count = 0 THEN v_scope_valid := FALSE; ELSE v_scope_valid := TRUE; END IF;
  END IF;

  IF NOT v_scope_valid THEN
    RETURN QUERY SELECT 'DENY'::VARCHAR(50), 'Resource outside user data scope'::VARCHAR(500), TRUE, TRUE, FALSE, 1800, v_now, v_user_primary_role_code;
    RETURN;
  END IF;

  -- STEP 7: ALLOW
  RETURN QUERY SELECT 'ALLOW'::VARCHAR(50), 'Authorization granted: all checks passed'::VARCHAR(500), v_menu_visible, v_perm_allowed, v_scope_valid, 300, v_now, v_user_primary_role_code;
END;
$$ LANGUAGE plpgsql STABLE;

-- FUNCTION 2: GET FULL USER EFFECTIVE ACCESS MATRIX
CREATE OR REPLACE FUNCTION rbac.get_user_full_access(p_user_id BIGINT)
RETURNS TABLE (
  user_id BIGINT,
  username VARCHAR(100),
  primary_role_code VARCHAR(50),
  primary_role_name VARCHAR(100),
  menu_id BIGINT,
  menu_code VARCHAR(100),
  menu_name VARCHAR(255),
  menu_route VARCHAR(500),
  permission_id BIGINT,
  permission_code VARCHAR(50),
  permission_name VARCHAR(255),
  is_accessible BOOLEAN,
  is_allowed BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    u.id,
    u.username,
    hr.code,
    hr.name,
    m.id,
    m.code,
    m.name,
    m.route,
    p.id,
    p.code,
    p.name,
    COALESCE(rma.visible AND rma.enabled, FALSE),
    COALESCE(rp.allowed, FALSE)
  FROM auth.users u
  LEFT JOIN system.hospital_roles hr ON hr.id = u.primary_role_id
  CROSS JOIN rbac.menus m
  CROSS JOIN rbac.permissions p
  LEFT JOIN rbac.role_menu_access rma 
    ON rma.role_code = hr.code AND rma.menu_id = m.id AND rma.status = 'Active'
    AND (rma.effective_from IS NULL OR rma.effective_from <= CURRENT_TIMESTAMP)
    AND (rma.effective_to IS NULL OR rma.effective_to >= CURRENT_TIMESTAMP)
  LEFT JOIN rbac.role_permissions rp 
    ON rp.role_code = hr.code AND rp.menu_id = m.id AND rp.permission_id = p.id AND rp.status = 'Active'
    AND (rp.effective_from IS NULL OR rp.effective_from <= CURRENT_TIMESTAMP)
    AND (rp.effective_to IS NULL OR rp.effective_to >= CURRENT_TIMESTAMP)
  WHERE u.id = p_user_id AND u.status = 'Active' AND m.status = 'Active' AND p.status = 'Active';
END;
$$ LANGUAGE plpgsql STABLE;

-- FUNCTION 3: PREVIEW
CREATE OR REPLACE FUNCTION rbac.preview_access_change(
  p_user_id BIGINT,
  p_change_type VARCHAR(50),
  p_menu_id BIGINT,
  p_permission_id BIGINT DEFAULT NULL,
  p_new_value BOOLEAN DEFAULT NULL
)
RETURNS TABLE (
  current_decision VARCHAR(50),
  proposed_decision VARCHAR(50),
  menu_code VARCHAR(100),
  menu_name VARCHAR(255),
  permission_code VARCHAR(50),
  permission_name VARCHAR(255),
  impact_description VARCHAR(500)
) AS $$
DECLARE
  v_menu_code VARCHAR(100);
  v_menu_name VARCHAR(255);
  v_perm_code VARCHAR(50);
  v_perm_name VARCHAR(255);
  v_current_decision VARCHAR(50);
  v_proposed_decision VARCHAR(50);
  v_role_code VARCHAR(50);
BEGIN
  SELECT code, name INTO v_menu_code, v_menu_name FROM rbac.menus WHERE id = p_menu_id;
  IF p_permission_id IS NOT NULL THEN
    SELECT code, name INTO v_perm_code, v_perm_name FROM rbac.permissions WHERE id = p_permission_id;
  END IF;
  SELECT hr.code INTO v_role_code FROM auth.users u LEFT JOIN system.hospital_roles hr ON hr.id = u.primary_role_id WHERE u.id = p_user_id;
  SELECT decision INTO v_current_decision FROM rbac.evaluate_access(p_user_id, v_menu_code, v_perm_code);
  v_proposed_decision := v_current_decision;
  RETURN QUERY SELECT v_current_decision, v_proposed_decision, v_menu_code, v_menu_name, v_perm_code, v_perm_name, 'Impact analysis not yet implemented'::VARCHAR(500);
END;
$$ LANGUAGE plpgsql STABLE;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_evaluate_access_user ON rbac.role_menu_access(role_code, status) WHERE status = 'Active';
CREATE INDEX IF NOT EXISTS idx_evaluate_access_perm ON rbac.role_permissions(role_code, menu_id, status) WHERE status = 'Active';
CREATE INDEX IF NOT EXISTS idx_evaluate_access_scope ON rbac.user_data_scopes(user_id, status) WHERE status = 'Active';

SELECT 'V2_0__effective_access_function completed' as status;
