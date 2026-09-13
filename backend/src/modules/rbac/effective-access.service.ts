import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../auth/prisma.service';
import { RedisService } from '../redis/redis.service';
import type {
  AccessDecision,
  EvaluateAccessRow,
  FullAccessRow,
  ResourceType,
} from '../../common/types';
import { mapEvaluateAccessRow, denyAccess } from '../../common/types';

// Re-export for any existing imports from this module
export type { AccessDecision, FullAccessRow } from '../../common/types';

@Injectable()
export class EffectiveAccessService {
  private readonly logger = new Logger(EffectiveAccessService.name);

  constructor(
    private prisma: PrismaService,
    private redisService: RedisService,
  ) {}

  /**
   * PRIMARY AUTHORIZATION METHOD WITH REDIS CACHING
   * 
   * Caching strategy:
   * - Key: rbac:access:{userId}:{menuCode}:{permissionCode}:{resourceType|_}:{resourceId|_}
   * - TTL: From SQL function (ALLOW 300s, DENY 1800s, expiring soon 60s)
   * - Invalidation: On role_menu_access, role_permissions, user_role_assignments, user_data_scopes changes
   * - Fail-open cache: If Redis down, still evaluate via DB (fail closed on DB error)
   * 
   * Performance target: <5ms cached, <50ms uncached
   */
  async evaluateAccess(
    userId: number,
    menuCode: string,
    permissionCode: string,
    resourceId?: number | null,
    resourceType?: ResourceType | null,
  ): Promise<AccessDecision> {
    const cacheKey = this.redisService.buildAccessKey(userId, menuCode, permissionCode, resourceId, resourceType);

    // Try cache first
    try {
      const cached = await this.redisService.getAccessDecision(
        userId,
        menuCode,
        permissionCode,
        resourceId,
        resourceType,
      ) as AccessDecision | null;

      if (cached) {
        this.logger.debug(`Cache HIT for ${cacheKey} -> ${cached.decision}`);
        return {
          ...cached,
          cached: true,
          evaluatedAt: new Date(cached.evaluatedAt), // Ensure Date object
        };
      }

      this.logger.debug(`Cache MISS for ${cacheKey}`);
    } catch (error: any) {
      this.logger.warn(`Cache read failed for ${cacheKey}: ${error.message}, falling back to DB`);
    }

    // Cache miss - evaluate via DB
    let decision: AccessDecision;
    try {
      const raw = (await this.prisma.$queryRawUnsafe(
        `SELECT * FROM rbac.evaluate_access($1, $2, $3, $4, $5)`,
        userId,
        menuCode,
        permissionCode,
        resourceId ?? null,
        resourceType ?? null,
      )) as EvaluateAccessRow[];

      const row = raw[0];

      if (!row) {
        decision = {
          decision: 'DENY',
          reason: 'No decision returned from evaluate_access',
          menuAccessible: false,
          permissionGranted: false,
          dataScopeValid: false,
          cacheTtl: 300,
          evaluatedAt: new Date(),
          userRole: null,
          userRoles: [],
          cached: false,
        };
      } else {
        const roles = await this.getUserActiveRoleCodes(userId);

        decision = {
          decision: row.decision as 'ALLOW' | 'DENY',
          reason: row.reason,
          menuAccessible: row.menu_accessible,
          permissionGranted: row.permission_granted,
          dataScopeValid: row.data_scope_valid,
          cacheTtl: row.cache_ttl,
          evaluatedAt: row.evaluated_at,
          userRole: row.user_role,
          userRoles: roles.length > 0 ? roles : row.user_roles || [],
          cached: false,
        };

        // Track user roles for precise invalidation
        if (roles.length > 0) {
          await this.redisService.trackUserRoles(userId, roles).catch((e: any) =>
            this.logger.warn(`Failed to track roles for user ${userId}: ${e.message}`),
          );
        }
      }
    } catch (error: any) {
      this.logger.error(
        `evaluateAccess DB failed for user=${userId}, menu=${menuCode}, perm=${permissionCode}: ${error.message}`,
        error.stack,
      );
      // Fail closed: DENY on error
      decision = {
        decision: 'DENY',
        reason: `Authorization evaluation error: ${error.message}`,
        menuAccessible: false,
        permissionGranted: false,
        dataScopeValid: false,
        cacheTtl: 300,
        evaluatedAt: new Date(),
        userRole: null,
        userRoles: [],
        cached: false,
      };
    }

    // Write to cache (even DENY decisions, with longer TTL)
    try {
      await this.redisService.setAccessDecision(
        userId,
        menuCode,
        permissionCode,
        resourceId,
        decision,
        decision.cacheTtl,
        resourceType,
      );
    } catch (error: any) {
      this.logger.warn(`Cache write failed for ${cacheKey}: ${error.message}`);
    }

    return decision;
  }

