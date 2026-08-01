import { test, expect } from "../../fixtures/test";
import { SearchPage } from "../../pages/SearchPage";
import { TopicsPage } from "../../pages/TopicsPage";
import { ResultPage } from "../../pages/ResultPage";

/**
 * 🍜 検索 → トピック提案 → 結果フィードのハッピーパステスト(実 API・最重要)
 *
 * 目的: アプリの中核体験である「条件を入れて検索 → AI のトピック提案 → 料理フィード閲覧」
 *       の一連のフローが実データで成立することを保証する。
 * 前提: 実 API 依存(CORS 設定済み)。トピック生成はレスポンスに時間がかかるため
 *       タイムアウトを長めに設定すること。
 */
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
	//   4. /search/topics へ遷移し、トピックカードが 1 枚以上表示されることを検証
	test("検索実行でトピック提案カードが表示される", async ({ appPage }) => {
		const searchPage = new SearchPage(appPage);
		const topicsPage = new TopicsPage(appPage);

		await searchPage.typeLocation("渋谷");
		await searchPage.selectLocationSuggestion(0);
		await searchPage.submitButton.click();

		await topicsPage.expectLoaded();
	});

	// ─ テストケース: トピック選択で結果フィードが表示される ─
	// 手順:
	//   1. 上記フローでトピックカードを表示する
	//   2. 先頭のカードの「この料理にする！」ボタンをタップする
	//   3. 結果フィード画面(result-close-button)が表示されることを検証
	test("トピック選択で結果フィードが表示される", async ({ appPage }) => {
		const searchPage = new SearchPage(appPage);
		const topicsPage = new TopicsPage(appPage);
		const resultPage = new ResultPage(appPage);

		await searchPage.typeLocation("渋谷");
		await searchPage.selectLocationSuggestion(0);
		await searchPage.submitButton.click();
		await topicsPage.expectLoaded();

		await topicsPage.chooseFirstTopic();
		await resultPage.expectLoaded();
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
		const topicsPage = new TopicsPage(appPage);
		const resultPage = new ResultPage(appPage);

		await searchPage.typeLocation("渋谷");
		await searchPage.selectLocationSuggestion(0);
		await searchPage.submitButton.click();
		await topicsPage.expectLoaded();
		await topicsPage.chooseFirstTopic();
		await resultPage.expectLoaded();

		await resultPage.close();
		await topicsPage.expectLoaded();
	});
});
