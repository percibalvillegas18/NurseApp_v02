import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  Req,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UsersService } from './users.service';
import {
  CreateUserDto,
  UpdateUserDto,
  ResetPasswordDto,
  USER_STATUSES,
} from './dto/users.dto';
import {
  CanView,
  CanCreate,
  CanEdit,
} from '../../common/decorators/require-permission.decorator';
import { RbacGuard } from '../../common/guards/rbac.guard';

const M = 'USER_MANAGEMENT';

/**
 * User administration API (menu: USER_MANAGEMENT; Administration -> User Management).
 * Fields and actions per product decision: username/email/full name/password/
 * primary+additional roles/status; CRUD + deactivate/reactivate + password
 * reset (admin-set) + per-user unlock + sessions & login history.
 */
@Controller('users')
@UseGuards(AuthGuard('jwt'), RbacGuard)
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get()
  @CanView(M)
  list(
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit = 20,
  ) {
    return this.usersService.listUsers({ search, status, page, limit });
  }

  @Get('lookups')
  @CanView(M)
  lookups() {
    return this.usersService.getLookups();
  }

  @Get(':id')
  @CanView(M)
  get(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.getUser(id);
  }

  @Get(':id/login-history')
  @CanView(M)
  loginHistory(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.getLoginHistory(id);
  }

  @Get(':id/sessions')
  @CanView(M)
  sessions(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.getSessions(id);
  }

  @Post()
  @CanCreate(M)
  create(@Body() dto: CreateUserDto, @Req() req: any) {
    return this.usersService.createUser(dto, req.user, req.ip);
  }

  @Patch(':id')
  @CanEdit(M)
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateUserDto, @Req() req: any) {
    // H-11 fix: prevent admins from escalating their own role or changing their own status.
    // Self-service profile edits (name, email) should go through a separate endpoint.
    if (id === req.user?.id && (dto.primary_role_id !== undefined || dto.role_ids !== undefined || dto.status !== undefined)) {
      throw new BadRequestException('Cannot modify your own role or status. Ask another administrator.');
    }
    return this.usersService.updateUser(id, dto, req.user, req.ip);
  }

  /** Deactivate (Suspended) or reactivate (Active) */
  @Post(':id/status')
  @CanEdit(M)
  setStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body('status') status: string,
    @Req() req: any,
  ) {
    // H-11 fix: prevent admins from changing their own status
    if (id === req.user?.id) {
      throw new BadRequestException('Cannot modify your own status. Ask another administrator.');
    }
    if (!(USER_STATUSES as unknown as string[]).includes(status)) {
      throw new BadRequestException(`status must be one of: ${USER_STATUSES.join(', ')}`);
    }
    return this.usersService.setStatus(id, status as 'Active' | 'Suspended', req.user, req.ip);
  }

  @Post(':id/reset-password')
  @CanEdit(M)
  resetPassword(@Param('id', ParseIntPipe) id: number, @Body() dto: ResetPasswordDto, @Req() req: any) {
    return this.usersService.resetPassword(id, dto, req.user, req.ip);
  }

  /** Clears per-user failed-attempt counters (GLOBAL lockout is separate by design) */
  @Post(':id/unlock')
  @CanEdit(M)
  unlock(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.usersService.unlockUser(id, req.user, req.ip);
  }
}
