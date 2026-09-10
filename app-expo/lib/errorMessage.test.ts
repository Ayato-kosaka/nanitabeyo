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

	it("Error 以外・message 無しは `String(error)` のまま（object を除く）", () => {
		expect(toErrorLogString("plain string")).toBe("plain string");
		expect(toErrorLogString(null)).toBe("null");
		expect(toErrorLogString(undefined)).toBe("undefined");
		expect(toErrorLogString(404)).toBe("404");
	});

	// #1891 【変更】ここは以前 `"[object Object]"` を期待していた。**その期待が欠陥を固定していた。**
	// 本番の health_check_error に {"error":"[object Object]","code":"network_error","status":0} が出て、
	// error 欄が何も言っていない状態になった。plain object だけは形を残す。
	//
	// ⚠️ 値は載せない（catch した中身は任意で、URL・トークン・ユーザー入力が入りうる）。
	it("message を持たない object は `[object Object]` ではなく形を残す", () => {
		expect(toErrorLogString({ code: "no_message" })).toBe("Object{code}");
		expect(toErrorLogMessage({ code: "network_error", status: 0 })).toBe("Object{code,status}");
	});

	it("値は載せない（PII をログへ出さない）", () => {
		const described = toErrorLogMessage({ url: "https://example.com/?access_token=secret", q: "焼肉" });
		expect(described).not.toContain("secret");
		expect(described).not.toContain("焼肉");
		expect(described).toBe("Object{q,url}");
	});

	it("キーが多いときは打ち切る", () => {
		const many = Object.fromEntries(Array.from({ length: 14 }, (_, i) => [`k${String(i).padStart(2, "0")}`, i]));
		expect(toErrorLogMessage(many)).toContain("…+4");
	});

	it("キーが無い object / 配列でも落ちない", () => {
		expect(toErrorLogMessage({})).toBe("[object Object]");
		expect(toErrorLogMessage([1, 2, 3])).toBe("Array(3)");
	});

	it("message が空文字の Error は String() と同じくエラー名を返す", () => {
		expect(toErrorLogString(new Error(""))).toBe("Error");
	});
});
