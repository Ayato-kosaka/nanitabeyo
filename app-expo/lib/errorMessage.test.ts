import { toErrorLogMessage } from "./errorMessage";

/**
 * #1092 PR4b ログ用のエラー整形。
 *
 * PR4a で `useAPICall` のトークン欠如が plain object（`{ code: "unauthenticated", message }`）に
 * なったため、`String(error)` も `error instanceof Error ? ... : String(error)` も
 * `"[object Object]"` を返すようになっていた。PR4b でゲートを外すと、この失敗が
 * 実際に各所の catch へ流れてくるので、message が必ず残ることを固定する。
 */
describe("#1092 toErrorLogMessage", () => {
	it("Error インスタンスは message を返す", () => {
		expect(toErrorLogMessage(new Error("boom"))).toBe("boom");
	});

	it("message を持つ plain object（ApiError）も message を返す", () => {
		// ここが "[object Object]" に戻ると、認証未確立が原因の失敗を BigQuery から追えなくなる
		const apiError = {
			code: "unauthenticated",
			message: "User is not authenticated: Supabase access_token is missing (endpoint: health).",
		};
		expect(toErrorLogMessage(apiError)).toBe(apiError.message);
		expect(toErrorLogMessage(apiError)).not.toContain("[object Object]");
	});

	it("message を持たない値は String() で表現する", () => {
		expect(toErrorLogMessage("plain string")).toBe("plain string");
		expect(toErrorLogMessage(null)).toBe("null");
		expect(toErrorLogMessage(undefined)).toBe("undefined");
		expect(toErrorLogMessage(404)).toBe("404");
	});

	it("message が空文字の Error は String() へフォールバックする（空ログにしない）", () => {
		expect(toErrorLogMessage(new Error(""))).toBe("Error");
	});
});
