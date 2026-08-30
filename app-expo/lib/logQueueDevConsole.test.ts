import type { CreateFrontendLogDto } from "@shared/api/v1/dto";

// #1592 development ビルドでの **コンソール出力の出し分け**だけを見るテスト。
//
// `logQueue.test.ts` は `Env.NODE_ENV = "test"` でモックしており、
// development 限定の詳細出力の経路をわざと踏まない（console.warn の回数を数えるため）。
// そのため «どちらのメソッドで出るか» はどこでも固定されていなかった。
//
// ここで固定したいのは 1 点:
//
//   **サーバが応答を返す前に切れた失敗（status なし）を `console.error` で出さないこと。**
//
// e2e-web は EAS の development 環境変数を焼き込んでビルドするので、この経路が常に生きる。
// `console.error` で出すと #1500 の «console error が出たらテストを失敗にする» ゲートを踏み、
// 画面の中身と無関係に e2e がまとめて赤くなる（2026-08-25 の main で 223 件中 73 件）。
//
// 逆に **ステータスを伴う失敗は `console.error` のまま**にする。#1076（DTO が壊れて 400 で
// 全滅する）を検知できなくなるのが一番困るためで、そちらはサーバが応答を返す側にいる。

const mockFetchWithAuth = jest.fn();
const mockGetSession = jest.fn();
const mockOnAuthStateChange = jest.fn();
const mockAppStateAddEventListener = jest.fn();

jest.mock("react-native", () => ({
	AppState: {
		addEventListener: (...args: any[]) => mockAppStateAddEventListener(...args),
	},
}));

// ⚠️ ここが `logQueue.test.ts` との唯一の違い。development の経路を踏ませる
jest.mock("@/constants/Env", () => ({
	Env: { NODE_ENV: "development" },
}));

jest.mock("./supabase", () => ({
	supabase: {
		auth: {
			getSession: (...args: any[]) => mockGetSession(...args),
			onAuthStateChange: (...args: any[]) => mockOnAuthStateChange(...args),
		},
	},
}));

jest.mock("./fetchWithAuth", () => ({
	fetchWithAuth: (...args: any[]) => mockFetchWithAuth(...args),
}));

type LogQueueModule = typeof import("./logQueue");

let logQueue: LogQueueModule;
let warnSpy: jest.SpyInstance;
let errorSpy: jest.SpyInstance;

const flushAsync = async (): Promise<void> => {
	for (let i = 0; i < 20; i++) await Promise.resolve();
};

const errorResponse = (status: number) => ({
	response: { ok: false, status, json: async () => ({}) },
});

const makeLog = (i: number): CreateFrontendLogDto => ({
	event_name: `event_${i}`,
	path_name: "/test",
	payload: { i },
	error_level: "log",
	created_at: "2026-08-25T00:00:00.000Z",
	created_app_version: "1.14.0",
	created_commit_id: "0123456789abcdef",
});

const enqueueMany = (count: number): void => {
	for (let i = 0; i < count; i++) logQueue.enqueueLog(makeLog(i));
};

/** console.error に渡された第 1 引数（メッセージ）の一覧 */
const errorMessages = (): string[] => errorSpy.mock.calls.map((call) => String(call[0]));
/** console.warn に渡された第 1 引数（メッセージ）の一覧 */
const warnMessages = (): string[] => warnSpy.mock.calls.map((call) => String(call[0]));

beforeEach(() => {
	jest.useFakeTimers();
	warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
	errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

	mockGetSession.mockResolvedValue({ data: { session: { access_token: "test-token", user: { id: "user-1" } } } });

	jest.resetModules();
	logQueue = jest.requireActual<LogQueueModule>("./logQueue");
});

afterEach(() => {
	warnSpy.mockRestore();
	errorSpy.mockRestore();
	jest.useRealTimers();
});

describe("development での送信失敗のコンソール出力（#1592）", () => {
	// ── 本命 ──
	// 画面遷移・リロード・通信断で飛んでいるリクエストが中断されると fetch は
	// `TypeError: Failed to fetch` で reject する。flush は 5 秒間隔なので普通に起きる。
	it("サーバが応答を返す前に切れた失敗は console.error を出さない（e2e のゲートを踏まない）", async () => {
		mockFetchWithAuth.mockRejectedValue(new TypeError("Failed to fetch"));

		enqueueMany(3);
		logQueue.flushLogQueue();
		await flushAsync();

		expect(errorMessages()).toEqual([]);
	});

	it("それでも握り潰さない: 同じ内容を console.warn へ出し、件数もカウンタに残る", async () => {
		mockFetchWithAuth.mockRejectedValue(new TypeError("Failed to fetch"));

		enqueueMany(3);
		logQueue.flushLogQueue();
		await flushAsync();

		expect(warnMessages().some((message) => message.includes("aborted before the server responded"))).toBe(true);
		expect(logQueue.getLogQueueStats().droppedByTransient).toBe(3);
		expect(logQueue.getLogQueueStats().lastFailure?.status).toBeNull();
	});

	// ── #1076 の検知能力を失っていないこと ──
	// 「送っているログの DTO が壊れていて 400 で全滅する」はサーバが応答を返す側なので、
	// 上の切り分けで消えてはいけない。
	it("400 応答は従来どおり console.error を出す（#1076 の検知を残す）", async () => {
		mockFetchWithAuth.mockResolvedValue(errorResponse(400));

		enqueueMany(2);
		logQueue.flushLogQueue();
		await flushAsync();

		expect(warnMessages().some((message) => message.includes("frontend log batch dropped"))).toBe(true);
		expect(logQueue.getLogQueueStats().droppedByReject).toBe(2);
	});

	it("アクセストークンが取れないだけのときは console.error も詳細 warn も出さない", async () => {
		mockGetSession.mockResolvedValue({ data: { session: null } });

		enqueueMany(2);
		logQueue.flushLogQueue();
		await flushAsync();

		expect(errorMessages()).toEqual([]);
		expect(warnMessages().some((message) => message.includes("aborted before the server responded"))).toBe(false);
		expect(mockFetchWithAuth).not.toHaveBeenCalled();
	});
});
