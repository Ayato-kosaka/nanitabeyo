/*
#1666 **営業時間の引き上げが «近くの候補集合» に閉じていることを、実 SQL で固定する。**

型検査が通っても «どれだけの行を読むか» は分からない。ここは repository / fetcher が
実際に組み立てた SQL をそのまま `scripts/db-checks/sql/` へ書き出し、

  1. 構造の不変条件（候補集合と JOIN してから引く / 索引に乗る書き方）を機械検査する
  2. 実 DB の実行計画は CI では見られないので、**同じファイル**を
     `scripts/db-checks/explain_opening_status.py` に読ませて dev で EXPLAIN する

という 2 段で守る。写経を作らないための作法は #1629 の
`restaurants.order-by-posts-plan.spec.ts` と同じ（あちらの経緯もそこに書いてある）。

スナップショットを更新するとき（＝ SQL を意図的に変えたとき）:

    UPDATE_RESTAURANT_SQL_SNAPSHOT=1 pnpm --filter api exec jest opening-status-sql
*/
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '../../../../shared/prisma/client';
import { fetchRestaurantOpeningStatuses } from './restaurant-opening-status';
import { knnCandidateLimit } from './nearby-restaurants-cte';

const SQL_DIR = join(__dirname, '../../../../scripts/db-checks/sql');

type Scope = {
  userLat: number;
  userLon: number;
  radiusM: number;
  limit: number;
};

const DEFAULT_SCOPE: Scope = {
  userLat: 35.681236,
  userLon: 139.767125,
  radiusM: 20000,
  limit: 20,
};

/** fetcher を実際に呼び、投げられた Prisma.Sql を 2 本とも受け取る */
const build = async (scope: Scope = DEFAULT_SCOPE): Promise<Prisma.Sql[]> => {
  const queryRaw = jest.fn().mockResolvedValue([]);
  await fetchRestaurantOpeningStatuses(
    { $queryRaw: queryRaw } as unknown as Prisma.TransactionClient,
    'lunch',
    scope,
    new Date('2026-09-04T03:00:00.000Z'),
  );
  expect(queryRaw).toHaveBeenCalledTimes(2);
  return queryRaw.mock.calls.map((c) => c[0] as Prisma.Sql);
};

/*
#1629 **バインド値の «順番» も写経しない。**

SQL の形を変えるとバインド位置の順番も変わる。計測スクリプトが値を手書きの配列で
並べていると、SQL だけ更新して配列を直し忘れたときに «別のクエリを測っている» ことに
気付けない（実際に radius と limit が入れ替わり、「近い順に 20,000 件取って半径 20m で
絞る」を測って読み違えた）。重複しない番兵値で組み立て直し、値から名前を引く。
*/
const PROBES: Scope = {
  userLat: -11.5,
  userLon: -22.5,
  radiusM: -33.5,
  // knnCandidateLimit は下限 1000 で潰れるので、番兵は «その計算結果» で引く
  limit: -44,
};

const paramNamesFor = async (index: number): Promise<string[]> => {
  const probed = (await build(PROBES))[index];
  const nameOf = new Map<unknown, string>([
    [PROBES.userLat, 'lat'],
    [PROBES.userLon, 'lng'],
    [PROBES.radiusM, 'radius'],
    [knnCandidateLimit(PROBES.limit), 'knnLimit'],
  ]);
  // 曜日 / 例外日は now から決まるので、番兵ではなく «残り» として名前を振る
  const trailing =
    index === 0 ? ['dowToday', 'dowYesterday'] : ['dateToday', 'dateYesterday'];
  let t = 0;
  return probed.values.map((v) => nameOf.get(v) ?? trailing[t++]);
};

const stripComments = (sql: string): string =>
  sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');

const NAMES = ['opening_status.hours', 'opening_status.exceptions'] as const;

describe('#1666 営業時間の引き上げは候補集合に閉じている', () => {
  it('2 本とも候補集合の CTE を持ち、それと JOIN してから引く', async () => {
    for (const built of await build()) {
      const body = stripComments(built.sql).replace(/\s+/g, ' ');

      expect(body).toMatch(/WITH\s+knn_params AS \(/i);
      expect(body).toMatch(
        /JOIN nearby_restaurants nr ON nr\.restaurant_id =/i,
      );
    }
  });

  /*
  ⚠️ 索引に乗る書き方であること。ST_DWithin と KNN 演算子（<->）が消えると
     «索引には乗っているのに遅い» へ静かに戻る（#1629 の実測: 半径 5km で 9.3 秒）。
  */
  it('2 本とも GIST 索引に乗る書き方（ST_DWithin + KNN + LIMIT）である', async () => {
    for (const built of await build()) {
      const body = stripComments(built.sql).replace(/\s+/g, ' ');

      expect(body).toMatch(/ST_DWithin\(/i);
      expect(body).toMatch(/<->/);
      expect(body).toMatch(/LIMIT \(SELECT knn_limit FROM knn_params\)/i);
    }
  });

  /*
  ⚠️ **これが #1666 の本体。** 候補集合と JOIN せず、曜日 / 例外日«だけ»で引く形へ戻ると、
     クローラでテーブルが埋まった日に 620,000 店ぶんを検索 1 回ごとに読む。
     テーブルが空のうちはテストも本番も速いままなので、**書き方でしか検出できない**。
  */
  it('曜日 / 例外日だけで営業時間テーブルを引く形になっていない', async () => {
    const [hours, exceptions] = await build();

    expect(stripComments(hours.sql)).toMatch(
      /FROM restaurant_opening_hours roh\s+JOIN nearby_restaurants/i,
    );
    expect(stripComments(exceptions.sql)).toMatch(
      /FROM restaurant_hours_exceptions rhe\s+JOIN nearby_restaurants/i,
    );
  });

  it('半径・KNN 上限・曜日はバインド変数で渡している', async () => {
    const [hours] = await build();

    expect(hours.sql).not.toContain('20000');
    // lng, lat, radiusM, knnCandidateLimit(20)=1000, 曜日 2 つ
    expect(hours.values).toEqual(
      expect.arrayContaining([139.767125, 35.681236, 20000, 1000]),
    );
  });
});

describe('#1666 計測スクリプトが読む SQL は実装が組み立てたものと同一である', () => {
  it.each(NAMES.map((n, i) => [n, i] as const))('%s', async (name, index) => {
    const built = (await build())[index];
    const sqlPath = join(SQL_DIR, `${name}.sql`);

    const paramsPath = join(SQL_DIR, `${name}.params.json`);
    const paramNames = await paramNamesFor(index);

    if (process.env.UPDATE_RESTAURANT_SQL_SNAPSHOT) {
      writeFileSync(sqlPath, `${built.sql.trim()}\n`);
      writeFileSync(paramsPath, `${JSON.stringify(paramNames, null, 2)}\n`);
    }

    // 写経ではなく «同じ 1 本» を読ませるための固定。ここが赤いなら
    // EXPLAIN しているのは古い SQL である
    expect(readFileSync(sqlPath, 'utf-8').trim()).toBe(built.sql.trim());
    expect(JSON.parse(readFileSync(paramsPath, 'utf-8'))).toEqual(paramNames);
    // SQL のプレースホルダ個数とも一致すること
    expect((built.sql.match(/\?/g) ?? []).length).toBe(paramNames.length);
  });
});
