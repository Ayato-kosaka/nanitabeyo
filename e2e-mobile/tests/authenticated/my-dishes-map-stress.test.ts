import { by, describeAuthenticated, device, element, launchAppWithSession, waitFor } from "../../fixtures/e2e";
import { DEFAULT_TIMEOUT, existsNow, tapWhenVisible } from "../../utils/waits";
import { MyDishesScreen } from "../../screens/MyDishesScreen";
import { TabBar } from "../../screens/TabBar";

/*
⚠️ `by` / `element` / `device` は **必ず `fixtures/e2e` から import すること。**
Detox はこれらのグローバル型を宣言しているので **tsc は素通しする**が、実行時には
定義されておらず `ReferenceError: by is not defined` で落ちる（run 32818524649 で実測）。
*/

/**
 * 💥 「食べたい・食べたをマップから絞り込む画面がすごくクラッシュする」への回帰テスト。
 *
 * ## なぜ «操作を繰り返すだけ» の spec なのか
 *
 * このクラッシュは JS 例外ではない。`react-native-maps` の `Marker` に children を
 * 渡すと、ネイティブはその View をビットマップへ焼いて貼る。焼き直しの可否を決める
 * `tracksViewChanges` の既定は `true` で、放置すると **地図が動くあいだ中、
 * マーカー 1 個につき毎フレーム 1 枚**作り直す。この地図は最大 300 ピンを置くので、
 * 生成物が GC より速く積み上がり、**Java 例外を伴わずにプロセスが終わる**。
 *
 * したがって «特定の操作で落ちる» のではなく «地図を動かし続けると落ちる» という形になる。
 * ここでは地図を何度も動かし・ビューを行き来し、**そのあともアプリが生きている**ことを見る。
 * プロセスが死ねば Detox は接続を失うので、次の待機が必ず落ちる。
 *
 * ⚠️ 緑になっても «絶対に落ちない» の証明にはならない（エミュレータは実機よりメモリが潤沢で、
 * 回数もユーザーの操作より少ない）。**回帰の検知**が目的である。恒久的な担保は
 * `app-expo/features/mapMarkers/components/AvatarBubbleMarker.tracking.test.tsx` が
 * `tracksViewChanges` の値そのものを固定して行う。
 *
 * DB へは一切書き込まない（見る・動かす・絞り込むだけ）ので mutation ではない。
 */
describeAuthenticated("マップの絞り込みで落ちない @authenticated", () => {
	const tabBar = new TabBar();
	const myDishes = new MyDishesScreen();

	beforeEach(async () => {
		await launchAppWithSession({ as: "authenticated" });
	});

	it("地図の操作とフィルタの往復を繰り返してもアプリが生きている", async () => {
		await tabBar.gotoMyDishes();

		/*
		⚠️ **`selectView("map")` を使わない。**

		共有の Screen Object は «そのビューの器が見えていること» を既定のしきい値
		（Detox は画面上で 75% 以上見えていることを要求する）で待つ。
		Map ビューは下に常設シート・上に «このエリアで再検索»・右下に ＋ が重なるので、
		器の露出は 75% を割りうる。iOS の run 32824132327 で実際に割り、
		**アプリは正常に描けているのにテストだけが 25 秒待って落ちた**（失敗時の
		スクリーンショットに地図・シート・ボタンが全部写っている）。

		ここで見たいのは «アプリが生きているか» なので、しきい値 1% で待つ。
		*/
		// ⚠️ **押す前に «ボタンが出ている» ことを待つ。** タブへ来た直後はまだ描かれておらず、
		// 素の `tap()` は「要素が無い」で即落ちる（run 32838161590 で実測）
		await tapWhenVisible(myDishes.viewButton("map"), DEFAULT_TIMEOUT);
		const map = by.id("my-dishes-map");
		await waitFor(element(map)).toBeVisible(1).withTimeout(DEFAULT_TIMEOUT);
		await device.takeScreenshot("map-stress-01-initial");

		/*
		⚠️ **緑を鵜呑みにしないための記録。**

		dev のテストユーザーの記録は件数が変動し、0 件のこともある
		（`my-dishes-views.test.ts` 冒頭の申し送り）。ピンが 1 つも無ければ
		マーカーは 1 個も作られず、**この spec は «落ちないこと» を何も試していない**。
		それでも緑になるので、実際にマーカーが出ていたかをログへ残す。
		ログに `pins=false cluster=false` とあれば、その run は空振りである。
		*/
		const hadPin = await existsNow(myDishes.mapPin);
		const hadCluster = await existsNow(by.id("my-dishes-map-cluster"));
		console.log(`[map-stress] マーカーの有無: pins=${hadPin} cluster=${hadCluster}`);

		/*
		1) 地図をひたすら動かす。マーカーの焼き直しが止まっていなければ、
		   ここでネイティブヒープが積み上がる。

		⚠️ **上方向へスワイプしないこと。** 下部の常設シートは «上へ引くと Feed へ行く»
		ジェスチャを持っており（`MyDishesMapSheet` の `onSwipeUp`）、上スワイプは
		地図を動かさずに **画面ごと Feed へ遷移**する。run 32820076647 でそれを踏み、
		「地図が消えた」＝ 落ちたように見える失敗になった（実際はアプリは生きていた）。
		縦方向の pan は下向きだけで足りる。
		*/
		for (let i = 0; i < 6; i += 1) {
			// 開始点を画面の上から 35% に固定する。既定（中央）だと端末によっては
			// 下部シートの上から始まり、地図ではなくシートを掴む
			await element(map).swipe(i % 2 === 0 ? "left" : "right", "fast", 0.6, 0.5, 0.35);
			await element(map).swipe("down", "fast", 0.4, 0.5, 0.35);
		}
		await waitFor(element(map)).toBeVisible(1).withTimeout(DEFAULT_TIMEOUT); // ← ここで死んでいれば落ちる
		await device.takeScreenshot("map-stress-02-after-pan");

		// 2) 「このエリアで再検索」でピンを取り直す（= マーカーを全部作り直す）
		await tapWhenVisible(by.id("my-dishes-search-this-area"), DEFAULT_TIMEOUT);
		await waitFor(element(map)).toBeVisible(1).withTimeout(DEFAULT_TIMEOUT);

		// 3) 絞り込み画面へ入って戻る、を繰り返す。適用のたびにピンを引き直す経路
		for (let i = 0; i < 3; i += 1) {
			await myDishes.openFilters(DEFAULT_TIMEOUT);
			await tapWhenVisible(myDishes.filterApplyButton, DEFAULT_TIMEOUT);
			await waitFor(element(map)).toBeVisible(1).withTimeout(DEFAULT_TIMEOUT);
		}
		await device.takeScreenshot("map-stress-03-after-filters");

		// 4) ビューを行き来する（Map は keep-alive なので破棄されずに残る）
		for (const view of ["list", "map", "calendar", "map"] as const) {
			await tapWhenVisible(myDishes.viewButton(view), DEFAULT_TIMEOUT);
			await waitFor(element(myDishes.view(view))).toBeVisible(1).withTimeout(DEFAULT_TIMEOUT);
		}

		// 最後にもう一度地図を動かして、まだ生きていることを確かめる
		await element(map).swipe("left", "fast", 0.6, 0.5, 0.35);
		await element(map).swipe("down", "fast", 0.4, 0.5, 0.35);
		await waitFor(element(map)).toBeVisible(1).withTimeout(DEFAULT_TIMEOUT);
		await device.takeScreenshot("map-stress-04-final");
	});
});
