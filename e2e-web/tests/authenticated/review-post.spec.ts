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

	// ─ テストケース: 食べたい/食べたタブから統合フォームとお店選択が開く ─
	// 手順:
	//   1. ログイン済みで起動し、食べたい/食べたタブへ遷移する
	//   2. 記録 CTA(testID: my-dishes-record-button)をタップ → SNS 取り込み画面が開く
	//   3. 上部タブ「食べた」(testID: sns-import-tab-eaten)をタップ → **統合フォーム**が同じ画面に出る
	//   4. 「お店を選ぶ」(sns-import-eaten-pick-restaurant)で pick モードの地図が開くことを検証
	//
	// #1375（3 巡目）: 「食べたを記録」は select-restaurant へ push する形をやめ、
	// タブの中がレビュー入力フォームになった（別画面へ飛ぶと閉じられない・スタックが
	// 積み上がる、と実機で指摘された）。**ここが «既存のレビュータブで出来たこと» を残している証跡**
	test("食べたい/食べたタブから統合フォーム経由でお店選択（pick モード）が開く", async ({ appPage }) => {
		const tabBar = new TabBar(appPage);
		const myDishesPage = new MyDishesPage(appPage);

		await tabBar.gotoMyDishes();
		await myDishesPage.expectAuthenticatedViewLoaded();
		await myDishesPage.openEatenRecordFlow();
		await myDishesPage.openEatenRestaurantPicker();

		await expect(appPage.getByTestId("location-autocomplete-input")).toBeVisible();
	});

	// ─ テストケース: レストラン検索 → 選択で統合フォームへ戻る（pick モード） ─
	// 手順:
	//   1. 統合フォームの「お店を選ぶ」→ pick モードの地図で検索欄に飲食チェーン名を入力する
	//   2. サジェスト先頭を選択する
	//      (飲食店カテゴリの場合、選択と同時に POST v1/restaurants でレストランが作成/upsert される。
	//      pick モードでは詳細画面へは行かず、**選択として統合フォームへ戻る**)
	//   3. フォームの「お店を選ぶ」行に選んだ店名が入っていることを検証
	test("レストラン検索で選ぶと統合フォームへ店名が入って戻る", async ({ appPage }) => {
		const tabBar = new TabBar(appPage);
		const myDishesPage = new MyDishesPage(appPage);

		await tabBar.gotoMyDishes();
		await myDishesPage.openEatenRecordFlow();
		await myDishesPage.openEatenRestaurantPicker();

		await appPage.getByTestId("location-autocomplete-input").fill("スターバックス");
		await appPage.getByTestId("location-autocomplete-suggestions").waitFor({ state: "visible" });
		await appPage.getByTestId("location-autocomplete-suggestion-0").click();

		// このテストが見たいのは «選んだ店名がフォームへ入って戻ること» だけ。
		// ⚠️ 写真ピッカーは自動で開かない（記録フローは mediaPickerMode="manual"）。
		// 以前ここに仕込んでいた filechooser 待ちは、5 巡目に手動選択へ変えた時点で
		// 成立しなくなっていた
		await expect(appPage.getByTestId("sns-import-eaten-pick-restaurant")).toContainText("スターバックス", {
			timeout: 20_000,
		});
		// #1375（6 巡目）店が決まると、次は **料理カテゴリー**の 1 歩目が出る
		await expect(appPage.getByTestId("review-dish-category-step")).toBeVisible({ timeout: 20_000 });
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
		await myDishesPage.openEatenRecordFlow();
		await myDishesPage.openEatenRestaurantPicker();

		await appPage.getByTestId("location-autocomplete-input").fill("スターバックス");
		await appPage.getByTestId("location-autocomplete-suggestions").waitFor({ state: "visible" });
		await appPage.getByTestId("location-autocomplete-suggestion-0").click();

		// #1375（6 巡目）«お店 → 料理カテゴリー → 写真» の順。カテゴリーが決まるまで先へ進めない
		await myDishesPage.chooseDishCategoryInRecordFlow("コーヒー");
		await myDishesPage.chooseMediaInRecordFlow();

		// 写真は自分で «ライブラリから選ぶ» を押して開く（記録フローは自動で開かない）
		const fileChooserPromise = appPage.waitForEvent("filechooser");
		await appPage.getByTestId("review-pick-from-library").click();
		const fileChooser = await fileChooserPromise;
		await fileChooser.setFiles(TEST_IMAGE_PATH);

		await appPage
			.getByTestId("review-comment-input")
			.fill(`[E2E] 自動テスト投稿 ${new Date().toISOString()}`.slice(0, 100));

		await appPage.getByTestId("review-price-input").fill("500");
		await appPage.getByTestId("review-star-5").click();

		await appPage.getByTestId("review-submit-button").click();
		await expect(appPage.getByText("レビューを投稿しました", { exact: true })).toBeVisible({ timeout: 30_000 });
	});
});
