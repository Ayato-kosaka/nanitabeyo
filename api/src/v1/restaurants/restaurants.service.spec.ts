// api/src/v1/restaurants/restaurants.service.spec.ts
//
// #1671 POI確認UI: ユーザーが確認した店名を、Google の表示名の代わりに保存する。
//
// ここで守りたいのは 2 つだけである。
//   ❶ 新規作成時、`dto.name`（ユーザーが確認した値）が送られていればそれを保存する
//   ❷ `dto.name` が無ければ、従来どおり Google の表示名を保存する（後方互換）
//   ❸ 既存レストランの場合は作成処理そのものに入らない（`dto.name` は無視される）

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
import { CloudTasksService } from '../../core/cloud-tasks/cloud-tasks.service';
import { StorageService } from '../../core/storage/storage.service';
import type { CreateRestaurantDto } from '@shared/v1/dto';

/** withTransaction のパススルー用ダミー tx */
const TX = { __tx: true } as never;

const GOOGLE_PLACE_ID = 'place-1671';

/** 言語コード解決用の 1 本目の callPlaceDetails 応答（addressComponents/types だけ見る） */
const PLACE_FOR_LANG = {
  addressComponents: [
    { types: ['country'], shortText: 'JP', longText: 'Japan' },
  ],
  types: ['restaurant'],
};

/** 作成用の 2 本目の callPlaceDetails 応答（displayName が «Google の表示名»） */
const PLACE_DETAIL = {
  id: GOOGLE_PLACE_ID,
  displayName: { text: 'Google の表示名' },
  location: { latitude: 35.0, longitude: 139.0 },
  addressComponents: PLACE_FOR_LANG.addressComponents,
  photos: [],
};

const EXISTING_RESTAURANT = {
  id: 'restaurant-existing',
  google_place_id: GOOGLE_PLACE_ID,
  name: '既存の店名',
} as never;

const CREATED_ROW = {
  id: 'restaurant-created',
  google_place_id: GOOGLE_PLACE_ID,
} as never;

describe('RestaurantsService #1671 店名の確認UI', () => {
  let service: RestaurantsService;
  let repo: jest.Mocked<
    Pick<
      RestaurantsRepository,
      | 'findRestaurantByGooglePlaceId'
      | 'getRestaurantReviewStats'
      | 'getRestaurantBidStats'
    >
  >;
  let assembler: jest.Mocked<
    Pick<RestaurantsAssembler, 'enrichRestaurantsWithImageUrls'>
  >;
  let externalApi: jest.Mocked<Pick<ExternalApiService, 'callPlaceDetails'>>;
  let dishesRepository: jest.Mocked<
    Pick<DishesRepository, 'createOrGetRestaurant'>
  >;
  let locationsService: jest.Mocked<
    Pick<LocationsService, 'resolveLocalLanguageCode' | 'tryGetPhotoMedia'>
  >;

  beforeEach(() => {
    repo = {
      findRestaurantByGooglePlaceId: jest.fn(),
      getRestaurantReviewStats: jest
        .fn()
        .mockResolvedValue({ reviewCount: 0, averageRating: 0 }),
      getRestaurantBidStats: jest
        .fn()
        .mockResolvedValue({ totalCents: 0, maxEndDate: null }),
    } as never;

    assembler = {
      enrichRestaurantsWithImageUrls: jest.fn((r) => r as never),
    } as never;

    externalApi = {
      callPlaceDetails: jest
        .fn()
        .mockResolvedValueOnce(PLACE_FOR_LANG)
        .mockResolvedValueOnce(PLACE_DETAIL),
    } as never;

    dishesRepository = {
      createOrGetRestaurant: jest.fn().mockResolvedValue(CREATED_ROW),
    } as never;

    locationsService = {
      resolveLocalLanguageCode: jest.fn().mockReturnValue('ja'),
      // #1671 の範囲外（写真の保存経路）。null を返して常にスキップする
      tryGetPhotoMedia: jest.fn().mockResolvedValue(null),
    } as never;

    const prisma = {
      withTransaction: jest.fn((fn: (tx: never) => unknown) => fn(TX)),
    } as unknown as PrismaService;

    const logger = {
      debug: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      verbose: jest.fn(),
    } as unknown as AppLoggerService;

    const cloudTasksService = {
      enqueueResizeImage: jest.fn(),
    } as unknown as CloudTasksService;

    service = new RestaurantsService(
      repo as unknown as RestaurantsRepository,
      assembler as unknown as RestaurantsAssembler,
      externalApi as unknown as ExternalApiService,
      prisma,
      logger,
      dishesRepository as unknown as DishesRepository,
      {} as DishMediaService,
      {} as DishMediaRepository,
      locationsService as unknown as LocationsService,
      cloudTasksService,
      {} as StorageService,
    );
  });

  const dto = (overrides: Partial<CreateRestaurantDto> = {}): CreateRestaurantDto =>
    ({ googlePlaceId: GOOGLE_PLACE_ID, ...overrides }) as CreateRestaurantDto;

  it('新規作成: dto.name（ユーザーが確認した店名）が送られていればそれを保存する', async () => {
    repo.findRestaurantByGooglePlaceId.mockResolvedValue(null);

    await service.createRestaurant(dto({ name: 'ユーザーが確認した店名' }));

    expect(dishesRepository.createOrGetRestaurant).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({ name: 'ユーザーが確認した店名' }),
      GOOGLE_PLACE_ID,
    );
  });

  /*
  ⚠️ このテストは «ガードを 1 つ外すと赤くなる» 回帰である。
  `createRestaurant` から `createRestaurantRecord` へ `name: dto.name` を渡さなくすると
  （= 確認した店名を送っても無視される状態に戻すと）、保存される名前が Google の表示名に
  なり、このテストが落ちる。
  */
  it('新規作成: dto.name が無ければ、従来どおり Google の表示名を保存する（後方互換）', async () => {
    repo.findRestaurantByGooglePlaceId.mockResolvedValue(null);

    await service.createRestaurant(dto());

    expect(dishesRepository.createOrGetRestaurant).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({ name: 'Google の表示名' }),
      GOOGLE_PLACE_ID,
    );
  });

  it('既存レストラン: dto.name を送っても無視され、作成処理は一切走らない', async () => {
    repo.findRestaurantByGooglePlaceId.mockResolvedValue(EXISTING_RESTAURANT);

    const result = await service.createRestaurant(
      dto({ name: '無視されるはずの名前' }),
    );

    expect(dishesRepository.createOrGetRestaurant).not.toHaveBeenCalled();
    expect(externalApi.callPlaceDetails).not.toHaveBeenCalled();
    expect(assembler.enrichRestaurantsWithImageUrls).toHaveBeenCalledWith(
      EXISTING_RESTAURANT,
    );
    expect(result.restaurant).toEqual(EXISTING_RESTAURANT);
  });
});
