/*
#1666 営業時間欄の UX 作り直しのエビデンス。

オーナー指摘（2026-09-24）: 「既にひらいてるのは NG。UX が悪すぎる。
PJ 標準の見やすい UX にしてください。ダサすぎて話にならない。」

既定を **連続する同じ時間帯をまとめた要約** にし、押すと 7 曜日の表が開く。
⚠️ 「本日の営業時間」にはしない（判定が JST 固定なので、韓国の店で嘘になる）。

⚠️ 認証・API はすべてモック。映るのは «画面と遷移» であって実データではない。
*/
import { record, ok } from "./harness.mjs";

const NAME = process.env.EVIDENCE_NAME || "opening-hours-1666";
const PRESET = process.env.EVIDENCE_PRESET || "default";
const RID = "restaurant-1";

const span = (opensAt, closesAt, crossesMidnight = false) => ({ opensAt, closesAt, crossesMidnight });
// 日=定休 / 月-金=11:00-22:00 / 土=11:00-23:00（畳むと 3 行になるはず）
const SPANS = {
	0: [],
	1: [span("11:00", "22:00")],
	2: [span("11:00", "22:00")],
	3: [span("11:00", "22:00")],
	4: [span("11:00", "22:00")],
	5: [span("11:00", "22:00")],
	6: [span("11:00", "23:00")],
};

await record({
	name: NAME,
	preset: PRESET,
	mock: (url) => {
		if (/\/v1\/restaurants\/[^/]+\/opening-hours/.test(url))
			return {
				body: ok({
					days: Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, spans: SPANS[dayOfWeek] })),
					sources: ["official_site"],
					fetchedAt: "2026-09-24T02:00:00.000Z",
				}),
			};
		if (/\/v1\/restaurants\/[^/]+\/dish-media/.test(url)) return { body: ok({ data: [], nextCursor: null }) };
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
		await page.waitForTimeout(2200);
		await shot("01-collapsed");

		const toggle = page.getByTestId("restaurant-opening-hours-toggle").first();
		if (await toggle.count()) {
			await toggle.scrollIntoViewIfNeeded();
			await page.waitForTimeout(500);
			await shot("02-collapsed-closeup");
			await toggle.click();
			await page.waitForTimeout(1200);
			await shot("03-expanded");
			await toggle.click();
			await page.waitForTimeout(1000);
			await shot("04-collapsed-again");
		}
	},
});
