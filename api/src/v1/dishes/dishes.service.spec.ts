// api/src/v1/dishes/dishes.service.spec.ts
//
// ❶ bulkImportFromGoogle の「該当店舗なし」経路を固定する
// ❷ searchRestaurants は3段フォールバックを尽くしたうえで空レスポンスを返す契約なので、
//    ここを throw にすると該当なしの検索がすべて 500 INTERNAL_ERROR になる
//

// core/config/env は import 時に process.env をバリデーションして throw するため、
// 実DB・実APIに触れない単体テストでも .env が無いと suite ごと落ちる。
// dishes.service.ts は repository / logger 経由でこれを推移的に読み込むので、
// DI で差し替えるより手前、モジュール解決の段階で無害化する。
jest.mock('../../core/config/env', () => ({
  env: new Proxy(
    {},
    {
      get: (_target, key: string) =>
        key === 'DB_POOL_MAX' ? 1 : `test-${key}`,
    },
  ),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { DishesService } from './dishes.service';
import { DishesRepository } from './dishes.repository';
import { AppLoggerService } from '../../core/logger/logger.service';
import { LocationsService } from '../locations/locations.service';
import { RemoteConfigService } from '../../core/remote-config/remote-config.service';
import { CloudTasksService } from '../../core/cloud-tasks/cloud-tasks.service';
import { DishCategoriesRepository } from '../dish-categories/dish-categories.repository';
import { RestaurantsRepository } from '../restaurants/restaurants.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { DishMediaService } from '../dish-media/dish-media.service';
import type { BulkImportDishesDto } from '@shared/v1/dto';

describe('DishesService', () => {
  let service: DishesService;
  let mockLocationsService: { searchRestaurants: jest.Mock };
  let mockCloudTasksService: { createTask: jest.Mock };

  const VIEWER_ID = 'viewer-uuid';

  const dto = {
    location: '35.68944,139.69167',
    radius: 500,
    categoryId: 'category-uuid',
    categoryName: 'ラーメン',
    minRating: 3.0,
    languageCode: 'ja',
  } as BulkImportDishesDto;

  beforeEach(async () => {
    mockLocationsService = { searchRestaurants: jest.fn() };
    mockCloudTasksService = { createTask: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DishesService,
        { provide: DishesRepository, useValue: {} },
        {
          provide: AppLoggerService,
          useValue: {
            debug: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            log: jest.fn(),
          },
        },
        { provide: LocationsService, useValue: mockLocationsService },
        {
          provide: RemoteConfigService,
          useValue: {
            getRemoteConfigValue: jest.fn().mockResolvedValue('5'),
          },
        },
        { provide: CloudTasksService, useValue: mockCloudTasksService },
        { provide: DishCategoriesRepository, useValue: {} },
        { provide: RestaurantsRepository, useValue: {} },
        { provide: PrismaService, useValue: {} },
        {
          provide: DishMediaService,
          useValue: {
            fetchDishMediaEntryItems: jest
              .fn()
              .mockResolvedValue({ items: [] }),
          },
        },
      ],
    }).compile();

    service = module.get<DishesService>(DishesService);
  });

  describe('bulkImportFromGoogle: 該当店舗なし', () => {
    // searchRestaurants は全フォールバックが0件だったとき {} を返す
    // (api/src/v1/locations/locations.service.ts の GoogleMapsTextSearchAllFallbacksFailed 経路)
    it.each([
      ['placesを持たない空レスポンス', {}],
      ['placesが空配列', { places: [] }],
    ])('%s のとき 500 ではなく空配列を返す', async (_label, response) => {
      mockLocationsService.searchRestaurants.mockResolvedValue(response);

      await expect(
        service.bulkImportFromGoogle(dto, VIEWER_ID),
      ).resolves.toEqual([]);
    });

    it('該当なしのとき Cloud Task を enqueue しない', async () => {
      mockLocationsService.searchRestaurants.mockResolvedValue({});

      await service.bulkImportFromGoogle(dto, VIEWER_ID);

      expect(mockCloudTasksService.createTask).not.toHaveBeenCalled();
    });
  });
});
