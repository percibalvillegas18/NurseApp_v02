import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../auth/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CreateUserDto,
  UpdateUserDto,
  ResetPasswordDto,
} from './dto/users.dto';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
  ) {}

  async listUsers(query: { search?: string; status?: string; page?: number; limit?: number }) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    const where: any = { deleted_at: null };
    if (query.status) where.status = query.status;
    if (query.search) {
      where.OR = [
        { username: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
        { full_name: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.auth_users.findMany({
        where,
        skip,
        take: limit,
        orderBy: { username: 'asc' },
        include: {
          primary_role: { select: { id: true, code: true, name: true, category: true } },
          user_role_assignments: {
            where: { status: 'Active' },
            include: { role: { select: { id: true, code: true, name: true } } },
          },
        },
      }),
      this.prisma.auth_users.count({ where }),
    ]);

    return {
      items: rows.map((r: any) => this.mapUser(r)),
      total,
      page,
      limit,
    };
  }

  async getUser(id: number) {
    const u = await this.prisma.auth_users.findUnique({
      where: { id },
      include: {
        primary_role: { select: { id: true, code: true, name: true, category: true } },
        user_role_assignments: {
          where: { status: 'Active' },
          include: { role: { select: { id: true, code: true, name: true } } },
        },
      },
    });
    if (!u || u.deleted_at) throw new NotFoundException('User not found');
    return this.mapUser(u);
  }

  async createUser(dto: CreateUserDto, actor: any, ip?: string) {
    // H-8 fix + M-11 fix: use async bcrypt.hash instead of blocking hashSync,
    // and catch Prisma P2002 unique constraint errors instead of relying on the
    // race-prone findFirst→create pattern.
    const password_hash = await bcrypt.hash(dto.password, 10);

    let created: any;
    try {
      created = await this.prisma.auth_users.create({
        data: {
          username: dto.username,
          email: dto.email,
          full_name: dto.full_name,
          password_hash,
          primary_role_id: dto.primary_role_id,
          status: dto.status ?? 'Active',
          created_by: actor?.userId ?? null,
          updated_by: actor?.userId ?? null,
          user_role_assignments: {
            create: (dto.role_ids ?? [])
              .filter((rid) => rid !== dto.primary_role_id)
              .map((rid) => ({
                role_id: rid,
                assigned_by: actor?.userId ?? undefined,
                status: 'Active',
              })),
          },
        },
      });
    } catch (error: any) {
      // P2002 = unique constraint violation (username or email)
      if (error?.code === 'P2002') {
        const target = error.meta?.target;
        if (Array.isArray(target) && target.includes('email')) {
          throw new ConflictException(`Email "${dto.email}" already exists`);
        }
        throw new ConflictException(`Username "${dto.username}" already exists`);
      }
      throw error;
    }

    await this.auditService.log({
      userId: actor?.userId ?? null,
      username: actor?.username ?? 'unknown',
      action: 'USER_CREATED',
      entityType: 'USER',
      entityId: created.id,
      entityCode: dto.username,
      description: `Admin created user ${dto.username} (${dto.full_name})`,
      ipAddress: ip,
    });

    return this.getUser(Number(created.id));
  }

  async updateUser(id: number, dto: UpdateUserDto, actor: any, ip?: string) {
    const existing = await this.getUser(id);

    if (dto.email !== undefined && dto.email !== existing.email) {
      const dup = await this.prisma.auth_users.findFirst({
        where: { email: dto.email, deleted_at: null },
      });
      if (dup && Number(dup.id) !== id) throw new ConflictException(`Email "${dto.email}" already exists`);
    }

    const updated = await this.prisma.auth_users.update({
      where: { id },
      data: {
        ...(dto.email !== undefined && { email: dto.email }),
        ...(dto.full_name !== undefined && { full_name: dto.full_name }),
        ...(dto.primary_role_id !== undefined && { primary_role_id: dto.primary_role_id }),
        ...(dto.status !== undefined && { status: dto.status }),
        updated_by: actor?.userId ?? null,
        updated_at: new Date(),
      },
    });

    // H-9 fix: wrap delete + re-create of role assignments in a transaction
    // so an interrupted request cannot leave the user with zero roles.
    if (dto.role_ids !== undefined) {
      const primaryId = dto.primary_role_id ?? existing.primaryRole?.id;
      const targets = dto.role_ids.filter((rid) => rid !== primaryId);
      await this.prisma.$transaction(async (tx) => {
        await tx.auth_user_role_assignments.deleteMany({
          where: { user_id: id },
        });
        for (const rid of targets) {
          await tx.auth_user_role_assignments.create({
            data: {
              user_id: id,
              role_id: rid,
              assigned_by: actor?.userId ?? undefined,
              status: 'Active',
            },
          });
        }
      });
    }

    await this.auditService.log({
      userId: actor?.userId ?? null,
      username: actor?.username ?? 'unknown',
      action: 'USER_UPDATED',
      entityType: 'USER',
      entityId: id,
      entityCode: existing.username,
      description: `Admin updated user ${existing.username}`,
      ipAddress: ip,
    });

    return this.getUser(Number(updated.id ?? id));
  }

  async setStatus(id: number, status: 'Active' | 'Suspended', actor: any, ip?: string) {
    const existing = await this.getUser(id);
    await this.prisma.auth_users.update({
      where: { id },
      data: { status, updated_by: actor?.userId ?? null, updated_at: new Date() },
    });

    await this.auditService.log({
      userId: actor?.userId ?? null,
      username: actor?.username ?? 'unknown',
      action: status === 'Suspended' ? 'USER_DEACTIVATED' : 'USER_REACTIVATED',
      entityType: 'USER',
      entityId: id,
      entityCode: existing.username,
      description: `Admin ${status === 'Suspended' ? 'deactivated' : 'reactivated'} user ${existing.username}`,
      ipAddress: ip,
    });

    return this.getUser(id);
  }

  async resetPassword(id: number, dto: ResetPasswordDto, actor: any, ip?: string) {
    const existing = await this.getUser(id);
    await this.prisma.auth_users.update({
      where: { id },
      data: {
        // M-11 fix: use async bcrypt.hash to avoid blocking the event loop
        password_hash: await bcrypt.hash(dto.password, 10),
        last_password_change_at: new Date(),
        updated_by: actor?.userId ?? null,
        updated_at: new Date(),
      },
    });

    await this.auditService.log({
      userId: actor?.userId ?? null,
      username: actor?.username ?? 'unknown',
      action: 'USER_PASSWORD_RESET',
      entityType: 'USER',
      entityId: id,
      entityCode: existing.username,
      description: `Admin reset password for ${existing.username}`,
      ipAddress: ip,
    });

    return { message: `Password reset for ${existing.username}` };
  }

  async unlockUser(id: number, actor: any, ip?: string) {
    const existing = await this.getUser(id);
    await this.prisma.auth_users.update({
      where: { id },
      data: {
        failed_login_attempts: 0,
        locked_until: null,
        updated_by: actor?.userId ?? null,
        updated_at: new Date(),
      },
    });

    await this.auditService.log({
      userId: actor?.userId ?? null,
      username: actor?.username ?? 'unknown',
      action: 'USER_UNLOCKED',
      entityType: 'USER',
      entityId: id,
      entityCode: existing.username,
      description: `Admin unlocked user ${existing.username} (per-user counters; GLOBAL lockout is separate)`,
      ipAddress: ip,
    });

    return { message: `User ${existing.username} unlocked (per-user counters cleared)` };
  }

  /** Login history: audit.audit_logs rows for LOGIN_SUCCESS / LOGIN_FAILED per user */
  async getLoginHistory(id: number, limit = 25) {
    const existing = await this.getUser(id);
    const rows = await this.prisma.audit_audit_logs.findMany({
      where: {
        OR: [{ user_id: id }, { username: existing.username }],
        action: { in: ['LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGIN_GLOBAL_LOCKED', 'LOGOUT'] },
      },
      orderBy: { created_at: 'desc' },
      take: Math.min(limit, 100),
    });
    return {
      userId: id,
      username: existing.username,
      items: rows.map((r: any) => ({
        id: r.id,
        action: r.action,
        status: r.status,
        description: r.description,
        errorMessage: r.error_message ?? null,
        ipAddress: r.ip_address ?? null,
        createdAt: r.created_at,
      })),
    };
  }

  async getSessions(id: number) {
    await this.getUser(id);
    const rows = await this.prisma.auth_sessions.findMany({
      where: { user_id: id },
      orderBy: { login_at: 'desc' },
      take: 50,
    });
    return {
      userId: id,
      items: rows.map((s: any) => ({
        id: s.id,
        ipAddress: s.ip_address,
        userAgent: s.user_agent,
        loginAt: s.login_at,
        lastActivityAt: s.last_activity_at,
        expiresAt: s.expires_at,
        status: s.status,
        revokedAt: s.revoked_at ?? null,
      })),
    };
  }

  async getLookups() {
    const roles = await this.prisma.system_hospital_roles.findMany({
      where: { deleted_at: null } as any,
      orderBy: { name: 'asc' } as any,
    });
    return {
      roles: (roles as any[]).map((r) => ({ id: Number(r.id), code: r.code, name: r.name, category: r.category ?? null })),
      statuses: ['Active', 'Suspended'],
    };
  }

  private mapUser(u: any) {
    const assignments = (u.user_role_assignments ?? []).map((a: any) => a.role).filter(Boolean);
    return {
      id: Number(u.id),
      username: u.username,
      email: u.email,
      fullName: u.full_name,
      status: u.status,
      emailVerified: !!u.email_verified,
      lastLoginAt: u.last_login_at ?? null,
      lastPasswordChangeAt: u.last_password_change_at ?? null,
      failedLoginAttempts: u.failed_login_attempts ?? 0,
      lockedUntil: u.locked_until ?? null,
      primaryRole: u.primary_role
        ? { id: Number(u.primary_role.id), code: u.primary_role.code, name: u.primary_role.name, category: u.primary_role.category ?? null }
        : null,
      roles: assignments.map((r: any) => ({ id: Number(r.id), code: r.code, name: r.name })),
      createdAt: u.created_at,
      updatedAt: u.updated_at,
    };
  }
}
