import { ContractsService } from './contracts.service';

describe('ContractsService position hierarchy', () => {
  it('builds a nested hierarchy while preserving position metadata', async () => {
    const prisma = {
      $queryRawUnsafe: jest.fn(async () => [
        { id: 1, code: 'CN', name: 'Charge Nurse', category: 'Nursing', status: 'Active', parent_code: 'HN', hierarchy_level: 1 },
        { id: 2, code: 'HN', name: 'Head Nurse', category: 'Nursing', status: 'Active', parent_code: null, hierarchy_level: 0 },
        { id: 3, code: 'SN', name: 'Staff Nurse', category: 'Nursing', status: 'Active', parent_code: 'CN', hierarchy_level: 2 },
      ]),
    };
    const service = new ContractsService(prisma as any, {} as any);

    await expect(service.listPositionHierarchy()).resolves.toEqual([
      {
        id: 2,
        code: 'HN',
        name: 'Head Nurse',
        category: 'Nursing',
        status: 'Active',
        parentCode: null,
        hierarchyLevel: 0,
        children: [
          {
            id: 1,
            code: 'CN',
            name: 'Charge Nurse',
            category: 'Nursing',
            status: 'Active',
            parentCode: 'HN',
            hierarchyLevel: 1,
            children: [
              {
                id: 3,
                code: 'SN',
                name: 'Staff Nurse',
                category: 'Nursing',
                status: 'Active',
                parentCode: 'CN',
                hierarchyLevel: 2,
                children: [],
              },
            ],
          },
        ],
      },
    ]);
  });
});
