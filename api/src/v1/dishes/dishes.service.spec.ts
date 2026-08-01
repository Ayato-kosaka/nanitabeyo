// api/src/v1/dishes/dishes.service.spec.ts
//
// ❶ bulkImportFromGoogle の分岐を固定する
// ❷ とくに「Photo Media を呼ばないこと」はコスト削減(#829/#1053)の回帰テスト
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
import { StorageService } from '../../core/storage/storage.service';
import { buildGoogleImportDishMediaId } from './deterministic-id';
import type { BulkImportDishesDto } from '@shared/v1/dto';

const VIEWER_ID = 'viewer-uuid';
const CATEGORY_ID = 'category-uuid';
const PLACE_ID = 'ChIJplace1';

const dto = {
  location: '35.68944,139.69167',
  radius: 500,
  categoryId: CATEGORY_ID,
  categoryName: 'ラーメン',
  minRating: 3.0,
  languageCode: 'ja',
} as BulkImportDishesDto;

/** Text Search が返す最小限の place */
const buildPlace = (id: string) => ({
  id,
  displayName: { text: `店舗 ${id}` },
  location: { latitude: 35.6, longitude: 139.7 },
  addressComponents: [{ longText: '東京都', shortText: 'Tokyo', types: [] }],
  photos: [{ name: `places/${id}/photos/abc`, widthPx: 1200, heightPx: 900 }],
  reviews: [
    {
      originalText: { text: 'おいしい', languageCode: 'ja' },
      rating: 5,
      authorAttribution: { displayName: '太郎', uri: 'https://example.com/1' },
    },
  ],
});

/** 既存 dish_media を返す assembler 相当のダミー entry */
const buildExistingEntry = (
  dishMediaId: string,
  overrides: Record<string, unknown> = {},
) => ({
  restaurant: {
    id: 'restaurant-uuid',
    google_place_id: PLACE_ID,
    name: '既存店舗',
    name_language_code: 'ja',
    latitude: 35.6,
    longitude: 139.7,
    location: null,
    image_url: 'https://cdn.example.com/existing.jpg',
    image_path: 'google-maps/photo/existing.jpg',
    address_components: [],
    plus_code: null,
    created_at: '2026-01-01T00:00:00.000Z',
    imageUrls: { sm: '', md: '' },
  },
  dish: {
    id: 'dish-uuid',
    restaurant_id: 'restaurant-uuid',
    category_id: CATEGORY_ID,
    name: 'ラーメン',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    lock_no: 0,
    reviewCount: 1,
    averageRating: 5,
  },
  dish_media: {
    id: dishMediaId,
    dish_id: 'dish-uuid',
    user_id: null,
    media_path: 'google-maps/photo/existing.jpg',
    media_type: 'image',
    thumbnail_path: 'google-maps/photo/existing.jpg',
    video_duration_ms: null,
    media_processing_status: 'processing',
    thumbnail_processing_status: 'processing',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    lock_no: 0,
    isMine: false,
    isSaved: false,
    isLiked: false,
    likeCount: 0,
    mediaUrl: 'https://cdn.example.com/existing.jpg',
    thumbnailImageUrl: 'https://cdn.example.com/existing.jpg',
    ...(overrides.dish_media as object),
  },
  dish_reviews: (overrides.dish_reviews as unknown[]) ?? [],
});

