// api/src/v1/dish-categories/dish-categories.controller.spec.ts
//
// Basic test for dish categories controller
//

import { Test, TestingModule } from '@nestjs/testing';
import { DishCategoriesController } from './dish-categories.controller';
import { DishCategoriesService } from './dish-categories.service';

describe('DishCategoriesController', () => {
  let controller: DishCategoriesController;
  let service: DishCategoriesService;

  const mockDishCategoriesService = {
    getRecommendations: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DishCategoriesController],
      providers: [
        {
          provide: DishCategoriesService,
          useValue: mockDishCategoriesService,
        },
      ],
    }).compile();

    controller = module.get<DishCategoriesController>(DishCategoriesController);
    service = module.get<DishCategoriesService>(DishCategoriesService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getRecommendations', () => {
    it('should call service.getRecommendations', async () => {
      const query = { location: '35.6762,139.6503', timeSlot: 'lunch' };
      const expectedResult = [
        {
          category: 'ラーメン',
          topicTitle: 'ランチタイムにぴったりのラーメン',
          reason: '昼食時間にさっと食べられて満足感が高い',
          categoryId: 'test-id',
          imageUrl: 'test-url',
        },
      ];

      mockDishCategoriesService.getRecommendations.mockResolvedValue(expectedResult);

      const result = await controller.getRecommendations(query);

      expect(service.getRecommendations).toHaveBeenCalledWith(query);
      expect(result).toEqual(expectedResult);
    });
  });
});