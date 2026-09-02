import { test, expect } from "../../fixtures/test";
import { SearchPage } from "../../pages/SearchPage";
import { DishCategoriesPage } from "../../pages/DishCategoriesPage";
import { DISH_CATEGORIES_TUTORIAL_STORAGE_KEY } from "../../utils/storage";

/**
 * 💡 料理提案画面スポットライトチュートリアル
 *
 * 実UIの座標を計測して初めて表示できる機能なので、静的なコンポーネントテストではなく
 * Expo Web上の実画面で「対象mount → 自動表示 → ページ送り → 手動再表示」を保証する。
 */
test.use({ seedDishCategoriesTutorialSeen: false });

test.describe("料理提案チュートリアル(ja-JP 初回訪問)", () => {
	// 実APIのトピック生成に時間がかかるため、既存dish-categories-flowと同じく長めに確保する。
	test.setTimeout(120_000);

	test("初回だけ自動表示され、完了後も「？」から再表示できる", async ({ appPage }) => {
		const searchPage = new SearchPage(appPage);
		const dishCategoriesPage = new DishCategoriesPage(appPage);

		await searchPage.typeLocation("渋谷");
		await searchPage.selectLocationSuggestion(0);
		await searchPage.submitButton.click();
		await dishCategoriesPage.expectLoaded();

		// Step 1: 小窓ではなく、スワイプと決定を最初に説明する。
		await dishCategoriesPage.expectTutorialStarted();
		await expect(appPage.getByText("気になる料理を選ぼう", { exact: true })).toBeVisible();

		// 自動表示が実際に成立した時点で、次回の自動表示を止めるフラグを保存する。
		await expect
			.poll(() => appPage.evaluate((key) => window.localStorage.getItem(key), DISH_CATEGORIES_TUTORIAL_STORAGE_KEY))
			.toBe("true");

		await dishCategoriesPage.tutorialNextButton.click();

		// Step 2: 深掘り候補がある料理だけ表示する。候補なしならStep 3へ直接進む。
		await expect(dishCategoriesPage.tutorialDeepDiveStep.or(dishCategoriesPage.tutorialActionsStep)).toBeVisible();
		if (await dishCategoriesPage.tutorialDeepDiveStep.isVisible()) {
			// #927 【修正】#975 の文言変更(深堀→再検索表現)に追従。旧文言「似た料理をもっと見る」の
			// 決め打ちが残っていたため、このスペックはマージ当初から失敗し続けていた
			await expect(appPage.getByText("気分に合わせて深堀再検索", { exact: true })).toBeVisible();
			await dishCategoriesPage.tutorialNextButton.click();
		}

		// Step 3: 保存とブロックをまとめて説明する。
		await expect(dishCategoriesPage.tutorialActionsStep).toBeVisible();
		await expect(appPage.getByText("好みに合わせて整理", { exact: true })).toBeVisible();
		await dishCategoriesPage.tutorialNextButton.click();

		// Step 4: 発見しにくいグループ投票は必須ステップ。
		await expect(dishCategoriesPage.tutorialGroupVoteStep).toBeVisible();
		// #927 【修正】現行文言「友達と決める」(DishCategories.tutorial.steps.groupVote.title)に追従
		await expect(appPage.getByText("友達と決める", { exact: true })).toBeVisible();
		await dishCategoriesPage.tutorialFinishButton.click();
		await expect(dishCategoriesPage.tutorialOverlay).toHaveCount(0);

		// 閲覧済みフラグを消さず、「？」から先頭を何度でも見直せる。
		await dishCategoriesPage.tutorialHelpButton.click();
		await dishCategoriesPage.expectTutorialStarted();
		await dishCategoriesPage.tutorialSkipButton.click();
		await expect(dishCategoriesPage.tutorialOverlay).toHaveCount(0);
		await expect
			.poll(() => appPage.evaluate((key) => window.localStorage.getItem(key), DISH_CATEGORIES_TUTORIAL_STORAGE_KEY))
			.toBe("true");
	});
});
