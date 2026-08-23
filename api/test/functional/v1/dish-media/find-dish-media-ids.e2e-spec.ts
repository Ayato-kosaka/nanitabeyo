// api/test/functional/v1/dish-media/find-dish-media-ids.e2e-spec.ts
//
// #1257 findDishMediaIds() の候補集合から実体未着（media_processing_status !== 'completed'）の
// 行が除外されることを検証する。findDishMediaIds は PostGIS 依存の $queryRaw なので、Prisma を
// モックする既存 unit test スタイルでは SQL の意味を検証できない。そのため実 PostgreSQL
// (+ PostGIS) に対する統合テストとして書く。
//
// 実行には TEST_DATABASE_URL（PostGIS 拡張・infra/supabase/migrations 適用済みの使い捨て DB）が
// 必要。未設定の環境（通常の pnpm --filter api test / CI）ではこのファイル全体を skip する。

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

// logger.service.ts が起動時に env スキーマを検証するため、import 前に最小限の値を設定する
process.env.API_COMMIT_ID = 'test-commit';
process.env.API_NODE_ENV = 'test';
process.env.CORS_ORIGIN = '*';
process.env.DATABASE_URL = TEST_DATABASE_URL ?? 'postgresql://invalid/invalid';
process.env.DB_SCHEMA = 'dev';
process.env.SUPABASE_JWT_SECRET = 'secret';
process.env.GOOGLE_PLACE_API_KEY = 'key';
process.env.GCS_BUCKET_NAME = 'bucket';
process.env.GCS_BUCKET_PUBLIC_NAME = 'public-bucket';
process.env.GCS_STATIC_MASTER_DIR_PATH = 'path';
process.env.CLAUDE_API_KEY = 'key';
process.env.GOOGLE_API_KEY = 'key';
process.env.GOOGLE_SEARCH_ENGINE_ID = 'id';
process.env.GCP_PROJECT = 'proj';
process.env.TASKS_LOCATION = 'loc';
process.env.TRANSCODER_LOCATION = 'loc';
process.env.TRANSCODER_PUBSUB_TOPIC = 'topic';
process.env.CLOUD_RUN_URL = 'url';
process.env.TASKS_INVOKER_SA = 'sa';
process.env.PUBSUB_PUSH_SA = 'sa';
process.env.CDN_HOST = 'cdn.example.com';
process.env.CDN_KEY_NAME = 'key-name';
process.env.CDN_KEY_SECRET_B64 = Buffer.from('test-key').toString('base64');
process.env.CDN_PUBLIC_HOST = 'cdn-public.example.com';

import { Test, TestingModule } from '@nestjs/testing';
import { ClsModule } from 'nestjs-cls';
import { DishMediaRepository } from '../../../../src/v1/dish-media/dish-media.repository';
import { PrismaService } from '../../../../src/prisma/prisma.service';
import { AppLoggerService } from '../../../../src/core/logger/logger.service';

const maybeDescribe = TEST_DATABASE_URL ? describe : describe.skip;

