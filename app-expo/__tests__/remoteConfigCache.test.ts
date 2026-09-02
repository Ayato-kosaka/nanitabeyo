import AsyncStorage from "@react-native-async-storage/async-storage";

// `constants/Env.ts` は expo-constants の expoConfig.extra（アプリのビルド成果物）に依存しており、
// jest からは読めない。CDN の URL 組み立てに使う 2 つだけ与えれば十分。
jest.mock("../constants/Env", () => ({
	Env: { NODE_ENV: "test", CDN_PUBLIC_HOST: "cdn.example.test", GCS_STATIC_MASTER_DIR_PATH: "static/" },
}));

/**
 * #1092 PR3 の振る舞いテスト: Remote Config の **stale-while-revalidate**。
 *
 * PR2 までの `cachedValues` はプロセスメモリだけに載っていたので、アプリを落とすたびに
 * 「埋め込み既定値 → CDN 取得完了」を一からやり直していた。PR3 で描画が CDN 取得を待たなくなった以上、
 * 取得が終わるまでの数秒は **前回起動で得た本番値**で動くのが正しい。
 *
 * ここで固定するのは 4 つ。どれも「永続化を外すと赤くなる」形にしてある:
 * 1. 保存済みの値があれば CDN 取得の前に即座に使われ、出所は `cache` になる
 * 2. その後 CDN が取れたら上書きされ、出所は `network` になる（PR2 の「CDN が勝つ」性質）
 * 3. CDN 取得に成功したら次回起動のために保存する
 * 4. CDN の fetch がハングしてもタイムアウトで reject する（`retry()` は reject でしか再試行しない）
 */

/** CDN の config.json と同じ形（`{ data: [{ key, value }] }`）のレスポンスを作る */
const cdnResponse = (entries: Record<string, string>) => ({
	ok: true,
	json: async () => ({ data: Object.entries(entries).map(([key, value]) => ({ key, value })) }),
});

/**
 * module スコープのキャッシュ（cachedValues / currentSource / hasHydratedFromStorage）を持つので、
 * テストごとに読み直して状態を分離する。
 */
const loadRemoteConfig = () => {
	let mod!: typeof import("../lib/remoteConfig");
	jest.isolateModules(() => {
		mod = require("../lib/remoteConfig");
	});
	return mod;
};

/** 保留中の microtask（AsyncStorage の読み出しなど）を消化する */
const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve));

/** 「前回の起動で CDN から取得して保存した」状態を作る */
const seedStorage = async (key: string, values: Record<string, string>, version = 1) => {
	await AsyncStorage.setItem(key, JSON.stringify({ version, values }));
};

