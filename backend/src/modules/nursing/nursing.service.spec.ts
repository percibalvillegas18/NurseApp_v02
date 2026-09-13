/**
 * Nursing Service - unit tests with in-memory fake Prisma.
 * Covers: list filters/pagination, credential summary, unique-conflict mapping
 * (P2002 -> 409), double-booking prevention, 404s, soft deletes.
 */
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { NursingService } from './nursing.service';

const DAY = 86400000;
const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

class FakePrisma {
  nurses: any[] = [];
  credentials: any[] = [];
  roster: any[] = [];
  scopes: any[] = [{ scope_type: 'All' }];
  units = [
    { id: 1, code: 'ICU_A', name: 'ICU Unit A', department_id: 10, department: { id: 10, organization_id: 100 } },
    { id: 2, code: 'ICU_B', name: 'ICU Unit B', department_id: 20, department: { id: 20, organization_id: 200 } },
  ];
  shifts = [
    { id: 1, code: 'MORNING', name: 'Morning Shift', start_time: '07:00', end_time: '15:00' },
    { id: 2, code: 'EVENING', name: 'Evening Shift', start_time: '15:00', end_time: '23:00' },
  ];

  nursing_nurses = {
    findMany: async ({ where, skip = 0, take = 20 }: any) => {
      let rows = this.nurses.filter((n) => !n.deleted_at);
      if (where?.status) rows = rows.filter((n) => n.status === where.status);
      if (where?.home_unit_id) rows = rows.filter((n) => n.home_unit_id === where.home_unit_id);
      if (where?.OR) {
        const q = where.OR[0].first_name.contains.toLowerCase();
        rows = rows.filter(
          (n) =>
            [n.first_name, n.middle_name, n.last_name, n.employee_number, n.job_no]
              .filter(Boolean)
              .some((v: string) => v.toLowerCase().includes(q)),
        );
      }
      return rows
        .slice(skip, skip + take)
        .map((n) => ({
          ...n,
          primary_role: n.primary_role,
          home_unit: this.units.find((u) => u.id === n.home_unit_id) || null,
          user: n.user_id ? { username: 'maria.garcia', email: 'maria.garcia@hospital.local' } : null,
          credentials: this.credentials.filter((c) => c.nurse_id === n.id && !c.deleted_at),
        }));
    },
    findFirst: async ({ where }: any) =>
      this.nurses.find((n) => n.employee_number === where.employee_number) || null,
    findUnique: async ({ where }: any) => {
      const n = this.nurses.find((x) => x.id === where.id);
      if (!n) return null;
      return {
        ...n,
        primary_role: n.primary_role ?? null,
        home_unit: this.units.find((u) => u.id === n.home_unit_id) || null,
        user: n.user_id ? { username: 'maria.garcia', email: 'maria.garcia@hospital.local' } : null,
        credentials: this.credentials.filter((c) => c.nurse_id === n.id && !c.deleted_at),
        roster_assignments: this.roster
          .filter((a) => a.nurse_id === n.id && !a.deleted_at)
          .map((a) => ({
            ...a,
            nurse: n,
            nursing_unit: this.units.find((u) => u.id === a.nursing_unit_id) || null,
            shift: this.shifts.find((s) => s.id === a.shift_id) || null,
            post: null,
          })),
      };
    },
    count: async ({ where }: any) => {
      const rows = await this.nursing_nurses.findMany({ where });
      return rows.length;
    },
    create: async ({ data }: any) => {
      if (this.nurses.some((n) => n.employee_number === data.employee_number)) {
        throw { code: 'P2002', meta: { target: ['employee_number'] } };
      }
      if (this.nurses.some((n) => n.job_no === data.job_no)) {
        throw { code: 'P2002', meta: { target: ['job_no'] } };
      }
      if (data.user_id && this.nurses.some((n) => n.user_id === data.user_id)) {
        throw { code: 'P2002', meta: { target: ['user_id'] } };
      }
      const row = {
        id: this.nurses.length + 1,
        created_at: new Date(),
        updated_at: new Date(),
        deleted_at: null,
        status: 'Active',
        credentials: [],
        ...data,
        primary_role: null,
        home_unit: this.units.find((u) => u.id === data.home_unit_id) || null,
        user: data.user_id
          ? { username: 'maria.garcia', email: 'maria.garcia@hospital.local' }
          : null,
      };
      this.nurses.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const idx = this.nurses.findIndex((n) => n.id === where.id);
      if (idx === -1) throw new Error('not found');
      if (
        data.employee_number &&
        this.nurses.some((n) => n.id !== where.id && n.employee_number === data.employee_number)
      ) {
        throw { code: 'P2002', meta: { target: ['employee_number'] } };
      }
      if (
        data.job_no &&
        this.nurses.some((n) => n.id !== where.id && n.job_no === data.job_no)
      ) {
        throw { code: 'P2002', meta: { target: ['job_no'] } };
      }
      this.nurses[idx] = { ...this.nurses[idx], ...data, updated_at: new Date() };
      return {
        ...this.nurses[idx],
        primary_role: null,
        home_unit: this.units.find((u) => u.id === this.nurses[idx].home_unit_id) || null,
        user: null,
        credentials: this.credentials.filter(
          (c) => c.nurse_id === where.id && !c.deleted_at,
        ),
      };
    },
  };

