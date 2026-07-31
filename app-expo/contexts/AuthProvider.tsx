import { createContext, useContext, useEffect, useState, ReactNode, useRef, useCallback, useMemo } from "react";
import { supabase, consumeAuthRetryAfterHeader } from "@/lib/supabase";
// #1030 【設計】E2E(Detox) 専用のセッション注入フック。
// 通常ビルドでは metro.config.js が noop 実装（lib/e2e/injectTestSession.noop.ts）へ解決し直すため、
// 本番バンドルにはこの実装コードも react-native-launch-arguments も一切含まれない。
import { injectTestSession, isTestSessionInjectionError } from "@/lib/e2e/injectTestSession";
import { Session, User, Provider, SignOut } from "@supabase/supabase-js";
import * as Linking from "expo-linking";
import { useLogger } from "@/hooks/useLogger";
import { useLocale } from "@/hooks/useLocale";
import { AppState, Platform } from "react-native";
import { retry } from "@/lib/retry";
import {
	ANON_SIGN_IN_RETRIES,
	getAuthErrorStatus,
	isRateLimitAuthError,
	isRetryableAuthError,
	parseRetryAfterMs,
	resolveAuthCooldownMs,
} from "@/lib/authRecovery";
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import { Href, useRouter } from "expo-router";
import { useDishMediaEntriesStore } from "@/stores/useDishMediaEntriesStore";
import { useTopicsStore } from "@/stores/useTopicsStore";
import { useProfileStore } from "@/features/profile/stores/useProfileStore";
import { useCdnCookieStore } from "@/stores/useCdnCookieStore";

/**
 * #1089 認証の初期化（セッション復元 or 匿名サインイン）が、リトライを使い切っても確立できなかった状態。
 * 「まだ試している最中」とは区別され、UI へエラーと再試行手段を出すためのトリガーになる。
 */
export type AuthFailure = {
	/** Supabase のレート制限（429）由来か。UI の文言を切り替えるために持つ */
	isRateLimited: boolean;
	/** 失敗の内容（デバッグ用。UI にそのまま出さない） */
	message: string;
};

