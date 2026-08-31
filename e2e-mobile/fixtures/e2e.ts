import { by, device, element, expect as detoxExpect, waitFor } from "detox";

import { ensureFreshSession } from "../utils/freshSession";
import {
	E2E_LOCALE,
	getAndroidSystemLocale,
	iosLanguageAndLocale,
	localeDeepLink,
	warnIfAndroidLocaleMismatch,
} from "../utils/locale";
import {
	isAuthenticatedAvailable,
	isMutationEnabled,
	isProbeEnabled,
	readSessionFromEnv,
	type E2ESession,
	type SessionOwner,
} from "../utils/sessionEnv";
import {
	DEFAULT_TIMEOUT,
	LAUNCH_TIMEOUT,
	existsNow,
	multiTapWhenPresent,
	tapWhenPresent,
	tapWhenVisible,
	visibleNow,
	waitUntil,
	waitUntilExists,
	waitUntilGone,
	waitUntilNotVisible,
	waitUntilVisible,
} from "../utils/waits";

/**
 * 🧩 e2e-mobile 共通基盤（e2e-web の fixtures/test.ts に相当）
 *
 * **すべての spec / Screen Object はこのファイルから import すること。**
 * `detox` を直接 import すると、ここで定義した起動手順（セッション注入・ロケール固定・権限付与）や
 * Tier の安全弁が効かなくなる。
 *
 * ## Playwright との違い
 * Playwright のフィクスチャ（DI で `appPage` を注入する仕組み）は Detox + Jest には無い。
 * そのため **「明示的に呼ぶヘルパ関数 + 再エクスポート」** で同等の効果を出し、
 * 「`fixtures/e2e` から import する」という規約を e2e-web の「`@playwright/test` 直 import 禁止」と
 * 同じ強度で運用する（#1028 §5-2）。
 *
 * ## expect の使い分け（#1028 m1 の確定に基づく）
 * このワークスペースは `@types/jest` + `detox` からの明示 import 方式を採用している
 * （スパイクで型衝突が起きないことを実測済み。詳細は README「@types/jest を採用している理由」）。
 * - `expect`（このファイルからの import）… **Detox のマッチャ**。要素のアサーション用
 *   （`await expect(element(by.id("x"))).toBeVisible()`）
 * - 値（配列・文字列など）のアサーションは Detox の expect では行えない。
 *   純粋な値を検証したい場合は `node:assert/strict` を使うこと（グローバルの `expect` は
 *   .detoxrc.js の `behavior.init.exposeGlobals: false` により Jest 側のものになるが、
 *   混同を避けるため spec では使わない規約とする）
 */

export { by, device, element, waitFor, detoxExpect as expect };
export {
	DEFAULT_TIMEOUT,
	LAUNCH_TIMEOUT,
	existsNow,
	multiTapWhenPresent,
	tapWhenPresent,
	tapWhenVisible,
	visibleNow,
	waitUntil,
	waitUntilExists,
	waitUntilGone,
	waitUntilNotVisible,
	waitUntilVisible,
};
export { localeDeepLink };
export type { E2ESession, SessionOwner };

/**
 * アプリの「起動完了」を判定する観測点。
 *
 * #1028 【設計】e2e-web の「/ja-JP へのリダイレクト完了 + 匿名セッション確立」に相当するネイティブ側の観測点として、
 * ボトムタブ（app-expo/app/[locale]/(tabs)/_layout.tsx の tabBarButtonTestID）の表示を使う。
 * ここが見えている = 「JS バンドル読込 → ロケール解決 → 認証確立 → タブレイアウト描画」まで到達している。
 */
const APP_READY_TEST_ID = "tab-search";

