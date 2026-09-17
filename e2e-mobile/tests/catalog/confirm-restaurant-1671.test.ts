import { by, launchAppWithSession, localeDeepLink, waitUntilVisible } from "../../fixtures/e2e";
import { captureScreenIfReachable } from "../../utils/catalog";

/**
 * 📸 #1671 新規店舗の確認ページ（ネイティブ）@catalog
 *
 * ## なぜ ui-catalog.test.ts と別ファイルなのか
 *
 * この画面だけを撮るためである。`ui-catalog.test.ts` はカタログ全画面を巡るので、
 * その道中で **Google の Autocomplete / Text Search が走る**。この画面 1 枚の
 * エビデンスのために全部を回す理由が無い。
 *
 *     scope=catalog + test_filter=confirm-restaurant-1671
 *
 * で、このファイルだけを実行できる（`jest.config.js` の DETOX_TEST_FILTER）。
 *
 * ## ⚠️ Google Places を叩かない place_id を使う
 *
 * 確認ページは開いた時点で `POST /v1/restaurants/draft` を呼ぶ。
 *
 * - **dev にまだ無い店** … サーバが Place Details を 2 回叩く（#1781 の ⑥⑦。課金 SKU）
 * - **dev に既にある店** … 自社 DB だけで組み立てて返す。**Google は 0 回**
 *
 * ここは後者を使う。オーナーの「place detail 使うので ci にしてはダメよ」に
 * 沿いつつ、画面としては同じものが撮れる（描画は draft の応答だけで決まり、
 * それが Google 由来か自社 DB 由来かで見た目は変わらない）。
 *
 * ⚠️ この place_id は **dev に居ることを確認済み**のもの（#1832 の OSM ローダが
 * 突き合わせた 13,065 店のうちの 1 つで、13,065/13,065 が dev PG に居た）。
 * dev のデータが入れ替わって居なくなったら `captureScreenIfReachable` が
 * «撮れなかった» を残して素通りする（ジョブは赤くしない）。
 */
const DEV_GOOGLE_PLACE_ID = "ChIJE2MvXVTmHWARPKqtRuhauM8"; // やすらぎ亭

describe("UI カタログ（#1671 新規店舗の確認ページ） @catalog", () => {
	it("確認ページを撮る", async () => {
		await captureScreenIfReachable(
			"my-dishes-confirm-restaurant",
			async () => {
				await launchAppWithSession({
					as: "authenticated",
					url: localeDeepLink(
						`my-dishes/confirm-restaurant?googlePlaceId=${DEV_GOOGLE_PLACE_ID}`,
					),
				});
				// 下読みが返って本文が描かれるまで待つ（ローディング中を撮らない）
				await waitUntilVisible(by.id("confirm-restaurant-name"));
			},
			// 地図タイルの描画待ち
			{ settleMs: 4_000 },
		);
	});
});
