/*
#1400（親 #1375）共有を受け取ってから遷移するまでの «段取り» を固定する。

判定そのものは `lib/snsShareIntake.test.ts`、起動時 URL の罠は `lib/sharedText.test.ts` が持つ。
ここで守るのは、そのどちらでもない 3 つ:

1. **ナビゲータの準備完了を待ってから遷移する**（#1027。待たずに遷移するとアプリごとクラッシュする）
2. **認証の決着を待ってから «ログイン済みか» を判定する**（#1194。待たないとログイン済みの人を
   ログイン画面へ送る。`lib/authGuest.ts` は未確定をゲストへ倒すため）
3. **起動時の共有は 1 回、起動済みへの共有は毎回**（前者を毎回採用すると «開くたびに取り込む» になる）

`app/` 配下ではなく `__tests__/` に置いているのは、expo-router がルートとして拾わないようにするため
（`__tests__/myDishesFiltersRoute.test.tsx` と同じ理由）。
*/
import React from "react";
import type { SharedTextSource, SharedTextListener } from "@/lib/sharedText";

const mockPush = jest.fn();
let mockNavigationState: { key?: string } | undefined = { key: "root" };
jest.mock("expo-router", () => ({
	router: { push: (...args: unknown[]) => mockPush(...args) },
	useRootNavigationState: () => mockNavigationState,
}));

let mockLocale = "ja-JP";
jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: mockLocale, isJapanese: true }) }));

const mockLogFrontendEvent = jest.fn();
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: mockLogFrontendEvent }) }));

/** `getSession()` は sessionRef の同期参照（AuthProvider.tsx:180-181）。決着後の値をここで表す */
let mockSession: { user: { is_anonymous?: boolean } } | null = null;
/** 認証の決着を «待った» ことと、その後に session を読むことを検証するための遅延 */
const mockWaitForAuthResolved = jest.fn(async () => true);
jest.mock("@/contexts/AuthProvider", () => ({
	useAuth: () => ({ getSession: () => mockSession, waitForAuthResolved: mockWaitForAuthResolved }),
}));

const SHARED_POST_URL = "https://www.tiktok.com/@cookpad/video/7261234567890123456";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 実機と同じく «同じ値を返し続ける» 起動時ソース */
const makeSource = (initial: string | null) => {
	const listeners: SharedTextListener[] = [];
	const source: SharedTextSource & { initialReads: number; emit: (text: string) => void } = {
		initialReads: 0,
		getInitialSharedText: async () => {
			source.initialReads += 1;
			return initial;
		},
		subscribeSharedText: (listener) => {
			listeners.push(listener);
			return () => {
				const index = listeners.indexOf(listener);
				if (index >= 0) listeners.splice(index, 1);
			};
		},
		emit: (text) => listeners.forEach((listener) => listener(text)),
	};
	return source;
};

/**
 * ⚠️ react / react-test-renderer / 対象モジュールは `jest.resetModules()` の «後» にまとめて
 * require する。`lib/sharedText.ts` のモジュールスコープのフラグ（＝プロセス寿命）を
 * テストごとに巻き戻すためで、先頭で import すると別インスタンスの React を掴んで落ちる
 * （`__tests__/index.test.tsx` に同じ注意書きがある）。
 */
const mountIntake = async (source: SharedTextSource) => {
	const ReactActual = require("react");
	const { act } = require("react");
	const TestRenderer = require("react-test-renderer");
	const { useSnsShareIntake } = require("@/hooks/useSnsShareIntake");

	const Harness = () => {
		useSnsShareIntake(source);
		return null;
	};

	let tree!: ReturnType<typeof TestRenderer.create>;
	await act(async () => {
		tree = TestRenderer.create(ReactActual.createElement(Harness));
	});
	// 共有の読み取り → 認証の決着待ち → 遷移、と await が連なるので数回流す
	await act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});
	return { tree, act };
};

