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
/** #1194 認証初期化の決着待ち。テストごとに「待っている間に何が起きるか」を差し替える */
let mockWaitForAuthResolved: jest.Mock;
jest.mock("@/contexts/AuthProvider", () => ({
	useAuth: () => ({
		getSession: () => mockSession,
		refreshSession: jest.fn(),
		waitForAuthResolved: (...args: unknown[]) => mockWaitForAuthResolved(...args),
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
		// 既定は「待っても決着しない」。#1092 の既存の主張（即 ApiError）をそのまま保つ
		mockWaitForAuthResolved = jest.fn(async () => false);
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

/**
 * #1194 起動直後の «待てば成功する» 失敗を、失敗として返さないこと。
 *
 * ## 実機で踏んだ症状
 * LINE から投票の共有リンクを開くと **時々だけ**「結果を取得できませんでした」になり、
 * 再試行すると成功する。ディープリンク起動では画面のマウントと匿名サインインが競合し、
 * 画面が先に走ることがある。従来はトークンが無いと即 throw していたため、
 * あと数百ミリ秒待てば成功する呼び出しまで失敗にしていた。
 */
describe("#1194 認証初期化の決着を待ってから諦める", () => {
	beforeEach(() => {
		(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		mockSession = null;
	});

	it("待っている間にセッションが載れば、その先へ進む（失敗にしない）", async () => {
		// 決着待ちの «最中に» 匿名サインインが完了する、という実機の順序を再現する
		mockWaitForAuthResolved = jest.fn(async () => {
			mockSession = { access_token: "token-after-wait" };
			return true;
		});
		const callBackend = renderCallBackend();

		const error: ApiError = await callBackend("health", { method: "GET", requestPayload: {} }).then(
			() => null as never,
			(e) => e,
		);

		// unauthenticated で止まらず fetchWithAuth まで到達している
		expect(mockWaitForAuthResolved).toHaveBeenCalledTimes(1);
		expect(error?.code).toBe("network_error");
	});

	// ⚠️ 「認証が壊れている」を「待てば直る」に変えてしまわないこと。
	// 決着済みで失敗しているなら、従来どおり即 ApiError で返す
	it("待っても載らなければ、従来どおり unauthenticated を投げる", async () => {
		mockWaitForAuthResolved = jest.fn(async () => true);
		const callBackend = renderCallBackend();

		const error: ApiError = await callBackend("health", { method: "GET", requestPayload: {} }).then(
			() => {
				throw new Error("トークンが無いのに成功した");
			},
			(e) => e,
		);

		expect(error?.code).toBe("unauthenticated");
	});

	// ⚠️ 通常の呼び出しに待機コストを持ち込まないこと。
	// ここが呼ばれるようになると、全 API 呼び出しが 1 tick 遅くなる
	it("既にセッションがあるときは待たない", async () => {
		mockSession = { access_token: "token-1" };
		mockWaitForAuthResolved = jest.fn(async () => true);
		const callBackend = renderCallBackend();

		await callBackend("health", { method: "GET", requestPayload: {} }).catch(() => undefined);

		expect(mockWaitForAuthResolved).not.toHaveBeenCalled();
	});
});

/**
 * #1642 HTTP 503 と «メンテナンス» を同一視しないこと。
 *
 * ## 実機で踏んだ症状
 * 2026-08-31、料理レコメンド画面で「ただいまメンテナンス中です。」が出た。メンテナンスでは
 * なく、`POST /v1/dishes/bulk-import` が Google Places の日次クォータ枯渇で 503
 * (`EXTERNAL_QUOTA_EXCEEDED`) を返しただけだった（dev ログ 5 件 / 同一ユーザー）。
 * 503 は他にもアカウント削除の失敗や Cloud Run の過負荷で返る。
 *
 * メンテナンスを名乗ってよいのは Remote Config の `is_maintenance` を読んだ
 * `MaintenanceGuard` の `SERVICE_MAINTENANCE` だけである。
 */
describe("#1642 メンテナンス告知は SERVICE_MAINTENANCE のときだけ", () => {
	/** 指定の JSON ボディと status を返す `fetchWithAuth` の戻り値を組み立てる */
	const jsonResponse = (status: number, body: unknown) => ({
		response: {
			ok: status >= 200 && status < 300,
			status,
			headers: { get: () => null },
			json: async () => body,
		},
		endpoint: "https://api.example.test/v1/dishes/bulk-import",
	});

	const { fetchWithAuth } = jest.requireMock("@/lib/fetchWithAuth") as { fetchWithAuth: jest.Mock };
	const { showDialog } = (jest.requireMock("@/contexts/DialogProvider") as { useDialog: () => { showDialog: jest.Mock } }).useDialog();

	beforeEach(() => {
		(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		mockSession = { access_token: "token-1" };
		mockWaitForAuthResolved = jest.fn(async () => true);
		showDialog.mockClear();
		fetchWithAuth.mockReset();
	});

	afterAll(() => {
		fetchWithAuth.mockReset();
	});

	// 👇 これが今回のバグ本体。ここが maintenance_mode に戻ると実機へメンテ告知が出る
	it("外部 API のクォータ枯渇 (503 / EXTERNAL_QUOTA_EXCEEDED) ではメンテ告知を出さない", async () => {
		fetchWithAuth.mockResolvedValue(
			jsonResponse(503, {
				data: null,
				success: false,
				errorCode: "EXTERNAL_QUOTA_EXCEEDED",
				message: "Google Places Text Search API quota exceeded",
			}),
		);
		const callBackend = renderCallBackend();

		const error: ApiError = await callBackend("v1/dishes/bulk-import", {
			method: "POST",
			requestPayload: {},
		}).then(() => null as never, (e) => e);

		expect(showDialog).not.toHaveBeenCalled();
		expect(error?.code).toBe("http_error");
		expect(error?.status).toBe(503);
		// 呼び出し側が «一時的な外部要因» だと判別できるよう、原因コードは残す
		expect(error?.errorCode).toBe("EXTERNAL_QUOTA_EXCEEDED");
	});

	// errorCode を持たない 503（Cloud Run / LB の過負荷など）も同じ扱いにする
	it("errorCode の無い 503 でもメンテ告知を出さない", async () => {
		fetchWithAuth.mockResolvedValue(jsonResponse(503, { success: false, message: "upstream unavailable" }));
		const callBackend = renderCallBackend();

		const error: ApiError = await callBackend("v1/dishes/bulk-import", {
			method: "POST",
			requestPayload: {},
		}).then(() => null as never, (e) => e);

		expect(showDialog).not.toHaveBeenCalled();
		expect(error?.code).toBe("http_error");
	});

	// ⚠️ 本物のメンテナンスを黙らせないこと。ここが落ちると計画メンテを告知できなくなる
	it("Remote Config 由来の 503 (SERVICE_MAINTENANCE) ではメンテ告知を出す", async () => {
		fetchWithAuth.mockResolvedValue(
			jsonResponse(503, {
				data: null,
				success: false,
				errorCode: "SERVICE_MAINTENANCE",
				message: "Service is currently under maintenance",
			}),
		);
		const callBackend = renderCallBackend();

		const error: ApiError = await callBackend("v1/dishes/bulk-import", {
			method: "POST",
			requestPayload: {},
		}).then(() => null as never, (e) => e);

		expect(showDialog).toHaveBeenCalledTimes(1);
		expect(showDialog.mock.calls[0][0]).toBe("Error.maintenanceMessage");
		// HealthCheckInitializer がこの code でメンテを検知している
		expect(error?.code).toBe("maintenance_mode");
	});
});
