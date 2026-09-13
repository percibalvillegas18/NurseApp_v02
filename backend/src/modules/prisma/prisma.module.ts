import { Global, Module } from '@nestjs/common';
import { PrismaService } from '../auth/prisma.service';

/**
 * Single, global PrismaService.
 *
 * PrismaService used to be listed in the `providers` of five different modules
 * (auth, audit, nursing, rbac, users). Nest instantiates providers per module,
 * so that meant five PrismaClient objects and five connection pools against the
 * same database - and any per-instance state (the mock-mode flag, the
 * $queryRawUnsafe fallback) existed five times over.
 *
 * Registering it once in a @Global module means every injector receives the
 * same instance, and no feature module has to declare it.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
