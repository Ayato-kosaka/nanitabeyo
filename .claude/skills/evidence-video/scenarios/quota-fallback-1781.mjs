/*
#843 / #1781 §5 の検証。**Google Places の日次上限（429）に当たったとき、
利用者に何が起きるのか**を実際に見る。

#1781 §5 は「上限に当たると ただの『取得に失敗しました』になる」と書いている。
一方コードを読むと `search/result.tsx` は `errorByKey` を一切見ておらず、
`ids.length === 0 && !isLoading` で Google マップの退避ダイアログを出すように見える。
**どちらが正しいかを、読みではなく実際の画面で決める。**

⚠️ 認証・API はすべてモック。ここで再現しているのは «bulk-import が 429 を返す» 状況だけ。

手順: 料理提案 → カードを押す → 店提案（result）。
  - `v1/dish-media/search` は 0 件（手元に投稿が無い状態）
  - `v1/dishes/bulk-import` は **429 / EXTERNAL_QUOTA_EXCEEDED**（上限に当たった状態）
*/
import { BASE, record, ok, solidCard, dismissTutorial } from "./harness.mjs";

const NAME = process.env.EVIDENCE_NAME || "quota-fallback-1781";
const PRESET = process.env.EVIDENCE_PRESET || "default";

const SEARCH_PARAMS = {
	address: "country:JP, administrative_area_level_1:東京都, locality:渋谷区",
	location: { latitude: 35.658034, longitude: 139.701636 },
	distance: 800,
	priceLevels: ["PRICE_LEVEL_MODERATE"],
	timeSlot: "dinner",
	scene: "friends",
	taste: null,
	diningPace: null,
	coreIngredient: null,
	localLanguageCode: "ja",
};

const RECOMMENDATIONS = [
	{
		category: "ラーメン",
		topicTitle: "こってり豚骨で満たされる",
		reason: "夜に食べたくなる定番",
		categoryId: "cat-1",
		imageUrl: "https://evidence.invalid/cat-1.svg",
		deepDiveFeatures: [],
		isSaved: false,
	},
];

let bulkImportCalls = 0;

await record({
	name: NAME,
	preset: PRESET,
	mock: (url) => {
		if (url.includes("dish-categories/recommendations")) return { body: ok(RECOMMENDATIONS) };
		// 手元に投稿が 0 件（= 一括取り込みへ進む条件）
		if (url.includes("/v1/dish-media/search")) return { body: ok([]) };
		// ここが本題。Google Places の日次上限に当たった状態を再現する
		if (url.includes("/v1/dishes/bulk-import")) {
			bulkImportCalls += 1;
			return {
				status: 429,
				body: JSON.stringify({
					success: false,
					errorCode: "EXTERNAL_QUOTA_EXCEEDED",
					message: "Google Places Text Search API quota exceeded",
				}),
			};
		}
		if (url.includes("evidence.invalid/cat-")) return { body: solidCard("888888"), contentType: "image/svg+xml" };
		return null;
	},
	flow: async (page, shot) => {
		await page.goto(
			`${BASE}/ja-JP/search/dish-categories?searchParams=${encodeURIComponent(JSON.stringify(SEARCH_PARAMS))}`,
			{ waitUntil: "domcontentloaded" },
		);
		await page.waitForTimeout(9000);
		await dismissTutorial(page);
		await shot("01-dish-categories");

		await page.getByText(RECOMMENDATIONS[0].topicTitle, { exact: false }).first().click();
		// 429 が返り、画面が落ち着くまで待つ
		await page.waitForTimeout(9000);
		await shot("02-after-quota-429");

		const bodyText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
		console.log("\n=== 上限（429）に当たったあとの画面 ===");
		console.log("bulk-import が呼ばれた回数:", bulkImportCalls);
		for (const probe of ["Google マップ", "取得に失敗", "エラー", "お店がありません", "見つかりません"]) {
			console.log(`  ${probe.padEnd(12)} : ${bodyText.includes(probe) ? "出た" : "-"}`);
		}
		console.log("--- 画面の文字（先頭 300） ---");
		console.log(bodyText.slice(0, 300));
	},
});
