import * as fs from "fs";
import * as path from "path";

// `constants/Env.ts` は expo-constants の expoConfig.extra（アプリのビルド成果物）に依存しており、
// jest からは読めない。CDN の URL 組み立てに使う 2 つだけ与えれば十分。
jest.mock("../constants/Env", () => ({
	Env: { NODE_ENV: "test", CDN_PUBLIC_HOST: "cdn.example.test", GCS_STATIC_MASTER_DIR_PATH: "static/" },
}));

/**
 * #1092 不変条件テスト: `getRemoteConfig()` は初期化前でも null を返さない。
 *
 * 呼び出し側は `parseInt(getRemoteConfig()?.v1_search_result_restaurants_number!, 10)` のように
 * 値が在る前提で書かれており、null が返ると `parseInt(undefined) = NaN` が API の DTO（件数）へ
 * 渡って 400 になりうる。既定値をアプリへ埋め込んでその経路を塞ぐのがこのテストの守る不変条件。
 *
 * 速さは測らない（#1082 の教訓）。「既定値を消したら必ず落ちる」形にしてあり、時間に依存しない。
 */

/** 2026-07-29 版（meta.version: "v2026.07.29"）の本番 config.json と同値であること */
const EXPECTED_DEFAULTS = {
	v1_min_frontend_log_level: "log",
	v1_search_result_dish_categories_number: "6",
	v1_search_result_restaurants_number: "5",
	v1_dish_comment_review_show_number: "140",
	v1_dish_media_image_completion_threshold_ms: "3000",
} as const;

/** `parseInt()` に渡される（= NaN になると API へ NaN が漏れる）キー */
const NUMERIC_KEYS = [
	"v1_search_result_dish_categories_number",
	"v1_search_result_restaurants_number",
	"v1_dish_comment_review_show_number",
	"v1_dish_media_image_completion_threshold_ms",
] as const;

/** CDN の config.json と同じ形（`{ data: [{ key, value }] }`）のレスポンスを作る */
const cdnResponse = (entries: Record<string, string>) => ({
	ok: true,
	json: async () => ({ data: Object.entries(entries).map(([key, value]) => ({ key, value })) }),
});

/**
 * module スコープのキャッシュ（cachedValues / currentSource）を持つので、
 * テストごとに読み直して状態を分離する。
 */
const loadRemoteConfig = () => {
	let mod!: typeof import("../lib/remoteConfig");
	jest.isolateModules(() => {
		mod = require("../lib/remoteConfig");
	});
	return mod;
};

describe("#1092 lib/remoteConfig.ts の既定値と null 耐性", () => {
	afterEach(() => {
		// @ts-expect-error テスト内で差し替えた fetch を戻す
		delete global.fetch;
	});

	it("初期化前でも getRemoteConfig() は null を返さない", () => {
		const { getRemoteConfig } = loadRemoteConfig();

		const config = getRemoteConfig();

		expect(config).not.toBeNull();
		expect(config).toBeDefined();
	});

	it("初期化前でも、アプリが読む件数系のキーが parseInt で NaN にならない", () => {
		const { getRemoteConfig } = loadRemoteConfig();

		for (const key of NUMERIC_KEYS) {
			const parsed = parseInt(getRemoteConfig()?.[key]!, 10);
			expect(Number.isFinite(parsed)).toBe(true);
			expect(parsed).toBeGreaterThan(0);
		}
	});

	it("既定値が現行の config.json と同値である", () => {
		const { getRemoteConfig, DEFAULT_REMOTE_CONFIG } = loadRemoteConfig();

		expect(getRemoteConfig()).toEqual(DEFAULT_REMOTE_CONFIG);
		expect(DEFAULT_REMOTE_CONFIG).toMatchObject(EXPECTED_DEFAULTS);
	});

	it("初期化前の出所は default である", () => {
		const { getRemoteConfigSource } = loadRemoteConfig();

		expect(getRemoteConfigSource()).toBe("default");
	});

	it("CDN から取得できたら値が上書きされ、出所が network になる", async () => {
		const { getRemoteConfig, getRemoteConfigSource, initRemoteConfig } = loadRemoteConfig();
		global.fetch = jest.fn().mockResolvedValue(cdnResponse({ v1_search_result_restaurants_number: "9" })) as any;

		await initRemoteConfig();

		expect(getRemoteConfig().v1_search_result_restaurants_number).toBe("9");
		expect(getRemoteConfigSource()).toBe("network");
	});

	it("CDN のレスポンスにキーが欠けていても undefined を配らない（既定値で埋める）", async () => {
		const { getRemoteConfig, initRemoteConfig } = loadRemoteConfig();
		// 件数系のキーを 1 つも含まないレスポンス
		global.fetch = jest.fn().mockResolvedValue(cdnResponse({ is_maintenance: "false" })) as any;

		await initRemoteConfig();

		for (const key of NUMERIC_KEYS) {
			expect(Number.isFinite(parseInt(getRemoteConfig()?.[key]!, 10))).toBe(true);
		}
	});

	it("CDN の取得に失敗しても getRemoteConfig() は既定値を返し、出所は default のまま", async () => {
		const { getRemoteConfig, getRemoteConfigSource, initRemoteConfig, DEFAULT_REMOTE_CONFIG } = loadRemoteConfig();
		global.fetch = jest.fn().mockRejectedValue(new Error("network down")) as any;

		await expect(initRemoteConfig()).rejects.toThrow();

		expect(getRemoteConfig()).toEqual(DEFAULT_REMOTE_CONFIG);
		expect(getRemoteConfigSource()).toBe("default");
	});

	it("取得成功後は再取得しない（プロセス内で 1 回だけ fetch する）", async () => {
		const { initRemoteConfig } = loadRemoteConfig();
		const fetchMock = jest.fn().mockResolvedValue(cdnResponse({ v1_search_result_restaurants_number: "9" }));
		global.fetch = fetchMock as any;

		await initRemoteConfig();
		await initRemoteConfig();

		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	/**
	 * #1079 の規律（`lib/logQueue.ts` sendBatch）と同じ理由。`hooks/useLogger.ts` は
	 * ログレベル判定で `getRemoteConfig()` を読むため、`lib/remoteConfig.ts` の中から
	 * ログを送ると logFrontendEvent → getRemoteConfig → logFrontendEvent の相互再帰になる。
	 * 値の出所は `getRemoteConfigSource()` を公開するに留め、送信は呼び出し側で行う。
	 */
	it("lib/remoteConfig.ts はログ送信経路を import しない（相互再帰の防止）", () => {
		const source = fs
			.readFileSync(path.join(__dirname, "..", "lib", "remoteConfig.ts"), "utf8")
			// 注意書きのコメント自体が enqueueLog() 等に言及するため、コメントを落としてから検査する
			.replace(/\/\*[\s\S]*?\*\//g, "")
			.replace(/\/\/.*$/gm, "");

		expect(source).not.toMatch(/from\s+["'].*logQueue["']/);
		expect(source).not.toMatch(/from\s+["'].*useLogger["']/);
		expect(source).not.toMatch(/\b(enqueueLog|logFrontendEvent)\s*\(/);
	});
});
