import { test, expect } from "../../fixtures/test";
import { SearchPage } from "../../pages/SearchPage";
import { DishCategoriesPage } from "../../pages/DishCategoriesPage";
import { stubDishCategoryRecommendationsFailure } from "../../utils/network";
import { clickRapid } from "../../utils/rapid-click";

/**
 * 🔁 REL-03 (#1499): DishCategories 取得失敗時の「その場で再試行」
 *
 * ## 背景
 * 監査 #1042 の REL-03。料理提案(DishCategories)の取得が失敗したとき、以前は「戻る」しか
 * 手段が無く、通信が一瞬切れただけでも検索の起点までユーザーを押し戻していた。
 * `DishCategoriesError`(app-expo/features/dishCategories/components/DishCategoriesError.tsx) に
 * 再試行ボタンを追加し、同じ検索条件で `useDishCategorySearch.searchDishCategories` を再実行する
 * (app-expo/app/[locale]/(tabs)/search/dish-categories.tsx の `handleRetryDishCategories`)。
 *
 * ## API のモック方法
 * `v1/dish-categories/recommendations`(GET) を `context.route` で常に 500 に固定する
 * ({@link stubDishCategoryRecommendationsFailure})。500 は
 * `app-expo/hooks/useAPICall.ts` の自動リトライ対象(401/503/ネットワーク到達不能)に
 * 含まれないため、1 クリックにつき 1 リクエストで確定し、リクエスト数のアサートが安定する
 * (`route.abort()` を使わない理由は同ファイル内の `countRequests` の JSDoc を参照)。
 * ルートは spec の間ずっと生きているため、再試行ボタンを押しても同じ 500 が返り続け、
 * 「再試行してもまた失敗する」ケースをそのまま固定できる。
 */
test.describe("DishCategories 取得失敗時の再試行(#1499)", () => {
	// トピック生成は実 API で数十秒かかることがあるが、本 spec は 500 で即時応答するため
	// 通常のテストタイムアウトで十分。他の dishCategories 系 spec との足並みだけ揃えておく。
	test.setTimeout(60_000);

	// ─ テストケース: 失敗時に再試行ボタンが表示され、押すと同じ条件で再取得が走る ─
	// 手順:
	//   1. v1/dish-categories/recommendations を 500 に固定する
	//   2. 検索を実行し、DishCategories 画面がエラー表示になることを検証する(1 リクエスト目)
	//   3. 再試行ボタンを押し、同じエンドポイントへ 2 回目のリクエストが飛ぶことを検証する
	//      (= 「同じ検索条件で再取得が走る」ことの観測点)
	//   4. 再試行も 500 で失敗するため、再びエラー表示になり、かつ再試行ボタンが
	//      押し直せる状態(非活性のまま固まらない)であることを検証する
	//      = 「無言で元のエラーへ戻る」のではなく状態が読めることの確認
	test("失敗時に再試行ボタンが表示され、押すと同じ条件で再取得が走る", async ({ appPage }) => {
		const counter = await stubDishCategoryRecommendationsFailure(appPage.context());
		const searchPage = new SearchPage(appPage);
		const dishCategoriesPage = new DishCategoriesPage(appPage);

		await searchPage.typeLocation("渋谷");
		await searchPage.selectLocationSuggestion(0);
		await searchPage.submitButton.click();

		await dishCategoriesPage.expectErrorState();
		expect(counter.count(), "初回取得でレコメンド API が呼ばれていない").toBe(1);

		await dishCategoriesPage.retry();

		await expect.poll(() => counter.count(), { timeout: 10_000 }).toBe(2);

		// 再試行も同じ 500 で失敗するが、エラーカードは引き続き見え、ボタンも再び押せる状態に戻る
		await dishCategoriesPage.expectErrorState();

		await counter.stop();
	});

	// ─ テストケース: 再試行ボタンを連打しても二重発火しない ─
	// 手順:
	//   1. v1/dish-categories/recommendations を 500 に固定する
	//   2. 検索を実行してエラー画面を出す(1 リクエスト目)
	//   3. 再試行ボタンを「待機を挟まず」5 連打する(clickRapid。search-double-tap.spec.ts と同じ手法。
	//      `locator.click()` のループでは actionability チェックのたびに待機が挟まり
	//      連打の再現にならないため使わない)
	//   4. エラー画面へ戻ることを確認したうえで、レコメンド API が **1 回だけ**(合計 2 回)しか
	//      追加で呼ばれていないことを検証する
	//      = dishCategories.tsx の `isRetryingDishCategoriesRef`(state 反映を待たない同期ガード)が効いている証拠
	test("再試行ボタンを連打しても二重発火しない", async ({ appPage }) => {
		const counter = await stubDishCategoryRecommendationsFailure(appPage.context());
		const searchPage = new SearchPage(appPage);
		const dishCategoriesPage = new DishCategoriesPage(appPage);

		await searchPage.typeLocation("渋谷");
		await searchPage.selectLocationSuggestion(0);
		await searchPage.submitButton.click();
		await dishCategoriesPage.expectErrorState();
		expect(counter.count()).toBe(1);

		await clickRapid(dishCategoriesPage.errorRetryButton, 5);

		// 連打分の再取得が終わり、エラー画面(=非ローディング)に戻るまで待つ
		await dishCategoriesPage.expectErrorState();

		expect(counter.count(), "連打でレコメンド API が二重に呼ばれている").toBe(2);

		await counter.stop();
	});

	// ─ テストケース: 再試行中は再試行ボタンが非活性になる ─
	// 手順:
	//   1. v1/dish-categories/recommendations を 500(遅延付き)に固定する
	//   2. 検索を実行してエラー画面を出す(1 リクエスト目)
	//   3. 再試行ボタンを押す。レスポンスが遅延で返ってこない間に、ボタンが disabled に
	//      なっていることを検証する(dishCategories.tsx の isRetryingDishCategories → DishCategoriesError の
	//      isRetrying prop が反映されている証拠。上の連打テストは「二重発火しない」ことの
	//      証拠だが、ボタン自体が押せない見た目になっているかは別に見る必要がある)
	//   4. 遅延分のレスポンスが返り、エラー画面(かつ再度押せる状態)に戻ることを確認する
	test("再試行中は再試行ボタンが非活性になる", async ({ appPage }) => {
		const counter = await stubDishCategoryRecommendationsFailure(appPage.context(), { delayMs: 500 });
		const searchPage = new SearchPage(appPage);
		const dishCategoriesPage = new DishCategoriesPage(appPage);

		await searchPage.typeLocation("渋谷");
		await searchPage.selectLocationSuggestion(0);
		await searchPage.submitButton.click();
		await dishCategoriesPage.expectErrorState();
		expect(counter.count()).toBe(1);

		await dishCategoriesPage.retry();

		await expect(dishCategoriesPage.errorRetryButton).toBeDisabled();

		await dishCategoriesPage.expectErrorState();
		expect(counter.count()).toBe(2);

		await counter.stop();
	});
});