/** 起動ヘルパの共通オプション */
type LaunchOptions = {
	/**
	 * 起動時に開くディープリンク。省略時はアプリの通常起動。
	 * ロケール依存の画面へ直接飛ぶ場合は `localeDeepLink("search/dish-categories")` を使うこと（#1031 B4）。
	 */
	url?: string;
	/**
	 * 起動前にアプリのストレージ（AsyncStorage）を消すか。
	 * ⚠️ iOS の `resetAppState()` は **アンインストール + 再インストール相当**で高コスト（#1030 m-5）。
	 * さらにセッションも消えるため、launchArgs を渡さない起動と組み合わせると
	 * **匿名サインインのクォータ（30 回/時/IP）を 1 消費する**。既定 false。
	 */
	resetState?: boolean;
	/** 起動後に「アプリ起動完了」まで待つか。既定 true */
	waitForReady?: boolean;
	/**
	 * 検索チュートリアルの「視聴済みフラグ」をどう扱うか（#1027）。
	 *
	 * - `true`（既定） … 視聴済みとして起動する = **チュートリアルは開かない**
	 * - `false` … 未視聴として起動する = 初回起動の自動表示を再現する
	 * - `"device"` … 起動引数を渡さず、端末の AsyncStorage の実データに従う
	 *
	 * e2e-web の `test.use({ seedTutorialSeen })` に対応する（詳細は app-expo/lib/e2e/tutorialSeed.ts）。
	 * チュートリアルは Android では別ウィンドウの Dialog として最前面に出るため、
	 * 既定で抑止しておかないと **どの spec でもタップがシートに吸われうる**。
	 */
	tutorialSeen?: boolean | "device";
};

/**
 * 「セッションを注入した状態でアプリを起動し、操作可能になるまで待つ」。
 * e2e-web の `appPage` フィクスチャに相当する、**全 spec の標準的な入口**。
 *
 * ## 仕組み（#1030 確定設計 A' 案）
 * 1. globalSetup が Node 側 supabase client で 1 回だけセッションを確立し、`process.env` へ格納する
 * 2. このヘルパがそれを `launchArgs`（`e2eAccessToken` / `e2eRefreshToken` / `e2eSessionOwner`）としてアプリへ渡す
 * 3. アプリ側フック（app-expo/lib/e2e/injectTestSession.ts）が `supabase.auth.setSession()` で注入する
 *
 * これにより「アプリのデータを何度消しても匿名サインインを消費しない」状態を作り、
 * 「テスト間の状態汚染を避けたい」と「レート制限を超えたくない」を両立させる（#1030 3-1）。
 *
 * ⚠️ フックの有効/無効は **バンドル時** に metro の resolver が決める。
 * `EXPO_PUBLIC_E2E_AUTH_HOOK=1` を付けずにビルドすると noop 実装が焼き込まれ、
 * launchArgs は **黙って無視される**（= 認証済みテストが匿名のまま緑になる）。
 * CI では e2e-mobile-test.yml の Detox build ステップで設定している。
 *
 * @param opts.as 期待するセッションの持ち主。`authenticated` はテストユーザー、`anon` は匿名
 * @param opts.session 環境変数の共有セッションではなく、渡したセッションを注入する（#1131）
 * @param opts.injection 注入の反復ポリシー。既定 `"always"`（#1131）
 * @失敗時 期待するセッションが環境変数に無い場合、日本語メッセージで例外を投げる（fail-loud。#1030 B-1）
 */
