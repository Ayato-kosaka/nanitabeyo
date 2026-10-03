/*
#1779 列を落としたあとの «確認ページの住所欄» のエビデンス。

オーナー指摘（2026-09-24）: 「#1779 適用後の確認ページの住所欄動画で見たい」

`restaurants.address_components` を落としたので、確認ページの住所の下書きは
**`address` 列だけ**から組む（#2035）。オープンデータで住所が空の店では
**空欄で出る**（dev 実測 1,675 店 = 0.27%）。住所あり / 空の 2 通りを撮る。

⚠️ 認証・API はすべてモック。映るのは «画面と遷移» であって実データではない。
*/
import { record, ok } from "./harness.mjs";

const NAME = process.env.EVIDENCE_NAME || "confirm-address-1779";
const PRESET = process.env.EVIDENCE_PRESET || "default";
// EVIDENCE_ADDRESS="" にすると «住所が空の店» を撮る
const ADDRESS = process.env.EVIDENCE_ADDRESS ?? "東京都渋谷区神南1-2-3";

await record({
	name: NAME,
	preset: PRESET,
	mock: (url) => {
		if (/\/v1\/restaurants\/draft/.test(url))
			return {
				body: ok({
					draft: {
						googlePlaceId: "place-evidence-1",
						name: "エビデンス用ラーメン",
						address: ADDRESS,
						latitude: 35.681236,
						longitude: 139.767125,
						countryCode: "JP",
						// ⚠️ 実装は countryName を優先する（無いと生の "JP" が出る）。
						//    #2035 で API が ICU から引いて返すので、モックも同じ形にする。
						countryName: "日本",
						subterritoryCode: null,
					},
					draftToken: "dummy-draft-token",
				}),
			};
		return null;
	},
	flow: async (page, shot) => {
		await page.goto(
			"http://localhost:8788/ja-JP/my-dishes/confirm-restaurant?googlePlaceId=place-evidence-1",
			{ waitUntil: "domcontentloaded" },
		);
		await page.getByTestId("confirm-restaurant-screen").waitFor({ timeout: 30_000 });
		await page.waitForTimeout(2500);
		await shot("01-confirm-screen");

		// 住所欄だけを寄せて撮る（ここが論点）
		const addr = page.getByTestId("confirm-restaurant-address");
		if (await addr.count()) {
			await addr.scrollIntoViewIfNeeded();
			await page.waitForTimeout(800);
			await shot("02-address-field");
			// 空欄でも手で入れられることを見せる
			await addr.click();
			await addr.fill("東京都千代田区丸の内1-9-1");
			await page.waitForTimeout(900);
			await shot("03-address-edited");
		}
	},
});