type AuthContextType = {
	user: User | null;
	getSession: () => Session | null;
	refreshSession: () => Promise<Session | null>;
	loading: boolean;
	/**
	 * #1092 認証の初期化が決着したか（成功・失敗を問わず）。`= !loading`。
	 *
	 * `user?.is_anonymous !== false` という書き方は「まだ決まっていない(user === null)」と
	 * 「ゲストで確定した」を同じ扱いにするため、ログイン済みのリピーターには
	 * 「一瞬ゲスト UI → 本来の UI」というちらつきになる。
	 * 未確定の間は描画を保留する / スケルトンを出す、という判断に使う。
	 */
	isAuthResolved: boolean;
	/** #1089 認証初期化が最終的に失敗している間だけ非 null。成功すると null に戻る */
	authError: AuthFailure | null;
	/** #1089 認証初期化をやり直す。429 のクールダウン中は、その時間を待ってから実行される */
	retryAuth: () => void;
	/** #1089 `retryAuth()` の実行中（クールダウンの待機時間を含む） */
	isRetryingAuth: boolean;
	loginWithEmail: (email: string, password: string) => Promise<void>;
	logout: (options?: SignOut) => Promise<void>;
	signUpWithEmail: (email: string, password: string) => Promise<void>;
	signInWithOAuth: (provider: Provider, options?: { queryParams?: { [key: string]: string } }) => Promise<void>;
	signInWithOtp: (phone: string) => Promise<void>;
	verifyOtp: (phone: string, token: string) => Promise<void>;
	linkIdentity: (provider: Provider, options?: { queryParams?: { [key: string]: string } }) => Promise<void>;
	handleOAuthResultUrl: (url?: string | null) => Promise<User | null | undefined>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * 🔐 認証状態と認証APIを提供するコンテキストプロバイダ。
 *
 * - `supabase.auth` によるセッション監視を行い、ログイン状態を保持
 * - 初期化時には `getSession()` を通じて状態を復元
 * - OAuth, メールログイン・サインアップ機能を提供
 */
export const AuthProvider = ({ children }: { children: ReactNode }) => {
	const router = useRouter();
	const { logFrontendEvent } = useLogger();
	const [user, setUser] = useState<User | null>(null);
	const [loading, setLoading] = useState(true);
	const { locale } = useLocale();
	const sessionRef = useRef<Session | null>(null);
	const getSession = useCallback(() => sessionRef.current, []);

	// #1089 認証初期化の失敗と、そこからの復帰に必要な状態
	const [authError, setAuthError] = useState<AuthFailure | null>(null);
	const [isRetryingAuth, setIsRetryingAuth] = useState(false);
	/** 認証初期化が実行中か。再試行ボタン連打・イベント多重発火で匿名サインインを二重に叩かないための門番 */
	const isAuthenticatingRef = useRef(false);
	/** 次に匿名サインインを叩いてよい時刻(epoch ms)。429 のバックオフをここで表現する */
	const nextAttemptAllowedAtRef = useRef(0);
	/** クールダウン待ちで予約済みの再試行タイマー。二重予約の防止と unmount 時の解除に使う */
	const pendingRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	/**
	 * 401 を受けたリクエストが、新しい access token で即時再試行できるようにする。
	 * Supabase の自動更新は後続リクエストには効くが、既に失敗した通信は再送しないため、
	 * 更新済み Session を呼び出し元へ返しつつ、同期参照する sessionRef も先に更新する。
	 */
	const refreshSession = useCallback(async (): Promise<Session | null> => {
		const { data, error } = await supabase.auth.refreshSession();
		if (error) throw error;

		const refreshedSession = data.session;
		if (refreshedSession) {
			sessionRef.current = refreshedSession;
			setUser(refreshedSession.user);
		}

		return refreshedSession;
	}, []);

	/**
	 * 🔐 初期セッションの復元 or 匿名ログイン。
	 * - アプリ起動時に呼び出され、常にセッション状態を確認する。
	 * - セッションがなければ匿名ログインを自動的に実施。
	 * - Supabase Auth は永続化済みなので、基本的にセッションは復元される前提。
	 *
	 * #1089 【バグ】以前はこの処理が `useEffect(..., [])` の中に閉じた「起動時 1 回だけ」の関数で、
	 * 匿名サインインが失敗すると setUser が一度も呼ばれないまま user=null が固定され、
	 * `SplashHandler` の isAppReady が恒久的に false になっていた（web は薄グレーの空画面、
	 * native は SplashScreen.hideAsync() が呼ばれずスプラッシュ固着）。
	 * 復帰できるよう、再試行・フォアグラウンド復帰からも呼べる関数として外へ出している。
	 *
	 * 事後条件（ここが崩れると再び「永久に何も起きない」状態になる）:
	 * - 成功時: user が非 null になり、authError は null
	 * - 失敗時: authError が非 null（= UI がエラーと再試行手段を出せる）
	 * - どちらでも: loading は必ず false になる
	 *
	 * @param force 429 のクールダウンを無視して実行する。ユーザーの明示的な再試行操作からのみ渡す（#1097）
	 */
	const runAuthAttempt = useCallback(async ({ force = false }: { force?: boolean } = {}) => {
		// #1089 多重実行の防止。再試行ボタンの連打やイベントの重複発火で匿名サインインが同時に何本も飛ぶと、
		// 30 回/時/IP の枠を一気に消費して状況を悪化させる
		if (isAuthenticatingRef.current) return;

		// #1097 「クールダウンは実際に匿名サインインを叩くまでの最小間隔」という不変条件は、
		// 呼び出し経路ごとではなく **実際に叩くこの関数の入口** で守る。
		// 以前は retryAuth と AppState 復帰だけが確認しており、SIGNED_OUT 経路（リフレッシュトークン
		// 失効など）はクールダウン中でも即座に /auth/v1/signup を叩けた（30 回/時/IP の枠を無駄に消費する）。
		//
		// ⚠️ force はユーザー操作起点の再試行（retryAuth）専用。ここで一律にブロックすると
		//    「押しても何も起きない再試行ボタン」になり、#1089 で作った復帰経路そのものが死ぬ。
		//
		// 早期 return しても事後条件は崩れない: nextAttemptAllowedAtRef が未来を指しているのは
		// 「直前の試行が catch まで到達した」= finally で loading=false になり authError が立っている
		// 状態だけなので、UI はエラーと再試行手段を出したままになる（成功時は 0 に戻される）。
		if (!force && Date.now() < nextAttemptAllowedAtRef.current) return;

		isAuthenticatingRef.current = true;

		try {
				// #1030 【設計】E2E(Detox) 実行時のみ、起動引数で渡されたセッションを注入して匿名サインインを回避する
				//（Supabase の匿名サインインは 30 回/時/IP 制限があり、dev/prod で同一プロジェクトを共有しているため）。
				// 通常ビルドでは noop 実装へ差し替えられるので、この行は常に "skipped" を返して素通りする。
				// ⚠️ ここで早期 return せず、以降の getSession() → 復元 の既存フローへ合流させるのが重要（#1030 レビュー M-5）:
				//    注入後も `sessionRestored` ログ・`sessionRef` 更新・`setUser` は本番と完全に同一経路を通る。
				// ⚠️ 注入するかどうかは「セッションの有無」ではなく「期待ユーザーとの一致」で判定される（同 B-1）。
				//    期待ユーザーと不一致なのに注入できない場合は例外が飛ぶ（fail-loud。下の catch で再 throw する）。
			await injectTestSession();

			const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
			if (sessionError) throw sessionError;
			const restoredSession = sessionData?.session;

			if (restoredSession) {
				await supabase.auth.setSession({
					access_token: restoredSession.access_token,
					refresh_token: restoredSession.refresh_token,
				});

				logFrontendEvent({
					event_name: "sessionRestored",
					error_level: "log",
					payload: { user_id: restoredSession.user.id },
				});

				sessionRef.current = restoredSession;
				setUser(restoredSession.user);
			} else {
				// #1089 匿名サインインはオフラインや 5xx といった一時的な理由で簡単に落ちるため、有限回リトライする。
				// ⚠️ 429（レート制限）はここではリトライしない（isRetryableAuthError が false を返す）。
				//    30 回/時/IP・窓 1 時間の制限を秒間隔で叩き直しても成功率は上がらず枠を潰すだけなので、
				//    下の catch で長いクールダウンを置き、「ユーザーの再試行」「フォアグラウンド復帰」まで待つ。
				const anonSession = await retry(
					async () => {
						const { data, error } = await supabase.auth.signInAnonymously();
						if (error) throw error;
						return data.session;
					},
					{
						retries: ANON_SIGN_IN_RETRIES,
						initialDelayMs: 500,
						maxDelayMs: 4000,
						backoffFactor: 2,
						shouldRetry: (error) => isRetryableAuthError(error),
					},
				);

				// #1089 エラー無しでセッションも返らないケースを成功として扱うと、user=null のまま
				// authError も立たない「復帰不能な無風状態」に戻ってしまうので、明示的に失敗へ倒す
				if (!anonSession) throw new Error("signInAnonymously returned no session");

				logFrontendEvent({
					event_name: "signInAnonymously",
					error_level: "log",
					payload: { user_id: anonSession.user.id },
				});

				sessionRef.current = anonSession;
				setUser(anonSession.user);
			}

			nextAttemptAllowedAtRef.current = 0;
			setAuthError(null);
		} catch (err: any) {
			const status = getAuthErrorStatus(err);
			logFrontendEvent({
				event_name: "authInitError",
				error_level: "error",
				payload: { message: err.message, status },
			});
			// #1089 認証が確立できていないときは logQueue がアクセストークンを用意できず、
			// 上の authInitError は送信されずに破棄される（= どこにも記録が残らない）。
			// 原因を追える最後の手段として console にも 1 行だけ残す（logQueue.ts の drop ログと同じ方針）。
			console.warn(`[AuthProvider] auth initialization failed: status=${status ?? "n/a"} message=${err?.message}`);

			// #1089 429 は `Retry-After` を尊重した長いクールダウンを置く。それ以外は retry() で待った後なので 0
			const cooldownMs = resolveAuthCooldownMs(err, parseRetryAfterMs(consumeAuthRetryAfterHeader(), Date.now()));
			nextAttemptAllowedAtRef.current = Date.now() + cooldownMs;
			setAuthError({ isRateLimited: isRateLimitAuthError(err), message: err?.message ?? "" });

			// #1030 【設計】E2E のセッション注入失敗だけは握り潰さない（fail-loud。レビュー B-1）。
			// 通常の初期化エラー（ネットワーク断等）はこれまでどおり握り潰して起動を続けるが、
			// 「期待ユーザーで走れていない」状態で先へ進むとテストが緑のまま嘘の検証をするため、明示的に落とす。
			// 通常ビルドでは isTestSessionInjectionError が常に false を返すので、本番挙動は 1 バイトも変わらない。
			// なお、この throw は呼び出し側が await しないため unhandled rejection となり RN アプリ自体は停止しない。
			// セッション未確立のままテストが確実に失敗すること + console.error(E2E_TEST_SESSION_SENTINEL 付き)で
			// 原因を logcat から特定できることを「fail-loud」として扱う（レビュー m-1）。
			if (isTestSessionInjectionError(err)) throw err;
		} finally {
			isAuthenticatingRef.current = false;
			setLoading(false);
		}
	}, [logFrontendEvent]);

	/**
	 * #1089 認証初期化の再試行。エラー UI の再試行ボタンと、フォアグラウンド復帰から呼ばれる。
	 *
	 * ループしないことの保証:
	 * 1. 実行中（isAuthenticatingRef）なら何もしない
	 * 2. 予約済み（pendingRetryTimerRef）なら二重に予約しない
	 * 3. この関数は**外部起点のイベント（ユーザー操作 / OS のフォアグラウンド復帰）からしか呼ばれず**、
	 *    失敗しても自分自身を再予約しない。したがって「失敗 → 即再試行 → 失敗」の自走ループが構造上作れない
	 * 4. 429 のクールダウン（nextAttemptAllowedAtRef）は失敗のたびに未来へ進むだけで、短縮されない
	 */
	const retryAuth = useCallback(() => {
		if (isAuthenticatingRef.current || pendingRetryTimerRef.current) return;

		// クールダウン中に押された場合は、待ち時間を消化してから叩く（押しても何も起きない状態にしない）
		const waitMs = Math.max(0, nextAttemptAllowedAtRef.current - Date.now());
		setIsRetryingAuth(true);
		pendingRetryTimerRef.current = setTimeout(() => {
			pendingRetryTimerRef.current = null;
			// #1097 待ち時間はここで既に消化済みなので force で通す。
			// クールダウンの判定を runAuthAttempt の入口へ寄せた結果、force なしだと
			// 「タイマーの誤差 1ms」や「待機中に別経路の失敗でクールダウンが未来へ伸びた」だけで
			// ユーザーの再試行が黙って捨てられ、押しても何も起きないボタンになるため。
			runAuthAttempt({ force: true }).finally(() => setIsRetryingAuth(false));
		}, waitMs);
	}, [runAuthAttempt]);

	// #1089 フォアグラウンド復帰による復帰経路。
	// バックグラウンド中に回線が復旧した / レート制限の窓が明けた ケースを、ユーザー操作なしで拾う。
	// ループしない保証: 発火源は OS のアプリ状態遷移だけで、この処理自体はアプリ状態を変化させない。
	// 加えて「認証済みなら何もしない」「実行中/予約中なら何もしない」「クールダウン中は何もしない」で三重に抑止する。
	// #1097 3 つ目（クールダウン）の判定は runAuthAttempt の入口へ移した（経路ごとに書くと今回のように
	// 抜ける経路が出るため）。ここで force を渡さないので、クールダウン中の復帰は従来どおり素通りする。
	useEffect(() => {
		const subscription = AppState.addEventListener("change", (state) => {
			if (state !== "active") return;
			if (user) return;
			if (isAuthenticatingRef.current || pendingRetryTimerRef.current) return;
			void runAuthAttempt();
		});

		return () => subscription.remove();
	}, [user, runAuthAttempt]);

	useEffect(() => {
		runAuthAttempt();

		/**
		 * 👀 認証状態のリアルタイム監視。
		 * - ログイン/ログアウトなどのイベントを自動検出
		 */
		const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
			const newUserId = session?.user?.id ?? null;
			const prevUser = sessionRef.current?.user ?? null;
			const hasUserChanged = (prevUser?.id ?? null) !== (newUserId ?? null);
			logFrontendEvent({
				event_name: `onAuthStateChange:${event}`,
				error_level: "debug",
				payload: { user_id: newUserId, event },
			});

			if (hasUserChanged) {
				// ✅ ユーザーが切り替わったときにストアをクリア
				useDishMediaEntriesStore.getState().clearByKey();
				useTopicsStore.getState().clearByKey();
				useProfileStore.getState().resetProfile();
				useCdnCookieStore.getState().clearCookies();
			}

			if (event === "INITIAL_SESSION") {
				// initializeAuth で処理済
			} else if (event === "SIGNED_IN") {
				if (!session) return;
				if (hasUserChanged) {
					// signInWithOAuth は、未登録なら新規ユーザーを作り、匿名ユーザーから切り替わる可能性がある
					// そのため、 user.id の変化を検出してログを出す
					logFrontendEvent({
						event_name: "userChanged",
						error_level: "log",
						payload: { previous_user_id: sessionRef.current?.user.id, new_user_id: session.user.id },
					});
				}
				setUser(session.user);
				sessionRef.current = session;
				// router.replace('/');
			} else if (event === "SIGNED_OUT") {
				sessionRef.current = null;
				setUser(null);

				try {
					// #1089 ログアウト直後の匿名サインインも runAuthAttempt に寄せる。
					// ここで失敗を握り潰すと user=null のまま authError も立たず、
					// 起動時と同じ「画面が出ないまま戻れない」状態になるため（リトライとエラー UI を共通化する）。
					// #1097 force は渡さない。SIGNED_OUT はユーザー操作とは限らない（リフレッシュトークン失効等でも
					// 飛ぶ）ため、429 のクールダウン中はここで叩かず、再試行ボタン / フォアグラウンド復帰を待つ。
					await runAuthAttempt();
				} finally {
					router.replace("/");
				}
			} else if (event === "PASSWORD_RECOVERY") {
				// パスワード制のログイン機能を持たせる予定がないなら不要
			} else if (event === "TOKEN_REFRESHED") {
				if (!session) return;
				setUser(session.user);
				sessionRef.current = session;
			} else if (event === "USER_UPDATED") {
				// setUser(session.user);
				// setSession(session);
			}
		});

		return () => {
			authListener?.subscription.unsubscribe();
			// #1089 予約済みの再試行が unmount 後に走って setState するのを防ぐ
			if (pendingRetryTimerRef.current) {
				clearTimeout(pendingRetryTimerRef.current);
				pendingRetryTimerRef.current = null;
			}
		};
	}, []);

	/**
	 * メールアドレスとパスワードでログインする。
	 * @throws エラーが発生した場合は呼び出し元でキャッチする
	 */
	const loginWithEmail = async (email: string, password: string) => {
		const { error } = await supabase.auth.signInWithPassword({ email, password });
		if (error) throw error;
	};

	/**
	 * メールアドレスとパスワードでサインアップする。
	 * @throws エラーが発生した場合は呼び出し元でキャッチする
	 */
	const signUpWithEmail = async (email: string, password: string) => {
		const { data, error } = await supabase.auth.signUp({ email, password });
		if (error) throw error;
	};

	/**
	 * OAuthプロバイダーでログインする。
	 * 新規ユーザー作成 または 既存ユーザー へのログインを行う。
	 * @param provider - 'google' などのOAuthプロバイダー名
	 */
	const signInWithOAuth = async (provider: Provider, options?: { queryParams?: { [key: string]: string } }) => {
		const { queryParams = {} } = options || {};

		// Google のときはデフォルトで毎回アカウント選択を出す
		const defaultQueryParamsForProvider: Record<Provider, { [k: string]: string }> = {
			google: { prompt: "select_account" },
			// 他のプロバイダ用に何かあればここに書く
		} as any;

		const mergedQueryParams = {
			...(defaultQueryParamsForProvider[provider] ?? {}),
			...queryParams, // 呼び出し側で上書きしたければこちらが優先
		};

		const redirectTo =
			Platform.OS === "web"
				? `${window.location.origin}/${locale}/auth/callback?intent=signin`
				: AuthSession.makeRedirectUri({ scheme: "nanitabeyo", path: `${locale}/auth/callback?intent=signin` });
		const { data, error } = await supabase.auth.signInWithOAuth({
			provider,
			options: {
				redirectTo,
				queryParams: mergedQueryParams,
				...(Platform.OS === "web" ? {} : { skipBrowserRedirect: true }),
			},
		});
		if (error) throw error;
		if (Platform.OS !== "web" && data?.url) {
			const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
			if (result.type === "success" && result.url) {
				const parsed = Linking.parse(result.url);
				const locale = (parsed.hostname ?? "ja-JP") as string;
				const qp = Object.fromEntries(Object.entries(parsed.queryParams ?? {}).map(([k, v]) => [k, String(v)])); // queryParams は string | number | boolean | null などが来るので文字列化
				const href: Href = {
					pathname: "/[locale]/auth/callback",
					params: { locale, ...qp },
				};
				router.replace(href);
			}
		}
	};

	/**
	 * 電話番号でOTPを送信する（ログイン/サインアップ兼用）
	 * @param phone - E.164フォーマットの電話番号
	 */
	const signInWithOtp = async (phone: string) => {
		const { error } = await supabase.auth.signInWithOtp({ phone });
		if (error) throw error;
	};

	/**
	 * OTPを検証してログインする
	 * @param phone - E.164フォーマットの電話番号
	 * @param token - 6桁のOTPコード
	 */
	const verifyOtp = async (phone: string, token: string): Promise<void> => {
		const { data, error } = await supabase.auth.verifyOtp({
			phone,
			token,
			type: "sms",
		});
		if (error) throw error;
	};

	/**
	 * 匿名ユーザーにOAuthアイデンティティをリンクする
	 * 成功時は 同一 auth.users.id を維持して昇格可能。
	 * ただし、既に他のユーザーにリンク済みの OAuth であれば失敗する。
	 * @param provider - 'google' などのOAuthプロバイダー名
	 */
	const linkIdentity = async (
		provider: Provider,
		options?: { queryParams?: { [key: string]: string } },
	): Promise<void> => {
		const { queryParams = {} } = options || {};

		// Google のときはデフォルトで毎回アカウント選択を出す
		const defaultQueryParamsForProvider: Record<Provider, { [k: string]: string }> = {
			google: { prompt: "select_account" },
			// 他のプロバイダ用に何かあればここに書く
		} as any;

		const mergedQueryParams = {
			...(defaultQueryParamsForProvider[provider] ?? {}),
			...queryParams, // 呼び出し側で上書きしたければこちらが優先
		};

		const redirectTo =
			Platform.OS === "web"
				? // linkIdentity の場合は、 匿名アップグレード由来のリダイレクトであることを示すために `?intent=link` を付与
					`${window.location.origin}/${locale}/auth/callback?intent=link&provider=${provider}`
				: AuthSession.makeRedirectUri({
						scheme: "nanitabeyo",
						path: `${locale}/auth/callback?intent=link&provider=${provider}`,
					});
		const { data, error } = await supabase.auth.linkIdentity({
			provider,
			options: {
				redirectTo,
				queryParams: mergedQueryParams,
				...(Platform.OS === "web" ? {} : { skipBrowserRedirect: true }),
			},
		});
		if (error) throw error;
		if (Platform.OS !== "web" && data?.url) {
			const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
			if (result.type === "success" && result.url) {
				const parsed = Linking.parse(result.url);
				const locale = (parsed.hostname ?? "ja-JP") as string;
				const qp = Object.fromEntries(Object.entries(parsed.queryParams ?? {}).map(([k, v]) => [k, String(v)])); // queryParams は string | number | boolean | null などが来るので文字列化
				const href: Href = {
					pathname: "/[locale]/auth/callback",
					params: { locale, ...qp },
				};
				router.replace(href);
			}
		}
	};

	/** OAuthのリダイレクトURIから認証結果を処理する
	 * - PKCE (codeフロー) と 旧インプリシット (#access_token) の両方に対応
	 */
	const handleOAuthResultUrl = async (url?: string | null) => {
		if (!url) return;

		const parsed = Linking.parse(url);
		const code = parsed.queryParams?.code as string | undefined;
		const intent = parsed.queryParams?.intent as string | undefined;
		const provider = parsed.queryParams?.provider as Provider | undefined;
		const error = parsed.queryParams?.error as string | undefined;
		const error_code = parsed.queryParams?.error_code as string | undefined;
		const error_description = parsed.queryParams?.error_description as string | undefined;

		// エラーがある場合は、そのまま例外として throw する
		// callback.tsx 側で処理するため、ここでは自動フォールバックしない
		if (error) {
			const errorObj = new Error(error_description ?? error_code ?? error) as any;
			errorObj.error_code = error_code;
			errorObj.intent = intent;
			errorObj.provider = provider;
			throw errorObj;
		}

		// 1) PKCE (codeフロー)
		if (code) {
			const { data, error } = await supabase.auth.exchangeCodeForSession(code);
			if (error) throw error;
			return data.user;
		}

		// 2) 旧: インプリシット（#access_token）
		const hash = url.split("#")[1] ?? "";
		if (hash) {
			const params = new URLSearchParams(hash);
			const access_token = params.get("access_token");
			const refresh_token = params.get("refresh_token");
			const expires_at = params.get("expires_at");
			if (access_token && refresh_token) {
				await supabase.auth.setSession({ access_token, refresh_token });
				const {
					data: { user },
				} = await supabase.auth.getUser();
				return user ?? null;
			}
		}
		return null;
	};

	/**
	 * 現在のセッションをログアウトする。
	 */
	const logout = async (options?: SignOut) => {
		const { error } = await supabase.auth.signOut(options);
		if (error) throw error;
	};

	const value = useMemo<AuthContextType>(
		() => ({
			user,
			getSession,
			refreshSession,
			loading,
			isAuthResolved: !loading,
			authError,
			retryAuth,
			isRetryingAuth,
			loginWithEmail,
			signUpWithEmail,
			logout,
			signInWithOAuth,
			signInWithOtp,
			verifyOtp,
			linkIdentity,
			handleOAuthResultUrl,
		}),
		[
			user,
			getSession,
			refreshSession,
			loading,
			authError,
			retryAuth,
			isRetryingAuth,
			loginWithEmail,
			signUpWithEmail,
			logout,
			signInWithOAuth,
			signInWithOtp,
			verifyOtp,
			linkIdentity,
			handleOAuthResultUrl,
		],
	);

	return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

/**
 * 🎣 `AuthContext` から認証状態と関数を取得するカスタムフック。
 * - `AuthProvider` 内でのみ使用可能。
 * - 使用場所が誤っている場合は例外を投げる。
 */
export const useAuth = (): AuthContextType => {
	const context = useContext(AuthContext);
	if (context === undefined) {
		throw new Error("useAuth must be used within an AuthProvider");
	}
	return context;
};

/* ヘルパー関数群 */

/** OAuthのリダイレクトURIを構築する
 * - WebではアプリのURLに対応するURIを生成
 * - ネイティブではカスタムスキームURIを生成
 */
export const buildRedirectTo = (locale?: string) => {
	// 画面を使わないので、ネイティブは固定でOK（ロケールなし推奨）
	if (Platform.OS === "web") return `${window.location.origin}/${locale}/auth/callback`; // Webは任意
	return AuthSession.makeRedirectUri({ scheme: "nanitabeyo", path: "auth/callback" });
};