  nursing_credentials = {
    findUnique: async ({ where }: any) =>
      this.credentials.find((c) => c.id === where.id) || null,
    findMany: async ({ where }: any) => {
      let rows = this.credentials.filter((c) => !c.deleted_at);
      if (where?.nurse_id) rows = rows.filter((c) => c.nurse_id === where.nurse_id);
      if (where?.expiry_date?.lte)
        rows = rows.filter((c) => c.expiry_date && c.expiry_date <= where.expiry_date.lte);
      if (where?.status?.in) rows = rows.filter((c) => where.status.in.includes(c.status));
      return rows.map((c) => ({
        ...c,
        nurse: this.nurses.find((n) => n.id === c.nurse_id),
      }));
    },
    create: async ({ data }: any) => {
      if (
        this.credentials.some(
          (c) =>
            c.nurse_id === data.nurse_id &&
            c.credential_type === data.credential_type &&
            c.name === data.name,
        )
      ) {
        throw { code: 'P2002', meta: { target: ['uq_credentials_nurse_type_name'] } };
      }
      const row = { id: this.credentials.length + 1, status: 'PendingVerification', ...data };
      this.credentials.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const idx = this.credentials.findIndex((c) => c.id === where.id);
      if (idx === -1) throw new Error('not found');
      this.credentials[idx] = { ...this.credentials[idx], ...data };
      return this.credentials[idx];
    },
  };

  nursing_roster_assignments = {
    findUnique: async ({ where }: any) => this.roster.find((a) => a.id === where.id) || null,
    findMany: async ({ where }: any) => {
      let rows = this.roster.filter((a) => !a.deleted_at);
      if (where?.assignment_date?.gte)
        rows = rows.filter((a) => a.assignment_date >= where.assignment_date.gte);
      if (where?.assignment_date?.lte)
        rows = rows.filter((a) => a.assignment_date <= where.assignment_date.lte);
      if (where?.nursing_unit_id) rows = rows.filter((a) => a.nursing_unit_id === where.nursing_unit_id);
      if (where?.nurse_id) rows = rows.filter((a) => a.nurse_id === where.nurse_id);
      if (where?.status) rows = rows.filter((a) => a.status === where.status);
      return rows.map((a) => ({
        ...a,
        nurse: this.nurses.find((n) => n.id === a.nurse_id),
        nursing_unit: this.units.find((u) => u.id === a.nursing_unit_id) || null,
        shift: this.shifts.find((s) => s.id === a.shift_id) || null,
        post: null,
      }));
    },
    create: async ({ data }: any) => {
      if (
        this.roster.some(
          (a) =>
            a.nurse_id === data.nurse_id &&
            dateOnly(a.assignment_date) === dateOnly(data.assignment_date) &&
            a.shift_id === data.shift_id &&
            !a.deleted_at,
        )
      ) {
        throw { code: 'P2002', meta: { target: ['uq_roster_nurse_date_shift'] } };
      }
      const row = {
        id: this.roster.length + 1,
        status: 'Scheduled',
        deleted_at: null,
        created_at: new Date(),
        updated_at: new Date(),
        ...data,
        nurse: this.nurses.find((n) => n.id === data.nurse_id),
        nursing_unit: this.units.find((u) => u.id === data.nursing_unit_id),
        shift: this.shifts.find((s) => s.id === data.shift_id),
        post: null,
      };
      this.roster.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const idx = this.roster.findIndex((a) => a.id === where.id);
      if (idx === -1) throw new Error('not found');
      this.roster[idx] = { ...this.roster[idx], ...data, updated_at: new Date() };
      return {
        ...this.roster[idx],
        nurse: this.nurses.find((n) => n.id === this.roster[idx].nurse_id),
        nursing_unit: this.units.find((u) => u.id === this.roster[idx].nursing_unit_id),
        shift: this.shifts.find((s) => s.id === this.roster[idx].shift_id),
        post: null,
      };
    },
  };

