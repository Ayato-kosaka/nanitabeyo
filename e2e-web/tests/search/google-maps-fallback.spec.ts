import { test, expect } from "../../fixtures/test";
import { SearchPage } from "../../pages/SearchPage";
import { DishCategoriesPage } from "../../pages/DishCategoriesPage";
import { GoogleMapsFallbackDialog } from "../../pages/GoogleMapsFallbackDialog";
import { stubEmptyDishMediaResults, stubGoogleMaps, stubMapsEmbedTokenUnavailable } from "../../utils/network";

/**
 * 🗺 検索 0 件の退避導線（#1121 の回帰テスト / #843 #1810 で行き先が変わった）
 *
 * ## 背景 (#1121)
 * `/ja-JP/search/dish-categories` で検索結果が 0 件だったときの退避ダイアログの
 * 「Google マップで開く」を Web で押すと、`Linking.openURL()` が **同一タブ**を遷移させていた。
 * SPA から離脱するため、ブラウザバックで戻ると復元に失敗して壊れる、というのが報告された不具合。
 *
 * ## ⚠️ 2026-09-05: 行き先が «別タブの Google マップ» から «アプリ内地図» へ変わった
 *
 * #1810（#843 の①②）で退避先をアプリ内地図にした。`useMapsEmbedModal` は
 * `POST /v1/maps/embed-token` が **成功したら `router.push` でアプリ内へ遷移**し、
 * **失敗したときだけ** `openExternalUrl` で別タブを開く。
 *
 * この spec は «別タブが開く» を前提にしていたため、Cloud Run に鍵が入って
 * embed-token が 201 を返し始めた **2026-09-04 以降ずっと落ちていた**
 * （実測: run 33982422343 で `context.waitForEvent("page")` が 90 秒タイムアウト）。
 * nightly が慢性的に赤かったので、**誰にも見えていなかった**。
 *
 * ⚠️ **直すのは spec の側である。** アプリ内地図が仕様（#1810 でオーナー確定）で、
 *    «別タブで開く» はもう主経路ではない。
 *
 * ## それでも #1121 の保証は落とさない
 *
 * #1121 の主症状は «元のタブが SPA から離脱すること» であって «別タブかどうか» ではない。
 * どちらの経路でも **元のタブが Google へ飛ばされない**ことを見る。
 *
 * | 経路 | 条件 | 期待 |
 * | --- | --- | --- |
 * | 主 | embed-token が取れる | **アプリ内地図の画面が開く。新しいタブは 1 枚も開かない** |
 * | 縮退 | embed-token が 503 | **別タブで Google マップ。元タブの URL は変わらない**（#1121 のまま） |
 *
 * ## 外部への実通信はしない
 * `stubGoogleMaps()` で Google へのリクエストはスタブ HTML に差し替える。
 *
 * ## 0 件状態の作り方
 * `stubEmptyDishMediaResults()` で dish-media 検索 / bulk-import だけを空配列に固定する
 * （トピック提案までは実 API のまま。dev DB への書き込みも発生しないので `@mutation` は不要）。
 */
test.describe("検索 0 件の退避導線 (#1121 / #1810)", () => {
	// トピック生成は実 API（AI）で実測 30 秒近くかかるため、dish-categories-flow.spec.ts と同様に延長する
	test.setTimeout(90_000);

	/** Google マップの検索 URL（app-expo/lib/googleMaps.ts の buildGoogleMapsSearchUrl 準拠） */
	const GOOGLE_MAPS_SEARCH_URL = /^https:\/\/www\.google\.com\/maps\/search\//;

	/** 0 件の退避ダイアログが出るところまで進める（2 ケースで共通） */
	async function openFallbackDialog(appPage: import("@playwright/test").Page) {
		const searchPage = new SearchPage(appPage);
		const dishCategoriesPage = new DishCategoriesPage(appPage);

		await searchPage.typeLocation("渋谷");
		await searchPage.selectLocationSuggestion(0);
		await searchPage.submitButton.click();
		await dishCategoriesPage.expectLoaded();
		await dishCategoriesPage.chooseFirstDishCategory();

		// 0 件確定で退避ダイアログが出る。#828 の実装は同時に result 画面を閉じるため、
		// このときの背後の画面はトピック画面に戻っている
		const fallbackDialog = new GoogleMapsFallbackDialog(appPage);
		await fallbackDialog.expectVisible();
		return { dishCategoriesPage, fallbackDialog };
	}

	// ─ 主経路: アプリ内地図が開く（新しいタブは開かない）─────────────────────
	test("「Google マップで開く」でアプリ内地図が開き、新しいタブは開かない", async ({ appPage }) => {
		const context = appPage.context();

		await stubEmptyDishMediaResults(context);
		await stubGoogleMaps(context);

		// 「1 枚も開かない」ことを見るため、テスト全体で開いたタブを数える
		const openedPages: unknown[] = [];
		context.on("page", (opened) => openedPages.push(opened));

		const { fallbackDialog } = await openFallbackDialog(appPage);

		await fallbackDialog.confirmButton.click();

		/*
		アプリ内地図の本体（`features/maps/components/MapsEmbedModal.tsx`）が出るまで待つ。
		⚠️ URL では判定しない。expo-router の静的書き出しではタブグループ内のネスト遷移で
		   URL バーが表示内容と一致しないことがある（DishCategoriesPage のコメント参照）。
		*/
		await expect(appPage.getByTestId("maps-embed-modal-close")).toBeVisible({ timeout: 30_000 });

		// ここが #1121 の保証。**元のタブが Google へ飛ばされていない**
		expect(appPage.url()).not.toMatch(/^https:\/\/www\.google\.com\//);

		// 主経路では別タブを開かない（外部ブラウザへ逃がすのは縮退のときだけ）
		expect(openedPages).toHaveLength(0);
	});

	// ─ 縮退: 鍵が無いときは従来どおり別タブの Google マップ ────────────────────
	test("embed-token が取れないときは、別タブで Google マップを開き元のページは変わらない", async ({ appPage }) => {
		const context = appPage.context();

		await stubEmptyDishMediaResults(context);
		await stubGoogleMaps(context);
		// 「Cloud Run に鍵が入っていない」状態を作る（実 API のキー設定に依存させない）
		await stubMapsEmbedTokenUnavailable(context);

		const openedPages: unknown[] = [];
		context.on("page", (opened) => openedPages.push(opened));

		const { dishCategoriesPage, fallbackDialog } = await openFallbackDialog(appPage);

		// 押下**前**の URL を控える。期待値を決め打ちせず「押す前後で変わらないこと」で判定する
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
