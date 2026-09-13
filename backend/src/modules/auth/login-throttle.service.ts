import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

/**
 * Login throttling.
 *
 * This replaces the previous process-wide `globalAttempts` counter, where five
 * failed logins from *anyone* — even with a username that does not exist —
 * locked *every* account in the hospital for ten minutes. That is a
 * one-request denial of service against a clinical system, and because the
 * counter lived in process memory it did nothing across replicas and reset on
 * every deploy.
 *
 * Model now:
 *   - a KNOWN account is throttled on its own counter (5 fails -> 10 min lock).
 *     One person's typos can never lock anybody else out.
 *   - an UNKNOWN username is throttled per client IP at a much higher threshold
 *     (20 fails -> 10 min) purely as a username-enumeration brake. The loose
 *     threshold is deliberate: a whole hospital can sit behind one NAT egress
 *     IP, so a tight IP lock would reintroduce the global lockout.
 *
 * Counters live in Redis when it is available (shared across instances,
 * survives restarts) and fall back to an in-process Map otherwise so a
 * single-instance dev/preview deployment still throttles.
 */

export const MAX_ATTEMPTS_PER_ACCOUNT = 5;
export const MAX_ATTEMPTS_PER_IP = 20;
export const LOCK_DURATION_SECONDS = 10 * 60;

export type ThrottleScope = 'account' | 'ip';

export interface ThrottleStatus {
  failedAttempts: number;
  remainingAttempts: number;
  maxAttempts: number;
  isLocked: boolean;
  /** Seconds until the lock expires; 0 when not locked. */
  remainingSeconds: number;
  lockedUntil: Date | null;
  scope: ThrottleScope;
}

interface MemoryRecord {
  count: number;
  lockedUntil: number | null;
}

@Injectable()
export class LoginThrottleService {
  private readonly logger = new Logger(LoginThrottleService.name);
  /** Fallback store for when Redis is unavailable. */
  private readonly memory = new Map<string, MemoryRecord>();

  constructor(private readonly redis: RedisService) {}

  private key(scope: ThrottleScope, identifier: string): string {
    return `login:throttle:${scope}:${identifier.toLowerCase()}`;
  }

  private static normalise(identifier: string | undefined | null): string {
    return String(identifier || 'unknown').trim().toLowerCase() || 'unknown';
  }

  // --------------------------------------------------------------------------
  // Store access (Redis when ready, memory otherwise)
  // --------------------------------------------------------------------------

  private async read(scope: ThrottleScope, identifier: string): Promise<MemoryRecord> {
    const key = this.key(scope, identifier);

    if (this.redis.isReady()) {
      try {
        const raw = await this.redis.get<{ count: number; lockedUntil: number | null }>(key);
        if (!raw) return { count: 0, lockedUntil: null };
        // Let an expired lock clear itself.
        if (raw.lockedUntil && raw.lockedUntil <= Date.now()) {
          await this.clear(scope, identifier);
          return { count: 0, lockedUntil: null };
        }
        return { count: raw.count || 0, lockedUntil: raw.lockedUntil ?? null };
      } catch (error: any) {
        // L-7 fix: log at ERROR level when falling back to in-memory counters.
        // The previous WARN was easy to miss, and the in-memory fallback resets
        // on every deploy, which means throttle state is lost and an attacker
        // can time brute-force attempts around deployments.
        this.logger.error(
          `SECURITY: Redis read failed for ${key}: ${error.message} — ` +
          `falling back to per-process in-memory throttle. ` +
          `Counters will NOT survive restarts or span replicas.`,
        );
      }
    } else {
      // L-7 fix: log once per scope/identifier when Redis is entirely unavailable
      this.logger.warn(
        `Throttle for ${scope}:${identifier} using in-memory fallback (Redis unavailable). ` +
        `Counters reset on deploy.`,
      );
    }

    const record = this.memory.get(key) || { count: 0, lockedUntil: null };
    if (record.lockedUntil && record.lockedUntil <= Date.now()) {
      this.memory.delete(key);
      return { count: 0, lockedUntil: null };
    }
    return record;
  }

  private async write(
    scope: ThrottleScope,
    identifier: string,
    record: MemoryRecord,
  ): Promise<void> {
    const key = this.key(scope, identifier);
    // Keep the key alive a little longer than the lock so counters do not
    // vanish mid-window, but never let them live forever.
    const ttl = record.lockedUntil
      ? Math.max(60, Math.ceil((record.lockedUntil - Date.now()) / 1000))
      : LOCK_DURATION_SECONDS;

    if (this.redis.isReady()) {
      try {
        await this.redis.set(key, record, ttl);
        return;
      } catch (error: any) {
        this.logger.warn(`Redis write failed for ${key}: ${error.message} - using in-memory counter`);
      }
    }
    this.memory.set(key, record);
  }

