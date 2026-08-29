import { strict as assert } from "node:assert";
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
	const adb = (...args: string[]): string =>
		execFileSync("adb", ["-s", device.id, ...args], { stdio: "pipe" }).toString().trim();

	const grantAndroidLocation = (): boolean => {
		if (device.getPlatform() !== "android") return true; // iOS は launchApp で付与済み
		try {
			for (const perm of ["android.permission.ACCESS_FINE_LOCATION", "android.permission.ACCESS_COARSE_LOCATION"]) {
				adb("shell", "pm", "grant", "com.nanitabeyo", perm);
			}
			/*
			⚠️ **権限だけでは足りない。端末の «位置情報サービス» 自体が切れている。**

			run 33132551584 は権限の付与に成功し `setLocation` も投げたのに地図が動かなかった。
			`pm grant` はアプリへの許可であって、OS の位置情報スイッチとは別である。
			エミュレータの既定は location_mode=0（オフ）なので、
			`getLastKnownPositionAsync` は null、`getCurrentPositionAsync` は失敗し、
			`handleCurrentLocation` の catch に落ちて **何もせず終わる**。
			3 = 高精度（GPS + ネットワーク）。
			*/
			adb("shell", "settings", "put", "secure", "location_mode", "3");
			console.log(`[search-this-area] location_mode = ${adb("shell", "settings", "get", "secure", "location_mode")}`);
			return true;
		} catch (error) {
			// 付与できなくてもテストは続ける。**地図が動かないことがログから分かるようにする**
			console.log(`[search-this-area] ⚠️ 位置情報を有効にできなかった: ${String(error)}`);
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
	/** 1 回の計測結果。**所要時間と «実際に描かれたか» は必ず組で持ち回る** */
	type Measurement = { label: string; elapsed: number; hasMarker: boolean };

	const readMarkers = async (): Promise<{ pin: boolean; dot: boolean; cluster: boolean }> => ({
		pin: await existsNow(by.id("select-restaurant-pin")),
		dot: await existsNow(by.id("select-restaurant-dot")),
		cluster: await existsNow(by.id("select-restaurant-cluster")),
	});

	/**
	 * 結果が «空でない» かを判定する。
	 *
	 * ⚠️ **マーカーの有無では判定できない。** Android の react-native-maps は
	 *    `Marker` を地図のキャンバスへ描くのでビュー階層に現れず、Detox からは
	 *    常に «無い» に見える。run 33236381539 では **API が 3 件返しているのに**
	 *    `pins=false dot=false cluster=false` になり、そのまま «空振り» と読めば
	 *    アプリの不具合と誤診するところだった（実際には API も描画も正常）。
	 *
	 * 代わりに下部シートの **空状態が出ていないこと**で見る。こちらは普通の View なので
	 * Detox から観測できる。シート自体の存在も併せて確かめ、
	 * 「シートごと描かれていないから空状態も無い」を «空でない» と読まないようにする。
	 */
	const resultIsNonEmpty = async (): Promise<{ sheet: boolean; empty: boolean; ok: boolean }> => {
		const sheet = await existsNow(by.id("saved-restaurants-sheet"));
		const empty = await existsNow(by.id("select-restaurant-saved-empty"));
		return { sheet, empty, ok: sheet && !empty };
	};

	const markerReport = async (): Promise<string> => {
		const m = await readMarkers();
		return `pins=${m.pin} dot=${m.dot} cluster=${m.cluster}`;
	};

	const measureOnce = async (label: string): Promise<Measurement> => {
		const started = Date.now();
		await tapWhenVisible(searchButton, DEFAULT_TIMEOUT);
		await waitFor(element(searchSpinner)).not.toExist().withTimeout(DEFAULT_TIMEOUT);
		const elapsed = Date.now() - started;
		// ⚠️ **毎回マーカーの有無を出す。** 最初に 1 回だけ見ても «その時点ではまだ
		//    取得が終わっていない» ので false になり、空振りかどうかを判定できない
		//    （run 33128561205 で実際にそうなり、ピン 0 個のまま «1 秒» と読める数字が出た）
		const m = await readMarkers();
		const r = await resultIsNonEmpty();
		console.log(
			`[search-this-area] ${label}: ${elapsed} ms / pins=${m.pin} dot=${m.dot} cluster=${m.cluster}` +
				` / sheet=${r.sheet} empty=${r.empty} → 空でない=${r.ok}`,
		);
		await device.takeScreenshot(`search-this-area-${label}`);
		return { label, elapsed, hasMarker: r.ok };
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
		（`select-restaurant.tsx` の init）。

		⚠️ **この «引き» は、もう 0 件想定ではない。** 以前は半径が 50km で頭打ちだったため
		「日本語ユーザーの初回は構造上ほぼ 0 件」だったが、#1629 でその足切りを廃止した。
		いまは日本全体の外接円（dev 実測 `radius=1,430,410`）で投げて保存済みの店が返る。
		そのため **この 1 回を «空振りでないこと» の基準点として使える**（測位に依存しない）。
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
		/*
		⚠️ **`device.setLocation` + 現在地ボタンでの «東京駅へ寄せる» はやめた。**

		run 33236381539 の実ログで、この spec が出した 8 本のリクエストが
		**すべて `lat=36.2048&lng=138.2529&radius=1430410`**（＝ 日本全体のまま）だった。
		つまり地図は 1 度も動いておらず、«東京駅の実測» と名付けた 2 本は
		日本全体を測り直しているだけだった。エミュレータの測位はこれまでも
		2 度こけている（run 33132551584 / 33135757290）ので、この経路には依存しない。

		代わりに **地図そのものを操作して表示域を変える**。pinch も swipe も
		`onRegionChangeComplete` を通るので、アプリから見れば普段の操作と同じである。

		⚠️ **表示域が実際に変わったかは Detox からは読めない。** 確かめるときは
		   BigQuery の `response_success` で `payload.url` の lat/lng/radius が
		   回ごとに違うことを見ること（同じなら、また動いていない）。
		*/
		await element(map).pinch(2.0, "slow"); // 広げる = 寄る
		// デバウンス 400ms + 取得の開始を待つ
		await new Promise((resolve) => setTimeout(resolve, 2000));
		await waitFor(element(map)).toBeVisible(1).withTimeout(DEFAULT_TIMEOUT);
		await device.takeScreenshot("search-this-area-02-zoomed-in");
		console.log(`[search-this-area] 寄せた直後のマーカー: ${await markerReport()}`);

const dense1 = await measureOnce("03-zoomed-in");

		// 地図を動かしてからもう 1 回。こちらが «普段の操作» に近い
		await element(map).swipe("left", "fast", 0.5, 0.5, 0.35);
		const dense2 = await measureOnce("04-zoomed-and-panned");

		const rounds = [wide, dense1, dense2];
		console.log(
			`[search-this-area] 実測: 引き ${wide.elapsed} ms / 寄せた ${dense1.elapsed} ms / ` +
				`寄せて動かした ${dense2.elapsed} ms`,
		);

		await waitFor(element(map)).toBeVisible(1).withTimeout(DEFAULT_TIMEOUT);

		/*
		⚠️ **ここから下は 2026-08-29 に足した。それまでこの spec は «測るだけ» で、
		    何もアサートしていなかった。** つまり 8〜47 秒へ戻っても緑のままで、
		    オーナーの「これって自分でテスト出来ないの？」に対して
		    «測るが落ちない» という答えになっていた。実際、ピン 0 個のまま 417 ms という
		    無意味な数字を ✅ と読む事故も起きている（run 33128561205）。

		    判定は必ず «空振りでないこと» → «速さ» の順に見る。逆順にすると、
		    何も返っていないから速い、という状態を緑にしてしまう。
		*/

		// ① 空振りでないこと。引き（日本全体）は測位に依存しないので基準点に使える
		assert.ok(
			wide.hasMarker,
			"日本全体の «この範囲で再検索» の結果が空だった（下部シートが空状態、またはシートが出ていない）。" +
				`（所要 ${wide.elapsed} ms）この状態の «速さ» は根拠にならない。` +
				"ログイン・保存済みの店・半径の足切り（#1629 で廃止したはず）を疑うこと",
		);

		// ② そのうえで所要時間。**«快適さ» ではなく «壊れている» の線引き**である。
		//    直す前は dev 実測で p50 8,319 ms / p95 47,353 ms だった。エミュレータと
		//    CI ランナーの遅さ、初回のプラン確定（dev 実測で最大 3.3 秒）を含めて余裕を取る。
		//    ⚠️ 赤を消したいという理由でこの数字を緩めないこと。緩めるくらいなら赤で報告する
		const BUDGET_MS = 8_000;
		const tooSlow = rounds.filter((r) => r.elapsed > BUDGET_MS);
		assert.ok(
			tooSlow.length === 0,
			`「この範囲で再検索」が上限 ${BUDGET_MS} ms を超えた: ` +
				`${tooSlow.map((r) => `${r.label} ${r.elapsed} ms`).join(" / ")}。` +
				"#1629 で直した «半径内の全店を舐める» 実行計画へ戻っていないか、" +
				"scripts/db-checks/measure_saved_restaurants.py と measure_order_by_posts.py で確かめること",
		);
	});
});
