// api/test/functional/v1/dish-media/find-dish-media-by-restaurant.e2e-spec.ts
//
// #1257 findDishMediaByRestaurant()（GET /v1/restaurants/:id/dish-media）の候補集合からも
// 実体未着（media_processing_status !== 'completed'）の行が除外されることを検証する。
//
// 検索側（findDishMediaIds）だけを直すと、検索には出なくなった未着メディアが
// 「店舗詳細 → フィード」経由でだけ露出し続ける。この spec はその抜け穴を塞いだことを固定する。
//
// findDishMediaByRestaurant は $queryRaw（ウィンドウ関数 ROW_NUMBER + カーソル）なので、
// Prisma をモックする unit test では SQL の意味を検証できない。実 PostgreSQL に対する
// 統合テストとして書く。実行には TEST_DATABASE_URL が必要（無ければスイート全体を skip）。

// ⚠️ この import は必ず先頭に置くこと。env.ts が import 時に環境変数を検証するため、
//    リポジトリ本体より先に評価される必要がある（詳細は functional-test-env.ts）
import { maybeDescribe } from './functional-test-env';

import { Test, TestingModule } from '@nestjs/testing';
import { ClsModule } from 'nestjs-cls';
import { DishMediaRepository } from '../../../../src/v1/dish-media/dish-media.repository';
import { PrismaService } from '../../../../src/prisma/prisma.service';
import { AppLoggerService } from '../../../../src/core/logger/logger.service';

