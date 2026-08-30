import { createContext, useContext, useEffect, useState, ReactNode, useRef, useCallback, useMemo } from "react";
import { supabase, consumeAuthRetryAfterHeader } from "@/lib/supabase";
import { readOAuthResultQuery } from "@/lib/oauthResultUrl";
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
import { useDishCategoriesStore } from "@/stores/useDishCategoriesStore";
import { useProfileStore } from "@/features/profile/stores/useProfileStore";
import { useCdnCookieStore } from "@/stores/useCdnCookieStore";
import { requestLogoutRedirect } from "@/lib/logoutRedirect";

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

/**
 * #1062 【設計】OAuth 用ブラウザセッションの結末。
 * - `cancelled` はユーザーがブラウザを閉じた等で結果 URL を受け取れなかったことを表す。
 *   セッションは一切変化していないため、呼び出し側は成功として扱ってはいけない。
 */
export type OAuthLaunchOutcome =
	/** Web: この後ブラウザ側の全画面リダイレクトが起きる */
	| { outcome: "redirecting" }
	/** ネイティブ: ブラウザが結果 URL を返し、callback 画面へ引き継いだ */
	| { outcome: "returned" }
	/** ネイティブ: cancel / dismiss / locked。セッションは変化していない */
	| { outcome: "cancelled"; browserResultType: string };

/**
 * #1062 【設計】コールバック URL の処理結果。
 * 従来は「セッションが確立できなかった」ことを `null` で表していたため、
 * 呼び出し側が戻り値を検査せず成功ログを出してしまっていた。判別可能ユニオンで明示する。
 */
export type OAuthCallbackResult =
	| { status: "authenticated"; user: User; via: "pkce" | "implicit" }
	| { status: "no_result" };

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
	/**
	 * #1194 認証初期化の決着を «待つ»。既に決着していれば即座に解決する。
	 *
	 * `isAuthResolved` は render 時点のスナップショットなので、
	 * 「コールバックの中で、いま決着しているか」を知りたい経路では使えない。
	 * ディープリンクでの起動直後がまさにそれで、画面のマウントと認証初期化が競合する。
	 *
	 * @param timeoutMs 待つ上限。超えたら false（＝決着しなかった）
	 * @returns 決着したか
	 */
	waitForAuthResolved: (timeoutMs?: number) => Promise<boolean>;
	/** #1089 認証初期化が最終的に失敗している間だけ非 null。成功すると null に戻る */
	authError: AuthFailure | null;
	/** #1089 認証初期化をやり直す。429 のクールダウン中は、その時間を待ってから実行される */
	retryAuth: () => void;
	/** #1089 `retryAuth()` の実行中（クールダウンの待機時間を含む） */
	isRetryingAuth: boolean;
	loginWithEmail: (email: string, password: string) => Promise<void>;
	logout: (options?: SignOut) => Promise<void>;
	signUpWithEmail: (email: string, password: string) => Promise<void>;
	/** #1370 `options.next` はログイン後の行き先。`lib/authNext.ts` の `resolveNextPath` を通した内部パスのみ渡すこと */
	signInWithOAuth: (
		provider: Provider,
		options?: { queryParams?: { [key: string]: string }; next?: string },
	) => Promise<OAuthLaunchOutcome>;
	signInWithOtp: (phone: string) => Promise<void>;
	verifyOtp: (phone: string, token: string) => Promise<void>;
	/** #1370 `options.next` はログイン後の行き先。`lib/authNext.ts` の `resolveNextPath` を通した内部パスのみ渡すこと */
	linkIdentity: (
		provider: Provider,
		options?: { queryParams?: { [key: string]: string }; next?: string },
	) => Promise<OAuthLaunchOutcome>;
	handleOAuthResultUrl: (url?: string | null) => Promise<OAuthCallbackResult>;
};

/**
 * #1194 認証初期化の決着を待つ上限（ms）。
 *
 * 匿名サインインは通常 1 秒以内に決着する。ここを長くしすぎると、認証が本当に壊れているときに
 * 「操作しても何も起きない」時間が伸びるだけなので、`API_CALL_TIMEOUT_MS`(30s) より十分短くする。
 */
