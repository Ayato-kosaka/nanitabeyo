/*
#1629 近傍検索が索引に乗り続けることを守るラチェット。

## 何を守るのか

`restaurants` の近傍検索は 3 経路（店舗検索 / 保存済み一覧 / SNS 取り込みの候補解決）で使われる。
かつては `latitude` / `longitude` のバウンディングボックス + `acos` の球面三角法だったが、
**この 2 列には btree が 1 本も無い**（全 migration を検査して確認済み）ため、
`restaurants` の Seq Scan になっていた。日本全体の viewport から検索すると
半径が 1,000 km 級になり、全件走査 + 集計で応答が返らなくなる。

いまは `ST_DWithin` + 既存の GIST 索引（`idx_restaurants_location`）で絞っている。

## 索引に乗っても遅かった（2 段目のラチェット）

`ST_DWithin` で索引に乗せたあとも、半径 5km の東京駅で **9.3 秒**かかっていた。
索引は «半径内か» までしか絞れず、`ORDER BY ST_Distance(...)` は
**半径内の全件（21,247 行）の距離を計算してソートしてから LIMIT** していたためである。
さらに `dishes` / `dish_reviews` / `restaurant_bids` の集計も、その 21,247 行に対して走っていた。

いまは **JOIN と集計より前に候補を limit 件へ絞る**。距離順のときは PostGIS の
KNN 演算子（`location <-> 点`）で GIST 索引から «近い順に n 件» を直接取り出す。
ここが崩れると «索引には乗っているのに遅い» 状態へ静かに戻るので、
`ST_DWithin` と同じ強さで見張る。

## なぜ SQL の文字列を見るのか

`EXPLAIN` を CI で回すには実 DB が要る。索引が効いていることを直接見る代わりに、
**索引に乗らない書き方へ戻っていないこと**を静的に見張る。これは
`my-dishes.sql.spec.ts` が «候補集合の CTE にカテゴリ表が出てこないこと» を
見張っているのと同じ作法である。

⚠️ ここが赤くなったら、まず「なぜ haversine へ戻したのか」を確認すること。
   性能の問題は «動くが遅い» なので、テストが無いと誰も気付かないまま本番へ出る。
*/
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(
  join(__dirname, 'restaurants.repository.ts'),
  'utf-8',
);

describe('#1629 近傍検索は GIST 索引に乗る書き方であること', () => {
  it('ST_DWithin で絞っている（店舗検索・保存済み一覧の 2 経路）', () => {
    const matches = source.match(/ST_DWithin\(/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('索引に乗らない «バウンディングボックス + acos» へ戻っていない', () => {
    // 緯度経度の BETWEEN（= btree の無い列での範囲絞り込み）
    expect(source).not.toMatch(/r\.latitude\s+BETWEEN/);
    expect(source).not.toMatch(/r\.longitude\s+BETWEEN/);
    // 球面三角法での距離計算（索引を使えない）
    expect(source).not.toMatch(/acos\(/);
  });

  it('geography 列（location）を使っている。latitude / longitude の生値で距離を測らない', () => {
    expect(source).toMatch(/r\.location/);
  });
});

describe('#1629 集計より前に候補を絞っている（索引に乗っても遅い状態へ戻らない）', () => {
  it('距離順の経路は KNN 演算子（location <-> 点）で候補を切っている', () => {
    // 「ORDER BY r.location <-> …」の形。これが GIST 索引から «近い順に n 件» を取り出す
    expect(source).toMatch(/ORDER BY r\.location <-> /);
  });

  it('KNN の ORDER BY には LIMIT が付いている（付いていないと索引が使われない）', () => {
    expect(source).toMatch(/ORDER BY r\.location <-> \$\{originPoint\} LIMIT /);
  });

  it('2 つのメソッドとも「候補を絞る CTE」を持っている', () => {
    const matches = source.match(/candidates AS \(/g) ?? [];
    expect(matches.length).toBe(2);
  });

  it('候補 CTE は LIMIT で件数を切っている', () => {
    // 保存済み一覧は保存日時順で、店舗検索は KNN か入札額順で切る。
    // どちらも «絞ってから集計する» ために LIMIT が候補側に居ること
    expect(source).toMatch(/ORDER BY\s+sr\.last_saved_at DESC\s+LIMIT /);
    expect(source).toMatch(/ORDER BY total_cents DESC LIMIT /);
  });

  it('重いレビュー集計（dish_reviews）は、候補 CTE より後ろにしか無い', () => {
    // dish_reviews を LEFT JOIN しているのは、候補を絞ったあとの最終 SELECT だけ。
    // 候補 CTE の側へ移すと 21,247 行を集計する形へ戻る
    const methods = source.split('async search').slice(1);
    const targets = methods.filter((m) => m.includes('candidates AS ('));
    expect(targets.length).toBe(2);
    for (const method of targets) {
      expect(method.indexOf('LEFT JOIN dish_reviews dr')).toBeGreaterThan(
        method.indexOf('candidates AS ('),
      );
    }
  });

  it('入札額順の経路では «近い n 件» に切っていない（意味が変わるため）', () => {
    // KNN の LIMIT は orderByDistance が真のときだけ組み立てられる
    expect(source).toMatch(
      /const knnOrderLimit = orderByDistance\s*\?\s*Prisma\.sql/,
    );
  });
});
