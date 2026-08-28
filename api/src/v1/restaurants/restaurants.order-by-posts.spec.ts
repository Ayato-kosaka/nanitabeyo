/*
#1629 **店舗検索の並びが «投稿が多い順» であることを固定する回帰テスト。**

オーナー指示:「入札順にしなくて良いです。一旦投稿が多い順とかが良いかな？」。
既定の並びは «有効な入札の合計額（total_cents）の降順» から
**«投稿（dish_media。削除済みを除く）の多い順 → 同数なら中心から近い順»** へ変えた。

`restaurants.nearby-index.spec.ts` はファイルの文字列を見るラチェットだが、
こちらは **repository を実際に呼び、組み立てられた SQL そのもの**を見る
（`my-dishes.sql.spec.ts` と同じ作法）。ORDER BY を差し替えたり、
削除済みの投稿を数える形へ戻したりすると、ここが赤くなる。

⚠️ 並び «そのもの» を DB 無しで検証することはできないので、
   «どう問い合わせるか» までを固定している。実データでの所要時間と実行計画は
   `scripts/db-checks/measure_order_by_posts.py` で測る。
*/
import { Prisma } from '../../../../shared/prisma/client';
import { AppLoggerService } from '../../core/logger/logger.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RestaurantsRepository } from './restaurants.repository';
import { QueryRestaurantsDto } from '@shared/v1/dto';

const normalize = (sql: string) => sql.replace(/\s+/g, ' ');

const buildSql = async (
  dto: Partial<QueryRestaurantsDto> & { orderByDistance?: boolean } = {},
): Promise<string> => {
  const queryRaw = jest.fn().mockResolvedValue([]);
  const repo = new RestaurantsRepository(
    {} as unknown as PrismaService,
    { debug: jest.fn() } as unknown as AppLoggerService,
  );
  await repo.searchNearbyRestaurants(
    { $queryRaw: queryRaw } as unknown as Prisma.TransactionClient,
    {
      lat: 35.681236,
      lng: 139.767125,
      radius: 1_500_000,
      ...dto,
    } as QueryRestaurantsDto & { orderByDistance?: boolean },
  );
  expect(queryRaw).toHaveBeenCalledTimes(1);
  return normalize((queryRaw.mock.calls[0][0] as Prisma.Sql).sql);
};

describe('#1629 店舗検索の既定の並びは «投稿が多い順»', () => {
  it('ORDER BY の第一キーは投稿数の降順（入札額は並びに使わない）', async () => {
    const sql = await buildSql();

    const orderBy = sql.slice(sql.lastIndexOf('ORDER BY'));
    expect(orderBy).toContain('c.post_count DESC');
    // 入札額（total_cents）が並び順に残っていないこと。ここが本 Issue の主眼
    expect(orderBy).not.toContain('total_cents');
  });

  it('同数なら中心から近い順（同着で順序が不定にならない）', async () => {
    const sql = await buildSql();

    const orderBy = sql.slice(sql.lastIndexOf('ORDER BY'));
    // 投稿数 → 距離 → id の順。距離まで同着でも id で決まる
    expect(orderBy.indexOf('c.post_count DESC')).toBeLessThan(
      orderBy.indexOf('ST_Distance'),
    );
    expect(orderBy.indexOf('ST_Distance')).toBeLessThan(
      orderBy.indexOf('r.id ASC'),
    );
  });

  it('投稿は dish_media で数え、削除済み（deleted_at）は数えない', async () => {
    const sql = await buildSql();

    expect(sql).toContain('FROM dish_media dm JOIN dishes d ON d.id = dm.dish_id');
    expect(sql).toContain('dm.deleted_at IS NULL');
  });

  it('«絞る → 集計する» の順序を壊していない（投稿枠は dish_media 駆動 + LIMIT）', async () => {
    const sql = await buildSql({ limit: 20 });

    // 投稿枠は restaurants ではなく dish_media から駆動し、その場で limit 件へ切る
    const posted = sql.slice(sql.indexOf('posted AS ('), sql.indexOf('nearest AS ('));
    expect(posted).toContain('FROM dish_media dm');
    expect(posted).toMatch(/ORDER BY post_count DESC, distance_m ASC LIMIT \?/);
    // 重いレビュー集計は候補が確定したあとにしか出てこない
    expect(sql.indexOf('LEFT JOIN dish_reviews dr')).toBeGreaterThan(
      sql.indexOf('candidates AS ('),
    );
    // 近傍枠は KNN + LIMIT（半径が全国規模でも走る行数は limit 件で一定）
    const nearest = sql.slice(sql.indexOf('nearest AS ('));
    expect(nearest).toMatch(/ORDER BY r\.location <-> .* LIMIT \?/);
  });

  it('入札（restaurant_bids）は候補が確定したあとに集計するだけで、候補の絞り込みには使わない', async () => {
    const sql = await buildSql();

    // 候補を作る 2 つの枠（posted / nearest）に restaurant_bids が出てこないこと
    const beforeCandidates = sql.slice(0, sql.indexOf('candidates AS ('));
    expect(beforeCandidates).not.toContain('restaurant_bids');
    // meta としては引き続き返す（shared の契約を壊さない）
    expect(sql).toContain('AS total_cents');
    expect(sql).toContain('AS max_end_date');
  });
});

describe('#1629 店名検索・住所照合は従来どおり距離順のまま', () => {
  it.each([
    ['店名検索', { q: '一蘭' }],
    ['住所照合', { orderByDistance: true }],
  ])('%s は KNN の距離順で、投稿数では並べない', async (_label, dto) => {
    const sql = await buildSql(dto);

    const orderBy = sql.slice(sql.lastIndexOf('ORDER BY'));
    expect(orderBy).toContain('ST_Distance');
    expect(orderBy).not.toContain('post_count');
    expect(sql).not.toContain('posted AS (');
  });
});