export async function launchAppWithSession(
	opts: {
		as: SessionOwner;
		/**
		 * 注入するセッションを明示する（#1131）。
		 *
		 * 省略時は globalSetup が確立した **run 共有**のセッション（環境変数）を使う。
		 * ⚠️ **セッションを壊す操作（ログアウト）を行う spec は必ず専用セッションを渡すこと。**
		 * 共有セッションでログアウトすると `POST /auth/v1/logout?scope=local` がサーバ側でも失効させ、
		 * 後続の `tests/authenticated/` が軒並み落ちる（utils/disposableSession.ts 参照）。
		 */
		session?: E2ESession;
		/**
		 * 注入の反復ポリシー（#1131）。アプリ側フックの `e2eSessionInjection` へそのまま渡る。
		 *
		 * - `"always"`（既定） … 呼ばれるたびに「期待ユーザーと一致するか」で判定して注入する
		 * - `"once"` … プロセス内で 1 回成立したら以降は素通りする。
		 *   **ログアウトを検証する spec 専用**。既定のままだと SIGNED_OUT →`runAuthAttempt()`→ 注入 の順で
		 *   ログイン済みセッションが復活し、「ログアウトしたのにログイン済みに戻る」テストになる
		 *   （app-expo/lib/e2e/injectTestSession.ts の `E2ESessionInjectionPolicy`）。
		 *   ⚠️ `"once"` の spec では、ログアウト後の匿名サインインが **実際に 1 回発生する**
		 *   （30 回/時/IP の枠を 1 消費する）。それ自体が検証対象なので潰さないこと
		 */
		injection?: "always" | "once";
	} & LaunchOptions,
): Promise<void> {
	const {
		as,
		session: explicitSession,
		injection = "always",
		url,
		resetState = false,
		waitForReady = true,
		tutorialSeen = true,
	} = opts;

	// ⚠️ 生の readSessionFromEnv ではなく **鮮度保証つき**で読むこと。
	// iOS の run は 90 分を超え、run 冒頭に確立した access token（寿命 1 時間）が
	// 途中で切れる。期限切れのペアを注入するとアプリ側の setSession がローテーションを
	// 起こし、以降の起動が全滅する（utils/freshSession.ts に経緯）
	const session = explicitSession ?? (await ensureFreshSession(as));
	if (!session) {
		// #1030 【設計】B-1: 「注入できなかったので黙って通常起動へフォールバック」は絶対にしない。
		// 匿名ユーザーのままログイン済みテストが走り、テストは緑なのに検証内容だけが嘘になるため
		throw new Error(
			[
				`${as} セッションが確立されていないため、launchAppWithSession({ as: "${as}" }) を実行できません。`,
				as === "authenticated"
					? "  TEST_USER_EMAIL / TEST_USER_PASSWORD（e2e-mobile/.env または CI secrets）を設定してください。" +
						"\n  設定できない環境では describeAuthenticated を使って spec ごと skip させること。"
					: "  app-expo/.env の EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY を確認してください" +
						"\n  （CI では `eas env:pull development` が .env を生成します）。",
			].join("\n"),
		);
	}

	if (resetState) {
		await device.resetAppState();
	}

	await device.launchApp({
		newInstance: true,
		url,
		// #1030 【設計】キー名は `e2e` プレフィックスで統一する（Detox 自身が使う `detox*` 系と衝突させないため）。
		// 値は **文字列のみ**（launchArgs の数値・真偽値の型変換はプラットフォーム差があるため踏まない。#1030 3-2）
		...platformLaunchOptions({
			e2eAccessToken: session.accessToken,
			e2eRefreshToken: session.refreshToken,
			// #1030 【設計】B-1: アプリ側は「セッションの有無」ではなく「期待ユーザーと現在ユーザーの一致」で
			// 再注入を判断する。その期待値がこの 2 キー。
			// ⚠️ `e2eExpectedUserId` はアプリ側フックの **必須項目**で、欠けると起動時に fail-loud で例外になる
			//（app-expo/lib/e2e/injectTestSession.ts）。トークンと必ずセットで渡すこと
			e2eSessionOwner: as,
			e2eExpectedUserId: session.userId,
			// #1131 既定（"always"）でもキーを明示して渡す。値は文字列のみ（"1"/"true" は
			// react-native-launch-arguments が JSON.parse で型変換してしまうため使わない。#1027 と同じ理由）
			e2eSessionInjection: injection,
			...tutorialLaunchArgs(tutorialSeen),
		}),
	});

	if (waitForReady) {
		await waitForAppReady();
	}
}

/**
 * 「セッションを注入せずに」アプリを起動する。
 *
 * ⚠️ **原則としてこのヘルパは使わないこと。** アプリ自身の `signInAnonymously()` が走るため、
 * 呼ぶたびに匿名サインインのクォータ（30 回/時/IP、dev/prod 共有プロジェクト）を消費する。
 *
 * #1030 【設計】3-1 の例外規約: 「匿名セッションの**自動確立そのもの**を検証する」
 * tests/smoke/boot.test.ts だけがこの起動方法を使ってよい
 * （e2e-web の boot.spec.ts が共有 storageState を使わずフレッシュな状態に戻しているのと同じ位置づけ）。
 *
 * @param opts.waitForReady 既定 false。起動シーケンスそのものを検証する spec が自分で待つため
 */
export async function launchAppWithoutSession(opts: LaunchOptions = {}): Promise<void> {
	const { url, resetState = false, waitForReady = false, tutorialSeen = true } = opts;

	if (resetState) {
		await device.resetAppState();
	}

	await device.launchApp({
		newInstance: true,
		url,
		// #1027 セッションは渡さないが、チュートリアルの抑止だけは他の spec と揃える。
		// アプリ側のセッション注入フックはこのキーを見ないため、匿名サインインの検証には影響しない
		...platformLaunchOptions(tutorialLaunchArgs(tutorialSeen)),
	});

	if (waitForReady) {
		await waitForAppReady();
	}
}

