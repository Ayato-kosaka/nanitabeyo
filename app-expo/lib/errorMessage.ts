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
// 判定は PR4a の `HealthCheckInitializer` / `useAutoCurrentLocation` が採った
// `error?.message ? String(error.message) : String(error)` と同一（それらもこの関数へ寄せてある）。
// `instanceof Error` で判定しないのは、まさに Error インスタンスでない上記の plain object を拾うため。

/**
 * ログ用にエラーを 1 行の文字列へ変換する。
 *
 * - `message` を持つ値（`Error` / `ApiError` のような plain object / Supabase の `AuthError`）は `message`
 * - それ以外（文字列・数値・message の無いオブジェクト）は `String(error)`
 *
 * @param error catch した値（`unknown` のまま渡してよい）
 * @returns ログに載せる文字列
 */
export const toErrorLogMessage = (error: unknown): string => {
	const message = (error as { message?: unknown } | null | undefined)?.message;
	return message ? String(message) : String(error);
};