  /**
   * Get all active role codes for user (temporal filtering)
   * This is the FIX for multi-role support
   */
  async getUserActiveRoleCodes(userId: number): Promise<string[]> {
    const rows = (await this.prisma.$queryRawUnsafe(
      `
      SELECT hr.code
      FROM auth.user_role_assignments ura
      JOIN system.hospital_roles hr ON hr.id = ura.role_id
      WHERE ura.user_id = $1
        AND ura.status = 'Active'
        AND hr.status = 'Active'
        AND (ura.effective_from IS NULL OR ura.effective_from <= CURRENT_TIMESTAMP)
        AND (ura.effective_to IS NULL OR ura.effective_to >= CURRENT_TIMESTAMP)
      UNION
      SELECT hr.code
      FROM auth.users u
      JOIN system.hospital_roles hr ON hr.id = u.primary_role_id
      WHERE u.id = $1 AND u.status = 'Active' AND hr.status = 'Active'
      `,
      userId,
    )) as { code: string }[];
    return rows.map((r) => r.code);
  }

  /**
   * Get full access matrix for user with caching
   * Used for building dashboard and audit
   * Cache TTL 5 min (ALLOW) - invalidated on role changes
   */
  async getUserFullAccess(userId: number): Promise<FullAccessRow[]> {
    // Try cache
    try {
      const cached = (await this.redisService.getFullAccess(userId)) as FullAccessRow[] | null;
      if (cached) {
        this.logger.debug(`Cache HIT for full access user ${userId}`);
        return cached;
      }
    } catch (error: any) {
      this.logger.warn(`Full access cache read failed for user ${userId}: ${error.message}`);
    }

    try {
      const rows = (await this.prisma.$queryRawUnsafe(
        `SELECT * FROM rbac.get_user_full_access($1)`,
        userId,
      )) as FullAccessRow[];

      // Cache result
      await this.redisService.setFullAccess(userId, rows, 300).catch((e: any) =>
        this.logger.warn(`Failed to cache full access for user ${userId}: ${e.message}`),
      );

      return rows;
    } catch (error: any) {
      this.logger.error(`getUserFullAccess failed for user=${userId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get accessible menus only (for frontend navigation) with caching
   */
  async getAccessibleMenus(userId: number) {
    // Try cache
    try {
      const cached = (await this.redisService.getAccessibleMenus(userId)) as any[] | null;
      if (cached) {
        this.logger.debug(`Cache HIT for accessible menus user ${userId}`);
        return cached;
      }
    } catch (error: any) {
      this.logger.warn(`Menus cache read failed for user ${userId}: ${error.message}`);
    }

    const fullAccess = await this.getUserFullAccess(userId);

    // Group by menu, check if any permission is allowed and menu accessible
    const menuMap = new Map<number, any>();

    for (const row of fullAccess) {
      if (!menuMap.has(row.menu_id)) {
        menuMap.set(row.menu_id, {
          id: row.menu_id,
          code: row.menu_code,
          name: row.menu_name,
          route: row.menu_route,
          isAccessible: row.is_accessible,
          permissions: {},
        });
      }
      const menu = menuMap.get(row.menu_id);
      menu.permissions[row.permission_code] = row.is_allowed;
      // If any row says accessible, mark true (handles multi-role OR logic)
      if (row.is_accessible) menu.isAccessible = true;
    }

    const menus = Array.from(menuMap.values()).filter((m) => m.isAccessible);

    // Cache menus
    await this.redisService.setAccessibleMenus(userId, menus, 300).catch((e: any) =>
      this.logger.warn(`Failed to cache menus for user ${userId}: ${e.message}`),
    );

    return menus;
  }

  /**
   * Preview access after hypothetical change (impact analysis)
   * Calls rbac.preview_access_change
   * NOT cached - always fresh for admin impact analysis
   */
  async previewAccessChange(
    userId: number,
    changeType: string,
    menuId: number,
    permissionId?: number,
    newValue?: boolean,
  ) {
    try {
      const rows = (await this.prisma.$queryRawUnsafe(
        `SELECT * FROM rbac.preview_access_change($1, $2, $3, $4, $5)`,
        userId,
        changeType,
        menuId,
        permissionId || null,
        newValue ?? null,
      )) as any[];
      return rows[0];
    } catch (error: any) {
      this.logger.error(`previewAccessChange failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Evaluate specific request (used by API endpoint)
   */
  async evaluateSpecificRequest(
    userId: number,
    menuCode: string,
    permissionCode: string,
    resourceId?: number,
    resourceType?: import('../../common/types').ResourceType | null,
  ) {
    const decision = await this.evaluateAccess(userId, menuCode, permissionCode, resourceId, resourceType);

    return {
      userId,
      menuCode,
      permissionCode,
      resourceId,
      resourceType,
      decision: {
        allowed: decision.decision === 'ALLOW',
        menuAccessible: decision.menuAccessible,
        permissionGranted: decision.permissionGranted,
        dataScopeValid: decision.dataScopeValid,
        reason: decision.reason,
        evaluatedAt: decision.evaluatedAt,
        cacheTtl: decision.cacheTtl,
        roles: decision.userRoles,
        cached: decision.cached || false,
      },
    };
  }

  /**
   * Invalidate cache for user (called by RBAC service on config changes)
   */
  async invalidateUserCache(userId: number): Promise<number> {
    return this.redisService.invalidateUserCache(userId);
  }

  /**
   * Invalidate cache for role (called when role permissions change)
   */
  async invalidateRoleCache(roleCode: string): Promise<number> {
    return this.redisService.invalidateRoleCache(roleCode);
  }
}