/**
 * オンボーディング（`app-expo` の app/[locale]/onboarding/）の testID。
 *
 * #1027 【バグ】この案内は **ja-JP のとき初回起動で自動的に開く**全画面で、
 * 開いている間は背後のタブバーが Detox から操作できない（run 30394200940 の iOS で
 * 全 spec が beforeAll ごと失敗した原因）。Android で顕在化していなかったのは、
 * 端末ロケールが en-US のままで案内自体が出ていなかったからにすぎない。
 *
 * screens/OnboardingScreen.ts にも同じ定義があるが、**起動処理はどの画面にも依存してはいけない**
 * （fixtures が screens に依存すると循環参照になる）ため、ここでは matcher を直接持つ。
 *
 * ⚠️ #1486 で実体が TrueSheet の BottomSheet から **通常のルート** へ変わったため、
 * 「Android では中身が必ず 2 つの View に一致する」問題は無くなった（`atIndex` は不要）。
 */
const ONBOARDING = {
	nextButton: by.id("onboarding-next"),
	skipButton: by.id("onboarding-skip"),
	loginSkipButton: by.id("login-screen-skip"),
	welcomeScreen: by.id("onboarding-welcome"),
	startButton: by.id("onboarding-welcome-start"),
};

/**
 * 起動引数へ載せるオンボーディング既読フラグのシード値を組み立てる（#1027）。
 *
 * `"device"` のときだけキー自体を渡さない。アプリ側フックは「未指定 = 固定なし」と解釈し、
 * AsyncStorage の実データを読む（= 永続化そのものを検証する spec 向け）。
 */
function tutorialLaunchArgs(tutorialSeen: boolean | "device"): Record<string, string> {
	if (tutorialSeen === "device") return {};
	// ⚠️ "1" / "0" / "true" は使わないこと。アプリ側が使う react-native-launch-arguments は
	// 受け取った文字列を 1 つずつ JSON.parse にかけ、**成功したら型変換してしまう**
	// （"1" → 数値 1、"true" → 真偽値 true）。JSON として解釈できない語を使う
	return { e2eTutorialSeen: tutorialSeen ? "seen" : "unseen" };
}

/**
 * オンボーディングが開いていれば最後まで通して閉じる（ベストエフォート）。
 *
 * 「スキップ」→ ログイン画面の「スキップ」→ 許可フローを通過 → Welcome の「はじめる」まで
 * 通し切る。**途中で抜けないのは意図的**で、完了フラグが立つのは Welcome の「はじめる」だけだから
 *（#1486 §7）。3 ステップだけ抜けて放置すると、次の起動でまた最初から出てしまう。
 *
 * ⚠️ **通常の spec はこれを呼ぶ必要が無い**（#1027）。起動引数のシードでオンボーディング自体が開かない。
 * 残しているのは「シードを外して起動した spec が、検証後に後片付けとして閉じたい」場合のため。
 *
 * @param probeTimeout 「出ているか」の判定に費やす上限 (ms)
 * @returns 閉じた場合 true / そもそも出ていなかった場合 false
 */
export async function dismissOnboardingIfPresent(probeTimeout = 3_000): Promise<boolean> {
	if (!(await visibleNow(ONBOARDING.nextButton, probeTimeout))) return false;

	// ベストエフォートに徹する。ここで例外を投げると呼び出し側のリトライを潰してしまううえ、
	// 「オンボーディングを閉じられなかった」ではなく本来の検証内容で失敗させたいため
	try {
		await tapWhenVisible(ONBOARDING.skipButton, DEFAULT_TIMEOUT);

		// ログイン画面の「スキップ」。オンボーディング経由のときだけ描画される（#1486 §4）
		if (await visibleNow(ONBOARDING.loginSkipButton, DEFAULT_TIMEOUT)) {
			await tapWhenVisible(ONBOARDING.loginSkipButton, DEFAULT_TIMEOUT);
		}

		// 位置情報・通知の説明画面は «答えが出るまで» しか出ていない。E2E ビルドは起動時に
		// 権限を付与済み（platformLaunchOptions()）なので OS のダイアログは出ず、
		// 最低表示時間を過ぎると自動で次へ進む。着地点の Welcome だけを待つ
		await waitUntilVisible(ONBOARDING.welcomeScreen, 60_000);
		await tapWhenVisible(ONBOARDING.startButton, DEFAULT_TIMEOUT);
		await waitUntilNotVisible(ONBOARDING.startButton, DEFAULT_TIMEOUT);
		return true;
	} catch {
		return false;
	}
}

