// lib/errorMessage.ts
//
// #1092 【設計】ログに載せる「エラーの説明文」を 1 箇所で作る純関数。
//
// PR4a で `useAPICall` のトークン欠如が `throw new Error(...)` から
// `throw { code: "unauthenticated", message: ... } satisfies ApiError`（plain object）に変わった。
// これは呼び出し側が `error?.code` で「後で再試行すべき失敗」を判別できるようにするためだが、
// 副作用として **`String(error)` も `error instanceof Error ? error.message : String(error)` も
// `"[object Object]"` を返す**ようになった。
//
// PR4b で `SplashHandler` の `!!user` ゲートを外した結果、認証が確立する前に画面が動き始め、
// この `unauthenticated` が実際に各所の catch へ流れてくる。ログが `[object Object]` だと
// 「認証待ちだっただけ」なのか「本当に壊れている」のかが BigQuery から永久に分からないため、
// message を優先して取り出す。
//
// ⚠️ 【重要】置換前の書き方が 2 種類あったので、関数も 2 つに分けてある。
//    どちらへ寄せるかは **置換前がどちらだったか** で決めること。既存ログの文字列が変わると、
//    BigQuery 側で `payload.error LIKE 'LocationPermissionError:%'` のような文字列一致で
//    組んである集計・アラートが黙ってヒット 0 件になる。
//
//    (A) `String(error)` だった箇所            → `toErrorLogString`（Error は "Name: message"）
//    (B) `error instanceof Error ? error.message : String(error)` だった箇所
//                                              → `toErrorLogMessage`（Error は message のみ）
//
//    どちらも「plain object が `"[object Object]"` になる」ケースだけを直しており、
//    それ以外の入力に対する出力は置換前と同じになるようにしてある。

/** `message` プロパティを持つかもしれない値として読むためのヘルパ */
const readMessage = (error: unknown): unknown => (error as { message?: unknown } | null | undefined)?.message;

/**
 * (B) 用。ログ用にエラーを 1 行の文字列へ変換する（**message のみ**）。
 *
 * 置換前が `error instanceof Error ? error.message : String(error)` /
 * `error?.message ? String(error.message) : String(error)` だった箇所はこちら。
 *
 * - `message` を持つ値（`Error` / `ApiError` のような plain object / Supabase の `AuthError`）は `message`
 * - それ以外（文字列・数値・message の無いオブジェクト）は `String(error)`
 *
 * `instanceof Error` で判定しないのは、まさに Error インスタンスでない上記の plain object を拾うため。
 *
 * @param error catch した値（`unknown` のまま渡してよい）
 * @returns ログに載せる文字列
 */
export const toErrorLogMessage = (error: unknown): string => {
	const message = readMessage(error);
	return message ? String(message) : String(error);
};

/**
 * (A) 用。ログ用にエラーを 1 行の文字列へ変換する（**`String(error)` 互換**）。
 *
 * 置換前が素の `String(error)` だった箇所はこちら。`Error` とそのサブクラスは
 * `String()` がそのまま `"Error: message"` / `"LocationPermissionError: message"` を返すので、
 * **エラー名のプレフィックスが落ちない**。ここを message だけにすると、名前で前方一致していた
 * 既存のログ集計が全て外れる。
 *
 * - `Error`（サブクラス含む）は `String(error)`（＝ `"Name: message"`。message が空なら `"Name"`）
 * - Error ではないが `message` を持つ値（PR4a の `ApiError` のような plain object）は `message`
 *   … ここだけが置換前からの変更点。放置すると `"[object Object]"` になり原因が追えない
 * - それ以外（文字列・数値・message の無いオブジェクト）は `String(error)`
 *
 * @param error catch した値（`unknown` のまま渡してよい）
 * @returns ログに載せる文字列
 */
export const toErrorLogString = (error: unknown): string => {
	if (error instanceof Error) return String(error);

	const message = readMessage(error);
	return message ? String(message) : String(error);
};
