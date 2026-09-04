// api/src/v1/dish-media-imports/dish-media-imports.service.spec.ts
//
// #1399 `POST /v1/dish-media/imports/resolve` の縮退の作りを固定する。
//
// **外部 HTTP は `FakeSafeFetchTransport` に差し替えてある。**
// SafeFetchService / SnsOembedService は本物を使うので、ガードと縮退の判断は本番と同じ経路を通る。
//
// ここで固定していること:
//  - 短縮 URL が展開されて provider が確定する
//  - リダイレクトがプライベート IP へ向いたら «候補ゼロ＋理由» になる（例外を投げっぱなしにしない）
//  - リダイレクト上限超過も同じく «候補ゼロ＋理由»
//  - oEmbed が 4xx / 5xx / タイムアウトでも «候補ゼロ＋理由»
//  - Instagram は埋め込み SSR から取り、SSR でなければ縮退して返る
//  - lat/lng/radius が渡されたときだけ店舗候補を探す
//  - **DB へ 1 行も書かない**

jest.mock('src/core/config/env', () => ({
  env: {
    API_COMMIT_ID: 'test',
    API_NODE_ENV: 'test',
  },
}));

import type { ClsService } from 'nestjs-cls';
import { AppLoggerService } from '../../core/logger/logger.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SafeFetchService } from '../../core/safe-fetch/safe-fetch.service';
import { StorageService } from '../../core/storage/storage.service';
import { CloudTasksService } from '../../core/cloud-tasks/cloud-tasks.service';
import { FakeSafeFetchTransport } from '../../core/safe-fetch/testing/fake-safe-fetch.transport';
import { DishCategoriesRepository } from '../dish-categories/dish-categories.repository';
import { RestaurantsRepository } from '../restaurants/restaurants.repository';
import { DishCategoryVariantDictionaryService } from './dish-category-variant-dictionary.service';
import { DishMediaImportsService } from './dish-media-imports.service';
import { SnsOembedService } from './sns-oembed.service';
import { buildDishCategoryVariantIndex } from '../../../../shared/utils/dishCategoryMatch';

const TIKTOK_OEMBED = 'https://www.tiktok.com/oembed';
const YOUTUBE_OEMBED = 'https://www.youtube.com/oembed';

const TIKTOK_SHORTLINK = 'https://vm.tiktok.com/ZMhqRBmXW/';
const TIKTOK_VIDEO_URL =
  'https://www.tiktok.com/@scout2015/video/6718335390845095173';

/** 照合辞書。実 DB を読まずに済ませるための最小セット */
const DICTIONARY_INDEX = buildDishCategoryVariantIndex([
  { dishCategoryId: 'Q1', surfaceForm: 'ラーメン', source: 'wikidata-label' },
  {
    dishCategoryId: 'Q2',
    surfaceForm: '味噌ラーメン',
    source: 'wikidata-label',
  },
  { dishCategoryId: 'Q3', surfaceForm: 'sushi', source: 'canonical-label-en' },
]);

/** `restaurants` の 1 行（照合と表示に使う列だけ） */
function restaurantRow(id: string, name: string) {
  return {
    restaurant: {
      id,
      google_place_id: `place_${id}`,
      name,
      name_language_code: 'ja',
      latitude: 35.65,
      longitude: 139.7,
      image_url: '',
      image_path: null,
      address_components: null,
      plus_code: null,
      created_at: new Date('2026-01-01T00:00:00Z'),
    },
    meta: { reviewCount: 0, averageRating: 0, totalCents: 0, maxEndDate: null },
  };
}

function createLogger(): AppLoggerService {
  return {
    verbose: jest.fn(),
    debug: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    externalApi: jest.fn().mockResolvedValue(undefined),
  } as unknown as AppLoggerService;
}

type Harness = {
  service: DishMediaImportsService;
  transport: FakeSafeFetchTransport;
  searchNearbyRestaurants: jest.Mock;
  findDishCategoriesByIds: jest.Mock;
  withTransaction: jest.Mock;
  uploadFile: jest.Mock;
  enqueueResizeImage: jest.Mock;
};

function createHarness(options?: {
  restaurants?: ReturnType<typeof restaurantRow>[];
}): Harness {
  const transport = new FakeSafeFetchTransport();
  const logger = createLogger();
  const safeFetch = new SafeFetchService(transport, logger);
  const oembed = new SnsOembedService(safeFetch, logger);

  const dictionary = {
    getIndex: jest.fn().mockResolvedValue(DICTIONARY_INDEX),
  } as unknown as DishCategoryVariantDictionaryService;

  const findDishCategoriesByIds = jest.fn().mockResolvedValue([
    {
      id: 'Q1',
      label_en: 'ramen',
      labels: { ja: 'ラーメン', en: 'ramen' },
      image_url: 'https://cdn/ramen.jpg',
    },
    {
      id: 'Q2',
      label_en: 'miso ramen',
      labels: { ja: '味噌ラーメン' },
      image_url: 'https://cdn/miso.jpg',
    },
  ]);
  const dishCategoriesRepo = {
    findDishCategoriesByIds,
  } as unknown as DishCategoriesRepository;

  const searchNearbyRestaurants = jest
    .fn()
    .mockResolvedValue(options?.restaurants ?? []);
  const restaurantsRepo = {
    searchNearbyRestaurants,
  } as unknown as RestaurantsRepository;

  const withTransaction = jest.fn((callback: (tx: unknown) => unknown) =>
    callback({}),
  );
  const prisma = { withTransaction } as unknown as PrismaService;

  // #1375 4 巡目: サムネイル複製（create 経路のみが使う）
  const uploadFile = jest.fn().mockResolvedValue({
    path: 'test/dish_media/imported-thumbnail/123_media-1.jpg',
    signedUrl: 'https://signed/imported.jpg',
  });
  const storage = { uploadFile } as unknown as StorageService;
  const enqueueResizeImage = jest.fn().mockResolvedValue(undefined);
  const cloudTasks = { enqueueResizeImage } as unknown as CloudTasksService;

  const service = new DishMediaImportsService(
    safeFetch,
    oembed,
    dictionary,
    dishCategoriesRepo,
    restaurantsRepo,
    prisma,
    storage,
    cloudTasks,
    logger,
    // #1399 保存経路（create）が created_version に使う。resolve は触らない
    { get: () => 'test' } as unknown as ClsService,
  );

  return {
    service,
    transport,
    searchNearbyRestaurants,
    findDishCategoriesByIds,
    withTransaction,
    uploadFile,
    enqueueResizeImage,
  };
}

/** TikTok の oEmbed（実測どおり `title` にキャプション＋ハッシュタグが入る形） */
function tiktokOembedBody(title: string): string {
  return JSON.stringify({
    title,
    author_name: 'Scout, Suki & Stella',
    author_url: 'https://www.tiktok.com/@scout2015',
    thumbnail_url:
      'https://p16-common-sign.tiktokcdn-us.com/x.jpeg?x-expires=1787328000',
    // **`html` は返ってくるが、こちらは読まないし返さない**
    html: '<blockquote class="tiktok-embed"><script src="https://www.tiktok.com/embed.js"></script>',
  });
}

describe('DishMediaImportsService — 対応外の URL', () => {
  it('null を返さず «候補ゼロ＋理由» を返す', async () => {
    const { service } = createHarness();

    const result = await service.resolve({
      url: 'https://x.com/foo/status/1234567890',
    });

    expect(result).not.toBeNull();
    expect(result.status).toBe('unsupported');
    expect(result.reason).toBe('unsupported_url');
    expect(result.candidates.dishCategories).toEqual([]);
    expect(result.candidates.restaurants).toEqual([]);
    expect(result.source.provider).toBeNull();
  });

  it('URL ですらない文字列でも同じ形で返す', async () => {
    const { service } = createHarness();

    const result = await service.resolve({ url: 'こんど食べたい' });

    expect(result.status).toBe('unsupported');
    expect(result.reason).toBe('unsupported_url');
  });
});

