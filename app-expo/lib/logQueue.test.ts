import type { CreateFrontendLogDto } from "@shared/api/v1/dto";

// #1079 lib/logQueue.ts のユニットテスト。
// ここで守りたいのは主に2点:
//  1. 送信失敗が「見える」こと（#1076 は 400 が誰にも観測されないまま全ログが消えていた）
//  2. 送信失敗が「新しいログを生まない」こと（失敗をログに書くと入力起因の失敗では
//     100% 再発し、20件即時flush条件と噛み合って同期無限ループに落ちる）
//
// モジュールは import 時に AppState / supabase.auth の購読を張り、キューとカウンタを
// モジュールスコープに持つ。テスト間で状態が漏れないよう、毎テスト jest.resetModules() の
// 直後に読み直す。
// mock ファクトリはホイストされるため外部変数を参照できない（`mock` 接頭辞だけが例外）。
// そこでファクトリ側は薄いラッパにし、実体は下の安定した jest.fn() に委譲させる。
// こうしておくと resetModules でファクトリが再実行されても、テストから触る mock 関数は同一のまま。

const mockFetchWithAuth = jest.fn();
const mockGetSession = jest.fn();
const mockOnAuthStateChange = jest.fn();
const mockAppStateAddEventListener = jest.fn();

jest.mock("react-native", () => ({
	AppState: {
		addEventListener: (...args: any[]) => mockAppStateAddEventListener(...args),
	},
}));

