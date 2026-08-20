import { by, launchAppWithSession, waitUntilGone, waitUntilVisible } from "../../fixtures/e2e";
import { TabBar } from "../../screens/TabBar";

/**
 * 🧭 タブバー ナビゲーションテスト
 *
 * 目的: ボトムタブの可視性ルール(匿名ユーザーでの表示制御)と、
 *       タブ遷移で各画面が表示されることを保証する(e2e-web の tests/navigation/tab-bar.spec.ts に対応)。
 * 検証範囲: 匿名ユーザーでのタブ可視性 + タブ遷移時の到達画面確認のみ。
 *          個別画面の機能検証には踏み込まない(Tier 2)。
 *
 * ## この spec での起動方法
 * #1030 【設計】3-1 の原則どおり、匿名サインインのレート制限(30 回/時/IP)を避けるため
 * `launchAppWithSession({ as: "anon" })` でセッションを注入して起動する
 * (launchAppWithoutSession は起動シーケンス自体を検証する tests/smoke/boot.test.ts のみの例外)。
 */
describe("タブバー(匿名ユーザー)", () => {
	const tabBar = new TabBar();

	beforeAll(async () => {
		await launchAppWithSession({ as: "anon" });
	});

	// ─ テストケース: 匿名時に表示されるタブが正しい ─
	// 手順:
	//   1. launchAppWithSession({ as: "anon" }) で起動済み(beforeAll)
	//   2. さがす/食べたい・食べた/マイページの 3 タブが表示されることを検証
	//   3. お知らせタブ(tab-notifications)が存在しないことを検証
	//      (app-expo/app/[locale]/(tabs)/_layout.tsx で匿名時 href: null のため非マウント)
	it("匿名時に表示されるタブが正しい", async () => {
		await tabBar.expectLoaded();
		// #1031 【設計】existsNow は「待たない・分岐用」のため、確定的なアサートには waitUntilGone を使う
		await waitUntilGone(tabBar.notificationsTab);
	});

	// ─ テストケース: タブ遷移で各画面が表示される ─
	// 手順:
	//   1. 食べたい/食べたタブへ遷移 → ゲスト向けログイン導線が表示されることを検証
	//      testID: my-dishes-guest-login-button (ja-JP: MyDishes.guest.loginButton)
	//   2. マイページタブへ遷移 → ゲスト向けログインボタンが表示されることを検証
	//      testID: profile-login-button (ja-JP: auth.btn_login)
	//   3. さがすタブへ戻る → 検索ヘッダが再表示されることを検証
	//      testID: search-header-title (ja-JP: Search.headerTitle)
	it("タブ遷移で各画面が表示される", async () => {
		await tabBar.gotoMyDishes();
		await waitUntilVisible(by.id("my-dishes-guest-login-button"));

		await tabBar.gotoProfile();
		await waitUntilVisible(by.id("profile-login-button"));

		await tabBar.gotoSearch();
		await waitUntilVisible(by.id("search-header-title"));
	});
});
