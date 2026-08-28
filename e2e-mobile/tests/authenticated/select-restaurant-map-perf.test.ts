import { execFileSync } from "child_process";
import { by, describeAuthenticated, device, element, launchAppWithSession, waitFor } from "../../fixtures/e2e";
import { DEFAULT_TIMEOUT, existsNow, tapWhenVisible } from "../../utils/waits";
import { MyDishesScreen } from "../../screens/MyDishesScreen";
import { TabBar } from "../../screens/TabBar";

/*
⚠️ `by` / `element` / `device` は **必ず `fixtures/e2e` から import すること。**
Detox はこれらのグローバル型を宣言しているので tsc は素通しするが、実行時には
定義されておらず `ReferenceError: by is not defined` で落ちる。
*/

/**
 * ⏱ 「このエリアで再検索」に **実機で何秒かかるか**を測り、録画に残す。
 *
 * ## なぜ実機（Detox）なのか
 *
 * オーナー指摘（2026-08-27）:
 *
 * > このエリアで再検索はまだ重いですね。…自分で動画撮って、どのぐらい時間が
 * > かかってるのか自分でテストして検証してください。ピンが出てる数もめっちゃ多い。
 *
 * この «重さ» は 2 つの合成である。
 *
 * 1. サーバ側 — 近傍検索の SQL（#1629 で KNN 化。dev 実測 5km が 13.6 秒 → 0.10 秒）
 * 2. 端末側 — 返ってきた店を **1 件 1 マーカーで全部描いていた**こと
 *
 * 1 は `scripts/db-checks/measure_restaurants_nearby.py` が `EXPLAIN ANALYZE` で
 * 測れるが、**ユーザーが待つのは 1 と 2 の合計**であり、それは実機でしか測れない。
 * web の即席ハーネスは `window.google.maps` をスタブへ差し替えるので、
 * マーカーの生成コストが丸ごと消え、**この論点については何も測れない**。
 *
 * ## 何を «所要時間» と呼んでいるか
 *
 * `PrimaryButton` は `testID` を渡すと `${testID}-loading` のスピナーを出す
 * （`components/PrimaryButton.tsx:116`）。押した瞬間から **そのスピナーが消えるまで**を測る。
 * これは «要求を出してから、画面が結果を反映し終えるまで» と一致する。
 *
 * ⚠️ Detox の `waitFor` はポーリングなので、測れる分解能はポーリング間隔ぶん粗い。
 *    秒の桁を見るための計測であって、ミリ秒の精度は主張しない。
 *
 * ⚠️ **緑になっても «速い» の証明にはならない。** dev のデータ量・Cloud Run の
 *    コールドスタート・エミュレータの性能に左右される。数字はログへ出すので、
 *    判断は動画とログの数字で行うこと。
 *
 * DB へは書き込まない（見る・動かす・再検索するだけ）ので mutation ではない。
 */
