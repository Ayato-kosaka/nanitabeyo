import { Platform } from "react-native";
import { LaunchArguments } from "react-native-launch-arguments";

import { Env } from "@/constants/Env";
import { supabase } from "@/lib/supabase";

/**
 * 🧪 E2E(Detox) 専用: 起動引数(launchArgs)で渡されたセッションをアプリへ注入する。
 *
 * ## なぜ必要か（#1030）
 * - ログイン UI は Google/Apple OAuth のみで、Detox から外部 IdP を自動操作できない
 * - Supabase の匿名サインインは 30 回/時/IP のレート制限があり、dev/prod で同一プロジェクトを共有している。
 *   テストごとにアプリデータを消すと毎回 signInAnonymously() が走って上限に達してしまう
 * → そこで「Node 側(テストランナー)で 1 回だけ取得したセッションを起動引数で渡し、アプリ側は setSession するだけ」にする。
 *   e2e-web が storageState を注入しているのと同じ思想（e2e-web/tests/setup/auth.setup.ts 参照）。
 * → パスワードは端末へ渡らない（Node プロセス内に閉じる）。端末に届くのはトークンのみ。
 *
 * ## 注入条件（#1030 レビュー B-1）
 * 「セッションが無いときだけ注入する」ではなく **「期待ユーザー(e2eExpectedUserId / e2eSessionOwner)と現在のセッションが一致するか」**
 * で判定する。`device.launchApp({ newInstance: true })` は AsyncStorage を消さないため、
 * 「セッションの有無」で判定すると直前の匿名セッションが残ったまま認証済みテストが**サイレントに匿名ユーザーで走る**。
 * 一致していれば何もしない（= 同一セッションの二重注入による refresh token ローテーション衝突を避ける）、
 * 不一致なら注入する、**不一致なのに注入もできない場合は例外を投げる（fail-loud）**。
 *
 * ## 反復ポリシー（#1131）
 * 上記の判定は「呼ばれるたび」に行われる（既定 = `e2eSessionInjection: "always"`）。
 * ログアウトを検証する spec だけは `"once"` を渡し、**プロセス内で 1 回成立したら以降は素通り**させる。
 * そうしないと SIGNED_OUT → `runAuthAttempt()` → 本関数、の順でログイン済みセッションが注入し直され、
 * ログアウトそのものを検証できない（詳細は `E2ESessionInjectionPolicy`）。
 *
 * ## 副作用
 * - 成功時は supabase-js が AsyncStorage(`sb-<projectRef>-auth-token`) にセッションを保存し `SIGNED_IN` を発火する
 *   → AuthProvider の onAuthStateChange がストアクリアまで面倒を見るため、呼び出し側での追加処理は不要
 * - 呼び出し側（AuthProvider）は本関数の戻り値で分岐せず、**既存の initializeAuth のフローへそのまま合流する**（レビュー M-5）。
 *   これにより「テスト時だけ違う初期化経路を通る」ことが無くなり、`sessionRestored` ログ・`sessionRef` 更新も本番と同一経路になる。
 *
 * ## 本番混入防止（3 層 + 未確認 1 層。レビュー m-3）
 * 1. metro.config.js の resolveRequest が、EXPO_PUBLIC_E2E_AUTH_HOOK=1 でビルドしない限り
 *    このファイルを injectTestSession.noop.ts へ差し替える（= 本番バンドルにこのコードは 1 行も含まれない）
 * 2. 本ファイル冒頭の `process.env.EXPO_PUBLIC_E2E_AUTH_HOOK !== "1"` 二重ガード（Metro がビルド時にインライン化）
 * 3. 起動引数が無ければ何もしない（通常起動と完全に同一挙動）
 * 4. （未確認）`Env.NODE_ENV === "production"` ガード。EAS production の実値が未確認のため fail-open の可能性があり、
 *    層としては数えない（レビュー m-3）
 * さらに CI ゲート（scripts/assert-no-e2e-hook.mjs）が web/native 双方のバンドルに sentinel が無いことを検査する。
 */

// #1030 【セキュリティ】本番バンドルへの混入を CI で機械検知するための番号札（このファイル固有の文字列であること）。
// noop 実装側にはこの文字列を置かない。scripts/assert-no-e2e-hook.mjs がこの文字列を検査する。
export const E2E_TEST_SESSION_SENTINEL = "__E2E_TEST_SESSION_HOOK__";

