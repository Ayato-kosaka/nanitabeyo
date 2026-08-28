import { launchAppWithSession } from "../../fixtures/e2e";
import { SearchScreen } from "../../screens/SearchScreen";
import { DishCategoriesScreen } from "../../screens/DishCategoriesScreen";

/**
 * 🔁 REL-03 (#1499): DishCategories 取得失敗時の「その場で再試行」（ネイティブ / Tier 2）
 *
 * 対応する e2e-web: e2e-web/tests/search/dish-categories-retry.spec.ts
 *
 * ## なぜ e2e-web と同じ密度で書けないか
 * e2e-web は `context.route` で `v1/dish-categories/recommendations` を 500 に固定でき、
 * 「エラー表示 → 再試行 → 同じ条件で再取得」までを確定的に検証できる。
 * 一方 Detox には Playwright の `context.route` に相当するネットワーク傍受 API が無く
 * （`e2e-mobile/utils/waits.ts` 冒頭の JSDoc を参照。`device.setURLBlacklist` も
 * Detox の同期機構を黙らせるだけで、実際のリクエストは素通しになるため代用できない）、
 * このリポジトリの e2e-mobile は実 API（dev の Cloud Run）だけを叩く構成になっている。
 * そのため **取得失敗を狙って起こすことができない**。
 *
 * ## この spec が検証する範囲
 * 「取得失敗時に再試行ボタンが表示され、押せる」という UI 自体は
 * `DishCategoriesError.tsx` として Web/ネイティブで共通のコンポーネントであり、
 * `dish-categories-error` / `dish-categories-error-retry` の testID もプラットフォーム間で共通に付いている。
 * 実 API がたまたま失敗を返した run に限り、**到達できた範囲**（エラー画面が出ていれば
 * 再試行ボタンが存在し押せる状態であること、押すと再度読み込みへ遷移すること）を検証する。
 * 通常は成功するため、その場合はカード表示への到達だけを確認して終える
 * （= 失敗を作れない以上、これ以上の網羅は e2e-web 側に委ねる）。
 */
describe("DishCategories 取得失敗時の再試行（実 API・#1499）", () => {
	const search = new SearchScreen();
	const dishCategories = new DishCategoriesScreen();

	beforeAll(async () => {
		await launchAppWithSession({ as: "anon" });
		await search.expectLoaded();

		await search.clearLocationIfPresent();
		await search.typeLocation("渋谷");
		await search.selectLocationSuggestion(0);
		await search.submit();
	});

	// ─ テストケース: 取得失敗に到達できた場合のみ、再試行ボタンの存在と再取得への遷移を検証する ─
	// 手順:
	//   1. beforeAll で検索を実行済み
	//   2. トピック画面が「カード表示」「エラー画面」のどちらに落ち着いたかを判定する
	//      (DishCategoriesScreen.expectSettled)
	//   3. カード表示に落ち着いた場合(通常時): これ以上の検証はできないため、
	//      カードが見えていることの確認だけで終える
	//   4. エラー画面に落ち着いた場合(実 API がたまたま失敗した場合): 再試行ボタンが
	//      表示され押せる状態であることを確認し、実際に押してもう一段の読み込み
	//      (カード表示 or 再びエラー画面)へ遷移できることまで確認する
	it("取得失敗時は再試行ボタンが表示され、押すと再取得へ遷移する（到達できた場合のみ）", async () => {
		const outcome = await dishCategories.expectSettled();

		if (outcome === "loaded") {
			await dishCategories.expectHeaderVisible();
			return;
		}

		await dishCategories.expectErrorState();
		await dishCategories.retry();

		// 再試行後も「カード表示」「エラー画面」のどちらかに落ち着くことだけを確認する。
		// 実 API を再試行した結果は制御できないため、どちらの結末でも
		// 「押した後に画面が固まらず遷移する」ことが確認できれば十分。
		await dishCategories.expectSettled();
	});
});
