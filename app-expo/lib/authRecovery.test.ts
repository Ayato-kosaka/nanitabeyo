import {
	DEFAULT_COOLDOWN_MS,
	RATE_LIMIT_MAX_COOLDOWN_MS,
	RATE_LIMIT_MIN_COOLDOWN_MS,
	getAuthErrorStatus,
	isRateLimitAuthError,
	isRetryableAuthError,
	parseRetryAfterMs,
	resolveAuthCooldownMs,
} from "./authRecovery";

/**
 * #1089 匿名サインイン失敗からの復帰ポリシーのテスト。
 *
 * ここが壊れたときの症状は「アプリが永久に起動しない」または「レート制限の枠を叩き潰す」なので、
 * 分岐そのものを固定しておく（AuthProvider は React 依存で単体テストしづらいため、判断ロジックだけ切り出してある）。
 */

/** Supabase の AuthApiError 相当（status / code を持つ Error） */
const authApiError = (status: number, message = "boom") => Object.assign(new Error(message), { status });

describe("getAuthErrorStatus", () => {
	it("status を持つエラーからは数値を取り出す", () => {
		expect(getAuthErrorStatus(authApiError(429))).toBe(429);
	});

	it("status を持たないエラー・null・undefined では undefined を返す", () => {
		expect(getAuthErrorStatus(new Error("offline"))).toBeUndefined();
		expect(getAuthErrorStatus(null)).toBeUndefined();
		expect(getAuthErrorStatus(undefined)).toBeUndefined();
		// 文字列 status（想定外の形）を数値として扱わない
		expect(getAuthErrorStatus({ status: "429" })).toBeUndefined();
	});
});

describe("isRateLimitAuthError", () => {
	it("429 だけを true とする", () => {
		expect(isRateLimitAuthError(authApiError(429))).toBe(true);
		expect(isRateLimitAuthError(authApiError(500))).toBe(false);
		expect(isRateLimitAuthError(new Error("offline"))).toBe(false);
	});
});

describe("isRetryableAuthError", () => {
	it("429 は即時リトライしない（30 回/時/IP の枠を秒間隔で潰さないため）", () => {
		expect(isRetryableAuthError(authApiError(429))).toBe(false);
	});

	it("supabase-js が fetch 失敗をラップした AuthRetryableFetchError はリトライする", () => {
		const err = Object.assign(new Error("Failed to fetch"), { name: "AuthRetryableFetchError", status: 0 });
		expect(isRetryableAuthError(err)).toBe(true);
	});

	it("HTTP 応答に到達していない（status 無し）エラーはリトライする", () => {
		expect(isRetryableAuthError(new TypeError("Failed to fetch"))).toBe(true);
	});

	it("5xx はリトライする", () => {
		expect(isRetryableAuthError(authApiError(500))).toBe(true);
		expect(isRetryableAuthError(authApiError(503))).toBe(true);
	});

	it("429 以外の 4xx はリトライしない（何度叩いても同じ結果になるため）", () => {
		expect(isRetryableAuthError(authApiError(400))).toBe(false);
		expect(isRetryableAuthError(authApiError(401))).toBe(false);
		expect(isRetryableAuthError(authApiError(422))).toBe(false);
	});
});

describe("parseRetryAfterMs", () => {
	const now = Date.parse("2026-01-01T00:00:00Z");

	it("デルタ秒形式を ms へ変換する", () => {
		expect(parseRetryAfterMs("120", now)).toBe(120_000);
		expect(parseRetryAfterMs("  30  ", now)).toBe(30_000);
	});

	it("HTTP-date 形式を現在時刻との差分へ変換する", () => {
		expect(parseRetryAfterMs("Thu, 01 Jan 2026 00:02:00 GMT", now)).toBe(120_000);
	});

	it("過去の HTTP-date は負にせず 0 にする", () => {
		expect(parseRetryAfterMs("Wed, 31 Dec 2025 23:59:00 GMT", now)).toBe(0);
	});

	it("ヘッダが無い・解釈できない場合は null を返す", () => {
		expect(parseRetryAfterMs(null, now)).toBeNull();
		expect(parseRetryAfterMs(undefined, now)).toBeNull();
		expect(parseRetryAfterMs("", now)).toBeNull();
		expect(parseRetryAfterMs("soon", now)).toBeNull();
	});
});

describe("resolveAuthCooldownMs", () => {
	it("429 以外では追加のクールダウンを置かない（retry() で既に待っているため）", () => {
		expect(resolveAuthCooldownMs(authApiError(500), null)).toBe(DEFAULT_COOLDOWN_MS);
		expect(resolveAuthCooldownMs(new Error("offline"), 10_000)).toBe(DEFAULT_COOLDOWN_MS);
	});

	it("429 で Retry-After が無ければ既定の最小クールダウンを使う", () => {
		expect(resolveAuthCooldownMs(authApiError(429), null)).toBe(RATE_LIMIT_MIN_COOLDOWN_MS);
	});

	it("429 で Retry-After が長ければそれを尊重する", () => {
		expect(resolveAuthCooldownMs(authApiError(429), 180_000)).toBe(180_000);
	});

	it("Retry-After が短すぎても最小クールダウンを下回らない", () => {
		expect(resolveAuthCooldownMs(authApiError(429), 1_000)).toBe(RATE_LIMIT_MIN_COOLDOWN_MS);
	});

	it("Retry-After が極端に長くても上限で頭打ちにする（UI が固まって見えないように）", () => {
		expect(resolveAuthCooldownMs(authApiError(429), 60 * 60_000)).toBe(RATE_LIMIT_MAX_COOLDOWN_MS);
	});
});
