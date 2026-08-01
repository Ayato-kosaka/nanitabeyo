import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { SplashHandler } from "./SplashHandler";

/**
 * #1092 PR4b / PR3 の振る舞いテスト: **何も待たずに UI を出す**。
 *
 * `SplashHandler` は `isRemoteConfigReady && !isAuthLoading && !!user` が揃うまで `return null` していた。
 * 匿名サインインも Remote Config の CDN 取得も起動のたびにネットワーク往復を伴うため、
 * 回線が細い端末では「アプリが 1 ピクセルも描画されない」時間がそのまま初回起動の体感速度になっていた。
 *
 * ここで固定するのは 5 つ。どれも「ゲートを戻すと赤くなる」形にしてある:
 * 1. `user === null`（認証未確定）でも children がマウントされる
 * 2. Remote Config が未完了・取得失敗でも children がマウントされ、スプラッシュが解除される（PR3）
 * 3. 認証が未確定のままでもスプラッシュが解除される
 * 4. 匿名サインインが失敗しても必ずスプラッシュが解除される（#1089 の非退行。
 *    hideAsync() が呼ばれないと native はスプラッシュが張り付いたまま操作不能になる）
 * 5. hideAsync() 自体が失敗しても再試行される（同じくスプラッシュ張り付きの防止）。
 *    ゲートを外して effect の依存から auth が消えた結果、「失敗したらフラグを戻す」だけでは
 *    誰も呼び直さなくなったため、再試行の経路そのものをテストで固定する
 */

const mockHideAsync = jest.fn(async () => true);
jest.mock("expo-splash-screen", () => ({
	hideAsync: () => mockHideAsync(),
}));

/** Remote Config の初期化。テストごとに解決／失敗のタイミングを手で制御する */
let mockRemoteConfigPromise: Promise<void>;
let resolveRemoteConfig: () => void;
let rejectRemoteConfig: (err: Error) => void;
// #1092 PR2 で SplashHandler が getRemoteConfigSource() も読むようになったので併せて差し替える
jest.mock("@/lib/remoteConfig", () => ({
	initRemoteConfig: () => mockRemoteConfigPromise,
	getRemoteConfigSource: () => "network",
}));

// #1092 PR3 実体の retry() は失敗するたびに指数バックオフで待つ（500ms → 1s → 2s）。
// このテストが見たいのは「Remote Config がどうなろうと描画とスプラッシュ解除は済んでいる」ことなので、
// 待ち時間を挟まず 1 回で諦める形に差し替える（実時間に依存させない。#1082 の教訓）
jest.mock("@/lib/retry", () => ({
	retry: (fn: () => Promise<unknown>) => fn(),
}));

// #1092 PR2 で SplashHandler が remote_config_resolved を送るようになった。
// 実体の useLogger は logQueue → supabase → AsyncStorage まで芋づるで読み込み、
// jest 環境では AsyncStorage の native モジュールが無くて suite ごと落ちる。
// このテストの対象はログ内容ではなく描画とスプラッシュ解除なので、no-op に差し替える。
const mockLogFrontendEvent = jest.fn();
jest.mock("@/hooks/useLogger", () => ({
	useLogger: () => ({ logFrontendEvent: mockLogFrontendEvent }),
}));

// Env は expo-constants 経由で app.config を読むため、テストでは値だけ差し替える
jest.mock("@/constants/Env", () => ({ Env: { NODE_ENV: "test" } }));

// エラー UI 本体（i18n / PrimaryButton）はこのテストの対象ではないので、識別できる箱に差し替える
jest.mock("@/components/AuthErrorFallback", () => ({
	AuthErrorFallback: () => require("react").createElement("AuthErrorFallback"),
}));

type MockAuth = {
	loading: boolean;
	user: { id: string } | null;
	authError: { isRateLimited: boolean; message: string } | null;
	retryAuth: () => void;
	isRetryingAuth: boolean;
};

let mockAuth: MockAuth;
jest.mock("@/contexts/AuthProvider", () => ({
	useAuth: () => mockAuth,
}));

/** children がマウントされたかを識別するためだけのマーカー */
const AppChildren = () => React.createElement("AppChildren");

