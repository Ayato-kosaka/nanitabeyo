import { strict as assert } from "node:assert";

import { describeAuthenticated, element, by, launchAppWithSession, waitUntilVisible } from "../../fixtures/e2e";
import { enableAndroidSoftKeyboard, expectSoftKeyboardShown } from "../../utils/softKeyboard";
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
 * ## ⚠️ このテストは一度 «絶対に落ちないテスト» だった（#1629 5 巡目）
 *
 * CI のエミュレータは `scripts/setup-android-locale.sh` が **IME を全部 disable** し、
 * `show_ime_with_hard_keyboard` を 0 にしている（#1027。日本語 IME の初回セットアップ画面が
 * 画面下半分を覆っていたため）。その状態では **タップしてもキーボードが 1 度も出ない**。
 * つまり «キーボードを出したあと見えている» を、キーボードが出ない画面で確認していた。
 * テストは緑のまま、オーナーの実機では隠れ続けていた。
 *
 * そのため、いまは
 *
 *   1. `enableAndroidSoftKeyboard()` でキーボードが出られる状態にし、
 *   2. `expectSoftKeyboardShown()` で **本当に出たことを `dumpsys input_method` で確かめる**
 *
 * の 2 段を必ず通す。2 が無いと同じ嘘に戻る。**この 2 行を消さないこと。**
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
		// キーボードが «出られる» 状態にする。出たかどうかは各テストの中で確かめる
		enableAndroidSoftKeyboard();
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

		// ⚠️ ここが要。キーボードが出ていないなら «隠れていない» を確認する意味が無い
		expectSoftKeyboardShown(
			() =>
				"ソフトウェアキーボードが出ていない。この状態で «隠れていない» を確認しても意味が無いので落とす。" +
				"（エミュレータの IME が無効のままの可能性。utils/softKeyboard.ts を参照）",
		);

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