/**
 * アプリが操作可能な状態（タブレイアウトの描画完了）になるまで待つ。
 *
 * #1027 【設計】チュートリアルの後始末はここでは行わない。起動引数のシード（`tutorialSeen`）で
 * **そもそも開かない**ようにしてあるため（app-expo/lib/e2e/tutorialSeed.ts）。
 * かつて「出ていたら閉じる」をここでやっていたが、
 * - シートは AsyncStorage の読み込み完了後、タブバーが見えた数百 ms 後に遅れて被さる
 * - Android の Espresso は別ウィンドウによる遮蔽を可視性判定へ反映しない
 *   （= シートが開いていてもタブバーは `toBeVisible()` を満たす）
 * ため「起動完了を待ち切ったのに直後のタップだけが落ちる」を消せなかった（run 30429560108）。
 *
 * @param timeout タイムアウト (ms)。既定は初回起動を見込んだ LAUNCH_TIMEOUT
 * @失敗時 タイムアウト時に例外を投げる。チュートリアルが出ていた場合は
 *         「シードが効いていない（= ビルド時に EXPO_PUBLIC_E2E_TUTORIAL_HOOK が立っていない）」と
 *         判断できるよう、メッセージにその旨を足して投げ直す
 */
export async function waitForAppReady(timeout: number = LAUNCH_TIMEOUT): Promise<void> {
	try {
		await waitUntilVisible(by.id(APP_READY_TEST_ID), timeout);
	} catch (error) {
		if (await visibleNow(ONBOARDING.nextButton, 1_000)) {
			throw new Error(
				[
					"起動完了（タブバーの表示）を待てず、代わりにオンボーディングが表示されています。",
					"  オンボーディングは起動引数 e2eTutorialSeen でシードして抑止する設計です（#1027）。",
					"  ビルド時に EXPO_PUBLIC_E2E_TUTORIAL_HOOK=1 が設定されていたか確認してください",
					"  （このフックは **バンドル時** に metro の resolver で有効/無効が決まります）。",
					`  元の失敗: ${error instanceof Error ? error.message : String(error)}`,
				].join("\n"),
			);
		}
		throw error;
	}
}

/**
 * 認証済みテスト用の `describe`。
 *
 * #1030 【設計】3-3: TEST_USER_EMAIL / TEST_USER_PASSWORD が未設定の環境（fork PR・初見のローカル）では
 * spec を丸ごと skip する。e2e-web の tests/authenticated/ が自動 skip されるのと同じ体験を Detox でも再現する。
 *
 * ⚠️ `describe` は Jest のグローバル（`@types/jest` 由来）を参照している。
 * import 元をぶらさないため、この判定は必ずこの定数経由で行うこと（#1030 m-9）。
 *
 * @example
 * describeAuthenticated("マイページ（ログイン済み）", () => { ... });
 */
export const describeAuthenticated: typeof describe = isAuthenticatedAvailable() ? describe : describe.skip;

/**
 * @mutation テスト用の `describe`。
 *
 * #1030 【設計】レビュー M-3: e2e-web は playwright.config.ts の `grepInvert` という
 * **設定ファイル側**の安全弁を持つが、Jest には `testNamePattern` 相当の設定オプションが無い。
 * そのため「実行コマンドに依存しない」ガードとして、コードレベルでも skip できるようにする。
 *
 * 実際には次の二重ガードになる:
 * 1. 設定段（主防御）: jest.config.js の `testPathIgnorePatterns` が `tests/mutation/` を探索から外す
 *    → RUN_MUTATION が無い限り **ファイルがロードされない**
 * 2. コード段（二重ガード）: この `describeMutation` が `RUN_MUTATION !== "1"` なら skip する
 *    → `--testPathPattern` 等で設定をバイパスされても共有 dev DB へ書き込まない
 *
 * @example
 * describeMutation("いいね/保存 @mutation", () => { ... });
 */
export const describeMutation: typeof describe = isMutationEnabled() ? describe : describe.skip;