maybeDescribe(
  'DishMediaRepository.findDishMediaByRestaurant (functional, real DB)',
  () => {
    let moduleRef: TestingModule;
    let prisma: PrismaService;
    let repository: DishMediaRepository;

    const RESTAURANT_ID = '00000000-0000-0000-0000-0000000000e0';

    // dishes は (restaurant_id, category_id) が UNIQUE なので、同一店舗に 3 皿置くには
    // カテゴリも 3 つ要る。カテゴリの違いはこのクエリの結果に影響しない。
    const CATEGORY_IDS = {
      mixed: 'test-category-1257-r1',
      unarrivedOnly: 'test-category-1257-r2',
      completedOnly: 'test-category-1257-r3',
    } as const;

    const DISH_IDS = {
      /** completed と processing が混在する皿 */
      mixed: '00000000-0000-0000-0000-0000000000e1',
      /** 未着メディアしか持たない皿 */
      unarrivedOnly: '00000000-0000-0000-0000-0000000000e2',
      /** completed だけを持つ皿 */
      completedOnly: '00000000-0000-0000-0000-0000000000e3',
    } as const;

    const MEDIA_IDS = {
      /** mixed 皿の completed 側。いいねは少ない */
      mixedCompleted: '00000000-0000-0000-0000-0000000000f1',
      /**
       * mixed 皿の processing 側。**いいね数はこの店舗で最大**にしてある。
       * 除外が効いていなければ、皿の代表（ROW_NUMBER = 1）はこちらに奪われる。
       */
      mixedProcessing: '00000000-0000-0000-0000-0000000000f2',
      /** unarrivedOnly 皿の failed メディア */
      unarrivedFailed: '00000000-0000-0000-0000-0000000000f3',
      /** completedOnly 皿の completed メディア */
      completed: '00000000-0000-0000-0000-0000000000f4',
    } as const;

    const LIKE_TOTALS: Record<string, number> = {
      [MEDIA_IDS.mixedCompleted]: 1,
      [MEDIA_IDS.mixedProcessing]: 99,
      [MEDIA_IDS.unarrivedFailed]: 50,
      [MEDIA_IDS.completed]: 5,
    };

    beforeAll(async () => {
      moduleRef = await Test.createTestingModule({
        imports: [ClsModule.forRoot({ global: true })],
        providers: [DishMediaRepository, PrismaService, AppLoggerService],
      }).compile();

      prisma = moduleRef.get(PrismaService);
      await prisma.onModuleInit();
      repository = moduleRef.get(DishMediaRepository);

      for (const categoryId of Object.values(CATEGORY_IDS)) {
        await prisma.prisma.dish_categories.create({
          data: {
            id: categoryId,
            label_en: `Test Category #1257 (${categoryId})`,
            labels: {},
            image_url: 'https://example.com/image.png',
            tags: [],
          },
        });
      }

      await prisma.prisma.restaurants.create({
        data: {
          id: RESTAURANT_ID,
          google_place_id: 'test-place-1257-restaurant-feed',
          name: 'Test Restaurant #1257 (feed)',
          name_language_code: 'ja',
          latitude: 35.68944,
          longitude: 139.69167,
          image_url: 'https://example.com/image.png',
          address_components: {},
        },
      });

      for (const key of ['mixed', 'unarrivedOnly', 'completedOnly'] as const) {
        await prisma.prisma.dishes.create({
          data: {
            id: DISH_IDS[key],
            restaurant_id: RESTAURANT_ID,
            category_id: CATEGORY_IDS[key],
            name: `Test Dish #1257 (${key})`,
          },
        });
      }

      const media: Array<{ id: string; dishId: string; status: string }> = [
        {
          id: MEDIA_IDS.mixedCompleted,
          dishId: DISH_IDS.mixed,
          status: 'completed',
        },
        {
          id: MEDIA_IDS.mixedProcessing,
          dishId: DISH_IDS.mixed,
          status: 'processing',
        },
        {
          id: MEDIA_IDS.unarrivedFailed,
          dishId: DISH_IDS.unarrivedOnly,
          status: 'failed',
        },
        {
          id: MEDIA_IDS.completed,
          dishId: DISH_IDS.completedOnly,
          status: 'completed',
        },
      ];

      for (const m of media) {
        await prisma.prisma.dish_media.create({
          data: {
            id: m.id,
            dish_id: m.dishId,
            media_path: `path/${m.id}.jpg`,
            media_type: 'image',
            thumbnail_path: `path/${m.id}-thumb.jpg`,
            media_processing_status: m.status,
            thumbnail_processing_status: m.status,
          },
        });
        await prisma.prisma.dish_media_analysis_results.create({
          data: {
            dish_media_id: m.id,
            like_total: BigInt(LIKE_TOTALS[m.id]),
          },
        });
      }
    });

    afterAll(async () => {
      // FK の都合上、子→親の順に削除する
      await prisma.prisma.dish_media_analysis_results.deleteMany({
        where: { dish_media_id: { in: Object.values(MEDIA_IDS) } },
      });
      await prisma.prisma.dish_media.deleteMany({
        where: { id: { in: Object.values(MEDIA_IDS) } },
      });
      await prisma.prisma.dishes.deleteMany({
        where: { id: { in: Object.values(DISH_IDS) } },
      });
      await prisma.prisma.restaurants.deleteMany({
        where: { id: RESTAURANT_ID },
      });
      await prisma.prisma.dish_categories.deleteMany({
        where: { id: { in: Object.values(CATEGORY_IDS) } },
      });
      await prisma.onModuleDestroy();
      await moduleRef.close();
    });

    const fetchFeed = (params: { limit?: number; cursor?: string } = {}) =>
      prisma.withTransaction((tx) =>
        repository.findDishMediaByRestaurant(tx, RESTAURANT_ID, {
          limit: params.limit ?? 42,
          cursor: params.cursor,
        }),
      );

    it('excludes media whose media_processing_status is not completed', async () => {
      const { items } = await fetchFeed();
      const ids = items.map((i) => i.dish_media_id);

      expect(ids).not.toContain(MEDIA_IDS.mixedProcessing);
      expect(ids).not.toContain(MEDIA_IDS.unarrivedFailed);
      // like_count 降順（completed:5 → mixedCompleted:1）
      expect(ids).toEqual([MEDIA_IDS.completed, MEDIA_IDS.mixedCompleted]);
    });

    // #1257 除外は「皿の代表を選ぶ ROW_NUMBER より前」で効かないといけない。
    // 後段で弾く実装だと、未着メディアが代表に選ばれた mixed 皿が丸ごと欠落し、
    // completed な mixedCompleted まで巻き添えで消える。
    it('keeps the completed sibling of a dish whose most-liked media is unarrived', async () => {
      const { items } = await fetchFeed();
      const mixed = items.find((i) => i.dish_id === DISH_IDS.mixed);

      expect(mixed).toBeDefined();
      expect(mixed!.dish_media_id).toBe(MEDIA_IDS.mixedCompleted);
      expect(Number(mixed!.like_count)).toBe(
        LIKE_TOTALS[MEDIA_IDS.mixedCompleted],
      );
    });

    it('drops a dish entirely when all of its media are unarrived', async () => {
      const { items } = await fetchFeed();

      expect(items.some((i) => i.dish_id === DISH_IDS.unarrivedOnly)).toBe(
        false,
      );
    });

    // 逆担保: フィルタが過剰除外でないこと（completed に遷移すれば戻ってくる）
    it('returns a dish again once its media transitions to completed', async () => {
      await prisma.prisma.dish_media.update({
        where: { id: MEDIA_IDS.unarrivedFailed },
        data: { media_processing_status: 'completed' },
      });

      try {
        const { items } = await fetchFeed();
        const ids = items.map((i) => i.dish_media_id);

        expect(ids).toContain(MEDIA_IDS.unarrivedFailed);
        // like_count 降順（unarrivedFailed:50 → completed:5 → mixedCompleted:1）
        expect(ids).toEqual([
          MEDIA_IDS.unarrivedFailed,
          MEDIA_IDS.completed,
          MEDIA_IDS.mixedCompleted,
        ]);
      } finally {
        // 後続テスト・afterAll の前提を崩さないよう元に戻す
        await prisma.prisma.dish_media.update({
          where: { id: MEDIA_IDS.unarrivedFailed },
          data: { media_processing_status: 'failed' },
        });
      }
    });

    // #479 のページングが「除外後の件数」で動くこと。除外を後段でやると
    // limit+1 の先読みが未着行を数えてしまい、nextCursor の有無がずれる。
    it('paginates over the completed-only result set', async () => {
      const first = await fetchFeed({ limit: 1 });
      expect(first.items.map((i) => i.dish_media_id)).toEqual([
        MEDIA_IDS.completed,
      ]);
      expect(first.nextCursor).toBe(`5_${MEDIA_IDS.completed}`);

      const second = await fetchFeed({ limit: 1, cursor: first.nextCursor! });
      expect(second.items.map((i) => i.dish_media_id)).toEqual([
        MEDIA_IDS.mixedCompleted,
      ]);
      // 未着行は候補に入らないので、2 ページ目で打ち止めになる
      expect(second.nextCursor).toBeNull();
    });
  },
);
