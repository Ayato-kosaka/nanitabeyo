// api/src/v1/dish-categories/season-fallback-keys.spec.ts
//
// #737 季節補正の入力側（月の導出とフォールバックキーの組み立て）を検査する。
//
// スコア補正そのもの（`final_score × (1 - w + w × season_score)`）は Postgres の SQL 側にあり、
// ここでは検査しない。代わりに「SQL へ渡す前に壊れていないこと」だけを固定する:
//   1. 月の導出が Cloud Run の TZ（UTC）に引きずられないこと
//   2. フォールバックの末尾が必ず global になること（JP 以外の地点でも補正が届く経路が残ること）
//
import {
  buildSeasonFallbackKeys,
  getCurrentMonthKey,
} from '../../core/utils/backend-utils';

describe('#737 getCurrentMonthKey', () => {
  it('"01"〜"12" の 2 桁で返す', () => {
    expect(getCurrentMonthKey(new Date('2026-01-15T00:00:00Z'))).toBe('01');
    expect(getCurrentMonthKey(new Date('2026-08-25T00:00:00Z'))).toBe('08');
    expect(getCurrentMonthKey(new Date('2026-12-01T00:00:00Z'))).toBe('12');
  });

  it('サーバの TZ ではなく Asia/Tokyo で判定する', () => {
    // UTC では 7 月 31 日 だが、JST では 8 月 1 日。Cloud Run は TZ=UTC で動くので、
    // ここが UTC 判定だと月末の 9 時間だけ前月の季節スコアが当たってしまう。
    const justAfterJstMonthTurn = new Date('2026-07-31T15:30:00Z');

    expect(getCurrentMonthKey(justAfterJstMonthTurn)).toBe('08');
  });

  it('JST の月初直前は前月のまま', () => {
    // UTC 07-31T14:59 = JST 07-31T23:59
    expect(getCurrentMonthKey(new Date('2026-07-31T14:59:00Z'))).toBe('07');
  });
});

describe('#737 buildSeasonFallbackKeys', () => {
  // service の normalizeInput が作る実際の形（狭い地域 → 広い地域 → global）
  const regionFallbackKeys = [
    'region:locality:大阪市',
    'region:administrative_area_level_1:大阪府',
    'region:country:JP',
    'global',
  ];

  it('各地域キーへ月を付け、順序を保つ', () => {
    expect(buildSeasonFallbackKeys(regionFallbackKeys, '08')).toEqual([
      'region:locality:大阪市:month:08',
      'region:administrative_area_level_1:大阪府:month:08',
      'region:country:JP:month:08',
      'global:month:08',
    ]);
  });

  it('末尾は必ず global:month:MM になる', () => {
    // #737 【重要】JP のデータしか投入しないが、JP 以外の地点から来たときに
    // 何にも当たらないと季節補正が一切効かなくなる。global のキーは
    // データの有無にかかわらず常に候補へ残しておく（オーナー指示）。
    const overseas = ['region:country:BR', 'global'];

    const keys = buildSeasonFallbackKeys(overseas, '01');

    expect(keys[keys.length - 1]).toBe('global:month:01');
  });

  it('地域トークンが global だけでも成立する', () => {
    expect(buildSeasonFallbackKeys(['global'], '12')).toEqual([
      'global:month:12',
    ]);
  });
});
