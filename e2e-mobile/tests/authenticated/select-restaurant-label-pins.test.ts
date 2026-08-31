import { execFileSync } from "child_process";
import { by, describeAuthenticated, device, element, launchAppWithSession, waitFor } from "../../fixtures/e2e";
import { DEFAULT_TIMEOUT, tapWhenVisible } from "../../utils/waits";
import { MyDishesScreen } from "../../screens/MyDishesScreen";
import { TabBar } from "../../screens/TabBar";

/*
⚠️ `by` / `element` / `device` は **必ず `fixtures/e2e` から import すること。**
Detox は型だけグローバル宣言しているので tsc は素通しするが、実行時には
`ReferenceError: by is not defined` で落ちる（このリポジトリで実測済み）。
*/

/**
 * 📍 «お店を選ぶ» 地図の **店名つきピン**（`RestaurantLabelMarker`）が
 *     実機の Android で本当に描かれているかを、スクリーンショットに残す。
 *
 * ## なぜ既存の `select-restaurant-map-perf` では足りないのか
 *
 * オーナー実機報告「お店を選ぶのマップピンが Android で映らない」。
 *
 * 既存の計測 spec（`select-restaurant-map-perf`）を Android で回して分かったこと
 * （run 33373910743 のスクリーンショット）:
 *
 * - **クラスタのマーカーは正しく描かれている。** «27» という数字まで読める。
 *   つまり「Android ではマーカーが一切出ない」ではない
 * - ただしあの spec は swipe で中心を動かすだけで **倍率を変えられない**
 *   （`pinch` は Android の実行時に生えていない。あちらのコメント参照）。
 *   結果、表示域はずっと `latitudeDelta > 0.05` のままで、
 *   `pinDetailLevelForRegion` は常に `"dot"` を返す。
 *   **店名つきピンは 1 度も描かれていなかった。**
 *
 * オーナー端末のログは `detail="label"` かつ `pins=40 / clusters=19` である。
 * つまり «映らない» と言われているのは **label のほう**で、既存 spec が唯一
 * 撮れていなかった状態そのものである。
 *
 * ## どうやって寄せるか
 *
 * 現在地ボタン（`review-select-restaurant-current-location-button`）が
 * `latitudeDelta: 0.01` へ `animateToRegion` する（`select-restaurant.tsx` の
 * `handleCurrentLocation`）。0.01 < `LABEL_ZOOM_MAX_DELTA`(0.05) なので、
 * これで «店名つきピン» の倍率へ入る。位置はエミュレータへ東京駅を注入する。
 *
 * ⚠️ **検索窓（Places のオートコンプリート）は使わない。** 最初はそちらで書いたが、
 *    run 33378597722 で **候補が 1 件も返らず** 25 秒 timeout で落ちた
 *    （«銀座» と打った状態のスクリーンショットで確認済み）。原因は日次クォータか
 *    エミュレータの経路かのどちらかで、いずれにせよ **外部 API に依存する寄せ方は、
 *    ピンの描画とは無関係な理由でエビデンスを撮れなくする**。
 *
 * ⚠️ 位置情報は権限（`pm grant`）と **端末の位置情報スイッチ**（`location_mode=3`）の
 *    両方が要る。片方だけでは `handleCurrentLocation` が catch に落ちて何もしない
 *    （`select-restaurant-map-perf` が run 33132551584 で実測した内容と同じ）。
 *
 * ## この spec は何を assert するのか（正直に書く）
 *
 * **マーカーの有無は assert しない。** Android の `react-native-maps` は `Marker` を
 * 地図のキャンバスへ直接描くため、`testID` はビュー階層に現れず Detox から観測できない
 * （`select-restaurant-map-perf` の表を参照。3 通り試して全滅している）。
 * ここで «pins が見えること» を assert すると、**正常なアプリを落とすテスト**になる。
 *
 * したがってこの spec が守るのは「**寄った状態のスクリーンショットが必ず残ること**」
 * だけである。ピンが欠けているかどうかの判断は、Artifact の画像を人が見て行う。
 * 落ちないテストにしないため、assert は «寄せる操作が最後まで通ること» に置く。
 *
 * DB へは書き込まない（店を選ばずに終わる）ので mutation ではない。
 */
