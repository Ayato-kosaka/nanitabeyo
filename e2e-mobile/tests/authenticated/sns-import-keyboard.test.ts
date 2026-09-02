import { strict as assert } from "node:assert";

import { describeAuthenticated, element, by, launchAppWithSession, waitUntilVisible } from "../../fixtures/e2e";
import { MyDishesScreen } from "../../screens/MyDishesScreen";
import { TabBar } from "../../screens/TabBar";
import { enableAndroidSoftKeyboard, expectSoftKeyboardShown } from "../../utils/softKeyboard";

/**
 * ⌨️ 「SNS から」画面の入力欄がキーボードに隠れないこと
 *
 * #1629 オーナー実機報告（Android）:
 * 「Android で『SNSから』でお店、料理カテゴリのテキストボックスがキーボードで隠れる。
 *   このキーボードで隠れる系のバグ、多いので横並びで直して。」
 *
 * ## なぜ実機（Detox）でしか見られないのか
 * **ソフトウェアキーボードは web に無い。** react-native-web はキーボードで画面を押し上げないので、
 * `evidence-video`（Playwright）では «隠れる / 隠れない» を一切観測できない。
 *
 * ## ⚠️ キーボードが «出ていること» を先に確かめる
 * CI のエミュレータは既定で IME が無効（`scripts/setup-android-locale.sh`。理由は #1027）。
 * その状態でタップしても **キーボードは 1 度も出ない**ので、«隠れていない» を確認しても
 * 何も守っていないことになる。実際 `review-price-keyboard.test.ts` がその状態で緑のまま、
 * オーナーの実機では隠れ続けていた。ここでは `utils/softKeyboard.ts` の 2 段
 *（出せる状態にする → 本当に出たかを dumpsys で確かめる）を必ず通す。
 *
 * ## この画面のどこを見るか
 * 「SNS から」は URL を貼って解決したあと、②お店 / ③料理カテゴリ の 2 つの入力欄が
 * **画面の下半分**に並ぶ。URL の解決には外部サイトへの到達が要り CI では不安定なので、
 * ここでは **解決を待たずに触れる入力欄**（①の URL 欄）と、上部タブ「食べた」側の
 * 店名検索欄を対象にする。どちらも «下半分にある入力欄» という同じ条件を満たす。
 *
 * ## dev DB への影響
 * **無し。** 何も投稿しない（入力欄を触るだけで終わる）。
 */
describeAuthenticated("「SNS から」の入力欄がキーボードに隠れない", () => {
	const tabBar = new TabBar();
	const myDishes = new MyDishesScreen();

	beforeEach(async () => {
		await launchAppWithSession({ as: "authenticated" });
		enableAndroidSoftKeyboard();
	});

	/** タップしてキーボードを出し、«本当に出たこと» を確かめてから、その欄が見えたままかを見る */
	const expectStaysVisibleWithKeyboard = async (testID: string, label: string): Promise<void> => {
		await element(by.id(testID)).atIndex(0).tap();
		// キーボードのアニメーションぶんだけ待つ（出きる前に見ると常に緑になる）
		await new Promise((resolve) => setTimeout(resolve, 1500));

		expectSoftKeyboardShown(
			() =>
				`ソフトウェアキーボードが出ていない（${label}）。この状態で «隠れていない» を確認しても` +
				"意味が無いので落とす。エミュレータの IME が無効のままの可能性がある（utils/softKeyboard.ts）",
		);

		try {
			await waitUntilVisible(by.id(testID), 5000);
		} catch (error) {
			assert.fail(`キーボードを出したあと ${label} が見えていない（キーボードの下に入っている）: ${String(error)}`);
		}
	};

	// ─ テストケース: URL 入力欄（①）─
	// 手順:
	//   1. ＋ から「SNS から」画面を開く
	//   2. URL 欄をタップしてキーボードを出す
	//   3. キーボードが本当に出たことを確かめ、URL 欄が見えたままであることを検証
	it("URL 入力欄をタップしてキーボードが出ても、入力欄が見えたままである", async () => {
		await tabBar.gotoMyDishes();
		await myDishes.openRecordSheet();

		await waitUntilVisible(by.id("sns-import-url-input"), MyDishesScreen.FORM_TIMEOUT);
		await expectStaysVisibleWithKeyboard("sns-import-url-input", "SNS 取り込みの URL 欄");
	});

	// ─ テストケース: 「食べた」タブの店名検索欄 ─
	// 手順:
	//   1. ＋ から「SNS から」画面を開き、上部タブ「食べた」へ切り替える
	//   2. 店名検索欄をタップしてキーボードを出す
	//   3. キーボードが本当に出たことを確かめ、検索欄が見えたままであることを検証
	it("「食べた」タブの店名検索欄をタップしてキーボードが出ても、検索欄が見えたままである", async () => {
		await tabBar.gotoMyDishes();
		await myDishes.openRecordSheet();
		await myDishes.openEatenTab();

		await waitUntilVisible(by.id("sns-import-eaten-restaurant-search-input"), MyDishesScreen.FORM_TIMEOUT);
		await expectStaysVisibleWithKeyboard("sns-import-eaten-restaurant-search-input", "「食べた」タブの店名検索欄");
	});
});
