import { toErrorLogMessage, toErrorLogString } from "./errorMessage";
import { LocationPermissionError } from "@/hooks/locationPermissionError";

/**
 * #1092 PR4b ログ用のエラー整形。
 *
 * PR4a で `useAPICall` のトークン欠如が plain object（`{ code: "unauthenticated", message }`）に
 * なったため、`String(error)` も `error instanceof Error ? ... : String(error)` も
 * `"[object Object]"` を返すようになっていた。PR4b でゲートを外すと、この失敗が
 * 実際に各所の catch へ流れてくるので、message が必ず残ることを固定する。
 *
 * ⚠️ 置換前の書き方が 2 種類あったので、関数も 2 つある。**それぞれ置換前の振る舞いを保つ**こと。
 * ログの文字列が変わると、BigQuery 側で文字列一致（`LIKE 'LocationPermissionError:%'` 等）で
 * 組んである集計・アラートが黙ってヒット 0 件になる。
 */

/** PR4a の `useAPICall` が throw する形（Error インスタンスではない） */
const apiError = {
	code: "unauthenticated",
	message: "User is not authenticated: Supabase access_token is missing (endpoint: health).",
};

describe("#1092 toErrorLogMessage（(B) `error instanceof Error ? error.message : String(error)` の置換先）", () => {
	it("Error インスタンスは message のみを返す（置換前と同じ）", () => {
		expect(toErrorLogMessage(new Error("boom"))).toBe("boom");
	});

	it("Error のサブクラスも message のみを返す（置換前と同じ）", () => {
		expect(toErrorLogMessage(new LocationPermissionError("denied", "permission denied"))).toBe("permission denied");
	});

	it("message を持つ plain object（ApiError）も message を返す", () => {
		// ここが "[object Object]" に戻ると、認証未確立が原因の失敗を BigQuery から追えなくなる
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

describe("#1092 toErrorLogString（(A) 素の `String(error)` の置換先）", () => {
	it("Error インスタンスは `String(error)` と同じ 'Error: message' を返す", () => {
		const error = new Error("boom");
		expect(toErrorLogString(error)).toBe(String(error));
		expect(toErrorLogString(error)).toBe("Error: boom");
	});

	it("Error のサブクラスはエラー名のプレフィックスを保つ", () => {
		// BigQuery で `payload.error LIKE 'LocationPermissionError:%'` のような前方一致で
		// 集計・アラートを組んでいる。message だけにするとヒット 0 件になる
		const error = new LocationPermissionError("denied", "permission denied");
		expect(toErrorLogString(error)).toBe(String(error));
		expect(toErrorLogString(error)).toBe("LocationPermissionError: permission denied");
	});

	it("message を持つ plain object（ApiError）は message を返す（ここだけが置換前からの変更点）", () => {
		expect(toErrorLogString(apiError)).toBe(apiError.message);
		expect(toErrorLogString(apiError)).not.toContain("[object Object]");
	});

	it("Error 以外・message 無しは `String(error)` のまま", () => {
		expect(toErrorLogString("plain string")).toBe("plain string");
		expect(toErrorLogString(null)).toBe("null");
		expect(toErrorLogString(undefined)).toBe("undefined");
		expect(toErrorLogString(404)).toBe("404");
		expect(toErrorLogString({ code: "no_message" })).toBe("[object Object]");
	});

	it("message が空文字の Error は String() と同じくエラー名を返す", () => {
		expect(toErrorLogString(new Error(""))).toBe("Error");
	});
});