/** 期待するセッションの持ち主。Detox 側（#1028）が launchArgs で宣言する */
export type E2ESessionOwner = "anon" | "authenticated";

/**
 * 注入をアプリのプロセス内で何回まで行うか（#1131）。
 *
 * - `always`（既定・従来の挙動） … 呼ばれるたびに「期待ユーザーと一致するか」で判定して注入する
 * - `once` … **プロセス内で 1 回成立したら、以降は何もしない**（= 通常起動と同じ経路へ合流する）
 *
 * ## なぜ `once` が要るのか（ログアウトの E2E）
 * `AuthProvider` の SIGNED_OUT ハンドラは `runAuthAttempt()` を呼び直し、その先頭がこの関数になる。
 * 既定の `always` では「現在セッション=無し ≠ 期待ユーザー」となって **ログアウトした直後に
 * ログイン済みセッションを注入し直してしまう**ため、ログアウトの検証が成立しない
 *（「ログアウトしたのにログイン済みへ戻る」テストになる）。
 *
 * `once` を渡した spec では、ログアウト後の 2 回目以降が素通りし、アプリは本番と同じ
 * `signInAnonymously()` の経路へ進む。**その匿名サインインの成立こそが #1124 の検証対象**なので、
 * ここを潰してはいけない（= 30 回/時/IP の枠を 1 消費することは織り込み済み）。
 *
 * ⚠️ 既定を `once` にしてはいけない。トークンリフレッシュの失効などで SIGNED_OUT が来た他の spec が、
 * 意図せず匿名ユーザーへ落ちたまま緑になる（= B-1 が防いでいる「サイレントに誤ったユーザーで走る」）。
 */
export type E2ESessionInjectionPolicy = "always" | "once";

/**
 * 注入処理の結果。
 * - `skipped`: E2E ビルドでない / 期待値も資格情報も渡されていない（= 通常起動）
 * - `already-matched`: 現在のセッションが既に期待ユーザーと一致していたため何もしなかった
 * - `injected`: launchArgs のセッションを注入した
 */
export type InjectTestSessionResult = "skipped" | "already-matched" | "injected";

/**
 * Detox の launchArgs から受け取るテスト専用パラメータ。
 * #1030 【設計】値は文字列のみ（数値・真偽値の型変換挙動にプラットフォーム差があるため踏まない）。
 * JWT / refresh token は base64url 文字集合なのでエンコード不要。
 */
type E2ELaunchArgs = {
	/** 期待するセッションの持ち主（"anon" | "authenticated"） */
	e2eSessionOwner?: string;
	/** 期待する auth.users.id。現在セッションとの一致判定に使う（レビュー B-1） */
	e2eExpectedUserId?: string;
	/** テストランナーが発行した access_token(JWT)。寿命は既定 1 時間 */
	e2eAccessToken?: string;
	/** 同 refresh_token */
	e2eRefreshToken?: string;
	/**
	 * 注入の反復ポリシー（"always" | "once"）。省略時は "always"（従来どおり）。
	 * #1131 ログアウトの spec だけが "once" を渡す（E2ESessionInjectionPolicy のコメント参照）。
	 */
	e2eSessionInjection?: string;
};

/**
 * このプロセスで既に注入が成立したか（#1131）。
 *
 * `device.launchApp({ newInstance: true })` はアプリのプロセスごと作り直すため、
 * モジュールスコープのこのフラグも起動のたびに false へ戻る（= spec 間で漏れない）。
 * `app/index.tsx` の `hasConsumedInitialUrl` と同じ寿命の持たせ方。
 */
let hasInjectedInThisProcess = false;

// #1030 【設計】instanceof はトランスパイル設定によって壊れうるため、マーカープロパティで判別する
const INJECTION_ERROR_FLAG = "__e2eTestSessionInjectionError";

/**
 * fail-loud 用のエラーを生成する。
 * #1030 【セキュリティ】メッセージにトークンを含めないこと（Detox の Artifact に残るため）。
 * user.id は AuthProvider が既にログへ出している情報なので含めてよい。
 */
const createInjectionError = (message: string): Error => {
	const error = new Error(`${E2E_TEST_SESSION_SENTINEL} ${message}`);
	(error as Error & Record<string, unknown>)[INJECTION_ERROR_FLAG] = true;
	// #1030 【設計】throw は AuthProvider 経由で unhandled rejection になるが、
	// ランナー側のログ（logcat / xcrun simctl）から原因を必ず追えるよう、ここでも 1 行だけ出しておく
	console.error(error.message);
	return error;
};

