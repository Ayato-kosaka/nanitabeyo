import { launchAppWithSession, localeDeepLink, tapWhenVisible, waitUntilVisible } from "../../fixtures/e2e";
import { MyDishesScreen } from "../../screens/MyDishesScreen";

/**
 * ✕ 食べたい/食べた の全画面 Feed の «閉じる» が実端末で押せること（#1962）
 *
 * ## なぜ実端末でしか見えない欠陥なのか
 * jest（`app-expo/__tests__/myDishesFeedRoute.test.tsx`）は `onPress` を**直接呼ぶ**ので、
 * «描かれているか» と «押したら何が起きるか» しか見ていない。#1962 の欠陥は
 * **タップがボタンまで届かない**ことで、間にシステムのステータスバーが居た。
 * Expo SDK 54 の Android は edge-to-edge が強制なので `top: 0` はステータスバーの下を意味し、
 * padding 12 のこのボタン（48dp）は中心が y=24dp ＝ ステータスバーの内側に入っていた。
 * 実機ログで `my_dishes_feed_closed` 相当の遷移が起きないのに、**見えてはいる**ので
 * `toBeVisible()` も通ってしまう。→ 押して «画面が変わったこと» まで見るのがこのテストの役目。
 *
 * ## 店舗フィード（`restaurant-routes.test.ts`）との関係
 * あちらは同じ形の × を既に押している。**同じ固定値を持つ画面が 4 枚あって、
 * 押しているのは 1 枚だけ**だったのが #1962 を «店舗フィードだけの問題» に見せていた。
 * こちらを足して、両方の × を実端末で押す状態にする。
 *
 * ## dev DB への影響
 * 無し（匿名セッションで読み取りのみ。実在しない restaurantId なので行は返らない）。
 */
/** モックできないので «実在しない» id を使う。画面の «器» と閉じる導線だけを見る */
const UNKNOWN_RESTAURANT_ID = "e2e-1962-unknown-restaurant";

describe("食べたい/食べた の全画面 Feed の閉じる（#1962）", () => {
	// ─ テストケース: 直リンク着地の × で食べたい/食べたタブへ倒れる ─
	// 手順:
	//   1. nanitabeyo:///ja-JP/my-dishes/feed?restaurantId=<実在しない id> へ直接着地する
	//   2. Feed の器が出ることを検証（閉じる導線はデータの分岐の外に置いてある）
	//   3. × をタップする
	//   4. 履歴が無い着地なので、食べたい/食べたタブ（ゲスト表示）へ倒れることを検証
	it("ディープリンクで着地した Feed を × で閉じると、食べたい/食べたタブへ倒れる", async () => {
		const myDishes = new MyDishesScreen();

		await launchAppWithSession({
			as: "anon",
			url: localeDeepLink(`my-dishes/feed?restaurantId=${UNKNOWN_RESTAURANT_ID}`),
			waitForReady: false,
		});

		await waitUntilVisible(myDishes.feedScreen);

		// ⚠️ ここが #1962 の観測点。«見えている» だけでは足りず、**タップが届く**ことを見る
		await tapWhenVisible(myDishes.feedCloseButton);

		await myDishes.expectGuestViewLoaded();
	});
});
