/*
#1629【オーナー指示】グリッドのタイル下部を «自分の星評価 → 店名 → 料理名» の順にする。

⚠️ 認証・API はモック。映っているのは «並び» であって実データではない。
*/
import { record, ok, solidCard, writeNote, OUT } from "./harness.mjs";

const BASE = process.env.EVIDENCE_BASE || "http://localhost:8788";
const NAME = process.env.EVIDENCE_NAME || "grid-footer-1629";
const IMG = `data:image/svg+xml;base64,${Buffer.from(solidCard("F05537")).toString("base64")}`;

const row = (key, restaurantName, ja, rating) => ({
	key,
	status: "eaten",
	occurredAt: "2026-08-25T12:00:00.000Z",
	restaurant: { id: `r-${key}`, name: restaurantName, imageUrls: { sm: IMG, md: IMG } },
	dish: { id: `d-${key}`, category_id: "Q234646", name: "ローマ字が入ることもある", categoryLabels: { ja }, categoryImageUrl: IMG },
	dishMedia: { id: `m-${key}`, thumbnailImageUrl: IMG },
	myReview: { id: `rv-${key}`, rating },
});

const notes = [];
const mock = (url) => {
	if (url.includes("/v1/users/me/dishes/map-pins")) return { body: ok({ data: [] }) };
	if (url.includes("/v1/users/me/dishes"))
		return {
			body: ok({
				data: [row("1", "麦と麺助", "ラーメン", 5), row("2", "メルクのパン", "食パン", 4)],
				nextCursor: null,
			}),
		};
	return null;
};

await record({
	name: NAME,
	langs: ["ja"],
	mock,
	flow: async (page, shot) => {
		await page.goto(`${BASE}/ja-JP/my-dishes`, { waitUntil: "domcontentloaded" });
		await page.waitForTimeout(6000);
		await shot("01-grid");

		const y = async (testID) => {
			const box = await page.getByTestId(testID).first().boundingBox().catch(() => null);
			return box ? box.y : null;
		};
		const [rating, restaurant, dish] = await Promise.all([
			y("my-dishes-list-item-rating"),
			y("my-dishes-list-item-restaurant"),
			y("my-dishes-list-item-dish"),
		]);
		notes.push(`測った y: 星=${rating} / 店名=${restaurant} / 料理名=${dish}`);
		notes.push(
			rating !== null && restaurant !== null && dish !== null && rating < restaurant && restaurant < dish
				? "1. ✅ 星評価 → 店名 → 料理名 の順に並んでいる"
				: "1. ❌ 並びが指示どおりでない（どれかが描かれていない可能性）",
		);
		const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
		notes.push(
			text.includes("麦と麺助") && text.includes("ラーメン") && !text.includes("ローマ字が入ることもある")
				? "2. ✅ 料理名はカテゴリの表記（ローマ字の呼び名は出ていない）"
				: "2. ❌ 表示名がおかしい",
		);
		writeNote(NAME, notes);
	},
});

console.log(`done -> ${OUT}`);
