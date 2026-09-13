-- V4_5__evaluate_access_resource_type.sql
-- Add explicit p_resource_type discriminator to rbac.evaluate_access so the same
-- numeric id cannot collide across tables (nurse vs unit vs contract …).
-- Builds on V4_4 resource-aware scope resolution.

DROP FUNCTION IF EXISTS rbac.evaluate_access CASCADE;

CREATE OR REPLACE FUNCTION rbac.evaluate_access(
  p_user_id         BIGINT,
  p_menu_code       VARCHAR,
  p_permission_code VARCHAR,
  p_resource_id     BIGINT  DEFAULT NULL,
  p_resource_type   TEXT    DEFAULT NULL   -- NEW: nurse | unit | post | contract | credential | ...
)
RETURNS TABLE (
  decision           VARCHAR(50),
  reason             VARCHAR(500),
  menu_accessible    BOOLEAN,
  permission_granted BOOLEAN,
  data_scope_valid   BOOLEAN,
  cache_ttl          INT,
  evaluated_at       TIMESTAMP,
  user_role          VARCHAR(50),
  user_roles         TEXT[]
) AS $$
DECLARE
  v_user_status VARCHAR(50);
  v_primary_role_id BIGINT;
  v_primary_role_code VARCHAR(50);
  v_all_role_codes TEXT[];
  v_now TIMESTAMP := CURRENT_TIMESTAMP;
  v_menu_id BIGINT;
  v_menu_status VARCHAR(50);
  v_menu_visible BOOLEAN := FALSE;
  v_menu_enabled BOOLEAN := FALSE;
  v_menu_found BOOLEAN := FALSE;
  v_perm_id BIGINT;
  v_perm_status VARCHAR(50);
  v_perm_allowed BOOLEAN := FALSE;
  v_perm_found BOOLEAN := FALSE;
  v_scope_valid BOOLEAN := FALSE;
  v_cache_ttl INT := 300;
  v_has_all_scope BOOLEAN := FALSE;
  v_scope_count INT := 0;
  v_resource_unit_id BIGINT := NULL;
  v_resource_dept_id BIGINT := NULL;
  v_resource_org_id BIGINT := NULL;
  v_is_nursing_menu BOOLEAN := FALSE;
  v_matched BOOLEAN := FALSE;
