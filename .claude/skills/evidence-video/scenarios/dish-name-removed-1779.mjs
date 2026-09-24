/*
#1779 `dishes.name` を落としたあとの表示のエビデンス。

#1779 は `dishes.name` を «読み手ゼロ» として落としたが、**UI 6 箇所が読んでいた**。
表示名の出所は #1629 でオーナーが確定している:

> dishes.name を使うのではなく、dish_categories から locale で引いて欲しい。

`resolveDishCategoryLabel(labels, locale)`（labels[lang] → labels.en → null）へ寄せた。
**labels が 1 つも無い料理では «何も出ない»**（QID へ落とさないのが #1629 の規則）。
そこが論点なので、labels あり / 無しを並べて撮る。

⚠️ 認証・API はすべてモック。映るのは «画面と遷移» であって実データではない。
*/
import { record, ok } from "./harness.mjs";

const NAME = process.env.EVIDENCE_NAME || "dish-name-removed-1779";
const PRESET = process.env.EVIDENCE_PRESET || "default";
// EVIDENCE_NO_LABELS=1 で «カテゴリ表記が 1 つも無い» 場合を撮る
const NO_LABELS = process.env.EVIDENCE_NO_LABELS === "1";
const RID = "restaurant-1";

const labelsFor = (ja) => (NO_LABELS ? null : { ja, en: "Grilled Beef" });

const media = (id, ja) => ({
	dish_media: { id, thumbnailImageUrl: "", mediaUrl: "", render_type: "stored", isMine: false },
	dish: {
		id: `dish-${id}`,
		// ⚠️ `name` は列ごと落としたので API はもう返さない。渡さないのが実態に忠実
		reviewCount: 3,
		averageRating: 4.2,
		categoryImageUrl: null,
		categoryLabels: labelsFor(ja),
	},
	restaurant: { id: RID, name: "焼肉うしごろ 表参道", google_place_id: "place-1" },
	reviews: [],
});

await record({
	name: NAME,
	preset: PRESET,
	mock: (url) => {
		if (/\/v1\/restaurants\/[^/]+\/dish-media/.test(url))
			return {
				body: ok({
					data: [media("m1", "焼肉"), media("m2", "冷麺"), media("m3", "ユッケ")],
					nextCursor: null,
				}),
			};
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
		await page.waitForTimeout(2000);
		await shot("01-reviews-tab");

		const tile = page.getByTestId("restaurant-review-tile").first();
		if (await tile.count()) {
			await tile.click();
			await page.waitForTimeout(2500);
			await shot("02-feed");
		}
	},
});
