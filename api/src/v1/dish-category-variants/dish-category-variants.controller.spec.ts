// api/src/v1/dish-category-variants/dish-category-variants.controller.spec.ts
//
// Basic test for dish category variants controller
//

import { Test, TestingModule } from '@nestjs/testing';
import { DishCategoryVariantsController } from './dish-category-variants.controller';
import { DishCategoryVariantsService } from './dish-category-variants.service';

describe('DishCategoryVariantsController', () => {
  let controller: DishCategoryVariantsController;
  let service: DishCategoryVariantsService;

  const mockDishCategoryVariantsService = {
    findDishCategoryVariants: jest.fn(),
    createDishCategoryVariant: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DishCategoryVariantsController],
      providers: [
        {
          provide: DishCategoryVariantsService,
          useValue: mockDishCategoryVariantsService,
        },
      ],
    }).compile();

    controller = module.get<DishCategoryVariantsController>(
      DishCategoryVariantsController,
    );
    service = module.get<DishCategoryVariantsService>(
      DishCategoryVariantsService,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('findDishCategoryVariants', () => {
    it('should call service.findDishCategoryVariants', async () => {
      const query = { q: 'ラーメン', lang: 'ja' };
      const expectedResult = [
        {
          dishCategoryId: 'test-id',
          label: 'ラーメン',
        },
      ];

      mockDishCategoryVariantsService.findDishCategoryVariants.mockResolvedValue(
        expectedResult,
      );

      const result = await controller.findDishCategoryVariants(query);

      expect(service.findDishCategoryVariants).toHaveBeenCalledWith(query);
      expect(result).toEqual(expectedResult);
    });
  });

  describe('createDishCategoryVariant', () => {
    it('should call service.createDishCategoryVariant', async () => {
      const dto = { name: 'ラーメン' };
      const expectedResult = [
        {
          id: 'test-id',
          label_en: 'Ramen',
          labels: {},
          image_url: 'test-url',
          origin: [],
          cuisine: [],
          tags: [],
          created_at: new Date(),
          updated_at: new Date(),
          lock_no: 0,
        },
      ];

      mockDishCategoryVariantsService.createDishCategoryVariant.mockResolvedValue(
        expectedResult,
      );

      const result = await controller.createDishCategoryVariant(dto);

      expect(service.createDishCategoryVariant).toHaveBeenCalledWith(dto);
      expect(result).toEqual(expectedResult);
    });
  });
});
