import { CREDENTIAL_TEMPLATES, STAFF_POSITIONS } from './staff-catalog';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../auth/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CreateNurseDto,
  UpdateNurseDto,
  CreateCredentialDto,
  UpdateCredentialDto,
  VerifyCredentialDto,
  CreateRosterAssignmentDto,
  UpdateRosterAssignmentDto,
} from './dto/nursing.dto';

/** Days before expiry at which a credential counts as "expiring soon". */
const EXPIRING_SOON_DAYS = 30;

/** ISO countries for the Nationality selector (display names). */
export const COUNTRIES: string[] = [
  'Afghanistan', 'Albania', 'Algeria', 'Andorra', 'Angola', 'Antigua and Barbuda', 'Argentina',
  'Armenia', 'Australia', 'Austria', 'Azerbaijan', 'Bahamas', 'Bahrain', 'Bangladesh', 'Barbados',
  'Belarus', 'Belgium', 'Belize', 'Benin', 'Bhutan', 'Bolivia', 'Bosnia and Herzegovina',
  'Botswana', 'Brazil', 'Brunei', 'Bulgaria', 'Burkina Faso', 'Burundi', 'Cabo Verde', 'Cambodia',
  'Cameroon', 'Canada', 'Central African Republic', 'Chad', 'Chile', 'China', 'Colombia',
  'Comoros', 'Congo (Brazzaville)', 'Congo (Kinshasa)', 'Costa Rica', 'Croatia', 'Cuba', 'Cyprus',
  'Czechia', 'Denmark', 'Djibouti', 'Dominica', 'Dominican Republic', 'Ecuador', 'Egypt',
  'El Salvador', 'Equatorial Guinea', 'Eritrea', 'Estonia', 'Eswatini', 'Ethiopia', 'Fiji',
  'Finland', 'France', 'Gabon', 'Gambia', 'Georgia', 'Germany', 'Ghana', 'Greece', 'Grenada',
  'Guatemala', 'Guinea', 'Guinea-Bissau', 'Guyana', 'Haiti', 'Honduras', 'Hungary', 'Iceland',
  'India', 'Indonesia', 'Iran', 'Iraq', 'Ireland', 'Israel', 'Italy', 'Ivory Coast', 'Jamaica',
  'Japan', 'Jordan', 'Kazakhstan', 'Kenya', 'Kiribati', 'Kuwait', 'Kyrgyzstan', 'Laos', 'Latvia',
  'Lebanon', 'Lesotho', 'Liberia', 'Libya', 'Liechtenstein', 'Lithuania', 'Luxembourg',
  'Madagascar', 'Malawi', 'Malaysia', 'Maldives', 'Mali', 'Malta', 'Marshall Islands',
  'Mauritania', 'Mauritius', 'Mexico', 'Micronesia', 'Moldova', 'Monaco', 'Mongolia',
  'Montenegro', 'Morocco', 'Mozambique', 'Myanmar', 'Namibia', 'Nauru', 'Nepal', 'Netherlands',
  'New Zealand', 'Nicaragua', 'Niger', 'Nigeria', 'North Korea', 'North Macedonia', 'Norway',
  'Oman', 'Pakistan', 'Palau', 'Palestine', 'Panama', 'Papua New Guinea', 'Paraguay', 'Peru',
  'Philippines', 'Poland', 'Portugal', 'Qatar', 'Romania', 'Russia', 'Rwanda',
  'Saint Kitts and Nevis', 'Saint Lucia', 'Saint Vincent and the Grenadines', 'Samoa',
  'San Marino', 'Sao Tome and Principe', 'Saudi', 'Senegal', 'Serbia', 'Seychelles',
  'Sierra Leone', 'Singapore', 'Slovakia', 'Slovenia', 'Solomon Islands', 'Somalia',
  'South Africa', 'South Korea', 'South Sudan', 'Spain', 'Sri Lanka', 'Sudan', 'Suriname',
  'Sweden', 'Switzerland', 'Syria', 'Taiwan', 'Tajikistan', 'Tanzania', 'Thailand',
  'Timor-Leste', 'Togo', 'Tonga', 'Trinidad and Tobago', 'Tunisia', 'Turkey', 'Turkmenistan',
  'Tuvalu', 'Uganda', 'Ukraine', 'United Arab Emirates', 'United Kingdom', 'United States',
  'Uruguay', 'Uzbekistan', 'Vanuatu', 'Vatican City', 'Venezuela', 'Vietnam', 'Yemen',
  'Zambia', 'Zimbabwe',
];

