import * as path from "node:path";
import { test, expect } from "../../fixtures/test";
import { TabBar } from "../../pages/TabBar";
import { MyDishesPage } from "../../pages/MyDishesPage";

/**
 * 📸 レビュー投稿フローのテスト @mutation(不可逆・承認済み)
 *
 * 実行プロジェクト: desktop-chrome-authenticated(storageState 注入済み)
 * 実行条件: RUN_MUTATION=1 のときのみ
 *
 * ## dev DB への影響(重要)
 * - レストラン作成(POST v1/restaurants)は Google Place 検索経由で行われる実際の書き込み。
 *   同じ Place を指定した場合は upsert されるため重複は増えない。
 * - レビュー投稿には削除 UI が存在しないため、このテストのデータは dev DB に蓄積される
 *   (ユーザー承認済み)。識別できるよう、コメントは必ず「[E2E]」プレフィックスを付ける。
 *
 * ## このテストがカタログ内で最も壊れやすい理由
 * Google Places のオートコンプリート結果、料理カテゴリのサジェスト結果など、
 * 外部 API のレスポンス内容に依存する箇所が複数あるため、他のテストより
 * フレーク率が高くなりやすい。失敗時はまずサジェスト結果の中身を確認すること。
 */
test.skip(
	() => !process.env.TEST_USER_EMAIL || !process.env.TEST_USER_PASSWORD,
	"TEST_USER_EMAIL / TEST_USER_PASSWORD(e2e-web/.env)が未設定のためスキップ",
);

const TEST_IMAGE_PATH = path.resolve(__dirname, "../../fixtures/assets/test-dish.png");

test.describe("レビュー投稿 @mutation", () => {
	// レストラン作成・料理カテゴリ検索など複数の実 API 呼び出しを直列で行うため、
	// 既定の 30 秒テストタイムアウトを延長する
	test.setTimeout(60_000);

	// ─ テストケース: 食べたい/食べたタブからレストラン選択画面が開く ─
	// 手順:
	//   1. ログイン済みで起動し、食べたい/食べたタブへ遷移する
	//   2. 記録 CTA(testID: my-dishes-record-button)をタップ
	//   3. レストラン選択画面(店名やエリアで検索する入力欄)が開くことを検証
	test("食べたい/食べたタブからレストラン選択画面が開く", async ({ appPage }) => {
		const tabBar = new TabBar(appPage);
		const myDishesPage = new MyDishesPage(appPage);

		await tabBar.gotoMyDishes();
		await myDishesPage.expectAuthenticatedViewLoaded();
		await myDishesPage.recordButton.click();

		await expect(appPage.getByTestId("location-autocomplete-input")).toBeVisible();
	});

	// ─ テストケース: レストラン検索 → 選択でレストラン詳細画面が開く ─
	// 手順:
	//   1. レストラン選択画面の検索欄に飲食チェーン名(スターバックス)を入力する
	//   2. サジェスト先頭を選択する
	//      (飲食店カテゴリの場合、選択と同時に POST v1/restaurants でレストランが作成/upsert され、
	//      レストラン詳細画面へ遷移する)
	//   3. レストラン詳細画面の投稿ボタン(SelectRestaurant.postPhotoVideo:「写真・動画を投稿」)
	//      が表示されることを検証
	test("レストラン検索でレストラン詳細画面が開く", async ({ appPage }) => {
		const tabBar = new TabBar(appPage);
		const myDishesPage = new MyDishesPage(appPage);

		await tabBar.gotoMyDishes();
		await myDishesPage.recordButton.click();

		await appPage.getByTestId("location-autocomplete-input").fill("スターバックス");
		await appPage.getByTestId("location-autocomplete-suggestions").waitFor({ state: "visible" });
		await appPage.getByTestId("location-autocomplete-suggestion-0").click();

		await expect(appPage.getByTestId("restaurant-detail-post-photo-button")).toBeVisible({ timeout: 20_000 });
	});

	// ─ テストケース: 写真付きレビューを投稿すると成功メッセージが表示される ─
	// 手順:
	//   1. レストラン詳細画面から「写真・動画を投稿」ボタンでレビューフォーム画面(review.tsx)へ遷移する
	//      (画面遷移と同時に写真選択(filechooser)が自動的に走るため、
	//      事前に page.waitForEvent("filechooser") を仕込んでおく)
	//   2. テスト画像(fixtures/assets/test-dish.png)を選択する
	//   3. コメントに「[E2E] 自動テスト投稿 <タイムスタンプ>」、価格、評価(星5)、
	//      料理カテゴリ(コーヒー等の検索→選択)を入力する
	//   4. 投稿ボタン(review-submit-button)をタップする
	//   5. 成功スナックバー「レビューを投稿しました」が表示されることを検証
	test("写真付きレビュー投稿が成功する", async ({ appPage }) => {
		const tabBar = new TabBar(appPage);
		const myDishesPage = new MyDishesPage(appPage);

		await tabBar.gotoMyDishes();
		await myDishesPage.recordButton.click();
		await appPage.getByTestId("location-autocomplete-input").fill("スターバックス");
		await appPage.getByTestId("location-autocomplete-suggestions").waitFor({ state: "visible" });
		await appPage.getByTestId("location-autocomplete-suggestion-0").click();
		await expect(appPage.getByTestId("restaurant-detail-post-photo-button")).toBeVisible({ timeout: 20_000 });

		// レビューフォーム画面(review.tsx)へ遷移すると同時に写真選択(filechooser)が自動的に走る
		const fileChooserPromise = appPage.waitForEvent("filechooser");
		await appPage.getByTestId("restaurant-detail-post-photo-button").click();
		const fileChooser = await fileChooserPromise;
		await fileChooser.setFiles(TEST_IMAGE_PATH);

		await appPage
			.getByTestId("review-comment-input")
			.fill(`[E2E] 自動テスト投稿 ${new Date().toISOString()}`.slice(0, 100));

		// 料理カテゴリを選択する
		await appPage.getByTestId("review-dish-category-row").click();
		await appPage.getByTestId("dish-category-search-input").fill("コーヒー");
		await appPage.getByTestId("dish-category-search-suggestions").waitFor({ state: "visible" });
		await appPage.getByTestId("dish-category-search-suggestion-0").click();

		await appPage.getByTestId("review-price-input").fill("500");
		await appPage.getByTestId("review-star-5").click();

		await appPage.getByTestId("review-submit-button").click();
		await expect(appPage.getByText("レビューを投稿しました", { exact: true })).toBeVisible({ timeout: 30_000 });
	});
});
