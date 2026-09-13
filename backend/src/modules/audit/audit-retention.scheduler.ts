import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../auth/prisma.service';

interface PartitionRow {
  partition: string;
}

@Injectable()
export class AuditRetentionScheduler {
  private readonly logger = new Logger(AuditRetentionScheduler.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Drop partitions older than AUDIT_RETENTION_DAYS (default 2190 ≈ 6 years). */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async dropExpiredPartitions(): Promise<void> {
    const days: number = Number(process.env.AUDIT_RETENTION_DAYS ?? 2190);
    const cutoff: Date = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - days);

    const rows = (await this.prisma.$queryRawUnsafe(
      `
      SELECT inhrelid::regclass::text AS partition
      FROM pg_inherits
      WHERE inhparent = 'audit.audit_logs'::regclass
      `,
    )) as PartitionRow[];

    // M-18 fix: the DROP was commented out with no warning logged, so the
    // retention policy silently did nothing and partitions grew unbounded.
    // Now it logs a clear warning so operators know retention is not enforced.
    if (rows.length === 0) {
      this.logger.log('No audit partitions found (table may not be partitioned yet)');
      return;
    }
    for (const { partition } of rows) {
      // Parse YYYY_MM from name, compare to cutoff
      const match = partition.match(/_(\d{4})_(\d{2})$/);
      if (!match) {
        this.logger.debug(`Skipping non-date partition: ${partition}`);
        continue;
      }
      const partYear = parseInt(match[1], 10);
      const partMonth = parseInt(match[2], 10) - 1; // JS months are 0-based
      const partDate = new Date(Date.UTC(partYear, partMonth + 1, 0)); // last day of that month
      if (partDate < cutoff) {
        this.logger.warn(
          `RETENTION: partition ${partition} expired (before ${cutoff.toISOString().slice(0, 10)}). ` +
          `Automatic DROP is disabled — an operator must run: DROP TABLE IF EXISTS ${partition};`,
        );
        // Automatic DROP is intentionally disabled until the DBA confirms the
        // retention policy. Un-comment the line below when approved:
        // await this.prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS ${partition}`);
      } else {
        this.logger.debug(`Retention: ${partition} is within retention window`);
      }
    }
  }
}