describeAuthenticated("お店を選ぶ地図の店名つきピン @authenticated", () => {
	const tabBar = new TabBar();
	const myDishes = new MyDishesScreen();

	const map = by.id("select-restaurant-map");
	const currentLocationButton = by.id("review-select-restaurant-current-location-button");
	const searchThisArea = by.id("select-restaurant-search-this-area");

	/** 東京駅。`select-restaurant-map-perf` の SQL 計測と同じ地点 */
	const TOKYO_STATION = { lat: 35.681236, lng: 139.767125 };

	/*
	Android の実行時位置情報を **この spec の中だけ**で有効にする。
	⚠️ CI 全体（ワークフローや AVD）へ入れないこと。起動直後の権限ダイアログを
	   前提にしているオンボーディングの spec の挙動が変わる。
	*/
	const adb = (...args: string[]): string =>
		execFileSync("adb", ["-s", device.id, ...args], { stdio: "pipe" }).toString().trim();

	const enableAndroidLocation = (): boolean => {
		if (device.getPlatform() !== "android") return true; // iOS は launchApp で付与済み
		try {
			for (const perm of ["android.permission.ACCESS_FINE_LOCATION", "android.permission.ACCESS_COARSE_LOCATION"]) {
				adb("shell", "pm", "grant", "com.nanitabeyo", perm);
			}
			// 権限だけでは足りない。OS の位置情報スイッチ（3 = 高精度）も入れる
			adb("shell", "settings", "put", "secure", "location_mode", "3");
			console.log(`[label-pins] location_mode = ${adb("shell", "settings", "get", "secure", "location_mode")}`);
			return true;
		} catch (error) {
			console.log(`[label-pins] ⚠️ 位置情報を有効にできなかった: ${String(error)}`);
			return false;
		}
	};

	beforeEach(async () => {
		await launchAppWithSession({ as: "authenticated" });
		console.log(`[label-pins] 位置情報の有効化: ${enableAndroidLocation()}`);
	});

	it("現在地へ寄せた状態を撮る（店名つきピンが出る倍率）", async () => {
		await device.setLocation(TOKYO_STATION.lat, TOKYO_STATION.lng);

		await tabBar.gotoMyDishes();
		await myDishes.gotoRecordDish(DEFAULT_TIMEOUT);

		await waitFor(element(map)).toBeVisible(1).withTimeout(DEFAULT_TIMEOUT);
		await device.takeScreenshot("label-pins-00-opened-wide");

		// 現在地ボタン → delta 0.01（= label の倍率）へ animateToRegion（1000ms）
		await tapWhenVisible(currentLocationButton, DEFAULT_TIMEOUT);
		await new Promise((resolve) => setTimeout(resolve, 3000));
		await device.takeScreenshot("label-pins-01-zoomed");

		// その倍率のまま取り直して、確実にこの範囲の店を出す
		await tapWhenVisible(searchThisArea, DEFAULT_TIMEOUT);
		await waitFor(element(by.id("select-restaurant-search-this-area-loading")))
			.not.toExist()
			.withTimeout(DEFAULT_TIMEOUT);
		await new Promise((resolve) => setTimeout(resolve, 3000));
		await device.takeScreenshot("label-pins-02-after-search");

		/*
		⚠️ **マーカーの有無は assert しない**（冒頭のコメント）。ここで守るのは
		   «寄せて取り直す操作が最後まで通ること» だけで、欠けているかどうかは
		   Artifact の画像を人が見て判断する。
		   地図がまだ画面に居ることだけ確かめて終わる（途中で別画面へ抜けていないこと）。
		*/
		await waitFor(element(map)).toBeVisible(1).withTimeout(DEFAULT_TIMEOUT);
	});
});