describeAuthenticated("お店を選ぶ地図の「このエリアで再検索」の所要時間 @authenticated", () => {
	const tabBar = new TabBar();
	const myDishes = new MyDishesScreen();

	const searchButton = by.id("select-restaurant-search-this-area");
	const searchSpinner = by.id("select-restaurant-search-this-area-loading");
	const map = by.id("select-restaurant-map");

	/**
	 * Android の実行時位置情報権限を、**この spec の中だけ**で付与する。
	 *
	 * Detox の `permissions` は iOS 専用で、Android には等価な起動オプションが無い
	 * （`fixtures/e2e.ts` の `platformLaunchOptions` のコメント）。CI 側でも
	 * `pm grant` はしていないので、Android では位置情報が常に拒否された状態になる。
	 *
	 * その結果 `handleCurrentLocation` は `getCurrentLocation()` の例外を握って
	 * **何もせずに終わる**ため、地図は «日本全体» のまま動かない。run 33131796308 で
	 * 実際にそうなり、東京駅へ寄せたつもりの計測が**ピン 0 個のまま**だった。
	 *
	 * ⚠️ **CI 全体（ワークフローや AVD）へ入れないこと。** 起動直後の権限ダイアログを
	 *    前提にしているオンボーディングの spec の挙動が変わる。ここだけで付与する。
	 */
	const grantAndroidLocation = (): boolean => {
		if (device.getPlatform() !== "android") return true; // iOS は launchApp で付与済み
		try {
			for (const perm of ["android.permission.ACCESS_FINE_LOCATION", "android.permission.ACCESS_COARSE_LOCATION"]) {
				execFileSync("adb", ["-s", device.id, "shell", "pm", "grant", "com.nanitabeyo", perm], {
					stdio: "pipe",
				});
			}
			return true;
		} catch (error) {
			// 付与できなくてもテストは続ける。**地図が動かないことがログから分かるようにする**
			console.log(`[search-this-area] ⚠️ 位置情報権限を付与できなかった: ${String(error)}`);
			return false;
		}
	};

	beforeEach(async () => {
		await launchAppWithSession({ as: "authenticated" });
		console.log(`[search-this-area] 位置情報権限の付与: ${grantAndroidLocation()}`);
	});

	/**
	 * 1 回押して、スピナーが消えるまでの実時間を返す。
	 *
	 * スピナーが一度も観測できないほど速い場合もある（それは «速い» ので失敗にしない）。
	 * その場合も «押してから待機が解けるまで» を返す。
	 */
	const markerReport = async (): Promise<string> => {
		const pin = await existsNow(by.id("select-restaurant-pin"));
		const dot = await existsNow(by.id("select-restaurant-dot"));
		const cluster = await existsNow(by.id("select-restaurant-cluster"));
		return `pins=${pin} dot=${dot} cluster=${cluster}`;
	};

	const measureOnce = async (label: string): Promise<number> => {
		const started = Date.now();
		await tapWhenVisible(searchButton, DEFAULT_TIMEOUT);
		await waitFor(element(searchSpinner)).not.toExist().withTimeout(DEFAULT_TIMEOUT);
		const elapsed = Date.now() - started;
		// ⚠️ **毎回マーカーの有無を出す。** 最初に 1 回だけ見ても «その時点ではまだ
		//    取得が終わっていない» ので false になり、空振りかどうかを判定できない
		//    （run 33128561205 で実際にそうなり、ピン 0 個のまま «1 秒» と読める数字が出た）
		console.log(`[search-this-area] ${label}: ${elapsed} ms / ${await markerReport()}`);
		await device.takeScreenshot(`search-this-area-${label}`);
		return elapsed;
	};

	it("押してから結果が反映されるまでの時間を測る", async () => {
		await tabBar.gotoMyDishes();
		await myDishes.gotoRecordDish(DEFAULT_TIMEOUT);

		await waitFor(element(map)).toBeVisible(1).withTimeout(DEFAULT_TIMEOUT);
		await device.takeScreenshot("search-this-area-00-map-opened");

		/*
		⚠️ **開いた直後の «引き» の状態も、それ自体が測る価値のある地点である。**

		この画面は端末の言語が日本語だと現在地を見ず、必ず `REGION_JP`
		（中心 36.2048 / 138.2529 = 長野の山中、デルタ 20 度）から始まる
		（`select-restaurant.tsx` の init）。半径は 50km で頭打ちなので、
		**日本語ユーザーの初回の 1 回は構造上ほぼ 0 件**になる。
		ここを 1 回測っておくと «軽いのは単に何も無いからだ» と後から誤読されない。
		*/
		console.log(`[search-this-area] 00-map-opened のマーカー: ${await markerReport()}`);
		const wide = await measureOnce("01-japan-wide");

		/*
		本題はここから。**店が密にある場所へ寄せてから測る。**

		`device.setLocation` でエミュレータの位置を東京駅にし、検索窓の右の
		現在地ボタン（`handleCurrentLocation`）で 0.01 度（≒ 1km 四方）へ寄せる。
		SQL 側の計測（`measure_restaurants_nearby.py`）も東京駅中心なので、
		同じ地点で «SQL + マーカー描画» の合計を見ることになる。

		⚠️ 位置情報が取れない環境では地図は動かない。その場合はマーカーが出ないので、
		   上のログで空振りだと分かる（黙って «速い» と読めてしまわないようにする）。
		*/
		try {
			await device.setLocation(35.6812, 139.7671); // 東京駅
		} catch (error) {
			console.log(`[search-this-area] ⚠️ setLocation に失敗: ${String(error)}`);
		}
		// エミュレータの測位が «直近の既知位置» として読めるようになるまで少し置く
		await new Promise((resolve) => setTimeout(resolve, 3000));
		await tapWhenVisible(by.id("review-select-restaurant-current-location-button"), DEFAULT_TIMEOUT);
		/*
		⚠️ **ここは長めに待つ。**

		`getCurrentLocationPosition` は「既知位置 → 新規測位（最大 10 秒でタイムアウト）」の
		順に試す（`hooks/useCurrentLocationPosition.ts`）。5 秒しか待たないと、
		**測位がまだ返っていないうちにスクショを撮り、地図が動いていない絵**が残る
		（run 33132181132 で実際にそうなった）。10 秒のタイムアウト +
		animateToRegion 1 秒 + デバウンス 400ms を全部含める。
		*/
		await new Promise((resolve) => setTimeout(resolve, 16000));
		await waitFor(element(map)).toBeVisible(1).withTimeout(DEFAULT_TIMEOUT);
		await device.takeScreenshot("search-this-area-02-moved-to-tokyo");
		console.log(`[search-this-area] 東京駅へ寄せた直後のマーカー: ${await markerReport()}`);

		const dense1 = await measureOnce("03-tokyo");

		// 地図を動かしてからもう 1 回。こちらが «普段の操作» に近い
		await element(map).swipe("left", "fast", 0.5, 0.5, 0.35);
		const dense2 = await measureOnce("04-tokyo-after-pan");

		console.log(
			`[search-this-area] 実測: 引き(0件想定) ${wide} ms / 東京駅 ${dense1} ms / 東京駅+パン ${dense2} ms`,
		);

		// 生きていること（＝ 落ちていないこと）だけを固定する。速度そのものは
		// 環境依存なのでアサートしない。数字は上のログと動画で読む
		await waitFor(element(map)).toBeVisible(1).withTimeout(DEFAULT_TIMEOUT);
	});
});