describe('DishMediaImportsService — 短縮 URL の展開', () => {
  it('展開して provider と external_content_id が確定する', async () => {
    const { service, transport } = createHarness();

    transport
      .route(TIKTOK_SHORTLINK, {
        status: 302,
        headers: {
          location: `${TIKTOK_VIDEO_URL}?_r=1&share_item_id=6718335390845095173`,
        },
      })
      .route(TIKTOK_OEMBED, {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: tiktokOembedBody('今日の一杯 #ラーメン'),
      });

    const result = await service.resolve({ url: TIKTOK_SHORTLINK });

    expect(result.status).toBe('ok');
    expect(result.source.provider).toBe('tiktok');
    expect(result.source.externalContentId).toBe('6718335390845095173');
    // トラッキングパラメータは canonical から落ちている
    expect(result.source.canonicalUrl).toBe(TIKTOK_VIDEO_URL);
    expect(result.source.expandedFromShortlink).toBe(true);
  });

  it('共有テキストに混ざった短縮 URL も拾う', async () => {
    const { service, transport } = createHarness();

    transport
      .route(TIKTOK_SHORTLINK, {
        status: 302,
        headers: { location: TIKTOK_VIDEO_URL },
      })
      .route(TIKTOK_OEMBED, {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: tiktokOembedBody('#ラーメン'),
      });

    const result = await service.resolve({
      url: `この店やばい ${TIKTOK_SHORTLINK} 見て。`,
    });

    expect(result.source.provider).toBe('tiktok');
    expect(result.source.expandedFromShortlink).toBe(true);
  });

  it('リダイレクトがプライベート IP へ向いたら «候補ゼロ＋理由» を返す（例外を投げない）', async () => {
    const { service, transport } = createHarness();

    // vm.tiktok.com → www.tiktok.com/t/{code}（まだ短縮）→ さらに追おうとする、という形。
    // 解決先が投稿 URL だと `stopAt` で打ち切ってしまい、2 ホップ目の名前解決まで届かない
    transport
      .route(TIKTOK_SHORTLINK, {
        status: 302,
        headers: { location: 'https://www.tiktok.com/t/ZMabcdef/' },
      })
      // ホスト名は取り込み対象なのに、A レコードがループバックを指している（DNS rebinding）
      .resolveHost('www.tiktok.com', [{ address: '127.0.0.1', family: 4 }])
      .route('https://www.tiktok.com/t/ZMabcdef/', {
        status: 302,
        headers: { location: TIKTOK_VIDEO_URL },
      });

    const result = await service.resolve({ url: TIKTOK_SHORTLINK });

    expect(result.status).toBe('unsupported');
    expect(result.reason).toBe('shortlink_expansion_failed');
    expect(result.candidates.dishCategories).toEqual([]);

    /*
    **危険なホストへは 1 度も接続していない**（検証は接続前に行われる）。

    ⚠️ ここで «リクエストが 1 本だけ» を要求してはいけない。#1641 で、短縮 URL は
    まず公式 oEmbed（`https://www.tiktok.com/oembed?url=…`）で解決を試み、
    失敗したときだけリダイレクト追跡へ落ちるようになった。

    oEmbed は **固定エンドポイント**で、ユーザーの URL はクエリの値としてしか乗らない。
    この経路に SSRF は原理的に成立しないので、名前解決の検証も行わない
    （`SafeFetchService.fetchJson` の doc）。守るべきなのは
    **リダイレクト先（＝ 攻撃者が選べる URL）へ接続しないこと**である。
    */
    const requestedPaths = transport.requests.map((request) => {
      const url = new URL(request.url);
      return `${url.hostname}${url.pathname}`;
    });
    // DNS が 127.0.0.1 を指したリダイレクト先は、一度も取りに行っていない
    expect(requestedPaths).not.toContain('www.tiktok.com/t/ZMabcdef/');
    // 追跡経路として叩いたのは短縮 URL 自身だけ
    const shortlinkPath = (() => {
      const url = new URL(TIKTOK_SHORTLINK);
      return `${url.hostname}${url.pathname}`;
    })();
    expect(requestedPaths).toContain(shortlinkPath);
  });

  it('リダイレクト上限を超えたら «候補ゼロ＋理由» を返す', async () => {
    const { service, transport } = createHarness();

    // 短縮 URL 同士を延々とたらい回しにする
    transport.route(TIKTOK_SHORTLINK, {
      status: 302,
      headers: { location: 'https://vm.tiktok.com/AAAAA1/' },
    });
    for (let i = 1; i <= 8; i += 1) {
      transport.route(`https://vm.tiktok.com/AAAAA${i}/`, {
        status: 302,
        headers: { location: `https://vm.tiktok.com/AAAAA${i + 1}/` },
      });
    }

    const result = await service.resolve({ url: TIKTOK_SHORTLINK });

    expect(result.status).toBe('unsupported');
    expect(result.reason).toBe('shortlink_expansion_failed');
  });

  it('展開先が取り込み対象の形でなければ shortlink_target_unsupported', async () => {
    const { service, transport } = createHarness();

    transport
      .route(TIKTOK_SHORTLINK, {
        status: 302,
        headers: { location: 'https://www.tiktok.com/t/ZMabcdef/' },
      })
      // 短縮 → 短縮 → ログインページ相当（parseSnsUrl が null を返す形）
      .route('https://www.tiktok.com/t/ZMabcdef/', { status: 200 });

    const result = await service.resolve({ url: TIKTOK_SHORTLINK });

    expect(result.status).toBe('unsupported');
    expect(result.reason).toBe('shortlink_target_unsupported');
  });

  it('展開でタイムアウトしても «候補ゼロ＋理由» を返す', async () => {
    const { service, transport } = createHarness();

    transport.route(TIKTOK_SHORTLINK, { status: 200, hangBeforeHeaders: true });

    // 既定の 5 秒を待たせないよう、この 1 件だけ短いタイムアウトで確かめる。
    // 実運用の値は SAFE_FETCH_DEFAULTS 側のテストで固定してある
    jest.useFakeTimers();
    const promise = service.resolve({ url: TIKTOK_SHORTLINK });
    await jest.advanceTimersByTimeAsync(6_000);
    const result = await promise;
    jest.useRealTimers();

    expect(result.status).toBe('unsupported');
    expect(result.reason).toBe('shortlink_expansion_failed');
  });
});

describe('DishMediaImportsService — oEmbed の失敗', () => {
  it('404 は unavailable（相手が消えた）', async () => {
    const { service, transport } = createHarness();

    transport.route(YOUTUBE_OEMBED, {
      status: 404,
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });

    const result = await service.resolve({
      url: 'https://www.youtube.com/shorts/SXHMnicI6Pg',
    });

    expect(result.status).toBe('unavailable');
    expect(result.reason).toBe('metadata_content_unavailable');
    expect(result.candidates.dishCategories).toEqual([]);
    // provider は確定しているので埋め込みに要る情報は返す
    expect(result.source.provider).toBe('youtube');
    expect(result.source.canonicalUrl).toBe(
      'https://www.youtube.com/shorts/SXHMnicI6Pg',
    );
  });

  it('400 も unavailable（YouTube は存在しない ID に 400 を返す）', async () => {
    const { service, transport } = createHarness();

    transport.route(YOUTUBE_OEMBED, {
      status: 400,
      headers: { 'content-type': 'text/html' },
      body: 'Bad Request',
    });

    const result = await service.resolve({
      url: 'https://www.youtube.com/shorts/SXHMnicI6Pg',
    });

    expect(result.status).toBe('unavailable');
  });

  it('5xx は unknown（こちらの都合。取り込みは続行させてよい）', async () => {
    const { service, transport } = createHarness();

    transport.route(TIKTOK_OEMBED, {
      status: 503,
      headers: { 'content-type': 'text/html' },
      body: 'unavailable',
    });

    const result = await service.resolve({ url: TIKTOK_VIDEO_URL });

    expect(result.status).toBe('unknown');
    expect(result.reason).toBe('metadata_fetch_failed');
    expect(result.candidates.dishCategories).toEqual([]);
    expect(result.source.provider).toBe('tiktok');
  });

  it('タイムアウトでも例外を投げず unknown へ縮退する', async () => {
    const { service, transport } = createHarness();

    transport.route(TIKTOK_OEMBED, { status: 200, hangBeforeHeaders: true });

    jest.useFakeTimers();
    const promise = service.resolve({ url: TIKTOK_VIDEO_URL });
    await jest.advanceTimersByTimeAsync(6_000);
    const result = await promise;
    jest.useRealTimers();

    expect(result.status).toBe('unknown');
    expect(result.reason).toBe('metadata_fetch_failed');
  });

  it('壊れた JSON でも unknown へ縮退する', async () => {
    const { service, transport } = createHarness();

    transport.route(TIKTOK_OEMBED, {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: '{"title":',
    });

    const result = await service.resolve({ url: TIKTOK_VIDEO_URL });

    expect(result.status).toBe('unknown');
    expect(result.reason).toBe('metadata_fetch_failed');
  });
});