const AUTH_RESOLVE_WAIT_MS = 8_000;

/**
 * #1370 【設計】OAuth の `redirectTo` に載せる callback のパス（クエリ込み）を組む。
 *
 * `next`（ログイン後の行き先）を **URL に載せる** のは、web の OAuth が全画面リダイレクトで
 * ページごと作り直され、履歴にも JS の state にも「どこから来たか」が残らないためである。
 * native は同一セッションなので履歴で戻れるが、経路ごとに引き継ぎ方を変えると callback 側の
 * 読み取りが 2 通りになるので、web / native で同じ形に揃える。
 *
 * 🔒 ここでは検証しない。渡してよいのは呼び出し側で `lib/authNext.ts` の `resolveNextPath` を
 * 通した «先頭 / の内部パス» だけであり、受け取る `app/[locale]/auth/callback.tsx` でも同じ検証を
 * 通してから遷移する（URL は外から書き換えられるため、最終的な砦は受け取り側にある）。
 * この関数は運ぶだけで、Supabase 呼び出しの意味は変えない。
 *
 * #1374 【バグ】ここで «クエリを文字列に組み立てない» こと。
 *
 * 以前は `?intent=signin&next=${encodeURIComponent(next)}` まで含めた 1 本の文字列を作り、
 * それを `makeRedirectUri({ path })` に渡していた。`makeRedirectUri` は中で
 * `Linking.createURL(path, …)` を呼び、`createURL` は **path 部分だけに `encodeURI()` を掛ける**
 *（expo-linking の build/createURL.js:113）。そのため `%2F` が `%252F` へ二重エンコードされる。
 *
 * 二重になると、デコード回数が経路によって食い違う。
 *   経路A: WebBrowser.openAuthSessionAsync 成功 → Linking.parse → searchParams + decodeURIComponent の 2 回
 *          → たまたま元に戻り、動く
 *   経路B: OS のディープリンクで callback へ直接着地（アプリがコールドスタートし
 *          Linking.getInitialURL() から拾う経路）→ expo-router は searchParams の 1 回だけ
 *          → `"%2Fja-JP%2F…"` のままで先頭が `/` にならず、resolveNextPath が null を返して
 *            next が黙って捨てられる
 *
 * `createURL` は `queryParams` を **`encodeURI` の後に** `URLSearchParams` で 1 回だけ
 * エンコードして連結する（同ファイル :113-114）。だからクエリは «構造のまま» 渡す。
 *
 * @param params `{ intent: "signin" }` のような、この経路を識別する既存のクエリ
 */
const buildAuthCallbackPath = (locale: string): string => `${locale}/auth/callback`;

const buildAuthCallbackQueryParams = (
	params: Record<string, string>,
	next?: string,
): Record<string, string> => (next ? { ...params, next } : { ...params });

