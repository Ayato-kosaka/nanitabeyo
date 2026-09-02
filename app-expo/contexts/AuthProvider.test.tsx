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
jest.mock("@/lib/logoutRedirect", () => ({ requestLogoutRedirect: jest.fn() }));
jest.mock("expo-linking", () => ({ parse: jest.fn() }));
jest.mock("expo-auth-session", () => ({ makeRedirectUri: jest.fn() }));
jest.mock("expo-web-browser", () => ({ openAuthSessionAsync: jest.fn() }));
jest.mock("@/stores/useDishMediaEntriesStore", () => ({
	useDishMediaEntriesStore: { getState: () => ({ clearByKey: jest.fn() }) },
}));
jest.mock("@/stores/useDishCategoriesStore", () => ({ useDishCategoriesStore: { getState: () => ({ clearByKey: jest.fn() }) } }));
jest.mock("@/features/profile/stores/useProfileStore", () => ({
	useProfileStore: { getState: () => ({ resetProfile: jest.fn() }) },
}));
jest.mock("@/stores/useCdnCookieStore", () => ({
	useCdnCookieStore: { getState: () => ({ clearCookies: jest.fn() }) },
}));
/*
#1629 my-dishes のキャッシュを «ユーザーが変わったら捨てる» ことを検証するため、
呼ばれたかどうかを読めるモックにする（他のストアは呼び出しを見ていないので使い捨てで足りる）。
`mock` 始まりの変数名だけが jest.mock の工場から参照できる（jest の制約）。
*/
const mockBumpMyDishes = jest.fn();
const mockClearMyDishesFeedScope = jest.fn();
jest.mock("@/features/myDishes/stores/useMyDishesRevisionStore", () => ({
	useMyDishesRevisionStore: { getState: () => ({ bump: mockBumpMyDishes }) },
}));
jest.mock("@/features/myDishes/stores/useMyDishesFeedScopeStore", () => ({
	useMyDishesFeedScopeStore: { getState: () => ({ clear: mockClearMyDishesFeedScope }) },
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

		// #1124 SIGNED_OUT 後の匿名サインインは setTimeout(0) の先へ移った（デッドロック回避）。
		// ここでタイマーを進めないと「クールダウンが効いている」ではなく「まだ発火していない」
		// という理由で緑になり、クールダウン検査を無効化しても気付けない（= このテストが空洞化する）。
		await act(async () => {
			jest.advanceTimersByTime(0);
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

		// iOS / Web は callback の外で再認証を開始してから遷移するとフリーズするため、
		// callback 内でホームへ遷移する。匿名サインイン自体は callback の外で開始する。
		const { useRouter } = jest.requireMock("expo-router") as { useRouter: () => { replace: jest.Mock } };
		const { requestLogoutRedirect } = jest.requireMock("@/lib/logoutRedirect") as { requestLogoutRedirect: jest.Mock };
		expect(requestLogoutRedirect).toHaveBeenCalledWith("ja-JP");
		expect(useRouter().replace).toHaveBeenCalledWith("/");

		await act(async () => {
			jest.advanceTimersByTime(0);
		});

		expect(auth.signInAnonymously).toHaveBeenCalledTimes(1);
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

	/**
	 * #1135 「認証初期化は、その最中に確立された新しいセッションを上書きしない」という不変条件のテスト。
	 *
	 * Web の OAuth は全画面リダイレクトなので、コールバックのページロードでは
	 * 認証初期化（runAuthAttempt）と `exchangeCodeForSession()` が同時に走る。
	 * GoTrueClient._acquireLock はロック保持中に来た呼び出しを pendingInLock へ積み、
	 * **外側の保持者はそれを drain し終わるまで解決しない**（@supabase/auth-js GoTrueClient.js:1123-1129）。
	 * そのため `getSession()` は「交換前の匿名セッション」を読んだまま、**交換が終わった後に**解決する。
	 * その戻り値を無条件に書き戻すと、確立済みの OAuth セッションを匿名ユーザーへ巻き戻す
	 * （localStorage は OAuth なのに画面はゲストのまま = 「1 回目のログインで入れない」）。
	 *
	 * ここでは getSession() の解決を保留したまま SIGNED_IN を流すことで、その順序を直接再現する。
	 */
	it("復元中に OAuth の SIGNED_IN が入ったら、後から匿名セッションで上書きしない（#1135）", async () => {
		// ロックの drain を再現する: getSession() は「交換前の匿名セッション」を読み終えているが、まだ解決しない
		let resolveGetSession!: (result: unknown) => void;
		auth.getSession.mockReturnValue(
			new Promise((resolve) => {
				resolveGetSession = resolve;
			}),
		);

		await mountProvider();

		// OAuth の code 交換が完了し、SIGNED_IN が届く（callback 画面の exchangeCodeForSession 由来）
		await act(async () => {
			await emitAuthStateChange("SIGNED_IN", fakeSession("oauth-1"));
		});
		expect(authValue.user?.id).toBe("oauth-1");

		// ★ ここでようやく getSession() が「交換前の匿名セッション」で解決する
		await act(async () => {
			resolveGetSession({ data: { session: fakeSession("anon-1") }, error: null });
		});

		// 古い読み取り結果で巻き戻してはいけない
		expect(authValue.user?.id).toBe("oauth-1");
		expect(authValue.getSession()?.user.id).toBe("oauth-1");
		// 復元経路を通っているので匿名サインインは走らない（OAuth セッションを潰す経路）
		expect(auth.signInAnonymously).not.toHaveBeenCalled();
	});

	/**
	 * #1135 「セッションが無い」と読んだ後に OAuth セッションが載った場合、匿名サインインを叩かないこと。
	 *
	 * `signInAnonymously()` は `_saveSession` で storage を書き換えるため、ここで叩くと
	 * 確立済みの OAuth セッションを **storage ごと** 潰す（React state だけの巻き戻しより重い破壊）。
	 * 匿名セッションが残っていない状態で Web のコールバックに戻った場合に到達しうる経路。
	 */
	it("セッション無しと読んだ後に OAuth の SIGNED_IN が入ったら、匿名サインインを叩かない（#1135）", async () => {
		let resolveGetSession!: (result: unknown) => void;
		auth.getSession.mockReturnValue(
			new Promise((resolve) => {
				resolveGetSession = resolve;
			}),
		);
		auth.signInAnonymously.mockResolvedValue({ data: { session: fakeSession("anon-1") }, error: null });

		await mountProvider();

		await act(async () => {
			await emitAuthStateChange("SIGNED_IN", fakeSession("oauth-1"));
		});

		// getSession() は「交換前 = セッション無し」を読んだまま、交換完了後に解決する
		await act(async () => {
			resolveGetSession({ data: { session: null }, error: null });
		});

		expect(auth.signInAnonymously).not.toHaveBeenCalled();
		expect(authValue.user?.id).toBe("oauth-1");
		// #1089 の事後条件（どの経路でも loading は false / 認証確立時は authError は null）は維持される
		expect(authValue.isAuthResolved).toBe(true);
		expect(authValue.authError).toBeNull();
	});

	/**
	 * #1135 匿名サインインの **完了後** の書き戻しも、その間に載った別セッションを巻き戻さないこと。
	 *
	 * 上 2 つのテストは「`getSession()` の解決が code 交換より後になる」インターリーブを見ているが、
	 * `getSession()` が «交換が始まる前» に「セッション無し」で解決した場合は分岐ガードを通り抜け、
	 * `retry(signInAnonymously)` の await をまたいだ区間が無防備になる。この区間では
	 *   1. 匿名サインインが `_saveSession` → SIGNED_IN(匿名) を流す
	 *   2. pendingInLock に積まれていた `exchangeCodeForSession()` が完了し SIGNED_IN(OAuth) を流す
	 *   3. その後で `signInAnonymously()` の Promise が解決する
	 * という順序が起こりうる。3 で無条件に書き戻すと、確立済みの OAuth セッションを匿名へ巻き戻す
	 * （storage は OAuth のまま = 本 Issue と同型の症状）。
	 *
	 * ⚠️ ここを世代カウンタで守ることはできない。1 の SIGNED_IN も世代を進めるため、
	 *    「自分が作った匿名セッション」と「別経路の OAuth セッション」を区別できず、
	 *    正常な匿名サインインまで書き戻しをスキップしてしまう。
	 *    そのため `sessionRef` が保持しているセッションの同一性（access_token）で判定する。
	 */
	it("匿名サインインの完了前に OAuth の SIGNED_IN が入ったら、後から匿名セッションで巻き戻さない（#1135）", async () => {
		// getSession() は「交換開始前」に解決する = 世代ガードを通り抜けて匿名サインイン経路へ進む
		auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
		// 匿名サインインは、下で明示的に解決するまで pending のまま
		let completeSignIn!: (result: unknown) => void;
		auth.signInAnonymously.mockReturnValue(
			new Promise((resolve) => {
				completeSignIn = resolve;
			}),
		);

		await mountProvider();
		expect(auth.signInAnonymously).toHaveBeenCalledTimes(1);

		// 1. 匿名サインイン自身の SIGNED_IN（auth-js は _saveSession の後に必ず流す）
		await act(async () => {
			await emitAuthStateChange("SIGNED_IN", fakeSession("anon-1"));
		});
		expect(authValue.user?.id).toBe("anon-1");

		// 2. pendingInLock に積まれていた code 交換が完了し、OAuth の SIGNED_IN が届く
		await act(async () => {
			await emitAuthStateChange("SIGNED_IN", fakeSession("oauth-1"));
		});
		expect(authValue.user?.id).toBe("oauth-1");

		// 3. ★ ここでようやく signInAnonymously() が解決する
		await act(async () => {
			completeSignIn({ data: { session: fakeSession("anon-1") }, error: null });
		});

		// 既に OAuth セッションが載っているので、匿名セッションで書き戻してはいけない
		expect(authValue.user?.id).toBe("oauth-1");
		expect(authValue.getSession()?.user.id).toBe("oauth-1");
		// #1089 の事後条件（loading は false / 認証確立時は authError は null）は維持される
		expect(authValue.isAuthResolved).toBe(true);
		expect(authValue.authError).toBeNull();
	});

	/**
	 * #1135 上の巻き戻しガードが、正常な匿名サインインまで止めてしまわないこと。
	 *
	 * 世代カウンタで守ろうとすると、匿名サインイン自身の SIGNED_IN で世代が進むため
	 * この経路が丸ごとスキップされる（＝匿名ユーザーが載らない）。同一性で判定していることを固定する。
	 */
	it("自分が作った匿名セッションの SIGNED_IN では、書き戻しをスキップしない（#1135）", async () => {
		auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
		let completeSignIn!: (result: unknown) => void;
		auth.signInAnonymously.mockReturnValue(
			new Promise((resolve) => {
				completeSignIn = resolve;
			}),
		);

		await mountProvider();

		// 匿名サインイン自身の SIGNED_IN だけが流れる（別経路は無い）
		await act(async () => {
			await emitAuthStateChange("SIGNED_IN", fakeSession("anon-1"));
		});

		await act(async () => {
			completeSignIn({ data: { session: fakeSession("anon-1") }, error: null });
		});

		expect(authValue.user?.id).toBe("anon-1");
		expect(authValue.getSession()?.user.id).toBe("anon-1");
		expect(authValue.isAuthResolved).toBe(true);
		expect(authValue.authError).toBeNull();
	});

	/**
	 * #1135 復元経路で `setSession()` を呼ばないこと。
	 *
	 * `getSession()` は storage からの復元（必要ならリフレッシュ）まで済ませており、その直後に
	 * 同じトークンで `setSession()` するのは `GET /auth/v1/user` を 1 往復増やすだけ。
	 * その往復時間がまるごと上のテストの競合ウィンドウになるため、呼ばないことを固定する。
	 */
	it("復元経路では setSession を呼ばない（#1135 競合ウィンドウを作らない）", async () => {
		auth.getSession.mockResolvedValueOnce({ data: { session: fakeSession("user-1") }, error: null });

		await mountProvider();

		// 復元自体はこれまでどおり成立する（sessionRef / setUser は残す）
		expect(authValue.user?.id).toBe("user-1");
		expect(authValue.getSession()?.user.id).toBe("user-1");
		expect(auth.setSession).not.toHaveBeenCalled();
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

	/*
	#1629 オーナー実機報告 2 件の共通の真因を固定する。

	  1. ログアウトしても前のユーザーの記録がグリッドに残る
	  2. ログインした直後に «候補がありません» が出る

	dev の実ログ（2026-08-30）はこの順に並んでいた。

	    logout_success → userChanged(匿名) → my_dishes_fetch_completed {count: 0}
	    → userChanged(本人)

	匿名として 0 件を取り切ると `hasFetchedInitial` が true になり、その «空のスライス» が
	本人へ切り替わっても残る。だから «残る» と «空» は同じ 1 つの原因である。

	⚠️ この期待を消すと、**画面には «前の人のデータ» か «空» のどちらかが必ず出る**。
	   件数の表示側で隠すのではなく、キャッシュごと捨てること。
	*/
	it("ユーザーが変わったら my-dishes のキャッシュを捨てる（前ユーザーの記録も «空» も残さない）", async () => {
		auth.getSession.mockResolvedValueOnce({ data: { session: fakeSession("anon-1") }, error: null });

		await mountProvider();
		mockBumpMyDishes.mockClear();
		mockClearMyDishesFeedScope.mockClear();

		await act(async () => {
			await emitAuthStateChange("SIGNED_IN", fakeSession("user-1"));
		});

		expect(mockBumpMyDishes).toHaveBeenCalledTimes(1);
		expect(mockClearMyDishesFeedScope).toHaveBeenCalledTimes(1);
	});

	it("同じユーザーのままなら my-dishes のキャッシュは捨てない（毎回取り直すのは無駄）", async () => {
		auth.getSession.mockResolvedValueOnce({ data: { session: fakeSession("user-1") }, error: null });

		await mountProvider();
		mockBumpMyDishes.mockClear();
		mockClearMyDishesFeedScope.mockClear();

		await act(async () => {
			await emitAuthStateChange("SIGNED_IN", fakeSession("user-1"));
		});

		expect(mockBumpMyDishes).not.toHaveBeenCalled();
		expect(mockClearMyDishesFeedScope).not.toHaveBeenCalled();
	});
});
