/*
#1629 **店舗検索が «generic plan だと半径内の全店を舐める» 書き方へ戻らないための固定。**

## 何が起きたのか

「投稿が多い順」を入れた commit 3dfd061d のあと、dev の
GET /v1/restaurants/search（東京駅・半径 20,000m・limit 20）が
7,625 / 16,222 / 25,954 ms かかった（queue_ms は 1〜2 ms なので接続待ちではない）。

**同じ SQL を literal 埋め込みで EXPLAIN ANALYZE すると 46〜270 ms で速い。**
Prisma が投げるのは prepared statement なので、PostgreSQL は数回目から
generic plan（パラメータの値を見ないプラン）へ切り替わる。半径が見えなくなると
GIST 索引の見積りが既定値へ落ち、restaurants を駆動表にするプランが選ばれる。
再現環境（restaurants 570,000 行）での実測は repository の posted CTE のコメントにある。

## このファイルが見張っていること

前任のラチェット（restaurants.nearby-index.spec.ts / restaurants.order-by-posts.spec.ts）は
«ORDER BY が何か» など SQL の語句を見ていたので、**この事故を検出できなかった**。
崩れたのは語句ではなく «restaurants をどう引くか» の構造だからである。そこで:

1. **構造の不変条件**を直接見る。restaurants を半径（ST_DWithin）で引く箇所は、
   «外側の行の id で 1 件に絞る LATERAL» か «KNN + LIMIT» のどちらかでなければならない。
   どちらでもない形（＝ プランナが駆動表を選べる普通の join）が現れたら赤にする
2. **実 DB での実行計画**は DB が要るので CI では見られない。代わりに
   repository が組み立てる SQL そのものを scripts/db-checks/sql/ へ書き出して固定し、
   scripts/db-checks/measure_order_by_posts.py が **その同じファイルを読んで**
   force_generic_plan で計測・判定する。
   ⚠️ 「repository を直したのに計測スクリプトの写経が古いままで、同じ遅い数字が出て
      «直っていない» と誤読しかけた」事故が起きている。写経を無くすためのファイルである

スナップショットを更新するとき（＝ SQL を意図的に変えたとき）:

    UPDATE_RESTAURANT_SQL_SNAPSHOT=1 pnpm --filter api exec jest restaurants.order-by-posts-plan
*/
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '../../../../shared/prisma/client';
import { AppLoggerService } from '../../core/logger/logger.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RestaurantsRepository } from './restaurants.repository';
import { QueryRestaurantsDto } from '@shared/v1/dto';

const SQL_DIR = join(__dirname, '../../../../scripts/db-checks/sql');

/** repository を実際に呼び、組み立てられた Prisma.Sql をそのまま受け取る */
const build = async (
  dto: Partial<QueryRestaurantsDto> & { orderByDistance?: boolean } = {},
): Promise<Prisma.Sql> => {
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
      radius: 20000,
      limit: 20,
      ...dto,
    } as QueryRestaurantsDto & { orderByDistance?: boolean },
  );
  expect(queryRaw).toHaveBeenCalledTimes(1);
  return queryRaw.mock.calls[0][0] as Prisma.Sql;
};

/** コメントを落とした «実際に実行される» SQL だけを見る */
const stripComments = (sql: string): string =>
  sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');

/**
 * 括弧の対応を数えて、`from` の位置から始まる副問い合わせ（`(` … `)`）の中身を返す。
 * ネストした LATERAL の «内側だけ» を切り出すために使う。
 */
const subqueryAt = (sql: string, from: number): string => {
  const open = sql.indexOf('(', from);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < sql.length; i += 1) {
    if (sql[i] === '(') depth += 1;
    else if (sql[i] === ')') {
      depth -= 1;
      if (depth === 0) return sql.slice(open + 1, i);
    }
  }
  return sql.slice(open + 1);
};

/**
 * `restaurants` を半径（ST_DWithin）で引いている箇所を全部取り出し、
 * それぞれが «安全な引き方» になっているかを判定する。
 *
 * 安全な引き方は 2 つだけ:
 *   (a) LATERAL の中で `r.id = <外側>.id` に絞り、`LIMIT` で pull up を止めている
 *       → プランナは nested loop 以外を選べず、走る行数は外側の行数で決まる
 *   (b) KNN（`location <-> 点`）+ `LIMIT` で «近い順に n 件» を直接取っている
 *       → GIST 索引から順に取り出して打ち切るので、走る行数は LIMIT で決まる
 *
 * どちらでもない＝ «普通の join の WHERE に ST_DWithin がある» 形は、
 * generic plan で restaurants が駆動表に選ばれうるので赤にする。
 */
