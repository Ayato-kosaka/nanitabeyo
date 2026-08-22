import { test, expect } from "../../fixtures/test";
import { SearchPage } from "../../pages/SearchPage";
import { TopicsPage } from "../../pages/TopicsPage";
import { ResultPage } from "../../pages/ResultPage";

/**
 * #1484 納品動画撮影用の一時テスト（マージしない）。
 * 「この料理にする！」押下 → カードがその場からフルスクリーンへ広がる → 店舗提案画面へ遷移、
 * という一連のアニメーションを録画するためだけに存在する。
 */
test("この料理にする！を押すと、カードがその場からフルスクリーンへ広がって店舗提案へ遷移する", async ({ page }) => {
	const searchPage = new SearchPage(page);
	const topicsPage = new TopicsPage(page);
	const resultPage = new ResultPage(page);

	await page.goto("/");
	await searchPage.typeLocation("渋谷");
	await searchPage.selectLocationSuggestion(0);
	await searchPage.submitButton.click();

	await topicsPage.expectLoaded();
	await page.waitForTimeout(1500);

	await topicsPage.chooseFirstTopic();

	await resultPage.expectLoaded();
	await page.waitForTimeout(2500);

	await expect(resultPage.closeButton).toBeVisible();
});
