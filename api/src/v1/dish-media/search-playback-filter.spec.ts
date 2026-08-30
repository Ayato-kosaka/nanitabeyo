// api/src/v1/dish-media/search-playback-filter.spec.ts
//
// #1641 **«埋め込みで再生できない» と判定済みの投稿が、検索フィードの候補集合から
// 外れていること**を静的に固定する。
//
// ## なぜ形を固定するのか
//
// オーナー指摘 2026-08-28:「検索タブのお店提案では出さないで欲しい」。
// この除外は **`base_candidates`（`ROW_NUMBER` より前）に置かないと効かない**。
// 検索は «1 つの dish につき代表 1 本» を後段の `ROW_NUMBER` で選ぶので、
// 再生できない投稿が代表に選ばれてから弾くと、**その料理が丸ごとフィードから消える**。
// 同じ罠を #1257（実体未着メディア）で 1 度踏んでいる。
//
// DB を立てずに検証できるのは «どう問い合わせるか» までだが、この不変条件は
// まさにクエリの形の問題なので、形が崩れたら落ちるようにしておく。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE = readFileSync(
  join(__dirname, 'dish-media.repository.ts'),
  'utf8',
);

/** `findDishMediaIds` が組み立てる CTE の本文だけを切り出す */
const baseCandidates = (() => {
  const start = SOURCE.indexOf('base_candidates AS (');
  expect(start).toBeGreaterThan(-1);
  const end = SOURCE.indexOf('-- 距離計算', start);
  expect(end).toBeGreaterThan(start);
  return SOURCE.slice(start, end);
})();

describe('#1641 検索フィードは not_playable の埋め込みを候補に入れない', () => {
  it('base_candidates で not_playable を除外している', () => {
    expect(baseCandidates).toContain('dish_media_external_embeddings dmee');
    expect(baseCandidates).toContain("dmee.playback_status = 'not_playable'");
  });

  /*
  ⚠️ ここが要。**`ROW_NUMBER` より前**でなければ、代表選びの後で弾くことになり
     «その料理ごと消える» 事故になる。
  */
  it('除外は ROW_NUMBER（代表 1 本の選抜）より前に置かれている', () => {
    const filterAt = SOURCE.indexOf("dmee.playback_status = 'not_playable'");
    const rowNumberAt = SOURCE.indexOf('ROW_NUMBER() OVER');
    expect(filterAt).toBeGreaterThan(-1);
    expect(rowNumberAt).toBeGreaterThan(-1);
    expect(filterAt).toBeLessThan(rowNumberAt);
  });

  /*
  ⚠️ 取り込み以外の投稿（自撮り）は `dish_media_external_embeddings` の行を持たない。
     `dmee.playback_status <> 'not_playable'` のような等値／不等値比較で書くと
     **NULL 比較になって候補が全部落ちる**。NOT EXISTS でしか書けない。
  */
  it('LEFT JOIN の不等値比較ではなく NOT EXISTS で書いている', () => {
    expect(baseCandidates).toMatch(
      /AND NOT EXISTS \(\s*SELECT 1 FROM dish_media_external_embeddings dmee/,
    );
    expect(baseCandidates).not.toMatch(/dmee\.playback_status\s*(<>|!=)/);
  });

  /*
  ⚠️ **`unknown` を弾かない。** TikTok は判定材料が無く常に `unknown` である。
     ここで «playable 以外» を弾くと、**TikTok の取り込みが全部検索から消える**。
  */
  it('unknown（判定できなかった）は弾かない', () => {
    expect(baseCandidates).not.toContain("playback_status <> 'playable'");
    expect(baseCandidates).not.toContain("playback_status = 'unknown'");
  });
});
