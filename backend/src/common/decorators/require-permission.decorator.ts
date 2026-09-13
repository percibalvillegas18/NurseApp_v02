import { SetMetadata } from '@nestjs/common';

export const REQUIRE_PERMISSION_KEY = 'require_permission';

export interface RequirePermissionOptions {
  menuCode: string;
  permissionCode: string;
  /** If true, resourceId will be extracted from request params/body */
  resourceIdParam?: string;
  /** Optional: resource type for data scope validation */
  resourceType?: string;
}

/**
 * Decorator to require specific menu + permission.
 * Usage:
 * @RequirePermission({ menuCode: 'NURSE_MASTER', permissionCode: 'EDIT' })
 * @RequirePermission({ menuCode: 'NURSE_ROSTER', permissionCode: 'VIEW', resourceIdParam: 'id' })
 */
export const RequirePermission = (options: RequirePermissionOptions) =>
  SetMetadata(REQUIRE_PERMISSION_KEY, options);

/**
 * Shorthand for common permissions
 */
export const CanView = (menuCode: string) =>
  RequirePermission({ menuCode, permissionCode: 'VIEW' });

export const CanCreate = (menuCode: string) =>
  RequirePermission({ menuCode, permissionCode: 'CREATE' });

export const CanEdit = (menuCode: string) =>
  RequirePermission({ menuCode, permissionCode: 'EDIT' });

export const CanDelete = (menuCode: string) =>
  RequirePermission({ menuCode, permissionCode: 'DELETE' });

export const CanManage = (menuCode: string) =>
  RequirePermission({ menuCode, permissionCode: 'MANAGE' });
