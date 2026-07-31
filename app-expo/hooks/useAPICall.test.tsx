import { act } from "react";
import TestRenderer from "react-test-renderer";
import { useAPICall, type ApiError } from "./useAPICall";

/**
 * #1092 C1 の感度テスト: **トークンが無いときに投げるのは `ApiError` である**。
 *
 * `useAPICall` は JWT を要求する全経路の単一チョークポイントで、以前はトークンが無いときに
 * 素の `throw new Error("User is not authenticated: ...")` を投げていた。
 * その結果、呼び出し側から見える `error?.code` が `undefined` になり、全呼び出し元が
 * これを「原因不明のエラー」として扱うしかなかった（= 恒久的な失敗なのか、
 * auth の解決を待てば成功するのかを区別できない）。
 *
 * この区別は #1092 PR4a の他の修正（HealthCheckInitializer / 現在地の自動取得の再試行）が
 * 立っている前提そのものなので、ここが素の Error に戻ると芋づる式に壊れる。
 */

jest.mock("@/lib/fetchWithAuth", () => ({
	// トークンが無い時点で throw されるので、ここへ到達したら「チェックが消えた」ことになる
	fetchWithAuth: jest.fn(async () => {
		throw new Error("fetchWithAuth must not be called without an access token");
	}),
}));
jest.mock("@/hooks/useLogger", () => {
	const logFrontendEvent = jest.fn();
	return { useLogger: () => ({ logFrontendEvent }) };
});
jest.mock("@/contexts/DialogProvider", () => {
	const showDialog = jest.fn();
	return { useDialog: () => ({ showDialog }) };
});
jest.mock("@/stores/useCdnCookieStore", () => ({
	useCdnCookieStore: { getState: () => ({ setFromResponseHeaders: jest.fn() }) },
}));
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
// Env は expo-constants の extra（app.config.ts の値）を実体化するため、テスト環境では読めない
jest.mock("@/constants/Env", () => ({ Env: { APP_STORE_URL: "", PLAY_STORE_URL: "" } }));

/** テストから差し替えるセッション（null = 認証がまだ確立していない） */
let mockSession: { access_token: string } | null = null;
jest.mock("@/contexts/AuthProvider", () => ({
	useAuth: () => ({
		getSession: () => mockSession,
		refreshSession: jest.fn(),
	}),
}));

/** `useAPICall()` をレンダリングして `callBackend` を取り出す */
const renderCallBackend = () => {
	let callBackend!: ReturnType<typeof useAPICall>["callBackend"];
	const Probe = () => {
		callBackend = useAPICall().callBackend;
		return null;
	};
	act(() => {
		TestRenderer.create(<Probe />);
	});
	return callBackend;
};

describe("#1092 useAPICall のトークン欠如は ApiError として投げる", () => {
	beforeEach(() => {
		(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		mockSession = null;
	});

	it("access_token が無いとき、呼び出し側が code で判別できる形で失敗する", async () => {
		const callBackend = renderCallBackend();

		const error: ApiError = await callBackend("health", { method: "GET", requestPayload: {} }).then(
			() => {
				throw new Error("トークンが無いのに成功した（認証チェックが消えている）");
			},
			(e) => e,
		);

		// ここが `undefined` に戻ると、呼び出し側は「後で再試行できる失敗」だと判断できなくなる
		expect(error?.code).toBe("unauthenticated");
		// 原因を追えるようにメッセージは残す（素の Error から移行しても情報を落とさない）
		expect(error?.message).toContain("access_token");
	});

	it("認証済みのときは、この分岐で失敗しない（チェック自体は残っている）", async () => {
		mockSession = { access_token: "token-1" };
		const callBackend = renderCallBackend();

		const error: ApiError = await callBackend("health", { method: "GET", requestPayload: {} }).then(
			() => null as never,
			(e) => e,
		);

		// fetchWithAuth まで到達し、そちらのエラー（network_error）になる
		expect(error?.code).toBe("network_error");
	});
});
