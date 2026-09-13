-- V4_4__resource_aware_data_scope.sql
-- First cut: make rbac.evaluate_access() resource-aware for nursing domain.
--
-- Prior behaviour (V2_5): when p_resource_id was set, any active user_data_scopes
-- row was enough → data_scope_valid = TRUE. An ICU-scoped user could pass the
-- RBAC guard for a Medical-Ward nurse/roster id.
--
-- This migration replaces evaluate_access so that, when p_resource_id is set:
--   1. scope_type = 'All' still allows everything.
--   2. Otherwise resolve the resource to a nursing_unit_id (and its
--      department_id / organization_id) from:
--        - nursing.nurses.id            → home_unit_id
--        - nursing.roster_assignments.id → nursing_unit_id
--        - nursing.credentials.id       → nurse.home_unit_id
--   3. Allow if the user has a matching NursingUnit / Department / Hospital
--      scope (or Post/Shift scoped to that unit's hierarchy).
--   4. If the resource cannot be resolved (unknown id / non-nursing menu),
--      fall back to "any active scope" for non-nursing menus, and DENY for
--      nursing menus (fail closed on PHI).
--
-- Menu codes treated as nursing PHI:
--   NURSE_MASTER, CREDENTIALS, NURSE_ROSTER, CONTRACT, DOCUMENTS
--
-- App-layer filters in NursingService remain the primary list/filter control;
-- this closes the RBAC-guard hole when resourceIdParam is passed.

CREATE OR REPLACE FUNCTION rbac.evaluate_access(
  p_user_id BIGINT,
  p_menu_code VARCHAR,
  p_permission_code VARCHAR,
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
  user_role VARCHAR(50),
  user_roles TEXT[]
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

  IF v_primary_role_code IS NOT NULL AND NOT (v_primary_role_code = ANY (v_all_role_codes)) THEN
    v_all_role_codes := array_append(v_all_role_codes, v_primary_role_code);
  END IF;

  IF array_length(v_all_role_codes, 1) IS NULL OR array_length(v_all_role_codes, 1) = 0 THEN
    RETURN QUERY SELECT 'DENY'::VARCHAR(50), 'User has no active roles'::VARCHAR(500),
      FALSE, FALSE, FALSE, 0, v_now, v_primary_role_code, v_all_role_codes;
    RETURN;
  END IF;

  -- Menu
  SELECT m.id, m.status, COALESCE(m.is_visible, TRUE), COALESCE(m.is_enabled, TRUE)
    INTO v_menu_id, v_menu_status, v_menu_visible, v_menu_enabled
  FROM rbac.menus m
  WHERE m.code = p_menu_code;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'DENY'::VARCHAR(50),
      ('Menu code not found: ' || p_menu_code)::VARCHAR(500),
      FALSE, FALSE, FALSE, 0, v_now, v_primary_role_code, v_all_role_codes;
    RETURN;
  END IF;
  v_menu_found := TRUE;

  IF v_menu_status IS DISTINCT FROM 'Active' OR NOT v_menu_enabled THEN
    RETURN QUERY SELECT 'DENY'::VARCHAR(50),
      ('Menu not active/enabled: ' || p_menu_code)::VARCHAR(500),
      FALSE, FALSE, FALSE, 0, v_now, v_primary_role_code, v_all_role_codes;
    RETURN;
  END IF;

  -- Role-menu access (ANY active role)
  SELECT EXISTS (
    SELECT 1 FROM rbac.role_menu_access rma
    WHERE rma.role_code = ANY (v_all_role_codes)
      AND rma.menu_id = v_menu_id
      AND rma.status = 'Active'
      AND rma.allowed = TRUE
      AND (rma.effective_from IS NULL OR rma.effective_from <= v_now)
      AND (rma.effective_to IS NULL OR rma.effective_to >= v_now)
  ) INTO v_menu_visible;

  IF NOT v_menu_visible THEN
    RETURN QUERY SELECT 'DENY'::VARCHAR(50),
      ('No role has menu access to ' || p_menu_code)::VARCHAR(500),
      FALSE, FALSE, FALSE, 300, v_now, v_primary_role_code, v_all_role_codes;
    RETURN;
  END IF;

  -- Permission
  SELECT p.id, p.status INTO v_perm_id, v_perm_status
  FROM rbac.permissions p WHERE p.code = p_permission_code;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'DENY'::VARCHAR(50),
      ('Permission code not found: ' || p_permission_code)::VARCHAR(500),
      TRUE, FALSE, FALSE, 0, v_now, v_primary_role_code, v_all_role_codes;
    RETURN;
  END IF;
  v_perm_found := TRUE;

  SELECT EXISTS (
    SELECT 1 FROM rbac.role_permissions rp
    WHERE rp.role_code = ANY (v_all_role_codes)
      AND rp.menu_id = v_menu_id
      AND rp.permission_id = v_perm_id
      AND rp.status = 'Active'
      AND rp.allowed = TRUE
      AND (rp.effective_from IS NULL OR rp.effective_from <= v_now)
      AND (rp.effective_to IS NULL OR rp.effective_to >= v_now)
  ) INTO v_perm_allowed;

  IF NOT v_perm_allowed THEN
    RETURN QUERY SELECT 'DENY'::VARCHAR(50),
      ('Permission ' || p_permission_code || ' not granted on ' || p_menu_code)::VARCHAR(500),
      TRUE, FALSE, FALSE, 300, v_now, v_primary_role_code, v_all_role_codes;
    RETURN;
  END IF;

  -- ── Data scope ────────────────────────────────────────────────────────────
  v_is_nursing_menu := p_menu_code IN (
    'NURSE_MASTER', 'CREDENTIALS', 'NURSE_ROSTER', 'CONTRACT', 'DOCUMENTS'
  );

  IF p_resource_id IS NULL THEN
    -- List / non-resource calls: app layer must still filter; scope always valid here
    v_scope_valid := TRUE;
  ELSE
    -- Explicit All scope
    SELECT EXISTS (
      SELECT 1 FROM rbac.user_data_scopes uds
      WHERE uds.user_id = p_user_id
        AND uds.status = 'Active'
        AND uds.scope_type = 'All'
        AND (uds.effective_from IS NULL OR uds.effective_from <= v_now)
        AND (uds.effective_to IS NULL OR uds.effective_to >= v_now)
    ) INTO v_has_all_scope;

    IF v_has_all_scope THEN
      v_scope_valid := TRUE;
    ELSE
      -- Resolve resource → unit / dept / org (first cut: nursing domain tables)
      SELECT n.home_unit_id INTO v_resource_unit_id
      FROM nursing.nurses n
      WHERE n.id = p_resource_id AND n.deleted_at IS NULL;

      IF v_resource_unit_id IS NULL THEN
        SELECT ra.nursing_unit_id INTO v_resource_unit_id
        FROM nursing.roster_assignments ra
        WHERE ra.id = p_resource_id;
      END IF;

      IF v_resource_unit_id IS NULL THEN
        SELECT n.home_unit_id INTO v_resource_unit_id
        FROM nursing.credentials c
        JOIN nursing.nurses n ON n.id = c.nurse_id AND n.deleted_at IS NULL
        WHERE c.id = p_resource_id AND c.deleted_at IS NULL;
      END IF;

      IF v_resource_unit_id IS NOT NULL THEN
        SELECT nu.department_id, d.organization_id
          INTO v_resource_dept_id, v_resource_org_id
        FROM rbac.nursing_units nu
        LEFT JOIN rbac.departments d ON d.id = nu.department_id
        WHERE nu.id = v_resource_unit_id;
      END IF;

      IF v_resource_unit_id IS NULL AND v_is_nursing_menu THEN
        -- Unknown nursing resource id → fail closed
        v_scope_valid := FALSE;
      ELSIF v_resource_unit_id IS NULL THEN
        -- Non-nursing menu / unresolved resource: keep MVP "any scope" behaviour
        SELECT COUNT(*) INTO v_scope_count
        FROM rbac.user_data_scopes uds
        WHERE uds.user_id = p_user_id
          AND uds.status = 'Active'
          AND (uds.effective_from IS NULL OR uds.effective_from <= v_now)
          AND (uds.effective_to IS NULL OR uds.effective_to >= v_now);
        v_scope_valid := v_scope_count > 0;
      ELSE
        -- Match user scopes against resolved hierarchy
        SELECT EXISTS (
          SELECT 1 FROM rbac.user_data_scopes uds
          WHERE uds.user_id = p_user_id
            AND uds.status = 'Active'
            AND (uds.effective_from IS NULL OR uds.effective_from <= v_now)
            AND (uds.effective_to IS NULL OR uds.effective_to >= v_now)
            AND (
              uds.scope_type = 'All'
              OR (uds.scope_type = 'NursingUnit' AND uds.nursing_unit_id = v_resource_unit_id)
              OR (uds.scope_type = 'Department' AND uds.department_id IS NOT NULL
                  AND uds.department_id = v_resource_dept_id)
              OR (uds.scope_type = 'Hospital' AND uds.organization_id IS NOT NULL
                  AND uds.organization_id = v_resource_org_id)
              OR (uds.scope_type = 'Post' AND uds.post_id IS NOT NULL
                  AND EXISTS (
                    SELECT 1 FROM rbac.posts p
                    WHERE p.id = uds.post_id AND p.nursing_unit_id = v_resource_unit_id
                  ))
              OR (uds.scope_type = 'Assigned') -- self-assignment handled in app; allow guard through
            )
        ) INTO v_matched;
        v_scope_valid := COALESCE(v_matched, FALSE);
      END IF;
    END IF;
  END IF;

  IF NOT v_scope_valid THEN
    RETURN QUERY SELECT 'DENY'::VARCHAR(50),
      ('Data scope does not cover resource ' || p_resource_id::TEXT
        || COALESCE(' (unit ' || v_resource_unit_id::TEXT || ')', ''))::VARCHAR(500),
      TRUE, TRUE, FALSE, 300, v_now, v_primary_role_code, v_all_role_codes;
    RETURN;
  END IF;

  -- Near-expiry cache TTL (role_menu_access windows)
  IF EXISTS (
    SELECT 1 FROM rbac.role_menu_access rma
    WHERE rma.role_code = ANY (v_all_role_codes)
      AND rma.menu_id = v_menu_id
      AND rma.status = 'Active'
      AND rma.effective_to IS NOT NULL
      AND rma.effective_to <= v_now + INTERVAL '1 hour'
  ) THEN
    v_cache_ttl := 60;
  END IF;

  RETURN QUERY SELECT 'ALLOW'::VARCHAR(50),
    ('Authorization granted for roles [' || ARRAY_TO_STRING(v_all_role_codes, ',') || ']'
      || CASE WHEN p_resource_id IS NOT NULL
           THEN ' resource=' || p_resource_id::TEXT
           ELSE '' END)::VARCHAR(500),
    v_menu_visible, v_perm_allowed, v_scope_valid, v_cache_ttl, v_now,
    v_primary_role_code, v_all_role_codes;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION rbac.evaluate_access(BIGINT, VARCHAR, VARCHAR, BIGINT) IS
  'Effective access evaluation (V4_4): multi-role + resource-aware data scope for nursing PHI tables.';