describe('DishMediaImportsService — Instagram（埋め込み SSR。#1375 3 巡目）', () => {
  const INSTAGRAM_EMBED_URL =
    'https://www.instagram.com/p/DAbcDefGhIj/embed/captioned/';

  /** 実物（/reel/Dap33wsTO4p/ を 2026-08-23 に実取得）を最小化した SSR HTML */
  const SSR_EMBED_HTML = [
    '<!DOCTYPE html><html><body>',
    '<img class="EmbeddedMediaImage" src="https://scontent-lga3-3.cdninstagram.com/v/t51/744.jpg?oe=6A9007E8" />',
    '<a class="UsernameText">umaguru.tokyo</a>',
    '<div class="Caption">',
    'umaguru.tokyo<br />濃口醤油とラードを効かせた八王子<b>ラーメン</b>！',
    '【中華そば専門店 八王子ラーメンよしだ】<br />#ラーメン',
    '</div>',
    '</body></html>',
  ].join('');

  /** ブラウザ UA へ返る JS シェル（SSR の目印が 1 つも無い） */
  const JS_SHELL_HTML =
    '<!DOCTYPE html><html><head><meta charset="utf-8" /></head><body><div id="splash"></div></body></html>';

  it('SSR が返れば caption から候補が出て、サムネイルと投稿者も載る', async () => {
    const { service, transport } = createHarness();
    transport.route(INSTAGRAM_EMBED_URL, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: SSR_EMBED_HTML,
    });

    const result = await service.resolve({
      url: 'https://www.instagram.com/reel/DAbcDefGhIj/',
    });

    expect(result.status).toBe('ok');
    expect(result.reason).toBe('resolved');
    expect(result.source.provider).toBe('instagram');
    // キャプション本文が extractedText として流れ、辞書照合で候補が出る
    expect(
      result.candidates.dishCategories.map((c) => c.dishCategoryId),
    ).toContain('Q1');
    expect(result.metadata.thumbnailUrl).toContain('scontent');
    expect(result.metadata.authorName).toBe('umaguru.tokyo');
    // タグ・<br> は落ちて素のテキストになっている
    expect(result.metadata.title).toContain('八王子ラーメンよしだ');
    expect(result.metadata.title).not.toContain('<b>');
  });

  it('#1273 caption を渡すと IG を取りに行かず、そのテキストから候補が出る（大量並列 resolve）', async () => {
    const { service } = createHarness();
    // INSTAGRAM_EMBED_URL は **routing しない**。取りに行けば必ず失敗して unknown になる。
    // caption 直渡しで ok + 候補が返れば、IG を叩かずに済んでいる証拠。
    const result = await service.resolve({
      url: 'https://www.instagram.com/reel/DAbcDefGhIj/',
      caption:
        '濃口醤油とラードを効かせた八王子ラーメン！【中華そば専門店 八王子ラーメンよしだ】#ラーメン',
      authorName: 'umaguru.tokyo',
    });

    expect(result.status).toBe('ok');
    expect(result.reason).toBe('resolved');
    expect(result.source.provider).toBe('instagram');
    expect(
      result.candidates.dishCategories.map((c) => c.dishCategoryId),
    ).toContain('Q1');
    expect(result.metadata.title).toContain('八王子ラーメンよしだ');
    expect(result.metadata.authorName).toBe('umaguru.tokyo');
  });

  it('caption が空文字なら従来どおり IG を取りに行く（縮退の分岐は変えない）', async () => {
    const { service, transport } = createHarness();
    transport.route(INSTAGRAM_EMBED_URL, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: SSR_EMBED_HTML,
    });

    const result = await service.resolve({
      url: 'https://www.instagram.com/reel/DAbcDefGhIj/',
      caption: '   ',
    });

    expect(result.status).toBe('ok');
    expect(result.metadata.authorName).toBe('umaguru.tokyo');
  });

  it('JS シェルが返ったら «取れなかった» へ縮退する（保存までは進める）', async () => {
    const { service, transport } = createHarness();
    transport.route(INSTAGRAM_EMBED_URL, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: JS_SHELL_HTML,
    });

    const result = await service.resolve({
      url: 'https://www.instagram.com/reel/DAbcDefGhIj/',
    });

    expect(result.status).toBe('unknown');
    expect(result.reason).toBe('metadata_fetch_failed');
    expect(result.source.canonicalUrl).toBe(
      'https://www.instagram.com/reel/DAbcDefGhIj/',
    );
  });

  it('embed が 404 なら unavailable（相手が消えた）', async () => {
    const { service, transport } = createHarness();
    transport.route(INSTAGRAM_EMBED_URL, { status: 404 });

    const result = await service.resolve({
      url: 'https://www.instagram.com/reel/DAbcDefGhIj/',
    });

    expect(result.status).toBe('unavailable');
  });

  it('カルーセルの img_index を落とさない', async () => {
    const { service, transport } = createHarness();
    transport.route(INSTAGRAM_EMBED_URL, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: SSR_EMBED_HTML,
    });

    const result = await service.resolve({
      url: 'https://www.instagram.com/p/DAbcDefGhIj/?img_index=2',
    });

    expect(result.source.mediaIndex).toBe(2);
  });
});

describe('DishMediaImportsService — 料理カテゴリ候補', () => {
  it('ハッシュタグから候補が出る', async () => {
    const { service, transport, findDishCategoriesByIds } = createHarness();

    transport.route(TIKTOK_OEMBED, {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: tiktokOembedBody('今日のランチ #ラーメン'),
    });

    const result = await service.resolve({ url: TIKTOK_VIDEO_URL });

    expect(result.status).toBe('ok');
    expect(result.reason).toBe('resolved');
    expect(result.candidates.dishCategories[0]).toMatchObject({
      dishCategoryId: 'Q1',
      labelEn: 'ramen',
      rank: 1,
    });
    expect(result.candidates.dishCategories[0].confidence).toBeGreaterThan(0.8);
    expect(findDishCategoriesByIds).toHaveBeenCalledWith(['Q1']);
  });

  it('辞書に当たらなければ候補ゼロで返る（エラーにしない）', async () => {
    const { service, transport } = createHarness();

    transport.route(TIKTOK_OEMBED, {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: tiktokOembedBody('きれいな夕日'),
    });

    const result = await service.resolve({ url: TIKTOK_VIDEO_URL });

    expect(result.status).toBe('ok');
    expect(result.candidates.dishCategories).toEqual([]);
    expect(result.prefill.dishCategoryId).toBeNull();
  });

  it('title が空なら metadata_empty', async () => {
    const { service, transport } = createHarness();

    transport.route(TIKTOK_OEMBED, {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '', author_name: '' }),
    });

    const result = await service.resolve({ url: TIKTOK_VIDEO_URL });

    expect(result.status).toBe('ok');
    expect(result.reason).toBe('metadata_empty');
    expect(result.metadata.extractedTexts).toEqual([]);
  });

  it('oEmbed の html をレスポンスへ載せない', async () => {
    const { service, transport } = createHarness();

    transport.route(TIKTOK_OEMBED, {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: tiktokOembedBody('#ラーメン'),
    });

    const result = await service.resolve({ url: TIKTOK_VIDEO_URL });

    expect(JSON.stringify(result)).not.toContain('tiktok-embed');
    expect(JSON.stringify(result)).not.toContain('<script');
  });
});

