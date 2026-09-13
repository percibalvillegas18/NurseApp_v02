import { Test } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { UsersService } from './users.service';
import { PrismaService } from '../auth/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * Unit tests for UsersService (user administration).
 * Run: npm test -- users.service.spec
 */
const baseUser = {
  id: 1,
  username: 'maria.garcia',
  email: 'maria.garcia@hospital.local',
  full_name: 'Maria Garcia',
  password_hash: bcrypt.hashSync('Password123!', 4),
  primary_role_id: 1,
  status: 'Active',
  email_verified: true,
  last_login_at: null,
  failed_login_attempts: 3,
  locked_until: new Date(),
  deleted_at: null,
  created_at: new Date(),
  updated_at: new Date(),
};

const role = (id: number, code: string) => ({ id, code, name: code, category: 'Clinical' });

class FakePrisma {
  users: any[];
  assignments: any[];
  sessions: any[];
  auditAuditLogs: any[] = [];
  calls: string[] = [];

  constructor() { this.users = [{ ...baseUser }]; this.assignments = [{ user_id: 1, role_id: 2 }]; this.sessions = []; }

  private eq(where: any) {
    return (u: any) =>
      Object.entries(where ?? {}).every(([k, v]) => {
        if (where.OR) return true; // list search handled by findMany override below
        if (k === 'OR') return true;
        if (v === null) return (u as any)[k] === null;
        if (typeof v === 'object') return true;
        return (u as any)[k] === v;
      });
  }

  get auth_users() {
    return {
      findMany: async () => this.users,
      count: async () => this.users.length,
      findFirst: async (args: any) => this.users.find(this.eq(args?.where)) ?? null,
      findUnique: async (args: any) => {
        const u = this.users.find((x) => x.id === args?.where?.id);
        if (!u) return null;
        return {
          ...u,
          primary_role: role(u.primary_role_id, 'RN'),
          user_role_assignments: this.assignments
            .filter((a) => a.user_id === u.id)
            .map((a) => ({ role: role(a.role_id, `R${a.role_id}`) })),
        };
      },
      create: async (args: any) => {
        this.calls.push('users.create');
        const row = {
          id: Math.max(...this.users.map((u) => u.id)) + 1,
          created_at: new Date(),
          updated_at: new Date(),
          deleted_at: null,
          status: 'Active',
          failed_login_attempts: 0,
          ...args.data,
        };
        delete (row as any).user_role_assignments;
        this.users.push(row);
        (args.data.user_role_assignments?.create ?? []).forEach((c: any) =>
          this.assignments.push({ user_id: row.id, role_id: c.role_id }));
        return row;
      },
      update: async (args: any) => {
        const u = this.users.find((x) => x.id === args?.where?.id);
        if (!u) return null;
        Object.assign(u, args.data);
        return u;
      },
    };
  }

  get auth_user_role_assignments() {
    return {
      deleteMany: async (args: any) => {
        this.calls.push('assignments.deleteMany');
        const before = this.assignments.length;
        this.assignments = this.assignments.filter((a) => a.user_id !== args?.where?.user_id);
        return { count: before - this.assignments.length };
      },
      create: async (args: any) => {
        this.calls.push('assignments.create');
        this.assignments.push(args.data);
        return { id: 1, ...args.data };
      },
    };
  }

  get auth_sessions() {
    return { findMany: async () => this.sessions };
  }

  get audit_audit_logs() {
    return {
      findMany: async (args: any) =>
        this.auditAuditLogs.filter((l) => args?.where?.action?.in?.includes(l.action)).slice(0, args?.take ?? 25),
    };
  }

  get system_hospital_roles() {
    return {
      findMany: async () => [
        { id: 1, code: 'RN', name: 'Registered Nurse', category: 'Clinical', deleted_at: null },
        { id: 9, code: 'SYSTEM_ADMIN', name: 'System Administrator', category: 'System', deleted_at: null },
      ],
    };
  }
}

let service: UsersService;
let prisma: FakePrisma;
let audits: any[];

beforeEach(async () => {
  prisma = new FakePrisma();
  audits = [];
  const mockAudit = { log: jest.fn(async (entry: any) => void audits.push(entry)) } as unknown as AuditService;

  const moduleRef = await Test.createTestingModule({
    providers: [
      UsersService,
      { provide: PrismaService, useValue: prisma },
      { provide: AuditService, useValue: mockAudit },
    ],
  }).compile();
  service = moduleRef.get(UsersService);
});

