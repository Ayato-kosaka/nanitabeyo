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

	/**
	 * 📸 #1780 **画像の無い店が «灰色の四角» ではなくアイコンの受け皿になる**ことを
	 * ネイティブで撮る。
	 *
	 * ## なぜ上のテストでは足りなかったか
	 *
	 * 上は «入力欄が潰れていない» ことだけを見るので、**結果が返る前にテストが終わる**。
	 * 実際 run 33955792513 のスクリーンショットは 2 枚とも «検索中...» のままで、
	 * 一覧が 1 行も写っていなかった。**撮れた枚数と «写っているか» は別である。**
	 *
	 * ## 何を見るか
	 *
	 * dev の 62 万店はパイプライン製で `image_url` を持たない（#1780 で新規保存も
	 * やめた）。したがって検索結果はほぼ全部が «画像の無い店» になり、
	 * `RestaurantAvatar` の受け皿（`...-image-placeholder`）が描かれるはずである。
	 *
	 * ⚠️ **この画面は Google を叩かない。** 店名検索は自社の
	 * `GET /v1/restaurants/search`（#1416）で、Autocomplete も Text Search も
	 * 呼ばない。オーナーの「place detail 使うので ci にしてはダメよ」に反しない。
	 */
	it("#1780 画像の無い店はアイコンの受け皿になる（灰色の四角にしない）", async () => {
		await tabBar.gotoMyDishes();
		await waitUntilVisible(myDishes.recordButton, DEFAULT_TIMEOUT);
		await tapWhenVisible(myDishes.recordButton);

		await waitUntilVisible(myDishes.snsImportEatenTab, DEFAULT_TIMEOUT);
		await tapWhenVisible(myDishes.snsImportEatenTab);

		const searchInput = by.id("sns-import-eaten-restaurant-search-input");
		await waitUntilVisible(searchInput, DEFAULT_TIMEOUT);

		/*
		  ⚠️ **語の選び方に意味がある。「ラーメン」ではいけない。**

		  当初は «dev の 62 万店はパイプライン製で画像を持たないから、何で検索しても
		  画像なしが並ぶ» と考えたが、**実測で外れた**（run 33957116422 の
		  スクリーンショットは «ラーメン» の結果 4 件が全部 画像あり）。
		  店名検索は投稿のある店＝画像を持つ店を上位に返す。

		  「8番ラーメン」は `scripts/db-checks/find_image_less_restaurant.py` が
		  **image_url も dish_media も持たない**ことを dev で確認した店（14 店舗以上）。
		*/
		await element(searchInput).replaceText("8番ラーメン");

		/*
		  ⚠️ **結果が返るまで待つ。** ここを待たずに撮ると «検索中...» が写る
		     （上のテストで実際にそうなった）。1 件目の受け皿が見えたら描画済みとみなす。
		     dev のデータが変わって画像を持ってしまったら、ここで落ちて気付ける
		     （そのときは上のスクリプトで別の店を探し直す）。
		*/
		await waitUntilVisible(
			by.id("sns-import-eaten-restaurant-search-result-0-image-placeholder"),
			DEFAULT_TIMEOUT,
		);
		await device.takeScreenshot("record-restaurant-search-no-image-placeholder");
	});
});
