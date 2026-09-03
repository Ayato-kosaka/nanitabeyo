/*
#1667 レビュー 0 件の店は、評価まわり（★・数値・件数）を «何も出さない» ことのエビデンス。
【オーナー確定 2026-09-03】«未評価» というラベルも出さない。1 件以上のときの見た目は変えない。

⚠️ 認証・API はすべてモック。映るのは «画面と遷移» であって実データではない。
*/
import { record, ok } from "./harness.mjs";

const NAME = process.env.EVIDENCE_NAME || "restaurant-unrated-1667";
const PRESET = process.env.EVIDENCE_PRESET || "default";
const UNRATED_ID = "restaurant-unrated";
const RATED_ID = "restaurant-rated";

const restaurantMeta = (id) => {
	if (id === UNRATED_ID)
		return {
			restaurant: { id, name: "開店したての定食屋", imageUrls: { md: null }, google_place_id: "place-unrated" },
			meta: { averageRating: 0, reviewCount: 0, totalCents: 0, maxEndDate: null },
		};
	return {
		restaurant: { id, name: "焼肉うしごろ 表参道", imageUrls: { md: null }, google_place_id: "place-rated" },
		meta: { averageRating: 4.2, reviewCount: 12, totalCents: 0, maxEndDate: null },
	};
};

await record({
	name: NAME,
	preset: PRESET,
	mock: (url) => {
		const m = /\/v1\/restaurants\/([^/?]+)(\?.*)?$/.exec(url);
		if (m && m[1] !== "search") return { body: ok(restaurantMeta(m[1])) };
		if (/\/v1\/restaurants\/[^/]+\/dish-media/.test(url)) return { body: ok({ data: [], nextCursor: null }) };
		return null;
	},
	flow: async (page, shot) => {
		await page.goto(`http://localhost:8788/ja-JP/restaurant/${UNRATED_ID}`, { waitUntil: "domcontentloaded" });
		await page.getByTestId("restaurant-detail-screen-title").waitFor({ timeout: 30_000 });
		await page.waitForTimeout(1200);
		await shot("01-unrated-reviewcount-0");

		await page.goto(`http://localhost:8788/ja-JP/restaurant/${RATED_ID}`, { waitUntil: "domcontentloaded" });
		await page.getByTestId("restaurant-detail-screen-title").waitFor({ timeout: 30_000 });
		await page.waitForTimeout(1200);
		await shot("02-rated-reviewcount-12");
	},
});
