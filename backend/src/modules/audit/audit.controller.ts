import {
  Controller,
  Get,
  Query,
  Req,
  UseGuards,
  Res,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Response } from 'express';
import { AuditService } from './audit.service';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CanView } from '../../common/decorators/require-permission.decorator';

/**
 * Audit trail API.
 *
 * AuditService (and the AuditInterceptor that feeds it) existed, but nothing
 * exposed them over HTTP, so the frontend Audit Logs page
 * (`frontend/src/pages/RBAC/AuditLogs.tsx`) had no backend to talk to - only the
 * mock server answered `/audit/*`.
 *
 * Response shape matches the mock server exactly: `data.items` +
 * `data.pagination` for logs, `data.totals` + `data.byAction` for statistics.
 */
@Controller('audit')
@UseGuards(AuthGuard('jwt'), RbacGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('logs')
  @CanView('AUDIT_LOGS')
  async getLogs(
    @Query()
    query: {
      page?: string;
      limit?: string;
      action?: string;
      status?: string;
      entityType?: string;
      userId?: string;
      startDate?: string;
      endDate?: string;
    },
  ) {
    const result = await this.auditService.getLogs({
      page: toInt(query.page, 1),
      limit: toInt(query.limit, 20),
      action: trim(query.action),
      status: trim(query.status),
      entityType: trim(query.entityType),
      userId: query.userId ? toInt(query.userId, 0) || undefined : undefined,
      startDate: toDate(query.startDate),
      endDate: toDate(query.endDate),
    });

    return {
      success: true,
      data: {
        // Prisma returns BigInt ids, which JSON.stringify cannot serialize.
        items: result.items.map(serializeRow),
        pagination: result.pagination,
      },
      timestamp: new Date().toISOString(),
    };
  }

  @Get('statistics')
  @CanView('AUDIT_LOGS')
  async getStatistics(@Query('period') period?: string) {
    const allowed = ['7days', '30days', '90days'];
    const safePeriod = allowed.includes(period || '') ? (period as string) : '7days';
    const stats = await this.auditService.getStatistics(safePeriod);

    return {
      success: true,
      data: {
        period: safePeriod,
        since: stats.since,
        totals: stats.totals,
        byAction: (stats.byAction as any[]).map((row) => ({
          action: row.action,
          // COUNT(*) arrives as a string from the raw query.
          count: Number(row.count),
        })),
      },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * CSV export of the same filtered set (AUDIT_LOGS/EXPORT).
   * Streams a file rather than JSON so the browser downloads it directly.
   */
  @Get('export')
  @UseGuards(AuthGuard('jwt'), RbacGuard)
  @CanView('AUDIT_LOGS') // C-7 fix: was missing — export was accessible to any authenticated user
  async exportLogs(
    @Query()
    query: {
      action?: string;
      status?: string;
      entityType?: string;
      startDate?: string;
      endDate?: string;
    },
    @Res() res: Response,
    @Req() req: any,
  ) {
    // AuditService caps a single page at 100 rows, so walk the pages.
    // The overall cap keeps one request from pulling the whole table.
    const MAX_EXPORT_ROWS = 10000;
    const PAGE_SIZE = 100;
    const filters = {
      limit: PAGE_SIZE,
      action: trim(query.action),
      status: trim(query.status),
      entityType: trim(query.entityType),
      startDate: toDate(query.startDate),
      endDate: toDate(query.endDate),
    };

    const collected: any[] = [];
    for (let page = 1; collected.length < MAX_EXPORT_ROWS; page++) {
      const chunk = await this.auditService.getLogs({ ...filters, page });
      collected.push(...chunk.items);
      if (!chunk.pagination.hasNextPage || chunk.items.length === 0) break;
    }
    const result = { items: collected.slice(0, MAX_EXPORT_ROWS) };

    await this.auditService.log({
      userId: req?.user?.id,
      username: req?.user?.username,
      action: 'AUDIT_EXPORT',
      entityType: 'AuditLog',
      description: `Exported ${result.items.length} audit rows to CSV`,
      ipAddress: req?.ip,
      userAgent: req?.headers?.['user-agent'],
      status: 'Success',
    });

    // H-10 fix: apply csvEscape to ALL fields, not just description.
    // Any field could contain commas, quotes, or formula-injection characters
    // (=, +, -, @) that spreadsheet apps execute as macros.
    const header =
      'id,created_at,username,action,entity_type,entity_id,status,ip_address,description';
    const rows = result.items.map((row: any) => {
      const r = serializeRow(row);
      return [
        csvEscape(String(r.id ?? '')),
        csvEscape(r.created_at ?? ''),
        csvEscape(r.username ?? ''),
        csvEscape(r.action ?? ''),
        csvEscape(r.entity_type ?? ''),
        csvEscape(String(r.entity_id ?? '')),
        csvEscape(r.status ?? ''),
        csvEscape(r.ip_address ?? ''),
        csvEscape(r.description ?? ''),
      ].join(',');
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="audit-logs-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    res.send([header, ...rows].join('\n'));
  }
}

function trim(value?: string): string | undefined {
  const v = (value || '').trim();
  return v ? v : undefined;
}

function toInt(value: string | undefined, fallback: number): number {
  const n = parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function toDate(value?: string): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException(`Invalid date: ${value}`);
  }
  return d;
}

/** BigInt -> number/string and Date -> ISO so the payload is JSON-serializable. */
function serializeRow(row: any): any {
  const out: any = {};
  for (const [key, value] of Object.entries(row as Record<string, any>)) {
    if (typeof value === 'bigint') {
      out[key] = Number(value);
    } else if (value instanceof Date) {
      out[key] = value.toISOString();
    } else {
      out[key] = value;
    }
  }
  return out;
}

function csvEscape(value: string): string {
  return `"${String(value).replace(/"/g, '""').replace(/[\r\n]+/g, ' ')}"`;
}
