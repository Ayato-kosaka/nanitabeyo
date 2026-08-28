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
    // #1629 店舗検索は «距離順» と «既定（投稿枠 + 近傍枠）» で候補 CTE を
    // 組み替えるので、店舗検索に 2 つ・保存済み一覧に 1 つで計 3 つになる
    const matches = source.match(/candidates AS \(/g) ?? [];
    expect(matches.length).toBe(3);
  });

  it('候補 CTE は LIMIT で件数を切っている', () => {
    // 保存済み一覧は保存日時順で、店舗検索は KNN か投稿数順で切る。
    // どちらも «絞ってから集計する» ために LIMIT が候補側に居ること
    expect(source).toMatch(/ORDER BY\s+sr\.last_saved_at DESC\s+LIMIT /);
    expect(source).toMatch(/ORDER BY pc\.post_count DESC, distance_m ASC LIMIT /);
  });

  it('重いレビュー集計（dish_reviews）は、候補 CTE より後ろにしか無い', () => {
    /*
      dish_reviews に触るのは «候補を絞ったあと» だけ。候補 CTE の側へ移すと
      21,247 行を集計する形へ戻る。

      #1629（保存したお店の性能修正）で、保存済み一覧の集計は
      LEFT JOIN + GROUP BY から **候補 1 件ずつの LATERAL** へ変えた。
      «どう書いてあるか» ではなく «候補 CTE より後ろにしか無いか» を見る形にしてある
      （前者に縛ると、より速い書き方へ直したときに嘘の赤が出る）。
    */
    const methods = source.split('async search').slice(1);
    const targets = methods.filter((m) => m.includes('candidates AS ('));
    expect(targets.length).toBe(2);
    for (const method of targets) {
      const reviewJoin = method.indexOf('dish_reviews dr');
      expect(reviewJoin).toBeGreaterThan(-1);
      expect(reviewJoin).toBeGreaterThan(method.indexOf('candidates AS ('));
    }
  });

  it('既定の経路では «半径内の全店を集計してから並べる» に戻っていない', () => {
    /*
      #1629 かつての既定経路は «nearby（半径内の全店。LIMIT 無し）→ 集計 →
      並べて limit 件» だった。半径が全国規模になると全国の店（57 万件）を集計することになる。
      いまは投稿テーブル（dish_media）駆動の投稿枠で、候補が最初から limit 件に収まる。
    */
    expect(source).toMatch(/FROM dish_media dm\s+JOIN dishes d ON d\.id = dm\.dish_id/);
    expect(source).toMatch(/ORDER BY pc\.post_count DESC, distance_m ASC LIMIT /);
  });
});

/*
#1629 **引き（ズームアウト）でも «0 件» にならない構造を守るラチェット。**

オーナー報告:「日本全体を映して『このエリアで再検索』を押すと必ず 0 件」。
クライアント側の 50km clamp を外しただけだと «全国の店を集計する» ことになるので、
サーバ側は候補の作り方を «投稿枠（dish_media 駆動）+ 近傍枠（KNN）» に変えてある。

⚠️ ここが赤くなったら «引くと 0 件» か «引くと全国集計» のどちらかへ戻っている。
*/
describe('#1629 引きでも候補が必ず埋まる（投稿枠 + 近傍枠）', () => {
  it('投稿枠は dish_media を駆動表にしている（restaurants から駆動しない）', () => {
    // 全店舗から «投稿を持つ店» を探すのではなく、生存している投稿の側から辿る。
    // 全国規模の半径でも、走る行数が店舗数（57 万）ではなく投稿数で決まるようにするため
    expect(source).toMatch(/posted AS \(/);
    expect(source).toMatch(/FROM dish_media dm\s+JOIN dishes d ON d\.id = dm\.dish_id/);
    /*
      ⚠️ **MATERIALIZED を外さないこと。** 外すと Postgres 12 以降は CTE を inline し、
      «restaurants → dishes → dish_media» の nested loop へ戻る。dev 実測で
      日本全体 225ms → 3,478ms（15 倍）まで落ちた形である（run 33172881100）。
    */
    expect(source).toContain('post_counts AS MATERIALIZED');
  });

  it('投稿枠で埋まらない残りを KNN の近傍枠で埋める（= 0 件を返さない）', () => {
    expect(source).toMatch(/nearest AS \(/);
    // 近傍枠も KNN + LIMIT。半径がいくら大きくても走る行数は limit 件で一定
    const nearest = source.slice(source.indexOf('nearest AS ('));
    expect(nearest).toMatch(/ORDER BY r\.location <-> \$\{originPoint\} LIMIT /);
    // 投稿枠と重複させない
    expect(nearest).toMatch(/NOT EXISTS \(SELECT 1 FROM posted p WHERE p\.id = r\.id\)/);
  });

  it('並びは «投稿が多い順 → 同数なら中心から近い順»', () => {
    expect(source).toMatch(
      /ORDER BY c\.tier ASC, c\.post_count DESC, ST_Distance\(r\.location, \$\{originPoint\}\) ASC, r\.id ASC/,
    );
  });

  it('半径を «上限で頭打ち» にする細工がサーバ側に無い（見えている範囲をそのまま使う）', () => {
    // Math.min(dto.radius, 50000) のような clamp を入れると «引くと 0 件» が戻る
    expect(source).not.toMatch(/Math\.min\([^)]*radius/);
  });
});
