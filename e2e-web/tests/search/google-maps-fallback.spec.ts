import { test, expect } from "../../fixtures/test";
import { SearchPage } from "../../pages/SearchPage";
import { DishCategoriesPage } from "../../pages/DishCategoriesPage";
import { GoogleMapsFallbackDialog } from "../../pages/GoogleMapsFallbackDialog";
import { stubEmptyDishMediaResults, stubGoogleMaps } from "../../utils/network";

/**
 * 🗺 Google マップ fallback は別タブで開く（#1121 の回帰テスト）
 *
 * ## 背景 (#1121)
 * `/ja-JP/search/dish-categories` で検索結果が 0 件だったときに出る Google マップ fallback ダイアログの
 * 「Google マップで開く」を Web で押すと、`Linking.openURL()` が **同一タブ**を遷移させていた。
 * SPA から離脱するため、ブラウザバックで戻ってくると復元に失敗して壊れる、というのが報告された不具合。
 * PR #1151 で `app-expo/lib/openExternalUrl.ts` を導入し、Web では
 * `window.open(url, "_blank", "noopener,noreferrer")` で別タブに開くよう修正済み。
 *
 * ## このテストの検証内容
 * 1. 「Google マップで開く」で **新しいタブ**が開き、その URL が Google マップの検索 URL であること
 * 2. **元のページの URL が変わらない**こと（= SPA を離脱していない。#1121 の主症状）
 *
 * 修正前は (1) で新しいタブが開かず `waitForEvent("page")` がタイムアウトし、
 * (2) も元タブの URL が www.google.com へ変わるため落ちる。
 *
 * ## 外部への実通信はしない
 * 検証したいのは「別タブが開いたこと」と「その URL」だけなので、Google へのリクエストは
 * `stubGoogleMaps()` でスタブ HTML に差し替える。実 Google Maps へは 1 度も飛ばない。
 *
 * ## 0 件状態の作り方
 * `stubEmptyDishMediaResults()` で dish-media 検索 / bulk-import だけを空配列に固定する
 * （トピック提案までは実 API のまま。dev DB への書き込みも発生しないので `@mutation` は不要）。
 */
test.describe("Google マップ fallback (#1121)", () => {
	// トピック生成は実 API（AI）で実測 30 秒近くかかるため、dish-categories-flow.spec.ts と同様に延長する
	test.setTimeout(90_000);

	/** Google マップの検索 URL（app-expo/lib/googleMaps.ts の buildGoogleMapsSearchUrl 準拠） */
	const GOOGLE_MAPS_SEARCH_URL = /^https:\/\/www\.google\.com\/maps\/search\//;

	// ─ テストケース: 「Google マップで開く」は別タブで開き、元ページの URL を変えない ─
	// 手順:
	//   1. 検索結果が必ず 0 件になるようスタブし、Google への実通信も遮断する
	//   2. 渋谷で検索 → トピック提案 → 先頭のトピックを選択
	//   3. 0 件のため Google マップ fallback ダイアログが表示される
	//   4. 「Google マップで開く」を押し、新しいタブ (page イベント) を捕まえる
	//   5. 新しいタブの URL が Google マップの検索 URL であることを検証
	//   6. 元のページの URL が押下前から変わっていないことを検証（#1121 の主症状）
	//   7. 開いたタブがちょうど 1 枚であることを検証（同一タブ遷移でも二重起動でもない）
	test("「Google マップで開く」は新しいタブで開き、元のページの URL は変わらない", async ({ appPage }) => {
		const context = appPage.context();

		await stubEmptyDishMediaResults(context);
		await stubGoogleMaps(context);

		// 「押したときだけ 1 枚開く」ことを見るため、テスト全体で開いたタブを数える
		const openedPages: unknown[] = [];
		context.on("page", (opened) => openedPages.push(opened));

		const searchPage = new SearchPage(appPage);
		const dishCategoriesPage = new DishCategoriesPage(appPage);

		await searchPage.typeLocation("渋谷");
		await searchPage.selectLocationSuggestion(0);
		await searchPage.submitButton.click();
		await dishCategoriesPage.expectLoaded();
		await dishCategoriesPage.chooseFirstDishCategory();

		// 0 件確定で fallback ダイアログが出る。#828 の実装は同時に result 画面を閉じるため、
		// このときの背後の画面はトピック画面に戻っている
		const fallbackDialog = new GoogleMapsFallbackDialog(appPage);
		await fallbackDialog.expectVisible();

		// 押下**前**の URL を控える。expo-router の静的書き出しではタブグループ内のネスト遷移で
		// URL バーが表示内容と一致しないことがある（DishCategoriesPage のコメント参照）ため、
		// 期待値を決め打ちせず「押す前後で変わらないこと」で判定する
		const urlBeforeClick = appPage.url();

		const [newPage] = await Promise.all([context.waitForEvent("page"), fallbackDialog.confirmButton.click()]);

		// window.open 直後は about:blank のことがあるため、URL が確定するまで待ってから検証する
		await newPage.waitForURL(GOOGLE_MAPS_SEARCH_URL, { timeout: 15_000 });
		expect(newPage.url()).toMatch(GOOGLE_MAPS_SEARCH_URL);
		// 検索地点の言語 (ja) が Google マップ側にも引き継がれていること（buildGoogleMapsSearchUrl の hl）
		expect(newPage.url()).toContain("hl=ja");

		// ここが #1121 の主症状。修正前は元タブが www.google.com/... へ遷移し、戻ると壊れていた
		expect(appPage.url()).toBe(urlBeforeClick);
		// 元タブがアプリを表示したまま生きていること（別タブ起動なので離脱していない）
		await expect(dishCategoriesPage.headerTitle.last()).toBeVisible();

		expect(openedPages).toHaveLength(1);

		await newPage.close();
	});
});
