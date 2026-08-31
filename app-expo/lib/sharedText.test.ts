/**
 * #1400（親 #1375）「起動時の共有は プロセスにつき 1 回だけ 採用する」を固定する。
 *
 * ## なぜこのテストが要るのか
 * `Linking.getInitialURL()` は «今回のディープリンク» ではなく «起動時の URL» を返し続ける、
 * という罠がこのリポジトリでは #1124 で一度実際に起きている
 * （`app/index.tsx:23,72,97` / `app/[locale]/auth/callback.tsx:18,181`）。
 * 共有インテントも同じ性質を持つ（Android は `getIntent()` に残り、iOS は App Group に残る）。
 *
 * ここを外すと **一度共有した URL がアプリを開くたびに何度も取り込まれる**。
 * 「値が残っている source から 2 回読んでも、採用は 1 回きり」をここで固定する。
 *
 * モジュールスコープのフラグを検証対象にしているので、テストごとに `jest.resetModules()` して
 * 読み直す（`__tests__/index.test.tsx` と同じ作法。テスト専用のリセット関数は生やさない）。
 */
import type { SharedTextSource } from "./sharedText";

const SHARED_URL = "https://www.tiktok.com/@cookpad/video/7261234567890123456";

/** 実機と同じく «同じ値を返し続ける» source。ここが罠の再現そのもの */
const stickySource = (value: string | null): SharedTextSource & { calls: number } => {
	const source = {
		calls: 0,
		getInitialSharedText: async () => {
			source.calls += 1;
			return value;
		},
		subscribeSharedText: () => () => {},
	};
	return source;
};

const loadModule = () => {
	jest.resetModules();
	return require("./sharedText") as typeof import("./sharedText");
};

describe("consumeInitialSharedText", () => {
	it("初回は共有テキストを返す", async () => {
		const { consumeInitialSharedText } = loadModule();
		const source = stickySource(SHARED_URL);

		await expect(consumeInitialSharedText(source)).resolves.toBe(SHARED_URL);
		expect(source.calls).toBe(1);
	});

	// ★ 本題。同じプロセスで 2 度読んでも 2 度取り込まない
	it("2 回目以降は source を読まずに null を返す（同じ URL で何度も取り込まない）", async () => {
		const { consumeInitialSharedText } = loadModule();
		const source = stickySource(SHARED_URL);

		await consumeInitialSharedText(source);
		await expect(consumeInitialSharedText(source)).resolves.toBeNull();
		await expect(consumeInitialSharedText(source)).resolves.toBeNull();
		expect(source.calls).toBe(1);
	});

	it("同一タスク内で同時に呼ばれても 1 回しか読まない（await の前に閉じている）", async () => {
		const { consumeInitialSharedText } = loadModule();
		const source = stickySource(SHARED_URL);

		const [first, second] = await Promise.all([consumeInitialSharedText(source), consumeInitialSharedText(source)]);

		expect([first, second].filter((value) => value !== null)).toEqual([SHARED_URL]);
		expect(source.calls).toBe(1);
	});

	// 「共有が無かった」も 1 回の採用として消費する。ここで消費しないと、共有なしで起動した
	// アプリが後から «起動時の値» を読みに行く経路が残り、罠の入口が開いたままになる
	it("共有が無い起動でも採用の機会は使い切る", async () => {
		const { consumeInitialSharedText } = loadModule();
		const empty = stickySource(null);
		const late = stickySource(SHARED_URL);

		await expect(consumeInitialSharedText(empty)).resolves.toBeNull();
		await expect(consumeInitialSharedText(late)).resolves.toBeNull();
		expect(late.calls).toBe(0);
	});

	it("source が投げてもアプリを止めない（起動できない方が害が大きい）", async () => {
		const { consumeInitialSharedText } = loadModule();
		const throwing: SharedTextSource = {
			getInitialSharedText: async () => {
				throw new Error("native bridge unavailable");
			},
			subscribeSharedText: () => () => {},
		};

		await expect(consumeInitialSharedText(throwing)).resolves.toBeNull();
	});

	it("プロセスが変われば（＝モジュールを読み直せば）また採用できる", async () => {
		const first = loadModule();
		await first.consumeInitialSharedText(stickySource(SHARED_URL));

		const relaunched = loadModule();
		await expect(relaunched.consumeInitialSharedText(stickySource(SHARED_URL))).resolves.toBe(SHARED_URL);
	});
});

describe("lib/sharedTextSource.ts（PR1 の既定実装）", () => {
	// PR1 はネイティブに触らないので «共有は来ない» が正しい既定である。
	// PR2 / PR3 がここを差し替える（差し替え忘れをこのテストが可視化する）
	it("起動時の共有は無く、購読しても何も来ない", async () => {
		jest.resetModules();
		const { sharedTextSource } = require("./sharedTextSource") as typeof import("./sharedTextSource");

		await expect(sharedTextSource.getInitialSharedText()).resolves.toBeNull();

		const listener = jest.fn();
		const unsubscribe = sharedTextSource.subscribeSharedText(listener);
		unsubscribe();
		expect(listener).not.toHaveBeenCalled();
	});
});
