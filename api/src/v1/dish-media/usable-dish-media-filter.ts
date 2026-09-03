// api/src/v1/dish-media/usable-dish-media-filter.ts
//
// #1798 「使える dish_media」の判定を 1 箇所へ引き出す。
//
// 【なぜ切り出すか】
// `findDishMediaIds`（店提案）と `findDishMediaByRestaurant`（店舗詳細）が
// 同じ判定をそれぞれ生 SQL へ書いていた結果、後者だけ `playback_status` の
// 除外が追随せず既にずれていた（#1798）。以後は判定をここへ 1 本化し、
// 両方の生 SQL がこの `Prisma.sql` フラグメントを埋め込む形にする。
// 片方だけへコピペし直すと usable-dish-media-filter.spec.ts が落ちる。
//
// 【埋め込み先の前提】
// dish_media は必ずエイリアス `dm` を使うこと（`dm.deleted_at` / `dm.user_id` /
// `dm.media_processing_status` / `dm.id` を参照する）。
//
// 【4条件それぞれの理由】
// - `dm.deleted_at IS NULL`
//   #1513 論理削除済みの投稿はどの経路にも出さない
// - 投稿者が退会していない
//   #1511 投稿・レビューには専用の削除カラムを持たせておらず、作者の
//   `users.deleted_at` を辿って判定する（アカウント削除は users 行を残したまま
//   `deleted_at` を立てる設計のため）
// - `dm.media_processing_status = 'completed'`
//   #1257 実体（GCS original）が届いていない行を「原本到達の代理指標」で除外する。
//   processing のまま固着した行と failed 行は原因が違うだけでどちらも公開してはいけない
// - 埋め込みが再生不能と分かっていない
//   #1641 権利ブロックや埋め込み非許可の YouTube 動画など、開いても再生できないと
//   分かっている埋め込みは出さない。**`unknown`（判定できなかった）は弾かない**
//   （provider が仕様を変えた日に取り込み済みの投稿が一斉に消えるのを避けるため）。
//   等値/不等値比較で書くと、取り込み以外の投稿（dmee 行を持たない）が NULL 比較で
//   全部落ちるため、必ず NOT EXISTS で書く

import { Prisma } from '../../../../shared/prisma/client';

export const USABLE_DISH_MEDIA_CONDITIONS = Prisma.sql`
  AND dm.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = dm.user_id
      AND u.deleted_at IS NOT NULL
  )
  AND dm.media_processing_status = 'completed'
  AND NOT EXISTS (
    SELECT 1 FROM dish_media_external_embeddings dmee
    WHERE dmee.dish_media_id = dm.id
      AND dmee.playback_status = 'not_playable'
  )
`;
