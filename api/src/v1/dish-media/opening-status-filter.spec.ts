// api/src/v1/dish-media/opening-status-filter.spec.ts
//
// #1666 「営業時間が分かっていて、今閉まっている」店が検索候補から外れていること、
// および「開いている」店だけがスコアの加点対象になっていることを静的に固定する。
//
// #1641（search-playback-filter.spec.ts）と同じ理由で、DB を立てずに検証できるのは
// «どう問い合わせるか» までだが、この不変条件はまさにクエリの形の問題なので、
// 形が崩れたら落ちるようにしておく。実際の3値判定ロジック自体は
// `shared/utils/openingHours.ts`（純関数）の unit test（openingHours.test.ts）が固定する。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE = readFileSync(
  join(__dirname, 'dish-media.repository.ts'),
  'utf8',
);

const baseCandidates = (() => {
  const start = SOURCE.indexOf('base_candidates AS (');
  expect(start).toBeGreaterThan(-1);
  const end = SOURCE.indexOf('-- 距離計算', start);
  expect(end).toBeGreaterThan(start);
  return SOURCE.slice(start, end);
})();

const openFlags = (() => {
  const start = SOURCE.indexOf('open_flags AS (');
  expect(start).toBeGreaterThan(-1);
  const end = SOURCE.indexOf('fatigue_marked AS (', start);
  expect(end).toBeGreaterThan(start);
  return SOURCE.slice(start, end);
})();

describe('#1666 検索候補は「分かっていて閉まっている」店を除外する', () => {
  it('base_candidates で closedRestaurantIds を除外している', () => {
    expect(baseCandidates).toContain(
      'NOT (d.restaurant_id = ANY(${closedRestaurantIds}::uuid[]))',
    );
  });

  /*
  ⚠️ ここが要。#1641 と同じ理由で **`ROW_NUMBER`（代表1本の選抜）より前**でなければ、
     代表選びの後で弾くことになり «その料理ごと消える» 事故になる。
  */
  it('除外は ROW_NUMBER（代表 1 本の選抜）より前に置かれている', () => {
    const filterAt = SOURCE.indexOf(
      'NOT (d.restaurant_id = ANY(${closedRestaurantIds}::uuid[]))',
    );
    const rowNumberAt = SOURCE.indexOf('ROW_NUMBER() OVER');
    expect(filterAt).toBeGreaterThan(-1);
    expect(rowNumberAt).toBeGreaterThan(-1);
    expect(filterAt).toBeLessThan(rowNumberAt);
  });

  it('open_flags は openRestaurantIds を見て is_open_at を決めている（3値の open のみ加点）', () => {
    expect(openFlags).toContain(
      '(g.restaurant_id = ANY(${openRestaurantIds}::uuid[])) AS is_open_at',
    );
  });

  /*
  ⚠️ 実在しない `restaurant_open_hours`（#1666 コメントアウトの土台が参照していた
     誤ったテーブル名）を書き戻さないこと。正しいテーブル名は `restaurant_opening_hours`。
  */
  it('実在しないテーブル名 restaurant_open_hours を参照していない', () => {
    expect(SOURCE).not.toContain('restaurant_open_hours ');
    expect(SOURCE).not.toMatch(/FROM restaurant_open_hours\b/);
  });

  it('is_open_at が固定 FALSE のまま残っていない（配線済みであることの固定）', () => {
    expect(openFlags).not.toContain('FALSE AS is_open_at');
  });
});
