import { describeAuthenticated, launchAppWithSession } from "../../fixtures/e2e";
import { DEFAULT_TIMEOUT, tapWhenVisible, waitUntilVisible } from "../../utils/waits";
import { MyDishesScreen } from "../../screens/MyDishesScreen";
import { TabBar } from "../../screens/TabBar";

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
 * プロセスが死ねば Detox は接続を失うので、次の `waitUntilVisible` が必ず落ちる。
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
		await myDishes.selectView("map", DEFAULT_TIMEOUT);

		const map = by.id("my-dishes-map");
		await waitUntilVisible(map, DEFAULT_TIMEOUT);
		await device.takeScreenshot("map-stress-01-initial");

		// 1) 地図をひたすら動かす。マーカーの焼き直しが止まっていなければ、
		//    ここでネイティブヒープが積み上がる
		for (let i = 0; i < 6; i += 1) {
			await element(map).swipe(i % 2 === 0 ? "left" : "right", "fast", 0.6);
			await element(map).swipe(i % 2 === 0 ? "up" : "down", "fast", 0.4);
		}
		await waitUntilVisible(map, DEFAULT_TIMEOUT); // ← ここで死んでいれば落ちる
		await device.takeScreenshot("map-stress-02-after-pan");

		// 2) 「このエリアで再検索」でピンを取り直す（= マーカーを全部作り直す）
		await tapWhenVisible(by.id("my-dishes-search-this-area"), DEFAULT_TIMEOUT);
		await waitUntilVisible(map, DEFAULT_TIMEOUT);

		// 3) 絞り込み画面へ入って戻る、を繰り返す。適用のたびにピンを引き直す経路
		for (let i = 0; i < 3; i += 1) {
			await myDishes.openFilters(DEFAULT_TIMEOUT);
			await tapWhenVisible(myDishes.filterApplyButton, DEFAULT_TIMEOUT);
			await waitUntilVisible(map, DEFAULT_TIMEOUT);
		}
		await device.takeScreenshot("map-stress-03-after-filters");

		// 4) ビューを行き来する（Map は keep-alive なので破棄されずに残る）
		for (const view of ["list", "map", "calendar", "map"] as const) {
			await myDishes.selectView(view, DEFAULT_TIMEOUT);
		}

		// 最後にもう一度地図を動かして、まだ生きていることを確かめる
		await element(map).swipe("left", "fast", 0.6);
		await waitUntilVisible(map, DEFAULT_TIMEOUT);
		await device.takeScreenshot("map-stress-04-final");
	});
});
