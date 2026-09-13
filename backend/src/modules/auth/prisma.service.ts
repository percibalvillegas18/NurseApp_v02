import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import type {
  AccessDecision,
  EvaluateAccessRow,
  ResourceType,
} from '../../common/types';
import { mapEvaluateAccessRow, denyAccess } from '../../common/types';

const MOCK_PASSWORD_HASH = process.env.NURSE_APP_MOCK_PASSWORD_HASH || '';

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private prismaClient: any = null;
  private isMock = false;

  /**
   * The in-memory mock exists so the frontend can be previewed without
   * Postgres/Redis. It is NEVER acceptable in production: while it is active
   * there is no real user table and no real authorization engine.
   *
   * Opt in explicitly with ALLOW_MOCK_DATA=true. Without it, any failure to
   * initialise or connect throws and the process refuses to serve traffic
   * (previously it logged a warning and kept serving - see the fail-open note
   * in docs/REPO_ANALYSIS_2026-09-12.md).
   */
  private readonly mockAllowed = String(process.env.ALLOW_MOCK_DATA || '').toLowerCase() === 'true';

  /** True when this instance serves demo/preview data instead of a database. */
  get isMockData(): boolean {
    return this.mockAllowed;
  }

  /** Throw unless the mock data layer has been explicitly opted into. */
  private assertMockAllowed(context: string): void {
    if (this.mockAllowed) return;
    throw new Error(
      `${context} and the in-memory mock data layer is disabled. ` +
        `Fix the database connection, or set ALLOW_MOCK_DATA=true to run a demo/preview instance. ` +
        `Refusing to serve requests without a real database.`,
    );
  }

  // Mock data for preview when DB not available or client not generated
  private mockData = {
    users: [
      { id: 1, username: 'admin.system', email: 'admin@hospital.local', full_name: 'System Administrator', status: 'Active', primary_role_id: 9, password_hash: MOCK_PASSWORD_HASH, failed_login_attempts: 0, locked_until: null },
      { id: 2, username: 'susan.lee', email: 'susan.lee@hospital.local', full_name: 'Susan Lee - Nurse Manager, ICU', status: 'Active', primary_role_id: 5, password_hash: MOCK_PASSWORD_HASH, failed_login_attempts: 0, locked_until: null },
      { id: 3, username: 'james.wilson', email: 'james.wilson@hospital.local', full_name: 'James Wilson - Charge Nurse, ICU', status: 'Active', primary_role_id: 4, password_hash: MOCK_PASSWORD_HASH, failed_login_attempts: 0, locked_until: null },
      { id: 4, username: 'maria.garcia', email: 'maria.garcia@hospital.local', full_name: 'Maria Garcia - RN', status: 'Active', primary_role_id: 1, password_hash: MOCK_PASSWORD_HASH, failed_login_attempts: 0, locked_until: null },
      { id: 5, username: 'ahmed.hassan', email: 'ahmed.hassan@hospital.local', full_name: 'Ahmed Hassan - RN', status: 'Active', primary_role_id: 1, password_hash: MOCK_PASSWORD_HASH, failed_login_attempts: 0, locked_until: null },
      { id: 6, username: 'jennifer.smith', email: 'jennifer.smith@hospital.local', full_name: 'Jennifer Smith - LPN', status: 'Active', primary_role_id: 2, password_hash: MOCK_PASSWORD_HASH, failed_login_attempts: 0, locked_until: null },
      { id: 7, username: 'david.kim', email: 'david.kim@hospital.local', full_name: 'David Kim - CNA', status: 'Active', primary_role_id: 3, password_hash: MOCK_PASSWORD_HASH, failed_login_attempts: 0, locked_until: null },
      { id: 8, username: 'rachel.brown', email: 'rachel.brown@hospital.local', full_name: 'Rachel Brown - Scheduler', status: 'Active', primary_role_id: 6, password_hash: MOCK_PASSWORD_HASH, failed_login_attempts: 0, locked_until: null },
      { id: 9, username: 'patricia.johnson', email: 'patricia.johnson@hospital.local', full_name: 'Patricia Johnson - HR Admin', status: 'Active', primary_role_id: 7, password_hash: MOCK_PASSWORD_HASH, failed_login_attempts: 0, locked_until: null },
      { id: 10, username: 'michael.wong', email: 'michael.wong@hospital.local', full_name: 'Michael Wong - Compliance', status: 'Active', primary_role_id: 8, password_hash: MOCK_PASSWORD_HASH, failed_login_attempts: 0, locked_until: null },
    ],
    roles: [
      { id: 1, code: 'RN', name: 'Registered Nurse' },
      { id: 2, code: 'LPN', name: 'Licensed Practical Nurse' },
      { id: 3, code: 'CNA', name: 'Certified Nursing Assistant' },
      { id: 4, code: 'CHARGE_NURSE', name: 'Charge Nurse' },
      { id: 5, code: 'NURSE_MANAGER', name: 'Nurse Manager' },
      { id: 6, code: 'SCHEDULER', name: 'Workforce Scheduler' },
      { id: 7, code: 'HR_ADMIN', name: 'HR Administrator' },
      { id: 8, code: 'COMPLIANCE_OFFICER', name: 'Compliance Officer' },
      { id: 9, code: 'SYSTEM_ADMIN', name: 'System Administrator' },
      { id: 10, code: 'READONLY_USER', name: 'Read-Only User' },
    ],
  };

  /** In-memory stand-in for auth.sessions while running in mock mode. */
  private readonly mockSessions: any[] = [];

  /** In-memory audit trail while running in mock mode (newest first). */
  private readonly mockAuditLogs: any[] = [];

  constructor() {
    try {
      // Try to dynamically import PrismaClient - may fail if not generated
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { PrismaClient } = require('@prisma/client');
      this.prismaClient = new PrismaClient({
        log: [
          { emit: 'event', level: 'query' },
          { emit: 'event', level: 'error' },
          { emit: 'event', level: 'info' },
          { emit: 'event', level: 'warn' },
        ],
      });
      this.logger.log('✅ PrismaClient initialized');
    } catch (error: any) {
      this.assertMockAllowed(`PrismaClient failed to initialize (${error.message})`);
      this.logger.warn(
        `⚠️ PrismaClient failed to initialize, using MOCK mode because ALLOW_MOCK_DATA=true: ${error.message}`,
      );
      this.isMock = true;
      this.prismaClient = null;
    }
  }

  async onModuleInit() {
    if (this.isMock || !this.prismaClient) {
      this.logger.warn(
        '⚠️ Running in MOCK mode - no DB connection. DEMO/PREVIEW ONLY: data is in-memory and authorization decisions come from a hardcoded matrix.',
      );
      return;
    }

    try {
      await this.prismaClient.$connect();
      this.logger.log('✅ Prisma connected to database');

      if (process.env.NODE_ENV === 'development') {
        try {
          // $on('query') is only typed when the client is constructed with
          // log: [{ emit: 'event', level: 'query' }], so cast for the listener.
          (this.prismaClient as any).$on('query', (e: any) => {
            if (e.duration > 100) {
              this.logger.warn(`Slow query (${e.duration}ms): ${e.query}`);
            }
          });
        } catch {}
      }
    } catch (error: any) {
      this.assertMockAllowed(`Database connection failed (${error.message})`);
      this.logger.warn(
        `⚠️ Prisma connection failed, switching to MOCK mode because ALLOW_MOCK_DATA=true: ${error.message}`,
      );
      this.isMock = true;
      this.prismaClient = null;
    }
  }

  async onModuleDestroy() {
    if (this.prismaClient && !this.isMock) {
      try {
        await this.prismaClient.$disconnect();
      } catch {}
    }
  }

  // Proxy all model access to real client or mock
  // This allows `this.prisma.auth_users.findMany` to work in both modes
  private getClient() {
    if (this.isMock || !this.prismaClient) {
      return null;
    }
    return this.prismaClient;
  }

  // For direct model access like prisma.auth_users
  get auth_users() {
    const client = this.getClient();
    if (client) return client.auth_users;
    // Mock implementation - FIXED to properly handle different users and password validation
    return {
      findUnique: async (args: any) => {
        let user: any = null;
        if (args.where.id) {
          user = this.mockData.users.find((u) => u.id === args.where.id);
        } else if (args.where.username) {
          user = this.mockData.users.find((u) => u.username === args.where.username);
        } else if (args.where.email) {
          user = this.mockData.users.find((u) => u.email === args.where.email);
        }
        if (!user) return null;
        const role = this.mockData.roles.find((r) => r.id === user.primary_role_id);
        return {
          ...user,
          primary_role: role,
          user_role_assignments: [{ role }],
        };
      },
      findFirst: async (args: any) => {
        let username: string | undefined;
        // Handle OR: [{username}, {email: username}]
        if (args.where?.OR && Array.isArray(args.where.OR)) {
          for (const cond of args.where.OR) {
            if (cond.username) username = cond.username;
            if (cond.email) username = cond.email;
          }
        } else if (args.where?.username) {
          username = args.where.username;
        } else if (args.where?.email) {
          username = args.where.email;
        }

        if (!username) return null;

        const user = this.mockData.users.find((u) => u.username === username || u.email === username);
        if (!user) return null;

        const role = this.mockData.roles.find((r) => r.id === user.primary_role_id);
        return {
          ...user,
          primary_role: role,
        };
      },
      findMany: async () => this.mockData.users,
      count: async () => this.mockData.users.length,
      create: async (args: any) => {
        const id = (this.mockData.users[this.mockData.users.length - 1]?.id ?? 0) + 1;
        const row = { id, status: 'Active', failed_login_attempts: 0, ...args.data };
        this.mockData.users.push(row);
        return row;
      },
      update: async (args: any) => {
        const idx = this.mockData.users.findIndex((u) => u.id === args.where.id);
        if (idx === -1) return null;
        // Persist changes to mockData for attempt counter
        this.mockData.users[idx] = { ...this.mockData.users[idx], ...args.data };
        return this.mockData.users[idx];
      },
    };
  }

  get auth_user_role_assignments() {
    const client = this.getClient();
    if (client) return client.auth_user_role_assignments;
    return {
      findMany: async () => [{ role: { code: 'SYSTEM_ADMIN' } }],
      deleteMany: async () => ({ count: 0 }),
      create: async (args: any) => ({ id: 1, ...args.data }),
      upsert: async (args: any) => ({ id: 1, ...args.create }),
    };
  }

  get auth_sessions() {
    const client = this.getClient();
    if (client) return client.auth_sessions;
    return {
      create: async (args: any) => {
        const record = { ...args.data };
        this.mockSessions.push(record);
        return record;
      },
      findUnique: async (args: any) =>
        this.mockSessions.find((s) => s.id === args?.where?.id) ?? null,
      findMany: async (args: any) =>
        args?.where?.user_id
          ? this.mockSessions.filter((s) => s.user_id === args.where.user_id)
          : [...this.mockSessions],
      updateMany: async (args: any) => {
        const matches = this.mockSessions.filter(
          (s) =>
            s.id === args?.where?.id &&
            (args?.where?.user_id === undefined || s.user_id === args.where.user_id),
        );
        matches.forEach((s) => Object.assign(s, args?.data));
        return { count: matches.length };
      },
    };
  }

  get system_hospital_roles() {
    const client = this.getClient();
    if (client) return client.system_hospital_roles;
    return {
      findUnique: async (args: any) => this.mockData.roles.find((r) => r.code === args.where.code) || null,
      upsert: async (args: any) => args.create,
      findMany: async () => this.mockData.roles,
    };
  }

  get rbac_access_levels() {
    const client = this.getClient();
    if (client) return client.rbac_access_levels;
    return {
      findMany: async () => [{ code: 'FULL', name: 'Full' }],
      count: async () => 5,
      create: async (args: any) => ({ id: 1, ...args.data }),
      findFirst: async () => null,
    };
  }

  get rbac_menus() {
    const client = this.getClient();
    if (client) return client.rbac_menus;
    return {
      findMany: async () => [
        { id: 1, code: 'DASHBOARD', name: 'Dashboard', parent_menu_id: null, display_order: 1, route: '/dashboard', status: 'Active' },
        { id: 2, code: 'NURSE_MASTER', name: 'Nurse Master', parent_menu_id: 2, display_order: 1, route: '/nursing/master', status: 'Active' },
      ],
    };
  }

  get rbac_permissions() {
    const client = this.getClient();
    if (client) return client.rbac_permissions;
    return {
      findMany: async () => [
        { id: 1, code: 'VIEW', name: 'View', category: 'Standard', risk_level: 'Low', status: 'Active' },
      ],
    };
  }

  get rbac_role_menu_access() {
    const client = this.getClient();
    if (client) return client.rbac_role_menu_access;
    return {
      findMany: async () => [{ id: 1, role_code: 'SYSTEM_ADMIN', menu_id: 1, visible: true, enabled: true, menu: { code: 'DASHBOARD', name: 'Dashboard' } }],
      findUnique: async () => ({ id: 1, visible: true, enabled: true }),
      update: async (args: any) => ({ id: 1, ...args.data }),
    };
  }

  get rbac_role_permissions() {
    const client = this.getClient();
    if (client) return client.rbac_role_permissions;
    return {
      findMany: async () => [{ id: 1, allowed: true, permission: { code: 'VIEW' }, menu: { code: 'DASHBOARD' } }],
      findUnique: async () => null,
      create: async (args: any) => ({ id: 1, ...args.data }),
      update: async (args: any) => ({ id: 1, ...args.data }),
    };
  }

  get rbac_user_data_scopes() {
    const client = this.getClient();
    if (client) return client.rbac_user_data_scopes;
    return {
      findMany: async () => [{ id: 1, scope_type: 'All', status: 'Active' }],
      create: async (args: any) => ({ id: 1, ...args.data }),
      update: async (args: any) => ({ id: 1, ...args.data }),
      findUnique: async () => ({ id: 1 }),
    };
  }

  get rbac_organizations() {
    const client = this.getClient();
    if (client) return client.rbac_organizations;
    return { findMany: async () => [] };
  }

  get rbac_departments() {
    const client = this.getClient();
    if (client) return client.rbac_departments;
    return { findMany: async () => [] };
  }

  get rbac_nursing_units() {
    const client = this.getClient();
    if (client) return client.rbac_nursing_units;
    return { findMany: async () => [] };
  }

  get rbac_posts() {
    const client = this.getClient();
    if (client) return client.rbac_posts;
    return { findMany: async () => [] };
  }

  get rbac_shifts() {
    const client = this.getClient();
    if (client) return client.rbac_shifts;
    return { findMany: async () => [] };
  }

  get audit_audit_logs() {
    const client = this.getClient();
    if (client) return client.audit_audit_logs;

    // In-memory audit trail so the demo/preview Audit Logs page shows the
    // events this instance actually produced. It used to accept writes and
    // then return an empty list, so logins and denials vanished.
    const matches = (row: any, where: any): boolean => {
      if (!where) return true;
      for (const [field, condition] of Object.entries<any>(where)) {
        const value = row[field];
        if (condition === null || typeof condition !== 'object') {
          if (value !== condition) return false;
          continue;
        }
        if ('contains' in condition) {
          const needle = String(condition.contains);
          const mode = condition.mode;
          const haystack = mode === 'insensitive' ? String(value ?? '').toLowerCase() : String(value ?? '');
          const target = mode === 'insensitive' ? needle.toLowerCase() : needle;
          if (!haystack.includes(target)) return false;
        }
        if ('gte' in condition && !(value >= condition.gte)) return false;
        if ('lte' in condition && !(value <= condition.lte)) return false;
        if ('gt' in condition && !(value > condition.gt)) return false;
        if ('lt' in condition && !(value < condition.lt)) return false;
      }
      return true;
    };

    return {
      create: async (args: any) => {
        const row = {
          id: this.mockAuditLogs.length + 1,
          ...args?.data,
          created_at: new Date(),
        };
        this.mockAuditLogs.unshift(row); // newest first
        return row;
      },
      findMany: async (args: any) => {
        let rows = this.mockAuditLogs.filter((r) => matches(r, args?.where));
        if (args?.orderBy?.created_at === 'desc') {
          rows = [...rows].sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
          );
        } else if (args?.orderBy?.created_at === 'asc') {
          rows = [...rows].sort(
            (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
          );
        }
        const skip = args?.skip ?? 0;
        const take = args?.take;
        return typeof take === 'number' ? rows.slice(skip, skip + take) : rows.slice(skip);
      },
      count: async (args: any) =>
        this.mockAuditLogs.filter((r) => matches(r, args?.where)).length,
    };
  }

  get nursing_nurses() {
    const client = this.getClient();
    if (client) return client.nursing_nurses;
    return {
      findMany: async () => [],
      findUnique: async () => null,
      findFirst: async () => null,
      create: async (args: any) => ({ id: 1, ...args.data }),
      update: async (args: any) => ({ id: args.where.id, ...args.data }),
      count: async () => 0,
    };
  }

  get nursing_credentials() {
    const client = this.getClient();
    if (client) return client.nursing_credentials;
    return {
      findMany: async () => [],
      findUnique: async () => null,
      create: async (args: any) => ({ id: 1, ...args.data }),
      update: async (args: any) => ({ id: args.where.id, ...args.data }),
      count: async () => 0,
    };
  }

  get nursing_roster_assignments() {
    const client = this.getClient();
    if (client) return client.nursing_roster_assignments;
    return {
      findMany: async () => [],
      findUnique: async () => null,
      create: async (args: any) => ({ id: 1, ...args.data }),
      update: async (args: any) => ({ id: args.where.id, ...args.data }),
      count: async () => 0,
    };
  }

  /**
   * Raw query - real DB when connected, hardcoded demo matrix in mock mode.
   * Falls back to the mock ONLY when mock mode was explicitly opted into;
   * a query error against a real database is rethrown, never silently
   * downgraded to a fake ALLOW.
   */
  $queryRawUnsafe<T = any[]>(query: string, ...params: any[]): Promise<T>;
  async $queryRawUnsafe(query: string, ...params: any[]): Promise<any[]> {
    const client = this.getClient();
    if (client && !this.isMock) {
      try {
        return await client.$queryRawUnsafe(query, ...params);
      } catch (error: any) {
        if (!this.mockAllowed) {
          this.logger.error(`Raw query failed: ${error.message} - Query: ${query.substring(0, 100)}`);
          throw error;
        }
        this.logger.warn(
          `Raw query failed, falling back to mock (ALLOW_MOCK_DATA=true): ${error.message} - Query: ${query.substring(0, 100)}`,
        );
        // Fall through to mock
      }
    } else {
      // Safety net: mock mode without the opt-in must never answer a query.
      this.assertMockAllowed('PrismaService is in MOCK mode');
    }

    // Mock implementation for evaluate_access and other functions
    return this.mockQueryRaw(query, params);
  }

  /** Raw writes used by the contract module must have a real database. */
  async $executeRawUnsafe(query: string, ...params: any[]): Promise<number> {
    const client = this.getClient();
    if (!client || this.isMock) throw new Error('Raw database writes require a database connection');
    return client.$executeRawUnsafe(query, ...params);
  }

  /** Role code for a mock user, mirroring mockData.users[].primary_role_id. */
  private mockRoleCode(userId: number): string {
    const user = this.mockData.users.find((u) => u.id === Number(userId));
    const role = user ? this.mockData.roles.find((r) => r.id === user.primary_role_id) : undefined;
    return role?.code || 'READONLY_USER';
  }

  /** Menu code -> id, mirroring the seeded rbac.menus tree (V2_4). */
  private readonly mockMenuIds: Record<string, number> = {
    DASHBOARD: 1,
    NURSING_WORKFORCE: 2,
    SCHEDULING: 3,
    WORKFORCE_ANALYTICS: 4,
    ADMINISTRATION: 5,
    NURSE_MASTER: 6,
    CREDENTIALS: 7,
    NURSE_ROSTER: 9,
    LEAVE_MANAGEMENT: 10,
    USER_MANAGEMENT: 11,
    ROLES_PERMISSIONS: 12,
    EFFECTIVE_ACCESS: 13,
    CACHE_STATS: 14,
    ACCESS_LEVEL_MASTER: 15,
    MENU_MASTER: 16,
    AUDIT_LOGS: 17,
    SYSTEM_SETTINGS: 18,
    CONTRACT: 19,
    DOCUMENTS: 20,
  };

  /**
   * DEMO authorization matrix, deliberately DENY-by-default.
   *
   * This used to return ALLOW for almost everything ("all checks passed
   * (MOCK REAL BACKEND)"), which meant that whenever the database was
   * unreachable the RbacGuard waved every request through - an RN could reset
   * the administrator's password. It now mirrors rbac.evaluate_access():
   * anything not listed here is denied.
   */
  private static readonly MOCK_ROLE_ACCESS: Record<string, Record<string, string[]>> = {
    SYSTEM_ADMIN: {
      DASHBOARD: ['VIEW', 'EDIT'],
      NURSING_WORKFORCE: ['VIEW'],
      NURSE_MASTER: ['VIEW', 'CREATE', 'EDIT', 'DELETE'],
      CREDENTIALS: ['VIEW', 'CREATE', 'EDIT', 'VERIFY'],
      CONTRACT: ['VIEW', 'CREATE', 'EDIT'],
      DOCUMENTS: ['VIEW', 'CREATE', 'EDIT'],
      SCHEDULING: ['VIEW'],
      NURSE_ROSTER: ['VIEW', 'CREATE', 'EDIT', 'DELETE', 'ASSIGN'],
      LEAVE_MANAGEMENT: ['VIEW', 'CREATE', 'EDIT', 'APPROVE'],
      WORKFORCE_ANALYTICS: ['VIEW', 'EXPORT'],
      ADMINISTRATION: ['VIEW'],
      USER_MANAGEMENT: ['VIEW', 'CREATE', 'EDIT', 'MANAGE'],
      ROLES_PERMISSIONS: ['VIEW', 'EDIT', 'MANAGE'],
      EFFECTIVE_ACCESS: ['VIEW'],
      CACHE_STATS: ['VIEW'],
      ACCESS_LEVEL_MASTER: ['VIEW', 'MANAGE'],
      MENU_MASTER: ['VIEW', 'MANAGE'],
      AUDIT_LOGS: ['VIEW', 'EXPORT'],
      SYSTEM_SETTINGS: ['VIEW', 'MANAGE'],
    },
    NURSE_MANAGER: {
      DASHBOARD: ['VIEW'],
      NURSING_WORKFORCE: ['VIEW'],
      NURSE_MASTER: ['VIEW', 'CREATE', 'EDIT'],
      CREDENTIALS: ['VIEW', 'VERIFY'],
      NURSE_ROSTER: ['VIEW', 'CREATE', 'EDIT', 'ASSIGN'],
      LEAVE_MANAGEMENT: ['VIEW', 'APPROVE'],
      WORKFORCE_ANALYTICS: ['VIEW'],
      AUDIT_LOGS: ['VIEW'],
    },
    CHARGE_NURSE: {
      DASHBOARD: ['VIEW'],
      NURSING_WORKFORCE: ['VIEW'],
      NURSE_MASTER: ['VIEW', 'EDIT'],
      CREDENTIALS: ['VIEW'],
      NURSE_ROSTER: ['VIEW', 'EDIT', 'ASSIGN'],
      LEAVE_MANAGEMENT: ['VIEW', 'SUBMIT'],
    },
    RN: {
      DASHBOARD: ['VIEW'],
      NURSING_WORKFORCE: ['VIEW'],
      NURSE_MASTER: ['VIEW'],
      CREDENTIALS: ['VIEW'],
      NURSE_ROSTER: ['VIEW'],
      LEAVE_MANAGEMENT: ['VIEW', 'SUBMIT'],
    },
    LPN: {
      DASHBOARD: ['VIEW'],
      NURSING_WORKFORCE: ['VIEW'],
      NURSE_MASTER: ['VIEW'],
      NURSE_ROSTER: ['VIEW'],
      LEAVE_MANAGEMENT: ['VIEW', 'SUBMIT'],
    },
    CNA: {
      DASHBOARD: ['VIEW'],
      NURSE_ROSTER: ['VIEW'],
      LEAVE_MANAGEMENT: ['VIEW', 'SUBMIT'],
    },
    SCHEDULER: {
      DASHBOARD: ['VIEW'],
      NURSE_MASTER: ['VIEW'],
      SCHEDULING: ['VIEW'],
      NURSE_ROSTER: ['VIEW', 'CREATE', 'EDIT', 'ASSIGN'],
      LEAVE_MANAGEMENT: ['VIEW'],
      WORKFORCE_ANALYTICS: ['VIEW'],
    },
    HR_ADMIN: {
      DASHBOARD: ['VIEW'],
      NURSING_WORKFORCE: ['VIEW'],
      NURSE_MASTER: ['VIEW', 'CREATE', 'EDIT'],
      CREDENTIALS: ['VIEW'],
      CONTRACT: ['VIEW', 'CREATE', 'EDIT'],
      DOCUMENTS: ['VIEW', 'CREATE', 'EDIT'],
      ADMINISTRATION: ['VIEW'],
      USER_MANAGEMENT: ['VIEW', 'CREATE', 'EDIT'],
      LEAVE_MANAGEMENT: ['VIEW', 'APPROVE'],
    },
    COMPLIANCE_OFFICER: {
      DASHBOARD: ['VIEW'],
      NURSE_MASTER: ['VIEW'],
      CREDENTIALS: ['VIEW', 'VERIFY'],
      AUDIT_LOGS: ['VIEW', 'EXPORT'],
      WORKFORCE_ANALYTICS: ['VIEW'],
    },
    READONLY_USER: {
      DASHBOARD: ['VIEW'],
    },
  };


  /**
   * Demo scope rules that mirror the real function’s intent.
   * ICU-scoped RN must not reach Medical Ward resources.
   */
  private mockDataScopeValid(
    userId: number,
    roleCode: string,
    menuCode: string,
    resourceId: number,
    resourceType: ResourceType | null,
  ): boolean {
    const fullScopeRoles: readonly string[] = [
      'SYSTEM_ADMIN',
      'HR_ADMIN',
      'NURSE_MANAGER',
    ];
    if (fullScopeRoles.includes(roleCode)) {
      return true;
    }

    /** Demo: userId → allowed unit ids */
    const MOCK_USER_UNIT_SCOPE: Readonly<Record<number, readonly number[]>> = {
      3: [1],    // RN → ICU_A only
      4: [1, 2], // Charge Nurse → both
    };

    const allowedUnits: readonly number[] =
      MOCK_USER_UNIT_SCOPE[userId] ?? [];

    if (resourceType === 'unit' || menuCode === 'NURSE_ROSTER') {
      return allowedUnits.includes(resourceId);
    }

    if (resourceType === 'nurse') {
      const nurseHomeUnit: Readonly<Record<number, number>> = {
        1: 1,
        2: 2,
      };
      const home: number | undefined = nurseHomeUnit[resourceId];
      return home != null && allowedUnits.includes(home);
    }

    // Unknown type → fail closed
    return false;
  }

  private mockQueryRaw(query: string, params: any[]): any[] {
    this.logger.debug(`MOCK query: ${query.substring(0, 150)}... params: ${JSON.stringify(params)}`);

    if (query.includes('rbac.evaluate_access')) {
      const userId = Number(params[0]);
      const menuCode = String(params[1]);
      const permissionCode = String(params[2]);
      const resourceId: number | null =
        params[3] != null ? Number(params[3]) : null;
      const resourceType: ResourceType | null =
        (params[4] as ResourceType | null | undefined) ?? null;

      const roleCode: string = this.mockRoleCode(userId);
      const granted: Record<string, string[]> =
        PrismaService.MOCK_ROLE_ACCESS[roleCode] ?? {};
      const allowedPerms: string[] = granted[menuCode] ?? [];
      const menuAccessible: boolean = allowedPerms.length > 0;
      const permissionGranted: boolean =
        allowedPerms.includes(permissionCode);

      let dataScopeValid = true;
      if (resourceId != null) {
        dataScopeValid = this.mockDataScopeValid(
          userId,
          roleCode,
          menuCode,
          resourceId,
          resourceType,
        );
      }

      const allow: boolean =
        menuAccessible && permissionGranted && dataScopeValid;

      if (allow) {
        return [
          {
            decision: 'ALLOW',
            reason:
              `MOCK ALLOW: ${permissionCode} on ${menuCode} for ${roleCode}` +
              (resourceId != null
                ? ` (scope ok for ${resourceType ?? 'id'}:${resourceId})`
                : ''),
            menu_accessible: true,
            permission_granted: true,
            data_scope_valid: true,
            cache_ttl: 300,
            evaluated_at: new Date(),
            user_role: roleCode,
            user_roles: [roleCode],
          },
        ];
      }

      return [
        {
          decision: 'DENY',
          reason: !menuAccessible
            ? `MOCK DENY: menu ${menuCode} not accessible to ${roleCode}`
            : !permissionGranted
              ? `MOCK DENY: permission ${permissionCode} not granted to ${roleCode}`
              : `MOCK DENY: data scope invalid for ${resourceType ?? 'resource'}:${resourceId}`,
          menu_accessible: menuAccessible,
          permission_granted: permissionGranted,
          data_scope_valid: dataScopeValid,
          cache_ttl: 1800,
          evaluated_at: new Date(),
          user_role: roleCode,
          user_roles: [roleCode],
        },
      ];
    }

    if (query.includes('rbac.get_user_full_access')) {
      const userId = params[0];
      const roleCode = this.mockRoleCode(userId);
      const user = this.mockData.users.find((u) => u.id === Number(userId));
      const role = this.mockData.roles.find((r) => r.code === roleCode);
      const granted = PrismaService.MOCK_ROLE_ACCESS[roleCode] || {};
      const rows: any[] = [];
      let menuId = 1;
      for (const [menuCode, perms] of Object.entries(granted)) {
        for (const permissionCode of perms) {
          rows.push({
            user_id: Number(userId),
            username: user?.username || 'unknown',
            primary_role_code: roleCode,
            primary_role_name: role?.name || roleCode,
            all_roles: [roleCode],
            menu_id: menuId,
            menu_code: menuCode,
            menu_name: menuCode,
            menu_route: '/dashboard',
            permission_id: 1,
            permission_code: permissionCode,
            permission_name: permissionCode,
            is_accessible: true,
            is_allowed: true,
          });
        }
        menuId += 1;
      }
      return rows;
    }

    if (query.includes('rbac.preview_access_change')) {
      return [
        {
          current_decision: 'DENY',
          proposed_decision: 'ALLOW',
          menu_code: 'NURSE_MASTER',
          menu_name: 'Nurse Master',
          permission_code: 'EDIT',
          permission_name: 'Edit',
          impact_description: 'Access will change from DENY to ALLOW affecting 5 users - MOCK REAL',
          affected_users: 5,
        },
      ];
    }

    if (query.includes('SELECT hr.code') && query.includes('user_role_assignments')) {
      return [{ code: this.mockRoleCode(params[0]) }];
    }

    if (query.includes('SELECT DISTINCT m.id as menu_id')) {
      // Accessible menu ids for this role, from the same demo matrix.
      const granted = PrismaService.MOCK_ROLE_ACCESS[this.mockRoleCode(params[0])] || {};
      return Object.keys(granted)
        .map((code) => this.mockMenuIds[code])
        .filter((id) => typeof id === 'number')
        .map((menu_id) => ({ menu_id }));
    }

    if (query.includes('audit.audit_logs') && query.includes('GROUP BY action')) {
      // Aggregate the in-memory trail for real, so the numbers on the Audit
      // Logs page agree with the rows listed below it. These used to be two
      // hardcoded constants (45 / 12) that never matched anything.
      const since = params[0] ? new Date(params[0]).getTime() : 0;
      const counts = new Map<string, number>();
      for (const row of this.mockAuditLogs) {
        if (new Date(row.created_at).getTime() < since) continue;
        counts.set(row.action, (counts.get(row.action) || 0) + 1);
      }
      return [...counts.entries()]
        .map(([action, count]) => ({ action, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
    }

    // Default empty
    return [];
  }

  /**
   * Helper to call rbac.evaluate_access function
   */
  async evaluateAccess(
    userId: number,
    menuCode: string,
    permissionCode: string,
    resourceId?: number | null,
    resourceType?: ResourceType | null,
  ): Promise<AccessDecision> {
    const rows = (await this.$queryRawUnsafe(
      `SELECT * FROM rbac.evaluate_access($1, $2, $3, $4, $5)`,
      userId,
      menuCode,
      permissionCode,
      resourceId ?? null,
      resourceType ?? null,
    )) as EvaluateAccessRow[];

    const row = rows[0];
    if (!row) {
      return denyAccess();
    }
    return mapEvaluateAccessRow(row);
  }

  /**
   * Helper to get user full access matrix
   */
  async getUserFullAccess(userId: number) {
    return (await this.$queryRawUnsafe(
      `SELECT * FROM rbac.get_user_full_access($1)`,
      userId,
    )) as any[];
  }

  /**
   * Whether the service is running against the real database or the in-memory mock.
   */
  isMockMode(): boolean {
    return this.isMock || !this.prismaClient;
  }

  /**
   * Real DB health check - runs SELECT 1 against the database.
   * Returns 'ok' when the real database answers, 'mock' when the in-memory
   * mock is in use (app is still functional for preview/demo), or 'error'
   * when the real client exists but the query failed.
   */
  async healthCheck(): Promise<{
    status: 'ok' | 'mock' | 'error';
    mode: 'database' | 'mock';
    latencyMs: number;
    error?: string;
  }> {
    if (this.isMockMode()) {
      return { status: 'mock', mode: 'mock', latencyMs: 0 };
    }
    const start = Date.now();
    try {
      await this.prismaClient.$queryRawUnsafe('SELECT 1');
      return { status: 'ok', mode: 'database', latencyMs: Date.now() - start };
    } catch (error: any) {
      this.logger.warn(`Database health check failed: ${error.message}`);
      return {
        status: 'error',
        mode: 'database',
        latencyMs: Date.now() - start,
        error: error.message,
      };
    }
  }

  // For transaction support (mock)
  async $transaction<T>(fn: (prisma: Pick<PrismaService, '$queryRawUnsafe' | '$executeRawUnsafe'>) => Promise<T>): Promise<T> {
    const client = this.getClient();
    if (client && !this.isMock) {
      return client.$transaction(fn);
    }
    // Mock transaction just calls fn with this
    return fn(this);
  }
}
