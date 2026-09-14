import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RbacService } from './rbac.service';
import { EffectiveAccessService } from './effective-access.service';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { RbacGuard } from '../../common/guards/rbac.guard';

@Controller('rbac')
@UseGuards(AuthGuard('jwt'), RbacGuard)
export class RbacController {
  constructor(
    private rbacService: RbacService,
    private effectiveAccessService: EffectiveAccessService,
  ) {}

  // Access Levels
  @Get('access-levels')
  @RequirePermission({ menuCode: 'ACCESS_LEVEL_MASTER', permissionCode: 'VIEW' })
  async getAccessLevels(
    @Query('status') status?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
  ) {
    const data = await this.rbacService.getAccessLevels({ status, page, limit, search });
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Post('access-levels')
  @RequirePermission({ menuCode: 'ACCESS_LEVEL_MASTER', permissionCode: 'MANAGE' })
  async createAccessLevel(@Body() body: any, @Req() req: any) {
    const data = await this.rbacService.createAccessLevel(body, req.user.id);
    return { success: true, statusCode: 201, data, timestamp: new Date().toISOString() };
  }

  // Menus
  @Get('menus')
  @RequirePermission({ menuCode: 'MENU_MASTER', permissionCode: 'VIEW' })
  async getMenus(
    @Query('status') status?: string,
    @Query('parentId') parentId?: number,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    const data = await this.rbacService.getMenus({ status, parentId, page, limit });
    return { success: true, data: { menus: data }, timestamp: new Date().toISOString() };
  }

  // M-10 fix: the menu hierarchy was accessible to any authenticated user
  // because it had no @RequirePermission decorator, and with C-5's default-deny
  // fix it would now be blocked entirely. Add explicit permission requirement.
  @Get('menus/hierarchy')
  @RequirePermission({ menuCode: 'ROLES_PERMISSIONS', permissionCode: 'VIEW' })
  async getMenuHierarchy(
    @Query('accessibleOnly') accessibleOnly?: boolean,
    @Req() req?: any,
  ) {
    const userId = accessibleOnly ? req.user.id : undefined;
    const data = await this.rbacService.getMenuHierarchy(accessibleOnly, userId);
    return { success: true, data: { menus: data }, timestamp: new Date().toISOString() };
  }

  // Permissions
  @Get('permissions')
  @RequirePermission({ menuCode: 'ROLES_PERMISSIONS', permissionCode: 'VIEW' })
  async getPermissions(
    @Query('category') category?: string,
    @Query('status') status?: string,
  ) {
    const data = await this.rbacService.getPermissions({ category, status });
    return { success: true, data: { items: data }, timestamp: new Date().toISOString() };
  }

  // Role Menu Access
  @Get('roles/:roleId/menu-access')
  @RequirePermission({ menuCode: 'ROLES_PERMISSIONS', permissionCode: 'VIEW' })
  async getRoleMenuAccess(@Param('roleId') roleId: string) {
    const data = await this.rbacService.getRoleMenuAccess(roleId);
    return { success: true, data: { roleId, menuAccess: data }, timestamp: new Date().toISOString() };
  }

  @Patch('roles/:roleId/menu-access/:menuId')
  @RequirePermission({ menuCode: 'ROLES_PERMISSIONS', permissionCode: 'MANAGE' })
  async updateRoleMenuAccess(
    @Param('roleId') roleId: string,
    @Param('menuId') menuId: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    const data = await this.rbacService.updateRoleMenuAccess(
      roleId,
      parseInt(menuId, 10),
      body,
      req.user.id,
    );
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  // Role Permissions
  @Get('roles/:roleId/permissions')
  @RequirePermission({ menuCode: 'ROLES_PERMISSIONS', permissionCode: 'VIEW' })
  async getRolePermissions(
    @Param('roleId') roleId: string,
    @Query('menuId') menuId?: number,
    @Query('allowedOnly') allowedOnly?: boolean,
  ) {
    const data = await this.rbacService.getRolePermissions(roleId, { menuId, allowedOnly });
    return { success: true, data: { roleId, permissions: data }, timestamp: new Date().toISOString() };
  }

  @Patch('roles/:roleId/permissions/:permissionId')
  @RequirePermission({ menuCode: 'ROLES_PERMISSIONS', permissionCode: 'MANAGE' })
  async updateRolePermission(
    @Param('roleId') roleId: string,
    @Param('permissionId') permissionId: string,
    @Query('menuId') menuId: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    const data = await this.rbacService.updateRolePermission(
      roleId,
      parseInt(menuId, 10),
      parseInt(permissionId, 10),
      body,
      req.user.id,
    );
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  // User Data Scopes
  @Get('users/:userId/data-scopes')
  @RequirePermission({ menuCode: 'USER_MANAGEMENT', permissionCode: 'VIEW' })
  async getUserDataScopes(@Param('userId') userId: string) {
    const data = await this.rbacService.getUserDataScopes(parseInt(userId, 10));
    return {
      success: true,
      data: { userId: parseInt(userId, 10), dataScopes: data },
      timestamp: new Date().toISOString(),
    };
  }

  @Post('users/:userId/data-scopes')
  @RequirePermission({ menuCode: 'USER_MANAGEMENT', permissionCode: 'MANAGE' })
  async assignDataScope(
    @Param('userId') userId: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    const data = await this.rbacService.assignDataScope(parseInt(userId, 10), body, req.user.id);
    return { success: true, statusCode: 201, data, timestamp: new Date().toISOString() };
  }

  // Effective Access

  /**
   * The effective-access endpoints resolve *any* user's full permission matrix,
   * so they are gated behind USER_MANAGEMENT/VIEW - except that a user may
   * always inspect their own effective access (login is built from the same
   * resolution and every page needs it).
   *
   * `POST .../evaluate` previously had no decorator at all, so any
   * authenticated user could ask the server whether *any other* user held a
   * permission - an authorization oracle.
   *
   * The check goes through EffectiveAccessService (the same cached path the
   * RBAC guard uses) rather than a permissions map on the JWT, because the
   * token only carries { sub, username, role, primaryRoleId, sessionId }.
   */
  private async canInspectUser(req: any, targetUserId: number): Promise<void> {
    if (req?.user?.id === targetUserId) return;

    const decision = await this.effectiveAccessService.evaluateAccess(
      req?.user?.id,
      'USER_MANAGEMENT',
      'VIEW',
    );

    if (decision.decision !== 'ALLOW') {
      throw new ForbiddenException(
        'USER_MANAGEMENT/VIEW permission required to inspect another user',
      );
    }
  }

  @Get('effective-access/:userId')
  @UseGuards(AuthGuard('jwt'))
  async getEffectiveAccess(@Param('userId') userId: string, @Req() req: any) {
    const targetUserId = parseInt(userId, 10);
    await this.canInspectUser(req, targetUserId);

    const matrix = await this.effectiveAccessService.getUserFullAccess(targetUserId);
    const accessibleMenus = await this.effectiveAccessService.getAccessibleMenus(targetUserId);

    return {
      success: true,
      data: {
        userId: targetUserId,
        calculatedAt: new Date().toISOString(),
        menus: accessibleMenus,
        fullMatrix: matrix,
        summary: {
          accessibleMenus: accessibleMenus.length,
          totalRows: matrix.length,
        },
      },
      timestamp: new Date().toISOString(),
    };
  }

  @Post('effective-access/:userId/evaluate')
  @RequirePermission({ menuCode: 'USER_MANAGEMENT', permissionCode: 'VIEW' })
  async evaluateAccess(
    @Param('userId') userId: string,
    @Body() body: { menuCode: string; permissionCode: string; resourceId?: number; resourceType?: string },
    @Req() req: any,
  ) {
    const targetUserId = parseInt(userId, 10);
    await this.canInspectUser(req, targetUserId);

    const result = await this.effectiveAccessService.evaluateSpecificRequest(
      targetUserId,
      body.menuCode,
      body.permissionCode,
      body.resourceId,
      body.resourceType as any,
    );
    return { success: true, data: result, timestamp: new Date().toISOString() };
  }

  @Post('effective-access/:userId/preview')
  @RequirePermission({ menuCode: 'ROLES_PERMISSIONS', permissionCode: 'MANAGE' })
  async previewAccessChange(
    @Param('userId') userId: string,
    @Body()
    body: {
      changeType: string;
      menuId: number;
      permissionId?: number;
      proposedAllowed?: boolean;
    },
  ) {
    const result = await this.effectiveAccessService.previewAccessChange(
      parseInt(userId, 10),
      body.changeType,
      body.menuId,
      body.permissionId,
      body.proposedAllowed,
    );
    return { success: true, data: result, timestamp: new Date().toISOString() };
  }
}
