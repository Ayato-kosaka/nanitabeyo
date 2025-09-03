// api/src/v1/dish-category-variants/dish-category-variants.service.spec.ts
//
// Test for dish category variants service error handling
//

import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { DishCategoryVariantsService } from './dish-category-variants.service';
import { DishCategoryVariantsRepository } from './dish-category-variants.repository';
import { ExternalApiService } from '../../core/external-api/external-api.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../../core/logger/logger.service';

describe('DishCategoryVariantsService Error Handling', () => {
  let service: DishCategoryVariantsService;
  let mockRepo: jest.Mocked<DishCategoryVariantsRepository>;
  let mockExternalApiService: jest.Mocked<ExternalApiService>;
  let mockPrismaService: jest.Mocked<PrismaService>;
  let mockLogger: jest.Mocked<AppLoggerService>;

  beforeEach(async () => {
    const mockRepository = {
      findDishCategoryVariantBySurfaceForm: jest.fn(),
      findDishCategoryByQid: jest.fn(),
      createDishCategoryVariant: jest.fn(),
    };

    const mockExternalApi = {
      searchWikidata: jest.fn(),
      getCorrectedSpelling: jest.fn(),
    };

    const mockPrisma = {
      withTransaction: jest.fn(),
    };

    const mockLoggerService = {
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DishCategoryVariantsService,
        {
          provide: DishCategoryVariantsRepository,
          useValue: mockRepository,
        },
        {
          provide: ExternalApiService,
          useValue: mockExternalApi,
        },
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
        {
          provide: AppLoggerService,
          useValue: mockLoggerService,
        },
      ],
    }).compile();

    service = module.get<DishCategoryVariantsService>(DishCategoryVariantsService);
    mockRepo = module.get(DishCategoryVariantsRepository);
    mockExternalApiService = module.get(ExternalApiService);
    mockPrismaService = module.get(PrismaService);
    mockLogger = module.get(AppLoggerService);
  });

  describe('createDishCategoryVariant', () => {
    const dto = { name: 'test-category' };

    it('should throw NotFoundException when no matching category found', async () => {
      // Mock all search methods to return null/undefined
      mockRepo.findDishCategoryVariantBySurfaceForm.mockResolvedValue(null);
      mockExternalApiService.searchWikidata.mockResolvedValue(null);
      mockExternalApiService.getCorrectedSpelling.mockResolvedValue(null);

      await expect(service.createDishCategoryVariant(dto)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.createDishCategoryVariant(dto)).rejects.toThrow(
        'No matching dish category found',
      );

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'NoMatchFound',
        'createDishCategoryVariant',
        { name: dto.name },
      );
    });

    it('should throw NotFoundException when Wikidata QID has no corresponding dish category', async () => {
      // Mock direct search to fail
      mockRepo.findDishCategoryVariantBySurfaceForm.mockResolvedValue(null);
      
      // Mock Wikidata to return a result
      mockExternalApiService.searchWikidata.mockResolvedValue({
        qid: 'Q123456',
        label: 'test-label',
      });
      
      // Mock QID lookup to fail
      mockRepo.findDishCategoryByQid.mockResolvedValue(null);

      await expect(service.createDishCategoryVariant(dto)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.createDishCategoryVariant(dto)).rejects.toThrow(
        'No dish category found for Wikidata QID: Q123456',
      );
    });

    it('should succeed when direct match is found', async () => {
      const mockCategory = {
        id: 'test-id',
        label_en: 'Test Category',
        labels: {},
        image_url: 'test-url',
        origin: [],
        cuisine: [],
        tags: [],
        created_at: new Date(),
        updated_at: new Date(),
        lock_no: 0,
      };

      const mockVariant = {
        id: 'variant-id',
        created_at: new Date(),
        dish_category_id: 'test-id',
        surface_form: 'test-category',
        source: 'manual',
        dish_categories: mockCategory,
      };

      mockRepo.findDishCategoryVariantBySurfaceForm.mockResolvedValue(mockVariant);

      const result = await service.createDishCategoryVariant(dto);

      expect(result).toBe(mockCategory);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'DirectMatchFound',
        'createDishCategoryVariant',
        {},
      );
    });
  });
});