  /** Clear a counter (successful login, or an admin unlock). */
  async clear(scope: ThrottleScope, identifier: string): Promise<void> {
    const key = this.key(scope, identifier);
    this.memory.delete(key);
    if (this.redis.isReady()) {
      try {
        await this.redis.del(key);
      } catch (error: any) {
        this.logger.warn(`Redis delete failed for ${key}: ${error.message}`);
      }
    }
  }

  /** Clear every counter - admin/dev utility only. */
  async clearAll(): Promise<number> {
    const memoryKeys = this.memory.size;
    this.memory.clear();
    let deleted = memoryKeys;
    if (this.redis.isReady()) {
      try {
        deleted += await this.redis.delPattern('login:throttle:*');
      } catch (error: any) {
        this.logger.warn(`Redis pattern delete failed: ${error.message}`);
      }
    }
    return deleted;
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  private toStatus(record: MemoryRecord, scope: ThrottleScope, max: number): ThrottleStatus {
    const locked = !!record.lockedUntil && record.lockedUntil > Date.now();
    const remainingMs = locked ? record.lockedUntil! - Date.now() : 0;
    return {
      failedAttempts: record.count,
      remainingAttempts: Math.max(0, max - record.count),
      maxAttempts: max,
      isLocked: locked,
      remainingSeconds: Math.ceil(remainingMs / 1000),
      lockedUntil: locked ? new Date(record.lockedUntil!) : null,
      scope,
    };
  }

  /**
   * The lock currently blocking this login, if any. An account lock takes
   * precedence over the IP throttle so the message shown is the useful one.
   */
  async getBlockingLock(username: string, ip: string): Promise<ThrottleStatus | null> {
    const account = await this.read('account', LoginThrottleService.normalise(username));
    const accountStatus = this.toStatus(account, 'account', MAX_ATTEMPTS_PER_ACCOUNT);
    if (accountStatus.isLocked) return accountStatus;

    const byIp = await this.read('ip', LoginThrottleService.normalise(ip));
    const ipStatus = this.toStatus(byIp, 'ip', MAX_ATTEMPTS_PER_IP);
    if (ipStatus.isLocked) return ipStatus;

    return null;
  }

  /**
   * Register one failed attempt. Known accounts are counted against their own
   * counter; unknown usernames against the client IP.
   */
  async registerFailure(
    username: string,
    ip: string,
    userExists: boolean,
  ): Promise<ThrottleStatus> {
    const scope: ThrottleScope = userExists ? 'account' : 'ip';
    const identifier = LoginThrottleService.normalise(userExists ? username : ip);
    const max = userExists ? MAX_ATTEMPTS_PER_ACCOUNT : MAX_ATTEMPTS_PER_IP;

    const record = await this.read(scope, identifier);
    record.count += 1;
    if (record.count >= max) {
      record.lockedUntil = Date.now() + LOCK_DURATION_SECONDS * 1000;
    }
    await this.write(scope, identifier, record);

    const status = this.toStatus(record, scope, max);
    if (status.isLocked) {
      this.logger.warn(
        `Login throttled: ${scope} "${identifier}" locked for ${LOCK_DURATION_SECONDS / 60} min after ${record.count} failed attempts`,
      );
    }
    return status;
  }

  /** Clear counters after a successful login. */
  async registerSuccess(username: string, ip: string): Promise<void> {
    await Promise.all([
      this.clear('account', LoginThrottleService.normalise(username)),
      this.clear('ip', LoginThrottleService.normalise(ip)),
    ]);
  }

  /** Per-account status, for the admin UI / unlock flow. */
  async getAccountStatus(username: string): Promise<ThrottleStatus> {
    const record = await this.read('account', LoginThrottleService.normalise(username));
    return this.toStatus(record, 'account', MAX_ATTEMPTS_PER_ACCOUNT);
  }

  /** Admin overview of every non-zero counter held in memory. */
  getMemorySnapshot(): Array<{ key: string; count: number; lockedUntil: number | null }> {
    return Array.from(this.memory.entries()).map(([key, record]) => ({
      key,
      count: record.count,
      lockedUntil: record.lockedUntil,
    }));
  }

  get storageBackend(): 'redis' | 'memory' {
    return this.redis.isReady() ? 'redis' : 'memory';
  }
}