/** web の redirectTo。`encodeURI` を通らないので、ここは自分で 1 回だけエンコードする */
const buildWebAuthCallbackUrl = (locale: string, params: Record<string, string>): string =>
	`${window.location.origin}/${buildAuthCallbackPath(locale)}?${new URLSearchParams(params).toString()}`;

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

	/**
	 * #1194 認証初期化の決着を待てるようにする deferred。
	 *
	 * ## なぜ要るのか（実機で踏んだ）
	 * LINE から投票の共有リンクを開くと、**時々だけ**「結果を取得できませんでした」になり、
	 * 再試行すると成功する、という報告があった。原因は起動直後の競合で、
	 * 画面が `callBackend` を呼んだ時点ではまだ匿名セッションが載っていない。
	 * `useAPICall` はトークンが無いと **待たずに即 throw** するため、
	 * 「あと数百ミリ秒待てば成功する」ケースまで失敗にしていた。
	 *
	 * ⚠️ `isAuthResolved`（= `!loading`）では代用できない。あれは render 時点の値で、
	 * コールバックのクロージャに焼き付いてしまう。「いま決着したか」を待つには
	 * state ではなく **promise** が要る。
	 */
	const loadingRef = useRef(true);
	const authResolvedDeferredRef = useRef<{ promise: Promise<void>; resolve: () => void } | null>(null);
	if (authResolvedDeferredRef.current === null) {
		let resolveDeferred!: () => void;
		const promise = new Promise<void>((resolve) => {
			resolveDeferred = resolve;
		});
		authResolvedDeferredRef.current = { promise, resolve: resolveDeferred };
	}

	useEffect(() => {
		loadingRef.current = loading;
		// Promise は一度しか解決しないが、resolve の再呼び出しは無害（2 回目以降は無視される）
		if (!loading) authResolvedDeferredRef.current?.resolve();
	}, [loading]);

	const waitForAuthResolved = useCallback(async (timeoutMs = AUTH_RESOLVE_WAIT_MS): Promise<boolean> => {
		if (!loadingRef.current) return true;

		let timer: ReturnType<typeof setTimeout> | undefined;
		const timedOut = new Promise<false>((resolve) => {
			timer = setTimeout(() => resolve(false), timeoutMs);
		});
		try {
			// ⚠️ 上限を必ず付けること。認証初期化が失敗したまま loading が下りない実装に
			// なった場合、上限が無いと **全 API 呼び出しが永久に待つ**
			return await Promise.race([authResolvedDeferredRef.current!.promise.then(() => true as const), timedOut]);
		} finally {
			if (timer) clearTimeout(timer);
		}
	}, []);

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
	 * SIGNED_OUT 後の匿名サインインを「onAuthStateChange のコールバックを抜けてから」実行するためのタイマー。
	 * 詳細は SIGNED_OUT ハンドラのコメントを参照。unmount 時の解除にも使う。
	 */
	const signedOutReauthTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	/** SIGNED_OUT 後の root 遷移。匿名セッションの再確立を開始してから実行する。 */
	const signedOutNavigationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	/**
	 * #1135 「今アプリに載っているセッションの世代」。`onAuthStateChange` が新しいセッションを
	 * 載せるたびに 1 つ進む。認証初期化（runAuthAttempt）は await をまたぐ前にこの値を控え、
	 * 書き戻す直前に変わっていないことを確認する。
	 *
	 * なぜ必要か:
	 * GoTrueClient._acquireLock はロック保持中に来た呼び出しを pendingInLock へ積み、
	 * **外側の保持者はそれを drain し終わるまで解決しない**（@supabase/auth-js GoTrueClient.js:1123-1129）。
	 * そのため Web の OAuth コールバックでは、`getSession()` が «交換前» の匿名セッションを読んだまま、
	 * `exchangeCodeForSession()` が終わった «後» に解決する。その戻り値を無条件に書き戻すと、
	 * 確立済みの OAuth セッションを匿名ユーザーへ巻き戻してしまう
	 * （＝ localStorage は OAuth なのに画面はゲストのまま。「1 回目のログインで入れない」）。
	 *
	 * ⚠️ SIGNED_OUT では進めない。SIGNED_OUT 経路は「新しいセッションを載せる」のではなく
	 *    «セッションを消して runAuthAttempt を予約し直す» 経路であり（#1124）、そこで世代を進めると
	 *    予約された再認証が自分の書き戻しを取りこぼす方向へ効きうる。
	 */
	const sessionGenerationRef = useRef(0);
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
			// #1135 sessionRef を直接書く経路なので、ここでも世代を進める。
			// （refreshSession() は TOKEN_REFRESHED も発火させるため二重に進みうるが、
			//   判定は「変化したか」だけなので問題にならない）
			sessionGenerationRef.current += 1;
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
	const runAuthAttempt = useCallback(
		async ({ force = false }: { force?: boolean } = {}) => {
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

			// #1135 これ以降の await をまたいで「その間に新しいセッションが載ったか」を判定するための基準。
			// 必ず最初の await より前で控えること（injectTestSession / getSession の最中こそが競合ウィンドウ）。
			const generation = sessionGenerationRef.current;
			/** #1135 この試行を始めてから、別経路（OAuth の code 交換など）が新しいセッションを載せたか */
			const hasNewerSession = () => sessionGenerationRef.current !== generation;

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
					// #1135 【バグ】以前はここで `supabase.auth.setSession({ access_token, refresh_token })` を
					// await していたが、これは冗長なうえに有害だった。
					// - 冗長: `getSession()` が既に storage からの復元（必要ならリフレッシュ）まで済ませている。
					// - 有害: `_setSession` は `GET /auth/v1/user` を 1 往復叩いてから `_saveSession` +
					//   `_notifyAllSubscribers('SIGNED_IN')` する（GoTrueClient.js:1344-1390）。
					//   その往復時間がまるごと競合ウィンドウになり、Web の OAuth コールバックでは
					//   `exchangeCodeForSession()` がそこへ着地して、下の書き戻しが必ず後勝ちしていた。
					//   さらに `_saveSession` により **storage 上の OAuth セッションまで匿名で上書き** されうる。
					// `sessionRestored` ログ・`sessionRef` 更新・`setUser` は下にそのまま残している。
					if (hasNewerSession()) {
						// #1135 読み取りの最中に別経路が新しいセッションを載せた（Web の OAuth code 交換など）。
						// 古い読み取り結果で巻き戻さない。state は onAuthStateChange 側で既に更新済みなので、
						// 「認証が確立している」という事後条件はここで何もしなくても満たされる。
						logFrontendEvent({
							event_name: "sessionRestoreSuperseded",
							error_level: "log",
							payload: { stale_user_id: restoredSession.user.id, current_user_id: sessionRef.current?.user.id },
						});
					} else {
						logFrontendEvent({
							event_name: "sessionRestored",
							error_level: "log",
							payload: { user_id: restoredSession.user.id },
						});

						sessionRef.current = restoredSession;
						setUser(restoredSession.user);
					}
				} else if (hasNewerSession()) {
					// #1135 セッションが無いと «読んだ» 後に、別経路が新しいセッションを載せた場合。
					// ここで匿名サインインを叩くと `_saveSession` が storage 上の OAuth セッションを
					// 完全に潰す（React state だけの巻き戻しより重い破壊になる）ため、絶対に叩かない。
					// 事後条件は onAuthStateChange 側の setUser で満たされている。
					logFrontendEvent({
						event_name: "anonymousSignInSuperseded",
						error_level: "log",
						payload: { current_user_id: sessionRef.current?.user.id },
					});
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

					// #1135 匿名サインインの await をまたぐ区間も、別経路が載せたセッションを巻き戻さない。
					// `getSession()` が «code 交換が始まる前» に「セッション無し」で解決すると、上の
					// hasNewerSession() 分岐は素通りする。その後この await の最中に
					//   1. 匿名サインインが `_saveSession` → SIGNED_IN(匿名)
					//   2. pendingInLock の `exchangeCodeForSession()` が完了 → SIGNED_IN(OAuth)
					// の順で流れると、無条件の書き戻しは確立済みの OAuth セッションを匿名へ巻き戻す
					// （storage は OAuth のまま = 本 Issue と同型の症状）。
					//
					// ⚠️ ここを世代カウンタ（hasNewerSession）で守ることはできない。1 の SIGNED_IN でも
					//    世代は進むため、「自分が作った匿名セッション」と「別経路のセッション」を区別できず、
					//    競合が無い正常な匿名サインインまで書き戻しをスキップして user=null で固着する。
					//    そこで «今 sessionRef に載っているのが自分以外のセッションか» を同一性で判定する。
					const currentSession = sessionRef.current;
					if (currentSession && currentSession.access_token !== anonSession.access_token) {
						// 別経路が先にセッションを確立していた。state は onAuthStateChange 側で更新済みなので、
						// 「認証が確立している」という事後条件はここで何もしなくても満たされる。
						// （作ってしまった匿名ユーザーは storage 上も既に上書きされている＝ auth-js の管理下。
						//   ここで消しに行くと確立済みセッションを触ることになるため、記録だけに留める）
						logFrontendEvent({
							event_name: "anonymousSignInDiscarded",
							error_level: "log",
							payload: { stale_user_id: anonSession.user.id, current_user_id: currentSession.user.id },
						});
					} else {
						sessionRef.current = anonSession;
						setUser(anonSession.user);
					}
				}

				nextAttemptAllowedAtRef.current = 0;
				setAuthError(null);
			} catch (err: any) {
				const status = getAuthErrorStatus(err);
				// #1475 【設計】status 0 = **HTTP 応答に到達していない**（端末の回線断）。
				// supabase-js が fetch 失敗を AuthRetryableFetchError でラップするときの値で、
				// 運用側にできることは無い。再試行ボタンとフォアグラウンド復帰の 2 経路で回復する。
				//
				// 実測（本番 2026-08-20T09:29:25Z / 1 ユーザー）: 直前に位置情報の
				// backend 失敗 → expo フォールバック失敗 が warn で並んでおり、回線が一瞬切れていた。
				// **2 秒後には検索の API が成功しており**、認証エラー画面は出ていない。設計どおり回復した例。
				//
				// ⚠️ status 0 だけに限ること。undefined まで含めると、初期化中に起きた
				// こちら側の実装バグ（status を持たない TypeError 等）まで warn へ落ちて見えなくなる。
				const isClientNetworkFailure = status === 0;
				logFrontendEvent({
					event_name: "authInitError",
					error_level: isClientNetworkFailure ? "warn" : "error",
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
		},
		[logFrontendEvent],
	);

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
				useDishCategoriesStore.getState().clearByKey();
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
				// #1135 新しいセッションを載せた。実行中の認証初期化が、これより前に読んだ古いセッションで
				// 巻き戻すのを防ぐ（runAuthAttempt の hasNewerSession() が見る）。
				sessionGenerationRef.current += 1;
				// router.replace('/');
			} else if (event === "SIGNED_OUT") {
				sessionRef.current = null;
				setUser(null);

				// ⚠️⚠️ このコールバックの中で supabase.auth.* を **await してはいけない**（#1124）。
				//
				// GoTrueClient.signOut() は _acquireLock でロックを取ったまま
				// _removeSession() → `await _notifyAllSubscribers('SIGNED_OUT')` を実行する
				// （@supabase/auth-js GoTrueClient.js:1549, :2052）。つまり **ロック保持中に
				// このコールバックの完了を待っている**。
				// ここで runAuthAttempt() を await すると、その中の supabase.auth.getSession() が
				// _acquireLock の再入分岐（同 :1092）へ入り、pendingInLock の末尾 = 外側の _signOut の
				// 完了を待つ。結果として
				//   _signOut 完了待ち → コールバック完了待ち → _signOut 完了待ち
				// の循環待ちになり、**永久にデッドロックする**。
				// ロックは解放されないままなので、以降の supabase.auth.* が全て停止し、
				// セッションが再確立できず API 呼び出しが全滅する（Web では未解決 Promise が
				// 積み上がって画面が固まる）。
				//
				// そのため、コールバックからは **await せずに** 実行する。
				// 正しさの本体は「signOut がこのコールバックの完了を待たなくなること」であって、
				// タイマーで遅らせること自体ではない（発火時点でロックがまだ保持されていても、
				// 再入分岐で直列化されるだけで循環は生じない）。setTimeout を使うのは、
				// 予約の解除（連続 SIGNED_OUT の集約・unmount 時の停止）を扱いやすくするため。
				// #1089 の意図（匿名サインインを runAuthAttempt に寄せ、失敗時は authError と
				// 再試行 UI へ倒す）と #1097 の意図（force を渡さず 429 クールダウンを尊重する）は
				// そのまま維持している。
				if (signedOutReauthTimerRef.current) clearTimeout(signedOutReauthTimerRef.current);
				signedOutReauthTimerRef.current = setTimeout(() => {
					signedOutReauthTimerRef.current = null;
					void runAuthAttempt();
				}, 0);

				// #1124 遷移は匿名サインインの成否に依存させない。
				// 従来は finally に置かれていたため、上記デッドロックで到達せず
				// 「ログアウトしても画面が変わらない」状態になっていた。
				//
				const navigateHome = () => {
					// Android で実機確認済みの文字列 `"/"` を維持する。URL の query や object href も
					// フリーズしたため、ログアウト由来と現在のロケールは共有モジュールで index 側へ渡す。
					requestLogoutRedirect(locale);
					router.replace("/");
				};

				// Web と iOS は callback の外で再認証を開始してから遷移するとフリーズするため、ここで
				// 同期的に遷移する。AuthProvider の再マウント時に起動時の runAuthAttempt が匿名セッションを復元する。
				// Android だけは root への replace が再認証タイマーを取り消し得るため、下で遅延させる。
				if (Platform.OS !== "android") {
					navigateHome();
				} else {
					// native の root への replace は AuthProvider を unmount し、上のタイマーを cleanup で
					// 取り消し得る。そのため、再認証を開始するタイマーより後に遷移を予約する。
					if (signedOutNavigationTimerRef.current) clearTimeout(signedOutNavigationTimerRef.current);
					signedOutNavigationTimerRef.current = setTimeout(() => {
						signedOutNavigationTimerRef.current = null;
						navigateHome();
					}, 0);
				}
			} else if (event === "PASSWORD_RECOVERY") {
				// パスワード制のログイン機能を持たせる予定がないなら不要
			} else if (event === "TOKEN_REFRESHED") {
				if (!session) return;
				setUser(session.user);
				sessionRef.current = session;
				// #1135 SIGNED_IN と同じ理由で世代を進める（リフレッシュ済みトークンを古い値で潰さない）
				sessionGenerationRef.current += 1;
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
			// #1124 SIGNED_OUT 後の匿名サインインも同様に解除する
			if (signedOutReauthTimerRef.current) {
				clearTimeout(signedOutReauthTimerRef.current);
				signedOutReauthTimerRef.current = null;
			}
			if (signedOutNavigationTimerRef.current) {
				clearTimeout(signedOutNavigationTimerRef.current);
				signedOutNavigationTimerRef.current = null;
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
	 * @param options.next - ログイン後の行き先。`resolveNextPath` を通した内部パスのみ（#1370）
	 */
	const signInWithOAuth = async (
		provider: Provider,
		options?: { queryParams?: { [key: string]: string }; next?: string },
	): Promise<OAuthLaunchOutcome> => {
		const { queryParams = {}, next } = options || {};

		// Google のときはデフォルトで毎回アカウント選択を出す
		const defaultQueryParamsForProvider: Record<Provider, { [k: string]: string }> = {
			google: { prompt: "select_account" },
			// 他のプロバイダ用に何かあればここに書く
		} as any;

		const mergedQueryParams = {
			...(defaultQueryParamsForProvider[provider] ?? {}),
			...queryParams, // 呼び出し側で上書きしたければこちらが優先
		};

		const callbackQueryParams = buildAuthCallbackQueryParams({ intent: "signin" }, next);
		const redirectTo =
			Platform.OS === "web"
				? buildWebAuthCallbackUrl(locale, callbackQueryParams)
				: AuthSession.makeRedirectUri({
						scheme: "nanitabeyo",
						path: buildAuthCallbackPath(locale),
						queryParams: callbackQueryParams,
					});
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
			return openOAuthBrowserSession(data.url, redirectTo);
		}
		// Web はこの後ブラウザ側でリダイレクトされる
		return { outcome: "redirecting" };
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
	 * @param options.next - ログイン後の行き先。`resolveNextPath` を通した内部パスのみ（#1370）
	 */
	const linkIdentity = async (
		provider: Provider,
		options?: { queryParams?: { [key: string]: string }; next?: string },
	): Promise<OAuthLaunchOutcome> => {
		const { queryParams = {}, next } = options || {};

		// Google のときはデフォルトで毎回アカウント選択を出す
		const defaultQueryParamsForProvider: Record<Provider, { [k: string]: string }> = {
			google: { prompt: "select_account" },
			// 他のプロバイダ用に何かあればここに書く
		} as any;

		const mergedQueryParams = {
			...(defaultQueryParamsForProvider[provider] ?? {}),
			...queryParams, // 呼び出し側で上書きしたければこちらが優先
		};

		// linkIdentity の場合は、 匿名アップグレード由来のリダイレクトであることを示すために `?intent=link` を付与
		const callbackQueryParams = buildAuthCallbackQueryParams({ intent: "link", provider }, next);
		const redirectTo =
			Platform.OS === "web"
				? buildWebAuthCallbackUrl(locale, callbackQueryParams)
				: AuthSession.makeRedirectUri({
						scheme: "nanitabeyo",
						path: buildAuthCallbackPath(locale),
						queryParams: callbackQueryParams,
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
			return openOAuthBrowserSession(data.url, redirectTo);
		}
		// Web はこの後ブラウザ側でリダイレクトされる
		return { outcome: "redirecting" };
	};

	/**
	 * ネイティブで OAuth 用のブラウザセッションを開き、戻ってきた URL を callback 画面へ引き渡す。
	 *
	 * #1062 【設計】`result.type` が success 以外（ユーザーがブラウザを閉じた等）のときは
	 * セッションが一切変化していないため、`cancelled` として呼び出し側へ返す。
	 * 従来は戻り値を返しておらず、キャンセルでも `oauth_signin_success` が記録されていた。
	 */
	const openOAuthBrowserSession = async (authUrl: string, redirectTo: string): Promise<OAuthLaunchOutcome> => {
		const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectTo);
		if (result.type !== "success" || !result.url) {
			return { outcome: "cancelled", browserResultType: result.type };
		}

		const parsed = Linking.parse(result.url);
		const parsedLocale = (parsed.hostname ?? "ja-JP") as string;
		// #1374 クエリは «デコード 1 回» で読む（lib/oauthResultUrl.ts の JSDoc 参照）。
		// Linking.parse の queryParams は 2 回デコードなので、redirectTo を 1 回エンコードへ直した
		// 今は過剰になる。読めなかったときだけ従来の経路へ倒す
		const qp =
			readOAuthResultQuery(result.url) ??
			Object.fromEntries(Object.entries(parsed.queryParams ?? {}).map(([k, v]) => [k, String(v)]));
		const href: Href = {
			pathname: "/[locale]/auth/callback",
			params: { locale: parsedLocale, ...qp },
		};
		router.replace(href);
		return { outcome: "returned" };
	};

	/** OAuthのリダイレクトURIから認証結果を処理する
	 * - PKCE (codeフロー) と 旧インプリシット (#access_token) の両方に対応
	 * - #1062 【設計】セッションを確立できなかった場合は `no_result` を返す。
	 *   従来は黙って `null` を返しており、呼び出し側が失敗に気付けなかった。
	 */
	const handleOAuthResultUrl = async (url?: string | null): Promise<OAuthCallbackResult> => {
		if (!url) return { status: "no_result" };

		const parsed = Linking.parse(url);
		// #1374 同上。ここが 2 回デコードのままだと、next に裸の `%` が入っただけで
		// URIError が起き、Linking.parse の catch がそれを飲んで **code まで消える**
		const queryParams =
			readOAuthResultQuery(url) ??
			(parsed.queryParams as Record<string, string | undefined> | undefined) ??
			{};
		const code = queryParams.code as string | undefined;
		const intent = queryParams.intent as string | undefined;
		const provider = queryParams.provider as Provider | undefined;
		const error = queryParams.error as string | undefined;
		const error_code = queryParams.error_code as string | undefined;
		const error_description = queryParams.error_description as string | undefined;

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
		// #1062 【設計】交換結果の user をそのまま返す。以前は getUser() で現行セッションを
		// 取り直していたため、交換が行われなかった場合に「匿名ユーザー」が成功として記録されていた。
		if (code) {
			const { data, error } = await supabase.auth.exchangeCodeForSession(code);
			if (error) throw error;
			if (!data.user) return { status: "no_result" };
			return { status: "authenticated", user: data.user, via: "pkce" };
		}

		// 2) 旧: インプリシット（#access_token）
		const hash = url.split("#")[1] ?? "";
		if (hash) {
			const params = new URLSearchParams(hash);
			const access_token = params.get("access_token");
			const refresh_token = params.get("refresh_token");
			if (access_token && refresh_token) {
				const { data, error } = await supabase.auth.setSession({ access_token, refresh_token });
				if (error) throw error;
				if (!data.user) return { status: "no_result" };
				return { status: "authenticated", user: data.user, via: "implicit" };
			}
		}
		return { status: "no_result" };
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
			waitForAuthResolved,
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
			waitForAuthResolved,
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