describe("useSnsShareIntake（共有の受け取りから遷移まで）", () => {
	beforeEach(() => {
		jest.resetModules();
		mockPush.mockClear();
		mockLogFrontendEvent.mockClear();
		mockWaitForAuthResolved.mockClear();
		mockNavigationState = { key: "root" };
		mockLocale = "ja-JP";
		mockSession = { user: { is_anonymous: false } };
	});

	it("ログイン済みで共有されると、取り込み確認へ push する", async () => {
		await mountIntake(makeSource(SHARED_POST_URL));

		expect(mockPush).toHaveBeenCalledTimes(1);
		expect(mockPush).toHaveBeenCalledWith({
			pathname: "/[locale]/add-record",
			params: { locale: "ja-JP", url: SHARED_POST_URL },
		});
	});

	// #1375 実機確認: **ログインを挟まない。** 共有した直後にログイン画面が出るのが一番離脱する形で、
	// 取り込み自体は匿名で成立する（`dish_media.user_id` は NULL、紐付けは `reactions(save)`）
	it("未ログインでも取り込み画面へ直接 push する", async () => {
		mockSession = null;

		await mountIntake(makeSource(SHARED_POST_URL));

		expect(mockPush).toHaveBeenCalledWith({
			pathname: "/[locale]/add-record",
			params: { locale: "ja-JP", url: SHARED_POST_URL },
		});
	});

	it("ゲスト（匿名）ユーザーもログインへ送らない", async () => {
		mockSession = { user: { is_anonymous: true } };

		await mountIntake(makeSource(SHARED_POST_URL));

		expect(mockPush.mock.calls[0][0]).toMatchObject({ pathname: "/[locale]/add-record" });
	});

	// #1194 コールドスタートでは «マウント» と «認証の初期化» が競合する。待たずに判定すると
	// ログイン済みのユーザーが毎回ログイン画面へ送られる
	it("認証の決着を待ってから判定する（待っている間に確定したログイン状態を採用する）", async () => {
		mockSession = null;
		mockWaitForAuthResolved.mockImplementationOnce(async () => {
			mockSession = { user: { is_anonymous: false } };
			return true;
		});

		await mountIntake(makeSource(SHARED_POST_URL));

		expect(mockWaitForAuthResolved).toHaveBeenCalled();
		expect(mockPush).toHaveBeenCalledWith({
			pathname: "/[locale]/add-record",
			params: { locale: "ja-JP", url: SHARED_POST_URL },
		});
	});

	// ★ 罠の本体。同じプロセスで画面が作り直されても、起動時の共有は 1 回しか採用しない
	it("再マウントしても、起動時の共有を 2 度取り込まない", async () => {
		const source = makeSource(SHARED_POST_URL);

		const { tree, act } = await mountIntake(source);
		expect(mockPush).toHaveBeenCalledTimes(1);

		await act(async () => {
			tree.unmount();
		});
		await mountIntake(source);

		expect(mockPush).toHaveBeenCalledTimes(1);
		expect(source.initialReads).toBe(1);
	});

	it("起動済みのアプリへ来た共有は «今回の共有» なので毎回採用する", async () => {
		const source = makeSource(null);
		const { act } = await mountIntake(source);
		expect(mockPush).not.toHaveBeenCalled();

		await act(async () => {
			source.emit(SHARED_POST_URL);
			await Promise.resolve();
			await Promise.resolve();
		});
		await act(async () => {
			source.emit(SHARED_POST_URL);
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(mockPush).toHaveBeenCalledTimes(2);
	});

	// #1027 ルートナビゲータのマウント前に遷移すると expo-router の assertIsReady が投げ、
	// JS 例外でアプリごと落ちる。準備できるまでは «共有を消費もしない»
	it("ナビゲータが準備できるまでは遷移も消費もしない", async () => {
		mockNavigationState = undefined;
		const source = makeSource(SHARED_POST_URL);

		await mountIntake(source);
		expect(mockPush).not.toHaveBeenCalled();
		expect(source.initialReads).toBe(0);

		mockNavigationState = { key: "root" };
		await mountIntake(source);
		expect(mockPush).toHaveBeenCalledTimes(1);
	});

	// 遷移の途中経過では locale が空文字になりうる（app/[locale]/_layout.tsx のコメント）。
	// そこで消費すると、行き先のロケールを間違えたまま «1 回きりの採用» を使い切る
	it("locale が未確定の間は消費しない", async () => {
		mockLocale = "";
		const source = makeSource(SHARED_POST_URL);

		await mountIntake(source);
		expect(source.initialReads).toBe(0);

		mockLocale = "en-US";
		await mountIntake(source);
		expect(mockPush).toHaveBeenCalledWith({
			pathname: "/[locale]/add-record",
			params: { locale: "en-US", url: SHARED_POST_URL },
		});
	});

	it("共有が無い起動では何もしない", async () => {
		await mountIntake(makeSource(null));

		expect(mockPush).not.toHaveBeenCalled();
		expect(mockLogFrontendEvent).not.toHaveBeenCalled();
	});

	// 共有テキストは第三者が作った任意の文字列なので、ログへ素通ししない
	it("ログに共有テキストそのものを載せない", async () => {
		await mountIntake(makeSource(`ここ美味しかった ${SHARED_POST_URL}`));

		expect(mockLogFrontendEvent).toHaveBeenCalledWith(
			expect.objectContaining({ event_name: "sns_share_intake_routed" }),
		);
		expect(JSON.stringify(mockLogFrontendEvent.mock.calls)).not.toContain("tiktok.com");
	});
});

// React を JSX 無しで使っているが、この import が無いと tsx として型が付かない
void React;