@Injectable()
export class NursingService {
  private readonly logger = new Logger(NursingService.name);

  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
  ) {}

  // ==========================================================================
  // Nurses
  // ==========================================================================

  async listNurses(params: {
    search?: string;
    status?: string;
    unitId?: number;
    page?: number;
    limit?: number;
  }, actorId: number) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 20));
    const where: any = { deleted_at: null };
    const scope = await this.getScopeContext(actorId);
    const scopeWhere = this.nurseScopeWhere(scope, actorId);
    if (!scope.all) where.AND = [scopeWhere];

    if (params.status) where.status = params.status;
    if (params.unitId) where.home_unit_id = params.unitId;
    if (params.search) {
      const q = params.search.trim();
      const searchWhere = { OR: [
        { first_name: { contains: q, mode: 'insensitive' } },
        { middle_name: { contains: q, mode: 'insensitive' } },
        { last_name: { contains: q, mode: 'insensitive' } },
        { employee_number: { contains: q, mode: 'insensitive' } },
        { job_no: { contains: q, mode: 'insensitive' } },
      ] };
      if (scope.all) where.OR = searchWhere.OR;
      else where.AND.push(searchWhere);
    }

    const [rows, total] = await Promise.all([
      this.prisma.nursing_nurses.findMany({
        where,
        include: {
          primary_role: { select: { id: true, code: true, name: true } },
          home_unit: { select: { id: true, code: true, name: true, department_id: true, department: { select: { id: true, name: true } } } },
          user: { select: { username: true, email: true } },
          credentials: {
            where: { deleted_at: null },
            select: { status: true, expiry_date: true },
          },
        },
        orderBy: [{ last_name: 'asc' }, { first_name: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.nursing_nurses.count({ where }),
    ]);

    const items = (rows || []).map((r: any) => this.mapNurseRow(r));
    const totalPages = Math.max(1, Math.ceil(total / limit));

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  async getNurse(id: number, actorId: number) {
    await this.assertNurseScope(id, actorId);
    const scope = await this.getScopeContext(actorId);
    const row = await this.prisma.nursing_nurses.findUnique({
      where: { id },
      include: {
        primary_role: { select: { id: true, code: true, name: true } },
        home_unit: { select: { id: true, code: true, name: true, department_id: true, department: { select: { id: true, name: true } } } },
        user: { select: { username: true, email: true } },
        credentials: {
          where: { deleted_at: null },
          orderBy: { expiry_date: 'asc' },
        },
        roster_assignments: {
          where: { deleted_at: null, assignment_date: { gte: this.startOfToday() },
            ...(!scope.all && { AND: [this.rosterScopeWhere(scope, actorId)] }) },
          include: {
            nursing_unit: { select: { id: true, code: true, name: true } },
            shift: { select: { id: true, code: true, name: true } },
            post: { select: { id: true, code: true, name: true } },
          },
          orderBy: { assignment_date: 'asc' },
          take: 14,
        },
      },
    });

    if (!row || row.deleted_at) {
      throw new NotFoundException(`Nurse #${id} not found`);
    }

    return {
      nurse: {
        ...this.mapNurseRow(row),
        credentials: (row.credentials || []).map((c: any) => this.mapCredentialRow(c)),
        upcomingAssignments: (row.roster_assignments || []).map((a: any) =>
          this.mapRosterRow(a),
        ),
      },
    };
  }

  async createNurse(dto: CreateNurseDto, actorId: number) {
    await this.validateStaffAssignment(dto, actorId);
    await this.assertNurseDestinationScope(dto.home_unit_id, dto.user_id, actorId);
    // Employee number is not entered by the user in the personal-info form -
    // auto-generate a unique one (can be edited later in the employment group).
    if (!dto.employee_number) {
      dto.employee_number = await this.generateEmployeeNumber();
    }
    // Job No. is typed by the user, so normalise it before the uniqueness check.
    const jobNo = dto.job_no.trim();
    try {
      const created = await this.prisma.nursing_nurses.create({
        data: {
          employee_number: dto.employee_number,
          job_no: jobNo,
          user_id: dto.user_id ?? null,
          first_name: dto.first_name,
          middle_name: dto.middle_name ?? null,
          last_name: dto.last_name,
          gender: dto.gender ?? null,
          date_of_birth: dto.date_of_birth ? new Date(dto.date_of_birth) : null,
          nationality: dto.nationality ?? null,
          phone: dto.phone ?? null,
          hire_date: dto.hire_date ? new Date(dto.hire_date) : null,
          employment_type: dto.employment_type || 'FullTime',
          primary_role_id: dto.primary_role_id ?? null,
          home_unit_id: dto.home_unit_id ?? null,
          position_code: dto.position_code ?? null,
          created_by: actorId,
          updated_by: actorId,
        },
        include: {
          primary_role: { select: { id: true, code: true, name: true } },
          home_unit: { select: { id: true, code: true, name: true, department_id: true, department: { select: { id: true, name: true } } } },
          user: { select: { username: true, email: true } },
          credentials: { where: { deleted_at: null } },
        },
      });

      await this.auditService.log({
        userId: actorId,
        action: 'NURSE_CREATED',
        entityType: 'Nurse',
        entityId: created.id,
        entityCode: created.employee_number,
        description: `Nurse created: ${created.first_name} ${created.last_name} (${created.employee_number})`,
        status: 'Success',
      });

      return { nurse: this.mapNurseRow(created) };
    } catch (error: any) {
      this.throwIfUniqueViolation(error, {
        job_no: `Job No. "${jobNo}" is already used by another nurse`,
        employee_number: `Employee number "${dto.employee_number}" already exists`,
        user_id: 'That login account is already linked to another nurse record',
      });
      throw error;
    }
  }

  async updateNurse(id: number, dto: UpdateNurseDto, actorId: number) {
    const existing = await this.assertNurseScope(id, actorId);
    await this.validateStaffAssignment(dto, actorId);
    await this.assertNurseDestinationScope(
      dto.home_unit_id !== undefined ? dto.home_unit_id : Number(existing.home_unit_id) || null,
      dto.user_id !== undefined ? dto.user_id : Number(existing.user_id) || null,
      actorId,
    );
    try {
      const updated = await this.prisma.nursing_nurses.update({
        where: { id },
        data: {
          ...(dto.job_no !== undefined && { job_no: dto.job_no.trim() }),
          ...(dto.employee_number !== undefined && { employee_number: dto.employee_number }),
          ...(dto.user_id !== undefined && { user_id: dto.user_id }),
          ...(dto.first_name !== undefined && { first_name: dto.first_name }),
          ...(dto.middle_name !== undefined && { middle_name: dto.middle_name }),
          ...(dto.last_name !== undefined && { last_name: dto.last_name }),
          ...(dto.gender !== undefined && { gender: dto.gender }),
          ...(dto.date_of_birth !== undefined && {
            date_of_birth: dto.date_of_birth ? new Date(dto.date_of_birth) : null,
          }),
          ...(dto.nationality !== undefined && { nationality: dto.nationality }),
          ...(dto.phone !== undefined && { phone: dto.phone }),
          ...(dto.hire_date !== undefined && {
            hire_date: dto.hire_date ? new Date(dto.hire_date) : null,
          }),
          ...(dto.employment_type !== undefined && { employment_type: dto.employment_type }),
          ...(dto.primary_role_id !== undefined && { primary_role_id: dto.primary_role_id }),
          ...(dto.position_code !== undefined && { position_code: dto.position_code }),
          ...(dto.home_unit_id !== undefined && { home_unit_id: dto.home_unit_id }),
          ...(dto.status !== undefined && { status: dto.status }),
          updated_by: actorId,
        },
        include: {
          primary_role: { select: { id: true, code: true, name: true } },
          home_unit: { select: { id: true, code: true, name: true, department_id: true, department: { select: { id: true, name: true } } } },
          user: { select: { username: true, email: true } },
          credentials: { where: { deleted_at: null } },
        },
      });

      await this.auditService.log({
        userId: actorId,
        action: 'NURSE_UPDATED',
        entityType: 'Nurse',
        entityId: id,
        description: `Nurse #${id} updated`,
        changes: dto as any,
        status: 'Success',
      });

      return { nurse: this.mapNurseRow(updated) };
    } catch (error: any) {
      this.throwIfUniqueViolation(error, {
        job_no: `Job No. "${(dto.job_no || '').trim()}" is already used by another nurse`,
        employee_number: `Employee number "${dto.employee_number}" already exists`,
        user_id: 'That login account is already linked to another nurse record',
      });
      throw error;
    }
  }

  async softDeleteNurse(id: number, actorId: number) {
    await this.assertNurseScope(id, actorId);
    await this.prisma.nursing_nurses.update({
      where: { id },
      data: { deleted_at: new Date(), status: 'Terminated', updated_by: actorId },
    });

    await this.auditService.log({
      userId: actorId,
      action: 'NURSE_DELETED',
      entityType: 'Nurse',
      entityId: id,
      description: `Nurse #${id} soft-deleted (status -> Terminated)`,
      status: 'Success',
    });

    return { message: `Nurse #${id} deleted` };
  }

  // ==========================================================================
  // Credentials
  // ==========================================================================

  async listNurseCredentials(nurseId: number, actorId: number) {
    await this.assertNurseScope(nurseId, actorId);
    const rows = await this.prisma.nursing_credentials.findMany({
      where: { nurse_id: nurseId, deleted_at: null },
      orderBy: { expiry_date: 'asc' },
    });
    return { items: (rows || []).map((c: any) => this.mapCredentialRow(c)) };
  }

  async listExpiringCredentials(days: number = EXPIRING_SOON_DAYS, actorId: number) {
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + Math.max(1, days));
    const scope = await this.getScopeContext(actorId);

    const rows = await this.prisma.nursing_credentials.findMany({
      where: {
        deleted_at: null,
        status: { in: ['Valid', 'ExpiringSoon'] },
        expiry_date: { lte: horizon },
        nurse: { deleted_at: null, status: 'Active', ...this.nurseScopeWhere(scope, actorId) },
      },
      include: {
        nurse: { select: { id: true, employee_number: true, first_name: true, last_name: true } },
      },
      orderBy: { expiry_date: 'asc' },
      take: 500,
    });

    return {
      days,
      items: (rows || []).map((c: any) => ({
        ...this.mapCredentialRow(c),
        nurse: c.nurse
          ? {
              id: c.nurse.id,
              employeeNumber: c.nurse.employee_number,
              fullName: `${c.nurse.first_name} ${c.nurse.last_name}`,
            }
          : null,
      })),
    };
  }

  async createCredential(dto: CreateCredentialDto, actorId: number) {
    await this.assertNurseScope(dto.nurse_id, actorId);
    const trackingData = await this.validateCredential(dto, actorId);
    try {
      const created = await this.prisma.nursing_credentials.create({
        data: {
          nurse_id: dto.nurse_id,
          template_code: dto.template_code ?? null,
          tracking_data: trackingData,
          credential_type: dto.credential_type,
          name: dto.name,
          issuing_authority: dto.issuing_authority ?? null,
          credential_number: dto.credential_number ?? null,
          issued_date: dto.issued_date ? new Date(dto.issued_date) : null,
          expiry_date: dto.expiry_date ? new Date(dto.expiry_date) : null,
          created_by: actorId,
          updated_by: actorId,
        },
      });

      await this.auditService.log({
        userId: actorId,
        action: 'CREDENTIAL_CREATED',
        entityType: 'Credential',
        entityId: created.id,
        entityCode: dto.name,
        description: `Credential ${dto.name} (${dto.credential_type}) added for nurse #${dto.nurse_id}`,
        status: 'Success',
      });

      return { credential: this.mapCredentialRow(created) };
    } catch (error: any) {
      this.throwIfUniqueViolation(error, {
        uq_credentials_nurse_type_name: `Nurse already has a ${dto.credential_type} named "${dto.name}"`,
      });
      throw error;
    }
  }

  async updateCredential(id: number, dto: UpdateCredentialDto, actorId: number) {
    const existing = await this.assertCredentialScope(id, actorId);
    if (dto.template_code !== undefined && dto.template_code !== existing.template_code) {
      throw new BadRequestException("The credential template cannot be changed; add a separate credential instead");
    }
    const trackingData = await this.validateCredential({ ...existing, ...dto }, actorId);
    const updated = await this.prisma.nursing_credentials.update({
      where: { id },
      data: {
        ...(dto.credential_type !== undefined && { credential_type: dto.credential_type }),
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.issuing_authority !== undefined && { issuing_authority: dto.issuing_authority }),
        ...(dto.credential_number !== undefined && { credential_number: dto.credential_number }),
        ...(dto.issued_date !== undefined && { issued_date: dto.issued_date ? new Date(dto.issued_date) : null }),
        ...(dto.expiry_date !== undefined && { expiry_date: dto.expiry_date ? new Date(dto.expiry_date) : null }),
        tracking_data: trackingData,
        status: 'PendingVerification',
        verified_by: null,
        verified_at: null,
        updated_by: actorId,
      },
    });

    await this.auditService.log({
      userId: actorId,
      action: 'CREDENTIAL_UPDATED',
      entityType: 'Credential',
      entityId: id,
      description: `Credential #${id} updated`,
      changes: { fields: Object.keys(dto) },
      status: 'Success',
    });

    return { credential: this.mapCredentialRow(updated) };
  }

  async verifyCredential(id: number, dto: VerifyCredentialDto, actorId: number) {
    // H-7 fix: wrap in a transaction so the status check and update are atomic.
    // Without this, two concurrent verify calls could both read the same status
    // and both succeed, creating conflicting verification records.
    const updated = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.nursing_credentials.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException(`Credential #${id} not found`);

      const status = dto.status || 'Valid';
      if (status === 'Valid' && existing.expiry_date && new Date(existing.expiry_date) < this.startOfToday()) {
        throw new BadRequestException('Expired credentials cannot be verified as Valid');
      }

      return tx.nursing_credentials.update({
        where: { id },
        data: {
          status,
          verified_by: actorId,
          verified_at: new Date(),
          updated_by: actorId,
        },
      });
    });

    await this.auditService.log({
      userId: actorId,
      action: 'CREDENTIAL_VERIFIED',
      entityType: 'Credential',
      entityId: id,
      description: `Credential #${id} verified -> ${updated.status}`,
      status: 'Success',
    });

    return { credential: this.mapCredentialRow(updated) };
  }

  // ==========================================================================
  // Roster assignments
  // ==========================================================================

  async listRoster(params: {
    from?: string;
    to?: string;
    unitId?: number;
    nurseId?: number;
    status?: string;
  }, actorId: number) {
    const from = params.from ? new Date(params.from) : this.startOfToday();
    const to = params.to ? new Date(params.to) : new Date(from.getTime() + 31 * 86400000);
    const where: any = {
      deleted_at: null,
      assignment_date: { gte: from, lte: to },
    };
    const scope = await this.getScopeContext(actorId);
    if (!scope.all) where.AND = [this.rosterScopeWhere(scope, actorId)];
    if (params.unitId) where.nursing_unit_id = params.unitId;
    if (params.nurseId) where.nurse_id = params.nurseId;
    if (params.status) where.status = params.status;

    const rows = await this.prisma.nursing_roster_assignments.findMany({
      where,
      include: {
        nurse: { select: { id: true, employee_number: true, first_name: true, last_name: true } },
        nursing_unit: { select: { id: true, code: true, name: true } },
        shift: { select: { id: true, code: true, name: true, start_time: true, end_time: true } },
        post: { select: { id: true, code: true, name: true } },
      },
      orderBy: [{ assignment_date: 'asc' }, { shift_id: 'asc' }],
      take: 1000,
    });

    return {
      from: this.toDateOnly(from),
      to: this.toDateOnly(to),
      items: (rows || []).map((a: any) => this.mapRosterRow(a)),
    };
  }

  async createRosterAssignment(dto: CreateRosterAssignmentDto, actorId: number) {
    await this.validateRosterAssignmentScope(dto, actorId);
    await this.assertNurseHasValidContract(dto.nurse_id, dto.assignment_date);
    try {
      const created = await this.prisma.nursing_roster_assignments.create({
        data: {
          nurse_id: dto.nurse_id,
          nursing_unit_id: dto.nursing_unit_id,
          shift_id: dto.shift_id,
          post_id: dto.post_id ?? null,
          assignment_date: new Date(dto.assignment_date),
          notes: dto.notes ?? null,
          created_by: actorId,
          updated_by: actorId,
        },
        include: {
          nurse: { select: { id: true, employee_number: true, first_name: true, last_name: true } },
          nursing_unit: { select: { id: true, code: true, name: true } },
          shift: { select: { id: true, code: true, name: true } },
          post: { select: { id: true, code: true, name: true } },
        },
      });

      await this.auditService.log({
        userId: actorId,
        action: 'ROSTER_CREATED',
        entityType: 'RosterAssignment',
        entityId: created.id,
        description: `Roster assignment created: nurse #${dto.nurse_id} -> ${this.toDateOnly(new Date(dto.assignment_date))}`,
        status: 'Success',
      });

      return { assignment: this.mapRosterRow(created) };
    } catch (error: any) {
      this.throwIfUniqueViolation(error, {
        uq_roster_nurse_date_shift: `Nurse #${dto.nurse_id} is already assigned to that shift on ${dto.assignment_date}`,
      });
      throw error;
    }
  }

  async updateRosterAssignment(id: number, dto: UpdateRosterAssignmentDto, actorId: number) {
    const existing = await this.assertRosterScope(id, actorId);
    await this.validateRosterAssignmentScope({ ...existing, ...dto }, actorId);
    const nurseId = dto.nurse_id !== undefined ? dto.nurse_id : Number(existing.nurse_id);
    const onDate =
      dto.assignment_date !== undefined
        ? dto.assignment_date
        : existing.assignment_date;
    await this.assertNurseHasValidContract(nurseId, onDate);
    try {
      const updated = await this.prisma.nursing_roster_assignments.update({
        where: { id },
        data: {
          ...(dto.nurse_id !== undefined && { nurse_id: dto.nurse_id }),
          ...(dto.nursing_unit_id !== undefined && { nursing_unit_id: dto.nursing_unit_id }),
          ...(dto.shift_id !== undefined && { shift_id: dto.shift_id }),
          ...(dto.post_id !== undefined && { post_id: dto.post_id }),
          ...(dto.assignment_date !== undefined && {
            assignment_date: new Date(dto.assignment_date),
          }),
          ...(dto.status !== undefined && { status: dto.status }),
          ...(dto.notes !== undefined && { notes: dto.notes }),
          updated_by: actorId,
        },
        include: {
          nurse: { select: { id: true, employee_number: true, first_name: true, last_name: true } },
          nursing_unit: { select: { id: true, code: true, name: true } },
          shift: { select: { id: true, code: true, name: true } },
          post: { select: { id: true, code: true, name: true } },
        },
      });

      await this.auditService.log({
        userId: actorId,
        action: 'ROSTER_UPDATED',
        entityType: 'RosterAssignment',
        entityId: id,
        description: `Roster assignment #${id} updated`,
        changes: dto as any,
        status: 'Success',
      });

      return { assignment: this.mapRosterRow(updated) };
    } catch (error: any) {
      this.throwIfUniqueViolation(error, {
        uq_roster_nurse_date_shift: 'That change would double-book the nurse on this shift/date',
      });
      throw error;
    }
  }

  async softDeleteRosterAssignment(id: number, actorId: number) {
    await this.assertRosterScope(id, actorId);
    await this.prisma.nursing_roster_assignments.update({
      where: { id },
      data: { deleted_at: new Date(), status: 'Cancelled', updated_by: actorId },
    });

    await this.auditService.log({
      userId: actorId,
      action: 'ROSTER_DELETED',
      entityType: 'RosterAssignment',
      entityId: id,
      description: `Roster assignment #${id} soft-deleted (status -> Cancelled)`,
      status: 'Success',
    });

    return { message: `Roster assignment #${id} deleted` };
  }

  // ==========================================================================
  // Lookups (reference data for forms; JWT required, no RBAC menu guard)
  // ==========================================================================

  async getLookups(actorId: number) {
    const scope = await this.getScopeContext(actorId);
    const departmentScope = scope.all ? {} : {
      OR: [
        ...(scope.departmentIds.length ? [{ id: { in: scope.departmentIds } }] : []),
        ...(scope.organizationIds.length ? [{ organization_id: { in: scope.organizationIds } }] : []),
        ...(scope.postIds.length ? [{ nursing_units: { some: { posts: { some: { id: { in: scope.postIds } } } } } }] : []),
      ],
    };
    const unitScope = scope.all ? {} : {
      OR: [
        ...(scope.nursingUnitIds.length ? [{ id: { in: scope.nursingUnitIds } }] : []),
        ...(scope.departmentIds.length ? [{ department_id: { in: scope.departmentIds } }] : []),
        ...(scope.organizationIds.length ? [{ department: { organization_id: { in: scope.organizationIds } } }] : []),
        ...(scope.postIds.length ? [{ posts: { some: { id: { in: scope.postIds } } } }] : []),
      ],
    };
    const postScope = scope.all ? {} : {
      OR: [
        ...(scope.nursingUnitIds.length ? [{ nursing_unit_id: { in: scope.nursingUnitIds } }] : []),
        ...(scope.departmentIds.length ? [{ nursing_unit: { department_id: { in: scope.departmentIds } } }] : []),
        ...(scope.organizationIds.length ? [{ nursing_unit: { department: { organization_id: { in: scope.organizationIds } } } }] : []),
        ...(scope.postIds.length ? [{ id: { in: scope.postIds } }] : []),
      ],
    };
    const hasBroadRosterScope = scope.all || scope.assigned || scope.organizationIds.length
      || scope.departmentIds.length || scope.nursingUnitIds.length || scope.postIds.length;
    const shiftScope = hasBroadRosterScope ? {} : scope.shiftIds.length
      ? { id: { in: scope.shiftIds } }
      : { id: -1 };
    const [roles, units, shifts, posts, departments] = await Promise.all([
      this.prisma.system_hospital_roles.findMany({
        where: { status: 'Active' },
        select: { id: true, code: true, name: true, category: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.rbac_nursing_units.findMany({
        where: { status: 'Active', department: { status: 'Active' }, ...unitScope },
        select: { id: true, code: true, name: true, department_id: true },
        orderBy: { code: 'asc' },
      }),
      this.prisma.rbac_shifts.findMany({
        where: { status: 'Active', ...shiftScope },
        select: { id: true, code: true, name: true, start_time: true, end_time: true },
        orderBy: { id: 'asc' },
      }),
      this.prisma.rbac_posts.findMany({
        where: { status: 'Active', ...postScope },
        select: { id: true, code: true, name: true, nursing_unit_id: true },
        orderBy: { code: 'asc' },
      }),
      this.prisma.rbac_departments.findMany({
        where: { status: 'Active', ...departmentScope },
        select: { id: true, code: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    return {
      positions: STAFF_POSITIONS,
      credentialTemplates: CREDENTIAL_TEMPLATES,
      departments: (departments || []).map(d => ({ ...d, id: Number(d.id) })),
      roles: (roles || []).map(r => ({ ...r, id: Number(r.id) })),
      units: (units || []).map(u => ({ ...u, id: Number(u.id), department_id: Number(u.department_id) })),
      shifts: (shifts || []).map(s => ({ ...s, id: Number(s.id) })),
      posts: (posts || []).map(p => ({ ...p, id: Number(p.id), nursing_unit_id: Number(p.nursing_unit_id) })),
      countries: COUNTRIES,
    };
  }

  /**
   * Generate a unique employee number (EMP-YYYY-NNNNN) for the personal-info
   * form, where employee numbers are not entered manually.
   */
  private async generateEmployeeNumber(): Promise<string> {
    // L-5 fix: use crypto.randomInt for better entropy instead of Math.random().
    // Math.random() with only 90,000 possible values had a birthday-problem
    // collision probability that grew quickly as the nurse table filled.
    // crypto.randomInt is also CSPRNG-backed, avoiding predictability.
    const { randomInt } = await import('crypto');
    const year = new Date().getFullYear();
    for (let attempt = 0; attempt < 10; attempt++) {
      const num = randomInt(10000, 100000); // 10000–99999 (5 digits)
      const candidate = `EMP-${year}-${String(num)}`;
      const existing = await this.prisma.nursing_nurses.findFirst({
        where: { employee_number: candidate },
        select: { id: true },
      });
      if (!existing) return candidate;
    }
    // Extremely unlikely fallback
    return `EMP-${year}-${Date.now()}`;
  }

  // ==========================================================================
  // Internal helpers
  // ==========================================================================

  private async validateStaffAssignment(dto: CreateNurseDto | UpdateNurseDto, actorId: number) {
    if (dto.position_code != null && !STAFF_POSITIONS.some(p => p.code === dto.position_code)) {
      throw new BadRequestException('Unknown staff position');
    }
    if (dto.home_unit_id != null) {
      const unit = await this.prisma.rbac_nursing_units.findFirst({
        where: { id: dto.home_unit_id, status: 'Active', department: { status: 'Active' } },
        include: { department: { select: { id: true, organization_id: true } } },
      });
      if (!unit) throw new BadRequestException('Select an active nursing unit');
      const scope = await this.getScopeContext(actorId);
      if (!this.scopeAllowsUnit(scope, unit)) {
        throw new ForbiddenException('The selected nursing unit is outside your assigned scope');
      }
    }
  }

  private async validateCredential(dto: any, actorId: number): Promise<Record<string, string | number>> {
    const template = CREDENTIAL_TEMPLATES.find(t => t.code === dto.template_code);
    if (dto.template_code && !template) throw new BadRequestException('Unknown credential template');
    if (template && (template.name !== dto.name || template.credentialType !== dto.credential_type)) {
      throw new BadRequestException('Credential name and type must match the selected template');
    }
    const validDate = (value: unknown): boolean => {
      if (value instanceof Date) return !Number.isNaN(value.getTime());
      return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
        && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
    };
    for (const key of ['issued_date', 'expiry_date']) {
      if (dto[key] != null && !validDate(dto[key])) throw new BadRequestException(`${key} must be a valid date`);
    }
    if (dto.issued_date && dto.expiry_date && new Date(dto.expiry_date) < new Date(dto.issued_date)) {
      throw new BadRequestException('Expiry/reassessment date cannot precede issue/assessment date');
    }
    const data = dto.tracking_data ?? {};
    if (typeof data !== 'object' || Array.isArray(data)) throw new BadRequestException('Invalid tracking data');
    const result: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(data)) {
      const field = template?.fields.find(f => f.key === key);
      if (!field) throw new BadRequestException(`Unsupported tracking field: ${key}`);
      if (value === '' || value == null) continue;
      if (field.type === 'number' || field.type === 'unit') {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0
          || ((field.type === 'unit' || key === 'supervisedCasesCount') && !Number.isInteger(value))) {
          throw new BadRequestException(`${field.label} must be a non-negative ${key === 'coverageAmount' ? 'number' : 'integer'}`);
        }
        if (field.type === 'unit') await this.validateStaffAssignment({ home_unit_id: value }, actorId);
      } else {
        if (typeof value !== 'string' || value.length > 500) throw new BadRequestException(`${field.label} must be text up to 500 characters`);
        if (field.type === 'date' && !validDate(value)) throw new BadRequestException(`${field.label} must be a valid date`);
        if (field.type === 'select' && !field.options.includes(value)) throw new BadRequestException(`Invalid ${field.label}`);
        if (key === 'expiryDateHijri' && !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|30)$/.test(value)) {
          throw new BadRequestException('Enter the Hijri date as YYYY-MM-DD');
        }
      }
      result[key] = value as string | number;
    }
    return result;
  }

  async uploadCredentialDocument(id: number, file: { buffer: Buffer; originalname: string; mimetype: string }, actorId: number) {
    await this.assertCredentialScope(id, actorId);
    if (!file?.buffer?.length || file.buffer.length > 5 * 1024 * 1024) {
      throw new BadRequestException('Upload a PDF, JPEG, or PNG file up to 5 MB');
    }
    const b = file.buffer;
    const mediaType = b.subarray(0, 5).toString() === '%PDF-' ? 'application/pdf'
      : b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png'
        : b[0] === 255 && b[1] === 216 && b[2] === 255 ? 'image/jpeg' : null;
    if (!mediaType || mediaType !== file.mimetype) throw new BadRequestException('Only PDF, JPEG, and PNG documents are accepted');
    const fileName = Array.from(file.originalname, char =>
      char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 || char === '/' || char === '\\' ? '_' : char,
    ).join('').slice(0, 255);
    // Parameterized SQL; storage and verification reset are atomic.
    await this.prisma.$queryRawUnsafe(`
      WITH saved AS (
        INSERT INTO nursing.credential_documents (credential_id, file_name, media_type, content, uploaded_by)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (credential_id) DO UPDATE SET file_name = EXCLUDED.file_name,
          media_type = EXCLUDED.media_type, content = EXCLUDED.content,
          uploaded_by = EXCLUDED.uploaded_by, uploaded_at = CURRENT_TIMESTAMP
        RETURNING credential_id
      ) UPDATE nursing.credentials SET status = 'PendingVerification', verified_by = NULL,
        verified_at = NULL, updated_by = $5, updated_at = CURRENT_TIMESTAMP
        WHERE id IN (SELECT credential_id FROM saved) RETURNING id`, id, fileName, mediaType, b, actorId);
    return { fileName, mediaType, size: b.length };
  }

  async getCredentialDocument(id: number, actorId: number, includeContent = false) {
    await this.assertCredentialScope(id, actorId);
    const rows = await this.prisma.$queryRawUnsafe(`SELECT file_name, media_type,
      octet_length(content) AS size, uploaded_at ${includeContent ? ', content' : ''}
      FROM nursing.credential_documents WHERE credential_id = $1`, id);
    const row = rows[0];
    if (!row) {
      if (includeContent) throw new NotFoundException('No document has been uploaded');
      return null;
    }
    return { fileName: row.file_name, mediaType: row.media_type, size: row.size,
      uploadedAt: row.uploaded_at, ...(includeContent && { content: row.content }) };
  }

  private async ensureNurseExists(id: number) {
    const row = await this.prisma.nursing_nurses.findUnique({ where: { id } });
    if (!row || row.deleted_at) throw new NotFoundException(`Nurse #${id} not found`);
  }

  private async ensureCredentialExists(id: number) {
    const row = await this.prisma.nursing_credentials.findUnique({ where: { id } });
    if (!row || row.deleted_at) throw new NotFoundException(`Credential #${id} not found`);
    await this.ensureNurseExists(Number(row.nurse_id));
    return row;
  }

  private async getScopeContext(actorId: number) {
    const now = new Date();
    const scopes = await this.prisma.rbac_user_data_scopes.findMany({
      where: {
        user_id: actorId,
        status: 'Active',
        AND: [
          { OR: [{ effective_from: null }, { effective_from: { lte: now } }] },
          { OR: [{ effective_to: null }, { effective_to: { gte: now } }] },
        ],
      },
      select: { scope_type: true, organization_id: true, department_id: true, nursing_unit_id: true,
        post_id: true, shift_id: true },
    });
    return {
      all: scopes.some((s: any) => s.scope_type === 'All'),
      assigned: scopes.some((s: any) => s.scope_type === 'Assigned'),
      organizationIds: scopes.filter((s: any) => s.scope_type === 'Hospital' && s.organization_id != null).map((s: any) => s.organization_id),
      departmentIds: scopes.filter((s: any) => s.scope_type === 'Department' && s.department_id != null).map((s: any) => s.department_id),
      nursingUnitIds: scopes.filter((s: any) => s.scope_type === 'NursingUnit' && s.nursing_unit_id != null).map((s: any) => s.nursing_unit_id),
      postIds: scopes.filter((s: any) => s.scope_type === 'Post' && s.post_id != null).map((s: any) => s.post_id),
      shiftIds: scopes.filter((s: any) => s.scope_type === 'Shift' && s.shift_id != null).map((s: any) => s.shift_id),
    };
  }

  private scopeAllowsUnit(scope: any, unit: any): boolean {
    if (scope.all) return true;
    if (!unit) return false;
    const unitId = String(unit.id);
    const departmentId = String(unit.department_id ?? unit.department?.id ?? '');
    const organizationId = String(unit.department?.organization_id ?? '');
    return scope.nursingUnitIds.some((id: any) => String(id) === unitId)
      || scope.departmentIds.some((id: any) => String(id) === departmentId)
      || scope.organizationIds.some((id: any) => String(id) === organizationId);
  }

  private nurseScopeWhere(scope: any, actorId: number): any {
    if (scope.all) return {};
    const OR: any[] = [];
    if (scope.assigned) OR.push({ user_id: actorId });
    if (scope.nursingUnitIds.length) OR.push({ home_unit_id: { in: scope.nursingUnitIds } });
    if (scope.departmentIds.length) OR.push({ home_unit: { department_id: { in: scope.departmentIds } } });
    if (scope.organizationIds.length) OR.push({ home_unit: { department: { organization_id: { in: scope.organizationIds } } } });
    // M-4 fix: empty OR is vacuously true in Prisma — deny all instead
    if (OR.length === 0) return { id: -1 };
    return { OR };
  }

  private rosterScopeWhere(scope: any, actorId: number): any {
    if (scope.all) return {};
    const OR: any[] = [];
    if (scope.assigned) OR.push({ nurse: { user_id: actorId } });
    if (scope.nursingUnitIds.length) OR.push({ nursing_unit_id: { in: scope.nursingUnitIds } });
    if (scope.departmentIds.length) OR.push({ nursing_unit: { department_id: { in: scope.departmentIds } } });
    if (scope.organizationIds.length) OR.push({ nursing_unit: { department: { organization_id: { in: scope.organizationIds } } } });
    if (scope.postIds.length) OR.push({ post_id: { in: scope.postIds } });
    if (scope.shiftIds.length) OR.push({ shift_id: { in: scope.shiftIds } });
    // M-4 fix: empty OR is vacuously true in Prisma — deny all instead
    if (OR.length === 0) return { id: -1 };
    return { OR };
  }

  private scopeAllowsRoster(scope: any, assignment: any, actorId: number): boolean {
    if (scope.all) return true;
    return (scope.assigned && Number(assignment.nurse?.user_id) === actorId)
      || this.scopeAllowsUnit(scope, assignment.nursing_unit)
      || scope.postIds.some((id: any) => String(id) === String(assignment.post_id ?? ''))
      || scope.shiftIds.some((id: any) => String(id) === String(assignment.shift_id));
  }

  private async assertNurseDestinationScope(homeUnitId: number | null | undefined, userId: number | null | undefined, actorId: number) {
    const scope = await this.getScopeContext(actorId);
    if (scope.all || (scope.assigned && Number(userId) === actorId)) return;
    if (homeUnitId != null) {
      const unit = await this.prisma.rbac_nursing_units.findFirst({
        where: { id: homeUnitId, status: 'Active', department: { status: 'Active' } },
        include: { department: { select: { id: true, organization_id: true } } },
      });
      if (unit && this.scopeAllowsUnit(scope, unit)) return;
    }
    throw new ForbiddenException('The staff assignment is outside your assigned scope');
  }

  private async validateRosterAssignmentScope(dto: any, actorId: number) {
    const [nurse, unit, shift, post, scope] = await Promise.all([
      this.prisma.nursing_nurses.findUnique({ where: { id: Number(dto.nurse_id) } }),
      this.prisma.rbac_nursing_units.findFirst({
        where: { id: Number(dto.nursing_unit_id), status: 'Active', department: { status: 'Active' } },
        include: { department: { select: { id: true, organization_id: true } } },
      }),
      this.prisma.rbac_shifts.findFirst({ where: { id: Number(dto.shift_id), status: 'Active' } }),
      dto.post_id == null ? Promise.resolve(null) : this.prisma.rbac_posts.findFirst({
        where: { id: Number(dto.post_id), status: 'Active' },
      }),
      this.getScopeContext(actorId),
    ]);
    if (!nurse || nurse.deleted_at) throw new NotFoundException(`Nurse #${dto.nurse_id} not found`);
    if (!unit) throw new BadRequestException('Select an active nursing unit');
    if (!shift) throw new BadRequestException('Select an active shift');
    if (dto.post_id != null && !post) throw new BadRequestException('Select an active post');
    if (post && Number(post.nursing_unit_id) !== Number(unit.id)) {
      throw new BadRequestException('The selected post does not belong to the nursing unit');
    }
    if (!this.scopeAllowsRoster(scope, {
      nurse,
      nursing_unit: unit,
      post_id: dto.post_id,
      shift_id: dto.shift_id,
    }, actorId)) throw new ForbiddenException('The roster assignment is outside your assigned scope');
  }

  private async assertNurseScope(nurseId: number, actorId: number) {
    const nurse = await this.prisma.nursing_nurses.findUnique({
      where: { id: nurseId },
      include: { home_unit: { include: { department: true } } },
    });
    if (!nurse || nurse.deleted_at) throw new NotFoundException(`Nurse #${nurseId} not found`);
    const scope = await this.getScopeContext(actorId);
    if (scope.all || (scope.assigned && Number(nurse.user_id) === actorId)
      || (nurse.home_unit && this.scopeAllowsUnit(scope, nurse.home_unit))) return nurse;
    throw new ForbiddenException('This staff record is outside your assigned scope');
  }

  private async assertCredentialScope(id: number, actorId: number) {
    const credential = await this.ensureCredentialExists(id);
    await this.assertNurseScope(Number(credential.nurse_id), actorId);
    return credential;
  }

  private async assertRosterScope(id: number, actorId: number) {
    const row = await this.prisma.nursing_roster_assignments.findUnique({
      where: { id },
      include: {
        nurse: { select: { user_id: true } },
        nursing_unit: { include: { department: true } },
      },
    });
    if (!row || row.deleted_at) throw new NotFoundException(`Roster assignment #${id} not found`);
    const scope = await this.getScopeContext(actorId);
    if (!this.scopeAllowsRoster(scope, row, actorId)) {
      throw new ForbiddenException('This roster assignment is outside your assigned scope');
    }
    return row;
  }

  /** Map Prisma unique-violation (P2002) to a friendly 409, rethrow otherwise. */
  private throwIfUniqueViolation(error: any, messages: Record<string, string>): never | void {
    if (error?.code !== 'P2002') return;
    const target: string = Array.isArray(error?.meta?.target)
      ? error.meta.target.join(',')
      : String(error?.meta?.target || '');
    for (const key of Object.keys(messages)) {
      if (target.includes(key)) throw new ConflictException(messages[key]);
    }
    throw new ConflictException(`Duplicate value violates unique constraint (${target})`);
  }

  private startOfToday(): Date {
    const d = new Date();
    // PostgreSQL DATE values are represented at UTC midnight. Compare calendar
    // dates at that same boundary rather than rounding a timezone offset up.
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  }

  /**
   * Blocks roster create/update when the nurse has no Active employment contract
   * covering the assignment date (nursing.nurse_has_valid_contract).
   */
  private async assertNurseHasValidContract(
    nurseId: number,
    assignmentDate: Date | string,
  ): Promise<void> {
    const onDate = this.toDateOnly(assignmentDate);
    try {
      const rows = await this.prisma.$queryRawUnsafe<Array<{ ok: boolean }>>(
        `SELECT nursing.nurse_has_valid_contract($1::bigint, $2::date) AS ok`,
        nurseId,
        onDate,
      );
      if (!rows?.[0]?.ok) {
        throw new ConflictException(
          `Nurse #${nurseId} has no valid Active employment contract covering ${onDate}. Update Contract Master before rostering.`,
        );
      }
    } catch (e: any) {
      if (e instanceof ConflictException) throw e;
      this.logger.error(
        `Contract validity check FAILED (nurse #${nurseId}, ${onDate}): ${e?.message || e}`,
        e?.stack,
      );
      throw new InternalServerErrorException(
        'Unable to verify contract validity — roster change blocked',
      );
    }
  }

  private toDateOnly(d: Date | string): string {
    return new Date(d).toISOString().slice(0, 10);
  }

  private summarizeCredentials(creds: Array<{ status: string; expiry_date: any }>): {
    credentialSummary: 'Valid' | 'ExpiringSoon' | 'Expired' | 'None';
    credentialCounts: { total: number; expired: number; expiringSoon: number };
  } {
    const active = (creds || []).filter(
      (c) => !['Revoked', 'Suspended'].includes(c.status),
    );
    const now = this.startOfToday().getTime();
    const horizon = now + EXPIRING_SOON_DAYS * 86400000;

    let expired = 0;
    let expiringSoon = 0;
    for (const c of active) {
      if (c.status === 'Expired') {
        expired++;
        continue;
      }
      const exp = c.expiry_date ? new Date(c.expiry_date).getTime() : null;
      if (exp === null) continue;
      if (exp < now) expired++;
      else if (exp <= horizon) expiringSoon++;
    }

    const credentialSummary =
      active.length === 0
        ? ('None' as const)
        : expired > 0
          ? ('Expired' as const)
          : expiringSoon > 0
            ? ('ExpiringSoon' as const)
            : ('Valid' as const);

    return {
      credentialSummary,
      credentialCounts: { total: active.length, expired, expiringSoon },
    };
  }

  private mapNurseRow(r: any) {
    return {
      id: Number(r.id),
      employeeNumber: r.employee_number,
      jobNo: r.job_no ?? null,
      firstName: r.first_name,
      middleName: r.middle_name ?? null,
      lastName: r.last_name,
      // Full Name = First + Middle + Last (middle omitted when not set)
      fullName: [r.first_name, r.middle_name, r.last_name].filter(Boolean).join(' '),
      gender: r.gender ?? null,
      dateOfBirth: r.date_of_birth ? this.toDateOnly(r.date_of_birth) : null,
      nationality: r.nationality ?? null,
      // Email is sourced from the linked login account (auth.users.email)
      email: r.user?.email ?? null,
      phone: r.phone,
      hireDate: r.hire_date ? this.toDateOnly(r.hire_date) : null,
      employmentType: r.employment_type,
      status: r.status,
      userId: r.user_id ? Number(r.user_id) : null,
      username: r.user?.username ?? null,
      primaryRole: r.primary_role
        ? { id: Number(r.primary_role.id), code: r.primary_role.code, name: r.primary_role.name }
        : null,
      positionCode: r.position_code ?? null,
      department: r.home_unit?.department ? { id: Number(r.home_unit.department.id), name: r.home_unit.department.name } : null,
      homeUnit: r.home_unit
        ? { id: Number(r.home_unit.id), code: r.home_unit.code, name: r.home_unit.name, departmentId: Number(r.home_unit.department_id) }
        : null,
      ...this.summarizeCredentials(r.credentials || []),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  private mapCredentialRow(c: any) {
    const expiry = c.expiry_date ? new Date(c.expiry_date) : null;
    const now = this.startOfToday().getTime();
    return {
      id: Number(c.id),
      nurseId: Number(c.nurse_id),
      templateCode: c.template_code ?? null,
      trackingData: c.tracking_data ?? {},
      category: CREDENTIAL_TEMPLATES.find(t => t.code === c.template_code)?.category ?? null,
      credentialType: c.credential_type,
      name: c.name,
      issuingAuthority: c.issuing_authority,
      credentialNumber: c.credential_number,
      issuedDate: c.issued_date ? this.toDateOnly(c.issued_date) : null,
      expiryDate: expiry ? this.toDateOnly(expiry) : null,
      daysUntilExpiry: expiry ? Math.ceil((expiry.getTime() - now) / 86400000) : null,
      status: c.status,
      verifiedBy: c.verified_by ? Number(c.verified_by) : null,
      verifiedAt: c.verified_at,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
    };
  }

  private mapRosterRow(a: any) {
    return {
      id: Number(a.id),
      nurseId: Number(a.nurse_id),
      nurseName: a.nurse ? `${a.nurse.first_name} ${a.nurse.last_name}` : undefined,
      employeeNumber: a.nurse?.employee_number,
      unitId: Number(a.nursing_unit_id),
      unitCode: a.nursing_unit?.code,
      unitName: a.nursing_unit?.name,
      shiftId: Number(a.shift_id),
      shiftCode: a.shift?.code,
      shiftName: a.shift?.name,
      postId: a.post_id ? Number(a.post_id) : null,
      postCode: a.post?.code,
      postName: a.post?.name,
      assignmentDate: this.toDateOnly(a.assignment_date),
      status: a.status,
      notes: a.notes,
      createdAt: a.created_at,
      updatedAt: a.updated_at,
    };
  }
}
