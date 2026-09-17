// api/src/v1/dish-media/usable-dish-media-filter.spec.ts
//
// #1798 「再生できない投稿が、店提案には出ないのに店舗詳細には出る」の再発防止。
//
// 原因は「使える dish_media」の判定が findDishMediaIds（店提案）と
// findDishMediaByRestaurant（店舗詳細）に別々に書かれていて、既にずれていたこと
// （店舗詳細だけ playback_status の除外が無かった）。
//
// 修正はコピペで揃えるのではなく、判定を USABLE_DISH_MEDIA_CONDITIONS へ 1 本化し、
// 両方の生 SQL がそれを埋め込む形にした。このテストは「両方が同じフラグメントを
// 参照しているか」を静的に検査する。**片方だけ元の個別条件へ書き戻す／片方の
// 参照を消す**とここが赤くなる（このテストを一時的に無効化して確認した結果は
// PR 本文に貼ってある）。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPOSITORY_SOURCE = readFileSync(
  join(__dirname, 'dish-media.repository.ts'),
  'utf8',
);
const FILTER_SOURCE = readFileSync(
  join(__dirname, 'usable-dish-media-filter.ts'),
  'utf8',
);

describe('#1798 usable-dish-media-filter の定義そのもの', () => {
  it('4条件（論理削除 / 退会 / 実体到達 / 再生可否）を全て含む', () => {
    expect(FILTER_SOURCE).toContain('dm.deleted_at IS NULL');
    expect(FILTER_SOURCE).toMatch(
      /NOT EXISTS \(\s*SELECT 1 FROM users u\s*WHERE u\.id = dm\.user_id\s*AND u\.deleted_at IS NOT NULL/,
    );
    expect(FILTER_SOURCE).toContain("dm.media_processing_status = 'completed'");
    expect(FILTER_SOURCE).toMatch(
      /NOT EXISTS \(\s*SELECT 1 FROM dish_media_external_embeddings dmee\s*WHERE dmee\.dish_media_id = dm\.id\s*AND dmee\.playback_status = 'not_playable'/,
    );
  });
});

describe('#1798 findDishMediaIds と findDishMediaByRestaurant は同じ判定を参照する', () => {
  it('dish-media.repository.ts は usable-dish-media-filter.ts から import している', () => {
    expect(REPOSITORY_SOURCE).toContain(
      "import { USABLE_DISH_MEDIA_CONDITIONS } from './usable-dish-media-filter';",
    );
  });

  /*
  ⚠️ ここが #1798 の再発防止の要。**「使える dish_media」を選ぶ生 SQL は、
     ここに名前が挙がっているものが全部であり、どれもこの断片を埋め込む。**

     以前は «ちょうど 2 箇所» という数だけを見ていたが、消費側が増えたときに
     «数が変わった» としか言えず、増えたのが正しいのか条件を書き戻したのかを
     区別できなかった（#1780 で 3 本目が増えて実際に落ちた）。
     消費側を足すときは、**この配列へ足す**こと。それが «増やしたのは意図的だ» の宣言になる。
  */
  const CONSUMERS = [
    // 店提案（base_candidates）
    'async findDishMediaIds',
    // 店舗詳細の一覧（media_like_counts）
    'async findDishMediaByRestaurant',
    // #1780 店の代表画像に使う dish_media サムネイル
    'async findFallbackThumbnailsByRestaurantIds',
  ];

  it.each(CONSUMERS)('%s が判定を埋め込んでいる', (methodSignature) => {
    const start = REPOSITORY_SOURCE.indexOf(methodSignature);
    expect(start).toBeGreaterThan(-1);
    // 次のメソッドが始まるまでを、そのメソッドの本体とみなす
    const body = REPOSITORY_SOURCE.slice(start).split('\n  async ')[0];
    expect(body).toContain('${USABLE_DISH_MEDIA_CONDITIONS}');
  });

  it('判定を埋め込んでいる生 SQL は、上の一覧に挙げたものが全部である', () => {
    const occurrences =
      REPOSITORY_SOURCE.split('${USABLE_DISH_MEDIA_CONDITIONS}').length - 1;
    expect(occurrences).toBe(CONSUMERS.length);
  });

  it('findDishMediaByRestaurant 側にも埋め込まれている（店舗詳細で playback_status の除外が効く）', () => {
    const start = REPOSITORY_SOURCE.indexOf('async findDishMediaByRestaurant');
    expect(start).toBeGreaterThan(-1);
    const restaurantMethodSource = REPOSITORY_SOURCE.slice(start);
    expect(restaurantMethodSource).toContain('${USABLE_DISH_MEDIA_CONDITIONS}');

    // #1798 以前はここに条件が個別にコピペされていた。書き戻されていないことを確認する
    expect(restaurantMethodSource.split('async find')[0]).not.toMatch(
      /dmee\.playback_status/,
    );
  });

  it('findDishMediaByRestaurant 側の埋め込みは代表1本を選ぶ ROW_NUMBER より前に置かれている', () => {
    const start = REPOSITORY_SOURCE.indexOf('async findDishMediaByRestaurant');
    expect(start).toBeGreaterThan(-1);
    const restaurantMethodSource = REPOSITORY_SOURCE.slice(start);
    const filterAt = restaurantMethodSource.indexOf(
      '${USABLE_DISH_MEDIA_CONDITIONS}',
    );
    const rowNumberAt = restaurantMethodSource.indexOf('ROW_NUMBER() OVER');
    expect(filterAt).toBeGreaterThan(-1);
    expect(rowNumberAt).toBeGreaterThan(-1);
    expect(filterAt).toBeLessThan(rowNumberAt);
  });
});
