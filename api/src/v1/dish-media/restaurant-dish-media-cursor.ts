// api/src/v1/dish-media/restaurant-dish-media-cursor.ts
//
// #1599 `GET /v1/restaurants/:id/dish-media` のカーソル。
//
// 形式は `"<like_count>_<dish_media_id(UUID)>"`。UUID に `_` は現れないので
// 最初の `_` で 2 つに割れる。
//
// **壊れた入力は `null`（＝先頭ページ）へ倒す。** カーソルはクライアントから来る
// 任意の文字列で、そのまま raw SQL へ流すと `'notauuid'::uuid` で PostgreSQL が
// 例外を投げ、一覧が丸ごと開けなくなる（500）。

/** 解釈できたカーソル */
export type RestaurantDishMediaCursor = {
  likeCount: number;
  mediaId: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `like_count` と `dish_media_id` からカーソル文字列を作る */
export function formatRestaurantDishMediaCursor(
  likeCount: number,
  mediaId: string,
): string {
  return `${likeCount}_${mediaId}`;
}

/** カーソル文字列を解釈する。解釈できなければ `null`（先頭ページ） */
export function parseRestaurantDishMediaCursor(
  cursor: string | null | undefined,
): RestaurantDishMediaCursor | null {
  if (typeof cursor !== 'string' || cursor.length === 0) return null;

  const separatorIndex = cursor.indexOf('_');
  if (separatorIndex === -1) return null;

  const likeCountText = cursor.slice(0, separatorIndex);
  const mediaId = cursor.slice(separatorIndex + 1);

  // `Number('')` は 0 になってしまうので、空文字を先に弾く
  if (likeCountText.length === 0) return null;

  const likeCount = Number(likeCountText);
  // NaN / Infinity / 小数 を弾く。like_count は非負整数
  if (!Number.isInteger(likeCount) || likeCount < 0) return null;

  // `::uuid` へキャストするので、UUID でないものは絶対に通さない
  if (!UUID_PATTERN.test(mediaId)) return null;

  return { likeCount, mediaId };
}
