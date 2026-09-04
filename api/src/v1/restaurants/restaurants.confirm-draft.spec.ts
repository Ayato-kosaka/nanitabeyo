// api/src/v1/restaurants/restaurants.confirm-draft.spec.ts
//
// #1671 「ユーザーが確認した値を保存する」経路の回帰テスト。
//
// このチケットの完了条件のうち、ここで機械的に押さえられるのは次の 3 つ。
//
//   1. **「この内容で登録」を押すまで restaurants に 1 行も入らない**
//      → 下読み（createRestaurantDraft）が createOrGetRestaurant を呼ばないこと
//   2. **確認された値が保存される**（Google の値ではなく）
//   3. **既定値を書き換えたことをサーバが検知できる**
//      → しかも «クライアントが既定値を騙れない» 形で
//
// あわせて #843 の観点で、**確認ページ経由だと Google Places を 1 回も叩かない**ことも
// 固定する。ここが崩れると「確認を挟んだら課金が 2 倍になった」が静かに起きる。

// core/config/env は import 時に process.env を検証して throw するため、
// 実 DB・実 API に触れない単体テストでも .env が無いと suite ごと落ちる。
// （restaurants.service.spec.ts と同じ理由・同じ形）
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
import { BadRequestException } from '@nestjs/common';
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
import { signRestaurantDraftToken } from './restaurant-draft.token';
import type { CreateRestaurantDto } from '@shared/v1/dto';

const TX = { __tx: true } as never;
const PLACE_ID = 'ChIJplace1';
const OTHER_PLACE_ID = 'ChIJplace2';

const GOOGLE_NAME = 'Google が返した店名';
const GOOGLE_LAT = 35.6;
const GOOGLE_LNG = 139.7;

const ADDRESS_COMPONENTS = [
  { longText: '日本', shortText: 'JP', types: ['country'] },
  {
    longText: '東京都',
    shortText: 'Tokyo',
    types: ['administrative_area_level_1'],
  },
];

const buildPlaceDetail = () => ({
  id: PLACE_ID,
  displayName: { text: GOOGLE_NAME },
  location: { latitude: GOOGLE_LAT, longitude: GOOGLE_LNG },
  addressComponents: ADDRESS_COMPONENTS,
  types: ['restaurant', 'food'],
  plusCode: null,
});

