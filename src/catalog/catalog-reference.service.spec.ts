import { Test } from '@nestjs/testing';
import { CatalogReferenceService } from './catalog-reference.service';
import { PrismaService } from '../prisma/prisma.service';

function buildPrismaMock() {
  return {
    category: { findMany: jest.fn() },
    color: { findMany: jest.fn() },
    size: { findMany: jest.fn() },
  };
}

describe('CatalogReferenceService', () => {
  let service: CatalogReferenceService;
  let prisma: ReturnType<typeof buildPrismaMock>;

  beforeEach(async () => {
    prisma = buildPrismaMock();
    const module = await Test.createTestingModule({
      providers: [
        CatalogReferenceService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(CatalogReferenceService);
  });

  it('lists categories', async () => {
    prisma.category.findMany.mockResolvedValue([
      { id: 'c1', name: 'Basics', slug: 'basics' },
    ]);
    const result = await service.listCategories();
    expect(result).toEqual([{ id: 'c1', name: 'Basics', slug: 'basics' }]);
  });

  it('lists colors', async () => {
    prisma.color.findMany.mockResolvedValue([
      { id: 'co1', name: 'Black', hexCode: '#000000' },
    ]);
    const result = await service.listColors();
    expect(result).toEqual([{ id: 'co1', name: 'Black', hexCode: '#000000' }]);
  });

  it('lists sizes ordered by position', async () => {
    prisma.size.findMany.mockResolvedValue([
      { id: 's1', name: 'S', position: 10 },
    ]);
    const result = await service.listSizes();
    expect(prisma.size.findMany).toHaveBeenCalledWith({
      orderBy: { position: 'asc' },
    });
    expect(result).toEqual([{ id: 's1', name: 'S', position: 10 }]);
  });
});
