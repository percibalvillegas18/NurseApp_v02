import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../auth/prisma.service';

export interface AuditLogInput {
  userId?: number;
  username?: string;
  action: string;
  entityType: string;
  entityId?: number;
  entityCode?: string;
  description?: string;
  changes?: any;
  reason?: string;
  ipAddress?: string;
  userAgent?: string;
  sessionId?: string;
  requestId?: string;
  status?: 'Success' | 'Failure' | 'Denied';
  errorMessage?: string;
  metadata?: any;
}

export interface AuditChainBreak {
  id: bigint | number;
  expected_prev: string | null;
  actual_prev: string | null;
  problem: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Append-only write. Hash chain (prev_hash / entry_hash) is computed by the
   * database BEFORE INSERT trigger (V3_5) so the application cannot forge a
   * consistent chain.
   */
  async log(input: AuditLogInput) {
    try {
      const changes = input.changes || input.metadata || null;

      const log = await this.prisma.audit_audit_logs.create({
        data: {
          user_id: input.userId,
          username: input.username,
          action: input.action,
          entity_type: input.entityType,
          entity_id: input.entityId,
          entity_code: input.entityCode,
          description: input.description,
          changes: changes,
          reason: input.reason,
          ip_address: input.ipAddress,
          user_agent: input.userAgent,
          session_id: input.sessionId,
          request_id: input.requestId,
          status: input.status || 'Success',
          error_message: input.errorMessage,
          // prev_hash + entry_hash are set by trg_audit_hash_chain
        },
      });

      return log;
    } catch (error) {
      // C-6 fix: log at FATAL level and re-throw for security-critical actions
      // so that a silently broken audit trail does not go unnoticed.
      const critical = ['LOGIN_SUCCESS', 'LOGIN_FAILURE', 'ACCESS_DENIED', 'USER_PASSWORD_RESET',
        'AUDIT_EXPORT', 'USER_CREATED', 'USER_DEACTIVATED'].includes(input.action);
      this.logger.error(
        `${critical ? 'CRITICAL ' : ''}Failed to write audit log (action=${input.action}): ${error.message}`,
        error.stack,
      );
      if (critical) {
        throw error; // halt the operation rather than silently losing security-relevant audit
      }
      return null;
    }
  }

  async logSecurityEvent(input: AuditLogInput & { status: 'Denied' | 'Failure' }) {
    this.logger.warn(
      `SECURITY EVENT: ${input.action} by user ${input.username || input.userId} - ${input.description}`,
    );
    return this.log({
      ...input,
      status: input.status || 'Denied',
    });
  }

  /**
   * Verify the cryptographic hash chain.
   * Returns an empty array when the chain is intact.
   * Any returned row indicates tampering or corruption.
   */
  async verifyChain(fromId?: number, toId?: number): Promise<AuditChainBreak[]> {
    try {
      const rows = await this.prisma.$queryRawUnsafe<AuditChainBreak[]>(
        `SELECT id, expected_prev, actual_prev, problem
         FROM audit.verify_audit_chain($1::bigint, $2::bigint)`,
        fromId ?? null,
        toId ?? null,
      );
      if (rows.length > 0) {
        this.logger.error(
          `AUDIT CHAIN INTEGRITY FAILURE: ${rows.length} broken link(s) detected`,
          JSON.stringify(rows),
        );
      }
      return rows;
    } catch (error) {
      this.logger.error(`verifyChain failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  /** Latest tip of the chain (for monitoring / external mirror). */
  async getLatestHash(): Promise<{ id: bigint; entry_hash: string } | null> {
    const row = await this.prisma.audit_audit_logs.findFirst({
      orderBy: { id: 'desc' },
      select: { id: true, entry_hash: true },
    });
    return row as any;
  }

  async getLogs(filters: {
    userId?: number;
    action?: string;
    entityType?: string;
    startDate?: Date;
    endDate?: Date;
    status?: string;
    page?: number;
    limit?: number;
  }) {
    const page = filters.page || 1;
    const limit = Math.min(filters.limit || 20, 100);
    const skip = (page - 1) * limit;

    const where: any = {};

    if (filters.userId) where.user_id = filters.userId;
    if (filters.action) where.action = { contains: filters.action, mode: 'insensitive' };
    if (filters.entityType) where.entity_type = filters.entityType;
    if (filters.status) where.status = filters.status;
    if (filters.startDate || filters.endDate) {
      where.created_at = {};
      if (filters.startDate) where.created_at.gte = filters.startDate;
      if (filters.endDate) where.created_at.lte = filters.endDate;
    }

    const [items, total] = await Promise.all([
      this.prisma.audit_audit_logs.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.audit_audit_logs.count({ where }),
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

  async getStatistics(period: string = '7days') {
    let days = 7;
    if (period === '30days') days = 30;
    if (period === '90days') days = 90;

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [totalLogs, deniedLogs, failedLogins, configChanges] = await Promise.all([
      this.prisma.audit_audit_logs.count({
        where: { created_at: { gte: since } },
      }),
      this.prisma.audit_audit_logs.count({
        where: { created_at: { gte: since }, status: 'Denied' },
      }),
      this.prisma.audit_audit_logs.count({
        where: { created_at: { gte: since }, action: 'LOGIN_FAILURE' },
      }),
      this.prisma.audit_audit_logs.count({
        where: { created_at: { gte: since }, action: { contains: 'CONFIGURATION_CHANGE' } },
      }),
    ]);

    const byAction = (await this.prisma.$queryRawUnsafe(
      `SELECT action, COUNT(*) as count FROM audit.audit_logs WHERE created_at >= $1 GROUP BY action ORDER BY count DESC LIMIT 10`,
      since,
    )) as any[];

    return {
      period,
      since,
      totals: {
        totalLogs,
        deniedLogs,
        failedLogins,
        configChanges,
      },
      byAction,
    };
  }
}