BEGIN
  -- User must exist and be Active
  SELECT u.status, u.primary_role_id
    INTO v_user_status, v_primary_role_id
  FROM auth.users u
  WHERE u.id = p_user_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'DENY'::VARCHAR(50), 'User not found'::VARCHAR(500),
      FALSE, FALSE, FALSE, 0, v_now, NULL::VARCHAR(50), NULL::TEXT[];
    RETURN;
  END IF;

  IF v_user_status IS DISTINCT FROM 'Active' THEN
    RETURN QUERY SELECT 'DENY'::VARCHAR(50),
      ('User status is ' || COALESCE(v_user_status, 'NULL'))::VARCHAR(500),
      FALSE, FALSE, FALSE, 0, v_now, NULL::VARCHAR(50), NULL::TEXT[];
    RETURN;
  END IF;

  -- All active role codes (multi-role)
  SELECT COALESCE(ARRAY_AGG(DISTINCT hr.code ORDER BY hr.code), ARRAY[]::TEXT[])
    INTO v_all_role_codes
  FROM auth.user_role_assignments ura
  JOIN system.hospital_roles hr ON hr.id = ura.role_id
  WHERE ura.user_id = p_user_id
    AND ura.status = 'Active'
    AND (ura.effective_from IS NULL OR ura.effective_from <= v_now)
    AND (ura.effective_to IS NULL OR ura.effective_to >= v_now)
    AND hr.status = 'Active';

  IF v_primary_role_id IS NOT NULL THEN
    SELECT hr.code INTO v_primary_role_code
    FROM system.hospital_roles hr WHERE hr.id = v_primary_role_id;
  END IF;

  IF v_primary_role_code IS NULL AND array_length(v_all_role_codes, 1) > 0 THEN
    v_primary_role_code := v_all_role_codes[1];
  END IF;

  -- Menu access (any active role with visible+enabled)
  SELECT m.id, m.status
    INTO v_menu_id, v_menu_status
  FROM system.menus m
  WHERE m.code = p_menu_code;

  IF NOT FOUND OR v_menu_status IS DISTINCT FROM 'Active' THEN
    RETURN QUERY SELECT 'DENY'::VARCHAR(50),
      ('Menu not found or inactive: ' || p_menu_code)::VARCHAR(500),
      FALSE, FALSE, FALSE, 0, v_now, v_primary_role_code, v_all_role_codes;
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM rbac.role_menu_access rma
    JOIN system.hospital_roles hr ON hr.id = rma.role_id
    WHERE rma.menu_id = v_menu_id
      AND rma.status = 'Active'
      AND rma.is_visible = TRUE
      AND rma.is_enabled = TRUE
      AND (rma.effective_from IS NULL OR rma.effective_from <= v_now)
      AND (rma.effective_to IS NULL OR rma.effective_to >= v_now)
      AND hr.code = ANY(v_all_role_codes)
      AND hr.status = 'Active'
  ) INTO v_menu_found;

  v_menu_visible := v_menu_found;
  v_menu_enabled := v_menu_found;

  IF NOT v_menu_found THEN
    RETURN QUERY SELECT 'DENY'::VARCHAR(50),
      ('No active role_menu_access for menu ' || p_menu_code)::VARCHAR(500),
      FALSE, FALSE, FALSE, 1800, v_now, v_primary_role_code, v_all_role_codes;
    RETURN;
  END IF;

  -- Permission
  SELECT p.id, p.status
    INTO v_perm_id, v_perm_status
  FROM system.permissions p
  WHERE p.code = p_permission_code;

  IF NOT FOUND OR v_perm_status IS DISTINCT FROM 'Active' THEN
    RETURN QUERY SELECT 'DENY'::VARCHAR(50),
      ('Permission not found or inactive: ' || p_permission_code)::VARCHAR(500),
      TRUE, FALSE, FALSE, 1800, v_now, v_primary_role_code, v_all_role_codes;
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM rbac.role_permissions rp
    JOIN system.hospital_roles hr ON hr.id = rp.role_id
    WHERE rp.permission_id = v_perm_id
      AND rp.menu_id = v_menu_id
      AND rp.status = 'Active'
      AND rp.is_allowed = TRUE
      AND (rp.effective_from IS NULL OR rp.effective_from <= v_now)
      AND (rp.effective_to IS NULL OR rp.effective_to >= v_now)
      AND hr.code = ANY(v_all_role_codes)
      AND hr.status = 'Active'
  ) INTO v_perm_found;

  v_perm_allowed := v_perm_found;

  IF NOT v_perm_found THEN
    RETURN QUERY SELECT 'DENY'::VARCHAR(50),
      ('Permission ' || p_permission_code || ' not granted on ' || p_menu_code)::VARCHAR(500),
      TRUE, FALSE, FALSE, 1800, v_now, v_primary_role_code, v_all_role_codes;
    RETURN;
  END IF;

  -- Data scope
  v_is_nursing_menu := p_menu_code IN (
    'NURSE_MASTER', 'CREDENTIALS', 'NURSE_ROSTER', 'CONTRACT', 'DOCUMENTS'
  );

  SELECT EXISTS (
    SELECT 1 FROM rbac.user_data_scopes uds
    WHERE uds.user_id = p_user_id AND uds.status = 'Active'
      AND uds.scope_type = 'All'
  ) INTO v_has_all_scope;

  SELECT COUNT(*) INTO v_scope_count
  FROM rbac.user_data_scopes uds
  WHERE uds.user_id = p_user_id AND uds.status = 'Active';

  IF p_resource_id IS NULL THEN
    -- No specific resource: any active scope (or All) is enough
    v_scope_valid := v_has_all_scope OR v_scope_count > 0;
  ELSE
    -- Resolve resource → unit / dept / org using explicit type when provided
    IF p_resource_type = 'unit' THEN
      SELECT u.id, u.department_id, u.organization_id
        INTO v_resource_unit_id, v_resource_dept_id, v_resource_org_id
      FROM nursing.nursing_units u
      WHERE u.id = p_resource_id;
    ELSIF p_resource_type = 'nurse' THEN
      SELECT n.home_unit_id, u.department_id, u.organization_id
        INTO v_resource_unit_id, v_resource_dept_id, v_resource_org_id
      FROM nursing.nurses n
      JOIN nursing.nursing_units u ON u.id = n.home_unit_id
      WHERE n.id = p_resource_id;
    ELSIF p_resource_type = 'credential' THEN
      SELECT n.home_unit_id, u.department_id, u.organization_id
        INTO v_resource_unit_id, v_resource_dept_id, v_resource_org_id
      FROM nursing.credentials c
      JOIN nursing.nurses n ON n.id = c.nurse_id
      JOIN nursing.nursing_units u ON u.id = n.home_unit_id
      WHERE c.id = p_resource_id;
    ELSIF p_resource_type = 'contract' THEN
      SELECT n.home_unit_id, u.department_id, u.organization_id
        INTO v_resource_unit_id, v_resource_dept_id, v_resource_org_id
      FROM nursing.employment_contracts ec
      JOIN nursing.nurses n ON n.id = ec.nurse_id
      JOIN nursing.nursing_units u ON u.id = n.home_unit_id
      WHERE ec.id = p_resource_id;
    ELSIF p_resource_type IS NULL THEN
      -- Backward-compatible heuristic (V4_4 behaviour)
      SELECT n.home_unit_id, u.department_id, u.organization_id
        INTO v_resource_unit_id, v_resource_dept_id, v_resource_org_id
      FROM nursing.nurses n
      JOIN nursing.nursing_units u ON u.id = n.home_unit_id
      WHERE n.id = p_resource_id;

      IF v_resource_unit_id IS NULL THEN
        SELECT ra.nursing_unit_id, u.department_id, u.organization_id
          INTO v_resource_unit_id, v_resource_dept_id, v_resource_org_id
        FROM nursing.roster_assignments ra
        JOIN nursing.nursing_units u ON u.id = ra.nursing_unit_id
        WHERE ra.id = p_resource_id;
      END IF;
    END IF;

    IF v_has_all_scope THEN
      v_scope_valid := TRUE;
    ELSIF v_resource_unit_id IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1
        FROM rbac.user_data_scopes uds
        WHERE uds.user_id = p_user_id
          AND uds.status = 'Active'
          AND (
            (uds.scope_type = 'Organization' AND uds.organization_id = v_resource_org_id)
            OR (uds.scope_type = 'Department'   AND uds.department_id   = v_resource_dept_id)
            OR (uds.scope_type = 'Unit'         AND uds.unit_id         = v_resource_unit_id)
            OR (uds.scope_type = 'Assigned'     AND EXISTS (
                  SELECT 1 FROM nursing.nurses n
                  WHERE n.id = p_resource_id AND n.user_id = p_user_id
                ))
          )
      ) INTO v_scope_valid;
    ELSE
      -- Resource could not be resolved
      IF v_is_nursing_menu THEN
        v_scope_valid := FALSE;  -- fail closed for PHI
      ELSE
        v_scope_valid := v_scope_count > 0;  -- lenient for non-nursing
      END IF;
    END IF;
  END IF;

  IF NOT v_scope_valid THEN
    RETURN QUERY SELECT 'DENY'::VARCHAR(50),
      ('Data scope invalid for resource ' || COALESCE(p_resource_type, 'id') || ':' || p_resource_id::TEXT)::VARCHAR(500),
      TRUE, TRUE, FALSE, 1800, v_now, v_primary_role_code, v_all_role_codes;
    RETURN;
  END IF;

  -- ALLOW
  RETURN QUERY SELECT 'ALLOW'::VARCHAR(50),
    ('Access granted for ' || p_permission_code || ' on ' || p_menu_code)::VARCHAR(500),
    TRUE, TRUE, TRUE, v_cache_ttl, v_now, v_primary_role_code, v_all_role_codes;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION rbac.evaluate_access IS
  'Resource-aware access evaluation with optional p_resource_type discriminator (V4_5).';
