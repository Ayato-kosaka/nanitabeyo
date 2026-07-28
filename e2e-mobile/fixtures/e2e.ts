import { by, device, element, expect as detoxExpect, waitFor } from "detox";

import { iosLanguageAndLocale, localeDeepLink, warnIfAndroidLocaleMismatch } from "../utils/locale";
import {
	isAuthenticatedAvailable,
	isMutationEnabled,
	readSessionFromEnv,
	type SessionOwner,
} from "../utils/sessionEnv";
import {
	DEFAULT_TIMEOUT,
	LAUNCH_TIMEOUT,
	existsNow,
	waitUntilExists,
	waitUntilGone,
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
export { DEFAULT_TIMEOUT, LAUNCH_TIMEOUT, existsNow, waitUntilExists, waitUntilGone, waitUntilVisible };
export { localeDeepLink };
export type { SessionOwner };

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
	 * ロケール依存の画面へ直接飛ぶ場合は `localeDeepLink("search/topics")` を使うこと（#1031 B4）。
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
};

/**
 * 「セッションを注入した状態でアプリを起動し、操作可能になるまで待つ」。
 * e2e-web の `appPage` フィクスチャに相当する、**全 spec の標準的な入口**。
 *
 * ## 仕組み（#1030 確定設計 A' 案）
 * 1. globalSetup が Node 側 supabase client で 1 回だけセッションを確立し、`process.env` へ格納する
 * 2. このヘルパがそれを `launchArgs`（`e2eAccessToken` / `e2eRefreshToken` / `e2eSessionOwner`）としてアプリへ渡す
 * 3. アプリ側フック（app-expo。**別 PR で実装中**）が `supabase.auth.setSession()` で注入する
 *
 * これにより「アプリのデータを何度消しても匿名サインインを消費しない」状態を作り、
 * 「テスト間の状態汚染を避けたい」と「レート制限を超えたくない」を両立させる（#1030 3-1）。
 *
 * ⚠️ **アプリ側フックが未実装の間**は、launchArgs は単に無視される（アプリは通常どおり自前で
 * 匿名サインインする）。渡す側の契約はこの時点で確定させ、アプリ側 PR の合流で自動的に有効になる。
 *
 * @param opts.as 期待するセッションの持ち主。`authenticated` はテストユーザー、`anon` は匿名
 * @失敗時 期待するセッションが環境変数に無い場合、日本語メッセージで例外を投げる（fail-loud。#1030 B-1）
 */
export async function launchAppWithSession(opts: { as: SessionOwner } & LaunchOptions): Promise<void> {
	const { as, url, resetState = false, waitForReady = true } = opts;

	const session = readSessionFromEnv(as);
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
			// 再注入を判断する。その期待値がこのキー
			e2eSessionOwner: as,
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
	const { url, resetState = false, waitForReady = false } = opts;

	if (resetState) {
		await device.resetAppState();
	}

	await device.launchApp({
		newInstance: true,
		url,
		...platformLaunchOptions(),
	});

	if (waitForReady) {
		await waitForAppReady();
	}
}

/**
 * アプリが操作可能な状態（タブレイアウトの描画完了）になるまで待つ。
 *
 * @param timeout タイムアウト (ms)。既定は初回起動を見込んだ LAUNCH_TIMEOUT
 * @失敗時 タイムアウト時に Detox の例外を投げる
 */
export async function waitForAppReady(timeout: number = LAUNCH_TIMEOUT): Promise<void> {
	await waitUntilVisible(by.id(APP_READY_TEST_ID), timeout);
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
