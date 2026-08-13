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
/** #1223 同期 upsert が返す実 ID（従来レスポンスは 'unknown' だった） */
const PERSISTED_RESTAURANT_ID = 'persisted-restaurant-uuid';
const PERSISTED_DISH_ID = 'persisted-dish-uuid';
/** withTransaction のパススルー用ダミー tx */
const TX = { __tx: true } as never;

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
    createOrGetRestaurant: jest.Mock;
    createOrGetDishForCategory: jest.Mock;
    createDishMedia: jest.Mock;
  };
  let dishMediaService: { fetchDishMediaEntryItems: jest.Mock };
  let storage: { fileExists: jest.Mock };
  let prisma: { withTransaction: jest.Mock };
  let logger: {
    debug: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
    log: jest.Mock;
  };

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
      // #1223 同期 upsert が呼ぶ 3 メソッド。handler が使うのと同一の repository メソッド。
      createOrGetRestaurant: jest
        .fn()
        .mockResolvedValue({ id: PERSISTED_RESTAURANT_ID }),
      createOrGetDishForCategory: jest
        .fn()
        .mockResolvedValue({ id: PERSISTED_DISH_ID }),
      createDishMedia: jest.fn().mockResolvedValue(undefined),
    };
    dishMediaService = {
      fetchDishMediaEntryItems: jest.fn().mockResolvedValue({ items: [] }),
    };
    storage = { fileExists: jest.fn().mockResolvedValue(false) };
    // #1223 withTransaction は tx を渡して実行するだけのパススルー。
    prisma = {
      withTransaction: jest.fn((exec) => exec(TX)),
    };
    logger = {
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      log: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DishesService,
        { provide: DishesRepository, useValue: repo },
        // #1223 BulkImportSyncUpsertError の payload（code / meta）を検証するため、
        // 使い捨ての inline mock ではなく beforeEach で作った logger を渡す。
        { provide: AppLoggerService, useValue: logger },
        { provide: LocationsService, useValue: locations },
        {
          provide: RemoteConfigService,
          useValue: { getRemoteConfigValue: jest.fn().mockResolvedValue('5') },
        },
        { provide: CloudTasksService, useValue: cloudTasks },
        { provide: DishCategoriesRepository, useValue: {} },
        { provide: RestaurantsRepository, useValue: {} },
        { provide: PrismaService, useValue: prisma },
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

  // #1223 レビュー指摘 Major-2 の回帰テスト。
  //
  // 非同期ハンドラは downloadAndStorePhotos → upsertDatabaseEntries の順で動くため、
  // 従来は「dish_media 行が見える = GCS に原本がある」という不変条件が成立していた。
  // 同期 upsert はこれを壊すので、enqueue が失敗した（= 写真を GCS に置く経路が
  // 一つも無い）ときにまで行を作ってはいけない。作ると 'processing' のまま
  // 誰にも直せない行が残り、しかも feed の new バケットに優先的に載る。
  describe('#1223 enqueue と同期 upsert の順序', () => {
    beforeEach(() => {
      locations.searchRestaurants.mockResolvedValue({
        places: [buildPlace(PLACE_ID)],
      });
    });

    it('enqueue が失敗したときは同期 upsert を行わない', async () => {
      cloudTasks.enqueueCreateDishMediaEntry.mockRejectedValue(
        new Error('Cloud Tasks unavailable'),
      );

      await service.bulkImportFromGoogle(dto, VIEWER_ID);

      expect(repo.createOrGetRestaurant).not.toHaveBeenCalled();
      expect(repo.createOrGetDishForCategory).not.toHaveBeenCalled();
      expect(repo.createDishMedia).not.toHaveBeenCalled();
    });

    it('enqueue が成功したときは従来どおり同期 upsert する', async () => {
      await service.bulkImportFromGoogle(dto, VIEWER_ID);

      expect(cloudTasks.enqueueCreateDishMediaEntry).toHaveBeenCalledTimes(1);
      expect(repo.createDishMedia).toHaveBeenCalledTimes(1);
    });

    // enqueue を先に呼ぶこと自体が対策の本体なので、順序を直接固定する
    it('同期 upsert より先に enqueue を呼ぶ', async () => {
      const callOrder: string[] = [];
      cloudTasks.enqueueCreateDishMediaEntry.mockImplementation(() => {
        callOrder.push('enqueue');
        return Promise.resolve(undefined);
      });
      repo.createOrGetRestaurant.mockImplementation(() => {
        callOrder.push('syncUpsert');
        return Promise.resolve({ id: PERSISTED_RESTAURANT_ID });
      });

      await service.bulkImportFromGoogle(dto, VIEWER_ID);

      expect(callOrder).toEqual(['enqueue', 'syncUpsert']);
    });

    // enqueue 失敗時は #1223 以前の挙動（orphan response）に戻すだけで、
    // place をレスポンスから丸ごと落として可用性を下げてはいけない
    it('enqueue が失敗してもレスポンスは従来どおり返す', async () => {
      cloudTasks.enqueueCreateDishMediaEntry.mockRejectedValue(
        new Error('Cloud Tasks unavailable'),
      );

      const result = await service.bulkImportFromGoogle(dto, VIEWER_ID);

      expect(result).toHaveLength(1);
      expect(result[0].dish_media.id).toBe(
        buildGoogleImportDishMediaId(PLACE_ID, CATEGORY_ID),
      );
    });
  });

  // #1223 一次対策。レスポンスで返す dish_media.id が必ず DB に存在することを保証する。
  describe('#1223 同期 upsert', () => {
    beforeEach(() => {
      locations.searchRestaurants.mockResolvedValue({
        places: [buildPlace(PLACE_ID)],
      });
    });

    it('レスポンスを返す前に restaurant / dish / dish_media を同期で upsert する', async () => {
      await service.bulkImportFromGoogle(dto, VIEWER_ID);

      expect(repo.createOrGetRestaurant).toHaveBeenCalledTimes(1);
      expect(repo.createOrGetDishForCategory).toHaveBeenCalledTimes(1);
      expect(repo.createDishMedia).toHaveBeenCalledTimes(1);
    });

    it('同期で作る dish_media.id はレスポンスの dish_media.id と一致する', async () => {
      const result = await service.bulkImportFromGoogle(dto, VIEWER_ID);

      const expectedId = buildGoogleImportDishMediaId(PLACE_ID, CATEGORY_ID);
      expect(result[0].dish_media.id).toBe(expectedId);
      expect(repo.createDishMedia.mock.calls[0][1].id).toBe(expectedId);
      // 永続化した dish_id を指していること
      expect(repo.createDishMedia.mock.calls[0][1].dish_id).toBe(
        PERSISTED_DISH_ID,
      );
    });

    // handler の冪等性境界は isDishMediaCompleted なので、completed で入れると
    // handler が写真の取得・保存・リサイズを永久に skip してしまう
    it("同期で作る行の status は 'processing' のままにする", async () => {
      await service.bulkImportFromGoogle(dto, VIEWER_ID);

      const persisted = repo.createDishMedia.mock.calls[0][1];
      expect(persisted.media_processing_status).toBe('processing');
      expect(persisted.thumbnail_processing_status).toBe('processing');
    });

    it('同期 upsert 後も非同期 enqueue は従来どおり行う（写真の取得・保存は非同期のまま）', async () => {
      await service.bulkImportFromGoogle(dto, VIEWER_ID);

      expect(cloudTasks.enqueueCreateDishMediaEntry).toHaveBeenCalledTimes(1);
      const payload = cloudTasks.enqueueCreateDishMediaEntry.mock.calls[0][0];
      expect(payload.photoUri).toEqual(['https://google/photo.jpg']);
    });

    it('レスポンスの restaurant.id / dish.id が永続化された実 ID になる', async () => {
      const result = await service.bulkImportFromGoogle(dto, VIEWER_ID);

      expect(result[0].restaurant.id).toBe(PERSISTED_RESTAURANT_ID);
      expect(result[0].dish.id).toBe(PERSISTED_DISH_ID);
      expect(result[0].dish_media.dish_id).toBe(PERSISTED_DISH_ID);
    });

    // 同期 upsert の失敗で place がレスポンスから消えると可用性が下がる。
    // 従来動作（非同期ハンドラ任せ）へフォールバックすること。
    it('同期 upsert が失敗しても 500 にせず、従来どおりレスポンスと enqueue を返す', async () => {
      repo.createOrGetRestaurant.mockRejectedValue(
        new Error('unique constraint'),
      );

      const result = await service.bulkImportFromGoogle(dto, VIEWER_ID);

      expect(result).toHaveLength(1);
      expect(cloudTasks.enqueueCreateDishMediaEntry).toHaveBeenCalledTimes(1);
    });

    // #829 / #1053 の再利用パスは既に DB に行があるので同期 upsert は不要
    it('既存 Google import の再利用パスでは同期 upsert を行わない', async () => {
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

      await service.bulkImportFromGoogle(dto, VIEWER_ID);

      expect(repo.createDishMedia).not.toHaveBeenCalled();
      expect(cloudTasks.enqueueCreateDishMediaEntry).toHaveBeenCalledTimes(1);
    });

    // #1223 レビュー指摘 Minor-2。message だけだと P2002（競合）／接続断／circuit open が
    // 区別できず、「同期 upsert の失敗をまず疑う」という監視手順が成立しない。
    it('同期 upsert の失敗ログに Prisma の code と meta を残す', async () => {
      repo.createOrGetRestaurant.mockRejectedValue(
        Object.assign(new Error('Unique constraint failed'), {
          code: 'P2002',
          meta: { target: ['google_place_id'] },
        }),
      );

      await service.bulkImportFromGoogle(dto, VIEWER_ID);

      expect(logger.error).toHaveBeenCalledWith(
        'BulkImportSyncUpsertError',
        'bulkImportFromGoogle',
        expect.objectContaining({
          code: 'P2002',
          meta: { target: ['google_place_id'] },
        }),
      );
    });

    it('Prisma 由来でないエラーでも code は null で残す', async () => {
      repo.createOrGetRestaurant.mockRejectedValue(
        new Error('DB circuit open (temporarily unavailable)'),
      );

      await service.bulkImportFromGoogle(dto, VIEWER_ID);

      expect(logger.error).toHaveBeenCalledWith(
        'BulkImportSyncUpsertError',
        'bulkImportFromGoogle',
        expect.objectContaining({
          code: null,
          meta: null,
          error: 'DB circuit open (temporarily unavailable)',
        }),
      );
    });

    it('completed 再利用パスでも同期 upsert を行わない', async () => {
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

      await service.bulkImportFromGoogle(dto, VIEWER_ID);

      expect(repo.createDishMedia).not.toHaveBeenCalled();
    });
  });
});
