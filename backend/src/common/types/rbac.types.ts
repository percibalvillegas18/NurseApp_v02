import type { ResourceType } from './resource.types';

/** ALLOW | DENY — single source of truth for decision literals. */
export type AccessDecisionLiteral = 'ALLOW' | 'DENY';

/**
 * Domain result returned by EffectiveAccessService.evaluateAccess().
 * Shared across DTO, guard, mock, Redis, and tests.
 */
export interface AccessDecision {
  decision: AccessDecisionLiteral;
  reason: string;
  menuAccessible: boolean;
  permissionGranted: boolean;
  dataScopeValid: boolean;
  cacheTtl: number;
  evaluatedAt: Date;
  userRole: string | null;
  /** All active roles that contributed to the decision (multi-role OR). */
  userRoles: string[];
  /** True when the value was served from Redis. */
  cached?: boolean;
}

/** Raw row shape returned by `rbac.evaluate_access` (snake_case from PG). */
export interface EvaluateAccessRow {
  decision: AccessDecisionLiteral;
  reason: string;
  menu_accessible: boolean;
  permission_granted: boolean;
  data_scope_valid: boolean;
  cache_ttl: number;
  evaluated_at: Date;
  user_role: string | null;
  user_roles: string[] | null;
}

/** Input bag for evaluateAccess (service + mock + tests). */
export interface EvaluateAccessParams {
  userId: number;
  menuCode: string;
  permissionCode: string;
  resourceId?: number | null;
  resourceType?: ResourceType | null;
}

/** Row from `rbac.get_user_full_access`. */
export interface FullAccessRow {
  user_id: number;
  username: string;
  primary_role_code: string;
  primary_role_name: string;
  all_roles?: string[];
  menu_id: number;
  menu_code: string;
  menu_name: string;
  menu_route: string;
  permission_id: number;
  permission_code: string;
  permission_name: string;
  is_accessible: boolean;
  is_allowed: boolean;
}

/** Map a PG row → domain AccessDecision. */
export function mapEvaluateAccessRow(row: EvaluateAccessRow): AccessDecision {
  return {
    decision: row.decision,
    reason: row.reason,
    menuAccessible: row.menu_accessible,
    permissionGranted: row.permission_granted,
    dataScopeValid: row.data_scope_valid,
    cacheTtl: row.cache_ttl,
    evaluatedAt: row.evaluated_at,
    userRole: row.user_role,
    userRoles: row.user_roles ?? (row.user_role ? [row.user_role] : []),
  };
}

/** Fail-closed fallback when the SQL function returns no row. */
export function denyAccess(reason = 'No evaluate_access row returned'): AccessDecision {
  return {
    decision: 'DENY',
    reason,
    menuAccessible: false,
    permissionGranted: false,
    dataScopeValid: false,
    cacheTtl: 1800,
    evaluatedAt: new Date(),
    userRole: null,
    userRoles: [],
  };
}
