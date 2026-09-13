/**
 * Barrel: RBAC permission metadata decorators.
 * Prefer: import { RequirePermission, CanView, … } from '../../common/decorators';
 */
export {
  REQUIRE_PERMISSION_KEY,
  RequirePermission,
  CanView,
  CanCreate,
  CanEdit,
  CanDelete,
  CanManage,
} from './require-permission.decorator';

export type { RequirePermissionOptions } from './require-permission.decorator';
