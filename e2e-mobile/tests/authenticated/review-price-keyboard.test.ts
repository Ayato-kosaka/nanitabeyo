import { strict as assert } from "node:assert";

import { describeAuthenticated, element, by, launchAppWithSession, waitUntilVisible } from "../../fixtures/e2e";
import { MyDishesScreen } from "../../screens/MyDishesScreen";
import { SelectRestaurantScreen } from "../../screens/SelectRestaurantScreen";
import { TabBar } from "../../screens/TabBar";

/**
 * ⌨️ 価格入力がキーボードに隠れないこと（#1629 オーナー実機報告「レビューで価格入力時にキーボードで隠れる」）
 *
 * ## なぜ実機（Detox）でしか見られないのか
 * **ソフトウェアキーボードは web に無い。** react-native-web はキーボードで画面を押し上げないので、
 * `evidence-video`（Playwright）では «隠れる / 隠れない» を一切観測できない。
 * この不具合はネイティブでしか起きず、ネイティブでしか裏付けられない（CLAUDE.md「完了の定義」§3）。
 *
 * ## 何が壊れていたか
 * `ReviewForm` の外枠 `KeyboardAvoidingView` は **`behavior` を渡していなかった**。
 * RN の既定は undefined ＝ 無効なので、キーボード回避が 1 つも効いていなかった。
 * 価格・コメントはフォームの下半分にあるため、そのままキーボードの下へ入る。
 *
 * 直したあとは iOS が ScrollView の `automaticallyAdjustKeyboardInsets`、
 * Android が OS の window リサイズで «フォーカス中の欄まで運ぶ» ところまでやる。
 *
 * ## 判定
 * Detox の `toBeVisible()` は **画面上で実際に見えている割合**で判定する（Android は既定 75%）。
 * キーボードの下に入った入力欄はこれを満たさないので、タップしてキーボードを出したあとに
 * `toBeVisible()` を要求すれば «隠れていないこと» をそのまま assert できる。
 *
 * ## dev DB への影響
 * **無し。** 投稿しない（フォームを埋めるところまでで終わる）。
 */
describeAuthenticated("価格入力がキーボードに隠れない", () => {
	const tabBar = new TabBar();
	const myDishes = new MyDishesScreen();
	const selectRestaurant = new SelectRestaurantScreen();

	beforeEach(async () => {
		await launchAppWithSession({ as: "authenticated" });
	});

	// ─ テストケース ─
	// 手順:
	//   1. レビューフォームまで進む（review-submit-loading.test.ts と同一の導線）
	//   2. 価格欄をタップしてソフトウェアキーボードを出す
	//   3. その状態で価格欄が **見えている** ことを検証（隠れていたらここで落ちる）
	//   4. 実際に打ち込めることも見る（見えていても操作できなければ意味がない）
	it("価格欄をタップしてキーボードが出ても、価格欄が見えたままである", async () => {
		await tabBar.gotoMyDishes();
		await myDishes.gotoRecordDish();

		await selectRestaurant.expectLoaded();
		await selectRestaurant.searchRestaurant("スターバックスコーヒー 渋谷");
		await selectRestaurant.selectSuggestion(0);

		await myDishes.chooseDishCategoryInRecordFlow("コーヒー", MyDishesScreen.FORM_TIMEOUT);
		await myDishes.chooseMediaInRecordFlow({}, MyDishesScreen.FORM_TIMEOUT);
		await myDishes.expectFormLoaded(MyDishesScreen.FORM_TIMEOUT);

		// タップで «実際にキーボードを出す»。replaceText だけだとキーボードが出ないことがあり、
		// «隠れる» の再現条件そのものを外してしまう
		await element(by.id("review-price-input")).atIndex(0).tap();

		// キーボードのアニメーションぶんだけ待ってから見る（出きる前に見ると常に緑になる）
		await new Promise((resolve) => setTimeout(resolve, 1500));

		try {
			await waitUntilVisible(by.id("review-price-input"), 5000);
		} catch (error) {
			assert.fail(
				`キーボードを出したあと価格欄が見えていない（キーボードの下に入っている疑い）: ${String(error)}`,
			);
		}

		// 見えているだけでなく打てること
		await myDishes.fillPrice("500");
	});
});
