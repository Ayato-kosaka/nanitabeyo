// api/src/v1/restaurants/restaurants.service.spec.ts
//
// #1780 新規店舗作成で Google 写真を自社 Storage へ保存するのをやめた回帰テスト。
//
// restaurants 行が作られる «導線» は 3 つある。この spec が押さえるのは 1 と 2:
//
//   導線1 地図の POI をタップ        select-restaurant.tsx handlePoiPress
//   導線2 店名オートコンプリート選択  select-restaurant.tsx handleAutocompleteSelect
//         → どちらも createAndOpenRestaurant → POST /v1/restaurants
//         → RestaurantsService.createRestaurant（このファイルの対象）
//   導線3 Google 一括取り込み        POST /v1/dishes/bulk-import
//         → DishesService.bulkImportFromGoogle（#1780 の範囲外。写真保存が残っている）
//
// 押さえていること:
// - fieldMask に photos を含めない
// - storageService.uploadFile / locationsService.tryGetPhotoMedia を呼ばない
// - 写真が無くても restaurant が作成される（従来は必須フィールド扱いで作成を中断していた）
// - Google の写真 URL（image_url）も保持しない
// - 1 件の作成で叩く Place Details の «回数と fieldMask» を固定する（課金 SKU の根拠）

// core/config/env は import 時に process.env をバリデーションして throw するため、
// 実DB・実APIに触れない単体テストでも .env が無いと suite ごと落ちる。
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
import { RestaurantsService } from './restaurants.service';
import { RestaurantsRepository } from './restaurants.repository';
import { RestaurantsAssembler } from './restaurants.assembler';
import { ExternalApiService } from '../../core/external-api/external-api.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../../core/logger/logger.service';
import { DishesRepository } from '../dishes/dishes.repository';
import { DishMediaService } from '../dish-media/dish-media.service';
import { DishMediaRepository } from '../dish-media/dish-media.repository';
import { LocationsService } from '../locations/locations.service';
import { StorageService } from '../../core/storage/storage.service';
import type { CreateRestaurantDto } from '@shared/v1/dto';

/** withTransaction のパススルー用ダミー tx */
const TX = { __tx: true } as never;
const PLACE_ID = 'ChIJplace1';

/** Place Details が返す最小限の place（意図的に photos を持たない） */
const buildPlaceDetail = (overrides: Record<string, unknown> = {}) => ({
  id: PLACE_ID,
  displayName: { text: 'テスト店舗' },
  location: { latitude: 35.6, longitude: 139.7 },
  addressComponents: [{ longText: '東京都', shortText: 'Tokyo', types: [] }],
  types: ['restaurant', 'food'],
  plusCode: null,
  ...overrides,
});

const dto = { googlePlaceId: PLACE_ID } as CreateRestaurantDto;

