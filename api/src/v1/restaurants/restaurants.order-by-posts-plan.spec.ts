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

type SearchDto = Partial<QueryRestaurantsDto> & { orderByDistance?: boolean };

/** repository を実際に呼び、組み立てられた Prisma.Sql をそのまま受け取る */
const build = async (dto: SearchDto = {}): Promise<Prisma.Sql> => {
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
 * `restaurants` を引いている箇所（CTE / LATERAL / 副問い合わせ）を全部取り出し、
 * それぞれが «走る行数が半径に依存しない» 引き方になっているかを判定する。
 *
 * 安全な引き方は 3 つだけ。
 *
 *   (a) **主キー相関の LATERAL** … `JOIN LATERAL (… WHERE r.id = <外側>.id … LIMIT …)`
 *       プランナは nested loop 以外を選べず、走る行数は外側の行数で決まる
 *   (b) **KNN 枠** … `ORDER BY r.location <-> 点 LIMIT n`。ただし
 *       **同じ範囲に ST_DWithin を書いてはいけない**（下の ⚠️）
 *   (c) **店名駆動** … `r.name ILIKE …` で trgm 索引から絞る。
 *       こちらは逆に **KNN 演算子を書いてはいけない**（希少な店名だと索引を舐め切る）
 *
 * ⚠️ **ST_DWithin と KNN（<->）を同じ範囲に並べてはいけない。**
 *    これが #1629 で 2 度踏んだ罠そのものである。ひとつの GIST 索引に対して
 *    «近い順に舐めて打ち切る»（速い）と «半径内を全部取ってから並べ替える»（遅い）の
 *    2 経路が生まれ、プランナは見積り次第でどちらへも倒れる。ST_DWithin をフィルタと
 *    見たときの行数見積りは PostGIS の既定へ落ちて LIMIT より小さくなりがちで、
 *    そうなると «20 件そろえるには索引を最後まで舐める» と誤認して遅い方が選ばれる。
 *    半径の値が見えている **custom plan でだけ**起きるので、generic plan しか
 *    見ていないと «直った» と誤読する（実際に誤読した）。
 */
const restaurantScopes = (
  sql: string,
): { text: string; safe: boolean; why: string }[] => {
  const body = stripComments(sql).replace(/\s+/g, ' ');
  const out: { text: string; safe: boolean; why: string }[] = [];
  const marks = [
    ...body.matchAll(/JOIN LATERAL|AS MATERIALIZED|\bAS\s*\(|\bFROM\s*\(/gi),
  ];
  for (const mark of marks) {
    const at = mark.index ?? 0;
    const inner = subqueryAt(body, at);
    // restaurants を引いていない範囲は対象外
    if (!/FROM restaurants r\b/i.test(inner)) continue;
    // さらに内側の副問い合わせが持っているものは、そちらで別途評価される
    const nested = inner.search(/JOIN LATERAL|\bFROM\s*\(/i);
    const own = nested >= 0 ? inner.slice(0, nested) : inner;
    if (!/FROM restaurants r\b/i.test(own)) continue;

    const hasDWithin = /ST_DWithin\s*\(\s*r\.location/i.test(own);
    const hasKnn = /r\.location\s*<->/i.test(own);
    const limited = /\bLIMIT\b/i.test(own);
    const isLateralBody = /^JOIN LATERAL$/i.test(mark[0]);
    const correlatedById =
      isLateralBody && /\br\.id\s*=\s*\w+\.\w*id\b/i.test(own);
    const nameDriven = /r\.name\s+ILIKE/i.test(own);

    let safe = false;
    let why = '';
    if (hasDWithin && hasKnn) {
      why =
        'ST_DWithin と KNN（<->）が同じ範囲にある。' +
        'プランナが «半径内を全部取ってから並べ替える» 経路へ倒れうる';
    } else if (correlatedById && limited) {
      safe = true;
      why = '主キー相関の LATERAL（走る行数は外側の行数で決まる）';
    } else if (hasKnn && limited) {
      safe = true;
      why = 'KNN + LIMIT（走る行数は LIMIT で決まる）';
    } else if (nameDriven && !hasKnn && limited) {
      safe = true;
      why = '店名駆動（trgm 索引で絞ってから並べ替える）';
    } else {
      why =
        '半径だけで restaurants を引いていて、行数を止めるものが無い' +
        '（LATERAL の主キー相関でも KNN + LIMIT でも店名駆動でもない）';
    }
    out.push({ text: own.trim().slice(0, 300), safe, why });
  }
  return out;
};

describe('#1629 半径で restaurants を引く箇所は «行数が半径に依存しない» 形でなければならない', () => {
  it.each([
    ['既定（投稿が多い順）', {}],
    ['距離順（住所照合。店名なし）', { orderByDistance: true }],
    ['店名検索', { q: 'ZQNAME' }],
  ])('%s', async (_label, dto) => {
    const scopes = restaurantScopes((await build(dto)).sql);

    // 前提: そもそも restaurants を引いていること（この検査が空振りしていない証明）
    expect(scopes.length).toBeGreaterThan(0);

    const unsafe = scopes
      .filter((s) => !s.safe)
      .map((s) => `${s.why} :: ${s.text}`);
    // ここが赤いときは «書き方の好み» の問題ではない。プランが倒れた瞬間、
    // 半径内の全店（dev で最大 57 万行）を読むようになって 10 秒級になる。
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
  /*
    #1834 【設計】**LIMIT は literal なので «limit ごとに別のプラン» である。
    だから「どの limit を測るか」も写経ではなく、ここで列挙して固定する。**

    ここには長らく limit 20（クライアントの既定）しか無かった。ところが
    `QueryRestaurantsDto.limit` は **@Max(100)** で、公開 API はそのまま 100 を受ける。
    実際に本番で既定順 + limit 100 が **26.7 秒**かかっており（#1834）、
    その組み合わせはラチェットの外側だったので誰も気づけなかった。

    ⚠️ **「クライアントが今そう呼んでいないから」を理由に外さないこと。**
       ここが守るのは «API が受け付ける最悪の形» であって «今の呼ばれ方» ではない。
       limit の上限を変えたら、この列挙も一緒に変える。
  */
  it.each([
    ['search_nearby_restaurants.default', {} as SearchDto],
    [
      // 公開 API が受け付ける上限。既定順はここが最も重い
      'search_nearby_restaurants.default_limit100',
      { limit: 100 } as SearchDto,
    ],
    [
      'search_nearby_restaurants.distance',
      { orderByDistance: true } as SearchDto,
    ],
    [
      // SNS 取り込み（dish-media-imports）が内部から呼ぶ形
      'search_nearby_restaurants.distance_limit100',
      { orderByDistance: true, limit: 100 } as SearchDto,
    ],
    ['search_nearby_restaurants.byname', { q: 'ZQNAME' } as SearchDto],
  ])('%s', async (name, dto) => {
    const built = await build(dto);
    const sqlPath = join(SQL_DIR, `${name}.sql`);
    const paramsPath = join(SQL_DIR, `${name}.params.json`);

    /*
      #1629 **バインド値の «順番» も写経しない。**

      SQL の形を変えるとバインド位置の順番も変わる。計測スクリプトが値を手書きの
      配列で並べていると、SQL だけ更新して配列を直し忘れたときに «別のクエリを
      測っている» ことに気付けない（実際に radius と limit が入れ替わり、
      「近い順に 20,000 件取って半径 20m で絞る」を測って読み違えた）。

      そこで «各バインド位置が何なのか» を名前の列として一緒に書き出す。
      重複しない番兵値で組み立て直して、値から名前を引く。
    */
    const probes = { lat: -11.5, lng: -22.5, radius: -33.5, limit: -44 };
    const probed = await build({
      ...dto,
      ...probes,
      ...(dto.q === undefined ? {} : { q: 'ZQNAME' }),
    });
    const nameOf = new Map<unknown, string>([
      ...Object.entries(probes).map(([k, v]) => [v, k] as [unknown, string]),
      // 店名は ILIKE のワイルドカードに包まれて渡る
      ['%ZQNAME%', 'q'],
    ]);
    const paramNames = probed.values.map((v) => {
      const found = nameOf.get(v);
      // 番兵に無い値が混ざったら «何を渡せばいいか分からない» ので落とす
      expect(found).toBeDefined();
      return found;
    });

    if (process.env.UPDATE_RESTAURANT_SQL_SNAPSHOT) {
      writeFileSync(sqlPath, `${built.sql.trim()}\n`);
      writeFileSync(paramsPath, `${JSON.stringify(paramNames, null, 2)}\n`);
    }

    // 写経ではなく «同じ 1 本» を読ませるための固定。ここが赤いなら
    // 計測スクリプトは古い SQL / 古いバインド順を測っている
    expect(readFileSync(sqlPath, 'utf-8').trim()).toBe(built.sql.trim());
    expect(JSON.parse(readFileSync(paramsPath, 'utf-8'))).toEqual(paramNames);
    // SQL のプレースホルダ個数とも一致すること
    expect((built.sql.match(/\?/g) ?? []).length).toBe(paramNames.length);
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