describe('DishesService.bulkImportFromGoogle', () => {
  let service: DishesService;
  let locations: { searchRestaurants: jest.Mock; tryGetPhotoMedia: jest.Mock };
  let cloudTasks: { enqueueCreateDishMediaEntry: jest.Mock };
  let repo: {
    findReusableGoogleImportDishMediaByPlaceIdsAndCategory: jest.Mock;
  };
  let dishMediaService: { fetchDishMediaEntryItems: jest.Mock };
  let storage: { fileExists: jest.Mock };

  beforeEach(async () => {
    locations = {
      searchRestaurants: jest.fn(),
      tryGetPhotoMedia: jest
        .fn()
        .mockResolvedValue({ photoUri: 'https://google/photo.jpg' }),
    };
    cloudTasks = {
      enqueueCreateDishMediaEntry: jest.fn().mockResolvedValue(undefined),
    };
    repo = {
      findReusableGoogleImportDishMediaByPlaceIdsAndCategory: jest
        .fn()
        .mockResolvedValue(new Map()),
    };
    dishMediaService = {
      fetchDishMediaEntryItems: jest.fn().mockResolvedValue({ items: [] }),
    };
    storage = { fileExists: jest.fn().mockResolvedValue(false) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DishesService,
        { provide: DishesRepository, useValue: repo },
        {
          provide: AppLoggerService,
          useValue: {
            debug: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            log: jest.fn(),
          },
        },
        { provide: LocationsService, useValue: locations },
        {
          provide: RemoteConfigService,
          useValue: { getRemoteConfigValue: jest.fn().mockResolvedValue('5') },
        },
        { provide: CloudTasksService, useValue: cloudTasks },
        { provide: DishCategoriesRepository, useValue: {} },
        { provide: RestaurantsRepository, useValue: {} },
        { provide: PrismaService, useValue: {} },
        { provide: DishMediaService, useValue: dishMediaService },
        { provide: StorageService, useValue: storage },
      ],
    }).compile();

    service = module.get<DishesService>(DishesService);
  });

  describe('該当店舗なし', () => {
    // searchRestaurants は全フォールバックが0件だったとき {} を返す
    // (locations.service.ts の GoogleMapsTextSearchAllFallbacksFailed 経路)
    it.each([
      ['placesを持たない空レスポンス', {}],
      ['placesが空配列', { places: [] }],
    ])('%s のとき 500 ではなく空配列を返す', async (_label, response) => {
      locations.searchRestaurants.mockResolvedValue(response);

      await expect(
        service.bulkImportFromGoogle(dto, VIEWER_ID),
      ).resolves.toEqual([]);
    });

    it('該当なしのとき Cloud Task を enqueue しない', async () => {
      locations.searchRestaurants.mockResolvedValue({});

      await service.bulkImportFromGoogle(dto, VIEWER_ID);

      expect(cloudTasks.enqueueCreateDishMediaEntry).not.toHaveBeenCalled();
    });

    it('該当なしのとき Photo Media を呼ばない', async () => {
      locations.searchRestaurants.mockResolvedValue({});

      await service.bulkImportFromGoogle(dto, VIEWER_ID);

      expect(locations.tryGetPhotoMedia).not.toHaveBeenCalled();
    });
  });

  describe('#829 completed 再利用', () => {
    beforeEach(() => {
      locations.searchRestaurants.mockResolvedValue({
        places: [buildPlace(PLACE_ID)],
      });
      repo.findReusableGoogleImportDishMediaByPlaceIdsAndCategory.mockResolvedValue(
        new Map([
          [PLACE_ID, { dishMediaId: 'existing-media', reuseKind: 'completed' }],
        ]),
      );
      dishMediaService.fetchDishMediaEntryItems.mockResolvedValue({
        items: [
          buildExistingEntry('existing-media', {
            dish_media: {
              media_processing_status: 'completed',
              thumbnail_processing_status: 'completed',
            },
          }),
        ],
      });
    });

    // これが #829 のコスト削減そのものの回帰テスト
    it('Photo Media を呼ばない', async () => {
      await service.bulkImportFromGoogle(dto, VIEWER_ID);

      expect(locations.tryGetPhotoMedia).not.toHaveBeenCalled();
    });

    it('Cloud Task を enqueue しない', async () => {
      await service.bulkImportFromGoogle(dto, VIEWER_ID);

      expect(cloudTasks.enqueueCreateDishMediaEntry).not.toHaveBeenCalled();
    });

    it('既存 entry をそのまま返す', async () => {
      const result = await service.bulkImportFromGoogle(dto, VIEWER_ID);

      expect(result).toHaveLength(1);
      expect(result[0].dish_media.id).toBe('existing-media');
    });
  });

  describe('#1053 未完了再利用と Photo Media 課金', () => {
    beforeEach(() => {
      locations.searchRestaurants.mockResolvedValue({
        places: [buildPlace(PLACE_ID)],
      });
      repo.findReusableGoogleImportDishMediaByPlaceIdsAndCategory.mockResolvedValue(
        new Map([
          [
            PLACE_ID,
            {
              dishMediaId: 'existing-media',
              reuseKind: 'google-import-non-completed',
            },
          ],
        ]),
      );
      dishMediaService.fetchDishMediaEntryItems.mockResolvedValue({
        items: [buildExistingEntry('existing-media')],
      });
    });

    it('GCS に実体があれば Photo Media を呼ばない', async () => {
      storage.fileExists.mockResolvedValue(true);

      await service.bulkImportFromGoogle(dto, VIEWER_ID);

      expect(storage.fileExists).toHaveBeenCalledWith(
        'google-maps/photo/existing.jpg',
      );
      expect(locations.tryGetPhotoMedia).not.toHaveBeenCalled();
    });

    it('GCS に実体があれば photoUri 空で enqueue し、handler に download を skip させる', async () => {
      storage.fileExists.mockResolvedValue(true);

      await service.bulkImportFromGoogle(dto, VIEWER_ID);

      expect(cloudTasks.enqueueCreateDishMediaEntry).toHaveBeenCalledTimes(1);
      const payload = cloudTasks.enqueueCreateDishMediaEntry.mock.calls[0][0];
      expect(payload.photoUri).toEqual([]);
      // resize をやり直させるため、同じ dish_media.id で積み直すこと
      expect(payload.dish_media.id).toBe('existing-media');
    });

    it('GCS に実体が無ければ Photo Media を取り直す', async () => {
      storage.fileExists.mockResolvedValue(false);

      await service.bulkImportFromGoogle(dto, VIEWER_ID);

      expect(locations.tryGetPhotoMedia).toHaveBeenCalledTimes(1);
      const payload = cloudTasks.enqueueCreateDishMediaEntry.mock.calls[0][0];
      expect(payload.photoUri).toEqual(['https://google/photo.jpg']);
    });

    // #1053 Codex レビュー指摘(P1) の回帰テスト。
    // #829 より前に作られた行の review.id は randomUUID 由来で決定論 ID と一致しない。
    // id だけで照合すると同じレビューが二重登録され reviewCount が水増しされる。
    it('旧 randomUUID 由来の既存レビューを内容で重複排除する', async () => {
      storage.fileExists.mockResolvedValue(true);
      dishMediaService.fetchDishMediaEntryItems.mockResolvedValue({
        items: [
          buildExistingEntry('existing-media', {
            dish_reviews: [
              {
                // 決定論 ID ではない旧 ID。ただし本文・投稿者・rating は
                // Google が今回返すレビューと同一
                id: 'legacy-random-uuid',
                dish_id: 'dish-uuid',
                user_id: null,
                comment: 'おいしい',
                comment_tsv: null,
                original_language_code: 'ja',
                rating: 5,
                price_cents: null,
                currency_code: null,
                created_dish_media_id: 'existing-media',
                imported_user_name: '太郎',
                imported_user_avatar: null,
                created_at: '2026-01-01T00:00:00.000Z',
                username: '太郎',
                isLiked: false,
                likeCount: 0,
              },
            ],
          }),
        ],
      });

      await service.bulkImportFromGoogle(dto, VIEWER_ID);

      const payload = cloudTasks.enqueueCreateDishMediaEntry.mock.calls[0][0];
      // 旧 ID の1件だけが残り、決定論 ID の重複は追加されない
      expect(payload.dish_reviews).toHaveLength(1);
      expect(payload.dish_reviews[0].id).toBe('legacy-random-uuid');
    });

    it('今回 Google が返した新しいレビューが捨てられない', async () => {
      storage.fileExists.mockResolvedValue(true);

      await service.bulkImportFromGoogle(dto, VIEWER_ID);

      const payload = cloudTasks.enqueueCreateDishMediaEntry.mock.calls[0][0];
      // 既存 review 0 件 + Google の新規 1 件 = 1 件が payload に載る
      expect(payload.dish_reviews).toHaveLength(1);
      expect(payload.dish_reviews[0].comment).toBe('おいしい');
    });
  });

  describe('#1053 その他の分岐', () => {
    it('同一 placeId が2件返ってもレスポンスの dish_media.id は重複しない', async () => {
      locations.searchRestaurants.mockResolvedValue({
        places: [buildPlace(PLACE_ID), buildPlace(PLACE_ID)],
      });

      const result = await service.bulkImportFromGoogle(dto, VIEWER_ID);

      const ids = result.map((entry) => entry.dish_media.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(cloudTasks.enqueueCreateDishMediaEntry).toHaveBeenCalledTimes(1);
    });

    it('media_path が dish_media.id から決定論的に導出される', async () => {
      locations.searchRestaurants.mockResolvedValue({
        places: [buildPlace(PLACE_ID)],
      });

      await service.bulkImportFromGoogle(dto, VIEWER_ID);

      const payload = cloudTasks.enqueueCreateDishMediaEntry.mock.calls[0][0];
      const expectedId = buildGoogleImportDishMediaId(PLACE_ID, CATEGORY_ID);
      expect(payload.dish_media.id).toBe(expectedId);
      // Date.now() 由来のファイル名だとレース時に食い違う
      expect(payload.dish_media.media_path).toContain(expectedId);
    });

    it('enqueue が reject しても unhandled rejection にならず処理が続く', async () => {
      locations.searchRestaurants.mockResolvedValue({
        places: [buildPlace(PLACE_ID)],
      });
      cloudTasks.enqueueCreateDishMediaEntry.mockRejectedValue(
        new Error('Cloud Tasks unavailable'),
      );

      await expect(
        service.bulkImportFromGoogle(dto, VIEWER_ID),
      ).resolves.toHaveLength(1);
    });
  });
});