/**
 * @probe テスト用の `describe`（#1087）。
 *
 * `tests/probe/` に置く spec は「アプリの不具合を客観的な数値で示す」ことが目的で、
 * **修正が入るまで落ちるのが正しい振る舞い**。夜間 CI の既定スコープ（tier1-2）へ混ぜると
 * 既存スコープが常時赤くなり、本物の回帰が埋もれる。そのため @mutation と同じ二重ガードで
 * 既定の探索から外し、`RUN_PROBE=1` を明示したときだけ実行する:
 * 1. 設定段（主防御）: jest.config.js の `testPathIgnorePatterns` が `tests/probe/` を探索から外す
 * 2. コード段（二重ガード）: この `describeProbe` が `RUN_PROBE !== "1"` なら skip する
 *
 * ⚠️ **現在この層に spec は無い**（#1087 の先読み画像プローブは修正の完了に伴い
 * tests/search/preload-images.test.ts へ昇格した）。使いどころは e2e-mobile/README.md を参照。
 *
 * @example
 * describeProbe("先読み画像のロード枚数 @probe", () => { ... });
 */
export const describeProbe: typeof describe = isProbeEnabled() ? describe : describe.skip;

/**
 * ja-JP ロケール前提のテスト用の `describe`。
 *
 * #1031 【設計】B4: 検索チュートリアルの自動表示は app-expo 側が `isJapanese` でゲートしており、
 * 端末ロケールが ja-JP でないとそもそも開かない。CI は Android のシステムロケールを ja-JP へ固定するが
 * （e2e-mobile-test.yml の adb setprop）、ローカルの手元エミュレータでは固定されていないことがある。
 * その場合に **120 秒待ってから失敗する**のは調査コストが高いので、spec ごと skip して理由を明示する。
 *
 * 判定は Android のシステムロケールのみを見る（iOS は launchApp の `languageAndLocale` で
 * 常に固定されるため。`getAndroidSystemLocale()` は iOS / adb 不在時に null を返すので skip しない）。
 *
 * @example
 * describeJapaneseLocale("検索チュートリアル", () => { ... });
 */
export const describeJapaneseLocale: typeof describe = (() => {
	const androidLocale = getAndroidSystemLocale();
	if (androidLocale !== null && androidLocale !== E2E_LOCALE) {
		console.warn(
			`⚠️ Android ロケールが ${E2E_LOCALE} ではない（現在: ${androidLocale}）ため、ja-JP 前提の spec を skip します。`,
		);
		return describe.skip;
	}
	return describe;
})();

/**
 * プラットフォーム依存の launchApp オプションを組み立てる。
 *
 * #1028 【設計】`permissions` と `languageAndLocale` は **どちらも Detox の iOS 専用機能**。
 * Android へ渡すと無視される（もしくはエラーになる）ため、プラットフォーム判定でここに閉じ込める。
 * Android 側の等価物は次のとおりで、いずれも CI ワークフロー / AVD 側の責務になる（#1029）:
 * - 実行時権限 … `adb shell pm grant <package> android.permission.ACCESS_FINE_LOCATION` 等
 * - ロケール   … `adb shell setprop persist.sys.locale ja-JP`（utils/locale.ts のヘルパ参照）
 */
function platformLaunchOptions(launchArgs: Record<string, string> = {}): Detox.DeviceLaunchAppConfig {
	const hasLaunchArgs = Object.keys(launchArgs).length > 0;

	if (device.getPlatform() === "ios") {
		return {
			// #1031 【設計】B4: iOS はここでロケールを固定できる（Android にはこの機能が無い）
			languageAndLocale: iosLanguageAndLocale(),
			// #1028 【設計】権限ダイアログは操作を止めるため事前に付与する。
			// #1027 【バグ】特に location と userTracking(ATT) は **起動直後**に出るため、
			// 未付与だとダイアログ表示中はアプリが inactive のままとなり Detox の waitForActive が
			// 完了せず launchApp がタイムアウトする（run 30364296574 / 30368487678 で実測）。
			permissions: {
				location: "inuse",
				userTracking: "YES",
				notifications: "YES",
				camera: "YES",
				photos: "YES",
			},
			// #1027 【バグ】iOS はメインキューに常駐する作業（常時アニメーション等）があり、Detox の同期機構が
			// 永遠にアイドル判定にならない（run 30359425182）。iOS のみ同期を無効化し、待機は waitFor の
			// ポーリング（utils/waits.ts）に委ねる。恒久的な busy 原因の調査は #1040。
			launchArgs: { ...launchArgs, detoxEnableSynchronization: 0 },
		};
	}

	// #1031 【設計】B4: Android はロケールを起動時に指定できないため、ずれていれば警告だけ出して気付けるようにする
	warnIfAndroidLocaleMismatch();
	return hasLaunchArgs ? { launchArgs } : {};
}
