import { by, describeAuthenticated, device, element, launchAppWithSession, waitFor } from "../../fixtures/e2e";
import { DEFAULT_TIMEOUT, tapWhenVisible, waitUntilVisible } from "../../utils/waits";
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
 * 検索窓（`LocationAutocomplete`）でエリアを選ぶと
 * `handleAutocompleteSelect` が `latitudeDelta: 0.01` へ `animateToRegion` する
 * （`select-restaurant.tsx`）。0.01 < `LABEL_ZOOM_MAX_DELTA`(0.05) なので、
 * **これが «店名つきピン» に入る唯一の、外部測位に依存しない道**である。
 *
 * ⚠️ エミュレータの測位（`device.setLocation` + 現在地ボタン）には依存しない。
 *    既存 spec のコメントのとおり、この経路は実測で 3 回こけている。
 *
 * ⚠️ 候補が **飲食店** だと `createAndOpenRestaurant` が走って店舗詳細へ抜けてしまう。
 *    地名（«銀座»）を打って、地図移動だけの枝へ入れること。
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
	const searchInput = by.id("location-autocomplete-input");
	const firstSuggestion = by.id("location-autocomplete-suggestion-0");

	beforeEach(async () => {
		await launchAppWithSession({ as: "authenticated" });
	});

	it("エリアを選んで寄せた状態を撮る（店名つきピンが出る倍率）", async () => {
		await tabBar.gotoMyDishes();
		await myDishes.gotoRecordDish(DEFAULT_TIMEOUT);

		await waitFor(element(map)).toBeVisible(1).withTimeout(DEFAULT_TIMEOUT);
		await device.takeScreenshot("label-pins-00-opened-wide");

		// 地名を打つ。飲食店を打つと店舗詳細へ抜けてしまうので «銀座» のような地名にする
		await waitUntilVisible(searchInput, DEFAULT_TIMEOUT);
		await element(searchInput).replaceText("銀座");

		/*
		候補が出るまで待つ。Places のオートコンプリートはネットワーク越しなので、
		**出ないことがありうる**（クォータ・圏外）。出なければこの spec は
		«寄せられなかった» として落ちるべきである。黙って引きのまま撮ると、
		«ピンは出ていた» と誤読できるスクリーンショットが残るほうが害が大きい。
		*/
		await waitUntilVisible(firstSuggestion, DEFAULT_TIMEOUT);
		await device.takeScreenshot("label-pins-01-suggestions");
		await tapWhenVisible(firstSuggestion, DEFAULT_TIMEOUT);

		/*
		`animateToRegion` は 1000ms。着地で `onRegionChangeComplete` が飛び、
		そこから取得のデバウンス 400ms + 実際の取得が走る。
		寄せ切って絵が出揃うまで、実時間で待つ。
		*/
		await new Promise((resolve) => setTimeout(resolve, 4000));
		await waitFor(element(map)).toBeVisible(1).withTimeout(DEFAULT_TIMEOUT);
		await device.takeScreenshot("label-pins-02-zoomed");

		// この倍率のまま «このエリアで再検索» を押して、確実にその範囲の店を取り直す
		await tapWhenVisible(by.id("select-restaurant-search-this-area"), DEFAULT_TIMEOUT);
		await waitFor(element(by.id("select-restaurant-search-this-area-loading")))
			.not.toExist()
			.withTimeout(DEFAULT_TIMEOUT);
		await new Promise((resolve) => setTimeout(resolve, 2500));
		await device.takeScreenshot("label-pins-03-after-search");
	});
});
