/*
#1782 完了条件 3「usable dish_media の判定が本番コードから抜き出されており、
**二重定義になっていない**」を満たすための橋渡し。

## 何が起きていたか

判定は #1798 で `usable-dish-media-filter.ts` へ 1 本化した。ところが coverage 計測
（`scripts/db-checks/dish_media_coverage_sql.py`）は **Python 側に同じ 4 条件を
手で書き写して持っていた**。行番号のコメント（`dish-media.repository.ts:236` 等）まで
写してあり、#1798 と #1666 で行が動いた時点で**既に指していない**。

これは «判定を 2 箇所に書くと必ずずれる» の実例そのものである（2026-08-28 に fixture で、
08-29 に検知 SQL で同じ形の事故が起きている）。計測側が古い判定のまま緑を出し続けると、
**「Google を外せるか」の判断材料が静かに嘘になる。**

## 直し方

本番の `USABLE_DISH_MEDIA_CONDITIONS` を `scripts/db-checks/sql/` へ書き出し、
Python は**そのファイルを読む**。#1629 の SQL 写経事故と同じ作法（あちらは
`restaurants.order-by-posts-plan.spec.ts` が同じことをしている）。

スナップショットを更新するとき（＝ 判定を意図的に変えたとき）:

    UPDATE_RESTAURANT_SQL_SNAPSHOT=1 pnpm --filter api exec jest usable-dish-media-filter.spec.snapshot
*/
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { USABLE_DISH_MEDIA_CONDITIONS } from './usable-dish-media-filter';

const SQL_PATH = join(
  __dirname,
  '../../../../scripts/db-checks/sql/usable_dish_media_conditions.sql',
);

const HEADER = [
  '-- 自動生成。手で書かない。',
  '-- 正本: api/src/v1/dish-media/usable-dish-media-filter.ts',
  '-- 書き出し: UPDATE_RESTAURANT_SQL_SNAPSHOT=1 pnpm --filter api exec jest usable-dish-media-filter.spec.snapshot',
  '--',
  '-- dish_media のエイリアスは dm であることが前提（埋め込み先で必ず dm を使う）。',
  '-- WHERE 句の末尾へそのまま連結できるよう、各行が AND で始まる。',
].join('\n');

describe('#1782 usable の判定は計測スクリプトとも 1 本を共有する', () => {
  it('scripts/db-checks/sql へ書き出したものが本番の定義と一致する', () => {
    const expected = `${HEADER}\n${USABLE_DISH_MEDIA_CONDITIONS.sql.trim()}\n`;

    if (process.env.UPDATE_RESTAURANT_SQL_SNAPSHOT) {
      writeFileSync(SQL_PATH, expected);
    }

    // ここが赤いなら、coverage 計測は古い判定で測っている
    expect(readFileSync(SQL_PATH, 'utf-8')).toBe(expected);
  });

  /*
  ⚠️ 値を埋め込まないこと。埋め込むと Python 側がバインドできず、
     «測るときだけ条件が変わる» 抜け道ができる。
  */
  it('書き出したものにバインド変数が含まれていない（そのまま埋め込める）', () => {
    expect(USABLE_DISH_MEDIA_CONDITIONS.values).toEqual([]);
    expect(USABLE_DISH_MEDIA_CONDITIONS.sql).not.toContain('?');
  });
});
