import { test, expect } from "../../fixtures/test";
import { SearchPage } from "../../pages/SearchPage";
import { TopicsPage } from "../../pages/TopicsPage";
import { TOPICS_TUTORIAL_STORAGE_KEY } from "../../utils/storage";

/**
 * 💡 料理提案画面スポットライトチュートリアル
 *
 * 実UIの座標を計測して初めて表示できる機能なので、静的なコンポーネントテストではなく
 * Expo Web上の実画面で「対象mount → 自動表示 → ページ送り → 手動再表示」を保証する。
 */
test.use({ seedTopicsTutorialSeen: false });

test.describe("料理提案チュートリアル(ja-JP 初回訪問)", () => {
	// 実APIのトピック生成に時間がかかるため、既存topics-flowと同じく長めに確保する。
	test.setTimeout(120_000);

	test("初回だけ自動表示され、完了後も「？」から再表示できる", async ({ appPage }) => {
		const searchPage = new SearchPage(appPage);
		const topicsPage = new TopicsPage(appPage);

		await searchPage.typeLocation("渋谷");
		await searchPage.selectLocationSuggestion(0);
		await searchPage.submitButton.click();
		await topicsPage.expectLoaded();

		// Step 1: 小窓ではなく、スワイプと決定を最初に説明する。
		await topicsPage.expectTutorialStarted();
		await expect(appPage.getByText("気になる料理を選ぼう", { exact: true })).toBeVisible();

		// 自動表示が実際に成立した時点で、次回の自動表示を止めるフラグを保存する。
		await expect
			.poll(() => appPage.evaluate((key) => window.localStorage.getItem(key), TOPICS_TUTORIAL_STORAGE_KEY))
			.toBe("true");

		await topicsPage.tutorialNextButton.click();

		// Step 2: 深掘り候補がある料理だけ表示する。候補なしならStep 3へ直接進む。
		await expect(topicsPage.tutorialDeepDiveStep.or(topicsPage.tutorialActionsStep)).toBeVisible();
		if (await topicsPage.tutorialDeepDiveStep.isVisible()) {
			// #927 【修正】#975 の文言変更(深堀→再検索表現)に追従。旧文言「似た料理をもっと見る」の
			// 決め打ちが残っていたため、このスペックはマージ当初から失敗し続けていた
			await expect(appPage.getByText("気分に合わせて深堀再検索", { exact: true })).toBeVisible();
			await topicsPage.tutorialNextButton.click();
		}

		// Step 3: 保存とブロックをまとめて説明する。
		await expect(topicsPage.tutorialActionsStep).toBeVisible();
		await expect(appPage.getByText("好みに合わせて整理", { exact: true })).toBeVisible();
		await topicsPage.tutorialNextButton.click();

		// Step 4: 発見しにくいグループ投票は必須ステップ。
		await expect(topicsPage.tutorialGroupVoteStep).toBeVisible();
		// #927 【修正】現行文言「友達と決める」(Topics.tutorial.steps.groupVote.title)に追従
		await expect(appPage.getByText("友達と決める", { exact: true })).toBeVisible();
		await topicsPage.tutorialFinishButton.click();
		await expect(topicsPage.tutorialOverlay).toHaveCount(0);

		// 閲覧済みフラグを消さず、「？」から先頭を何度でも見直せる。
		await topicsPage.tutorialHelpButton.click();
		await topicsPage.expectTutorialStarted();
		await topicsPage.tutorialSkipButton.click();
		await expect(topicsPage.tutorialOverlay).toHaveCount(0);
		await expect
			.poll(() => appPage.evaluate((key) => window.localStorage.getItem(key), TOPICS_TUTORIAL_STORAGE_KEY))
			.toBe("true");
	});
});
