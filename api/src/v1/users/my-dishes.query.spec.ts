import { BadRequestException } from '@nestjs/common';
import {
  buildMyDishKeysetPredicate,
  buildMyDishOrderBy,
  decodeMyDishCursor,
  encodeMyDishCursor,
  hasRatingFilter,
  isBranchSkippableByCursor,
} from './my-dishes.query';

/**
 * #1395 B-1 の回帰テスト。
 *
 * 「`-rating` ソートで want 行（評価なし）が 2 ページ目以降も返ること」が
 * この Issue の Blocker だったので、そこを最重要に固める。
 */
describe('my-dishes cursor (-rating)', () => {
  const wantRow = {
    row_key: 'dish:11111111-1111-1111-1111-111111111111',
    occurred_at: new Date('2026-08-19T10:00:00.000Z'),
    rating: null,
    distance_meters: null,
    feature_score: null,
  };
  const eatenRow = {
    row_key: 'review:22222222-2222-2222-2222-222222222222',
    occurred_at: new Date('2026-08-18T09:30:00.000Z'),
    rating: 4,
    distance_meters: null,
    feature_score: null,
  };

  it('評価なしの行を "null" という文字列へ落とさない', () => {
    const cursor = encodeMyDishCursor('-rating', wantRow);

    // テンプレートリテラルで `${row.rating}` と書くと "null" が混ざる。それを禁じる
    expect(cursor).not.toContain('null');
    expect(cursor).toBe(`1||2026-08-19T10:00:00.000Z|${wantRow.row_key}`);
  });

  it('評価なしの行を往復できる（NaN にならない）', () => {
    const decoded = decodeMyDishCursor(
      '-rating',
      encodeMyDishCursor('-rating', wantRow),
    );

    expect(decoded).toEqual({
      sort: '-rating',
      ratingIsNull: true,
      rating: null,
      occurredAt: wantRow.occurred_at,
      key: wantRow.row_key,
    });
  });

  it('評価ありの行を往復できる', () => {
    const decoded = decodeMyDishCursor(
      '-rating',
      encodeMyDishCursor('-rating', eatenRow),
    );

    expect(decoded).toEqual({
      sort: '-rating',
      ratingIsNull: false,
      rating: 4,
      occurredAt: eatenRow.occurred_at,
      key: eatenRow.row_key,
    });
  });

  it('NULL 判定を第1ソートキーへ持ち上げ、want 行を末尾に置く', () => {
    const orderBy = buildMyDishOrderBy('-rating').sql;

    // NULLS LAST だけでは 2 ページ目以降の脱落が直らないので、判定そのものを第1キーにする
    expect(orderBy.replace(/\s+/g, ' ').trim()).toBe(
      '(rating IS NULL) ASC, rating DESC, occurred_at DESC, row_key DESC',
    );
  });

  /**
   * ここが Blocker 本体。
   *
   * 1 ページ目の末尾が eaten 行（rating あり）のとき、2 ページ目のカーソルは
   * ratingIsNull=false になる。このとき want 行は
   * 「(rating IS NULL)::int = 1 > 0」で**必ず通る**必要がある。
   * 素朴な `(rating, occurred_at, key) < ($r, $o, $k)` だと want 行に対して
   * unknown を返し、WHERE が偽として扱うため 1 件も返らなくなる。
   */
  it('カーソルが eaten 行にあるとき、want 枝は落ちない', () => {
    const cursor = decodeMyDishCursor(
      '-rating',
      encodeMyDishCursor('-rating', eatenRow),
    );

    expect(isBranchSkippableByCursor('want', cursor)).toBe(false);

    const predicate = buildMyDishKeysetPredicate(cursor);
    const sql = predicate.sql.replace(/\s+/g, ' ');

    // rating IS NULL の行を通す枝（n > cn）が最初に来ていること
    expect(sql).toContain('((rating IS NULL)::int) > ');
    // rating の比較は「cn = 0（eaten 区画）」に閉じ込められていること
    expect(sql).toContain('= 0 AND ( rating < ');
    // カーソル値は 0（= 評価あり）で渡っている
    expect(predicate.values).toContain(0);
    expect(predicate.values).toContain(4);
  });

  it('カーソルが want 行にあるとき、want は日時で進み eaten 枝は省略できる', () => {
    const cursor = decodeMyDishCursor(
      '-rating',
      encodeMyDishCursor('-rating', wantRow),
    );

    // want 区画に入った後は、eaten 行はもう 1 件も出ない（n=0 は n=1 より前）
    expect(isBranchSkippableByCursor('eaten', cursor)).toBe(true);
    // want 枝は絶対に省略しない
    expect(isBranchSkippableByCursor('want', cursor)).toBe(false);

    const predicate = buildMyDishKeysetPredicate(cursor);
    expect(predicate.values).toContain(1);
    expect(predicate.values).toContain(wantRow.row_key);
    // 評価なしのカーソルなので rating の値は渡らない（NULL のみ）
    expect(predicate.values).not.toContain(4);
  });

  it('want / eaten の順序が「評価あり → 評価なし」になる', () => {
    // ORDER BY の第1キーが (rating IS NULL) ASC なので 0（評価あり）が先、1（want）が後。
    // 実 DB を使わずに、同じ規則を JS で再現して仕様を明文化しておく
    const rows = [wantRow, eatenRow];
    const sorted = [...rows].sort((a, b) => {
      const an = a.rating === null ? 1 : 0;
      const bn = b.rating === null ? 1 : 0;
      if (an !== bn) return an - bn;
      return (b.rating ?? 0) - (a.rating ?? 0);
    });

    expect(sorted.map((r) => r.row_key)).toEqual([
      eatenRow.row_key,
      wantRow.row_key,
    ]);
  });
});

