import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { PrismaService } from '../auth/prisma.service';
import { RedisService } from '../redis/redis.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class RbacService {
  private readonly logger = new Logger(RbacService.name);

  constructor(
    private prisma: PrismaService,
    private redisService: RedisService,
    private auditService: AuditService,
  ) {}

  // Access Levels
  async getAccessLevels(filters: { status?: string; page?: number; limit?: number; search?: string }) {
    const page = filters.page || 1;
    const limit = Math.min(filters.limit || 20, 100);
    const skip = (page - 1) * limit;

    const where: any = {};
    if (filters.status) where.status = filters.status;
    if (filters.search) {
      where.OR = [
        { code: { contains: filters.search, mode: 'insensitive' } },
        { name: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.rbac_access_levels.findMany({ where, skip, take: limit, orderBy: { priority: 'asc' } }),
      this.prisma.rbac_access_levels.count({ where }),
    ]);

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
        hasPreviousPage: page > 1,
      },
    };
  }

  async createAccessLevel(data: any, createdBy: number) {
    const existing = await this.prisma.rbac_access_levels.findFirst({
      where: { OR: [{ code: data.code }, { name: data.name }] },
    });
    if (existing) throw new ConflictException('Access level code or name already exists');

    const result = await this.prisma.rbac_access_levels.create({
      data: {
        code: data.code,
        name: data.name,
        description: data.description,
        priority: data.priority || 50,
        auto_assign: data.autoAssign || false,
        override_allowed: data.overrideAllowed ?? true,
        default_menu_behavior: data.defaultMenuBehavior || 'Configurable',
        status: 'Active',
        created_by: createdBy,
        updated_by: createdBy,
      },
    });

    // Access level change affects all RBAC cache
    await this.redisService.invalidateAllRbacCache().catch((e) => this.logger.warn(`Cache invalidation failed: ${e.message}`));

    await this.auditService.log({
      userId: createdBy,
      action: 'CONFIGURATION_CHANGE_CREATE',
      entityType: 'AccessLevel',
      entityId: Number(result.id),
      entityCode: result.code,
      description: `Created access level ${result.code}`,
      status: 'Success',
    });

    return result;
  }

  // Menus
  async getMenus(filters: { status?: string; parentId?: number; page?: number; limit?: number }) {
    const where: any = {};
    if (filters.status) where.status = filters.status;
    if (filters.parentId !== undefined) where.parent_menu_id = filters.parentId;

    const menus = await this.prisma.rbac_menus.findMany({
      where,
      orderBy: [{ display_order: 'asc' }, { name: 'asc' }],
    });

    // Build hierarchy
    const buildTree = (parentId: number | null): any[] => {
      return menus
        .filter((m) => m.parent_menu_id === parentId)
        .map((m) => ({
          ...m,
          children: buildTree(m.id),
        }));
    };

    return buildTree(null);
  }

  async getMenuHierarchy(accessibleOnly = false, userId?: number) {
    let menus = await this.prisma.rbac_menus.findMany({
      where: { status: 'Active' },
      orderBy: { display_order: 'asc' },
    });

    if (accessibleOnly && userId) {
      // Try cache for accessible menus
      const cached = (await this.redisService.getAccessibleMenus(userId)) as any[] | null;
      if (cached) {
        return cached;
      }

      // Filter by user's accessible menus via role_menu_access with multi-role OR logic
      const accessibleMenuIds = (await this.prisma.$queryRawUnsafe(
        `
        SELECT DISTINCT m.id as menu_id
        FROM rbac.menus m
        JOIN rbac.role_menu_access rma ON rma.menu_id = m.id
        JOIN system.hospital_roles hr ON hr.code = rma.role_code
        JOIN auth.user_role_assignments ura ON ura.role_id = hr.id
        WHERE ura.user_id = $1
          AND ura.status = 'Active'
          AND hr.status = 'Active'
          AND rma.status = 'Active'
          AND rma.visible = true AND rma.enabled = true
          AND m.status = 'Active'
          AND (rma.effective_from IS NULL OR rma.effective_from <= NOW())
          AND (rma.effective_to IS NULL OR rma.effective_to >= NOW())
          AND (ura.effective_from IS NULL OR ura.effective_from <= NOW())
          AND (ura.effective_to IS NULL OR ura.effective_to >= NOW())
        UNION
        SELECT DISTINCT m.id as menu_id
        FROM rbac.menus m
        JOIN rbac.role_menu_access rma ON rma.menu_id = m.id
        JOIN auth.users u ON u.primary_role_id = (SELECT id FROM system.hospital_roles WHERE code = rma.role_code)
        WHERE u.id = $1
          AND u.status = 'Active'
          AND rma.status = 'Active'
          AND rma.visible = true AND rma.enabled = true
          AND m.status = 'Active'
        `,
        userId,
      )) as { menu_id: number }[];
      const allowedIds = new Set(accessibleMenuIds.map((r) => r.menu_id));
      menus = menus.filter((m) => allowedIds.has(m.id));
    }

    const buildTree = (parentId: number | null): any[] => {
      return menus
        .filter((m) => m.parent_menu_id === parentId)
        .map((m) => ({
          ...m,
          children: buildTree(m.id),
        }));
    };

    const tree = buildTree(null);

    // Cache hierarchy for accessibleOnly case
    if (accessibleOnly && userId) {
      await this.redisService.setAccessibleMenus(userId, tree, 300).catch((e) => this.logger.warn(`Cache set failed: ${e.message}`));
    }

    return tree;
  }

  // Permissions
  async getPermissions(filters: { category?: string; status?: string; page?: number; limit?: number }) {
    const where: any = {};
    if (filters.category) where.category = filters.category;
    if (filters.status) where.status = filters.status;

    return this.prisma.rbac_permissions.findMany({
      where,
      orderBy: { code: 'asc' },
    });
  }

  // Role Menu Access
  async getRoleMenuAccess(roleCode: string) {
    const role = await this.prisma.system_hospital_roles.findUnique({ where: { code: roleCode } });
    if (!role) throw new NotFoundException(`Role ${roleCode} not found`);

    return this.prisma.rbac_role_menu_access.findMany({
      where: { role_code: roleCode },
      include: { menu: true },
      orderBy: { menu_id: 'asc' },
    });
  }

  async updateRoleMenuAccess(
    roleCode: string,
    menuId: number,
    data: { visible?: boolean; enabled?: boolean; overrideReason?: string },
    updatedBy: number,
  ) {
    const existing = await this.prisma.rbac_role_menu_access.findUnique({
      where: { role_code_menu_id: { role_code: roleCode, menu_id: menuId } },
    });

    if (!existing) throw new NotFoundException('Role menu access not found');

    const updated = await this.prisma.rbac_role_menu_access.update({
      where: { id: existing.id },
      data: {
        visible: data.visible ?? existing.visible,
        enabled: data.enabled ?? existing.enabled,
        assignment_source: 'ManualOverride',
        override_flag: true,
        updated_by: updatedBy,
      },
    });

    // CRITICAL: Invalidate cache for this role
    // This will invalidate all users having this role
    const deleted = await this.redisService.invalidateRoleCache(roleCode).catch((e) => {
      this.logger.warn(`Cache invalidation failed for role ${roleCode}: ${e.message}`);
      return 0;
    });

    this.logger.log(`Role ${roleCode} menu ${menuId} updated, invalidated ${deleted} cache keys`);

    await this.auditService.log({
      userId: updatedBy,
      action: 'CONFIGURATION_CHANGE_UPDATE',
      entityType: 'RoleMenuAccess',
      entityId: Number(updated.id),
      entityCode: `${roleCode}:${menuId}`,
      description: `Updated menu access for role ${roleCode} menu ${menuId}: visible=${updated.visible} enabled=${updated.enabled} reason=${data.overrideReason}`,
      changes: {
        before: existing,
        after: updated,
        reason: data.overrideReason,
      },
      status: 'Success',
    });

    return updated;
  }

  // Role Permissions
  async getRolePermissions(roleCode: string, filters: { menuId?: number; allowedOnly?: boolean }) {
    const where: any = { role_code: roleCode };
    if (filters.menuId) where.menu_id = filters.menuId;
    if (filters.allowedOnly) where.allowed = true;

    return this.prisma.rbac_role_permissions.findMany({
      where,
      include: { permission: true, menu: true },
    });
  }

  async updateRolePermission(
    roleCode: string,
    menuId: number,
    permissionId: number,
    data: { allowed: boolean; overrideReason?: string },
    updatedBy: number,
  ) {
    const existing = await this.prisma.rbac_role_permissions.findUnique({
      where: {
        role_code_menu_id_permission_id: { role_code: roleCode, menu_id: menuId, permission_id: permissionId },
      },
    });

    let result;
    if (!existing) {
      // Create if not exists (grant new permission)
      result = await this.prisma.rbac_role_permissions.create({
        data: {
          role_code: roleCode,
          menu_id: menuId,
          permission_id: permissionId,
          allowed: data.allowed,
          source: 'ManualOverride',
          override_flag: true,
          status: 'Active',
          created_by: updatedBy,
          updated_by: updatedBy,
        },
      });
    } else {
      result = await this.prisma.rbac_role_permissions.update({
        where: { id: existing.id },
        data: {
          allowed: data.allowed,
          source: 'ManualOverride',
          override_flag: true,
          updated_by: updatedBy,
        },
      });
    }

    // CRITICAL: Invalidate cache for this role
    const deleted = await this.redisService.invalidateRoleCache(roleCode).catch((e) => {
      this.logger.warn(`Cache invalidation failed for role ${roleCode}: ${e.message}`);
      return 0;
    });

    this.logger.log(`Role ${roleCode} permission ${permissionId} on menu ${menuId} updated to ${data.allowed}, invalidated ${deleted} cache keys`);

    await this.auditService.log({
      userId: updatedBy,
      action: data.allowed ? 'PERMISSION_GRANTED' : 'PERMISSION_REVOKED',
      entityType: 'RolePermission',
      entityId: Number(result.id),
      entityCode: `${roleCode}:${menuId}:${permissionId}`,
      description: `${data.allowed ? 'Granted' : 'Revoked'} permission ${permissionId} for role ${roleCode} on menu ${menuId}: ${data.overrideReason}`,
      changes: {
        before: existing,
        after: result,
        reason: data.overrideReason,
      },
      status: 'Success',
    });

    return result;
  }

  // User Data Scopes
  async getUserDataScopes(userId: number) {
    return this.prisma.rbac_user_data_scopes.findMany({
      where: { user_id: userId },
      include: {
        organization: true,
        department: true,
        nursing_unit: true,
        post: true,
        shift: true,
      },
    });
  }

  async assignDataScope(
    userId: number,
    data: {
      scopeType: string;
      organizationId?: number;
      departmentId?: number;
      nursingUnitId?: number;
      postId?: number;
      shiftId?: number;
      effectiveFrom?: Date;
      effectiveTo?: Date;
      reason?: string;
    },
    createdBy: number,
  ) {
    const result = await this.prisma.rbac_user_data_scopes.create({
      data: {
        user_id: userId,
        scope_type: data.scopeType as any,
        organization_id: data.organizationId,
        department_id: data.departmentId,
        nursing_unit_id: data.nursingUnitId,
        post_id: data.postId,
        shift_id: data.shiftId,
        effective_from: data.effectiveFrom,
        effective_to: data.effectiveTo,
        status: 'Active',
        created_by: createdBy,
        updated_by: createdBy,
      },
    });

    // Data scope change invalidates user cache
    await this.redisService.invalidateUserCache(userId).catch((e) => this.logger.warn(`Cache invalidation failed for user ${userId}: ${e.message}`));

    await this.auditService.log({
      userId: createdBy,
      action: 'CONFIGURATION_CHANGE_CREATE',
      entityType: 'UserDataScope',
      entityId: Number(result.id),
      entityCode: `${userId}:${data.scopeType}`,
      description: `Assigned data scope ${data.scopeType} to user ${userId}: ${data.reason}`,
      status: 'Success',
    });

    return result;
  }

  async removeDataScope(scopeId: number, userId: number, removedBy: number, reason?: string) {
    const existing = await this.prisma.rbac_user_data_scopes.findUnique({ where: { id: scopeId } });
    if (!existing) throw new NotFoundException('Data scope not found');

    const result = await this.prisma.rbac_user_data_scopes.update({
      where: { id: scopeId },
      data: { status: 'Inactive', updated_by: removedBy },
    });

    await this.redisService.invalidateUserCache(userId).catch((e) => this.logger.warn(`Cache invalidation failed: ${e.message}`));

    await this.auditService.log({
      userId: removedBy,
      action: 'CONFIGURATION_CHANGE_DELETE',
      entityType: 'UserDataScope',
      entityId: scopeId,
      description: `Removed data scope ${scopeId} from user ${userId}: ${reason}`,
      status: 'Success',
    });

    return result;
  }

  // User Role Assignments with cache invalidation
  async assignRoleToUser(
    userId: number,
    roleCode: string,
    assignedBy: number,
    reason: string,
    effectiveFrom?: Date,
    effectiveTo?: Date,
  ) {
    const role = await this.prisma.system_hospital_roles.findUnique({ where: { code: roleCode } });
    if (!role) throw new NotFoundException(`Role ${roleCode} not found`);

    const assignment = await this.prisma.auth_user_role_assignments.upsert({
      where: { user_id_role_id: { user_id: userId, role_id: role.id } },
      update: {
        status: 'Active',
        reason,
        effective_from: effectiveFrom,
        effective_to: effectiveTo,
      },
      create: {
        user_id: userId,
        role_id: role.id,
        assigned_by: assignedBy,
        reason,
        effective_from: effectiveFrom,
        effective_to: effectiveTo,
        status: 'Active',
      },
    });

    // Invalidate user cache - role assignment changed
    await this.redisService.invalidateUserCache(userId).catch((e) => this.logger.warn(`Cache invalidation failed: ${e.message}`));

    // Track new role
    const roles = await this.prisma.auth_user_role_assignments.findMany({
      where: { user_id: userId, status: 'Active' },
      include: { role: true },
    });
    const roleCodes = roles.map((r) => r.role.code);
    await this.redisService.trackUserRoles(userId, roleCodes).catch(() => {});

    await this.auditService.log({
      userId: assignedBy,
      action: 'ROLE_CHANGED',
      entityType: 'UserRoleAssignment',
      entityId: Number(assignment.id),
      entityCode: `${userId}:${roleCode}`,
      description: `Assigned role ${roleCode} to user ${userId}: ${reason}`,
      status: 'Success',
    });

    return assignment;
  }

  async getCacheStats() {
    return this.redisService.getCacheStats();
  }

  async invalidateAllCache() {
    return this.redisService.invalidateAllRbacCache();
  }
}
