// api/src/core/pagination/composite-cursor.ts
//
// #1599 「時刻＋id」の複合カーソル。**一覧のページングは全部これを通す。**
//
// ## なぜ時刻単独ではいけないのか
//
// `WHERE created_at < :cursor ORDER BY created_at DESC` は、**同じ時刻の行がページ境界を
// またぐと、その時刻の行をまとめて飛ばす**。42 件目と 43 件目が同一時刻なら、
// 次ページの起点が 42 件目の時刻そのものなので `<` が 43 件目も落とし、
// **43 件目以降はどのページにも現れない**（一覧から永久に消える）。
//
// 発生確率は経路によって違う（1 ユーザーの操作行なら稀、一括投入された行なら日常）が、
// **「稀にしか起きない」と「起きない」は違う**。しかも起きたときに
// «一覧に出ないだけ» なので、ユーザーからは «消えた» としか見えず、原因の特定が難しい。
//
// ## 形式
//
// `"<ISO8601>|<id>"`。区切りは ISO8601 にも UUID にも現れない `|` を使う。
//
// **旧形式（ISO8601 のみ）も受ける。** 配信済みクライアントが持っている次ページの
// カーソルを無効にすると、アプリを更新するまで «次を読むと落ちる／先頭へ戻る» になるため。
// 旧形式のときは id を持たないので従来どおり時刻だけで絞る（同時刻スキップは残るが、
// 旧クライアントの挙動を変えないほうが安全側）。

/** 解釈できたカーソル。`id` は旧形式のとき `null` */
export type CompositeCursor = {
  at: Date;
  id: string | null;
};

const SEPARATOR = '|';

/** 時刻と id からカーソル文字列を作る */
export function formatCompositeCursor(at: Date, id: string): string {
  return `${at.toISOString()}${SEPARATOR}${id}`;
}

/**
 * カーソル文字列を解釈する。**解釈できなければ `null`**。
 *
 * 壊れた文字列で `new Date()` を作ると `Invalid Date` になり、そのまま Prisma へ渡すと
 * 500 になる。カーソルはクライアントから来る任意の文字列なので、ここで弾いて
 * 「先頭ページを返す」へ倒す（一覧が丸ごと見られなくなるより良い）。
 */
export function parseCompositeCursor(
  cursor: string | null | undefined,
): CompositeCursor | null {
  if (typeof cursor !== 'string' || cursor.length === 0) return null;

  const separatorIndex = cursor.indexOf(SEPARATOR);
  const timestampText =
    separatorIndex === -1 ? cursor : cursor.slice(0, separatorIndex);
  const idText = separatorIndex === -1 ? '' : cursor.slice(separatorIndex + 1);

  const at = new Date(timestampText);
  if (Number.isNaN(at.getTime())) return null;

  return { at, id: idText.length > 0 ? idText : null };
}

/**
 * `created_at DESC, id DESC` の並びに対する «カーソルより後» の条件を作る。
 *
 * 返り値をそのまま where へ **spread** して使う:
 *
 * ```ts
 * const whereClause = {
 *   user_id: userId,
 *   ...buildCursorFilter(cursor),
 * };
 * ```
 *
 * カーソルが無い／壊れているときは空オブジェクトを返す（＝先頭ページ）。
 *
 * ⚠️ **`orderBy` にも `id` を足すこと。** 比較条件と並び順が食い違うと、
 * 飛ばす代わりに重複が出る。`buildCursorOrderBy()` を使えば揃う。
 */
export function buildCursorFilter(
  cursor: string | null | undefined,
  field = 'created_at',
): Record<string, unknown> {
  const parsed = parseCompositeCursor(cursor);
  if (!parsed) return {};

  if (!parsed.id) {
    // 旧形式。従来どおり時刻だけで絞る
    return { [field]: { lt: parsed.at } };
  }

  return {
    OR: [
      { [field]: { lt: parsed.at } },
      { [field]: parsed.at, id: { lt: parsed.id } },
    ],
  };
}

/** `buildCursorFilter` と対になる並び順 */
export function buildCursorOrderBy(
  field = 'created_at',
): Array<Record<string, 'desc'>> {
  return [{ [field]: 'desc' }, { id: 'desc' }];
}
