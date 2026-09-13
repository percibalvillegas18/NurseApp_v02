import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from './modules/auth/prisma.service';
import { RedisService } from './modules/redis/redis.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Basic liveness - process is up and serving requests.
   * Suitable for orchestrator liveness probes.
   */
  // M-15 fix: remove uptime and version from the unauthenticated liveness
  // endpoint. These leak deployment timing (uptime reveals restart schedule)
  // and version information useful for targeting known vulnerabilities.
  @Get()
  health() {
    return {
      success: true,
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Readiness - performs REAL dependency checks:
   * - database: runs SELECT 1 via Prisma (status 'ok' | 'mock' | 'error')
   * - redis: issues PING (status 'ok' | 'error')
   *
   * Overall status:
   * - 'ready'     -> real DB answering and Redis answering
   * - 'degraded'  -> DB in mock mode (preview/demo) or Redis down
   *                  (cache fails open to DB, so service still works)
   * - 'not_ready' -> real DB query failed (503)
   */
  @Get('ready')
  async ready() {
    const [database, redis] = await Promise.all([
      this.prisma.healthCheck(),
      this.redisService.healthCheck(),
    ]);

    const degraded = database.status === 'mock' || redis.status === 'error';

    const payload = {
      success: database.status !== 'error',
      status: database.status === 'error' ? 'not_ready' : degraded ? 'degraded' : 'ready',
      checks: {
        database,
        redis,
      },
      timestamp: new Date().toISOString(),
    };

    // Orchestrators must see a non-2xx when the service genuinely cannot operate
    if (database.status === 'error') {
      throw new ServiceUnavailableException(payload);
    }

    return payload;
  }

  /**
   * Explicit liveness alias for orchestrators that expect /live.
   */
  @Get('live')
  live() {
    return {
      success: true,
      status: 'alive',
      timestamp: new Date().toISOString(),
    };
  }
}
