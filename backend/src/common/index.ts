/**
 * Common cross-cutting exports (guards, filters, decorators, interceptors, types).
 *
 * Examples:
 *   import { RbacGuard, AllExceptionsFilter, CanView } from '../../common';
 *   import type { AccessDecision, ResourceType } from '../../common';
 */

// Guards
export { RbacGuard } from './guards';

// Filters
export { AllExceptionsFilter } from './filters';

// Decorators
export {
  REQUIRE_PERMISSION_KEY,
  RequirePermission,
  CanView,
  CanCreate,
  CanEdit,
  CanDelete,
  CanManage,
} from './decorators';
export type { RequirePermissionOptions } from './decorators';

// Interceptors
export { AuditInterceptor } from './interceptors';

// Types
export type {
  ResourceType,
  AccessDecisionLiteral,
  AccessDecision,
  EvaluateAccessRow,
  EvaluateAccessParams,
  FullAccessRow,
} from './types';
export {
  RESOURCE_TYPES,
  isResourceType,
  mapEvaluateAccessRow,
  denyAccess,
} from './types';
