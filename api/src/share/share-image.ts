// api/src/share/share-image.ts
//
// #721 【設計】`share_links.preview_image_path` を実際に配信できる URL へ変換する。
//
// この判定を 1 箇所に閉じるためだけのファイル。SSR（`/s/:token`）と og-image の
// リダイレクトで別々に書くと、片方だけ直したときに OGP 画像が壊れる。

import { env } from '../core/config/env';

/** `preview_image_path` の形 */
export type SharePreviewImageKind = 'absolute' | 'web-asset' | 'gcs-object';

/**
 * 保存されている `preview_image_path` がどの形かを判定する。
 *
 * | 形 | 例 | 由来 |
 * | --- | --- | --- |
 * | `absolute` | `https://upload.wikimedia.org/...` | 友達投票の候補画像（外部 URL） |
 * | `web-asset` | `/og/ja-JP.jpg` | Web 側の静的アセット（既定 OG 画像） |
 * | `gcs-object` | `production/dish_media/...jpg` | GCS のオブジェクト。**署名が要る** |
 */
export function classifySharePreviewImage(path: string): SharePreviewImageKind {
  if (/^https?:\/\//i.test(path)) return 'absolute';
  if (path.startsWith('/')) return 'web-asset';
  return 'gcs-object';
}

/**
 * 署名を必要としない形（absolute / web-asset）なら、そのまま使える URL を返す。
 * GCS オブジェクトの場合は `null`（呼び出し側が署名する）。
 */
export function toDirectImageUrl(path: string): string | null {
  switch (classifySharePreviewImage(path)) {
    case 'absolute':
      return path;
    case 'web-asset':
      return `${env.WEB_BASE_URL.replace(/\/+$/, '')}${path}`;
    case 'gcs-object':
      return null;
  }
}
