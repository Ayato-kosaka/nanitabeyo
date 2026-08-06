import { test, expect } from "../../fixtures/test";
import { SearchPage } from "../../pages/SearchPage";
import { TopicsPage } from "../../pages/TopicsPage";
import { GoogleMapsFallbackDialog } from "../../pages/GoogleMapsFallbackDialog";

/**
 * 🗺 Google マップ fallback は別タブで開く（#1121 の回帰テスト）
 *
 * ## 背景 (#1121)
 * `/ja-JP/search/topics` で検索結果が 0 件だったときに出る Google マップ fallback ダイアログの
 * 「Google マップで開く」を Web で押すと、`Linking.openURL()` が **同一タブ**を遷移させていた。
 * SPA から離脱するため、ブラウザバックで戻ってくると復元に失敗して画面が壊れる、というのが
 * 報告された不具合。PR #1151 で `openExternalUrl()` を導入し、Web では
 * `window.open(url, "_blank", "noopener,noreferrer")` で別タブに開くよう修正済み。
 *
 * ## このテストの検証内容
 * 1. 「Google マップで開く」で **新しいタブ**が開き、その URL が Google マップの検索 URL であること
 * 2. **元のページの URL が変わらない**こと（= SPA を離脱していない。主症状の回帰）
 *
 * 修正前は (1) で新しいタブが開かず `waitForEvent("page")` がタイムアウトし、
 * (2) も元タブの URL が www.google.com に変わるため落ちる。
 *
 * ## 実 Google へは通信しない
 * 別タブが開く URL を検証したいだけなので、`https://www.google.com/**` は
 * `context.route()` でスタブ HTML に差し替える。Google Maps へのリクエストは 1 度も出ない。
 *
 * ## 0 件状態の作り方
 * 実 API で確実に 0 件になる検索条件を作るのは不可能なため、0 件判定に使う 2 つの
 * エンドポイントだけ空配列に差し替える（トピック提案までは実 API のまま）。
 * `v1/dishes/bulk-import` も潰すので **dev DB への書き込みは発生しない**（@mutation 不要）。
 */
