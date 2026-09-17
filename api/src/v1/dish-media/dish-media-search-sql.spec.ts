/*
#1666 **店提案の本体クエリ（`findDishMediaIds`）の実行計画を、実 DB で確かめられるようにする。**

## なぜ要るか

#1818 で「近くの店の候補集合」を共有断片（`nearby-restaurants-cte.ts`）へ切り出したとき、
**営業時間の 2 本だけ EXPLAIN して、本体クエリは確かめていなかった**。
本体はプロダクトで最も重いクエリで、その CTE 構造を触っている。

型検査も jest も «どんな計画で走るか» は見ない。#1629 / #1686 の実績どおり、
ここは **«索引には乗っているのに遅い»** が静かに起きる場所である。

作法は `restaurants.order-by-posts-plan.spec.ts` / `opening-status-sql.spec.ts` と同じで、
実装が組み立てた SQL をそのまま `scripts/db-checks/sql/` へ書き出し、
`explain_dish_media_search.py` が **その同じファイル**を読んで dev で EXPLAIN する。

スナップショットを更新するとき（＝ SQL を意図的に変えたとき）:

    UPDATE_RESTAURANT_SQL_SNAPSHOT=1 pnpm --filter api exec jest dish-media-search-sql
*/
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '../../../../shared/prisma/client';
import { AppLoggerService } from '../../core/logger/logger.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DishMediaRepository } from './dish-media.repository';
import type { SearchDishMediaDto } from '@shared/v1/dto';

const SQL_DIR = join(__dirname, '../../../../scripts/db-checks/sql');
const NAME = 'dish_media_search';

type Probe = { lat: number; lng: number; radius: number; limit: number };
const REAL: Probe = {
  lat: 35.681236,
  lng: 139.767125,
  radius: 20000,
  limit: 5,
};
/*
⚠️ バインド値の «順番» も写経しない。SQL の形を変えると順番も変わる。
   重複しない番兵値で組み立て直し、値から名前を引く（#1629 の作法）。
*/
const PROBES: Probe = { lat: -11.5, lng: -22.5, radius: -33.5, limit: -44 };
const USER_ID = '11111111-1111-4111-8111-111111111111';
const CATEGORY_ID = 'Q483163';

/** repository を実際に呼び、組み立てられた Prisma.Sql をそのまま受け取る */
const build = async (p: Probe): Promise<Prisma.Sql> => {
  const queryRaw = jest.fn().mockResolvedValue([]);
  const repo = new DishMediaRepository(
    {} as unknown as PrismaService,
    { debug: jest.fn(), warn: jest.fn() } as unknown as AppLoggerService,
    { get: jest.fn() } as never,
  );
  await repo.findDishMediaIds(
    { $queryRaw: queryRaw } as unknown as Prisma.TransactionClient,
    {
      location: `${p.lat},${p.lng}`,
      radius: p.radius,
      categoryId: CATEGORY_ID,
      limit: p.limit,
      // timeSlot は渡さない: 渡すと営業時間の引き上げが先に走り、
      // 本体クエリの前に別のクエリが 2 本入る（あちらは opening-status-sql.spec.ts が見ている）
    } as SearchDishMediaDto,
    USER_ID,
  );
  expect(queryRaw).toHaveBeenCalledTimes(1);

  /*
  ⚠️ 本体クエリは **タグ付きテンプレート**（`tx.$queryRaw\`...\``）で呼ばれる。
     営業時間の 2 本（`Prisma.sql(...)` を 1 引数で渡す）とは受け取り方が違い、
     mock には `(strings, ...values)` の形で入る。`Prisma.sql()` で組み直す。
  */
  const [strings, ...values] = queryRaw.mock.calls[0] as [
    TemplateStringsArray,
    ...unknown[],
  ];
  return Prisma.sql(strings, ...values);
};

const stripComments = (sql: string): string =>
  sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');