  system_hospital_roles = { findMany: async () => [] };
  rbac_nursing_units = {
    findMany: async () => this.units,
    findFirst: async ({ where }: any) => this.units.find(u => u.id === where.id) ?? null,
  };
  rbac_departments = { findMany: async () => [] };
  rbac_user_data_scopes = { findMany: async () => this.scopes };
  rbac_shifts = {
    findMany: async () => this.shifts,
    findFirst: async ({ where }: any) => this.shifts.find(s => s.id === where.id) ?? null,
  };
  rbac_posts = { findMany: async () => [], findFirst: async () => null };
}

describe('NURSING SERVICE', () => {
  let service: NursingService;
  let fake: FakePrisma;
  let audits: any[];

  const baseNurse = {
    employee_number: 'EMP-1001',
    job_no: 'JOB-1001',
    first_name: 'Maria',
    last_name: 'Garcia',
    hire_date: new Date('2019-03-01'),
    employment_type: 'FullTime',
    home_unit_id: 1,
    user_id: 4,
    status: 'Active',
  };

  beforeAll(() => {
    fake = new FakePrisma();
    audits = [];
    const mockAudit = { log: jest.fn(async (entry: any) => void audits.push(entry)) };
    service = new NursingService(fake as any, mockAudit as any);
  });

  describe('Nurses CRUD', () => {
    it('creates a nurse and audits', async () => {
      const { nurse } = await service.createNurse(
        { ...baseNurse, hire_date: '2019-03-01' } as any,
        1,
      );
      expect(nurse.employeeNumber).toBe('EMP-1001');
      expect(nurse.fullName).toBe('Maria Garcia');
      expect(nurse.homeUnit?.code).toBe('ICU_A');
      expect(nurse.credentialSummary).toBe('None');
      // Email comes from the linked user account, not the nurse record
      expect(nurse.email).toBe('maria.garcia@hospital.local');
      expect(audits[audits.length - 1].action).toBe('NURSE_CREATED');
    });

    it('auto-generates employee_number when omitted (personal-info form)', async () => {
      const { nurse } = await service.createNurse(
        { job_no: 'JOB-2002', first_name: 'Sara', last_name: 'Ali', gender: 'Female', date_of_birth: '1995-01-01', nationality: 'Saudi' } as any,
        1,
      );
      expect(nurse.employeeNumber).toMatch(/^EMP-\d{4}-(\d{5}|\d+)$/);
      expect(nurse.gender).toBe('Female');
      expect(nurse.dateOfBirth).toBe('1995-01-01');
      expect(nurse.nationality).toBe('Saudi');
      // cleanup so later tests stay deterministic
      fake.nurses = fake.nurses.filter((n) => n.id !== nurse.id);
    });

    it('computes fullName from first + middle + last', async () => {
      const { nurse } = await service.createNurse(
        { ...baseNurse, employee_number: 'EMP-3001', job_no: 'JOB-3003', user_id: undefined, middle_name: 'Josefa', hire_date: undefined } as any,
        1,
      );
      expect(nurse.fullName).toBe('Maria Josefa Garcia');
      expect(nurse.middleName).toBe('Josefa');
      fake.nurses = fake.nurses.filter((n) => n.id !== nurse.id);
    });

    it('lookups include the country list for nationality selection', async () => {
      const lookups = await service.getLookups(1);
      expect(lookups.countries.length).toBeGreaterThan(150);
      expect(lookups.countries).toContain('Saudi');
      expect(lookups.countries).toContain('Philippines');
    });

    it('rejects duplicate employee_number with 409 ConflictException', async () => {
      await expect(
        service.createNurse({ ...baseNurse, job_no: 'JOB-4004', hire_date: '2019-03-01', user_id: 99 } as any, 1),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects duplicate user link with 409', async () => {
      await expect(
        service.createNurse(
          { ...baseNurse, employee_number: 'EMP-1002', job_no: 'JOB-5005', hire_date: '2019-03-01' } as any,
          1,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects duplicate job_no with 409 ConflictException', async () => {
      await expect(
        service.createNurse(
          { ...baseNurse, employee_number: 'EMP-7007', job_no: 'JOB-1001', user_id: undefined } as any,
          1,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('lists with search + pagination shape', async () => {
      const res = await service.listNurses({ search: 'garcia', page: 1, limit: 10 }, 1);
      expect(res.items).toHaveLength(1);
      expect(res.items[0].fullName).toBe('Maria Garcia');
      expect(res.pagination).toEqual({
        page: 1,
        limit: 10,
        total: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      });
    });

    it('returns 404 for unknown nurse and audits nothing', async () => {
      await expect(service.getNurse(999, 1)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('soft delete marks terminated + deleted_at and audit logs', async () => {
      const res = await service.softDeleteNurse(1, 1);
      expect(res.message).toContain('deleted');
      const stored = fake.nurses.find((n) => n.id === 1);
      expect(stored.deleted_at).toBeTruthy();
      expect(stored.status).toBe('Terminated');
      expect(audits[audits.length - 1].action).toBe('NURSE_DELETED');
      // and it disappears from lists / detail
      await expect(service.getNurse(1, 1)).rejects.toBeInstanceOf(NotFoundException);
      const res2 = await service.listNurses({ page: 1, limit: 10 }, 1);
      expect(res2.items).toHaveLength(0);
    });
  });

  describe('Credentials', () => {
    beforeAll(async () => {
      const { nurse } = await service.createNurse(
        {
          ...baseNurse,
          employee_number: 'EMP-2001',
          job_no: 'JOB-6006',
          user_id: undefined,
          hire_date: '2020-01-01',
        } as any,
        1,
      );
      expect(nurse.id).toBeGreaterThan(1);
    });

    it('creates credential and computes daysUntilExpiry', async () => {
      const inDays = new Date(Date.now() + 20 * DAY);
      const { credential } = await service.createCredential(
        {
          nurse_id: 2,
          credential_type: 'Certification',
          name: 'BLS',
          expiry_date: dateOnly(inDays),
        } as any,
        1,
      );
      expect(credential.status).toBe('PendingVerification');
      expect(credential.daysUntilExpiry).toBeGreaterThan(18);
      expect(credential.daysUntilExpiry).toBeLessThanOrEqual(20);
    });

    it('rejects duplicate credential (nurse, type, name) with 409', async () => {
      await expect(
        service.createCredential(
          { nurse_id: 2, credential_type: 'Certification', name: 'BLS' } as any,
          1,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('verify sets status, verifier and timestamp', async () => {
      const { credential } = await service.verifyCredential(1, { status: 'Valid' }, 9);
      expect(credential.status).toBe('Valid');
      expect(credential.verifiedBy).toBe(9);
      expect(credential.verifiedAt).toBeTruthy();
    });

    it('expiring list includes near-expiry and flags nurse summary ExpiringSoon', async () => {
      const exp = await service.listExpiringCredentials(30, 1);
      expect(exp.items).toHaveLength(1);
      expect(exp.items[0].name).toBe('BLS');
      expect(exp.items[0].nurse?.fullName).toBe('Maria Garcia');

      const detail = await service.getNurse(2, 1);
      expect(detail.nurse.credentialSummary).toBe('ExpiringSoon');
      expect(detail.nurse.credentialCounts.expiringSoon).toBe(1);
    });
  });

  describe('Roster', () => {
    it('creates assignment with joined names', async () => {
      const { assignment } = await service.createRosterAssignment(
        {
          nurse_id: 2,
          nursing_unit_id: 1,
          shift_id: 1,
          assignment_date: dateOnly(new Date(Date.now() + 2 * DAY)),
        } as any,
        1,
      );
      expect(assignment.nurseName).toBe('Maria Garcia');
      expect(assignment.unitCode).toBe('ICU_A');
      expect(assignment.shiftCode).toBe('MORNING');
      expect(assignment.status).toBe('Scheduled');
    });

    it('blocks double-booking (same nurse, date, shift) with 409', async () => {
      await expect(
        service.createRosterAssignment(
          {
            nurse_id: 2,
            nursing_unit_id: 2, // different unit must NOT bypass the guard
            shift_id: 1,
            assignment_date: dateOnly(new Date(Date.now() + 2 * DAY)),
          } as any,
          1,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('different shift on same date is allowed', async () => {
      const { assignment } = await service.createRosterAssignment(
        {
          nurse_id: 2,
          nursing_unit_id: 1,
          shift_id: 2,
          assignment_date: dateOnly(new Date(Date.now() + 2 * DAY)),
        } as any,
        1,
      );
      expect(assignment.shiftCode).toBe('EVENING');
    });

    it('soft delete marks cancelled and removes from window list', async () => {
      const res = await service.softDeleteRosterAssignment(2, 1);
      expect(res.message).toContain('deleted');
      const list = await service.listRoster({
        from: dateOnly(new Date()),
        to: dateOnly(new Date(Date.now() + 7 * DAY)),
      }, 1);
      expect(list.items.find((a: any) => a.id === 2)).toBeUndefined();
      expect(list.items.find((a: any) => a.id === 1)).toBeDefined();
    });
  });

  describe('Data scope enforcement', () => {
    const makeService = (local: FakePrisma) => new NursingService(local as any, { log: jest.fn() } as any);

    it('adds the caller scope to nurse and roster list queries', async () => {
      const local = new FakePrisma();
      local.scopes = [{ scope_type: 'NursingUnit', nursing_unit_id: 1 }];
      const scopedService = makeService(local);
      const nurseFind = jest.spyOn(local.nursing_nurses, 'findMany');
      const rosterFind = jest.spyOn(local.nursing_roster_assignments, 'findMany');

      await scopedService.listNurses({ page: 1, limit: 10 }, 50);
      await scopedService.listRoster({}, 50);

      expect(nurseFind.mock.calls.some(([args]) => args.where.AND?.[0]?.OR?.some(
        (entry: any) => entry.home_unit_id?.in?.includes(1),
      ))).toBe(true);
      expect(rosterFind.mock.calls[0][0].where.AND[0].OR).toContainEqual({
        nursing_unit_id: { in: [1] },
      });
    });

    it('limits lookup units and posts for a Post scope', async () => {
      const local = new FakePrisma();
      local.scopes = [{ scope_type: 'Post', post_id: 9 }];
      const scopedService = makeService(local);
      const unitFind = jest.spyOn(local.rbac_nursing_units, 'findMany');
      const postFind = jest.spyOn(local.rbac_posts, 'findMany');

      await scopedService.getLookups(50);

      const unitArgs = (unitFind.mock.calls as any[][])[0][0];
      const postArgs = (postFind.mock.calls as any[][])[0][0];
      expect(unitArgs.where.OR).toContainEqual({
        posts: { some: { id: { in: [9] } } },
      });
      expect(postArgs.where.OR).toContainEqual({ id: { in: [9] } });
    });

    it('allows Assigned scope only for the caller-linked staff record', async () => {
      const local = new FakePrisma();
      local.scopes = [{ scope_type: 'Assigned' }];
      local.nurses = [
        { id: 1, user_id: 50, home_unit_id: 2, deleted_at: null, first_name: 'Own', last_name: 'Record', credentials: [] },
        { id: 2, user_id: 51, home_unit_id: 2, deleted_at: null, first_name: 'Other', last_name: 'Record', credentials: [] },
      ];
      const scopedService = makeService(local);

      expect((await scopedService.getNurse(1, 50)).nurse.fullName).toBe('Own Record');
      await expect(scopedService.getNurse(2, 50)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('blocks roster mutations outside scope and mismatched unit posts', async () => {
      const local = new FakePrisma();
      local.scopes = [{ scope_type: 'NursingUnit', nursing_unit_id: 1 }];
      local.nurses = [{ id: 1, user_id: 51, home_unit_id: 2, deleted_at: null }];
      const scopedService = makeService(local);
      const assignment = { nurse_id: 1, nursing_unit_id: 2, shift_id: 1, assignment_date: '2026-10-01' };

      await expect(scopedService.createRosterAssignment(assignment as any, 50)).rejects.toBeInstanceOf(ForbiddenException);

      local.rbac_posts.findFirst = async () => ({ id: 9, nursing_unit_id: 2, status: 'Active' });
      await expect(scopedService.createRosterAssignment({ ...assignment, nursing_unit_id: 1, post_id: 9 } as any, 50))
        .rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
