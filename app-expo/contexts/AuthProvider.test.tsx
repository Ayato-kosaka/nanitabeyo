import { act } from "react";
import TestRenderer from "react-test-renderer";
import { supabase } from "@/lib/supabase";
import { RATE_LIMIT_MIN_COOLDOWN_MS } from "@/lib/authRecovery";
import { AuthProvider, useAuth } from "./AuthProvider";

/**
 * #1097 「429 のクールダウンは、実際に匿名サインインを叩くまでの最小間隔である」という不変条件のテスト。
 *
 * #1089 の実装ではクールダウンを見ていたのが `retryAuth` と AppState 復帰だけで、
 * `SIGNED_OUT`（リフレッシュトークン失効などでも飛ぶ）は `runAuthAttempt()` を直接呼んでいたため、
 * 429 の直後に `SIGNED_OUT` が来るとクールダウン中でも `/auth/v1/signup` を叩けた。
 * Supabase の匿名サインインは 30 回/時/IP なので、この抜けは残り枠を無駄に削る。
 *
 * 純ロジック（lib/authRecovery.ts）のテストでは「どの経路がクールダウンを確認しているか」を固定できないため、
 * ここだけは AuthProvider を実際にレンダリングし、`onAuthStateChange` へ `SIGNED_OUT` を流したときに
 * `signInAnonymously` が呼ばれるか否かを直接観測する（= 修正を戻すと赤になる位置に置く）。
 */

// AuthProvider が import する副作用の重い依存を差し替える（このテストの観測対象は supabase.auth の呼ばれ方だけ）
jest.mock("@/lib/supabase", () => ({
	supabase: {
		auth: {
			getSession: jest.fn(),
			setSession: jest.fn(),
			signInAnonymously: jest.fn(),
			onAuthStateChange: jest.fn(),
			refreshSession: jest.fn(),
		},
	},
	consumeAuthRetryAfterHeader: jest.fn(() => null),
}));
jest.mock("@/lib/e2e/injectTestSession", () => ({
	injectTestSession: jest.fn(async () => "skipped"),
	isTestSessionInjectionError: jest.fn(() => false),
}));
jest.mock("@/hooks/useLogger", () => {
	// 毎レンダーで新しい関数を返すと runAuthAttempt の identity が変わるので、安定した 1 つを返す
	const logFrontendEvent = jest.fn();
	return { useLogger: () => ({ logFrontendEvent }) };
});
jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP" }) }));
jest.mock("expo-router", () => {
	const replace = jest.fn();
	return { useRouter: () => ({ replace }) };
});
jest.mock("expo-linking", () => ({ parse: jest.fn() }));
jest.mock("expo-auth-session", () => ({ makeRedirectUri: jest.fn() }));
jest.mock("expo-web-browser", () => ({ openAuthSessionAsync: jest.fn() }));
jest.mock("@/stores/useDishMediaEntriesStore", () => ({
	useDishMediaEntriesStore: { getState: () => ({ clearByKey: jest.fn() }) },
}));
jest.mock("@/stores/useTopicsStore", () => ({ useTopicsStore: { getState: () => ({ clearByKey: jest.fn() }) } }));
jest.mock("@/features/profile/stores/useProfileStore", () => ({
	useProfileStore: { getState: () => ({ resetProfile: jest.fn() }) },
}));
jest.mock("@/stores/useCdnCookieStore", () => ({
	useCdnCookieStore: { getState: () => ({ clearCookies: jest.fn() }) },
}));

/** 上の jest.mock で差し替えた supabase.auth（すべて jest.fn） */
const auth = supabase.auth as unknown as {
	getSession: jest.Mock;
	setSession: jest.Mock;
	signInAnonymously: jest.Mock;
	onAuthStateChange: jest.Mock;
};

/** onAuthStateChange に登録されるハンドラ（テストで使う分だけの型） */
type AuthStateChangeHandler = (event: string, session: unknown) => Promise<void> | void;

const fakeSession = (userId: string) => ({
	access_token: `access-${userId}`,
	refresh_token: `refresh-${userId}`,
	user: { id: userId },
});

/** Supabase の AuthApiError 相当（status を持つ Error） */
const authApiError = (status: number, message = "boom") => Object.assign(new Error(message), { status });