const dwithinScopes = (sql: string): { text: string; safe: boolean }[] => {
  const body = stripComments(sql).replace(/\s+/g, ' ');
  const scopes: { text: string; safe: boolean }[] = [];
  // ST_DWithin を含む «一番内側の括弧» を、LATERAL / CTE 単位で切り出す
  const marks = [...body.matchAll(/JOIN LATERAL|AS MATERIALIZED|\bAS\s*\(/gi)];
  for (const mark of marks) {
    const at = mark.index ?? 0;
    const inner = subqueryAt(body, at);
    if (!/ST_DWithin/i.test(inner)) continue;
    // さらに内側の LATERAL が持っているものは、そちらで別途評価される
    const nested = inner.search(/JOIN LATERAL/i);
    const own = nested >= 0 ? inner.slice(0, nested) : inner;
    if (!/ST_DWithin/i.test(own)) continue;

    const limited = /\bLIMIT\b/i.test(own);
    // (a) LATERAL «そのもの» の中で、外側の行の id に絞っていること。
    //     ⚠️ 普通の join の ON 句に r.id = pc.id と書いてあるのでは駄目である。
    //        それはプランナが «どちらを駆動表にするか» を選べる形で、
    //        generic plan では restaurants 側が選ばれる（これが今回の事故そのもの）
    const isLateralBody = /^JOIN LATERAL$/i.test(mark[0]);
    const correlatedById =
      isLateralBody && /\br\.id\s*=\s*\w+\.\w*id\b/i.test(own);
    // (b) KNN で «近い順に n 件» を直接取っている
    const knn = /r\.location\s*<->/i.test(own);

    scopes.push({ text: own, safe: (correlatedById || knn) && limited });
  }
  return scopes;
};

describe('#1629 半径で restaurants を引く箇所は «行数が半径に依存しない» 形でなければならない', () => {
  it.each([
    ['既定（投稿が多い順）', {}],
    ['距離順（店名検索 / 住所照合）', { orderByDistance: true }],
  ])('%s', async (_label, dto) => {
    const scopes = dwithinScopes((await build(dto)).sql);

    // 前提: そもそも半径で絞っていること（この検査自体が空振りしていない証明）
    expect(scopes.length).toBeGreaterThan(0);

    const unsafe = scopes
      .filter((s) => !s.safe)
      .map((s) => s.text.slice(0, 400));
    // ここが赤いときは «書き方の好み» の問題ではない。generic plan に切り替わった瞬間、
    // 半径内の全店（dev で最大 57 万行）を読むプランへ落ちて 7〜26 秒かかる。
    expect(unsafe).toEqual([]);
  });

  it('投稿枠は post_counts を外側に置き、restaurants は主キーで 1 件ずつ引く', async () => {
    const body = stripComments((await build()).sql).replace(/\s+/g, ' ');

    // post_counts（＝ 投稿を持つ店だけの小さな集合）が駆動表であること
    expect(body).toMatch(/FROM post_counts pc JOIN LATERAL \(/i);
    // ⚠️ LIMIT 1 を消すと副問い合わせが pull up され、普通の join に均される
    expect(body).toMatch(/WHERE r\.id = pc\.id[\s\S]*?LIMIT 1 \) hit ON TRUE/i);
    // 「restaurants を先に半径で絞って post_counts と突き合わせる」形へ戻っていないこと
    expect(body).not.toMatch(/JOIN restaurants r ON r\.id = pc\.id/i);
  });

  it('候補が決まったあとの集計（レビュー・入札）は LATERAL で候補ぶんに固定する', async () => {
    const body = stripComments((await build()).sql).replace(/\s+/g, ' ');

    // dish_reviews / restaurant_bids を «外側の GROUP BY» で集計する形は、
    // 候補が limit 件でも Seq Scan + Hash Join に落ちうる（#1682 で実際に踏んだ）
    expect(body).not.toMatch(/LEFT JOIN dish_reviews/i);
    expect(body).not.toMatch(/LEFT JOIN restaurant_bids/i);
    expect(body).toMatch(/\) agg ON TRUE/i);
    expect(body).toMatch(/\) bid ON TRUE/i);
  });
});

describe('#1629 計測スクリプトが読む SQL は repository が組み立てたものと同一である', () => {
  it.each([
    ['search_nearby_restaurants.default.sql', {}],
    ['search_nearby_restaurants.distance.sql', { orderByDistance: true }],
  ])('%s', async (file, dto) => {
    const built = await build(dto);
    const path = join(SQL_DIR, file);

    if (process.env.UPDATE_RESTAURANT_SQL_SNAPSHOT) {
      writeFileSync(path, `${built.sql.trim()}\n`);
    }

    // 写経ではなく «同じ 1 本» を読ませるための固定。ここが赤いなら
    // 計測スクリプトは古い SQL を測っている（＝ 直した結果が数字に出ない）
    expect(readFileSync(path, 'utf-8').trim()).toBe(built.sql.trim());
  });

  it('半角疑問符はバインド位置だけに現れる（コメントに混ぜない）', async () => {
    for (const dto of [{}, { orderByDistance: true }]) {
      const built = await build(dto);
      // Prisma.Sql#sql はバインド位置を半角疑問符で表現する。コメントに混ざると
      // ダンプした SQL からプレースホルダを数える計測スクリプトが位置をずらす
      expect((built.sql.match(/\?/g) ?? []).length).toBe(built.values.length);
    }
  });
});
