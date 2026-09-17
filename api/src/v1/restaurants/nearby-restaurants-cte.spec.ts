import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  knnCandidateLimit,
  nearbyRestaurantsCte,
} from './nearby-restaurants-cte';

/*
#1666 **営業時間の引き上げは、店提案の本体クエリと «同じ候補集合» を対象にする。**

以前 `fetchRestaurantOpeningStatuses` は `restaurant_opening_hours` を
**曜日でしか絞っていなかった**。営業時間データを持つ店が少ないうちは軽いが、
#1666 のクローラでテーブルが埋まると 620,000 店 × 曜日 2 日ぶん ≒ **124 万行**を
検索 1 回ごとに引き上げる。「今は空だから速い」だけの時限爆弾で、
クローラを入れる PR より先に塞ぐ必要があった（着手前提条件）。

守り方は #1798（使える dish_media の判定）と同じで、**絞り込みを 1 箇所に定義して
両方が埋め込む**。片方だけ書き戻すとここが落ちる。
*/

const read = (...p: string[]) => readFileSync(join(__dirname, ...p), 'utf-8');
const OPENING_STATUS_SOURCE = read('restaurant-opening-status.ts');
const DISH_MEDIA_SOURCE = read('..', 'dish-media', 'dish-media.repository.ts');

describe('#1666 近くの店の候補集合は 1 箇所で定義する', () => {
  const CONSUMERS: [string, string][] = [
    ['店提案の本体クエリ', DISH_MEDIA_SOURCE],
    ['営業時間の引き上げ', OPENING_STATUS_SOURCE],
  ];

  it.each(CONSUMERS)(
    '%s が nearbyRestaurantsCte を使っている',
    (_label, source) => {
      expect(source).toContain('nearbyRestaurantsCte');
    },
  );

  /*
  ⚠️ ここが再発防止の要。どちらかが自前で ST_DWithin を書き始めたら、
     «本体は 1,000 店を見ているのに営業時間は 62 万店ぶん引く» というずれが作れる。
  */
  it.each(CONSUMERS)('%s は絞り込みを自前で書いていない', (_label, source) => {
    expect(source).not.toMatch(/ST_DWithin\(/);
    expect(source).not.toMatch(/candidates_radius AS \(/);
  });

  it('営業時間の 2 テーブルは、どちらも候補集合と JOIN してから引く', () => {
    for (const table of [
      'restaurant_opening_hours',
      'restaurant_hours_exceptions',
    ]) {
      const start = OPENING_STATUS_SOURCE.indexOf(`FROM ${table} `);
      expect(start).toBeGreaterThan(-1);
      // その FROM 句の直後に候補集合との JOIN が続いていること
      expect(OPENING_STATUS_SOURCE.slice(start, start + 200)).toMatch(
        /JOIN nearby_restaurants nr ON nr\.restaurant_id =/,
      );
    }
  });

  /*
  以前 Prisma の findMany で「曜日だけ」を条件にしていた形へ戻っていないこと。
  戻すと型は通り、テーブルが空のうちはテストも通り、**本番で埋まった日にだけ落ちる**。
  */
  it('曜日だけ / 例外日だけを条件にした findMany へ戻っていない', () => {
    expect(OPENING_STATUS_SOURCE).not.toContain(
      'tx.restaurant_opening_hours.findMany',
    );
    expect(OPENING_STATUS_SOURCE).not.toContain(
      'tx.restaurant_hours_exceptions.findMany',
    );
  });
});

describe('#1666 KNN の候補数', () => {
  it('下限 1000 件（返却件数が小さくても候補は痩せさせない）', () => {
    expect(knnCandidateLimit(5)).toBe(1000);
    expect(knnCandidateLimit(1)).toBe(1000);
  });

  it('返却件数が大きいときは 50 倍まで広げる', () => {
    expect(knnCandidateLimit(100)).toBe(5000);
  });

  /*
  ⚠️ 索引に乗る書き方であること。ST_DWithin と KNN 演算子（<->）を外すと
     «索引には乗っているのに遅い» へ静かに戻る（#1629 の実測: 半径 5km の東京駅で 9.3 秒）。
  */
  it('GIST 索引に乗る書き方（ST_DWithin + KNN）を保っている', () => {
    const sql = nearbyRestaurantsCte({
      userLat: 35,
      userLon: 139,
      radiusM: 1000,
      limit: 5,
    }).sql;

    expect(sql).toContain('ST_DWithin(');
    expect(sql).toContain('<->');
    expect(sql).toContain('LIMIT (SELECT knn_limit FROM knn_params)');
    // 索引に乗らない «バウンディングボックス + acos» へ戻っていない
    expect(sql).not.toMatch(/acos\(/);
  });

  it('半径と KNN の上限はバインド変数で渡す（SQL へ直接埋め込まない）', () => {
    const built = nearbyRestaurantsCte({
      userLat: 35,
      userLon: 139,
      radiusM: 1234,
      limit: 5,
    });

    expect(built.sql).not.toContain('1234');
    expect(built.values).toEqual(expect.arrayContaining([139, 35, 1234, 1000]));
  });
});