describe("AuthProvider の 429 クールダウン（#1097）", () => {
	/** onAuthStateChange へ登録されたハンドラ。Supabase の代わりにテストからイベントを流すのに使う */
	let emitAuthStateChange: AuthStateChangeHandler;
	/** AuthProvider が配る context の最新値 */
	let authValue: ReturnType<typeof useAuth>;

	const Probe = () => {
		authValue = useAuth();
		return null;
	};

	/** AuthProvider をマウントし、起動時の runAuthAttempt を完了させる */
	const mountProvider = async () => {
		await act(async () => {
			TestRenderer.create(
				<AuthProvider>
					<Probe />
				</AuthProvider>,
			);
		});
	};

	beforeEach(() => {
		// クールダウン（既定 60 秒）を実時間で待たずに検証するため、タイマーと Date.now を固定する
		jest.useFakeTimers();
		// react-test-renderer の act を有効にする（React 19）
		(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

		auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
		auth.setSession.mockResolvedValue({ data: { session: null }, error: null });
		auth.onAuthStateChange.mockImplementation((handler: AuthStateChangeHandler) => {
			emitAuthStateChange = handler;
			return { data: { subscription: { unsubscribe: jest.fn() } } };
		});
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it("429 のクールダウン中に SIGNED_OUT が来ても匿名サインインを叩かない", async () => {
		auth.signInAnonymously.mockResolvedValue({ data: { session: null }, error: authApiError(429) });

		await mountProvider();

		// 起動時の試行が 429（429 は retry() の対象外なので 1 回だけ叩く）→ クールダウンが置かれる
		expect(auth.signInAnonymously).toHaveBeenCalledTimes(1);
		expect(authValue.authError?.isRateLimited).toBe(true);

		// リフレッシュトークン失効などで、その直後に SIGNED_OUT が飛ぶ状況
		await act(async () => {
			await emitAuthStateChange("SIGNED_OUT", null);
		});

		// ここで 2 回目が飛ぶと、クールダウン中に /auth/v1/signup を叩いて 30 回/時/IP の枠を削る
		expect(auth.signInAnonymously).toHaveBeenCalledTimes(1);
	});

	it("クールダウン中でも、ユーザー操作起点の再試行は待ち時間を消化したうえで必ず叩く", async () => {
		auth.signInAnonymously.mockResolvedValue({ data: { session: null }, error: authApiError(429) });

		await mountProvider();
		expect(auth.signInAnonymously).toHaveBeenCalledTimes(1);

		// クールダウン判定を runAuthAttempt の入口へ寄せても、ユーザーが押した再試行だけは
		// force で通す（黙って捨てると「押しても何も起きない再試行ボタン」になる）
		auth.signInAnonymously.mockResolvedValue({ data: { session: fakeSession("anon-1") }, error: null });
		act(() => {
			authValue.retryAuth();
		});
		expect(authValue.isRetryingAuth).toBe(true);

		await act(async () => {
			jest.advanceTimersByTime(RATE_LIMIT_MIN_COOLDOWN_MS);
		});

		expect(auth.signInAnonymously).toHaveBeenCalledTimes(2);
		expect(authValue.user?.id).toBe("anon-1");
		expect(authValue.authError).toBeNull();
	});

	/**
	 * #1092 `isAuthResolved` は「認証が決着したか（成功・失敗を問わず）」。
	 *
	 * 多くの画面が `user?.is_anonymous !== false` でゲスト判定をしており、これは
	 * 「まだ決まっていない(user === null)」と「ゲストで確定した」を同じ扱いにする。
	 * ログイン済みのリピーターには「一瞬ゲスト UI → 本来の UI」というちらつきになるため、
	 * 未確定を区別できる値をコンテキストが配っていること自体を固定する。
	 */
	it("isAuthResolved は認証が決着するまで false、決着したら（失敗でも）true になる", async () => {
		// 匿名サインインの完了を任意のタイミングまで遅らせ、「未確定」の瞬間を観測する
		let completeSignIn!: (result: unknown) => void;
		auth.signInAnonymously.mockReturnValue(
			new Promise((resolve) => {
				completeSignIn = resolve;
			}),
		);

		await mountProvider();

		expect(authValue.isAuthResolved).toBe(false);
		expect(authValue.user).toBeNull();

		await act(async () => {
			completeSignIn({ data: { session: fakeSession("anon-1") }, error: null });
		});

		expect(authValue.isAuthResolved).toBe(true);
		expect(authValue.isAuthResolved).toBe(!authValue.loading);
	});

	it("認証が失敗して確定したときも isAuthResolved は true（未確定と失敗確定を混同しない）", async () => {
		auth.signInAnonymously.mockResolvedValue({ data: { session: null }, error: authApiError(429) });

		await mountProvider();

		expect(authValue.isAuthResolved).toBe(true);
		expect(authValue.user).toBeNull();
		expect(authValue.authError).not.toBeNull();
	});

	/**
	 * #1124 「SIGNED_OUT のコールバックの中で supabase.auth.* を呼ばない」という不変条件のテスト。
	 *
	 * GoTrueClient.signOut() は _acquireLock でロックを保持したまま
	 * `await _notifyAllSubscribers('SIGNED_OUT')` でこのコールバックの完了を待つ。
	 * コールバック内で getSession()/signInAnonymously() を await すると _acquireLock の再入分岐が
	 * 外側の _signOut の完了を待つため循環待ちになり、**永久にデッドロックする**。
	 * ロックが解放されないので以降の supabase.auth.* が全て停止し、API 呼び出しが全滅する。
	 *
	 * ここでは「コールバックが解決した時点ではまだ叩いていない」ことを直接観測することで、
	 * `await runAuthAttempt()` を戻したら赤くなる位置にテストを置く。
	 */
	it("SIGNED_OUT のコールバック内では匿名サインインを叩かない（デッドロック防止）", async () => {
		// 起動時はセッション復元に成功 → クールダウンは置かれない
		auth.getSession.mockResolvedValueOnce({ data: { session: fakeSession("user-1") }, error: null });
		auth.signInAnonymously.mockResolvedValue({ data: { session: fakeSession("anon-1") }, error: null });

		await mountProvider();
		expect(auth.signInAnonymously).not.toHaveBeenCalled();

		await act(async () => {
			await emitAuthStateChange("SIGNED_OUT", null);
		});

		// ★ コールバックはロック保持中に await されている。ここで叩いていたらデッドロックする
		expect(auth.signInAnonymously).not.toHaveBeenCalled();

		// ★ 遷移は匿名サインインの成否に依存しない（従来は finally にあり、デッドロックで到達しなかった）
		const { useRouter } = jest.requireMock("expo-router") as { useRouter: () => { replace: jest.Mock } };
		expect(useRouter().replace).toHaveBeenCalledWith("/");
	});

	it("SIGNED_OUT でコールバックを抜けた直後に匿名サインインし、セッションを張り直す", async () => {
		auth.getSession.mockResolvedValueOnce({ data: { session: fakeSession("user-1") }, error: null });
		auth.signInAnonymously.mockResolvedValue({ data: { session: fakeSession("anon-1") }, error: null });

		await mountProvider();

		await act(async () => {
			await emitAuthStateChange("SIGNED_OUT", null);
		});

		// コールバックを抜けた後（= ロック解放後）に実行される
		await act(async () => {
			jest.advanceTimersByTime(0);
		});

		expect(auth.signInAnonymously).toHaveBeenCalledTimes(1);
		expect(authValue.user?.id).toBe("anon-1");
	});

	it("SIGNED_OUT が連続しても匿名サインインは 1 回にまとまる（枠を無駄に消費しない）", async () => {
		auth.getSession.mockResolvedValueOnce({ data: { session: fakeSession("user-1") }, error: null });
		auth.signInAnonymously.mockResolvedValue({ data: { session: fakeSession("anon-1") }, error: null });

		await mountProvider();

		await act(async () => {
			await emitAuthStateChange("SIGNED_OUT", null);
			await emitAuthStateChange("SIGNED_OUT", null);
		});
		await act(async () => {
			jest.advanceTimersByTime(0);
		});

		expect(auth.signInAnonymously).toHaveBeenCalledTimes(1);
	});
});
