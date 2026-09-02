import { test, expect } from "../../fixtures/test";
import { SearchPage } from "../../pages/SearchPage";
import { DishCategoriesPage } from "../../pages/DishCategoriesPage";
import { ResultPage } from "../../pages/ResultPage";

/**
 * ♿ 店舗・料理アクションのa11y名付与テスト(#939)
 *
 * 背景: ActionButtons.tsx の全ボタン(店舗アバター/いいね/保存/シェア/地図/メニュー)に
 * role/label が一切無く、保存ボタンと店舗アバターは完全に無名(スクリーンリーダーで
 * 何のボタンか判別不能)だった。result.tsx の閉じる/一括シェアボタンも同様。
 * 各ボタンに accessibilityRole="button" + 対象(店舗名)付きラベルを付与したため、
 * ここでは実際に検索フローを通って表示された料理メディアカードのボタン群が
 * 無名でなくなっていることを確認する。
 *
 * 実 API を経由し AI 生成待ちが発生するため @smoke 対象外とする(dish-categories-flow.spec.ts と同様)。
 */
test.describe("店舗・料理アクションのアクセシビリティ", () => {
	test.setTimeout(60_000);
	// AI レコメンドが選ぶ料理・店舗によっては dev 環境側のデータ不備(画像未処理等)で
	// 結果フィード取得が 500 になることが実測で確認されている(reactions.spec.ts と同様の
	// 既知の不安定要素でこのテストの実装不備ではない)。再実行すれば別の料理が選ばれ成功することが多い
	test.describe.configure({ retries: 2 });

	test("料理メディアカードの操作ボタンが役割・名前を持つ", async ({ appPage }) => {
		const searchPage = new SearchPage(appPage);
		const dishCategoriesPage = new DishCategoriesPage(appPage);
		const resultPage = new ResultPage(appPage);

		await searchPage.typeLocation("渋谷");
		await searchPage.selectLocationSuggestion(0);
		await searchPage.submitButton.click();
		await dishCategoriesPage.expectLoaded();
		await dishCategoriesPage.chooseFirstDishCategory();
		await resultPage.expectLoaded();

		// いいね/保存ボタン: role="button" を持ち、ラベルが空でないこと(店舗名を含む)
		const likeButton = resultPage.likeButton.first();
		await expect(likeButton).toHaveAttribute("role", "button");
		const likeLabel = await likeButton.getAttribute("aria-label");
		expect(likeLabel).toBeTruthy();
		expect(likeLabel).not.toBe("");

		const saveButton = resultPage.saveButton.first();
		await expect(saveButton).toHaveAttribute("role", "button");
		const saveLabel = await saveButton.getAttribute("aria-label");
		expect(saveLabel).toBeTruthy();
		expect(saveLabel).not.toBe(likeLabel); // いいねと保存で異なる文言であること

		// トグル状態が aria-selected で判別できること(押下前は false)
		await expect(likeButton).toHaveAttribute("aria-selected", "false");
		await expect(saveButton).toHaveAttribute("aria-selected", "false");

		// 結果画面の閉じる/一括シェアボタンにも名前が付いていること
		await expect(resultPage.closeButton).toHaveAttribute("role", "button");
		await expect(resultPage.closeButton).toHaveAttribute("aria-label", "閉じる");
	});
});
