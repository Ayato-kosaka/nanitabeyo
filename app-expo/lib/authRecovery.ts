// lib/authRecovery.ts
//
// #1089 【設計】匿名サインインが失敗したときの「リトライして良いか」「次に叩いて良いのはいつか」を決める純ロジック。
//
// AuthProvider から切り出してあるのは、React を起動せずに jest で検証できるようにするため
// （復帰ポリシーを間違えると症状が「アプリが永久に起動しない」になるので、ここは必ずテストで守る）。

/** Supabase Auth のレート制限（匿名サインインは 30 回/時/IP、カスタマイズ不可）を表す HTTP ステータス */
export const RATE_LIMIT_STATUS = 429;

/**
 * 429 を受けたあと、次の試行までに最低限空ける時間。
 * `Retry-After` が無いときの既定値であり、`Retry-After` があってもこれを下回る待ち時間にはしない。
 * 制限の窓が 1 時間なので、秒間隔で叩き直しても枠を減らすだけで復帰は早まらない。
 */
export const RATE_LIMIT_MIN_COOLDOWN_MS = 60_000;

/**
 * `Retry-After` が極端に大きい値でも、ここまでしか待たない。
 * 待ちすぎると「再試行ボタンを押したのに何も起きない」時間が長くなり、UI が壊れて見えるため。
 */
export const RATE_LIMIT_MAX_COOLDOWN_MS = 5 * 60_000;

/**
 * 429 以外の失敗後のクールダウン。
 * ネットワーク断・5xx は `retry()` の指数バックオフで既に待っているので、ここでは追加で待たない
 * （ユーザーが再試行ボタンを押したら即座に試させる）。
 */
export const DEFAULT_COOLDOWN_MS = 0;

/** 匿名サインインの `retry()` リトライ回数。1 回目 + リトライ 2 回 = 最大 3 回叩く */
export const ANON_SIGN_IN_RETRIES = 2;

/**
 * Supabase の AuthError / AuthApiError から HTTP ステータスを取り出す。
 * fetch 自体が失敗した場合（オフライン等）は status を持たないので undefined を返す。
 */
export const getAuthErrorStatus = (error: unknown): number | undefined => {
	const status = (error as { status?: unknown } | null | undefined)?.status;
	return typeof status === "number" ? status : undefined;
};

/** レート制限（429）由来の失敗か */
export const isRateLimitAuthError = (error: unknown): boolean => getAuthErrorStatus(error) === RATE_LIMIT_STATUS;

/**
 * その場で（短いバックオフで）リトライして良い失敗か。
 *
 * ⚠️ 429 は **リトライ対象に含めない**。匿名サインインの制限は 30 回/時/IP で窓が 1 時間あるため、
 *    秒オーダーで叩き直しても成功率は上がらず、残り枠を潰して他のユーザー・他の E2E を巻き添えにする。
 *    429 は `resolveAuthCooldownMs()` が返す長いクールダウンを置いたうえで、
 *    「ユーザーの再試行操作」「フォアグラウンド復帰」という**外部起点のイベント**まで待つ。
 */
export const isRetryableAuthError = (error: unknown): boolean => {
	if (isRateLimitAuthError(error)) return false;

	// supabase-js が fetch 失敗をラップした型。オフライン・DNS 失敗・タイムアウトなど
	if ((error as { name?: unknown } | null | undefined)?.name === "AuthRetryableFetchError") return true;

	const status = getAuthErrorStatus(error);
	// status を持たない = HTTP 応答に到達していない（TypeError: Failed to fetch 等）→ 一時的な障害とみなす
	if (status === undefined) return true;

	// 5xx はサーバ側の一時障害。4xx（401/422 等）はリトライしても同じ結果なので諦める
	return status >= 500;
};

/**
 * `Retry-After` ヘッダを待ち時間(ms)へ変換する。
 * RFC 9110 の 2 形式（デルタ秒 / HTTP-date）に対応する。
 *
 * @param headerValue `Retry-After` の生値。ヘッダが無ければ null/undefined
 * @param nowMs HTTP-date 形式の差分計算に使う現在時刻（テスト容易性のため引数で受ける）
 * @returns 待つべきミリ秒。解釈できなければ null
 */
export const parseRetryAfterMs = (headerValue: string | null | undefined, nowMs: number): number | null => {
	if (!headerValue) return null;

	const trimmed = headerValue.trim();
	if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;

	const dateMs = Date.parse(trimmed);
	if (Number.isNaN(dateMs)) return null;

	return Math.max(0, dateMs - nowMs);
};

/**
 * 失敗内容に応じて「次の試行を許可するまでの待ち時間」を決める。
 *
 * - 429: `Retry-After` を尊重しつつ、最低 {@link RATE_LIMIT_MIN_COOLDOWN_MS}、最大 {@link RATE_LIMIT_MAX_COOLDOWN_MS}
 * - それ以外: 0（`retry()` 側で既にバックオフ済み）
 */
export const resolveAuthCooldownMs = (error: unknown, retryAfterMs: number | null): number => {
	if (!isRateLimitAuthError(error)) return DEFAULT_COOLDOWN_MS;

	const requested = retryAfterMs != null && retryAfterMs > 0 ? retryAfterMs : RATE_LIMIT_MIN_COOLDOWN_MS;
	return Math.min(RATE_LIMIT_MAX_COOLDOWN_MS, Math.max(RATE_LIMIT_MIN_COOLDOWN_MS, requested));
};
