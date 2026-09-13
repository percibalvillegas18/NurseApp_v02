import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { AuditRetentionScheduler } from './audit-retention.scheduler';
import { RbacModule } from '../rbac/rbac.module';

/**
 * Global so AuditService can be injected anywhere (RbacService, AuthService and
 * RbacGuard all write to the audit trail) without every module re-importing it.
 *
 * RbacModule is imported because AuditController's endpoints are protected by
 * RbacGuard, which needs EffectiveAccessService. RbacModule must therefore NOT
 * import AuditModule back - the dependency only runs one way, and AuditService
 * stays injectable there through this @Global() export.
 */
@Global()
@Module({
  imports: [RbacModule],
  controllers: [AuditController],
  providers: [AuditService, AuditRetentionScheduler],
  exports: [AuditService],
})
export class AuditModule {}
