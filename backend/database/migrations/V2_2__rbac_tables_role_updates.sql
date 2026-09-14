-- ============================================================================
-- V2_2__rbac_tables_role_updates.sql - Update RBAC tables to use role_code
-- ============================================================================

-- Add role_code column if not exists
ALTER TABLE rbac.role_menu_access ADD COLUMN IF NOT EXISTS role_code VARCHAR(50);
ALTER TABLE rbac.role_permissions ADD COLUMN IF NOT EXISTS role_code VARCHAR(50);

-- For existing V1 data, migrate role_id (which was VARCHAR like 'Administrator') to role_code
-- Map old roles to new hospital roles for backward compat
UPDATE rbac.role_menu_access SET role_code = 
  CASE 
    WHEN role_id = 'Administrator' THEN 'SYSTEM_ADMIN'
    WHEN role_id = 'Moderator' THEN 'NURSE_MANAGER'
    WHEN role_id = 'User-01' THEN 'RN'
    WHEN role_id = 'User-02' THEN 'LPN'
    WHEN role_id = 'User-03' THEN 'CNA'
    WHEN role_id = 'Guest' THEN 'READONLY_USER'
    ELSE role_id
  END
WHERE role_code IS NULL;

UPDATE rbac.role_permissions SET role_code = 
  CASE 
    WHEN role_id = 'Administrator' THEN 'SYSTEM_ADMIN'
    WHEN role_id = 'Moderator' THEN 'NURSE_MANAGER'
    WHEN role_id = 'User-01' THEN 'RN'
    WHEN role_id = 'User-02' THEN 'LPN'
    WHEN role_id = 'User-03' THEN 'CNA'
    WHEN role_id = 'Guest' THEN 'READONLY_USER'
    ELSE role_id
  END
WHERE role_code IS NULL;

-- Repair (2026-09): drop the legacy V1 role_id VARCHAR NOT NULL column. Since this
-- migration, role_code (FK -> system.hospital_roles.code) is the key — this matches
-- the Prisma contract (rbac_role_menu_access / rbac_role_permissions have no role_id
-- field). Leaving the NOT NULL column in place broke every later seed
-- (V2_4, V4_0: 'null value in column role_id'). CASCADE also removes the superseded
-- uk_*(role_id, ...) constraints; role_code replacements are added below.
ALTER TABLE rbac.role_menu_access DROP CONSTRAINT IF EXISTS uk_role_menu_access;
ALTER TABLE rbac.role_permissions DROP CONSTRAINT IF EXISTS uk_role_permissions;
ALTER TABLE rbac.role_menu_access DROP COLUMN IF EXISTS role_id CASCADE;
ALTER TABLE rbac.role_permissions DROP COLUMN IF EXISTS role_id CASCADE;

-- Add FK constraints (only after hospital_roles seeded, so deferrable)
-- We'll add them as NOT VALID initially, then validate later after seed
ALTER TABLE rbac.role_menu_access DROP CONSTRAINT IF EXISTS fk_role_menu_access_hospital_roles;
ALTER TABLE rbac.role_menu_access ADD CONSTRAINT fk_role_menu_access_hospital_roles 
  FOREIGN KEY (role_code) REFERENCES system.hospital_roles(code) ON DELETE RESTRICT NOT VALID;

ALTER TABLE rbac.role_permissions DROP CONSTRAINT IF EXISTS fk_role_permissions_hospital_roles;
ALTER TABLE rbac.role_permissions ADD CONSTRAINT fk_role_permissions_hospital_roles 
  FOREIGN KEY (role_code) REFERENCES system.hospital_roles(code) ON DELETE RESTRICT NOT VALID;

-- Add unique constraints for new model (if not exists)
DO $$ BEGIN
  ALTER TABLE rbac.role_menu_access ADD CONSTRAINT uk_role_menu_access_role_menu UNIQUE (role_code, menu_id);
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE rbac.role_permissions ADD CONSTRAINT uk_role_permissions_role_menu_perm UNIQUE (role_code, menu_id, permission_id);
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Create indexes for new column
CREATE INDEX IF NOT EXISTS idx_role_menu_access_role_code ON rbac.role_menu_access(role_code, status);
CREATE INDEX IF NOT EXISTS idx_role_permissions_role_code ON rbac.role_permissions(role_code, status);

-- Now make role_code NOT NULL after migration (defer until after seed)
-- ALTER TABLE rbac.role_menu_access ALTER COLUMN role_code SET NOT NULL;
-- ALTER TABLE rbac.role_permissions ALTER COLUMN role_code SET NOT NULL;

SELECT 'V2_2__rbac_tables_role_updates completed' as status;
