// api/src/v1/dish-category-variants/dish-category-variants.controller.spec.ts
//
// Basic test for dish category variants controller
//

import { Test, TestingModule } from '@nestjs/testing';
import { DishCategoryVariantsController } from './dish-category-variants.controller';
import { DishCategoryVariantsService } from './dish-category-variants.service';
// #1596 コントローラに付いている AuthAnonGuard が ClsService と AppLoggerService を要求する。
// 後者を provider に入れていなかったため、この suite は組み立てに失敗して全件落ちていた
// （env 起因の失敗に隠れて誰も見ていなかった）。
import { AppLoggerService } from '../../core/logger/logger.service';

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
          provide: AppLoggerService,
          useValue: {
            debug: jest.fn(),
            log: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            externalApi: jest.fn(),
          },
        },
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

      // #1596 service は **単一の** PrismaDishCategories を返し、controller は
      // それを convertPrismaToSupabase_DishCategories で Supabase 形へ変換して返す。
      // 旧 spec は「配列を返してそのまま素通しされる」前提で書かれており、
      // 実装とまるごとズレていた（env 起因の suite 落ちに隠れて誰も見ていなかった）。
      const createdAt = new Date('2026-08-01T00:00:00.000Z');
      const serviceResult = {
        id: 'test-id',
        label_en: 'Ramen',
        labels: {},
        image_url: 'test-url',
        origin: [],
        cuisine: [],
        tags: [],
        created_at: createdAt,
        updated_at: createdAt,
        lock_no: 0,
      };

      mockDishCategoryVariantsService.createDishCategoryVariant.mockResolvedValue(
        serviceResult,
      );

      const result = await controller.createDishCategoryVariant(dto);

      expect(service.createDishCategoryVariant).toHaveBeenCalledWith(dto);
      // 変換後も «どの料理カテゴリを作ったか» が失われないことを固定する。
      // ここが undefined へ落ちると、クライアントは作成結果を特定できない。
      expect(result.id).toBe('test-id');
      expect(result.label_en).toBe('Ramen');
      expect(result.image_url).toBe('test-url');
    });
  });
});
