// api/src/v1/restaurants/restaurants.opening-hours.spec.ts
//
// #1666 GET /v1/restaurants/:id/opening-hours が返すものを固定する。
//
// ここで守りたいのは 3 つ。
//   ❶ 営業時間が 1 件も無い店では `days` が空（画面は欄ごと出さない）
//   ❷ **行が無い曜日は «定休»（空 spans）** であって «不明» ではない
//      — 絞り込み（resolveOpeningStatus）と同じ読み方。ここがずれると
//        「検索では消える店が、詳細では «分からない» と出る」
//   ❸ Postgres の TIME を **UTC のゲッタ**で読む（ホストのローカル TZ に引きずられない）

jest.mock('../../core/config/env', () => ({
  env: new Proxy(
    {},
    { get: (_t, key: string) => (key === 'DB_POOL_MAX' ? 1 : `test-${key}`) },
  ),
}));

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

const RESTAURANT_ID = 'restaurant-1666';

/**
 * Prisma が `TIME` 列を返すときの形。**1970-01-01 の UTC 時刻**として来る。
 * ⚠️ ここを `new Date('1970-01-01T11:00:00')`（TZ 無し = ローカル解釈）にしてはいけない。
 *    テストが実行環境の TZ に依存し、CI では緑・手元では赤になる。
 */
const time = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`);

const FETCHED_AT = new Date('2026-09-06T13:25:55.000Z');

type Row = {
  source: string;
  day_of_week: number;
  opens_at: Date;
  closes_at: Date;
  crosses_midnight: boolean;
  fetched_at: Date;
};

const row = (overrides: Partial<Row>): Row => ({
  source: 'osm',
  day_of_week: 1,
  opens_at: time('11:00'),
  closes_at: time('14:00'),
  crosses_midnight: false,
  fetched_at: FETCHED_AT,
  ...overrides,
});

const buildService = (rows: Row[]) => {
  const repo = {
    findRestaurantOpeningHours: jest.fn().mockResolvedValue(rows),
  } as unknown as RestaurantsRepository;

  const prisma = {
    withTransaction: jest.fn((fn: (tx: never) => unknown) => fn({} as never)),
  } as unknown as PrismaService;

  const logger = {
    debug: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    verbose: jest.fn(),
  } as unknown as AppLoggerService;

  return new RestaurantsService(
    repo,
    {} as RestaurantsAssembler,
    {} as ExternalApiService,
    prisma,
    logger,
    {} as DishesRepository,
    {} as DishMediaService,
    {} as DishMediaRepository,
    {} as LocationsService,
  );
};

describe('RestaurantsService.getRestaurantOpeningHours (#1666)', () => {
  it('営業時間が 1 件も無い店では days が空（画面はこの欄ごと出さない）', async () => {
    const result = await buildService([]).getRestaurantOpeningHours(
      RESTAURANT_ID,
    );
    expect(result).toEqual({ days: [], sources: [], fetchedAt: null });
  });

  it('行が 1 つでもあれば 7 曜日ぶん返し、行の無い曜日は «定休»（空 spans）', async () => {
    /*
    ⚠️ ここが «不明» に変わると、絞り込み（resolveOpeningStatus）が closed と判定する店を
       詳細画面だけ «分からない» と表示することになる。同じデータに 2 つの意味を持たせない。
    */
    const result = await buildService([
      row({ day_of_week: 1 }),
    ]).getRestaurantOpeningHours(RESTAURANT_ID);

    expect(result.days).toHaveLength(7);
    expect(result.days[1].spans).toEqual([
      { opensAt: '11:00', closesAt: '14:00', crossesMidnight: false },
    ]);
    for (const dow of [0, 2, 3, 4, 5, 6]) {
      expect(result.days[dow].spans).toEqual([]);
    }
  });

  it('TIME 列を UTC のゲッタで読む（実行環境の TZ に引きずられない）', async () => {
    const result = await buildService([
      row({ day_of_week: 3, opens_at: time('09:30'), closes_at: time('19:00') }),
    ]).getRestaurantOpeningHours(RESTAURANT_ID);

    expect(result.days[3].spans).toEqual([
      { opensAt: '09:30', closesAt: '19:00', crossesMidnight: false },
    ]);
  });

  it('日またぎのコマは crossesMidnight を立てたまま返す（画面が «翌» を付ける）', async () => {
    const result = await buildService([
      row({
        day_of_week: 5,
        opens_at: time('18:00'),
        closes_at: time('02:00'),
        crosses_midnight: true,
      }),
    ]).getRestaurantOpeningHours(RESTAURANT_ID);

    expect(result.days[5].spans).toEqual([
      { opensAt: '18:00', closesAt: '02:00', crossesMidnight: true },
    ]);
  });

  it('出所は曜日ごとに優先順位で選び、週で実際に採ったものを全部返す', async () => {
    /*
    月曜は official_site と osm の両方があり official_site が勝つ。
    土曜は osm しか無いので残る。**«official_site» とだけ書くと土曜の出所を偽ることになる。**
    */
    const result = await buildService([
      row({ day_of_week: 1, source: 'official_site', opens_at: time('09:00') }),
      row({ day_of_week: 1, source: 'osm', opens_at: time('10:00') }),
      row({ day_of_week: 6, source: 'osm', opens_at: time('08:00') }),
    ]).getRestaurantOpeningHours(RESTAURANT_ID);

    expect(result.days[1].spans.map((s) => s.opensAt)).toEqual(['09:00']);
    expect(result.days[6].spans.map((s) => s.opensAt)).toEqual(['08:00']);
    expect(result.sources).toEqual(['official_site', 'osm']);
  });

  it('fetchedAt はいちばん新しい取得時刻', async () => {
    const older = new Date('2026-08-01T00:00:00.000Z');
    const result = await buildService([
      row({ day_of_week: 1, fetched_at: older }),
      row({ day_of_week: 2, fetched_at: FETCHED_AT }),
    ]).getRestaurantOpeningHours(RESTAURANT_ID);

    expect(result.fetchedAt).toBe(FETCHED_AT.toISOString());
  });
});
