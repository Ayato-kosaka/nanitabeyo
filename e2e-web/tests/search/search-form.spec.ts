import { test, expect } from "../../fixtures/test";
import { SearchPage } from "../../pages/SearchPage";

/**
 * 📝 検索フォームのロジックテスト(API 不要)
 *
 * 目的: 検索フォームの必須項目制御・選択状態のトグル・詳細条件の展開という
 *       クライアント内で完結するロジックを保証する。
 * 前提: 実 API を呼ばないため CORS 設定に依存せず green になる。
 */
test.describe("検索フォーム", () => {
	// ─ テストケース: 場所が未確定のまま検索ボタンを押しても遷移しない ─
	// 手順:
	//   1. appPage で起動(検索画面)。search-submit-button(PrimaryButton)は
	//      disabled 時、コンポーネント内部の handlePress が onPress 呼び出し自体を
	//      ガードする実装になっている(disabled/aria-disabled は DOM に反映されないため
	//      Playwright の toBeDisabled() では検証できず、handleSearch 内の
	//      「検索場所を選択してください」スナックバー分岐も実質到達不能)。
	//      そのため「非活性の結果、押しても何も起きない」ことを振る舞いで検証する
	//   2. 場所を明示的に未入力の状態で検索ボタンをクリックする
	//   3. トピック画面へ遷移しておらず、検索画面のヘッダが表示され続けることを検証
	test("場所が未確定のまま検索ボタンを押しても遷移しない", async ({ appPage }) => {
		const searchPage = new SearchPage(appPage);

		// 自動位置取得が先に完了している場合に備え、明示的にクリアしてから検証する
		if (await searchPage.locationClearButton.isVisible()) {
			await searchPage.locationClearButton.click();
		}

		await searchPage.submitButton.click();
		await appPage.waitForTimeout(500);
		await expect(appPage).not.toHaveURL(/\/search\/topics/);
		await searchPage.expectLoaded();
	});

	// ─ テストケース: 時間帯・シーングリッドの選択状態がトグルされる ─
	// 手順:
	//   1. appPage で起動
	//   2. search-time-slot-{id} をクリック → 選択枠線(borderColor: #000000)が
	//      付与される(styles.selectedGridItem)ことを検証
	//   3. search-scene-{id} をクリック → 同様に選択枠線が付与されることを検証
	test("時間帯・シーンの選択がトグルされる", async ({ appPage }) => {
		const searchPage = new SearchPage(appPage);

		await searchPage.timeSlot("dinner").click();
		await expect(searchPage.timeSlot("dinner")).toHaveCSS("border-color", "rgb(0, 0, 0)");

		await searchPage.scene("friends").click();
		await expect(searchPage.scene("friends")).toHaveCSS("border-color", "rgb(0, 0, 0)");
	});

	// ─ テストケース: 詳細条件トグルで距離スライダー・フードスタイルが出現する ─
	// 手順:
	//   1. appPage で起動
	//   2. search-advanced-toggle をクリック
	//   3. 「距離は？」セクションと「どんな系統が食べたい？」セクションが表示されることを検証
	test("詳細条件トグルで追加セクションが出現する", async ({ appPage }) => {
		const searchPage = new SearchPage(appPage);

		await expect(appPage.getByText("距離は？")).not.toBeVisible();
		await searchPage.advancedToggle.click();
		await expect(appPage.getByText("距離は？")).toBeVisible();
		await expect(appPage.getByText("どんな系統が食べたい？")).toBeVisible();
	});

	// ─ テストケース: 距離に適した移動手段だけをおすすめ順で表示する ─
	// #987 【仕様】近距離の車・電車は既定表示せず、国交省資料の距離帯を満たす手段を
	// 一般化所要時間の短い順で表示する。おすすめ外は「もっと見る」でだけ確認できる。
	test("距離に応じて移動時間のおすすめ表示が切り替わる", async ({ appPage }) => {
		const searchPage = new SearchPage(appPage);
		const recommended = searchPage.distanceRecommendedEstimates.locator(
			'[data-testid^="search-distance-estimate-"]',
		);

		await searchPage.advancedToggle.click();

		// デフォルト500m: 自転車6分、徒歩7分の順
		await expect(recommended).toHaveCount(2);
		await expect(recommended.nth(0)).toHaveAttribute("data-testid", "search-distance-estimate-bike");
		await expect(recommended.nth(1)).toHaveAttribute("data-testid", "search-distance-estimate-walk");
		await expect(searchPage.distanceEstimate("bike")).toContainText("6");
		await expect(searchPage.distanceEstimate("walk")).toContainText("7");
		await expect(searchPage.distanceEstimate("car")).not.toBeVisible();
		await expect(searchPage.distanceEstimate("train")).not.toBeVisible();

		// おすすめ外は明示操作した場合だけ表示
		await searchPage.distanceEstimatesToggle.click();
		await expect(searchPage.distanceEstimate("car")).toContainText("9");
		await expect(searchPage.distanceEstimate("train")).toContainText("18");
		await searchPage.distanceEstimatesToggle.click();
		await expect(searchPage.distanceEstimate("car")).not.toBeVisible();
		await expect(searchPage.distanceEstimate("train")).not.toBeVisible();

		await searchPage.distanceSlider.focus();

		// 3km: 4km以上という根拠を満たさないため車はまだ既定表示しない
		for (let step = 0; step < 4; step += 1) {
			await searchPage.distanceSlider.press("ArrowRight");
		}
		await expect(recommended).toHaveCount(1);
		await expect(recommended.nth(0)).toHaveAttribute("data-testid", "search-distance-estimate-bike");
		await expect(searchPage.distanceEstimate("bike")).toContainText("16");
		await expect(searchPage.distanceEstimate("car")).not.toBeVisible();

		// 5km: 自転車24分、車25分の順
		await searchPage.distanceSlider.press("ArrowRight");
		await expect(recommended).toHaveCount(2);
		await expect(recommended.nth(0)).toHaveAttribute("data-testid", "search-distance-estimate-bike");
		await expect(recommended.nth(1)).toHaveAttribute("data-testid", "search-distance-estimate-car");
		await expect(searchPage.distanceEstimate("bike")).toContainText("24");
		await expect(searchPage.distanceEstimate("car")).toContainText("25");

		// 10km: 電車36分、車42分の順
		await searchPage.distanceSlider.press("ArrowRight");
		await expect(recommended).toHaveCount(2);
		await expect(recommended.nth(0)).toHaveAttribute("data-testid", "search-distance-estimate-train");
		await expect(recommended.nth(1)).toHaveAttribute("data-testid", "search-distance-estimate-car");
		await expect(searchPage.distanceEstimate("train")).toContainText("36");
		await expect(searchPage.distanceEstimate("car")).toContainText("42");
		await expect(searchPage.distanceEstimate("bike")).not.toBeVisible();
		await expect(searchPage.distanceEstimate("walk")).not.toBeVisible();
	});
});