describe('#1671 確認ページ経由の店舗作成', () => {
  let service: RestaurantsService;
  let externalApi: { callPlaceDetails: jest.Mock };
  let dishesRepository: { createOrGetRestaurant: jest.Mock };
  let locationsService: {
    resolveLocalLanguageCode: jest.Mock;
    extractCountryCode: jest.Mock;
  };
  let logger: {
    debug: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
    log: jest.Mock;
  };

  beforeEach(async () => {
    externalApi = {
      callPlaceDetails: jest.fn().mockResolvedValue(buildPlaceDetail()),
    };
    dishesRepository = {
      createOrGetRestaurant: jest.fn((_tx, data) =>
        Promise.resolve({
          id: 'restaurant-uuid',
          google_place_id: PLACE_ID,
          image_path: null,
          ...data,
        }),
      ),
    };
    locationsService = {
      resolveLocalLanguageCode: jest.fn().mockReturnValue('ja'),
      extractCountryCode: jest.fn().mockReturnValue('JP'),
    };
    logger = {
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      log: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RestaurantsService,
        {
          provide: RestaurantsRepository,
          useValue: {
            findRestaurantByGooglePlaceId: jest.fn().mockResolvedValue(null),
            getRestaurantReviewStats: jest
              .fn()
              .mockResolvedValue({ reviewCount: 0, averageRating: 0 }),
            getRestaurantBidStats: jest
              .fn()
              .mockResolvedValue({ totalCents: 0, maxEndDate: null }),
          },
        },
        {
          provide: RestaurantsAssembler,
          useValue: { enrichRestaurantsWithImageUrls: jest.fn((r) => r) },
        },
        { provide: ExternalApiService, useValue: externalApi },
        {
          provide: PrismaService,
          useValue: { withTransaction: jest.fn((exec) => exec(TX)) },
        },
        { provide: AppLoggerService, useValue: logger },
        { provide: DishesRepository, useValue: dishesRepository },
        { provide: DishMediaService, useValue: {} },
        {
          provide: DishMediaRepository,
          useValue: {
            findFallbackThumbnailsByRestaurantIds: jest
              .fn()
              .mockResolvedValue(new Map()),
          },
        },
        { provide: LocationsService, useValue: locationsService },
        { provide: StorageService, useValue: { uploadFile: jest.fn() } },
      ],
    }).compile();

    service = module.get<RestaurantsService>(RestaurantsService);
  });

  /** テスト用に「本物の下読み」を 1 回通してトークンを得る */
  const issueDraft = async () => {
    const result = await service.createRestaurantDraft({
      googlePlaceId: PLACE_ID,
    });
    externalApi.callPlaceDetails.mockClear();
    dishesRepository.createOrGetRestaurant.mockClear();
    return result;
  };

  describe('下読み（POST /v1/restaurants/draft）', () => {
    it('⚠️ 店を 1 行も作らない（「この内容で登録」を押すまで保存しない）', async () => {
      await service.createRestaurantDraft({ googlePlaceId: PLACE_ID });
      expect(dishesRepository.createOrGetRestaurant).not.toHaveBeenCalled();
    });

    it('確認ページの初期値（Google 由来）と国コードを返す', async () => {
      const { draft } = await service.createRestaurantDraft({
        googlePlaceId: PLACE_ID,
      });

      expect(draft).toMatchObject({
        googlePlaceId: PLACE_ID,
        name: GOOGLE_NAME,
        nameLanguageCode: 'ja',
        latitude: GOOGLE_LAT,
        longitude: GOOGLE_LNG,
        countryCode: 'JP',
        // 国名（日本）は住所文字列から外れ、都道府県だけが残る
        address: '東京都',
      });
      expect(draft.addressComponents).toEqual(ADDRESS_COMPONENTS);
    });

    it('国コードの判定は LocationsService に委譲する（同じ判定を書き写さない）', async () => {
      await service.createRestaurantDraft({ googlePlaceId: PLACE_ID });
      expect(locationsService.extractCountryCode).toHaveBeenCalledWith(
        ADDRESS_COMPONENTS,
      );
    });

    it('飲食店でない Place は 422 で弾く（作成時と同じ判定）', async () => {
      externalApi.callPlaceDetails.mockResolvedValue({
        ...buildPlaceDetail(),
        types: ['lodging'],
      });
      await expect(
        service.createRestaurantDraft({ googlePlaceId: PLACE_ID }),
      ).rejects.toMatchObject({ status: 422 });
    });
  });

  describe('確認した値での作成', () => {
    it('⚠️ Google Places を 1 回も叩かない（下読みで済ませてある）', async () => {
      const { draftToken } = await issueDraft();

      await service.createRestaurant({
        googlePlaceId: PLACE_ID,
        draftToken,
        name: GOOGLE_NAME,
        latitude: GOOGLE_LAT,
        longitude: GOOGLE_LNG,
      } as CreateRestaurantDto);

      expect(externalApi.callPlaceDetails).not.toHaveBeenCalled();
    });

    it('ユーザーが直した店名・座標が保存される（Google の値ではない）', async () => {
      const { draftToken } = await issueDraft();

      await service.createRestaurant({
        googlePlaceId: PLACE_ID,
        draftToken,
        name: 'ユーザーが直した店名',
        latitude: 35.61,
        longitude: 139.71,
      } as CreateRestaurantDto);

      expect(dishesRepository.createOrGetRestaurant).toHaveBeenCalledWith(
        TX,
        expect.objectContaining({
          name: 'ユーザーが直した店名',
          latitude: 35.61,
          longitude: 139.71,
          name_language_code: 'ja',
          google_place_id: PLACE_ID,
        }),
        PLACE_ID,
      );
    });

    it('Google 由来の addressComponents は下読みの値がそのまま保存される', async () => {
      const { draftToken } = await issueDraft();

      await service.createRestaurant({
        googlePlaceId: PLACE_ID,
        draftToken,
        name: GOOGLE_NAME,
        latitude: GOOGLE_LAT,
        longitude: GOOGLE_LNG,
      } as CreateRestaurantDto);

      expect(dishesRepository.createOrGetRestaurant).toHaveBeenCalledWith(
        TX,
        expect.objectContaining({ address_components: ADDRESS_COMPONENTS }),
        PLACE_ID,
      );
    });

    it('⚠️ address / country_code が埋まる（62 万行が永久に空だった穴）', async () => {
      const { draftToken } = await issueDraft();

      await service.createRestaurant({
        googlePlaceId: PLACE_ID,
        draftToken,
        name: GOOGLE_NAME,
        latitude: GOOGLE_LAT,
        longitude: GOOGLE_LNG,
        address: '東京都渋谷区神南1-2-3',
        countryCode: 'JP',
      } as CreateRestaurantDto);

      expect(dishesRepository.createOrGetRestaurant).toHaveBeenCalledWith(
        TX,
        expect.objectContaining({
          address: '東京都渋谷区神南1-2-3',
          country_code: 'JP',
        }),
        PLACE_ID,
      );
    });

    it('書き換えた項目が記録される', async () => {
      const { draftToken } = await issueDraft();

      await service.createRestaurant({
        googlePlaceId: PLACE_ID,
        draftToken,
        name: 'ユーザーが直した店名',
        latitude: GOOGLE_LAT,
        longitude: GOOGLE_LNG,
      } as CreateRestaurantDto);

      expect(logger.log).toHaveBeenCalledWith(
        'RestaurantCreatedFromConfirmation',
        'createRestaurant',
        expect.objectContaining({
          changedFields: ['name'],
          userEditedDefaults: true,
        }),
      );
    });

    it('そのまま確認しただけなら «書き換えていない» と記録される', async () => {
      const { draftToken } = await issueDraft();

      await service.createRestaurant({
        googlePlaceId: PLACE_ID,
        draftToken,
        name: GOOGLE_NAME,
        latitude: GOOGLE_LAT,
        longitude: GOOGLE_LNG,
      } as CreateRestaurantDto);

      expect(logger.log).toHaveBeenCalledWith(
        'RestaurantCreatedFromConfirmation',
        'createRestaurant',
        expect.objectContaining({
          changedFields: [],
          userEditedDefaults: false,
        }),
      );
    });
  });

  describe('騙されないこと', () => {
    it('壊れた draftToken は 400', async () => {
      await expect(
        service.createRestaurant({
          googlePlaceId: PLACE_ID,
          draftToken: 'rdt1.garbage.signature',
          name: '好きな名前',
        } as CreateRestaurantDto),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(dishesRepository.createOrGetRestaurant).not.toHaveBeenCalled();
    });

    it('期限切れの draftToken は 400', async () => {
      const expired = signRestaurantDraftToken(
        {
          googlePlaceId: PLACE_ID,
          name: GOOGLE_NAME,
          nameLanguageCode: 'ja',
          latitude: GOOGLE_LAT,
          longitude: GOOGLE_LNG,
          addressComponentsJson: JSON.stringify(ADDRESS_COMPONENTS),
          plusCodeJson: null,
          address: '東京都',
          countryCode: 'JP',
        },
        'test-SUPABASE_JWT_SECRET',
        // TTL ぶん過去に発行したことにする
        Date.now() - 24 * 60 * 60 * 1000,
      );

      await expect(
        service.createRestaurant({
          googlePlaceId: PLACE_ID,
          draftToken: expired,
        } as CreateRestaurantDto),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('⚠️ 別の店の draftToken を付け替えて «確認済み» を騙れない', async () => {
      // A 店で正規に下読みしたトークンを、B 店の作成へ付け替える
      const { draftToken } = await issueDraft();

      await expect(
        service.createRestaurant({
          googlePlaceId: OTHER_PLACE_ID,
          draftToken,
          name: '乗っ取った名前',
          latitude: 0,
          longitude: 0,
        } as CreateRestaurantDto),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(dishesRepository.createOrGetRestaurant).not.toHaveBeenCalled();
    });
  });

  describe('後方互換（draftToken なし）', () => {
    it('従来どおり Google から取った値をそのまま保存する', async () => {
      await service.createRestaurant({
        googlePlaceId: PLACE_ID,
      } as CreateRestaurantDto);

      expect(externalApi.callPlaceDetails).toHaveBeenCalled();
      expect(dishesRepository.createOrGetRestaurant).toHaveBeenCalledWith(
        TX,
        expect.objectContaining({
          name: GOOGLE_NAME,
          latitude: GOOGLE_LAT,
          longitude: GOOGLE_LNG,
        }),
        PLACE_ID,
      );
    });

    it('⚠️ address / country_code には触らない（Google の値を «確認済み» の顔で入れない）', async () => {
      await service.createRestaurant({
        googlePlaceId: PLACE_ID,
      } as CreateRestaurantDto);

      const [, saved] = dishesRepository.createOrGetRestaurant.mock.calls[0];
      expect(saved).not.toHaveProperty('address');
      expect(saved).not.toHaveProperty('country_code');
    });

    it('⚠️ name だけ送られても、draftToken が無ければ無視する（検知できない値を信じない）', async () => {
      await service.createRestaurant({
        googlePlaceId: PLACE_ID,
        name: 'トークン無しで送りつけた名前',
      } as CreateRestaurantDto);

      expect(dishesRepository.createOrGetRestaurant).toHaveBeenCalledWith(
        TX,
        expect.objectContaining({ name: GOOGLE_NAME }),
        PLACE_ID,
      );
    });
  });
});
