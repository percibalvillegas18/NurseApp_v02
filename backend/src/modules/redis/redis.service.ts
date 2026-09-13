import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { ResourceType } from '../../common/types';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis;
  private isConnected = false;

  constructor(private configService: ConfigService) {
    const host = configService.get('REDIS_HOST', 'localhost');
    const port = parseInt(configService.get('REDIS_PORT', '6379'), 10);
    const password = configService.get('REDIS_PASSWORD');
    const db = parseInt(configService.get('REDIS_DB', '0'), 10);

    this.client = new Redis({
      host,
      port,
      password: password || undefined,
      db,
      /**
       * Exponential backoff with jitter, and no retry limit.
       *
       * The previous strategy returned null after 10 attempts, which permanently
       * closed the client: a Redis restart longer than ~1s left this process
       * with caching (and shared login throttling) silently disabled until the
       * whole app was redeployed. Keep trying forever - every operation is
       * already guarded by isReady(), so being disconnected is safe.
       */
      retryStrategy: (times) => {
        const backoff = Math.min(50 * Math.pow(2, Math.min(times - 1, 9)), 30000);
        const jitter = Math.floor(Math.random() * 250);
        if (times === 1 || times % 10 === 0) {
          this.logger.warn(
            `Redis reconnect attempt #${times} in ${backoff + jitter}ms (retrying indefinitely)`,
          );
        }
        return backoff + jitter;
      },
      /** Drop a command after 3 tries instead of queueing it forever offline. */
      maxRetriesPerRequest: 3,
      /** Recover from a half-open socket instead of waiting for the OS timeout. */
      enableOfflineQueue: false,
      reconnectOnError: (err) => {
        const targetErrors = ['READONLY', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE'];
        return targetErrors.some((code) => err.message.includes(code));
      },
      lazyConnect: true,
    });

    this.client.on('connect', () => {
      this.logger.log('🔌 Redis connecting...');
    });

    this.client.on('ready', () => {
      const wasDown = !this.isConnected;
      this.isConnected = true;
      this.logger.log('✅ Redis connected and ready');
      if (wasDown) {
        // Cached RBAC decisions may be stale relative to changes made while we
        // were disconnected - drop them rather than serve wrong answers.
        this.logger.warn(
          'Redis recovered after an outage: clearing RBAC cache to avoid stale access decisions',
        );
        void this.invalidateAllRbacCache();
      }
    });

    this.client.on('reconnecting', (delay: number) => {
      this.isConnected = false;
      this.logger.warn(`Redis reconnecting in ${delay}ms`);
    });

    this.client.on('error', (err: any) => {
      // ECONNREFUSED arrives with an empty message, which used to log as
      // "Redis error: " with no clue what went wrong.
      const reason = err?.message || err?.code || String(err);
      this.logger.error(`Redis error: ${reason}`);
      this.isConnected = false;
    });

    this.client.on('close', () => {
      this.isConnected = false;
      this.logger.warn('Redis connection closed');
    });
  }

  async onModuleInit() {
    try {
      await this.client.connect();
    } catch (error) {
      this.logger.warn(`Redis connection failed, caching disabled: ${error.message}`);
      this.isConnected = false;
    }
  }

  async onModuleDestroy() {
    try {
      await this.client.quit();
    } catch (error) {
      this.logger.warn(`Error closing Redis: ${error.message}`);
    }
  }

  getClient(): Redis {
    return this.client;
  }

  isReady(): boolean {
    return this.isConnected;
  }

  /**
   * Real Redis health check - issues a PING and measures latency.
   * Note: Redis being down is NOT fatal (cache fails open to DB),
   * so callers should treat 'error' as degraded, not down.
   */
  async healthCheck(): Promise<{
    status: 'ok' | 'error';
    latencyMs: number;
    error?: string;
  }> {
    if (!this.isReady()) {
      return { status: 'error', latencyMs: 0, error: 'not connected' };
    }
    const start = Date.now();
    try {
      const pong = await this.client.ping();
      if (pong !== 'PONG') {
        return { status: 'error', latencyMs: Date.now() - start, error: `unexpected reply: ${pong}` };
      }
      return { status: 'ok', latencyMs: Date.now() - start };
    } catch (error: any) {
      return { status: 'error', latencyMs: Date.now() - start, error: error.message };
    }
  }

  // ========================================================================
  // Generic cache methods
  // ========================================================================

  async get<T>(key: string): Promise<T | null> {
    if (!this.isReady()) return null;
    try {
      const value = await this.client.get(key);
      if (!value) return null;
      return JSON.parse(value) as T;
    } catch (error) {
      this.logger.warn(`Redis GET failed for ${key}: ${error.message}`);
      return null;
    }
  }

  async set(key: string, value: any, ttlSeconds: number): Promise<boolean> {
    if (!this.isReady()) return false;
    try {
      const serialized = JSON.stringify(value);
      if (ttlSeconds > 0) {
        await this.client.setex(key, ttlSeconds, serialized);
      } else {
        await this.client.set(key, serialized);
      }
      return true;
    } catch (error) {
      this.logger.warn(`Redis SET failed for ${key}: ${error.message}`);
      return false;
    }
  }

  async del(key: string): Promise<boolean> {
    if (!this.isReady()) return false;
    try {
      await this.client.del(key);
      return true;
    } catch (error) {
      this.logger.warn(`Redis DEL failed for ${key}: ${error.message}`);
      return false;
    }
  }

  async delPattern(pattern: string): Promise<number> {
    if (!this.isReady()) return 0;
    try {
      let cursor = '0';
      let deleted = 0;
      do {
        const [nextCursor, keys] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = nextCursor;
        if (keys.length > 0) {
          await this.client.del(...keys);
          deleted += keys.length;
        }
      } while (cursor !== '0');
      return deleted;
    } catch (error) {
      this.logger.warn(`Redis delPattern failed for ${pattern}: ${error.message}`);
      return 0;
    }
  }

  async exists(key: string): Promise<boolean> {
    if (!this.isReady()) return false;
    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch {
      return false;
    }
  }

  async ttl(key: string): Promise<number> {
    if (!this.isReady()) return -1;
    try {
      return await this.client.ttl(key);
    } catch {
      return -1;
    }
  }

  // ========================================================================
  // RBAC-specific cache keys
  // ========================================================================

  /**
   * Key for evaluate_access cache
   * Format: rbac:access:{userId}:{menuCode}:{permissionCode}:{resourceId|_}
   * Example: rbac:access:1:NURSE_MASTER:VIEW:_
   *          rbac:access:1:NURSE_MASTER:EDIT:42
   */
  buildAccessKey(
    userId: number,
    menuCode: string,
    permissionCode: string,
    resourceId?: number | null,
    resourceType?: ResourceType | null,
  ): string {
    const rid = resourceId != null ? String(resourceId) : '_';
    const rt = resourceType ?? '_';
    return `rbac:access:${userId}:${menuCode}:${permissionCode}:${rt}:${rid}`;
  }

  /**
   * Key for full access matrix
   * Format: rbac:full:{userId}
   */
  buildFullAccessKey(userId: number): string {
    return `rbac:full:${userId}`;
  }

  /**
   * Key for accessible menus
   * Format: rbac:menus:{userId}
   */
  buildMenusKey(userId: number): string {
    return `rbac:menus:${userId}`;
  }

  /**
   * Key for role-based invalidation tracking
   * Format: rbac:role:{roleCode}:users -> Set of userIds that have this role
   */
  buildRoleUsersKey(roleCode: string): string {
    return `rbac:role:${roleCode}:users`;
  }

  // ========================================================================
  // RBAC cache operations
  // ========================================================================

  async getAccessDecision<T>(
    userId: number,
    menuCode: string,
    permissionCode: string,
    resourceId?: number | null,
    resourceType?: ResourceType | null,
  ): Promise<T | null> {
    const key = this.buildAccessKey(userId, menuCode, permissionCode, resourceId, resourceType);
    return this.get<T>(key);
  }

  async setAccessDecision(
    userId: number,
    menuCode: string,
    permissionCode: string,
    resourceId: number | null | undefined,
    decision: any,
    ttl: number,
    resourceType?: ResourceType | null,
  ): Promise<boolean> {
    const key = this.buildAccessKey(userId, menuCode, permissionCode, resourceId, resourceType);
    const result = await this.set(key, decision, ttl);
    if (result) {
      this.logger.debug(`Cached access decision ${key} TTL=${ttl}s decision=${decision.decision}`);
    }
    return result;
  }

  async getFullAccess<T>(userId: number): Promise<T | null> {
    return this.get<T>(this.buildFullAccessKey(userId));
  }

  async setFullAccess(userId: number, data: any, ttl = 300): Promise<boolean> {
    return this.set(this.buildFullAccessKey(userId), data, ttl);
  }

  async getAccessibleMenus<T>(userId: number): Promise<T | null> {
    return this.get<T>(this.buildMenusKey(userId));
  }

  async setAccessibleMenus(userId: number, menus: any, ttl = 300): Promise<boolean> {
    return this.set(this.buildMenusKey(userId), menus, ttl);
  }

  // ========================================================================
  // Invalidation strategies
  // ========================================================================

  /**
   * Invalidate all cache for a specific user
   * Called when: user role assignment changes, data scope changes, user status changes
   */
  async invalidateUserCache(userId: number): Promise<number> {
    this.logger.log(`Invalidating cache for user ${userId}`);
    const patterns = [
      `rbac:access:${userId}:*`,
      `rbac:full:${userId}`,
      `rbac:menus:${userId}`,
    ];

    let totalDeleted = 0;
    for (const pattern of patterns) {
      const deleted = await this.delPattern(pattern);
      totalDeleted += deleted;
    }

    this.logger.log(`Invalidated ${totalDeleted} keys for user ${userId}`);
    return totalDeleted;
  }

  /**
   * Invalidate cache for all users having a specific role
   * Called when: role_menu_access or role_permissions changes for a role
   */
  async invalidateRoleCache(roleCode: string): Promise<number> {
    this.logger.log(`Invalidating cache for role ${roleCode}`);

    // First, try to get users with this role from cache tracking
    // If not tracked, fallback to pattern deletion for all users (more expensive)
    // For now, we delete all access keys that might be affected by this role
    // This is O(N) but acceptable for RBAC config changes which are infrequent

    // Pattern to delete all access decisions (since we don't know which users have this role without DB query)
    // In production, you would query DB for users with this role and invalidate only them
    // Here we implement both: try role tracking, fallback to full scan if needed

    let totalDeleted = 0;

    // Delete all full and menus cache (since role change affects them)
    // We need to delete for all users - scan all rbac:full:* and rbac:menus:*
    // But we can optimize by only deleting if we have role->users mapping

    // Attempt to get tracked users for this role
    const roleUsersKey = this.buildRoleUsersKey(roleCode);
    const trackedUserIds = await this.get<number[]>(roleUsersKey);

    if (trackedUserIds && trackedUserIds.length > 0) {
      // Precise invalidation
      for (const userId of trackedUserIds) {
        const deleted = await this.invalidateUserCache(userId);
        totalDeleted += deleted;
      }
      this.logger.log(`Precise invalidation for role ${roleCode}: ${trackedUserIds.length} users, ${totalDeleted} keys`);
    } else {
      // Fallback: invalidate all RBAC cache (safe but expensive)
      // Only do this for role config changes which are rare and critical
      this.logger.warn(`No tracked users for role ${roleCode}, falling back to full RBAC cache invalidation`);
      const patterns = [
        `rbac:access:*`,
        `rbac:full:*`,
        `rbac:menus:*`,
      ];
      for (const pattern of patterns) {
        const deleted = await this.delPattern(pattern);
        totalDeleted += deleted;
      }
      this.logger.log(`Full invalidation for role ${roleCode}: ${totalDeleted} keys deleted`);
    }

    return totalDeleted;
  }

  /**
   * Track which users have which roles (for precise invalidation)
   * Call this when user role assignment changes
   */
  async trackUserRoles(userId: number, roleCodes: string[]): Promise<void> {
    if (!this.isReady()) return;

    // M-9 fix: use Redis SADD for atomic set membership instead of the
    // racy JSON-array GET/SET pattern. Two concurrent calls could both read
    // the same array, each append a different userId, and the last writer
    // would silently drop the other's addition.
    const client = this.getClient();
    for (const roleCode of roleCodes) {
      const key = this.buildRoleUsersKey(roleCode);
      try {
        await client.sAdd(key, String(userId));
        await client.expire(key, 3600); // 1h tracking TTL
      } catch (error) {
        this.logger.warn(`Failed to track user ${userId} for role ${roleCode}: ${error.message}`);
      }
    }
  }

  /**
   * Invalidate all RBAC cache (nuclear option)
   * Called when: major RBAC reconfiguration, deployment, etc.
   */
  async invalidateAllRbacCache(): Promise<number> {
    this.logger.warn('Invalidating ALL RBAC cache (nuclear)');
    const patterns = [
      `rbac:access:*`,
      `rbac:full:*`,
      `rbac:menus:*`,
      `rbac:role:*:users`,
    ];

    let totalDeleted = 0;
    for (const pattern of patterns) {
      const deleted = await this.delPattern(pattern);
      totalDeleted += deleted;
    }

    this.logger.warn(`Nuclear invalidation: ${totalDeleted} keys deleted`);
    return totalDeleted;
  }

  // ========================================================================
  // Session caching (for auth)
  // ========================================================================

  async setSession(sessionId: string, data: any, ttl = 3600): Promise<boolean> {
    return this.set(`session:${sessionId}`, data, ttl);
  }

  async getSession<T>(sessionId: string): Promise<T | null> {
    return this.get<T>(`session:${sessionId}`);
  }

  async delSession(sessionId: string): Promise<boolean> {
    return this.del(`session:${sessionId}`);
  }

  // ========================================================================
  // Metrics
  // ========================================================================

  async getCacheStats(): Promise<{ keys: number; memory: string }> {
    if (!this.isReady()) {
      return { keys: 0, memory: 'N/A - Redis not connected' };
    }
    try {
      const info = await this.client.info('memory');
      const dbSize = await this.client.dbsize();
      return {
        keys: dbSize,
        memory: info,
      };
    } catch (error) {
      return { keys: 0, memory: `Error: ${error.message}` };
    }
  }
}