describe('DishMediaImportsService — 店舗候補', () => {
  const CAPTION = '一蘭 渋谷店 で食べた #ラーメン';

  function routeTikTok(transport: FakeSafeFetchTransport) {
    transport.route(TIKTOK_OEMBED, {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: tiktokOembedBody(CAPTION),
    });
  }

  it('lat/lng/radius が渡されなければ探さない（候補は空・エラーではない）', async () => {
    const harness = createHarness({
      restaurants: [restaurantRow('r1', '一蘭 渋谷店')],
    });
    routeTikTok(harness.transport);

    const result = await harness.service.resolve({ url: TIKTOK_VIDEO_URL });

    expect(result.candidates.restaurants).toEqual([]);
    expect(result.restaurantSearch).toMatchObject({
      performed: false,
      reason: 'area_not_provided',
    });
    expect(harness.searchNearbyRestaurants).not.toHaveBeenCalled();
  });

  // #1841 «キャプションに店名が書いてあるのに候補に出ない» の回帰。
  // それまで 📍店名 は候補セット内の加点にしか使っておらず、候補は地理でしか作っていなかった。
  // 位置情報が無い（＝地理の候補セットが作れない）ときこそ、名指しが唯一の手掛かりになる。
  it('#1841 位置情報が無くても、📍店名 があれば店名で引いて候補を返す', async () => {
    const harness = createHarness({
      restaurants: [restaurantRow('r1', '中華そば よしだ')],
    });
    harness.transport.route(TIKTOK_OEMBED, {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: tiktokOembedBody('📍中華そば よしだ\n美味しかった #ラーメン'),
    });

    const result = await harness.service.resolve({ url: TIKTOK_VIDEO_URL });

    expect(result.restaurantSearch).toMatchObject({ performed: true });
    expect(result.candidates.restaurants[0]).toMatchObject({
      restaurantId: 'r1',
    });
    // 店名は «名指し» なので、現在地に依存しない全国の半径で引く
    expect(harness.searchNearbyRestaurants).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ q: '中華そば よしだ', radius: 2_000_000 }),
    );
  });

  it('#1841 現在地から遠い店でも、📍店名 があれば店名の引きが現在地の半径に縛られない', async () => {
    const harness = createHarness({
      restaurants: [restaurantRow('r1', '中華そば よしだ')],
    });
    harness.transport.route(TIKTOK_OEMBED, {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: tiktokOembedBody('📍中華そば よしだ\n美味しかった #ラーメン'),
    });

    await harness.service.resolve({
      url: TIKTOK_VIDEO_URL,
      lat: 35.658,
      lng: 139.701,
      radius: 5000,
    });

    const calls = harness.searchNearbyRestaurants.mock.calls as [
      unknown,
      { q?: string; radius: number },
    ][];
    const byName = calls.filter((call) => call[1].q === '中華そば よしだ');
    expect(byName).toHaveLength(1);
    // 現在地の 5km ではなく全国で引いている（＝ 5km 圏外の店にも届く）
    expect(byName[0][1].radius).toBe(2_000_000);
  });

  it('#1841 📍行が無ければ店名では引かない（従来どおり地理だけ）', async () => {
    const harness = createHarness({
      restaurants: [restaurantRow('r1', '一蘭 渋谷店')],
    });
    routeTikTok(harness.transport);

    await harness.service.resolve({
      url: TIKTOK_VIDEO_URL,
      lat: 35.658,
      lng: 139.701,
      radius: 5000,
    });

    // author_name の引き（#1375）は従来どおり出る。増えていないことを見たいので、
    // 全国半径（＝📍店名の引き）が 1 本も無いことを確かめる。
    const calls = harness.searchNearbyRestaurants.mock.calls as [
      unknown,
      { q?: string; radius: number },
    ][];
    expect(calls.some((call) => call[1].radius === 2_000_000)).toBe(false);
    expect(calls.map((call) => call[1].q)).toEqual([
      undefined,
      'Scout, Suki & Stella',
    ]);
  });

  it('lat/lng/radius が揃ったときだけ探して順位付けする', async () => {
    const harness = createHarness({
      restaurants: [
        restaurantRow('r1', '一蘭 渋谷店'),
        restaurantRow('r2', '無関係な店'),
      ],
    });
    routeTikTok(harness.transport);

    const result = await harness.service.resolve({
      url: TIKTOK_VIDEO_URL,
      lat: 35.658,
      lng: 139.701,
      radius: 3000,
    });

    expect(result.restaurantSearch).toMatchObject({
      performed: true,
      reason: 'searched',
    });
    expect(result.candidates.restaurants[0]).toMatchObject({
      restaurantId: 'r1',
      name: '一蘭 渋谷店',
      googlePlaceId: 'place_r1',
      rank: 1,
    });
    expect(
      result.candidates.restaurants.some(
        (candidate) => candidate.restaurantId === 'r2',
      ),
    ).toBe(false);
  });

  it('一部だけ渡されたら area_incomplete として区別する', async () => {
    const harness = createHarness();
    routeTikTok(harness.transport);

    const result = await harness.service.resolve({
      url: TIKTOK_VIDEO_URL,
      lat: 35.658,
    });

    expect(result.restaurantSearch.reason).toBe('area_incomplete');
    expect(harness.searchNearbyRestaurants).not.toHaveBeenCalled();
  });

  it('author_name を店名検索の q にも投げる（公式アカウントのケース）', async () => {
    const harness = createHarness({
      restaurants: [restaurantRow('r1', '一蘭 渋谷店')],
    });
    routeTikTok(harness.transport);

    await harness.service.resolve({
      url: TIKTOK_VIDEO_URL,
      lat: 35.658,
      lng: 139.701,
      radius: 3000,
    });

    const calls = harness.searchNearbyRestaurants.mock.calls as [
      unknown,
      { q?: string },
    ][];
    const queries = calls.map((call) => call[1].q);
    // 1 本目はエリア一覧（q なし）、2 本目が author_name
    expect(queries).toContain(undefined);
    expect(queries).toContain('Scout, Suki & Stella');
  });

  // #1375 4 巡目: 現在地が店から離れていても、キャプションの住所から店へ辿れる
  describe('キャプションの住所から探す（国土地理院ジオコーディング）', () => {
    const GSI_ENDPOINT =
      'https://msearch.gsi.go.jp/address-search/AddressSearch';
    const CAPTION_WITH_ADDRESS = [
      '中華そば専門店 八王子ラーメンよしだ の一杯',
      '📍 住所：東京都八王子市東町1-3',
      '#ラーメン',
    ].join('\n');

    function routeTikTokWithAddress(transport: FakeSafeFetchTransport) {
      transport.route(TIKTOK_OEMBED, {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: tiktokOembedBody(CAPTION_WITH_ADDRESS),
      });
    }

    function routeGsi(transport: FakeSafeFetchTransport) {
      transport.route(GSI_ENDPOINT, {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify([
          {
            geometry: { coordinates: [139.341049, 35.657646], type: 'Point' },
            type: 'Feature',
            properties: {
              addressCode: '',
              title: '東京都八王子市東町１番３号',
            },
          },
        ]),
      });
    }

    it('現在地が無くても、住所の地点で店舗を照合する', async () => {
      const harness = createHarness({
        restaurants: [
          restaurantRow('r1', '中華そば専門店 八王子ラーメンよしだ'),
        ],
      });
      routeTikTokWithAddress(harness.transport);
      routeGsi(harness.transport);

      const result = await harness.service.resolve({ url: TIKTOK_VIDEO_URL });

      expect(result.restaurantSearch).toMatchObject({
        performed: true,
        reason: 'searched',
      });
      expect(result.candidates.restaurants[0]).toMatchObject({
        restaurantId: 'r1',
        name: '中華そば専門店 八王子ラーメンよしだ',
      });
      // 住所の地点（GeoJSON の [経度, 緯度] を読み替えた値）+ 住所用の狭い半径で引く
      expect(harness.searchNearbyRestaurants).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          lat: 35.657646,
          lng: 139.341049,
          radius: 1000,
        }),
      );
    });

    it('現在地と住所の両方があれば、両方の地点で引く', async () => {
      const harness = createHarness({
        restaurants: [
          restaurantRow('r1', '中華そば専門店 八王子ラーメンよしだ'),
        ],
      });
      routeTikTokWithAddress(harness.transport);
      routeGsi(harness.transport);

      await harness.service.resolve({
        url: TIKTOK_VIDEO_URL,
        lat: 35.658,
        lng: 139.701,
        radius: 3000,
      });

      const areas = (
        harness.searchNearbyRestaurants.mock.calls as [
          unknown,
          { lat: number; lng: number; q?: string },
        ][]
      )
        .filter((call) => call[1].q === undefined)
        .map((call) => call[1].lat);
      expect(areas).toContain(35.658); // 現在地
      expect(areas).toContain(35.657646); // キャプション住所
    });

    it('ジオコーディングが落ちても resolve は失敗しない（従来の縮退のまま）', async () => {
      // GSI をルートしない = 接続失敗。住所ありでも従来どおり «探さなかった» へ縮退する
      const harness = createHarness({
        restaurants: [
          restaurantRow('r1', '中華そば専門店 八王子ラーメンよしだ'),
        ],
      });
      routeTikTokWithAddress(harness.transport);

      const result = await harness.service.resolve({ url: TIKTOK_VIDEO_URL });

      expect(result.status).toBe('ok');
      expect(result.restaurantSearch).toMatchObject({
        performed: false,
        reason: 'area_not_provided',
      });
    });

    it('住所が無いキャプションでは国土地理院を叩かない', async () => {
      const harness = createHarness();
      routeTikTok(harness.transport);

      await harness.service.resolve({ url: TIKTOK_VIDEO_URL });

      const gsiCalls = harness.transport.requests.filter((request) =>
        request.url.includes('msearch.gsi.go.jp'),
      );
      expect(gsiCalls).toHaveLength(0);
    });
  });

  it('メタデータが取れなかったときは店舗検索も行わない', async () => {
    const harness = createHarness({
      restaurants: [restaurantRow('r1', '一蘭 渋谷店')],
    });

    const result = await harness.service.resolve({
      url: 'https://www.instagram.com/reel/DAbcDefGhIj/',
      lat: 35.658,
      lng: 139.701,
      radius: 3000,
    });

    expect(result.restaurantSearch).toMatchObject({
      performed: false,
      reason: 'no_extracted_text',
    });
    expect(harness.searchNearbyRestaurants).not.toHaveBeenCalled();
  });
});

