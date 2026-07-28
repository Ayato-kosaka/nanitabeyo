import { device, element, by, waitFor } from "detox";

/**
 * 🚀 起動スモークテスト @smoke
 *
 * 目的: 「ネイティブ起動 → スプラッシュ → ロケールリダイレクト → 匿名認証 → 検索画面」という
 *       アプリの起動シーケンス全体が壊れていないことを最小の手数で保証する（e2e-web の boot.spec.ts に対応）。
 * 検証範囲: タブバーの表示のみ。個別機能には踏み込まない (Tier 1)。
 *
 * 注意: tabBarButtonTestID は app-expo/app/[locale]/(tabs)/_layout.tsx で定義されている。
 * tab-notifications は匿名ユーザーには非表示、tab-map は常に非表示（内部遷移専用）のため、
 * ここでは匿名ユーザーでも必ず表示される 3 タブのみを検証する。
 */
describe("起動 @smoke", () => {
	beforeAll(async () => {
		// #1027 【設計】クリーンな初回起動を検証するため新規インスタンスで起動する
		await device.launchApp({ newInstance: true });
	});

	// ─ テストケース: 起動するとタブバー付きの検索画面が表示される ─
	// 手順:
	//   1. アプリを起動する（スプラッシュ → expo-router のロケールリダイレクトを待つ）
	//   2. さがす/レビュー/マイページの各タブが表示されることを検証
	it("起動するとタブバー付きの検索画面が表示される", async () => {
		// #1027 【パフォーマンス】初回起動は JS バンドル読込 + 匿名サインインの通信を含むため長めに待つ
		await waitFor(element(by.id("tab-search")))
			.toBeVisible()
			.withTimeout(120000);
		await waitFor(element(by.id("tab-review")))
			.toBeVisible()
			.withTimeout(15000);
		await waitFor(element(by.id("tab-profile")))
			.toBeVisible()
			.withTimeout(15000);

		// #1027 【設計】起動成功のエビデンスとしてスクリーンショットを保存する
		// （CI では artifacts/ 配下に出力され、Actions の Artifact として回収できる）
		await device.takeScreenshot("boot-search-screen");
	});
});
