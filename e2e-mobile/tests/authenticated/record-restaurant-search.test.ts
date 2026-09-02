import { by, describeAuthenticated, device, element, launchAppWithSession } from "../../fixtures/e2e";
import { DEFAULT_TIMEOUT, tapWhenVisible, waitUntilVisible } from "../../utils/waits";
import { MyDishesScreen } from "../../screens/MyDishesScreen";
import { TabBar } from "../../screens/TabBar";

/*
⚠️ `by` / `element` / `device` は **必ず `fixtures/e2e` から import すること。**
Detox はこれらのグローバル型を宣言しているので **tsc は素通しする**が、実行時には
定義されておらず `ReferenceError: by is not defined` で落ちる（run 32818524649 で実測）。
*/

/**
 * 🔎 「食べたを記録」の店名検索ボックスが **実機で潰れていない**ことを見る。
 *
 * ## なぜ専用の spec を立てるのか
 *
 * この欄は 2 回続けて «潰れている» と実機で指摘された。1 回目の修正では直らず、
 * 原因は `RestaurantNameSearch` の器が `flex: 1` だったことだった。呼び出し元は
 * どちらも高さを決めない縦並びなので、ネイティブでは器の高さが 0 に潰れる。
 *
 * ⚠️ **web（react-native-web）では潰れない。** そのため web のスクリーンショットでは
 * 正常に見えてしまい、「直った」と誤って報告した。**この画面は実機で見るしかない。**
 *
 * ## この spec が守るもの
 *
 * 1. 記録タブを開いた直後、検索の入力欄が **見えている**こと
 *    （Detox の visible 判定は «画面上で実際に見える» ことを要求するので、
 *      高さ 0 に潰れていれば必ず落ちる）
 * 2. 文字を打てること（入力欄として機能していること）
 * 3. スクリーンショットを残すこと（見た目の判断は人がやる。CI の Artifact から回収する）
 *
 * DB へは一切書き込まない（店を選ばずに戻る）ので mutation ではない。
 */
describeAuthenticated("食べたを記録の店名検索 @authenticated", () => {
	const tabBar = new TabBar();
	const myDishes = new MyDishesScreen();

	beforeEach(async () => {
		await launchAppWithSession({ as: "authenticated" });
	});

	it("店名検索の入力欄が潰れずに表示され、文字を打てる", async () => {
		await tabBar.gotoMyDishes();
		await waitUntilVisible(myDishes.recordButton, DEFAULT_TIMEOUT);
		await tapWhenVisible(myDishes.recordButton);

		await waitUntilVisible(myDishes.snsImportEatenTab, DEFAULT_TIMEOUT);
		await tapWhenVisible(myDishes.snsImportEatenTab);

		// ここが本題。高さ 0 に潰れていれば visible にならない
		const searchInput = by.id("sns-import-eaten-restaurant-search-input");
		await waitUntilVisible(searchInput, DEFAULT_TIMEOUT);
		await device.takeScreenshot("record-restaurant-search-empty");

		// 入力欄として機能していること（潰れていると打鍵も届かない）
		await element(searchInput).replaceText("ラーメン");
		await device.takeScreenshot("record-restaurant-search-typed");
	});
});