describe('my-dishes cursor (その他の sort)', () => {
  const row = {
    row_key: 'review:33333333-3333-3333-3333-333333333333',
    occurred_at: new Date('2026-08-19T10:00:00.000Z'),
    rating: 5,
    distance_meters: 1234.5,
    feature_score: 0.75,
  };

  it('-occurredAt は (occurred_at, row_key) の 2 要素で降順に進む', () => {
    const cursor = decodeMyDishCursor(
      '-occurredAt',
      encodeMyDishCursor('-occurredAt', row),
    );
    expect(cursor).toEqual({
      sort: '-occurredAt',
      occurredAt: row.occurred_at,
      key: row.row_key,
    });

    const predicate = buildMyDishKeysetPredicate(cursor);
    expect(predicate.sql.replace(/\s+/g, ' ')).toContain(
      '(occurred_at, row_key) < (',
    );
  });

  it('occurredAt（昇順）は比較演算子が反転する', () => {
    const cursor = decodeMyDishCursor(
      'occurredAt',
      encodeMyDishCursor('occurredAt', row),
    );
    expect(buildMyDishKeysetPredicate(cursor).sql).toContain(
      '(occurred_at, row_key) > (',
    );
  });

  it('distance は距離を往復できる（浮動小数の桁落ちが無い）', () => {
    const cursor = decodeMyDishCursor(
      'distance',
      encodeMyDishCursor('distance', row),
    );
    expect(cursor).toEqual({
      sort: 'distance',
      distanceMeters: 1234.5,
      key: row.row_key,
    });
  });

  it('特徴量スコアは (score, occurred_at, row_key) の 3 要素', () => {
    const cursor = decodeMyDishCursor(
      '-featureScore',
      encodeMyDishCursor('-featureScore', row),
    );
    expect(cursor).toEqual({
      sort: '-featureScore',
      score: 0.75,
      occurredAt: row.occurred_at,
      key: row.row_key,
    });
    expect(buildMyDishOrderBy('-featureScore').sql).toContain(
      'feature_score DESC',
    );
  });

  it('カーソルが無ければ述語は TRUE（全件が対象）', () => {
    expect(buildMyDishKeysetPredicate(null).sql.trim()).toBe('TRUE');
  });
});

describe('my-dishes cursor の異常系', () => {
  it.each([
    ['-rating', 'こわれた'],
    ['-rating', '1|4|2026-08-19T10:00:00.000Z|dish:x'], // NULL フラグと値が矛盾
    ['-rating', '0||2026-08-19T10:00:00.000Z|dish:x'], // 評価ありなのに値が空
    ['-rating', '2|4|2026-08-19T10:00:00.000Z|dish:x'], // フラグが 0/1 以外
    ['-occurredAt', 'not-a-date|dish:x'],
    ['-occurredAt', '2026-08-19T10:00:00.000Z'], // 要素不足
    ['distance', 'abc|dish:x'],
  ] as const)('%s の壊れたカーソル "%s" は 400 で落とす', (sort, raw) => {
    expect(() => decodeMyDishCursor(sort, raw)).toThrow(BadRequestException);
  });
});

describe('評価フィルタの契約（m-4）', () => {
  it('minRating / ratings のいずれかがあれば「評価フィルタあり」', () => {
    expect(hasRatingFilter({})).toBe(false);
    expect(hasRatingFilter({ ratings: [] })).toBe(false);
    expect(hasRatingFilter({ minRating: 4 })).toBe(true);
    expect(hasRatingFilter({ ratings: [5] })).toBe(true);
  });
});