const actor = { userId: 1, username: 'admin.system' };

describe('UsersService - user administration', () => {
  it('creates a user with hashed password, excluding primary role from extra assignments', async () => {
    const user = await service.createUser(
      {
        username: 'test.nurse',
        email: 'test.nurse@hospital.local',
        full_name: 'Test Nurse',
        password: 'Secret123!',
        primary_role_id: 1,
        role_ids: [1, 9], // primary (1) must be excluded from extra assignments
      },
      actor,
    );

    const stored = prisma.users.find((u) => u.username === 'test.nurse');
    expect(stored).toBeTruthy();
    expect(stored.password_hash.startsWith('$2')).toBe(true);
    expect(await bcrypt.compare('Secret123!', stored.password_hash)).toBe(true);
    expect(prisma.assignments.filter((a) => a.user_id === stored.id)).toEqual([
      { user_id: stored.id, role_id: 9 },
    ]);
    expect(user.primaryRole?.code).toBe('RN');
    expect(audits[audits.length - 1].action).toBe('USER_CREATED');
  });

  it('rejects duplicate username and email on create', async () => {
    await expect(
      service.createUser({ username: 'maria.garcia', email: 'new@hospital.local', full_name: 'X', password: 'Secret123!', primary_role_id: 1 }, actor),
    ).rejects.toThrow(ConflictException);
    await expect(
      service.createUser({ username: 'fine.user', email: 'maria.garcia@hospital.local', full_name: 'X', password: 'Secret123!', primary_role_id: 1 }, actor),
    ).rejects.toThrow(ConflictException);
  });

  it('updates core fields and replaces additional roles', async () => {
    const updated = await service.updateUser(
      1,
      { full_name: 'Maria García', primary_role_id: 9, role_ids: [1, 9, 2] },
      actor,
    );
    expect(updated.fullName).toBe('Maria García');
    expect(prisma.calls).toEqual(expect.arrayContaining(['assignments.deleteMany', 'assignments.create']));
    // primary role 9 excluded; roles 1 & 2 assigned
    expect(prisma.assignments.map((a) => a.role_id).sort()).toEqual([1, 2]);
    expect(audits[audits.length - 1].action).toBe('USER_UPDATED');
  });

  it('blocks email collision with a different user', async () => {
    prisma.users.push({ ...baseUser, id: 2, username: 'other.user', email: 'other@hospital.local' });
    await expect(service.updateUser(1, { email: 'other@hospital.local' }, actor)).rejects.toThrow(ConflictException);
  });

  it('deactivates and reactivates a user with audit trail', async () => {
    await service.setStatus(1, 'Suspended', actor);
    expect(prisma.users[0].status).toBe('Suspended');
    expect(audits[audits.length - 1].action).toBe('USER_DEACTIVATED');
    await service.setStatus(1, 'Active', actor);
    expect(prisma.users[0].status).toBe('Active');
    expect(audits[audits.length - 1].action).toBe('USER_REACTIVATED');
  });

  it('resets password (hashed) and audits without exposing it', async () => {
    await service.resetPassword(1, { password: 'NewPass456!' }, actor);
    const stored = prisma.users[0];
    expect(await bcrypt.compare('NewPass456!', stored.password_hash)).toBe(true);
    expect(stored.last_password_change_at).toBeInstanceOf(Date);
    const entry = audits[audits.length - 1];
    expect(entry.action).toBe('USER_PASSWORD_RESET');
    expect(JSON.stringify(entry)).not.toContain('NewPass456!');
  });

  it('unlocks a user: clears per-user counters only', async () => {
    const res = await service.unlockUser(1, actor);
    expect(prisma.users[0].failed_login_attempts).toBe(0);
    expect(prisma.users[0].locked_until).toBeNull();
    expect(audits[audits.length - 1].action).toBe('USER_UNLOCKED');
    expect(res.message).toContain('per-user');
  });

  it('returns 404 for unknown user and audits nothing', async () => {
    await expect(service.updateUser(999, { full_name: 'X' }, actor)).rejects.toThrow(NotFoundException);
    expect(audits).toHaveLength(0);
  });

  it('serves roles lookup for the entry form', async () => {
    const lookups = await service.getLookups();
    expect(lookups.roles.map((r) => r.code)).toEqual(['RN', 'SYSTEM_ADMIN']);
    expect(lookups.statuses).toEqual(['Active', 'Suspended']);
  });
});
