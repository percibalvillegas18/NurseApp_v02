import { Module } from '@nestjs/common';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';
import { ContractAlertsService } from './contract-alerts.service';
import { ContractAlertsScheduler } from './contract-alerts.scheduler';
import { AuditModule } from '../audit/audit.module';
import { RbacModule } from '../rbac/rbac.module';

@Module({
  imports: [AuditModule, RbacModule],
  controllers: [ContractsController],
  providers: [ContractsService, ContractAlertsService, ContractAlertsScheduler],
  exports: [ContractsService, ContractAlertsService],
})
export class ContractsModule {}
