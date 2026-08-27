/*
#1629 近傍検索が索引に乗り続けることを守るラチェット。

## 何を守るのか

`restaurants` の近傍検索は 3 経路（店舗検索 / 保存済み一覧 / SNS 取り込みの候補解決）で使われる。
かつては `latitude` / `longitude` のバウンディングボックス + `acos` の球面三角法だったが、
**この 2 列には btree が 1 本も無い**（全 migration を検査して確認済み）ため、
`restaurants` の Seq Scan になっていた。日本全体の viewport から検索すると
半径が 1,000 km 級になり、全件走査 + 集計で応答が返らなくなる。

いまは `ST_DWithin` + 既存の GIST 索引（`idx_restaurants_location`）で絞っている。

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