jest.mock("@/constants/Env", () => ({
	// development 限定の console.error 経路を踏まないようにしておく（console.warn の回数を数えるため）
	Env: { NODE_ENV: "test" },
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
type AppStateHandler = (state: string) => void;

let logQueue: LogQueueModule;
let warnSpy: jest.SpyInstance;
let errorSpy: jest.SpyInstance;

/** マイクロタスクを流し切る（sendBatch は fake timers では進まない await の連鎖で構成される） */
const flushAsync = async (): Promise<void> => {
	for (let i = 0; i < 20; i++) await Promise.resolve();
};

const okResponse = (rejected = 0) => ({
	response: {
		ok: true,
		status: 200,
		json: async () => ({ data: { rejected } }),
	},
});

const errorResponse = (status: number) => ({
	response: {
		ok: false,
		status,
		json: async () => ({}),
	},
});

const makeLog = (i: number): CreateFrontendLogDto => ({
	event_name: `event_${i}`,
	path_name: "/test",
	payload: { i },
	error_level: "log",
	created_at: "2026-07-30T00:00:00.000Z",
	created_app_version: "1.11.0",
	created_commit_id: "0123456789abcdef",
});

const enqueueMany = (count: number): void => {
	for (let i = 0; i < count; i++) logQueue.enqueueLog(makeLog(i));
};

/** AppState.addEventListener("change", handler) に登録されたハンドラ */
const getAppStateHandler = (): AppStateHandler => mockAppStateAddEventListener.mock.calls[0][1] as AppStateHandler;

/** fetchWithAuth に渡された logs の合計件数 */
const sentLogCount = (): number =>
	mockFetchWithAuth.mock.calls.reduce((sum, call) => sum + call[1].requestPayload.logs.length, 0);

beforeEach(() => {
	jest.useFakeTimers();
	warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
	errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

	mockGetSession.mockResolvedValue({ data: { session: { access_token: "test-token", user: { id: "user-1" } } } });
	mockFetchWithAuth.mockResolvedValue(okResponse());

	jest.resetModules();
	// import() は babel-preset-expo が遅延読み込み用にそのまま残すため jest(CJS) では使えない。
	// requireActual は「このモジュール自体をモックしない」という意味で、依存（fetchWithAuth 等）は
	// 通常どおりモックレジストリ経由になる。
	logQueue = jest.requireActual<LogQueueModule>("./logQueue");
});

afterEach(() => {
	warnSpy.mockRestore();
	errorSpy.mockRestore();
	jest.useRealTimers();
});

describe("logQueue 送信結果の分類とカウンタ", () => {
	// C1
	it("200応答なら sentLogs が送信件数分増え、droppedBy* は増えない", async () => {
		enqueueMany(3);
		logQueue.flushLogQueue();
		await flushAsync();

		const stats = logQueue.getLogQueueStats();
		expect(mockFetchWithAuth).toHaveBeenCalledTimes(1);
		expect(stats.sentBatches).toBe(1);
		expect(stats.sentLogs).toBe(3);
		expect(stats.droppedByReject).toBe(0);
		expect(stats.droppedByTransient).toBe(0);
		expect(stats.partiallyRejected).toBe(0);
		expect(stats.lastFailure).toBeUndefined();
	});

	// C2 — #1076 の本体。400 が誰にも観測されないまま消えていた
	it("400応答なら droppedByReject が増え、lastFailure に記録され、console.warn が1回出る", async () => {
		mockFetchWithAuth.mockResolvedValue(errorResponse(400));

		enqueueMany(3);
		logQueue.flushLogQueue();
		await flushAsync();

		const stats = logQueue.getLogQueueStats();
		expect(stats.droppedByReject).toBe(3);
		expect(stats.droppedByTransient).toBe(0);
		expect(stats.sentLogs).toBe(0);
		expect(stats.lastFailure?.status).toBe(400);
		expect(stats.lastFailure?.kind).toBe("rejected");
		expect(stats.lastFailure?.count).toBe(3);
		expect(warnSpy).toHaveBeenCalledTimes(1);
	});

	// C3
	it("500応答なら droppedByTransient が増える（4xxと分類が分かれる）", async () => {
		mockFetchWithAuth.mockResolvedValue(errorResponse(500));

		enqueueMany(2);
		logQueue.flushLogQueue();
		await flushAsync();

		const stats = logQueue.getLogQueueStats();
		expect(stats.droppedByTransient).toBe(2);
		expect(stats.droppedByReject).toBe(0);
		expect(stats.lastFailure?.status).toBe(500);
		expect(stats.lastFailure?.kind).toBe("transient");
		expect(warnSpy).toHaveBeenCalledTimes(1);
	});

	// C4
	it("ネットワーク例外なら droppedByTransient が増え、console.warn が1回出る", async () => {
		mockFetchWithAuth.mockRejectedValue(new Error("Network request failed"));

		enqueueMany(4);
		logQueue.flushLogQueue();
		await flushAsync();

		const stats = logQueue.getLogQueueStats();
		expect(stats.droppedByTransient).toBe(4);
		expect(stats.droppedByReject).toBe(0);
		expect(stats.lastFailure?.status).toBeNull();
		expect(stats.lastFailure?.kind).toBe("transient");
		expect(warnSpy).toHaveBeenCalledTimes(1);
	});

	it("アクセストークンが取れないときは transient として扱い、送信は試みない", async () => {
		mockGetSession.mockResolvedValue({ data: { session: null } });

		enqueueMany(2);
		logQueue.flushLogQueue();
		await flushAsync();

		const stats = logQueue.getLogQueueStats();
		expect(mockFetchWithAuth).not.toHaveBeenCalled();
		expect(stats.droppedByTransient).toBe(2);
		expect(stats.droppedByReject).toBe(0);
		expect(stats.lastFailure?.status).toBeNull();
	});

	// C7
	it("200応答 + rejected:3 なら partiallyRejected が増え、console.warn が1回出る（droppedBy* は増えない）", async () => {
		mockFetchWithAuth.mockResolvedValue(okResponse(3));

		enqueueMany(5);
		logQueue.flushLogQueue();
		await flushAsync();

		const stats = logQueue.getLogQueueStats();
		expect(stats.partiallyRejected).toBe(3);
		expect(stats.sentLogs).toBe(5);
		expect(stats.droppedByReject).toBe(0);
		expect(stats.droppedByTransient).toBe(0);
		expect(warnSpy).toHaveBeenCalledTimes(1);
	});
});

describe("失敗ステータスの分類（#1079 レビュー指摘: 4xx を一律 rejected にしない）", () => {
	// C8 の一般化。TRANSIENT_STATUSES に入るものは「ログの中身が壊れている」ではないので
	// droppedByReject（= 契約違反の検知シグナル）に混ぜない
	it.each([401, 408, 425, 426, 429])("%i は transient に分類される", async (status) => {
		mockFetchWithAuth.mockResolvedValue(errorResponse(status));

		enqueueMany(2);
		logQueue.flushLogQueue();
		await flushAsync();

		const stats = logQueue.getLogQueueStats();
		expect(stats.droppedByTransient).toBe(2);
		expect(stats.droppedByReject).toBe(0);
		expect(stats.lastFailure?.status).toBe(status);
		expect(stats.lastFailure?.kind).toBe("transient");
	});

	it.each([400, 403, 404, 413, 422])("%i は rejected に分類される", async (status) => {
		mockFetchWithAuth.mockResolvedValue(errorResponse(status));

		enqueueMany(2);
		logQueue.flushLogQueue();
		await flushAsync();

		const stats = logQueue.getLogQueueStats();
		expect(stats.droppedByReject).toBe(2);
		expect(stats.droppedByTransient).toBe(0);
		expect(stats.lastFailure?.status).toBe(status);
		expect(stats.lastFailure?.kind).toBe("rejected");
	});

	// C8 の「再送しない」部分
	it("401でも失敗ログをキューへ戻さない（transient でも再送はしない）", async () => {
		mockFetchWithAuth.mockResolvedValue(errorResponse(401));

		enqueueMany(3);
		logQueue.flushLogQueue();
		await flushAsync();
		expect(mockFetchWithAuth).toHaveBeenCalledTimes(1);

		jest.advanceTimersByTime(5_000);
		await flushAsync();
		logQueue.flushLogQueue();
		await flushAsync();

		expect(mockFetchWithAuth).toHaveBeenCalledTimes(1);
		expect(logQueue.getLogQueueStats().droppedByTransient).toBe(3);
	});
});

describe("失敗が無限ループを生まないこと（#1079 の核心）", () => {
	// C5
	it("20件未満で400応答した後、タイマーを何度進めても再送されずキューも空のまま", async () => {
		mockFetchWithAuth.mockResolvedValue(errorResponse(400));

		enqueueMany(3);
		logQueue.flushLogQueue();
		await flushAsync();
		expect(mockFetchWithAuth).toHaveBeenCalledTimes(1);

		for (let i = 0; i < 3; i++) {
			jest.advanceTimersByTime(5_000);
			await flushAsync();
		}
		expect(mockFetchWithAuth).toHaveBeenCalledTimes(1);

		// キューが空（失敗ログを再enqueueしていない）なら flush しても送信は起きない
		logQueue.flushLogQueue();
		await flushAsync();
		expect(mockFetchWithAuth).toHaveBeenCalledTimes(1);
		expect(jest.getTimerCount()).toBe(0);
	});

	// C6
	it("失敗は新しいログを生まない（送信された合計件数が投入件数を超えない）", async () => {
		mockFetchWithAuth.mockResolvedValue(errorResponse(400));

		enqueueMany(7);
		logQueue.flushLogQueue();
		await flushAsync();

		jest.advanceTimersByTime(60_000);
		await flushAsync();

		const stats = logQueue.getLogQueueStats();
		expect(sentLogCount()).toBe(7);
		expect(stats.sentLogs + stats.droppedByReject + stats.droppedByTransient).toBe(7);
	});

	// C10
	it("失敗しても後続の送信は続く", async () => {
		mockFetchWithAuth.mockResolvedValue(errorResponse(400));
		enqueueMany(3);
		logQueue.flushLogQueue();
		await flushAsync();
		expect(mockFetchWithAuth).toHaveBeenCalledTimes(1);

		mockFetchWithAuth.mockResolvedValue(okResponse());
		logQueue.enqueueLog(makeLog(99));
		logQueue.flushLogQueue();
		await flushAsync();

		const stats = logQueue.getLogQueueStats();
		expect(mockFetchWithAuth).toHaveBeenCalledTimes(2);
		expect(mockFetchWithAuth.mock.calls[1][1].requestPayload.logs).toHaveLength(1);
		expect(stats.sentLogs).toBe(1);
		expect(stats.droppedByReject).toBe(3);
	});
});

describe("flush 契機の回帰（#1012 の既存挙動）", () => {
	// C9-1
	it("20件溜まったら即座に送信する", async () => {
		enqueueMany(19);
		await flushAsync();
		expect(mockFetchWithAuth).not.toHaveBeenCalled();

		logQueue.enqueueLog(makeLog(19));
		await flushAsync();

		expect(mockFetchWithAuth).toHaveBeenCalledTimes(1);
		expect(mockFetchWithAuth.mock.calls[0][1].requestPayload.logs).toHaveLength(20);
		expect(logQueue.getLogQueueStats().sentLogs).toBe(20);
	});

	// C9-2
	it("20件に満たなくても5秒後に送信する", async () => {
		enqueueMany(2);

		jest.advanceTimersByTime(4_999);
		await flushAsync();
		expect(mockFetchWithAuth).not.toHaveBeenCalled();

		jest.advanceTimersByTime(1);
		await flushAsync();

		expect(mockFetchWithAuth).toHaveBeenCalledTimes(1);
		expect(logQueue.getLogQueueStats().sentLogs).toBe(2);
	});

	// C9-3
	it("AppState が background / inactive に遷移したら送信する", async () => {
		enqueueMany(2);
		getAppStateHandler()("background");
		await flushAsync();
		expect(mockFetchWithAuth).toHaveBeenCalledTimes(1);

		logQueue.enqueueLog(makeLog(50));
		getAppStateHandler()("inactive");
		await flushAsync();
		expect(mockFetchWithAuth).toHaveBeenCalledTimes(2);

		// active への復帰では送信しない
		logQueue.enqueueLog(makeLog(51));
		getAppStateHandler()("active");
		await flushAsync();
		expect(mockFetchWithAuth).toHaveBeenCalledTimes(2);
	});

	it("キューが空なら flush しても送信しない", async () => {
		logQueue.flushLogQueue();
		await flushAsync();
		expect(mockFetchWithAuth).not.toHaveBeenCalled();
	});
});

describe("getLogQueueStats のスナップショット性（#1079 レビュー指摘: lastFailure の参照共有）", () => {
	it("取得済みのスナップショットは後続の失敗で書き換わらない", async () => {
		mockFetchWithAuth.mockResolvedValue(errorResponse(400));
		enqueueMany(1);
		logQueue.flushLogQueue();
		await flushAsync();

		const snapshot = logQueue.getLogQueueStats();
		expect(snapshot.lastFailure?.status).toBe(400);
		expect(Object.isFrozen(snapshot)).toBe(true);
		expect(Object.isFrozen(snapshot.lastFailure)).toBe(true);

		mockFetchWithAuth.mockResolvedValue(errorResponse(500));
		enqueueMany(1);
		logQueue.flushLogQueue();
		await flushAsync();

		// 過去のスナップショットは当時の値のまま
		expect(snapshot.lastFailure?.status).toBe(400);
		expect(snapshot.lastFailure?.kind).toBe("rejected");
		expect(snapshot.droppedByTransient).toBe(0);

		const latest = logQueue.getLogQueueStats();
		expect(latest.lastFailure?.status).toBe(500);
		expect(latest.lastFailure).not.toBe(snapshot.lastFailure);
	});
});

describe("テスト間でモジュール状態が漏れないこと", () => {
	it("直前のテストのカウンタを引き継がない", async () => {
		const stats = logQueue.getLogQueueStats();
		expect(stats.sentBatches).toBe(0);
		expect(stats.sentLogs).toBe(0);
		expect(stats.droppedByReject).toBe(0);
		expect(stats.droppedByTransient).toBe(0);
		expect(stats.partiallyRejected).toBe(0);
		expect(stats.lastFailure).toBeUndefined();
	});
});
