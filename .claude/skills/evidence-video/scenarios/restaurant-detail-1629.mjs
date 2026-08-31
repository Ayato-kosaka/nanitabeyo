/*
#1629 店舗詳細のオーナー確定 3 点のエビデンス。

1. «写真・動画を投稿» を外した
2. «Google マップで開く» を戻した
3. 投稿一覧を押すと フィード へ入る（レビューを書く画面ではない）

⚠️ 認証・API はすべてモック。映るのは «画面と遷移» であって実データではない。
*/
import { record, ok } from "./harness.mjs";

const NAME = process.env.EVIDENCE_NAME || "restaurant-detail-1629";
const PRESET = process.env.EVIDENCE_PRESET || "default";
const RID = "restaurant-1";

const media = (id, name) => ({
	dish_media: { id, thumbnailImageUrl: "", mediaUrl: "", render_type: "stored", isMine: false },
	dish: { id: `dish-${id}`, name, reviewCount: 3, averageRating: 4.2, categoryImageUrl: null, categoryLabels: null },
	restaurant: { id: RID, name: "焼肉うしごろ 表参道", google_place_id: "place-1" },
	reviews: [],
});

await record({
	name: NAME,
	preset: PRESET,
	mock: (url) => {
		if (/\/v1\/restaurants\/[^/]+\/dish-media/.test(url))
			return { body: ok({ data: [media("m1", "上カルビ"), media("m2", "冷麺"), media("m3", "ユッケ")], nextCursor: null }) };
		if (/\/v1\/restaurants\/(?!search)[^/?]+(\?.*)?$/.test(url))
			return {
				body: ok({
					restaurant: { id: RID, name: "焼肉うしごろ 表参道", imageUrls: { md: null }, google_place_id: "place-1" },
					meta: { averageRating: 4.2, reviewCount: 12, totalCents: 0, maxEndDate: null },
				}),
			};
		return null;
	},
	flow: async (page, shot) => {
		await page.goto(`http://localhost:8788/ja-JP/restaurant/${RID}`, { waitUntil: "domcontentloaded" });
		await page.getByTestId("restaurant-detail-screen-title").waitFor({ timeout: 30_000 });
		await page.waitForTimeout(1500);
		await shot("01-detail");

		// 投稿一覧を押す → フィードへ
		await page.getByTestId("restaurant-review-tile").first().click();
		await page.waitForTimeout(2500);
		await shot("02-after-tile-press");
	},
});
