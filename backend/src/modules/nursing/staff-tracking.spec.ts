import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { validate } from 'class-validator';
import { CREDENTIAL_TEMPLATES, STAFF_POSITIONS } from './staff-catalog';
import { NursingService } from './nursing.service';
import { CreateNurseDto, UpdateCredentialDto } from './dto/nursing.dto';

describe('Staff credential tracking', () => {
  let service: NursingService;
  let stored: any;
  let prisma: any;
  const passport = { nurse_id: 1, template_code: 'PASSPORT', name: 'Passport', credential_type: 'Identity',
    credential_number: 'TEST-ONLY', issued_date: '2025-01-01', expiry_date: '2030-01-01', tracking_data: { issuingCountry: 'Philippines' } };
  beforeEach(() => {
    stored = null;
    prisma = {
      nursing_nurses: { findUnique: jest.fn(async () => ({ id: 1, deleted_at: null })) },
      nursing_credentials: {
        create: jest.fn(async ({ data }) => { stored = { id: 10, status: 'PendingVerification', ...data }; return stored; }),
        findUnique: jest.fn(async () => stored),
        update: jest.fn(async ({ data }) => { stored = { ...stored, ...data }; return stored; }),
      },
      rbac_nursing_units: { findFirst: jest.fn(async ({ where }) => where.id === 3 ? { id: 3 } : null) },
      rbac_user_data_scopes: { findMany: jest.fn(async () => [{ scope_type: 'All' }]) },
      $queryRawUnsafe: jest.fn(async () => []),
    };
    service = new NursingService(prisma, { log: jest.fn() } as any);
  });
  it('covers all supplied positions and 16 credential templates', () => {
    expect(STAFF_POSITIONS.map(p => p.code)).toEqual(['HN', 'AHN', 'CI', 'SN', 'PCT', 'TEC', 'CN', 'HCA', 'MW']);
    expect(CREDENTIAL_TEMPLATES).toHaveLength(16);
    expect(new Set(CREDENTIAL_TEMPLATES.map(t => t.code)).size).toBe(16);
  });
  it('round trips identity fields and preserves them on partial update', async () => {
    const { credential } = await service.createCredential(passport, 1);
    expect(credential.category).toBe('Identity & Legal');
    expect(credential.trackingData).toEqual(passport.tracking_data);
    await service.verifyCredential(10, { status: 'Valid' }, 2);
    const updated = await service.updateCredential(10, { credential_number: 'UPDATED' }, 1);
    expect(updated.credential.trackingData).toEqual(passport.tracking_data);
    expect(updated.credential.status).toBe('PendingVerification');
    expect(updated.credential.verifiedBy).toBeNull();
    expect(updated.credential.verifiedAt).toBeNull();
  });
  it('allows clearing dates and optional tracking fields', async () => {
    await service.createCredential(passport, 1);
    const { credential } = await service.updateCredential(10, { expiry_date: null, tracking_data: {} }, 1);
    expect(credential.expiryDate).toBeNull();
    expect(credential.trackingData).toEqual({});
  });
  it.each([
    { name: 'BLS' }, { credential_type: 'License' }, { template_code: 'UNKNOWN' },
    { expiry_date: '2024-01-01' }, { expiry_date: '2026-02-30' },
    { tracking_data: { admin: true } }, { tracking_data: { issuingCountry: { nested: true } } },
  ])('rejects invalid template/date/field payload %j', async changes => {
    await expect(service.createCredential({ ...passport, ...changes } as any, 1)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.nursing_credentials.create).not.toHaveBeenCalled();
  });
  it('validates competency unit and outcome and stores reassessment for expiry alerts', async () => {
    const dto = { nurse_id: 1, template_code: 'UNIT_COMPETENCY', name: 'Unit Specific Competency', credential_type: 'Competency',
      issued_date: '2026-01-01', expiry_date: '2027-01-01', tracking_data: { assignedUnitId: 3, assessmentStatus: 'Pass', evaluatorName: 'Test Evaluator' } };
    expect((await service.createCredential(dto, 1)).credential.expiryDate).toBe('2027-01-01');
    await expect(service.createCredential({ ...dto, tracking_data: { assignedUnitId: 999 } }, 1)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.createCredential({ ...dto, tracking_data: { assessmentStatus: 'Anything' } }, 1)).rejects.toBeInstanceOf(BadRequestException);
  });
  it('rejects invalid Hijri dates and fractional supervised case counts', async () => {
    await expect(service.createCredential({ ...passport, template_code: 'IQAMA', name: 'Resident ID (Iqama)', tracking_data: { expiryDateHijri: '1448-13-31' } }, 1)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.createCredential({ ...passport, template_code: 'CONSCIOUS_SEDATION', name: 'Conscious Sedation', credential_type: 'Certification', tracking_data: { supervisedCasesCount: 1.5 } }, 1)).rejects.toBeInstanceOf(BadRequestException);
  });
  it('prevents changing templates when editing', async () => {
    await service.createCredential(passport, 1);
    await expect(service.updateCredential(10, { template_code: 'BLS' }, 1)).rejects.toBeInstanceOf(BadRequestException);
  });
  it('rejects verification of an expired credential as Valid', async () => {
    await service.createCredential({ ...passport, issued_date: '2020-01-01', expiry_date: '2025-01-01' }, 1);
    await expect(service.verifyCredential(10, { status: 'Valid' }, 1)).rejects.toBeInstanceOf(BadRequestException);
    expect(stored.status).toBe('PendingVerification');
  });
  it('denies credential access outside the caller data scope', async () => {
    await service.createCredential(passport, 1);
    prisma.rbac_user_data_scopes.findMany.mockResolvedValue([]);
    await expect(service.getCredentialDocument(10, 99)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });
  it('validates position and disallows verification status through the edit DTO', async () => {
    const nurse = Object.assign(new CreateNurseDto(), { job_no: 'T1', first_name: 'Test', last_name: 'Only', position_code: 'ADMIN' });
    expect((await validate(nurse)).some(e => e.property === 'position_code')).toBe(true);
    const credential = Object.assign(new UpdateCredentialDto(), { status: 'Valid' });
    expect((await validate(credential, { whitelist: true, forbidNonWhitelisted: true })).some(e => e.property === 'status')).toBe(true);
  });
  it('uploads files using parameters and resets verification atomically', async () => {
    await service.createCredential(passport, 1);
    const buffer = Buffer.from('%PDF-1.4\nTEST ONLY');
    const result = await service.uploadCredentialDocument(10, { originalname: '../test.pdf', mimetype: 'application/pdf', buffer }, 2);
    expect(result.fileName).toBe('.._test.pdf');
    const [sql, id, name, type, content, actor] = prisma.$queryRawUnsafe.mock.calls[0];
    expect(sql).toContain("status = 'PendingVerification'");
    expect([id, name, type, actor]).toEqual([10, '.._test.pdf', 'application/pdf', 2]);
    expect(content).toEqual(buffer);
  });
  it('rejects oversized files and files disguised as PDF', async () => {
    await service.createCredential(passport, 1);
    for (const buffer of [Buffer.from('<script>bad</script>'), Buffer.alloc(5 * 1024 * 1024 + 1)]) {
      await expect(service.uploadCredentialDocument(10, { originalname: 'fake.pdf', mimetype: 'application/pdf', buffer }, 1)).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });
});