describe('DishMediaImportsService — 書き込みをしない', () => {
  it('読み取り以外のリポジトリ操作を呼ばない', async () => {
    const harness = createHarness({
      restaurants: [restaurantRow('r1', '一蘭 渋谷店')],
    });
    harness.transport.route(TIKTOK_OEMBED, {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: tiktokOembedBody('一蘭 渋谷店 #ラーメン'),
    });

    await harness.service.resolve({
      url: TIKTOK_VIDEO_URL,
      lat: 35.658,
      lng: 139.701,
      radius: 3000,
    });

    // モックに生やしてあるのは読み取りメソッドだけ。
    // 書き込みを足した瞬間 `undefined is not a function` でここが落ちる
    expect(harness.searchNearbyRestaurants).toHaveBeenCalled();
    expect(harness.findDishCategoriesByIds).toHaveBeenCalled();
    // トランザクションは張るが、中でやるのは SELECT だけ
    expect(harness.withTransaction).toHaveBeenCalledTimes(1);
  });
});

/* -------------------------------------------------------------------------- */
/*  #1399 保存（POST /v1/dish-media/imports）                                  */
/* -------------------------------------------------------------------------- */

/**
 * 保存経路が触るテーブルだけを持つ最小の `tx`。
 *
 * ここで固定したいのは «どのテーブルに何を書くか» であって Prisma の挙動ではないので、
 * 実 DB は使わない。呼ばれた引数を記録して、次の 3 点を検証する。
 *
 *  1. `dish_media.user_id` は NULL のまま（投稿者はアプリのユーザーではない）
 *  2. 同じ SNS 投稿が同じ料理に既に在れば dish_media を作り直さない（冪等）
 *  3. どちらの場合も `reactions(save)` は呼び出したユーザーぶんを用意する
 */
function createSaveTx(options?: {
  existingEmbedding?: { dish_media_id: string };
  /** #1513 既存の dish_media が論理削除済みだったことにする */
  existingDeletedAt?: Date;
  alreadySaved?: boolean;
}) {
  const calls = {
    dishUpsert: jest.fn().mockResolvedValue({ id: 'dish-1' }),
    mediaCreate: jest.fn().mockResolvedValue({ id: 'media-1' }),
    mediaUpdate: jest.fn().mockResolvedValue({ count: 1 }),
    // #1513 論理削除されていた既存行の復活（deleted_at を戻す）
    mediaUndelete: jest.fn().mockResolvedValue({ id: 'media-existing' }),
    embeddingCreate: jest.fn().mockResolvedValue({}),
    // #1599 ON CONFLICT DO NOTHING。count が «新しく保存したか» になる
    reactionCreate: jest
      .fn()
      .mockResolvedValue({ count: options?.alreadySaved ? 0 : 1 }),
    // #1599 同じ (provider, 投稿, 料理) の同時取り込みを直列化する advisory lock
    advisoryLock: jest.fn().mockResolvedValue(1),
  };
  const tx = {
    $executeRaw: calls.advisoryLock,
    /* #1629 **この $queryRaw は «素通りさせない» ためだけに置いてある。**

       初版は `$queryRaw: calls.advisoryLock` としており、本物の Prisma なら
       `pg_advisory_xact_lock`（戻り値 void）で必ず落ちるコードを、この fake が
       黙って通していた。結果、**テストは全部緑なのに dev の取り込みは毎回 500**
       という状態になった（実測: Failed to deserialize column of type 'void'）。

       fake は本物と同じところで落ちなければ意味が無い。 */
    $queryRaw: jest.fn(() => {
      throw new Error(
        "Failed to deserialize column of type 'void'. " +
          'advisory lock は $executeRaw で実行すること（#1629）',
      );
    }),
    dishes: { upsert: calls.dishUpsert },
    dish_media: {
      create: calls.mediaCreate,
      // #1375 4 巡目 サムネイル複製の前提確認（'' = まだ複製していない）と据え替え
      findUnique: jest.fn().mockResolvedValue({ thumbnail_path: '' }),
      updateMany: calls.mediaUpdate,
      update: calls.mediaUndelete,
    },
    dish_media_external_embeddings: {
      // #1513 サービスは `select` で dish_media.deleted_at も一緒に引くので、
      // fake も同じ形（ネストした dish_media）を返す
      findFirst: jest.fn().mockResolvedValue(
        options?.existingEmbedding
          ? {
              ...options.existingEmbedding,
              dish_media: { deleted_at: options?.existingDeletedAt ?? null },
            }
          : null,
      ),
      create: calls.embeddingCreate,
      // #1375（3 巡目）再取り込み時のサムネイル貼り替え
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    reactions: {
      createMany: calls.reactionCreate,
    },
  };
  return { tx, calls };
}

describe('#1399 SNS 取り込みの保存', () => {
  const URL = 'https://www.tiktok.com/@scout2015/video/6718335390845095173';

  it('dish_media.user_id は NULL のまま作り、ユーザーとの紐付けは reactions(save) が持つ', async () => {
    const { service, transport } = createHarness();
    transport.route(TIKTOK_OEMBED, {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: tiktokOembedBody('味噌ラーメン #ramen'),
    });
    const { tx, calls } = createSaveTx();
    (service as unknown as { prisma: { withTransaction: unknown } }).prisma = {
      withTransaction: (cb: (t: unknown) => unknown) => cb(tx),
    };

    const result = await service.create(
      {
        url: URL,
        restaurantId: '11111111-1111-1111-1111-111111111111',
        dishCategoryId: 'Q2',
      },
      'user-1',
    );

    expect(calls.mediaCreate).toHaveBeenCalledTimes(1);
    const mediaData = calls.mediaCreate.mock.calls[0][0].data;
    expect(mediaData.user_id).toBeNull();
    expect(mediaData.media_path).toBeNull();
    expect(mediaData.render_type).toBe('external_embed');

    // 埋め込みは canonical_url から描くので html は保存しない（正本 §2）
    const embeddingData = calls.embeddingCreate.mock.calls[0][0].data;
    expect(embeddingData).not.toHaveProperty('embed_html');
    expect(embeddingData.provider).toBe('tiktok');

    expect(calls.reactionCreate).toHaveBeenCalledTimes(1);
    // #1599 create({data:{...}}) から createMany({data:[{...}]}) へ変えた
    expect(calls.reactionCreate.mock.calls[0][0].data[0]).toMatchObject({
      user_id: 'user-1',
      target_type: 'dish_media',
      action_type: 'save',
    });
    expect(result).toMatchObject({ created: true, saved: true });
  });

  // #1375 4 巡目（オーナー承認 2026-08-23）: 外部サムネイルは自ストレージへ複製する
  it('サムネイルを自ストレージへ複製し、thumbnail_path に据えてリサイズを積む', async () => {
    const harness = createHarness();
    harness.transport.route(TIKTOK_OEMBED, {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: tiktokOembedBody('味噌ラーメン #ramen'),
    });
    // oEmbed が返す thumbnail_url（tiktokcdn-us は allowlist 内）
    harness.transport.route('https://p16-common-sign.tiktokcdn-us.com/x.jpeg', {
      status: 200,
      headers: { 'content-type': 'image/jpeg' },
      body: 'fake-jpeg-bytes',
    });
    const { tx, calls } = createSaveTx();
    (
      harness.service as unknown as { prisma: { withTransaction: unknown } }
    ).prisma = {
      withTransaction: (cb: (t: unknown) => unknown) => cb(tx),
    };

    await harness.service.create(
      {
        url: URL,
        restaurantId: '11111111-1111-1111-1111-111111111111',
        dishCategoryId: 'Q2',
      },
      'user-1',
    );

    expect(harness.uploadFile).toHaveBeenCalledTimes(1);
    expect(harness.uploadFile.mock.calls[0][0]).toMatchObject({
      mimeType: 'image/jpeg',
      resourceType: 'dish_media',
      usageType: 'imported-thumbnail',
      identifier: 'media-1',
    });
    expect(calls.mediaUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        // TOCTOU ガード: '' のときだけ据え替える（同時取り込みで後勝ちさせない）
        where: { id: 'media-1', thumbnail_path: '' },
        data: expect.objectContaining({
          thumbnail_path: 'test/dish_media/imported-thumbnail/123_media-1.jpg',
          thumbnail_processing_status: 'processing',
        }),
      }),
    );
    expect(harness.enqueueResizeImage).toHaveBeenCalledWith(
      expect.objectContaining({
        table: 'dish_media',
        column: 'thumbnail_path',
        recordId: 'media-1',
        size: 256,
      }),
    );
  });

  it('サムネイルの取得が失敗しても取り込みは成功のまま（外部 URL フォールバック）', async () => {
    const harness = createHarness();
    harness.transport.route(TIKTOK_OEMBED, {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: tiktokOembedBody('味噌ラーメン #ramen'),
    });
    // サムネイル URL はルートしない = CDN 落ち
    const { tx, calls } = createSaveTx();
    (
      harness.service as unknown as { prisma: { withTransaction: unknown } }
    ).prisma = {
      withTransaction: (cb: (t: unknown) => unknown) => cb(tx),
    };

    const result = await harness.service.create(
      {
        url: URL,
        restaurantId: '11111111-1111-1111-1111-111111111111',
        dishCategoryId: 'Q2',
      },
      'user-1',
    );

    expect(result).toMatchObject({ created: true, saved: true });
    expect(harness.uploadFile).not.toHaveBeenCalled();
    expect(calls.mediaUpdate).not.toHaveBeenCalled();
  });

  it('同じ SNS 投稿が同じ料理に既に在れば dish_media を作り直さず、save だけ足す', async () => {
    const { service, transport } = createHarness();
    transport.route(TIKTOK_OEMBED, {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: tiktokOembedBody('味噌ラーメン'),
    });
    const { tx, calls } = createSaveTx({
      existingEmbedding: { dish_media_id: 'media-existing' },
    });
    (service as unknown as { prisma: { withTransaction: unknown } }).prisma = {
      withTransaction: (cb: (t: unknown) => unknown) => cb(tx),
    };

    const result = await service.create(
      {
        url: URL,
        restaurantId: '11111111-1111-1111-1111-111111111111',
        dishCategoryId: 'Q2',
      },
      'user-2',
    );

    expect(calls.mediaCreate).not.toHaveBeenCalled();
    expect(calls.embeddingCreate).not.toHaveBeenCalled();
    expect(calls.reactionCreate).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      dishMediaId: 'media-existing',
      created: false,
      saved: true,
    });
  });

  it('既に保存済みなら reactions を二重に作らない', async () => {
    const { service, transport } = createHarness();
    transport.route(TIKTOK_OEMBED, {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: tiktokOembedBody('味噌ラーメン'),
    });
    const { tx, calls } = createSaveTx({
      existingEmbedding: { dish_media_id: 'media-existing' },
      alreadySaved: true,
    });
    (service as unknown as { prisma: { withTransaction: unknown } }).prisma = {
      withTransaction: (cb: (t: unknown) => unknown) => cb(tx),
    };

    const result = await service.create(
      {
        url: URL,
        restaurantId: '11111111-1111-1111-1111-111111111111',
        dishCategoryId: 'Q2',
      },
      'user-2',
    );

    // #1599 ON CONFLICT DO NOTHING にしたので «呼ばない» ではなく
    // «呼んでも 1 行も増えない（count: 0）» が正しい形になった。
    // 二重に «保存した» と報告しないことをここで固定する。
    expect(calls.reactionCreate).toHaveBeenCalledTimes(1);
    expect(calls.reactionCreate.mock.calls[0][0]).toMatchObject({
      skipDuplicates: true,
    });
    expect(result).toMatchObject({ created: false, saved: false });
  });

  /**
   * #1513 自然キー `(provider, external_content_id, dish_id)` の UNIQUE は論理削除でも
   * 空かないので、一度消した投稿を取り込み直しても新しい `dish_media` は作れない。
   * `deleted_at` を戻さないと «取り込みは 200 で返るのにどこにも出ない» ことになる。
   */
  it('一度削除した SNS 投稿を取り込み直したら、既存行を復活させる', async () => {
    const { service, transport } = createHarness();
    transport.route(TIKTOK_OEMBED, {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: tiktokOembedBody('味噌ラーメン'),
    });
    const { tx, calls } = createSaveTx({
      existingEmbedding: { dish_media_id: 'media-existing' },
      existingDeletedAt: new Date('2026-08-20T00:00:00.000Z'),
    });
    (service as unknown as { prisma: { withTransaction: unknown } }).prisma = {
      withTransaction: (cb: (t: unknown) => unknown) => cb(tx),
    };

    const result = await service.create(
      {
        url: URL,
        restaurantId: '11111111-1111-1111-1111-111111111111',
        dishCategoryId: 'Q2',
      },
      'user-2',
    );

    expect(calls.mediaCreate).not.toHaveBeenCalled();
    expect(calls.mediaUndelete).toHaveBeenCalledTimes(1);
    expect(calls.mediaUndelete.mock.calls[0][0]).toMatchObject({
      where: { id: 'media-existing' },
      data: { deleted_at: null },
    });
    expect(result).toMatchObject({ dishMediaId: 'media-existing' });
  });

  it('削除されていない既存行には復活の update を投げない', async () => {
    const { service, transport } = createHarness();
    transport.route(TIKTOK_OEMBED, {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: tiktokOembedBody('味噌ラーメン'),
    });
    const { tx, calls } = createSaveTx({
      existingEmbedding: { dish_media_id: 'media-existing' },
    });
    (service as unknown as { prisma: { withTransaction: unknown } }).prisma = {
      withTransaction: (cb: (t: unknown) => unknown) => cb(tx),
    };

    await service.create(
      {
        url: URL,
        restaurantId: '11111111-1111-1111-1111-111111111111',
        dishCategoryId: 'Q2',
      },
      'user-2',
    );

    expect(calls.mediaUndelete).not.toHaveBeenCalled();
  });

  it('対応していない URL は 400 にする（黙って空の行を作らない）', async () => {
    const { service } = createHarness();
    await expect(
      service.create(
        {
          url: 'https://example.com/not-a-sns',
          restaurantId: '11111111-1111-1111-1111-111111111111',
          dishCategoryId: 'Q2',
        },
        'user-1',
      ),
    ).rejects.toThrow(/IMPORT_UNSUPPORTED/);
  });
});

