import { act } from "react";
import TestRenderer from "react-test-renderer";
import { useAPICall, type ApiError } from "./useAPICall";

/**
 * #1196 上流(Google Places Text Search)の日次クォータ枯渇を 500 から 429 へ変えたことの感度テスト。
 *
 * 固定したいのは 2 つ。
 *
 * 1. **429 は Google Maps フォールバックを壊さない。**
 *    このリポジトリの useAPICall は 503 をメンテナンスモード、426 を強制アップデートとして扱い、
 *    どちらも `showDialog` で専用ダイアログを出す。上流クォータ枯渇をその 2 つで返すと、
 *    そのダイアログが Google Maps フォールバックダイアログ
 *    (features/search/hooks/useGoogleMapsFallback.ts) と競合し、
 *    115人/日が実際に使っている退避導線を壊す。だから 429 を選んでいる。
 *    ここが赤くなったら「ステータスの選択がフォールバックを壊す方向へ動いた」ということ。
 *
 * 2. **ログレベルはステータスの分類で決める。500 は error のまま。**
 *    フォールバックがあるからといって api_call_error を一律 warn へ落とすと、
 *    フォールバックが無い経路の 500 まで見えなくなる。
 */

const mockFetchWithAuth = jest.fn();
jest.mock("@/lib/fetchWithAuth", () => ({
	fetchWithAuth: (...args: unknown[]) => mockFetchWithAuth(...args),
}));

const mockLogFrontendEvent = jest.fn();
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: mockLogFrontendEvent }) }));

const mockShowDialog = jest.fn();
jest.mock("@/contexts/DialogProvider", () => ({ useDialog: () => ({ showDialog: mockShowDialog }) }));

jest.mock("@/stores/useCdnCookieStore", () => ({
	useCdnCookieStore: { getState: () => ({ setFromResponseHeaders: jest.fn() }) },
}));
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock("@/constants/Env", () => ({ Env: { APP_STORE_URL: "", PLAY_STORE_URL: "" } }));
jest.mock("@/contexts/AuthProvider", () => ({
	useAuth: () => ({
		getSession: () => ({ access_token: "token-1" }),
		refreshSession: jest.fn(),
	}),
}));

/** 非2xx の Response 相当。useAPICall は headers.get と json() しか使わない */
const errorResponse = (status: number) => ({
	response: {
		ok: false,
		status,
		headers: { get: () => null },
		json: jest.fn().mockResolvedValue({ errorCode: "EXTERNAL_SERVICE_ERROR", message: "quota" }),
	},
	endpoint: "v1/dishes/bulk-import",
});

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

/** bulk-import を呼んで、投げられた ApiError を返す */
const callBulkImport = async (status: number): Promise<ApiError> => {
	mockFetchWithAuth.mockResolvedValue(errorResponse(status));
	const callBackend = renderCallBackend();
	return callBackend("v1/dishes/bulk-import", { method: "POST", requestPayload: {} }).then(
		() => {
			throw new Error(`status ${status} なのに成功した`);
		},
		(e) => e,
	);
};

/** api_call_error として記録されたイベントを取り出す */
const apiCallErrorLogs = () =>
	mockLogFrontendEvent.mock.calls.map(([event]) => event).filter((event) => event.event_name === "api_call_error");

beforeEach(() => {
	(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe("#1196 上流クォータ枯渇の 429 は Google Maps フォールバックを壊さない", () => {
	it("429 は専用ダイアログを出さない（フォールバックダイアログと競合しない）", async () => {
		await callBulkImport(429);

		// ここで何かダイアログが出ると、直後に出る Google Maps フォールバックダイアログと競合する
		expect(mockShowDialog).not.toHaveBeenCalled();
	});

	it("429 は http_error として throw される（呼び出し側の catch にそのまま届く）", async () => {
		const error = await callBulkImport(429);

		// 呼び出し側（lib/dishMediaSearch.ts → store / useCandidateDishMediaCache）は
		// この throw を受けて 0 件のまま or catch へ入り、フォールバックダイアログを出す
		expect(error.code).toBe("http_error");
		expect(error.status).toBe(429);
	});

	it("429 は maintenance_mode / unsupported_version に化けない", async () => {
		const error = await callBulkImport(429);

		expect(error.code).not.toBe("maintenance_mode");
		expect(error.code).not.toBe("unsupported_version");
	});

	// 503 を選べない理由の実証。ここが「ダイアログを出さない」に変わったら 503 も選択肢になるが、
	// そのときは #1196 の設計判断ごと見直すこと。
	it("（対照）503 はメンテナンスダイアログを出してしまうので、クォータ枯渇には使えない", async () => {
		const error = await callBulkImport(503);

		expect(mockShowDialog).toHaveBeenCalled();
		expect(error.code).toBe("maintenance_mode");
	});
});

describe("#1196 api_call_error のログレベル", () => {
	it("429 は warn（一時障害。アプリを直しても消えないので error で鳴らさない）", async () => {
		await callBulkImport(429);

		expect(apiCallErrorLogs()).toEqual([
			expect.objectContaining({ error_level: "warn", payload: expect.objectContaining({ status: 429 }) }),
		]);
	});

	// ★ 一律 warn への引き下げを禁止する感度テスト。
	//   フォールバックが無い経路の 500 が見えなくなるのを防ぐ。
	it("500 は error のまま", async () => {
		await callBulkImport(500);

		expect(apiCallErrorLogs()).toEqual([
			expect.objectContaining({ error_level: "error", payload: expect.objectContaining({ status: 500 }) }),
		]);
	});

	it("400（契約違反 = 我々のバグ）も error のまま", async () => {
		await callBulkImport(400);

		expect(apiCallErrorLogs()).toEqual([expect.objectContaining({ error_level: "error" })]);
	});
});