/**
 * #1030 【設計】E2E セッション注入の失敗だけは AuthProvider の catch で握り潰さずに再 throw するための判別関数。
 * 通常の認証初期化エラー（ネットワーク断等）は従来どおり握り潰して匿名フォールバックさせたいため、区別が必要。
 */
export const isTestSessionInjectionError = (error: unknown): boolean =>
	typeof error === "object" && error !== null && (error as Record<string, unknown>)[INJECTION_ERROR_FLAG] === true;

/**
 * launchArgs を読み取る。
 * #1030 【設計】E2E ビルドで launchArgs が読めない状態は「期待ユーザーの判定ができない」ことを意味し、
 * B-1 が防ごうとしている“サイレントに誤ったユーザーで走る”に直結する。よってここも fail-loud にする。
 * （react-native-launch-arguments が New Architecture で動かない場合、スパイクでここが真っ先に落ちて検知できる）
 */
const readLaunchArgs = (): E2ELaunchArgs => {
	try {
		return LaunchArguments.value<E2ELaunchArgs>() ?? {};
	} catch (error) {
		throw createInjectionError(
			`launchArgs の読み取りに失敗しました（react-native-launch-arguments が利用できない可能性）: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
};

/**
 * セッションの持ち主（匿名 / 認証済み）が期待どおりかを検証する。
 * #1030 【設計】user.id 一致だけでなく匿名フラグも突き合わせ、テスト側の宣言と実体のズレを早期に落とす。
 */
const assertSessionOwner = (owner: E2ESessionOwner, userId: string, isAnonymous: boolean | undefined) => {
	const actualOwner: E2ESessionOwner = isAnonymous === true ? "anon" : "authenticated";
	if (actualOwner !== owner) {
		throw createInjectionError(
			`期待した e2eSessionOwner="${owner}" に対し、実際のセッションは "${actualOwner}" でした（user_id=${userId}）。` +
				"テストランナー側で発行したセッションの種類を確認してください。",
		);
	}
};

/**
 * 起動引数のセッションを注入する。
 *
 * @returns 何もしなかった場合 `skipped` / 既に期待ユーザーだった場合 `already-matched` / 注入した場合 `injected`
 * @throws 期待ユーザーと一致せず注入もできない場合（fail-loud。レビュー B-1）
 */
export const injectTestSession = async (): Promise<InjectTestSessionResult> => {
	// #1030 【設計】(レビュー m-2) web には react-native-launch-arguments のネイティブ実装が無く、
	// `expo start --web` を EXPO_PUBLIC_E2E_AUTH_HOOK=1 のまま起動すると落ちうる。web では常に何もしない。
	// （metro.config.js も platform === "web" のときは noop 実装へ差し替えるが、こちらは実行時の二重ガード）
	if (Platform.OS === "web") return "skipped";
	// #1030 【セキュリティ】metro resolver の差し替え（第 1 層）を何らかの理由で通過した場合の二重ガード。
	// EXPO_PUBLIC_E2E_AUTH_HOOK は Metro がビルド時にインライン化するため、未設定ビルドでは undefined に畳まれる
	if (process.env.EXPO_PUBLIC_E2E_AUTH_HOOK !== "1") return "skipped";
	// #1030 【セキュリティ】EAS production 環境でビルドされた成果物では絶対に動かさない。
	// ⚠️ EXPO_PUBLIC_NODE_ENV が未設定だと undefined で素通りする（fail-open）ため、これは主ガードではない（レビュー m-3）
	if (Env.NODE_ENV === "production") return "skipped";

	const { e2eSessionOwner, e2eExpectedUserId, e2eAccessToken, e2eRefreshToken, e2eSessionInjection } = readLaunchArgs();

	// #1030 【設計】期待値も資格情報も渡されていない = 通常起動（アプリ本来の匿名サインインを検証する boot smoke 等）。
	// この経路では本フックは完全に無害で、通常ビルドと 1 バイトも挙動が変わらない（ガード第 3 層）
	if (!e2eSessionOwner && !e2eExpectedUserId && !e2eAccessToken && !e2eRefreshToken) return "skipped";

	// #1030 【設計】(レビュー B-1) 期待ユーザーが宣言されていなければ一致判定ができない。
	// 黙って注入すると「どのユーザーで走ったか分からないテスト」になるため、契約違反として即落とす
	if (!e2eExpectedUserId) {
		throw createInjectionError(
			"launchArgs に e2eExpectedUserId が指定されていません。" +
				"期待ユーザーとの一致判定ができないため注入を中止しました（e2eSessionOwner / e2eExpectedUserId / e2eAccessToken / e2eRefreshToken はセットで渡すこと）。",
		);
	}
	if (e2eSessionOwner !== "anon" && e2eSessionOwner !== "authenticated") {
		throw createInjectionError(
			`launchArgs の e2eSessionOwner が不正です（"anon" | "authenticated" のいずれかを渡すこと）: ${String(e2eSessionOwner)}`,
		);
	}
	// #1131 未指定は "always"（従来の挙動）。誤記を黙って "always" に丸めると
	// 「ログアウトの spec だけ緑なのに検証内容が嘘」になるため、不正値は fail-loud にする
	if (e2eSessionInjection !== undefined && e2eSessionInjection !== "always" && e2eSessionInjection !== "once") {
		throw createInjectionError(
			`launchArgs の e2eSessionInjection が不正です（"always" | "once" のいずれかを渡すこと）: ${String(e2eSessionInjection)}`,
		);
	}
	const injectionPolicy: E2ESessionInjectionPolicy = e2eSessionInjection === "once" ? "once" : "always";

	// #1131 【設計】`once` はログアウト後の再注入を止めるためだけの経路。
	// ここで «期待ユーザーとの一致判定より前に» 抜けるのが要点で、こうしないと
	// 「セッション無し ≠ 期待ユーザー」で必ず注入されてしまう（= ログアウトを検証できない）。
	// 以降はアプリ本来の匿名サインインへ合流する（tests/authenticated/logout.test.ts）。
	if (injectionPolicy === "once" && hasInjectedInThisProcess) return "skipped";

	const { data: currentData, error: currentError } = await supabase.auth.getSession();
	if (currentError) {
		throw createInjectionError(`現在のセッション取得に失敗しました: ${currentError.message}`);
	}
	const currentUser = currentData.session?.user ?? null;

	// #1030 【設計】(レビュー B-1) 既に期待ユーザーなら再注入しない。
	// アプリ側が自分でローテーション済みの refresh token を、古いトークンで上書きしてしまう事故
	//（reuse 検知によるセッションファミリ失効）を防ぐため
	if (currentUser && currentUser.id === e2eExpectedUserId) {
		assertSessionOwner(e2eSessionOwner, currentUser.id, currentUser.is_anonymous);
		// #1131 「既に期待ユーザーだった」も注入が成立した状態に含める。`newInstance: true` は
		// AsyncStorage を消さないため、2 回目以降の起動はこちらの分岐で期待ユーザーになる
		hasInjectedInThisProcess = true;
		return "already-matched";
	}

	// #1030 【設計】(レビュー B-1) 期待ユーザーと不一致なのに注入材料が無い = テストが誤ったユーザーで走る状態。
	// ここで黙って通常起動へフォールバックすると「テストは緑なのに検証内容が嘘」になるため fail-loud にする
	if (!e2eAccessToken || !e2eRefreshToken) {
		throw createInjectionError(
			`現在のセッション(user_id=${currentUser?.id ?? "none"})が期待ユーザー(user_id=${e2eExpectedUserId})と一致せず、` +
				"注入用トークン(e2eAccessToken / e2eRefreshToken)も渡されていないため、セッションを切り替えられません。",
		);
	}

	const { data, error } = await supabase.auth.setSession({
		access_token: e2eAccessToken,
		refresh_token: e2eRefreshToken,
	});

	if (error || !data.session) {
		// #1030 【セキュリティ】トークンそのものは絶対にログへ出さない（Detox の Artifact に残るため）。原因メッセージのみ出す
		throw createInjectionError(`setSession に失敗しました: ${error?.message ?? "session is null"}`);
	}

	// #1030 【設計】注入結果が本当に期待ユーザーかを最終確認する（トークンの取り違え検知）
	if (data.session.user.id !== e2eExpectedUserId) {
		throw createInjectionError(
			`注入後のユーザー(user_id=${data.session.user.id})が期待ユーザー(user_id=${e2eExpectedUserId})と一致しません。`,
		);
	}
	assertSessionOwner(e2eSessionOwner, data.session.user.id, data.session.user.is_anonymous);

	// #1131 `once` のときに 2 回目以降を素通りさせるための記録（`always` では読まれない）
	hasInjectedInThisProcess = true;

	return "injected";
};
