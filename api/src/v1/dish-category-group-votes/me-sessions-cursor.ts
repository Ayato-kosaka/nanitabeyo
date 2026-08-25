// api/src/v1/dish-category-group-votes/me-sessions-cursor.ts
//
// #1596 GET /v1/users/me/dish-category-group-votes のページングカーソル。
//
// ## なぜ複合キーなのか
//
// 元の実装は `updated_at` 単独の ISO 文字列で、絞り込みは `updated_at < cursor` だった。
// この形は **同じ `updated_at` を持つ行がページ境界をまたぐと、同時刻の行をまとめて飛ばす**。
// 20 件目と 21 件目が同一時刻なら、21 件目以降は一覧から永久に消える（次ページの
// 起点が 20 件目の時刻そのものなので、`<` が 21 件目も落とす）。
//
// `touchSession` は候補追加・候補削除・dish_media 固定・投票のたびに走るため、
// 同一ミリ秒に複数セッションが更新されることは «稀» であって «起きない» ではない。
//
// ## 形式
//
// `"<ISO8601>|<uuid>"`。区切りは UUID にも ISO8601 にも現れない `|` を使う。
//
// **旧形式（ISO8601 のみ）も受ける。** 配信済みクライアントが持っている次ページの
// カーソルを無効にすると、更新するまで «次を読むと落ちる» ことになるため。
// 旧形式のときは id を持たないので、従来どおり `updated_at < cursor` で絞る
// （同時刻スキップは残るが、旧クライアントの挙動を変えないほうが安全側）。

/** 解釈できたカーソル。`id` は旧形式のとき `null` */
export type MeSessionsCursor = {
  updatedAt: Date;
  id: string | null;
};

const SEPARATOR = '|';

/** `updated_at` と `id` からカーソル文字列を作る */
export function formatMeSessionsCursor(updatedAt: Date, id: string): string {
  return `${updatedAt.toISOString()}${SEPARATOR}${id}`;
}

/**
 * カーソル文字列を解釈する。**解釈できなければ `null`**。
 *
 * 壊れた文字列で `new Date()` を作ると `Invalid Date` になり、そのまま Prisma へ渡すと
 * 500 になる。カーソルはクライアントから来る任意の文字列なので、ここで弾いて
 * 「先頭ページを返す」へ倒す（一覧が見られなくなるより良い）。
 */
export function parseMeSessionsCursor(
  cursor: string | null | undefined,
): MeSessionsCursor | null {
  if (typeof cursor !== 'string' || cursor.length === 0) return null;

  const separatorIndex = cursor.indexOf(SEPARATOR);
  const timestampText =
    separatorIndex === -1 ? cursor : cursor.slice(0, separatorIndex);
  const idText = separatorIndex === -1 ? '' : cursor.slice(separatorIndex + 1);

  const updatedAt = new Date(timestampText);
  if (Number.isNaN(updatedAt.getTime())) return null;

  return { updatedAt, id: idText.length > 0 ? idText : null };
}
