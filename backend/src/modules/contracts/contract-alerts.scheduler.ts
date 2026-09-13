import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ContractAlertsService } from './contract-alerts.service';

/**
 * Daily automated contract expiry / renewal alert job.
 * Schedule: 06:00 server local time.
 * Disable with CONTRACT_ALERTS_ENABLED=false
 */
@Injectable()
export class ContractAlertsScheduler {
  private readonly logger = new Logger(ContractAlertsScheduler.name);

  constructor(private readonly alerts: ContractAlertsService) {}

  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async handleDailyExpiryScan() {
    if (process.env.CONTRACT_ALERTS_ENABLED === 'false') {
      this.logger.debug('Contract expiry alerts disabled (CONTRACT_ALERTS_ENABLED=false)');
      return;
    }

    try {
      const result = await this.alerts.runExpiryScan();
      this.logger.log(
        `Scheduled contract expiry scan: expired=${result.expiredMarked}, alerts=${result.alertsCreated}`,
      );
    } catch (err: any) {
      this.logger.error(`Scheduled contract expiry scan failed: ${err?.message}`, err?.stack);
    }
  }
}
