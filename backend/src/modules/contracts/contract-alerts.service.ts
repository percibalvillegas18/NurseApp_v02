import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../auth/prisma.service';
import { AuditService } from '../audit/audit.service';

export interface ContractAlertRow {
  id: number;
  contractId: number;
  alertType: string;
  severity: string;
  thresholdDays: number | null;
  message: string;
  endDate: string | null;
  acknowledged: boolean;
  acknowledgedBy: number | null;
  acknowledgedAt: string | null;
  createdAt: string;
  contractNumber?: string;
  jobNo?: string;
  nurseName?: string;
  agencyCode?: string;
}

export interface AlertScanResult {
  expiredMarked: number;
  alertsCreated: number;
  thresholds: number[];
  ranAt: string;
}

@Injectable()
export class ContractAlertsService {
  private readonly logger = new Logger(ContractAlertsService.name);
  private readonly defaultThresholds = [90, 60, 30, 14, 7];

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  getThresholds(): number[] {
    const raw = process.env.CONTRACT_ALERT_THRESHOLDS;
    if (!raw?.trim()) return [...this.defaultThresholds];
    const parsed = raw
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0);
    return parsed.length ? parsed.sort((a, b) => b - a) : [...this.defaultThresholds];
  }

  async runExpiryScan(actorUserId?: number): Promise<AlertScanResult> {
    const thresholds = this.getThresholds();
    this.logger.log(`Contract expiry scan starting (thresholds: ${thresholds.join(',')})`);

    const expiredRows = await this.prisma.$queryRawUnsafe<Array<{ mark_expired_contracts: number }>>(
      `SELECT nursing.mark_expired_contracts() AS mark_expired_contracts`,
    );
    const expiredMarked = Number(expiredRows?.[0]?.mark_expired_contracts ?? 0);

    const alertRows = await this.prisma.$queryRawUnsafe<
      Array<{ generate_contract_expiry_alerts: number }>
    >(
      `SELECT nursing.generate_contract_expiry_alerts($1::int[]) AS generate_contract_expiry_alerts`,
      thresholds,
    );
    const alertsCreated = Number(alertRows?.[0]?.generate_contract_expiry_alerts ?? 0);

    const ranAt = new Date().toISOString();
    this.logger.log(
      `Contract expiry scan done: expiredMarked=${expiredMarked}, alertsCreated=${alertsCreated}`,
    );

    try {
      await this.audit.log({
        userId: actorUserId,
        action: 'CONTRACT_EXPIRY_SCAN',
        entityType: 'ContractAlert',
        description: `Expiry scan: marked ${expiredMarked} expired, created ${alertsCreated} alert(s); thresholds=[${thresholds.join(',')}]`,
        status: 'Success',
      });
    } catch (e: any) {
      this.logger.warn(`Audit log for expiry scan failed: ${e?.message}`);
    }

    return { expiredMarked, alertsCreated, thresholds, ranAt };
  }

  async listAlerts(filters: {
    acknowledged?: boolean;
    severity?: string;
    alertType?: string;
    page?: number;
    limit?: number;
  }) {
    const page = filters.page || 1;
    const limit = Math.min(filters.limit || 50, 200);
    const offset = (page - 1) * limit;

    const conditions: string[] = ['1=1'];
    const params: any[] = [];
    let i = 1;

    if (filters.acknowledged === true) {
      conditions.push(`al.acknowledged = TRUE`);
    } else if (filters.acknowledged === false) {
      conditions.push(`al.acknowledged = FALSE`);
    }
    if (filters.severity) {
      conditions.push(`al.severity = $${i++}`);
      params.push(filters.severity);
    }
    if (filters.alertType) {
      conditions.push(`al.alert_type = $${i++}`);
      params.push(filters.alertType);
    }

    const where = conditions.join(' AND ');
    const countRows = await this.prisma.$queryRawUnsafe<Array<{ cnt: number }>>(
      `SELECT COUNT(*)::int AS cnt FROM nursing.contract_alerts al WHERE ${where}`,
      ...params,
    );
    const total = countRows[0]?.cnt || 0;

    params.push(limit, offset);
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT al.*,
              c.contract_number,
              c.job_no,
              a.code AS agency_code,
              n.first_name,
              n.last_name
       FROM nursing.contract_alerts al
       JOIN nursing.employment_contracts c ON c.id = al.contract_id
       JOIN nursing.nurses n ON n.id = c.nurse_id
       LEFT JOIN nursing.contract_agencies a ON a.id = c.agency_id
       WHERE ${where}
       ORDER BY
         CASE al.severity WHEN 'Critical' THEN 0 WHEN 'Warning' THEN 1 ELSE 2 END,
         al.created_at DESC
       LIMIT $${i++} OFFSET $${i++}`,
      ...params,
    );

    const items: ContractAlertRow[] = rows.map((r) => this.mapAlert(r));
    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
        hasNextPage: page * limit < total,
        hasPreviousPage: page > 1,
      },
    };
  }

  async acknowledge(alertId: number, userId: number) {
    const existing = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT id FROM nursing.contract_alerts WHERE id = $1`,
      alertId,
    );
    if (!existing?.length) throw new NotFoundException(`Alert ${alertId} not found`);

    await this.prisma.$executeRawUnsafe(
      `UPDATE nursing.contract_alerts
       SET acknowledged = TRUE,
           acknowledged_by = $2,
           acknowledged_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      alertId,
      userId,
    );

    await this.audit.log({
      userId,
      action: 'CONTRACT_ALERT_ACKNOWLEDGED',
      entityType: 'ContractAlert',
      entityId: alertId,
      description: `Acknowledged contract alert #${alertId}`,
      status: 'Success',
    });

    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT al.*, c.contract_number, c.job_no, a.code AS agency_code, n.first_name, n.last_name
       FROM nursing.contract_alerts al
       JOIN nursing.employment_contracts c ON c.id = al.contract_id
       JOIN nursing.nurses n ON n.id = c.nurse_id
       LEFT JOIN nursing.contract_agencies a ON a.id = c.agency_id
       WHERE al.id = $1`,
      alertId,
    );
    return this.mapAlert(rows[0]);
  }

  async summary() {
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT
         COUNT(*) FILTER (WHERE acknowledged = FALSE)::int AS unacknowledged,
         COUNT(*) FILTER (WHERE acknowledged = FALSE AND severity = 'Critical')::int AS critical,
         COUNT(*) FILTER (WHERE acknowledged = FALSE AND severity = 'Warning')::int AS warning,
         COUNT(*) FILTER (WHERE acknowledged = FALSE AND severity = 'Info')::int AS info,
         COUNT(*) FILTER (WHERE alert_type = 'EXPIRED' AND acknowledged = FALSE)::int AS expired,
         COUNT(*) FILTER (WHERE alert_type = 'EXPIRING_SOON' AND acknowledged = FALSE)::int AS expiring
       FROM nursing.contract_alerts`,
    );
    const r = rows[0] || {};
    return {
      unacknowledged: Number(r.unacknowledged || 0),
      critical: Number(r.critical || 0),
      warning: Number(r.warning || 0),
      info: Number(r.info || 0),
      expired: Number(r.expired || 0),
      expiring: Number(r.expiring || 0),
    };
  }

  private mapAlert(r: any): ContractAlertRow {
    return {
      id: Number(r.id),
      contractId: Number(r.contract_id),
      alertType: r.alert_type,
      severity: r.severity,
      thresholdDays: r.threshold_days != null ? Number(r.threshold_days) : null,
      message: r.message,
      endDate: r.end_date,
      acknowledged: !!r.acknowledged,
      acknowledgedBy: r.acknowledged_by != null ? Number(r.acknowledged_by) : null,
      acknowledgedAt: r.acknowledged_at,
      createdAt: r.created_at,
      contractNumber: r.contract_number,
      jobNo: r.job_no,
      nurseName: [r.first_name, r.last_name].filter(Boolean).join(' ') || undefined,
      agencyCode: r.agency_code,
    };
  }
}