/**
 * #1599 取り込みトランザクションの競合安全性。
 *
 * 「同じ SNS 投稿を、同じ料理へ、同時に 2 本取り込む」は findFirst → create の
 * TOCTOU を踏む。tx 内で P2002 が出るとトランザクション全体が aborted になり、
 * catch して読み直すこともできないので、«そもそも同時に来ない» 形にしてある。
 */
describe('#1599 取り込みの競合', () => {
  const URL = 'https://www.tiktok.com/@scout2015/video/6718335390845095173';

  const run = async (
    tx: unknown,
    userId = 'user-1',
  ): Promise<{ saved: boolean }> => {
    const { service, transport } = createHarness();
    transport.route(TIKTOK_OEMBED, {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: tiktokOembedBody('味噌ラーメン'),
    });
    (service as unknown as { prisma: { withTransaction: unknown } }).prisma = {
      withTransaction: (cb: (t: unknown) => unknown) => cb(tx),
    };
    return (await service.create(
      {
        url: URL,
        restaurantId: '11111111-1111-1111-1111-111111111111',
        dishCategoryId: 'Q2',
      },
      userId,
    )) as unknown as { saved: boolean };
  };

  it('dish_media を作る前に自然キーで advisory lock を取る', async () => {
    const { tx, calls } = createSaveTx();
    await run(tx);

    expect(calls.advisoryLock).toHaveBeenCalledTimes(1);
    // タグ付きテンプレートなので第 1 引数が文字列配列、第 2 引数以降が値
    const [fragments, ...values] = calls.advisoryLock.mock.calls[0];
    expect(fragments.join('?')).toContain('pg_advisory_xact_lock');
    // ロックキーは (provider, 外部コンテンツ ID, dish) の自然キーで作る。
    // ここが dish だけ／provider だけになると、別の投稿どうしまで直列化して
    // しまうか、逆に同じ投稿の競合を取りこぼす。
    expect(String(values[0])).toBe(
      'dish_media_import:tiktok:6718335390845095173:dish-1',
    );
    // ロックは «無ければ作る» を判定する findFirst より前でなければ意味が無い
    expect(calls.advisoryLock.mock.invocationCallOrder[0]).toBeLessThan(
      calls.mediaCreate.mock.invocationCallOrder[0],
    );
  });

  it('reactions は P2002 を投げうる create ではなく ON CONFLICT DO NOTHING で入れる', async () => {
    const { tx, calls } = createSaveTx();
    await run(tx);

    expect(calls.reactionCreate).toHaveBeenCalledTimes(1);
    const arg = calls.reactionCreate.mock.calls[0][0];
    expect(arg.skipDuplicates).toBe(true);
    expect(arg.data).toHaveLength(1);
    expect(arg.data[0]).toMatchObject({
      user_id: 'user-1',
      target_type: 'dish_media',
      action_type: 'save',
    });
    // 生の create が残っていると、そこだけ P2002 で 500 になる
    expect(
      (tx as { reactions: Record<string, unknown> }).reactions.create,
    ).toBeUndefined();
  });

  it('競合して 1 行も増えなかったときは saved: true と偽らない', async () => {
    const { tx, calls } = createSaveTx();
    // ON CONFLICT DO NOTHING で弾かれた（= 別経路が先に保存していた）状況
    calls.reactionCreate.mockResolvedValue({ count: 0 });

    await expect(run(tx)).resolves.toMatchObject({ saved: false });
  });
});

