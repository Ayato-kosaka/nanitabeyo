import {
	DEFAULT_TIMEOUT,
	LAUNCH_TIMEOUT,
	by,
	device,
	launchAppWithoutSession,
	waitForAppReady,
	waitUntilVisible,
} from "../../fixtures/e2e";

/**
 * 🚀 起動スモークテスト @smoke
 *
 * 目的: 「ネイティブ起動 → スプラッシュ → ロケールリダイレクト → 匿名認証 → 検索画面」という
 *       アプリの起動シーケンス全体が壊れていないことを最小の手数で保証する（e2e-web の boot.spec.ts に対応）。
 * 検証範囲: タブバーの表示のみ。個別機能には踏み込まない (Tier 1)。
 *
 * ## この spec だけ launchArgs を渡さずに起動する理由（#1030 3-1 の例外規約）
 * 他の spec は `launchAppWithSession()` で Node 側が確立済みのセッションを注入し、
 * 匿名サインイン（30 回/時/IP、dev/prod 共有プロジェクト）の消費を run あたり 1 回に抑える。
 * しかし本 spec は **「アプリが自力で匿名サインインを自動確立すること」自体が検証対象**なので、
 * 意図的に `launchAppWithoutSession()` を使う。
 * （e2e-web の boot.spec.ts が共有 storageState を使わずフレッシュな状態へ戻しているのと同じ判断。
 *   この例外で匿名クォータを 1 消費することは #1030 3-1 の見積に織り込み済み）
 *
 * 注意: tabBarButtonTestID は app-expo/app/[locale]/(tabs)/_layout.tsx で定義されている。
 * tab-notifications は匿名ユーザーには非表示のため、
 * ここでは匿名ユーザーでも必ず表示される 3 タブのみを検証する。
 */
describe("起動 @smoke", () => {
	beforeAll(async () => {
		// #1030 【設計】3-1 の例外: セッションを注入せず、アプリ本来の signInAnonymously() を通す。
		// 起動シーケンスそのものが検証対象なので、起動完了待ちは fixtures に任せずテスト本体で行う
		await launchAppWithoutSession();
	});

	// ─ テストケース: 起動するとタブバー付きの検索画面が表示される ─
	// 手順:
	//   1. アプリを起動する（スプラッシュ → expo-router のロケールリダイレクトを待つ）
	//   2. さがす/食べたい・食べた/マイページの各タブが表示されることを検証
	it("起動するとタブバー付きの検索画面が表示される", async () => {
		// #1027 【パフォーマンス】初回起動は JS バンドル読込 + 匿名サインインの通信を含むため長めに待つ
		// （ja-JP 初回起動で開く検索チュートリアルは起動引数のシードで抑止済み。fixtures/e2e.ts の tutorialSeen）
		await waitForAppReady(LAUNCH_TIMEOUT);
		// タブバーは同時に描画されるため、以降は通常のタイムアウトで足りる
		await waitUntilVisible(by.id("tab-my-dishes"), DEFAULT_TIMEOUT);
		await waitUntilVisible(by.id("tab-profile"), DEFAULT_TIMEOUT);

		// #1027 【設計】起動成功のエビデンスとしてスクリーンショットを残す（CI の Artifact から回収する）。
		// .detoxrc.js の screenshot は "failing" のため、成功時も残すよう CI は --take-screenshots all で実行する
		await device.takeScreenshot("boot-search-screen");
	});
});
