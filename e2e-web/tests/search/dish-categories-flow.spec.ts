import { test, expect } from "../../fixtures/test";
import { SearchPage } from "../../pages/SearchPage";
import { DishCategoriesPage } from "../../pages/DishCategoriesPage";
import { ResultPage } from "../../pages/ResultPage";

/**
 * 🍜 検索 → トピック提案 → 結果フィードのハッピーパステスト(実 API・最重要)
 *
 * 目的: アプリの中核体験である「条件を入れて検索 → AI のトピック提案 → 料理フィード閲覧」
 *       の一連のフローが実データで成立することを保証する。
 * 前提: 実 API 依存(CORS 設定済み)。トピック生成はレスポンスに時間がかかるため
 *       タイムアウトを長めに設定すること。
 */

/**
 * トピック選択 → 結果フィード表示。**Places クォータ枯渇の日はここで skip する。**
 *
 * 結果フィードの取得（`POST /v1/dishes/bulk-import`）はサーバ側で Google Places Text Search を
 * 叩く。このプロジェクトの SearchText クォータは **45 リクエスト/日で、引き上げない方針**
 * （オーナー判断 2026-08-22: E2E のために課金を発生させない）。枯渇した日はテストの検証対象
 * （UI とフロー）と無関係な 500 になるため、その失敗モード**だけ**を検知して skip する。
 * それ以外の失敗（画面が出ない・遷移しない等）は通常どおり fail させる。
 */
async function chooseDishCategoryOrSkipOnQuota(
	appPage: import("@playwright/test").Page,
	dishCategoriesPage: DishCategoriesPage,
	resultPage: ResultPage,
): Promise<void> {
	const serverErrors: number[] = [];
	const onResponse = (response: import("@playwright/test").Response) => {
		if (response.url().includes("/v1/dishes/bulk-import") && response.status() >= 500) {
			serverErrors.push(response.status());
		}
	};
	appPage.on("response", onResponse);
	try {
		await dishCategoriesPage.chooseFirstDishCategory();
		await resultPage.expectLoaded();
	} catch (error) {
		if (serverErrors.length > 0) {
			test.skip(
				true,
				`Places SearchText クォータ枯渇（bulk-import が ${serverErrors[0]}）。45/日・引き上げない方針のため skip`,
			);
		}
		throw error;
	} finally {
		appPage.off("response", onResponse);
	}
}

test.describe("検索フロー(実 API)", () => {
	// AI によるトピック生成に時間がかかる(実測 30 秒近くかかることがある)ため、
	// 既定の 30 秒テストタイムアウトでは各ステップの内部 expect(30s) と合算して超過しうる。
	// この describe 全体のテストタイムアウトを 90 秒に延長する。
	test.setTimeout(90_000);

	// ─ テストケース: 検索実行でトピック提案カードが表示される ─
	// 手順:
	//   1. appPage で起動
	//   2. 場所に「渋谷」を入力しサジェスト先頭を選択(location 確定)
	//      (時間帯・シーンには初期値があるため追加選択は不要)
	//   3. 検索ボタン(search-submit-button)をクリック
	//   4. /search/dish-categories へ遷移し、トピックカードが 1 枚以上表示されることを検証
	test("検索実行でトピック提案カードが表示される", async ({ appPage }) => {
		const searchPage = new SearchPage(appPage);
		const dishCategoriesPage = new DishCategoriesPage(appPage);

		await searchPage.typeLocation("渋谷");
		await searchPage.selectLocationSuggestion(0);
		await searchPage.submitButton.click();

		await dishCategoriesPage.expectLoaded();
	});

	// ─ テストケース: トピック選択で結果フィードが表示される ─
	// 手順:
	//   1. 上記フローでトピックカードを表示する
	//   2. 先頭のカードの「この料理にする！」ボタンをタップする
	//   3. 結果フィード画面(result-close-button)が表示されることを検証
	test("トピック選択で結果フィードが表示される", async ({ appPage }) => {
		const searchPage = new SearchPage(appPage);
		const dishCategoriesPage = new DishCategoriesPage(appPage);
		const resultPage = new ResultPage(appPage);

		await searchPage.typeLocation("渋谷");
		await searchPage.selectLocationSuggestion(0);
		await searchPage.submitButton.click();
		await dishCategoriesPage.expectLoaded();

		await chooseDishCategoryOrSkipOnQuota(appPage, dishCategoriesPage, resultPage);
	});

	// ─ テストケース: 結果画面のクローズでトピック画面に戻る ─
	// 手順:
	//   1. 結果フィードを表示する
	//   2. クローズボタン(result-close-button)をクリック
	//   3. トピック画面へ戻ることを検証
	// 補足: クローズ処理(useSearchResult.handleClose)は router.back() を呼ぶ実装であり、
	//       ナビゲーション履歴は 検索 → トピック → 結果 と積まれているため、
	//       1 回の close で戻る先は検索画面ではなく直前のトピック画面になる
	test("結果画面のクローズでトピック画面に戻る", async ({ appPage }) => {
		const searchPage = new SearchPage(appPage);
		const dishCategoriesPage = new DishCategoriesPage(appPage);
		const resultPage = new ResultPage(appPage);

		await searchPage.typeLocation("渋谷");
		await searchPage.selectLocationSuggestion(0);
		await searchPage.submitButton.click();
		await dishCategoriesPage.expectLoaded();
		await chooseDishCategoryOrSkipOnQuota(appPage, dishCategoriesPage, resultPage);

		await resultPage.close();
		await dishCategoriesPage.expectLoaded();
	});
});
