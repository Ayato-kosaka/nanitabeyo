// api/src/v1/dish-media/restaurant-dish-media-cursor.spec.ts
//
// #1599 `GET /v1/restaurants/:id/dish-media` のカーソル検証。
//
// ここが無かったせいで、壊れたカーソルが raw SQL の `${mediaId}::uuid` まで届き、
// **PostgreSQL の `invalid input syntax for type uuid` で 500** になっていた。
// カーソルは `@IsString()` しか掛かっていないので、任意の文字列が届く。

import {
  formatRestaurantDishMediaCursor,
  parseRestaurantDishMediaCursor,
} from './restaurant-dish-media-cursor';

const UUID = '3f1a2b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b';

describe('#1599 restaurant dish-media カーソル', () => {
  it('往復して同じ値になる', () => {
    const cursor = formatRestaurantDishMediaCursor(12, UUID);
    expect(cursor).toBe(`12_${UUID}`);
    expect(parseRestaurantDishMediaCursor(cursor)).toEqual({
      likeCount: 12,
      mediaId: UUID,
    });
  });

  it('いいね 0 件のカーソルも通る（0 は有効な値）', () => {
    expect(parseRestaurantDishMediaCursor(`0_${UUID}`)).toEqual({
      likeCount: 0,
      mediaId: UUID,
    });
  });

  // ここが本題。どれも以前は raw SQL まで到達していた。
  it.each([
    ['区切りが無い', 'abc'],
    ['UUID でない', '1_notauuid'],
    ['UUID が空', '1_'],
    ['いいね数が数値でない', `abc_${UUID}`],
    ['いいね数が空', `_${UUID}`],
    ['いいね数が負', `-1_${UUID}`],
    ['いいね数が小数', `1.5_${UUID}`],
    ['いいね数が Infinity', `Infinity_${UUID}`],
    ['SQL に見える文字列', `1_'; DROP TABLE dish_media; --`],
    ['空文字', ''],
    ['null', null],
    ['undefined', undefined],
  ])('壊れたカーソル（%s）は null（先頭ページ）へ倒す', (_label, input) => {
    expect(
      parseRestaurantDishMediaCursor(input as string | null | undefined),
    ).toBeNull();
  });

  // UUID に `_` は現れないので、最初の `_` で割って問題ない
  it('UUID 部分に `_` が混ざっていたら弾く', () => {
    expect(parseRestaurantDishMediaCursor('1_3f1a2b4c_5d6e')).toBeNull();
  });
});
