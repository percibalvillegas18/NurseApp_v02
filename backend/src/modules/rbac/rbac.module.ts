import { Module } from '@nestjs/common';
import { RbacController } from './rbac.controller';
import { RbacService } from './rbac.service';
import { EffectiveAccessService } from './effective-access.service';
import { RedisModule } from '../redis/redis.module';

@Module({
  // AuditModule is @Global and itself imports RbacModule (for RbacGuard), so
  // importing it here would be a circular dependency. AuditService is still
  // injectable in RbacService via the global export.
  imports: [RedisModule],
  controllers: [RbacController],
  providers: [RbacService, EffectiveAccessService],
  exports: [RbacService, EffectiveAccessService],
})
export class RbacModule {}