/** 匿名サインインがまだ終わっていない、起動直後の状態 */
const AUTH_PENDING: MockAuth = {
	loading: true,
	user: null,
	authError: null,
	retryAuth: () => {},
	isRetryingAuth: false,
};

/** 匿名サインインが有限回のリトライを使い切って失敗した状態（#1089） */
const AUTH_FAILED: MockAuth = {
	loading: false,
	user: null,
	authError: { isRateLimited: false, message: "signInAnonymously returned no session" },
	retryAuth: () => {},
	isRetryingAuth: false,
};

describe("#1092 SplashHandler は認証の完了を待たずに描画する", () => {
	let renderer: TestRenderer.ReactTestRenderer;

	const element = () => React.createElement(SplashHandler, null, React.createElement(AppChildren));

	const mount = async () => {
		await act(async () => {
			renderer = TestRenderer.create(element());
		});
	};

	/** 認証状態を変えて再レンダリングする */
	const updateAuth = async (next: MockAuth) => {
		mockAuth = next;
		await act(async () => {
			renderer.update(element());
		});
	};

	/** Remote Config の初期化を完了させる */
	const finishRemoteConfig = async () => {
		await act(async () => {
			resolveRemoteConfig();
			await mockRemoteConfigPromise;
		});
	};

	/** Remote Config の初期化を失敗させる（CDN へ到達できない端末） */
	const failRemoteConfig = async () => {
		await act(async () => {
			rejectRemoteConfig(new Error("Failed to load static master from CDN."));
			await mockRemoteConfigPromise.catch(() => {});
		});
	};

	/** 保留中の Promise（hideAsync の失敗 → 再試行）を消化するためだけの空 act */
	const flushPendingWork = async () => {
		await act(async () => {});
	};

	const isChildrenMounted = () => renderer.root.findAllByType(AppChildren).length > 0;
	const isAuthErrorFallbackShown = () =>
		renderer.root.findAll((node) => String(node.type) === "AuthErrorFallback").length > 0;

	beforeEach(() => {
		(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		mockRemoteConfigPromise = new Promise<void>((resolve, reject) => {
			resolveRemoteConfig = () => resolve();
			rejectRemoteConfig = (err) => reject(err);
		});
		// 誰も await しないまま reject すると unhandled rejection で警告が出るので受け皿を付けておく
		mockRemoteConfigPromise.catch(() => {});
		mockAuth = AUTH_PENDING;
	});

	it("user === null（認証未確定）でも children をマウントする", async () => {
		await mount();
		await finishRemoteConfig();

		// ここが false になるなら `!!user` / `!isAuthLoading` のゲートが復活している。
		// その状態では匿名サインインのネットワーク往復が終わるまでアプリが何も描画しない
		expect(mockAuth.user).toBeNull();
		expect(mockAuth.loading).toBe(true);
		expect(isChildrenMounted()).toBe(true);
	});

	// ── #1092 PR3: Remote Config の CDN 取得を待たない ──

	it("Remote Config が未完了でも children をマウントする（PR3）", async () => {
		// initRemoteConfig() を **一度も解決させない**。CDN が遅い／到達できない端末そのもの
		await mount();

		// ここが false になるなら `isAppReady = isRemoteConfigReady` のゲートが復活している。
		// その状態では CDN の往復（回線が細い端末では秒単位）の間、アプリが何も描画しない
		expect(isChildrenMounted()).toBe(true);
	});

	it("Remote Config が未完了でもスプラッシュを解除する（PR3）", async () => {
		await mount();

		// マウント直後の 1 回で解除されること。ここで 0 回なら描画済みの UI が
		// スプラッシュに隠されたままになり、PR3 の効果が丸ごと消える
		expect(mockHideAsync).toHaveBeenCalledTimes(1);
	});

	it("Remote Config の取得に失敗してもスプラッシュを解除し、children を出す（PR3）", async () => {
		await mount();
		await failRemoteConfig();

		expect(mockHideAsync).toHaveBeenCalledTimes(1);
		expect(isChildrenMounted()).toBe(true);
	});

	it("Remote Config の取得に失敗しても値の出所ログは 1 回だけ送る", async () => {
		await mount();
		await failRemoteConfig();

		const calls = mockLogFrontendEvent.mock.calls.filter(([arg]) => arg?.event_name === "remote_config_resolved");
		expect(calls).toHaveLength(1);
		expect(calls[0][0]).toMatchObject({ error_level: "warn", payload: { source: "network" } });
	});

	it("認証が未確定のままでもスプラッシュを解除する", async () => {
		await mount();
		await finishRemoteConfig();

		expect(mockHideAsync).toHaveBeenCalledTimes(1);
	});

	it("匿名サインインが失敗してもスプラッシュを解除する（#1089 の非退行）", async () => {
		await mount();
		// Remote Config は敢えて完了させない。認証が失敗しても解除された状態が保たれることを見る
		await updateAuth(AUTH_FAILED);

		expect(mockHideAsync).toHaveBeenCalledTimes(1);
		expect(isAuthErrorFallbackShown()).toBe(true);
	});

	it("認証が後から成功しても hideAsync を呼び直さない", async () => {
		await mount();
		await finishRemoteConfig();
		expect(mockHideAsync).toHaveBeenCalledTimes(1);

		await updateAuth({ ...AUTH_PENDING, loading: false, user: { id: "anon-1" } });

		expect(mockHideAsync).toHaveBeenCalledTimes(1);
		expect(isChildrenMounted()).toBe(true);
	});

	it("hideAsync が失敗したら呼び直す（フラグを戻すだけで終わらせない）", async () => {
		// 1 回目だけ失敗させる。フラグを戻すコードはあっても「戻した後に呼び直す者」が居ないと、
		// canRenderFirstFrame は一度 true になったら変わらないので二度と再試行されず、
		// native はスプラッシュが張り付いたまま操作不能になる（#1089 と同種の事故）
		mockHideAsync.mockRejectedValueOnce(new Error("Splash screen is not registered"));

		await mount();
		await finishRemoteConfig();
		await flushPendingWork();

		expect(mockHideAsync).toHaveBeenCalledTimes(2);
	});

	it("再試行が成功したらそれ以上は呼ばない", async () => {
		mockHideAsync.mockRejectedValueOnce(new Error("Splash screen is not registered"));

		await mount();
		await finishRemoteConfig();
		await flushPendingWork();
		expect(mockHideAsync).toHaveBeenCalledTimes(2);

		// 認証の解決など、その後の再レンダリングで 3 回目が走らないこと
		await updateAuth({ ...AUTH_PENDING, loading: false, user: { id: "anon-1" } });
		await flushPendingWork();

		expect(mockHideAsync).toHaveBeenCalledTimes(2);
	});

	it("失敗し続けても有限回で打ち切る（レンダリングループにしない）", async () => {
		mockHideAsync.mockRejectedValue(new Error("Splash screen is not registered"));

		await mount();
		await finishRemoteConfig();
		await flushPendingWork();
		await flushPendingWork();

		// MAX_SPLASH_HIDE_ATTEMPTS と一致させること。ここが青天井だと
		// 「失敗 → setState → 再レンダリング → 失敗」で CPU を焼き続ける
		expect(mockHideAsync).toHaveBeenCalledTimes(3);
	});

	it("hideAsync の解決を待っている間に再レンダリングされても二重に呼ばない", async () => {
		// フラグを await の前に立てているか（立てる位置を戻すと 2 回呼ばれて赤くなる）
		let finishHide: () => void = () => {};
		mockHideAsync.mockImplementationOnce(
			() =>
				new Promise<boolean>((resolve) => {
					finishHide = () => resolve(true);
				}),
		);

		await mount();
		await finishRemoteConfig();
		expect(mockHideAsync).toHaveBeenCalledTimes(1);

		// hideAsync が未解決のまま認証が進む
		await updateAuth({ ...AUTH_PENDING, loading: false, user: { id: "anon-1" } });
		expect(mockHideAsync).toHaveBeenCalledTimes(1);

		await act(async () => {
			finishHide();
		});
		expect(mockHideAsync).toHaveBeenCalledTimes(1);
	});

	it("認証が失敗している間は children ではなくエラー UI を出す", async () => {
		await mount();
		await finishRemoteConfig();
		await updateAuth(AUTH_FAILED);

		expect(isAuthErrorFallbackShown()).toBe(true);
		expect(isChildrenMounted()).toBe(false);
	});
});
