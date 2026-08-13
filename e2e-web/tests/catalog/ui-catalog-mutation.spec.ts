import * as path from "node:path";
import { test, expect } from "../../fixtures/test";
import { TabBar } from "../../pages/TabBar";
import { ReviewPage } from "../../pages/ReviewPage";
import { captureScreenIfReachable } from "../../utils/catalog";

/**
 * 📸 UI カタログ（レビュー投稿フロー）@catalog @mutation
 *
 * 実行プロジェクト: ui-catalog-authenticated
 * 実行条件: RUN_CATALOG=1 かつ RUN_MUTATION=1（= `pnpm test:catalog:all`）
 *
 * ## なぜ @mutation なのか（dev DB への影響）
 * 店舗詳細・レビュー投稿フォーム・投稿完了後のレビュー詳細は、
 * **実際に店舗を作成してレビューを投稿しないと到達できない**画面である。
 * - 店舗作成（POST /v1/restaurants）は同一 Place なら upsert のため重複しない
 * - レビュー投稿には削除 UI が無く dev DB に蓄積する（ユーザー承認済み）。
 *   識別できるようコメントには必ず `[E2E]` プレフィックスを付ける
 * 手順は tests/authenticated/review-post.spec.ts と同じ導線をなぞっている
 * （あちらは検証、こちらは収集が目的）。
 */
test.skip(
	() => !process.env.TEST_USER_EMAIL || !process.env.TEST_USER_PASSWORD,
	"TEST_USER_EMAIL / TEST_USER_PASSWORD(e2e-web/.env)が未設定のためスキップ",
);

const TEST_IMAGE_PATH = path.resolve(__dirname, "../../fixtures/assets/test-dish.png");

test.describe("UI カタログ（レビュー投稿フロー） @catalog @mutation", () => {
	// 店舗作成・料理カテゴリ検索など実 API 呼び出しを直列で行ううえ、
	// 画面ごとに撮影の待ちも入るため長めに取る
	test.setTimeout(180_000);

	test("店舗選択 → 店舗詳細 → 投稿フォーム → レビュー詳細", async ({ appPage }) => {
		const tabBar = new TabBar(appPage);
		const reviewPage = new ReviewPage(appPage);

		await tabBar.gotoReview();
		await reviewPage.expectAuthenticatedViewLoaded();
		await appPage.getByTestId("review-post-button").click();
		await expect(appPage.getByTestId("location-autocomplete-input")).toBeVisible();

		// ① 店舗詳細（店舗検索 → サジェスト選択で店舗が作成/upsert される）
		const reachedDetail = await captureScreenIfReachable(
			appPage,
			"review-restaurant-detail",
			async () => {
				await appPage.getByTestId("location-autocomplete-input").fill("スターバックス");
				await appPage.getByTestId("location-autocomplete-suggestions").waitFor({ state: "visible" });
				await appPage.getByTestId("location-autocomplete-suggestion-0").click();
				await expect(appPage.getByTestId("restaurant-detail-post-photo-button")).toBeVisible({ timeout: 30_000 });
			},
			{ settleMs: 3_000 },
		);

		if (!reachedDetail) return;

		// ② レビュー投稿フォーム（遷移と同時にファイル選択が開くため先に待ち受ける）
		const reachedForm = await captureScreenIfReachable(
			appPage,
			"review-post-form",
			async () => {
				const fileChooserPromise = appPage.waitForEvent("filechooser");
				await appPage.getByTestId("restaurant-detail-post-photo-button").click();
				const fileChooser = await fileChooserPromise;
				await fileChooser.setFiles(TEST_IMAGE_PATH);
				await expect(appPage.getByTestId("review-comment-input")).toBeVisible({ timeout: 30_000 });
			},
			{ settleMs: 2_000 },
		);

		if (!reachedForm) return;

		// ③ 入力済みのフォーム → 投稿 → レビュー詳細
		await captureScreenIfReachable(
			appPage,
			"review-post-detail",
			async () => {
				await appPage
					.getByTestId("review-comment-input")
					.fill(`[E2E] UI カタログ収集 ${new Date().toISOString()}`.slice(0, 100));

				await appPage.getByTestId("review-dish-category-row").click();
				await appPage.getByTestId("dish-category-search-input").fill("コーヒー");
				await appPage.getByTestId("dish-category-search-suggestions").waitFor({ state: "visible" });
				await appPage.getByTestId("dish-category-search-suggestion-0").click();

				await appPage.getByTestId("review-price-input").fill("500");
				await appPage.getByTestId("review-star-5").click();
				await appPage.getByTestId("review-submit-button").click();

				// 投稿成功後は /review/post/[id] へ遷移する
				await appPage.waitForURL(/\/review\/post\//, { timeout: 60_000 });
			},
			{ settleMs: 4_000 },
		);
	});
});
