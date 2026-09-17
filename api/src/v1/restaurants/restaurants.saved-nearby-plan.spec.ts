/*
#1629 「保存したお店」の地図が **半径に比例して遅くなる書き方** へ戻らないための固定。

## 何が起きていたのか（オーナーが実機で踏んだ）

「食べたを記録」→ マップアイコン →「このエリアで再取得」が 8〜47 秒かかり、
クライアントの 30 秒タイムアウトで中断していた。**ピンが出ないのはこの中断が理由**である
（dev 実測: getMeSavedRestaurants p50 8,319 ms / p95 47,353 ms、サーバ側 5xx は 0 件）。

真因は SQL の書き方で、詳細と実測値は `restaurants.repository.ts` の candidates CTE の
コメントに置いてある。要点だけ:

1. 半径を `params` という CTE の向こう側へ隠していたため、プランナが GIST 索引の
   行数を 1,000 倍以上過小に見積もり、**restaurants を駆動表にして半径内の全店を走る**
   プランを選んでいた（走る行数が半径に比例する ＝ 「拡大しても遅い」）
2. レビュー集計が `LEFT JOIN dish_reviews` + `GROUP BY` だったため、候補 20 件に対して
   dish_reviews の Seq Scan が走りうる

## なぜ SQL の «文字列» を見るのか

EXPLAIN を CI で回すには実 DB が要る。実 DB での計測は
`scripts/db-checks/measure_saved_restaurants.py`（db-script-run.yml から実行）に置き、
ここでは **遅いプランを許してしまう書き方に戻っていないこと**を静的に見張る。
`restaurants.nearby-index.spec.ts` / `my-dishes.sql.spec.ts` と同じ作法である。

⚠️ ここが赤くなったら «書き方の好み» の問題ではない。上の 2 つのどちらかへ戻っており、
   半径を広げたユーザーから順に画面が壊れる。
*/
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RestaurantsRepository } from './restaurants.repository';

const source = readFileSync(
  join(__dirname, 'restaurants.repository.ts'),
  'utf-8',
);

/** 実際に組み立てられた SQL（Prisma のテンプレートタグが受け取る文字列）を取り出す */
async function buildSavedRestaurantsSql(): Promise<string> {
  let captured = '';
  const prisma = {
    prisma: {
      $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
        // Prisma は ${} をバインドパラメータにするので、そこは $1, $2 … に置き換えて復元する
        captured = strings.reduce(
          (acc, chunk, i) =>
            acc + chunk + (i < values.length ? `$${i + 1}` : ''),
          '',
        );
        return Promise.resolve([]);
      },
    },
  };
  const logger = { debug: () => {} };
  const repo = new RestaurantsRepository(prisma as never, logger as never);
  await repo.searchNearbySavedRestaurants(
    { lat: 35.681236, lng: 139.767125, radius: 5480, limit: 20, offset: 0 },
    '11111111-1111-1111-1111-111111111111',
  );
  return captured;
}

/** コメント（-- 行 と ブロック）を落とした «実際に実行される» SQL だけを見る */
function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

