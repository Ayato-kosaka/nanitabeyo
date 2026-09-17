// api/src/v1/dish-media/dish-media-thumbnail.ts
//
// #511 / #1395 / #1780 dish_media のサムネイル URL の組み立ての正本。
//
// 【なぜ関数へ引き出すか】
// #1780 で「店の画像を dish_media のサムネイルから出す」ことが決まり、
// `RestaurantsAssembler` も同じ URL を組み立てる必要が出た。ところが
// `DishMediaAssembler` は `RestaurantsAssembler` を注入しているので、逆向きに
// 注入すると Assembler 同士が循環する。**組み立てを写すと «片方だけ直った» が起きる**
// （`thumbnail_processing_status` で参照先が変わるため）ので、依存の向きを増やさずに
// 共有できる純粋関数として置く。以後、サムネイル URL の規則はここだけが持つ。

import { StorageService } from '../../core/storage/storage.service';
import { buildResizedPath } from '../../core/storage/storage.utils';
import { MediaProcessingStatus } from '@shared/v1/res';
import { env } from '../../core/config/env';

/**
 * サムネイル URL の組み立てに必要な最小限の列。
 *
 * #1395 サムネイルは全 provider について取り込み時に自ストレージへ保存する
 * （統一キャッシュ方式）ので、`render_type` によらず必要な列はこの 3 つだけである。
 */
export type ThumbnailUrlSource = {
  id: string;
  thumbnail_path: string;
  thumbnail_processing_status: string;
};

/**
 * #511 【設計】GCS パスから CDN URL を生成する
 */
export function buildCdnUrlFromPath(gcsPath: string): string {
  return `https://${env.CDN_HOST}/${gcsPath}`;
}

/**
 * #511 【設計】dish_media エンティティからサムネイル画像の URL を生成
 *
 * `thumbnail_processing_status` が 'completed' ならリサイズ済みパス、
 * それ以外はオリジナルパスを指す。
 *
 * ⚠️ #1399 `thumbnail_path` が空の行では **null を返す**。SNS 取り込み
 * （render_type='external_embed'）は自ストレージにサムネイルを持たず
 * `thumbnail_path: ''` で作られる。ここを guard しないと
 * `buildResizedPath` が `Invalid originalPath` を throw し、その行を含む
 * **一覧・フィード全体が 500 になる**（実際に my-dishes が
 * 「データの読み込みに失敗しました」で全滅した）。
 *
 * ⚠️ 焼いてある派生サイズは **256 の 1 本だけ**である（`dish-media.service.ts` が
 * enqueue するのがそれだけ）。他のサイズを組み立てても実体が無く 404 になる。
 */
export function buildDishMediaThumbnailUrl(
  storage: StorageService,
  dishMedia: ThumbnailUrlSource,
): string | null {
  if (!dishMedia.thumbnail_path) return null;

  const status =
    dishMedia.thumbnail_processing_status as MediaProcessingStatus | null;

  if (status === 'completed') {
    // リサイズ済みサムネイルパス
    const cdnUrl = buildResizedPath(
      {
        table: 'dish_media',
        column: 'thumbnail_path',
        recordId: dishMedia.id,
        size: 256,
        originalPath: dishMedia.thumbnail_path,
      },
      'cdn',
    );
    return storage.generateCdnSignedURL(cdnUrl);
  }

  // #511 【設計】未完了時はオリジナルパスの CDN Signed URL を返す
  return storage.generateCdnSignedURL(
    buildCdnUrlFromPath(dishMedia.thumbnail_path),
  );
}
