import { by, launchAppWithSession, localeDeepLink, waitUntilVisible } from "../../fixtures/e2e";
import { captureScreenIfReachable } from "../../utils/catalog";

/**
 * 📸 #1666 店舗詳細の «営業時間»（ネイティブ）@catalog
 *
 *     scope=catalog + test_filter=restaurant-opening-hours-1666
 *
 * で、このファイルだけを数分で実行できる（`jest.config.js` の DETOX_TEST_FILTER）。
 *
 * ## ⚠️ なぜ «実在する店の id» を埋めているのか
 *
 * **Detox には API をモックする仕組みが無い**（`tests/my-dishes/restaurant-routes.test.ts`
 * の冒頭に書いてある）。営業時間欄は **データを持つ店でしか描かれない**（持たない店では
 * 欄ごと出さないのが仕様）ので、存在しない id で着地しても **絵にならない**。
 *
 * そこで dev の実データを使う。`confirm-restaurant-1671.test.ts` が同じやり方で
 * «dev に居ることを確認済みの place_id» を埋めているのと同じ考え方である。
 *
 * この id は読み取り専用スクリプト
 * `scripts/20260808T0000_restaurant/9_9_find_restaurant_with_hours.py` が選んだもの
 * （[run 34371148710](https://github.com/Ayato-kosaka/nanitabeyo/actions/runs/34371148710)）。
 * 選定条件は «曜日が 2 つ以上 / 1 日に 2 コマ以上 / 日またぎを含む» で、
 * **画面に出る 3 つの見え方（複数コマ・定休・翌◯◯）が 1 枚に収まる**店を選んでいる。
 *
 *     CoCo壱番屋  日〜土  00:00–01:00 / 11:00–翌00:00  (osm)
 *
 * dev のデータが入れ替わって居なくなったら `captureScreenIfReachable` が
 * «撮れなかった» を残して素通りする（ジョブは赤くしない）。
 *
 * ## dev の API に `/opening-hours` が乗るまでは撮れなかった（2026-09-25 に解消）
 *
 * このエンドポイントは [PR #1935](https://github.com/Ayato-kosaka/nanitabeyo/pull/1935) で
 * 入ったばかりで、しばらく dev の API は 2026-09-04/05 のビルドのままだった。その間は 404 に
 * なり、画面は欄を出さない（＝素通りする）。**それが «撮れなかった» としてログに残ること**も
 * この test の役目である。
 *
 * ⚠️ **2026-09-25 に dev の API が main の `c035cf99d` へ入れ替わり、この前提は解消した。**
 * 2026-09-27 に Android で実際に撮れている（CoCo壱番屋 / 日〜土 00:00–01:00・11:00–翌00:00 /
 * 「OpenStreetMap より取得（2026-08-23）」まで出ている）:
 * https://github.com/Ayato-kosaka/nanitabeyo/actions/runs/36326930363
 *
 * ## ⚠️ この test は **夜間には走らない**
 *
 * `e2e-mobile-test.yml` の schedule は `scope=tier1-2` で、`catalog` は
 * «この scope を明示したときだけ走る» 側に置かれている。つまりここの絵は
 * **誰かが `scope=catalog` で手動実行したときの鮮度**しか持たない。
 * «前提が解消したのに 2 日間誰も気づかなかった» のはそのためである。
 */
const DEV_RESTAURANT_WITH_HOURS = "000745eb-de1e-4cb8-be06-c466a05e0de5"; // CoCo壱番屋

describe("UI カタログ（#1666 店舗詳細の営業時間） @catalog", () => {
	it("営業時間の出ている店舗詳細を撮る", async () => {
		await captureScreenIfReachable(
			"review-restaurant-detail-opening-hours",
			async () => {
				await launchAppWithSession({
					as: "anon",
					url: localeDeepLink(`restaurant/${DEV_RESTAURANT_WITH_HOURS}`),
					// タブバーは店舗詳細の下に居ないので、既定の起動完了待ちは使えない
					waitForReady: false,
				});
				// ⚠️ 画面タイトルではなく **営業時間欄そのもの**を待つ。
				//    タイトルはデータが無くても出るので、待つ先を間違えると
				//    «営業時間の無い店舗詳細» を撮って «撮れた» と報告することになる。
				await waitUntilVisible(by.id("restaurant-opening-hours"));
			},
			{ settleMs: 1_500 },
		);
	});
});
