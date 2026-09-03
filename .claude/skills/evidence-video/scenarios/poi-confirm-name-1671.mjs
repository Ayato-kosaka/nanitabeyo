/**
 * #1671 新規店舗を作るときの «店名の確認» を撮る。
 *
 * 確認ダイアログは地図の POI タップでも出るが、Google Maps をモックした web の
 * ハーネスでは POI クリックを発火できない。**同じ確認は店名検索の導線でも出る**
 * （どちらも `createAndOpenRestaurant` へ合流するため）ので、そちらから撮る。
 *
 * モックするのは 2 本だけ:
 *   - `v1/locations/autocomplete` … 飲食店の候補を 1 件返す（types に restaurant）
 *   - `v1/restaurants/by-google-place-id` … null を返す ＝ «まだ自社に無い店»
 * この 2 本目が «新規かどうか» の判定なので、null が確認ダイアログの出る条件である。
 */
import { record, ok } from "./harness.mjs";

const SUGGESTION = {
	place_id: "ChIJ_evidence_1671",
	text: "鮨 かねさか 銀座",
	mainText: "鮨 かねさか 銀座",
	secondaryText: "東京都中央区銀座8-10-3",
	types: ["restaurant", "food", "point_of_interest"],
};

await record({
	name: "poi-confirm-name-1671",
	langs: ["ja"],
	mock: (url) => {
		if (url.includes("v1/locations/autocomplete")) return { body: ok([SUGGESTION]) };
		// null = まだ自社データに無い（＝新規）。ここが非 null だと確認は出ない
		if (url.includes("v1/restaurants/by-google-place-id")) return { body: ok(null) };
		return null;
	},
	flow: async (page, shot) => {
		await page.goto("http://localhost:8788/ja-JP/my-dishes/select-restaurant", { waitUntil: "domcontentloaded" });
		await page.waitForTimeout(2500);
		await shot("01-select-restaurant");

		const input = page.getByTestId("location-autocomplete-input");
		await input.waitFor({ state: "visible", timeout: 20000 });
		await input.click();
		await input.fill("鮨 かねさか");
		// 入力のデバウンス + 候補の描画を実時間で待つ
		await page.waitForTimeout(2000);
		await shot("02-suggestions");

		const suggestion = page.getByTestId("location-autocomplete-suggestion-0");
		await suggestion.waitFor({ state: "visible", timeout: 20000 });
		await suggestion.click();

		// 確認ダイアログ（useDialog().prompt）が出るまで待つ
		await page.waitForTimeout(1500);
		await shot("03-confirm-name-dialog");
	},
});