/*
#1641 **YouTube は Shorts だけを取り込む**（#1399 リーダー確定 §1）。

`/watch?v=` と `youtu.be/` は URL だけでは判定できないので `requiresShortsCheck` が立つ。
**その確定処理がどこにも実装されておらず、横長の通常動画がそのまま取り込めていた**
（オーナー指摘 2026-08-28。セルでは上下に黒帯が出る）。

判定材料は YouTube の実装（`/shorts/{id}` が 200 か、`/watch` へ 303 か）であって、
契約された仕様ではない。だから **«判定できなかった» と «Shorts ではないと分かった» を混ぜない**。
*/
describe('DishMediaImportsService — YouTube の Shorts 判定', () => {
  const SHORTS_URL = 'https://www.youtube.com/shorts/SXHMnicI6Pg';
  const WATCH_URL = 'https://www.youtube.com/watch?v=SXHMnicI6Pg';

  const routeOembedOk = (transport: FakeSafeFetchTransport) =>
    transport.route(YOUTUBE_OEMBED, {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: '【月島】焼鶏ばんちょう',
        author_name: '78グルメ',
      }),
    });

  it('/watch?v= が横長の通常動画なら取り込ませない', async () => {
    const { service, transport } = createHarness();
    routeOembedOk(transport);
    // YouTube は Shorts でない ID の /shorts/{id} を /watch?v={id} へ流す
    transport.route(SHORTS_URL, {
      status: 303,
      headers: { location: WATCH_URL },
    });

    const result = await service.resolve({ url: WATCH_URL });

    expect(result.status).toBe('unsupported');
    expect(result.reason).toBe('youtube_not_shorts');
  });

  it('/watch?v= でも Shorts なら通し、«要確認» を持ち越さない', async () => {
    const { service, transport } = createHarness();
    routeOembedOk(transport);
    transport.route(SHORTS_URL, {
      status: 200,
      headers: { 'content-type': 'text/html' },
      body: '<html></html>',
    });

    const result = await service.resolve({ url: WATCH_URL });

    expect(result.status).not.toBe('unsupported');
    expect(result.source.requiresShortsCheck).toBe(false);
  });

  /*
  ⚠️ ここが要。**判定できなかったときに弾かない。** 弾くと、YouTube が挙動を変えた日に
     取り込みが全部止まる（リーダー確定 §3 の条件 1）。
  */
  it('判定できなかったときは弾かず、«要確認» を立てたまま通す', async () => {
    const { service, transport } = createHarness();
    routeOembedOk(transport);
    transport.route(SHORTS_URL, { status: 500, body: 'oops' });

    const result = await service.resolve({ url: WATCH_URL });

    expect(result.status).not.toBe('unsupported');
    expect(result.source.requiresShortsCheck).toBe(true);
  });

  it('/shorts/ 由来なら余計な確認をしない（リクエストを増やさない）', async () => {
    const { service, transport } = createHarness();
    routeOembedOk(transport);

    await service.resolve({ url: SHORTS_URL });

    expect(
      transport.requests.some((request) => request.url.startsWith(SHORTS_URL)),
    ).toBe(false);
  });
});

/*
#1641 **再生可否（playback_*）の判定と保存。**

オーナー指摘 2026-08-28:「今は、埋め込み時に分岐しているんですね。それって処理重く
なりますよね？そこを修正して欲しい。で、検索タブのお店提案では出さないで欲しい」。

判定は**取り込みのときに 1 回だけ・追加のリクエストゼロ**で行い、DB へ書く。
ここで見るのは «何を根拠にどう書くか» と、**書いてはいけないものを書かないこと**である。
*/
describe('DishMediaImportsService — 埋め込みの再生可否（#1641）', () => {
  const RESTAURANT_ID = '11111111-1111-1111-1111-111111111111';
  const INSTAGRAM_EMBED_URL =
    'https://www.instagram.com/p/DAbcDefGhIj/embed/captioned/';
  const INSTAGRAM_URL = 'https://www.instagram.com/reel/DAbcDefGhIj/';
  const SHORTS_URL = 'https://www.youtube.com/shorts/SXHMnicI6Pg';

  /** SSR の骨（`video_url` の有無だけを差し替える） */
  const instagramSsr = (extra: string) =>
    [
      '<!DOCTYPE html><html><body>',
      '<img class="EmbeddedMediaImage" src="https://scontent-lga3-3.cdninstagram.com/v/t51/744.jpg" />',
      '<a class="UsernameText">umaguru.tokyo</a>',
      '<div class="Caption">umaguru.tokyo<br />八王子<b>ラーメン</b>！</div>',
      `<script>window.__additionalDataLoaded('extra',{"shortcode":"DAbcDefGhIj"${extra}});</script>`,
      '</body></html>',
    ].join('');

  /** create を 1 回流して、`dish_media_external_embeddings.create` の data を返す */
  async function importOnce(
    service: DishMediaImportsService,
    url: string,
  ): Promise<Record<string, unknown>> {
    const { tx, calls } = createSaveTx();
    (service as unknown as { prisma: { withTransaction: unknown } }).prisma = {
      withTransaction: (cb: (t: unknown) => unknown) => cb(tx),
    };
    await service.create(
      { url, restaurantId: RESTAURANT_ID, dishCategoryId: 'Q2' },
      'user-1',
    );
    return calls.embeddingCreate.mock.calls[0][0].data as Record<
      string,
      unknown
    >;
  }

  it('Instagram: 埋め込み SSR に video_url が在れば playable（追加リクエストなし）', async () => {
    const { service, transport } = createHarness();
    transport.route(INSTAGRAM_EMBED_URL, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: instagramSsr(
        ',"video_url":"https://scontent.cdninstagram.com/v/t50/x.mp4"',
      ),
    });

    const data = await importOnce(service, INSTAGRAM_URL);

    expect(data.playback_status).toBe('playable');
    // ⚠️ playable のときは理由を必ず NULL で書く（CHECK dmee_playback_reason_check）
    expect(data.playback_reason).toBeNull();
    expect(data.playback_checked_at).toBeInstanceOf(Date);
    // キャプション取得で引いた 1 本だけ。判定のために外部へ増やしていない
    expect(
      transport.requests.filter((r) => r.url.startsWith(INSTAGRAM_EMBED_URL)),
    ).toHaveLength(1);
  });

  it('Instagram: video_url が無ければ not_playable(no_video_in_embed)', async () => {
    const { service, transport } = createHarness();
    transport.route(INSTAGRAM_EMBED_URL, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: instagramSsr(''),
    });

    const data = await importOnce(service, INSTAGRAM_URL);

    expect(data.playback_status).toBe('not_playable');
    expect(data.playback_reason).toBe('no_video_in_embed');
  });

  it('Instagram: "video_url":null を «在る» と数えない', async () => {
    const { service, transport } = createHarness();
    transport.route(INSTAGRAM_EMBED_URL, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: instagramSsr(',"video_url":null'),
    });

    const data = await importOnce(service, INSTAGRAM_URL);

    expect(data.playback_status).toBe('not_playable');
  });

  /*
  ⚠️ ここが要。**SSR が返らなかったのは «判定できなかった» のであって «映像が無い» ではない。**
     URL が /reel/ であることを根拠に not_playable を書くと、Instagram の UA 判定が
     変わっただけで取り込み済みのリールが検索から一斉に消える。
  */
  it('Instagram: SSR が返らなければ playback_* を書かない（URL の形から推測しない）', async () => {
    const { service, transport } = createHarness();
    transport.route(INSTAGRAM_EMBED_URL, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: '<!DOCTYPE html><html><body><div id="splash"></div></body></html>',
    });

    const data = await importOnce(service, INSTAGRAM_URL);

    expect(data).not.toHaveProperty('playback_status');
    expect(data).not.toHaveProperty('playback_reason');
  });

  it('YouTube: oEmbed が 200 なら playable', async () => {
    const { service, transport } = createHarness();
    transport.route(YOUTUBE_OEMBED, {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: '【月島】焼鶏ばんちょう',
        author_name: '78グルメ',
      }),
    });

    const data = await importOnce(service, SHORTS_URL);

    expect(data.playback_status).toBe('playable');
    expect(data.playback_reason).toBeNull();
  });

  /*
  ⚠️ **メタデータとしては失敗（unknown）だが、再生可否としては確定している。**
     401 は «こちらの認証が足りない» ではなく «この動画は外部サイトで再生させない» である。
     status === 'ok' の中でだけ書いていると、**一番書きたいこのケースだけ書けない**。
  */
  it('YouTube: oEmbed が 401 なら not_playable(embedding_disabled)', async () => {
    const { service, transport } = createHarness();
    transport.route(YOUTUBE_OEMBED, { status: 401, body: 'Unauthorized' });

    const data = await importOnce(service, SHORTS_URL);

    expect(data.playback_status).toBe('not_playable');
    expect(data.playback_reason).toBe('embedding_disabled');
  });

  it('YouTube: oEmbed が 5xx なら «判定できなかった» として書かない', async () => {
    const { service, transport } = createHarness();
    transport.route(YOUTUBE_OEMBED, { status: 503, body: 'oops' });

    const data = await importOnce(service, SHORTS_URL);

    expect(data).not.toHaveProperty('playback_status');
  });

  it('TikTok: 判定材料が無いので書かない（oEmbed 200 を playable と言い切らない）', async () => {
    const { service, transport } = createHarness();
    transport.route(TIKTOK_OEMBED, {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: tiktokOembedBody('味噌ラーメン #ramen'),
    });

    const data = await importOnce(
      service,
      'https://www.tiktok.com/@scout2015/video/6718335390845095173',
    );

    expect(data).not.toHaveProperty('playback_status');
  });

  /*
  #1641 **再取り込みで not_playable → playable へ戻せること。**

  status だけ書き換えて古い理由を残すと CHECK 制約に当たって取り込みが 500 になる。
  «status を書くときは reason も書く» が守られているかを、更新経路でも見る。
  */
  it('再取り込み: 既存行にも playback_* を貼り替え、理由を NULL へ戻す', async () => {
    const { service, transport } = createHarness();
    transport.route(INSTAGRAM_EMBED_URL, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: instagramSsr(
        ',"video_url":"https://scontent.cdninstagram.com/v/t50/x.mp4"',
      ),
    });
    const { tx } = createSaveTx({
      existingEmbedding: { dish_media_id: 'media-existing' },
    });
    (service as unknown as { prisma: { withTransaction: unknown } }).prisma = {
      withTransaction: (cb: (t: unknown) => unknown) => cb(tx),
    };

    await service.create(
      {
        url: INSTAGRAM_URL,
        restaurantId: RESTAURANT_ID,
        dishCategoryId: 'Q2',
      },
      'user-1',
    );

    const updateMany = tx.dish_media_external_embeddings.updateMany;
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany.mock.calls[0][0].data).toMatchObject({
      playback_status: 'playable',
      playback_reason: null,
    });
  });

  /*
  ⚠️ **メタデータが取れなかった再取り込みでも、再生可否だけは貼り替わること。**
     YouTube の «埋め込み不可» は resolved.status === 'unknown' として現れる。
     更新を status === 'ok' の中に閉じ込めると、ここが素通りする。
  */
  it('再取り込み: oEmbed 401 でも既存行へ not_playable を書く', async () => {
    const { service, transport } = createHarness();
    transport.route(YOUTUBE_OEMBED, { status: 401, body: 'Unauthorized' });
    const { tx } = createSaveTx({
      existingEmbedding: { dish_media_id: 'media-existing' },
    });
    (service as unknown as { prisma: { withTransaction: unknown } }).prisma = {
      withTransaction: (cb: (t: unknown) => unknown) => cb(tx),
    };

    await service.create(
      { url: SHORTS_URL, restaurantId: RESTAURANT_ID, dishCategoryId: 'Q2' },
      'user-1',
    );

    const updateMany = tx.dish_media_external_embeddings.updateMany;
    expect(updateMany.mock.calls[0][0].data).toMatchObject({
      playback_status: 'not_playable',
      playback_reason: 'embedding_disabled',
    });
    // 取れなかったサムネイル / 死活は触らない
    expect(updateMany.mock.calls[0][0].data).not.toHaveProperty('embed_status');
  });
});