describe('#1666 店提案の本体クエリは候補集合の共有断片を使う', () => {
  it('共有断片の CTE（knn_params / candidates_radius / nearby_restaurants）が生えている', async () => {
    const body = stripComments((await build(REAL)).sql).replace(/\s+/g, ' ');

    expect(body).toMatch(/knn_params AS \(/i);
    expect(body).toMatch(/candidates_radius AS \(/i);
    expect(body).toMatch(/nearby_restaurants AS \(/i);
  });

  /*
  ⚠️ #1629 の実測: ST_DWithin と KNN 演算子（<->）を外すと、半径 5km の東京駅で 9.3 秒。
     «索引には乗っているのに遅い» へ静かに戻るので、書き方で見張る。
  */
  it('GIST 索引に乗る書き方（ST_DWithin + KNN + LIMIT）を保っている', async () => {
    const body = stripComments((await build(REAL)).sql).replace(/\s+/g, ' ');

    expect(body).toMatch(/ST_DWithin\(/i);
    expect(body).toMatch(/<->/);
    expect(body).toMatch(/LIMIT \(SELECT knn_limit FROM knn_params\)/i);
    expect(body).not.toMatch(/acos\(/i);
  });

  it('候補の絞り込みを本体クエリが自前で書き直していない', async () => {
    const source = readFileSync(
      join(__dirname, 'dish-media.repository.ts'),
      'utf-8',
    );

    // 絞り込みは nearbyRestaurantsCte() を埋め込む 1 行だけ
    expect(source).toContain('nearbyRestaurantsCte(');
    expect(source).not.toMatch(/ST_DWithin\(/);
  });
});

describe('#1666 計測スクリプトが読む SQL は実装が組み立てたものと同一である', () => {
  it(NAME, async () => {
    const built = await build(REAL);
    const sqlPath = join(SQL_DIR, `${NAME}.sql`);
    const paramsPath = join(SQL_DIR, `${NAME}.params.json`);

    const probed = await build(PROBES);
    const nameOf = new Map<unknown, string>([
      [PROBES.lat, 'lat'],
      [PROBES.lng, 'lng'],
      [PROBES.radius, 'radius'],
      [PROBES.limit, 'limit'],
      [Math.max(1000, 50 * PROBES.limit), 'knnLimit'],
      [USER_ID, 'userId'],
      [CATEGORY_ID, 'categoryId'],
      // ランキングのゆらぎの強さ。実装側の定数なので番兵にできない
      [0.216, 'gumbelTau'],
    ]);
    /*
    ⚠️ **知らない値を «たぶんこれ» で埋めない。** pageSeed は毎回変わる UUID なので
       番兵に載らないが、«載らない = pageSeed» と決め打ちすると、実装側の定数
       （gumbel_tau など）まで pageSeed の名前で書き出してしまう。実際に一度そうなり、
       double precision の位置へ UUID を bind する params.json ができた。
       **UUID の形をしているものだけ** pageSeed と認め、それ以外は落とす。
    */
    const UUID_RE =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    /*
    営業時間の 3 値判定の結果（`closedRestaurantIds` / `openRestaurantIds`）は
    どちらも uuid[] で、timeSlot 未指定のこの呼び出しでは両方とも空配列になる。
    値では区別できないので、**出てくる順**で名前を振る（SQL 上の並びと同じ）。
    */
    const arrayNames = ['closedRestaurantIds', 'openRestaurantIds'];
    let arraySeen = 0;
    const paramNames = probed.values.map((v) => {
      const found = nameOf.get(v);
      if (found) return found;
      if (Array.isArray(v)) {
        const name = arrayNames[arraySeen++];
        if (!name) throw new Error('uuid[] の bind が想定より多い');
        return name;
      }
      if (typeof v === 'string' && UUID_RE.test(v)) return 'pageSeed';
      throw new Error(
        `bind 値 ${JSON.stringify(v)} に名前が付いていない。` +
          'nameOf へ追加すること（計測スクリプトが値を bind できなくなる）',
      );
    });

    if (process.env.UPDATE_RESTAURANT_SQL_SNAPSHOT) {
      writeFileSync(sqlPath, `${built.sql.trim()}\n`);
      writeFileSync(paramsPath, `${JSON.stringify(paramNames, null, 2)}\n`);
    }

    expect(readFileSync(sqlPath, 'utf-8').trim()).toBe(built.sql.trim());
    expect(JSON.parse(readFileSync(paramsPath, 'utf-8'))).toEqual(paramNames);
    expect((built.sql.match(/\?/g) ?? []).length).toBe(paramNames.length);
  });
});