test.describe("Google マップ fallback (#1121)", () => {
	// トピック生成は実 API（AI）で実測 30 秒近くかかるため、topics-flow.spec.ts と同様に延長する
	test.setTimeout(90_000);

	/** Google マップの検索 URL（app-expo/lib/googleMaps.ts の buildGoogleMapsSearchUrl 準拠） */
	const GOOGLE_MAPS_SEARCH_URL = /^https:\/\/www\.google\.com\/maps\/search\//;

	// ─ テストケース: 「Google マップで開く」は別タブで開き、元ページの URL を変えない ─
	// 手順:
	//   1. 料理メディア検索 / bulk-import を空配列に固定し、結果が必ず 0 件になるようにする
	//   2. www.google.com へのリクエストをスタブ HTML に差し替える（実通信の遮断）
	//   3. 渋谷で検索 → トピック提案 → 先頭のトピックを選択
	//   4. 0 件のため Google マップ fallback ダイアログが表示される
	//   5. 「Google マップで開く」を押す
	//   6. 新しいタブが開き、その URL が Google マップの検索 URL であることを検証
	//   7. 元のページの URL が押下前から変わっていないことを検証（#1121 の主症状）
	test("「Google マップで開く」は新しいタブで開き、元のページの URL は変わらない", async ({ appPage }) => {
		const context = appPage.context();

		// ── 1. 検索結果を必ず 0 件にする ──────────────────────────────
		// バックエンドは別オリジン (Cloud Run) のため、fulfill するレスポンスにも CORS ヘッダが要る。
		// fetchWithAuth は web で `credentials: "include"` を使うので、`*` ではなく
		// リクエスト元 origin をそのまま返し、allow-credentials も付ける必要がある。
		const fulfillEmptyList = async (route: import("@playwright/test").Route): Promise<void> => {
			const origin = (await route.request().headerValue("origin")) ?? "*";
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				headers: {
					"access-control-allow-origin": origin,
					"access-control-allow-credentials": "true",
				},
				body: "[]",
			});
		};
		await context.route("**/v1/dish-media/search*", fulfillEmptyList);
		await context.route("**/v1/dishes/bulk-import*", fulfillEmptyList);

		// ── 2. 実 Google へは通信させない ─────────────────────────────
		// abort だと新しいタブの URL が about:blank のままになりうるので、
		// ナビゲーションが commit されるようスタブ HTML を返す。
		await context.route("https://www.google.com/**", async (route) => {
			await route.fulfill({
				status: 200,
				contentType: "text/html",
				body: "<html><body>stubbed google maps</body></html>",
			});
		});

		// ── 3. 検索 → トピック提案 → トピック選択 ─────────────────────
		const searchPage = new SearchPage(appPage);
		const topicsPage = new TopicsPage(appPage);

		await searchPage.typeLocation("渋谷");
		await searchPage.selectLocationSuggestion(0);
		await searchPage.submitButton.click();
		await topicsPage.expectLoaded();
		await topicsPage.chooseFirstTopic();

		// ── 4. 0 件 fallback ダイアログ ───────────────────────────────
		const fallbackDialog = new GoogleMapsFallbackDialog(appPage);
		await fallbackDialog.expectVisible();

		// ── 5〜6. 押下 → 新しいタブを捕まえる ─────────────────────────
		// 押下**前**の URL を控える。expo-router の静的書き出しではタブグループ内の
		// ネスト遷移で URL が画面と一致しないことがある（TopicsPage のコメント参照）ため、
		// 期待値を決め打ちせず「押す前後で変わらないこと」を見る。
		const urlBeforeClick = appPage.url();

		const [newPage] = await Promise.all([context.waitForEvent("page"), fallbackDialog.confirmButton.click()]);

		// window.open 直後は about:blank のことがあるため、URL の確定を待ってから検証する
		await newPage.waitForURL(GOOGLE_MAPS_SEARCH_URL, { timeout: 15_000 });
		expect(newPage.url()).toMatch(GOOGLE_MAPS_SEARCH_URL);
		// 検索地点の言語（ja）が引き継がれていること（buildGoogleMapsSearchUrl の hl）
		expect(newPage.url()).toContain("hl=ja");

		// ── 7. 元のページは離脱していない（#1121 の主症状） ───────────
		// 修正前はここが www.google.com/... に変わり、戻ると壊れていた。
		expect(appPage.url()).toBe(urlBeforeClick);
		// 元タブがアプリのまま生きていること（別タブ起動なので閉じられていない）
		expect(appPage.isClosed()).toBe(false);
		await expect(topicsPage.headerTitle.last()).toBeVisible();

		await newPage.close();
	});

	// ─ テストケース: 「閉じる」では新しいタブが開かない ─
	// 手順:
	//   1. 上と同じ手順で fallback ダイアログを表示する
	//   2. 「閉じる」を押す
	//   3. ダイアログが閉じ、新しいタブが 1 つも開いていないことを検証
	// 補足: 「押せば必ず新タブが開く」のではなく「確定操作のときだけ開く」ことを担保し、
	//       (1) のテストが偶発的な popup を拾っていないことの裏取りにする。
	test("「閉じる」では新しいタブは開かない", async ({ appPage }) => {
		const context = appPage.context();

		const fulfillEmptyList = async (route: import("@playwright/test").Route): Promise<void> => {
			const origin = (await route.request().headerValue("origin")) ?? "*";
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				headers: {
					"access-control-allow-origin": origin,
					"access-control-allow-credentials": "true",
				},
				body: "[]",
			});
		};
		await context.route("**/v1/dish-media/search*", fulfillEmptyList);
		await context.route("**/v1/dishes/bulk-import*", fulfillEmptyList);

		const openedPages: string[] = [];
		context.on("page", (opened) => openedPages.push(opened.url()));

		const searchPage = new SearchPage(appPage);
		const topicsPage = new TopicsPage(appPage);

		await searchPage.typeLocation("渋谷");
		await searchPage.selectLocationSuggestion(0);
		await searchPage.submitButton.click();
		await topicsPage.expectLoaded();
		await topicsPage.chooseFirstTopic();

		const fallbackDialog = new GoogleMapsFallbackDialog(appPage);
		await fallbackDialog.expectVisible();

		await fallbackDialog.cancelButton.click();

		await expect(fallbackDialog.message).toBeHidden();
		expect(openedPages).toEqual([]);
	});
});