/*
#1641 **端末からの «再生できなかった» 報告と、サーバ側の再検証。**

オーナー承認の設計 3 番:「端末が «再生できなかった» と報告したら、その 1 件だけ
サーバが再検証して直す」。ここで守るのは **端末の判定を保存しないこと**である。
*/
describe('DishMediaImportsService — 端末報告からの再検証（#1641）', () => {
  const DISH_MEDIA_ID = '22222222-2222-2222-2222-222222222222';
  const INSTAGRAM_EMBED_URL =
    'https://www.instagram.com/p/DAbcDefGhIj/embed/captioned/';
  const CANONICAL = 'https://www.instagram.com/reel/DAbcDefGhIj/';

  const ssr = (extra: string) =>
    [
      '<!DOCTYPE html><html><body>',
      '<img class="EmbeddedMediaImage" src="https://scontent-lga3-3.cdninstagram.com/v/t51/744.jpg" />',
      '<a class="UsernameText">umaguru.tokyo</a>',
      '<div class="Caption">umaguru.tokyo<br />八王子ラーメン</div>',
      `<script>window.__additionalDataLoaded('extra',{"shortcode":"x"${extra}});</script>`,
      '</body></html>',
    ].join('');

  /** `withTransaction` を差し替えて、読みと書きの両方を捕まえる */
  function stubPrisma(
    service: DishMediaImportsService,
    row: Record<string, unknown> | null,
  ) {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const tx = {
      dish_media_external_embeddings: {
        findFirst: jest.fn().mockResolvedValue(row),
        updateMany,
      },
    };
    (service as unknown as { prisma: { withTransaction: unknown } }).prisma = {
      withTransaction: (cb: (t: unknown) => unknown) => cb(tx),
    };
    return { updateMany };
  }

  const rowWith = (over: Record<string, unknown> = {}) => ({
    canonical_url: CANONICAL,
    playback_status: 'playable',
    playback_reason: null,
    playback_checked_at: null,
    ...over,
  });

  it('サーバが確かめ直して not_playable なら、その 1 件だけ直す', async () => {
    const { service, transport } = createHarness();
    transport.route(INSTAGRAM_EMBED_URL, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: ssr(''), // video_url が消えている = 権利ブロックが後から入った
    });
    const { updateMany } = stubPrisma(service, rowWith());

    const result = await service.reportUnplayable(DISH_MEDIA_ID);

    expect(result).toMatchObject({
      playbackStatus: 'not_playable',
      playbackReason: 'no_video_in_embed',
      rechecked: true,
    });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { dish_media_id: DISH_MEDIA_ID },
        data: expect.objectContaining({
          playback_status: 'not_playable',
          playback_reason: 'no_video_in_embed',
        }),
      }),
    );
  });

  /*
  ⚠️ ここが要。**端末の言い分をそのまま保存しない。** 端末が «再生できなかった» と
     言っていても、サーバが確かめて再生できるなら `playable` のままにする。
     鵜呑みにすると、電波の悪い 1 台のせいでその投稿が全員の検索から消える。
  */
  it('サーバが «再生できる» と確かめたら、端末の報告があっても落とさない', async () => {
    const { service, transport } = createHarness();
    transport.route(INSTAGRAM_EMBED_URL, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: ssr(',"video_url":"https://scontent.cdninstagram.com/v/t50/x.mp4"'),
    });
    const { updateMany } = stubPrisma(
      service,
      rowWith({ playback_status: 'unknown' }),
    );

    const result = await service.reportUnplayable(DISH_MEDIA_ID);

    expect(result.playbackStatus).toBe('playable');
    expect(updateMany.mock.calls[0][0].data).toMatchObject({
      playback_status: 'playable',
      playback_reason: null,
    });
  });

  /*
  ⚠️ **判定できなかったときに not_playable へ寄せない。** provider が一時的に落ちた日に
     取り込み済みの投稿がまとめて検索から消える。ただし間引きのために日時だけは進める。
  */
  it('確かめられなかったら status を書き換えず、日時だけ進める', async () => {
    const { service, transport } = createHarness();
    transport.route(INSTAGRAM_EMBED_URL, { status: 503, body: 'oops' });
    const { updateMany } = stubPrisma(service, rowWith());

    const result = await service.reportUnplayable(DISH_MEDIA_ID);

    expect(result.playbackStatus).toBe('playable');
    expect(Object.keys(updateMany.mock.calls[0][0].data)).toEqual([
      'playback_checked_at',
    ]);
  });

  /*
  この経路は**ユーザーの端末が引き金になって provider を叩く**。間引きが無いと、
  電波の悪い 1 台がフィードを往復するだけで同じ投稿へ何十回も問い合わせが飛ぶ。
  */
  it('直近に確かめたばかりなら provider を叩き直さない', async () => {
    const { service, transport } = createHarness();
    stubPrisma(
      service,
      rowWith({ playback_checked_at: new Date(Date.now() - 60_000) }),
    );

    const result = await service.reportUnplayable(DISH_MEDIA_ID);

    expect(result.rechecked).toBe(false);
    expect(transport.requests).toHaveLength(0);
  });

  it('埋め込みの行が無い dish_media でも例外を投げない', async () => {
    const { service } = createHarness();
    stubPrisma(service, null);

    await expect(
      service.reportUnplayable(DISH_MEDIA_ID),
    ).resolves.toMatchObject({ playbackStatus: 'unknown', rechecked: false });
  });
});