describe('#1629 保存したお店の近傍検索は «保存した店» を駆動表にすること', () => {
  let sql = '';
  let body = '';

  beforeAll(async () => {
    sql = await buildSavedRestaurantsSql();
    body = stripSqlComments(sql);
  });

  it('SQL を組み立てられている（このテスト自体の前提）', () => {
    // 前提の確認なので «直す前のコードでも通る» 条件にしておく。
    // ここが赤いときは捕まえたい退行ではなく、テストの土台が壊れている
    expect(body).toMatch(/ST_DWithin\(/i);
  });

  it('半径をプランナから隠す params CTE が復活していない', () => {
    /*
      これが最大の地雷。半径・緯度経度を CTE の向こうへ置くと、プランナは
      ST_DWithin の絞り込み効果を見積もれず «restaurants を全部引く» プランを選ぶ。
      値は必ずバインドパラメータとして式に直接置くこと。
    */
    expect(body).not.toMatch(/\bparams\s+AS\s*\(/i);
    expect(body).not.toMatch(/JOIN\s+params\b/i);
  });

  it('候補は LATERAL で «保存した店 → restaurants» の向きに引いている', () => {
    // FROM saved_restaurants … JOIN LATERAL ( … r.id = sr.restaurant_id … )
    expect(body).toMatch(/FROM\s+saved_restaurants\s+sr/i);
    expect(body).toMatch(
      /JOIN\s+LATERAL\s*\([\s\S]*?FROM\s+restaurants\s+r[\s\S]*?WHERE\s+r\.id\s*=\s*sr\.restaurant_id/i,
    );
    // ST_DWithin は LATERAL の «内側»（＝ 1 店ずつの判定）にあること。
    // 外へ出すと restaurants 駆動のプランが復活しうる
    const lateral = body.match(
      /JOIN\s+LATERAL\s*\(([\s\S]*?)\)\s*hit\s+ON\s+TRUE/i,
    );
    expect(lateral).not.toBeNull();
    expect(lateral?.[1]).toMatch(/ST_DWithin\(/i);
  });

  it('LATERAL の pull up を止める LIMIT 1 が残っている', () => {
    /*
      LIMIT が無い LATERAL 副問い合わせは PostgreSQL に普通の join へ均される
      （subquery pullup）ので、プランナが再び自由になる。r.id は主キーなので
      LIMIT 1 は結果を変えない。**消さないこと。**
    */
    const lateral = body.match(
      /JOIN\s+LATERAL\s*\(([\s\S]*?)\)\s*hit\s+ON\s+TRUE/i,
    );
    expect(lateral?.[1]).toMatch(/LIMIT\s+1/i);
  });

  it('レビュー集計は候補ごとの LATERAL。dish_reviews を外側で LEFT JOIN しない', () => {
    // 外側の LEFT JOIN + GROUP BY へ戻ると dish_reviews の Seq Scan を招く
    expect(body).not.toMatch(/LEFT\s+JOIN\s+dish_reviews/i);
    expect(body).not.toMatch(/GROUP\s+BY\s+[\s\S]{0,40}c\.last_saved_at/i);
    expect(body).toMatch(
      /JOIN\s+LATERAL\s*\([\s\S]*?FROM\s+dishes\s+d[\s\S]*?dish_reviews\s+dr[\s\S]*?WHERE\s+d\.restaurant_id\s*=\s*r\.id[\s\S]*?\)\s*agg\s+ON\s+TRUE/i,
    );
  });

  it('reactions → dish_media の join は dish_media の主キー索引に乗る向きのまま', () => {
    /*
      reactions.target_id は TEXT なのでキャストが要る。キャストするのは **reactions 側**
      （外側）でなければならない。逆向き（dm.id::text = rct.target_id）にすると
      dish_media 側の主キー索引が使えなくなり、本当に全走査になる。
    */
    expect(body).toMatch(/rct\.target_id::uuid\s*=\s*dm\.id/);
    expect(body).not.toMatch(/dm\.id::text/);
  });

  it('候補は集計より前に LIMIT / OFFSET で確定している（絞る → 集計する）', () => {
    const candidates = body.match(
      /candidates\s+AS\s*\(([\s\S]*?)\n\s*\)\s*SELECT/i,
    );
    expect(candidates).not.toBeNull();
    expect(candidates?.[1]).toMatch(
      /ORDER\s+BY[\s\S]*?LIMIT\s+\$\d+[\s\S]*?OFFSET\s+\$\d+/i,
    );
  });

  it('索引に乗らない «バウンディングボックス + acos» へ戻っていない', () => {
    expect(source).not.toMatch(/acos\(/);
    expect(body).not.toMatch(/latitude\s+BETWEEN/i);
  });
});
