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
});