describe('RestaurantsService.createRestaurant', () => {
  let service: RestaurantsService;
  let externalApi: { callPlaceDetails: jest.Mock };
  let repo: {
    findRestaurantByGooglePlaceId: jest.Mock;
    getRestaurantReviewStats: jest.Mock;
    getRestaurantBidStats: jest.Mock;
  };
  let dishesRepository: { createOrGetRestaurant: jest.Mock };
  let locationsService: {
    resolveLocalLanguageCode: jest.Mock;
    tryGetPhotoMedia: jest.Mock;
  };
  let storage: { uploadFile: jest.Mock };

  beforeEach(async () => {
    externalApi = { callPlaceDetails: jest.fn() };
    repo = {
      findRestaurantByGooglePlaceId: jest.fn().mockResolvedValue(null),
      getRestaurantReviewStats: jest
        .fn()
        .mockResolvedValue({ reviewCount: 0, averageRating: 0 }),
      getRestaurantBidStats: jest
        .fn()
        .mockResolvedValue({ totalCents: 0, maxEndDate: null }),
    };
    dishesRepository = {
      createOrGetRestaurant: jest.fn().mockResolvedValue({
        id: 'restaurant-uuid',
        google_place_id: PLACE_ID,
        name: 'テスト店舗',
        image_path: null,
      }),
    };
    locationsService = {
      resolveLocalLanguageCode: jest.fn().mockReturnValue('ja'),
      tryGetPhotoMedia: jest.fn(),
    };
    storage = { uploadFile: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RestaurantsService,
        { provide: RestaurantsRepository, useValue: repo },
        {
          provide: RestaurantsAssembler,
          useValue: {
            enrichRestaurantsWithImageUrls: jest.fn((r) => r),
          },
        },
        { provide: ExternalApiService, useValue: externalApi },
        {
          provide: PrismaService,
          useValue: { withTransaction: jest.fn((exec) => exec(TX)) },
        },
        {
          provide: AppLoggerService,
          useValue: {
            debug: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            log: jest.fn(),
          },
        },
        { provide: DishesRepository, useValue: dishesRepository },
        { provide: DishMediaService, useValue: {} },
        {
          provide: DishMediaRepository,
          useValue: {
            // #1780 image_path を持たない店は dish_media サムネイルを顔にする。
            // 既定は «代替も無い» 店（この spec の関心は fieldMask と写真の非保存）
            findFallbackThumbnailsByRestaurantIds: jest
              .fn()
              .mockResolvedValue(new Map()),
          },
        },
        { provide: LocationsService, useValue: locationsService },
        // #1780 RestaurantsService はもう StorageService に依存しないが、回帰した場合に
        // Nest の DI がこの mock を自動で拾えるよう token だけは登録しておく
        { provide: StorageService, useValue: storage },
      ],
    }).compile();

    service = module.get<RestaurantsService>(RestaurantsService);
  });

  it('fieldMask に photos を含めない', async () => {
    externalApi.callPlaceDetails
      .mockResolvedValueOnce(buildPlaceDetail()) // resolveRestaurantLanguage 用
      .mockResolvedValueOnce(buildPlaceDetail()); // fetchAndValidatePlaceDetail 用

    await service.createRestaurant(dto);

    const fieldMask = externalApi.callPlaceDetails.mock.calls[1][0] as string;
    expect(fieldMask.split(',')).not.toContain('photos');
  });

  it('storageService.uploadFile / tryGetPhotoMedia を呼ばない', async () => {
    externalApi.callPlaceDetails
      .mockResolvedValueOnce(buildPlaceDetail())
      .mockResolvedValueOnce(buildPlaceDetail());

    await service.createRestaurant(dto);

    expect(storage.uploadFile).not.toHaveBeenCalled();
    expect(locationsService.tryGetPhotoMedia).not.toHaveBeenCalled();
  });

  it('写真が無くても restaurant が作成される（image_path は null）', async () => {
    externalApi.callPlaceDetails
      .mockResolvedValueOnce(buildPlaceDetail())
      .mockResolvedValueOnce(buildPlaceDetail()); // photos フィールド自体が存在しない

    await expect(service.createRestaurant(dto)).resolves.toMatchObject({
      restaurant: expect.objectContaining({ id: 'restaurant-uuid' }),
    });

    expect(dishesRepository.createOrGetRestaurant).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({ image_path: null }),
      PLACE_ID,
    );
  });

  it('導線1/2: 1 件の作成で Place Details を 2 回叩く（fieldMask を固定する）', async () => {
    // #843 課金の根拠。呼び出し «回数» と «要求フィールド» が SKU 階層を決めるので、
    // ここが黙って増えたら気づけるように固定する。
    externalApi.callPlaceDetails
      .mockResolvedValueOnce(buildPlaceDetail())
      .mockResolvedValueOnce(buildPlaceDetail());

    await service.createRestaurant(dto);

    expect(externalApi.callPlaceDetails).toHaveBeenCalledTimes(2);
    // 1 回目: 店名の言語判定と «飲食店か» の判定（resolveRestaurantLanguage）
    expect(externalApi.callPlaceDetails.mock.calls[0][0]).toBe(
      'addressComponents,types',
    );
    // 2 回目: 保存する値の取得（fetchAndValidatePlaceDetail）
    expect(externalApi.callPlaceDetails.mock.calls[1][0]).toBe(
      'id,displayName,location,addressComponents,plusCode',
    );
  });

  it('導線1/2: Google の写真 URL（image_url）も保持しない', async () => {
    externalApi.callPlaceDetails
      .mockResolvedValueOnce(buildPlaceDetail())
      .mockResolvedValueOnce(buildPlaceDetail());

    await service.createRestaurant(dto);

    expect(dishesRepository.createOrGetRestaurant).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({ image_url: '', image_path: null }),
      PLACE_ID,
    );
  });
});