describe("#1092 PR3 Remote Config の永続キャッシュ（stale-while-revalidate）", () => {
	beforeEach(async () => {
		await AsyncStorage.clear();
	});

	afterEach(() => {
		// @ts-expect-error テスト内で差し替えた fetch を戻す
		delete global.fetch;
	});

	it("保存済みの値があれば CDN より先に使われ、出所は cache になる", async () => {
		const { REMOTE_CONFIG_STORAGE_KEY } = loadRemoteConfig();
		await seedStorage(REMOTE_CONFIG_STORAGE_KEY, { v1_search_result_restaurants_number: "12" });

		// module 状態を分けるため読み直す（保存は上で済ませてある）
		const { getRemoteConfig, getRemoteConfigSource, initRemoteConfig } = loadRemoteConfig();
		// CDN 取得は「まだ終わっていない」ままにする = 保存値だけで動く状態を観測する
		let releaseCdn!: (res: unknown) => void;
		const pendingCdn = new Promise((resolve) => {
			releaseCdn = resolve;
		});
		global.fetch = jest.fn(() => pendingCdn) as any;

		const initPromise = initRemoteConfig();
		await flushMicrotasks();

		// ここが "5"（埋め込み既定値）なら永続キャッシュが効いていない。
		// その場合、起動直後の数秒は毎回サーバ側の設定が無視されることになる
		expect(getRemoteConfig().v1_search_result_restaurants_number).toBe("12");
		expect(getRemoteConfigSource()).toBe("cache");

		releaseCdn(cdnResponse({}));
		await initPromise;
	});

	it("保存値で起動しても、CDN が取れたらそちらが勝つ（出所は network）", async () => {
		const { REMOTE_CONFIG_STORAGE_KEY } = loadRemoteConfig();
		await seedStorage(REMOTE_CONFIG_STORAGE_KEY, { v1_search_result_restaurants_number: "12" });

		const { getRemoteConfig, getRemoteConfigSource, initRemoteConfig } = loadRemoteConfig();
		global.fetch = jest.fn().mockResolvedValue(cdnResponse({ v1_search_result_restaurants_number: "3" })) as any;

		await initRemoteConfig();

		expect(getRemoteConfig().v1_search_result_restaurants_number).toBe("3");
		expect(getRemoteConfigSource()).toBe("network");
	});

	it("保存値に無いキーは埋め込み既定値で埋まる（undefined を配らない）", async () => {
		const { REMOTE_CONFIG_STORAGE_KEY, DEFAULT_REMOTE_CONFIG } = loadRemoteConfig();
		await seedStorage(REMOTE_CONFIG_STORAGE_KEY, { v1_search_result_restaurants_number: "12" });

		const { getRemoteConfig, initRemoteConfig } = loadRemoteConfig();
		global.fetch = jest.fn().mockRejectedValue(new Error("network down")) as any;

		await expect(initRemoteConfig()).rejects.toThrow();

		expect(getRemoteConfig().v1_dish_comment_review_show_number).toBe(
			DEFAULT_REMOTE_CONFIG.v1_dish_comment_review_show_number,
		);
		expect(Number.isFinite(parseInt(getRemoteConfig().v1_dish_comment_review_show_number, 10))).toBe(true);
	});

	it("CDN から取れた値を次回起動のために保存する（既定値は保存しない）", async () => {
		const { REMOTE_CONFIG_STORAGE_KEY, initRemoteConfig } = loadRemoteConfig();
		global.fetch = jest.fn().mockResolvedValue(cdnResponse({ v1_search_result_restaurants_number: "3" })) as any;

		await initRemoteConfig();

		const raw = await AsyncStorage.getItem(REMOTE_CONFIG_STORAGE_KEY);
		// ここが null なら永続化が効いていない = 次回起動もまた既定値からやり直しになる
		expect(raw).not.toBeNull();
		expect(JSON.parse(raw!)).toEqual({ version: 1, values: { v1_search_result_restaurants_number: "3" } });
	});

	it("保存された値は次のプロセスでも読める（保存 → 読み込みが往復する）", async () => {
		// 1 回目の起動: CDN から取得して保存する
		const first = loadRemoteConfig();
		global.fetch = jest.fn().mockResolvedValue(cdnResponse({ v1_search_result_restaurants_number: "7" })) as any;
		await first.initRemoteConfig();

		// 2 回目の起動: CDN へは到達できない。保存値で動けること
		const second = loadRemoteConfig();
		global.fetch = jest.fn().mockRejectedValue(new Error("network down")) as any;
		await expect(second.initRemoteConfig()).rejects.toThrow();

		expect(second.getRemoteConfig().v1_search_result_restaurants_number).toBe("7");
		expect(second.getRemoteConfigSource()).toBe("cache");
	});

	it("保存フォーマットの版が違えば無視して既定値で動く", async () => {
		const { REMOTE_CONFIG_STORAGE_KEY } = loadRemoteConfig();
		await seedStorage(REMOTE_CONFIG_STORAGE_KEY, { v1_search_result_restaurants_number: "12" }, 999);

		const { getRemoteConfig, getRemoteConfigSource, initRemoteConfig, DEFAULT_REMOTE_CONFIG } = loadRemoteConfig();
		global.fetch = jest.fn().mockRejectedValue(new Error("network down")) as any;

		await expect(initRemoteConfig()).rejects.toThrow();

		expect(getRemoteConfig()).toEqual(DEFAULT_REMOTE_CONFIG);
		expect(getRemoteConfigSource()).toBe("default");
	});

	it("保存内容が壊れていても throw せず既定値で動く", async () => {
		const { REMOTE_CONFIG_STORAGE_KEY } = loadRemoteConfig();
		await AsyncStorage.setItem(REMOTE_CONFIG_STORAGE_KEY, "{ not json");

		const { getRemoteConfig, getRemoteConfigSource, initRemoteConfig, DEFAULT_REMOTE_CONFIG } = loadRemoteConfig();
		global.fetch = jest.fn().mockResolvedValue(cdnResponse({}) as any) as any;

		await initRemoteConfig();

		// JSON.parse の例外が外へ漏れると initRemoteConfig ごと落ちる（= CDN 取得まで巻き添え）
		expect(getRemoteConfigSource()).toBe("network");
		expect(getRemoteConfig()).toEqual(DEFAULT_REMOTE_CONFIG);
	});

	it("保存値に文字列以外が混ざっていても取り込まない", async () => {
		const { REMOTE_CONFIG_STORAGE_KEY, DEFAULT_REMOTE_CONFIG } = loadRemoteConfig();
		await AsyncStorage.setItem(
			REMOTE_CONFIG_STORAGE_KEY,
			JSON.stringify({
				version: 1,
				values: { v1_search_result_restaurants_number: 12, v1_min_frontend_log_level: "warn" },
			}),
		);

		const { getRemoteConfig, initRemoteConfig } = loadRemoteConfig();
		global.fetch = jest.fn().mockRejectedValue(new Error("network down")) as any;

		await expect(initRemoteConfig()).rejects.toThrow();

		// 数値のまま取り込むと parseInt 経路ではなく `.toString()` 前提の箇所で崩れる
		expect(getRemoteConfig().v1_search_result_restaurants_number).toBe(
			DEFAULT_REMOTE_CONFIG.v1_search_result_restaurants_number,
		);
		expect(getRemoteConfig().v1_min_frontend_log_level).toBe("warn");
	});

	it("AsyncStorage が使えなくても CDN 取得は続行する", async () => {
		const getItemSpy = jest.spyOn(AsyncStorage, "getItem").mockRejectedValueOnce(new Error("storage unavailable"));
		const setItemSpy = jest.spyOn(AsyncStorage, "setItem").mockRejectedValueOnce(new Error("storage unavailable"));

		const { getRemoteConfig, getRemoteConfigSource, initRemoteConfig } = loadRemoteConfig();
		global.fetch = jest.fn().mockResolvedValue(cdnResponse({ v1_search_result_restaurants_number: "3" })) as any;

		await initRemoteConfig();

		expect(getRemoteConfig().v1_search_result_restaurants_number).toBe("3");
		expect(getRemoteConfigSource()).toBe("network");

		getItemSpy.mockRestore();
		setItemSpy.mockRestore();
	});

	/**
	 * `retry()` は **reject でしか再試行しない**ので、settle しない fetch が 1 本あると
	 * 初期化はそこで永久に止まり、その端末は二度と network へ昇格しない。
	 */
	it("CDN の fetch がハングしてもタイムアウトで reject する", async () => {
		jest.useFakeTimers();
		try {
			const { initRemoteConfig, REMOTE_CONFIG_FETCH_TIMEOUT_MS } = loadRemoteConfig();
			// signal が渡っていなければ、この Promise は永遠に settle しない = テストがタイムアウトする
			global.fetch = jest.fn(
				(_url: string, init?: { signal?: AbortSignal }) =>
					new Promise((_resolve, reject) => {
						init?.signal?.addEventListener("abort", () => reject(new Error("Aborted")));
					}),
			) as any;

			const initPromise = initRemoteConfig();
			const assertion = expect(initPromise).rejects.toThrow();

			// 非同期版で進める。同期版の advanceTimersByTime だと AsyncStorage 読み出しの
			// microtask が消化されず、そもそも fetch まで到達しない
			await jest.advanceTimersByTimeAsync(REMOTE_CONFIG_FETCH_TIMEOUT_MS);

			await assertion;
		} finally {
			jest.useRealTimers();
		}
	});
});
