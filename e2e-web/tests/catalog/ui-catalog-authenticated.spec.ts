import { test, expect } from "../../fixtures/test";
import { TabBar } from "../../pages/TabBar";
import { ProfilePage } from "../../pages/ProfilePage";
import { SettingsPage } from "../../pages/SettingsPage";
import { MyDishesPage } from "../../pages/MyDishesPage";
import { captureScreen, captureScreenIfReachable } from "../../utils/catalog";

/**
 * 📸 UI カタログ（ログイン済みでのみ到達できる画面）@catalog
 *
 * 実行プロジェクト: ui-catalog-authenticated（tests/setup/auth.setup.ts の storageState を注入）
 * 前提: TEST_USER_EMAIL / TEST_USER_PASSWORD が設定されていること。未設定ならスキップする。
 *
 * ## 注意
 * storageState はプロジェクト内で共有されるため、**ログアウトは実行しない**
 * （設定画面はログアウト行が表示された状態を撮るだけに留める）。
 * 収集方針は tests/catalog/ui-catalog.spec.ts のコメントを参照。
 */
test.skip(
	() => !process.env.TEST_USER_EMAIL || !process.env.TEST_USER_PASSWORD,
	"TEST_USER_EMAIL / TEST_USER_PASSWORD(e2e-web/.env)が未設定のためスキップ",
);

test.describe("UI カタログ（ログイン済み） @catalog", () => {
	// #1402 4 グリッドタブが廃止され、レビュータブ（profile-authenticated-reviews）は無くなった。
	// profile/food への導線は «いいねした投稿» だけになったので、フィードもそこから撮る
	test("マイページ（ログイン済み・いいね一覧・フィード）", async ({ appPage }) => {
		const tabBar = new TabBar(appPage);
		const profilePage = new ProfilePage(appPage);

		await tabBar.gotoProfile();
		await expect(profilePage.loginButton).toHaveCount(0);
		// グリッドは実 API から取得したメディアを並べるため、待ちが短いとスケルトンのまま撮れてしまう
		await captureScreen(appPage, "profile-authenticated", { settleMs: 4_000 });

		const reachedLiked = await captureScreenIfReachable(
			appPage,
			"profile-liked",
			async () => {
				await profilePage.openLiked();
			},
			{ settleMs: 4_000 },
		);

		// いいねが 1 件も無いテストユーザーではグリッドが空になり到達できない
		if (reachedLiked) {
			await captureScreenIfReachable(
				appPage,
				"profile-food-feed",
				async () => {
					// グリッドはデータ取得中スケルトンを出す。実データのセル（画像）が出るまで待つ
					const firstCell = profilePage.likedGrid.locator("img").first();
					await expect(firstCell).toBeVisible({ timeout: 30_000 });
					await firstCell.click();
					// フィード固有のアクションボタンの出現で到達を判定する
					await expect(appPage.getByTestId("dish-action-like").first()).toBeVisible({ timeout: 20_000 });
				},
				{ settleMs: 6_000 },
			);
		}
	});

	// #1369 プロフィール編集はモーダルからルートへ移ったため、カタログでも 1 画面として撮る。
	// 編集ボタンはログイン済みのときだけ描画されるので、この（authenticated）spec 側に置く
	test("プロフィール編集（ログイン済み）", async ({ appPage }) => {
		const tabBar = new TabBar(appPage);
		const profilePage = new ProfilePage(appPage);

		await tabBar.gotoProfile();
		await captureScreenIfReachable(
			appPage,
			"profile-edit",
			async () => {
				await profilePage.openEdit();
			},
			// アバター画像の読み込みを待つ（スケルトンのまま撮らない）
			{ settleMs: 2_000 },
		);
	});

	// #1402 設定は独立した画面ではなくマイページの縦リストになったので、
	// カタログ ID «profile-settings-authenticated» は無くなった（profile-authenticated が兼ねる）。
	// ログアウト行の «有無» がログイン済み／匿名の唯一の差なので、それだけをここで確かめる
	test("マイページ（ログイン済み）にログアウト行がある", async ({ appPage }) => {
		const settingsPage = new SettingsPage(appPage);

		await settingsPage.goto();
		await settingsPage.expectLoaded();
		await expect(settingsPage.logoutItem).toBeVisible();
	});

	test("お知らせ（通知一覧）", async ({ appPage }) => {
		const tabBar = new TabBar(appPage);

		await captureScreenIfReachable(
			appPage,
			"notifications",
			async () => {
				await expect(tabBar.notificationsTab).toBeVisible();
				await tabBar.gotoNotifications();
				// 通知 0 件なら空状態（ja-JP: Notifications.empty）が出る
				await expect(appPage.getByText("お知らせ", { exact: true }).first()).toBeVisible({ timeout: 20_000 });
			},
			{ settleMs: 2_000 },
		);
	});

	test("レビュー投稿導線（食べたい/食べたタブ・店舗選択）", async ({ appPage }) => {
		test.setTimeout(120_000);

		const tabBar = new TabBar(appPage);
		const myDishesPage = new MyDishesPage(appPage);

		await tabBar.gotoMyDishes();
		await myDishesPage.expectAuthenticatedViewLoaded();
		await captureScreen(appPage, "my-dishes-authenticated");

		await captureScreenIfReachable(
			appPage,
			"my-dishes-select-restaurant",
			async () => {
				// #1375（3 巡目）: ＋ → SNS 取り込み画面 → 「食べた」タブ（統合フォーム）→
				// 「お店を選ぶ」で pick モードの地図へ
				await myDishesPage.openEatenRecordFlow();
				await appPage.getByTestId("sns-import-eaten-pick-restaurant").click();
				// 地図画面。現在地ボタンの出現をもって到達とみなす
				await expect(appPage.getByTestId("review-select-restaurant-current-location-button")).toBeVisible({
					timeout: 30_000,
				});
			},
			// 地図タイル・マーカーの描画待ち
			{ settleMs: 5_000 },
		);
	});
});