maybeDescribe('DishMediaRepository.findDishMediaIds (functional, real DB)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let repository: DishMediaRepository;

  // 検索地点。半径はこの1点をピンポイントで囲む値にし、KNN/距離減衰の影響を無くす。
  const LOCATION = '35.68944,139.69167';
  const RADIUS = 500;
  const CATEGORY_ID = 'test-category-1257';
  const USER_ID = '00000000-0000-0000-0000-0000000000c1';

  // findDishMediaIds は同一バケット内で同一レストランにつき1件しか残さない
  // （unique_per_restaurant: PARTITION BY bucket, restaurant_id）。この制約と
  // 「status による除外」を混同しないよう、status ごとに別レストラン/別料理を用意する。
  const STATUSES = ['completed', 'processing', 'failed', 'idle'] as const;
  const RESTAURANT_IDS: Record<(typeof STATUSES)[number], string> = {
    completed: '00000000-0000-0000-0000-0000000000a1',
    processing: '00000000-0000-0000-0000-0000000000a2',
    failed: '00000000-0000-0000-0000-0000000000a3',
    idle: '00000000-0000-0000-0000-0000000000a4',
  };
  const DISH_IDS: Record<(typeof STATUSES)[number], string> = {
    completed: '00000000-0000-0000-0000-0000000000b1',
    processing: '00000000-0000-0000-0000-0000000000b2',
    failed: '00000000-0000-0000-0000-0000000000b3',
    idle: '00000000-0000-0000-0000-0000000000b4',
  };
  const MEDIA_IDS: Record<(typeof STATUSES)[number], string> = {
    completed: '00000000-0000-0000-0000-0000000000d1',
    processing: '00000000-0000-0000-0000-0000000000d2',
    failed: '00000000-0000-0000-0000-0000000000d3',
    idle: '00000000-0000-0000-0000-0000000000d4',
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ClsModule.forRoot({ global: true })],
      providers: [DishMediaRepository, PrismaService, AppLoggerService],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    await prisma.onModuleInit();
    repository = moduleRef.get(DishMediaRepository);

    await prisma.prisma.dish_categories.create({
      data: {
        id: CATEGORY_ID,
        label_en: 'Test Category #1257',
        labels: {},
        image_url: 'https://example.com/image.png',
        tags: [],
      },
    });

    // #1257 impr_total を積ませない（既定 0）ことで、全行が bucketed の 'new' 優先枠
    // （COALESCE(impr_total,0) < 100）に入るようにする。ここが本 Issue の再現条件そのもの。
    for (const status of STATUSES) {
      await prisma.prisma.restaurants.create({
        data: {
          id: RESTAURANT_IDS[status],
          google_place_id: `test-place-1257-${status}`,
          name: `Test Restaurant #1257 (${status})`,
          name_language_code: 'ja',
          latitude: 35.68944,
          longitude: 139.69167,
          image_url: 'https://example.com/image.png',
          address_components: {},
        },
      });
      await prisma.prisma.dishes.create({
        data: {
          id: DISH_IDS[status],
          restaurant_id: RESTAURANT_IDS[status],
          category_id: CATEGORY_ID,
          name: `Test Dish #1257 (${status})`,
        },
      });
      await prisma.prisma.dish_media.create({
        data: {
          id: MEDIA_IDS[status],
          dish_id: DISH_IDS[status],
          media_path: `path/${status}.jpg`,
          media_type: 'image',
          thumbnail_path: `path/${status}-thumb.jpg`,
          media_processing_status: status,
          thumbnail_processing_status: status,
        },
      });
    }
  });

  afterAll(async () => {
    // FK の都合上、子→親の順に削除する
    await prisma.prisma.dish_media.deleteMany({
      where: { id: { in: Object.values(MEDIA_IDS) } },
    });
    await prisma.prisma.dishes.deleteMany({
      where: { id: { in: Object.values(DISH_IDS) } },
    });
    await prisma.prisma.restaurants.deleteMany({
      where: { id: { in: Object.values(RESTAURANT_IDS) } },
    });
    await prisma.prisma.dish_categories.deleteMany({ where: { id: CATEGORY_ID } });
    await prisma.onModuleDestroy();
    await moduleRef.close();
  });

  const search = () =>
    prisma.withTransaction((tx) =>
      repository.findDishMediaIds(
        tx,
        { location: LOCATION, radius: RADIUS, categoryId: CATEGORY_ID, limit: 10 },
        USER_ID,
      ),
    );

  it('excludes rows whose media_processing_status is not completed, even in the new-priority bucket', async () => {
    const ids = await search();

    expect(ids).toContain(MEDIA_IDS.completed);
    expect(ids).not.toContain(MEDIA_IDS.processing);
    expect(ids).not.toContain(MEDIA_IDS.failed);
    expect(ids).not.toContain(MEDIA_IDS.idle);
    expect(ids).toEqual([MEDIA_IDS.completed]);
  });

  // 逆担保: フィルタが過剰除外でないこと（completed に遷移すれば戻ってくる）
  it('returns a row again once it transitions to completed', async () => {
    await prisma.prisma.dish_media.update({
      where: { id: MEDIA_IDS.processing },
      data: { media_processing_status: 'completed' },
    });

    try {
      const ids = await search();
      expect(ids).toContain(MEDIA_IDS.processing);
    } finally {
      // 後続テスト・afterAll の前提を崩さないよう元に戻す
      await prisma.prisma.dish_media.update({
        where: { id: MEDIA_IDS.processing },
        data: { media_processing_status: 'processing' },
      });
    }
  });
});
